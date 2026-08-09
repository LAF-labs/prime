//! Model auto-discovery: given an API key (and optionally a base URL), ask
//! the provider itself which models the key can use.
//!
//! Three wire formats cover effectively every hosted LLM API:
//! - **OpenAI-compatible** `GET {base}/models` with `Authorization: Bearer` —
//!   OpenAI, OpenRouter, Mistral, DeepSeek, Moonshot (Kimi), Qwen/DashScope,
//!   Upstage, Groq, xAI, Together, Fireworks, Ollama, vLLM, …
//! - **Anthropic** `GET /v1/models` with `x-api-key` + `anthropic-version`.
//! - **Google Gemini** `GET /v1beta/models` with `x-goog-api-key`.
//!
//! No provider is special-cased beyond its wire format: built-in tiles pass a
//! `provider` name that maps to a known base URL + format, custom endpoints
//! pass an explicit `base_url` and use the OpenAI format.

use serde::Serialize;

use super::error::AppError;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub name: String,
}

enum WireFormat {
    OpenAi,
    Anthropic,
    Google,
}

/// Map a built-in provider name to its models endpoint + wire format.
fn builtin_endpoint(provider: &str) -> Option<(&'static str, WireFormat)> {
    match provider {
        "anthropic" => Some(("https://api.anthropic.com/v1/models?limit=1000", WireFormat::Anthropic)),
        "google" => Some(("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", WireFormat::Google)),
        "openai" => Some(("https://api.openai.com/v1/models", WireFormat::OpenAi)),
        "openrouter" => Some(("https://openrouter.ai/api/v1/models", WireFormat::OpenAi)),
        "mistral" => Some(("https://api.mistral.ai/v1/models", WireFormat::OpenAi)),
        "groq" => Some(("https://api.groq.com/openai/v1/models", WireFormat::OpenAi)),
        "xai" => Some(("https://api.x.ai/v1/models", WireFormat::OpenAi)),
        _ => None,
    }
}

fn friendly_http_error(status: u16, provider_label: &str) -> String {
    match status {
        401 | 403 => format!("{provider_label} rejected the API key (HTTP {status}). Check the key and try again."),
        404 => format!("{provider_label} has no /models endpoint at this URL (HTTP 404). Check the base URL."),
        429 => format!("{provider_label} rate-limited the request (HTTP 429). Try again in a moment."),
        s => format!("{provider_label} returned HTTP {s}."),
    }
}

fn parse_openai(body: &serde_json::Value) -> Vec<DiscoveredModel> {
    body.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let id = m.get("id").and_then(|v| v.as_str())?;
                    let name = m
                        .get("name")
                        .or_else(|| m.get("display_name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(id);
                    Some(DiscoveredModel { id: id.to_string(), name: name.to_string() })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_anthropic(body: &serde_json::Value) -> Vec<DiscoveredModel> {
    // Same envelope as OpenAI (`data: [{id, display_name}]`).
    parse_openai(body)
}

fn parse_google(body: &serde_json::Value) -> Vec<DiscoveredModel> {
    body.get("models")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    // Only models that can actually chat.
                    let methods = m.get("supportedGenerationMethods").and_then(|v| v.as_array());
                    if let Some(methods) = methods {
                        if !methods.iter().any(|x| x.as_str() == Some("generateContent")) {
                            return None;
                        }
                    }
                    let name = m.get("name").and_then(|v| v.as_str())?; // "models/gemini-…"
                    let id = name.strip_prefix("models/").unwrap_or(name);
                    let display = m.get("displayName").and_then(|v| v.as_str()).unwrap_or(id);
                    Some(DiscoveredModel { id: id.to_string(), name: display.to_string() })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Discover the models an API key can use.
///
/// Pass `provider` for a built-in (anthropic, openai, google, openrouter,
/// mistral, groq, xai) or `base_url` for any OpenAI-compatible endpoint.
#[tauri::command]
pub async fn provider_discover_models(
    provider: Option<String>,
    base_url: Option<String>,
    api_key: String,
) -> Result<Vec<DiscoveredModel>, AppError> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(AppError::Other("API key must not be empty".to_string()));
    }

    let (url, format, label) = if let Some(base) = base_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if !base.starts_with("http://") && !base.starts_with("https://") {
            return Err(AppError::Other("Base URL must start with http(s)://".to_string()));
        }
        let base = base.trim_end_matches('/');
        (format!("{base}/models"), WireFormat::OpenAi, base.to_string())
    } else {
        let p = provider.as_deref().unwrap_or("").trim().to_lowercase();
        let (url, format) = builtin_endpoint(&p)
            .ok_or_else(|| AppError::Other(format!("Unknown provider '{p}' and no base URL given")))?;
        (url.to_string(), format, p)
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Other(format!("HTTP client init failed: {e}")))?;

    let request = match format {
        WireFormat::Anthropic => client
            .get(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01"),
        // The key goes in a header, never a `?key=` query param — URLs land in
        // server logs, proxies, and error messages; headers do not.
        WireFormat::Google => client.get(&url).header("x-goog-api-key", &api_key),
        WireFormat::OpenAi => client.get(&url).bearer_auth(&api_key),
    };

    let response = request
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Could not reach {label}: {e}")))?;

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(AppError::Other(friendly_http_error(status, &label)));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Other(format!("{label} returned invalid JSON: {e}")))?;

    let mut models = match format {
        WireFormat::OpenAi => parse_openai(&body),
        WireFormat::Anthropic => parse_anthropic(&body),
        WireFormat::Google => parse_google(&body),
    };
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);

    if models.is_empty() {
        return Err(AppError::Other(format!(
            "{label} accepted the key but reported no usable models."
        )));
    }
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_openai_data_envelope() {
        let body = serde_json::json!({
            "data": [
                { "id": "solar-pro2", "name": "Solar Pro 2" },
                { "id": "deepseek-chat" },
            ]
        });
        let models = parse_openai(&body);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "solar-pro2");
        assert_eq!(models[0].name, "Solar Pro 2");
        assert_eq!(models[1].name, "deepseek-chat");
    }

    #[test]
    fn parse_anthropic_display_name() {
        let body = serde_json::json!({
            "data": [{ "id": "claude-sonnet-4", "display_name": "Claude Sonnet 4" }]
        });
        let models = parse_anthropic(&body);
        assert_eq!(models[0].name, "Claude Sonnet 4");
    }

    #[test]
    fn parse_google_filters_non_chat_models() {
        let body = serde_json::json!({
            "models": [
                { "name": "models/gemini-2.5-pro", "displayName": "Gemini 2.5 Pro",
                  "supportedGenerationMethods": ["generateContent"] },
                { "name": "models/text-embedding-004", "displayName": "Embedding",
                  "supportedGenerationMethods": ["embedContent"] }
            ]
        });
        let models = parse_google(&body);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gemini-2.5-pro");
    }

    #[test]
    fn builtin_endpoints_cover_known_providers() {
        for p in ["anthropic", "openai", "google", "openrouter", "mistral", "groq", "xai"] {
            assert!(builtin_endpoint(p).is_some(), "{p} missing");
        }
        assert!(builtin_endpoint("nope").is_none());
    }
}
