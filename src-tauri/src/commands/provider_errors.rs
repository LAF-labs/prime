//! Turning a provider's raw error into something a person can act on.
//!
//! When a request to the model fails, what reaches us is whatever the provider
//! serialized — usually a JSON blob, sometimes a bare status line. That was
//! passed through verbatim into the chat timeline, where a single-line error
//! renders as small centred grey text. A rejected API key and a 500 looked
//! identical, and neither told the user what to do.
//!
//! Onboarding already had this mapping for key validation. This is the same
//! idea applied to the errors that arrive mid-conversation.

use serde::Serialize;

/// What the user should do about it, if there is something.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorAction {
    /// The key is wrong or missing — send them to provider settings.
    OpenSettings,
    /// Worth trying again; nothing is misconfigured.
    Retry,
    /// The request was too large for the model's context.
    Compact,
    /// Nothing specific to suggest.
    None,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderError {
    pub message: String,
    pub action: ErrorAction,
    /// The provider's own text, kept for the debug panel.
    pub detail: String,
}

/// Pull an HTTP status out of a raw provider error.
///
/// Providers are inconsistent about where they put it: `"status": 429`,
/// `HTTP 401`, `status code 500`. Look for all of the shapes rather than
/// guessing one.
fn status_of(raw: &str) -> Option<u16> {
    let lower = raw.to_lowercase();
    for marker in ["\"status\":", "status code", "status:", "http", "code:"] {
        let mut from = 0;
        while let Some(idx) = lower[from..].find(marker) {
            let after = from + idx + marker.len();
            let digits: String = lower[after..]
                .chars()
                .skip_while(|c| !c.is_ascii_digit() && (*c == ' ' || *c == ':' || *c == '"'))
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(code) = digits.parse::<u16>() {
                if (100..=599).contains(&code) {
                    return Some(code);
                }
            }
            from = after;
        }
    }
    None
}

fn mentions(raw: &str, needles: &[&str]) -> bool {
    let lower = raw.to_lowercase();
    needles.iter().any(|n| lower.contains(n))
}

/// Classify a raw provider error.
pub fn classify(raw: &str) -> ProviderError {
    let detail = raw.trim().to_string();

    // Phrases first: a body can say "invalid_api_key" while the transport
    // reported 200, and a status code alone can't tell a context overflow
    // from an ordinary bad request.
    if mentions(raw, &["context length", "context_length", "too many tokens", "maximum context"]) {
        return ProviderError {
            message: "The conversation is longer than this model's context window. \
                      Compact the thread or start a new one."
                .into(),
            action: ErrorAction::Compact,
            detail,
        };
    }
    if mentions(
        raw,
        &["invalid_api_key", "invalid api key", "incorrect api key", "unauthorized", "authentication"],
    ) {
        return ProviderError {
            message: "The provider rejected the API key. Check it in Settings → Providers.".into(),
            action: ErrorAction::OpenSettings,
            detail,
        };
    }
    if mentions(raw, &["insufficient_quota", "quota", "billing", "credit balance"]) {
        return ProviderError {
            message: "The provider reports no remaining quota or credit for this key.".into(),
            action: ErrorAction::OpenSettings,
            detail,
        };
    }

    match status_of(raw) {
        Some(401) | Some(403) => ProviderError {
            message: "The provider rejected the API key. Check it in Settings → Providers.".into(),
            action: ErrorAction::OpenSettings,
            detail,
        },
        Some(404) => ProviderError {
            message: "The provider has no endpoint at this URL. Check the base URL in Settings → Providers."
                .into(),
            action: ErrorAction::OpenSettings,
            detail,
        },
        Some(429) => ProviderError {
            message: "Rate-limited by the provider. Wait a moment and send again.".into(),
            action: ErrorAction::Retry,
            detail,
        },
        Some(code) if (500..=599).contains(&code) => ProviderError {
            message: format!("The provider had a server error (HTTP {code}). This is on their side — try again."),
            action: ErrorAction::Retry,
            detail,
        },
        Some(code) => ProviderError {
            message: format!("The provider rejected the request (HTTP {code})."),
            action: ErrorAction::None,
            detail,
        },
        None if mentions(raw, &["timed out", "timeout", "econnreset", "enotfound", "network", "socket hang up"]) => {
            ProviderError {
                message: "Could not reach the provider. Check your connection and try again.".into(),
                action: ErrorAction::Retry,
                detail,
            }
        }
        None => ProviderError {
            // No pattern matched: show the provider's own words rather than a
            // vague placeholder, but say where they came from.
            message: format!("The provider request failed: {}", first_line(raw)),
            action: ErrorAction::None,
            detail,
        },
    }
}

/// A single readable line, so a multi-line JSON blob doesn't become the title.
fn first_line(raw: &str) -> String {
    let line = raw.trim().lines().next().unwrap_or("").trim();
    super::rpc::connection::truncate_chars(line, 200)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rejected_key_says_so_and_points_at_settings() {
        for raw in [
            r#"{"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}"#,
            "HTTP 401 Unauthorized",
            r#"{"status": 403, "message": "forbidden"}"#,
        ] {
            let e = classify(raw);
            assert_eq!(e.action, ErrorAction::OpenSettings, "raw: {raw}");
            assert!(e.message.contains("API key"), "raw: {raw} -> {}", e.message);
        }
    }

    #[test]
    fn rate_limiting_suggests_waiting_not_reconfiguring() {
        let e = classify(r#"{"error":{"message":"Rate limit reached","status":429}}"#);
        assert_eq!(e.action, ErrorAction::Retry);
        assert!(e.message.to_lowercase().contains("rate-limited"));
    }

    #[test]
    fn a_server_error_is_named_as_the_providers_fault() {
        let e = classify("upstream returned status code 503");
        assert_eq!(e.action, ErrorAction::Retry);
        assert!(e.message.contains("503"));
    }

    /// A context overflow reads as a 400 to the transport, so the phrase has
    /// to win over the status code — the fix is compaction, not the API key.
    #[test]
    fn context_overflow_is_not_reported_as_a_bad_request() {
        let e = classify(
            r#"{"error":{"message":"This model's maximum context length is 128000 tokens","code":400}}"#,
        );
        assert_eq!(e.action, ErrorAction::Compact);
        assert!(e.message.contains("context window"));
    }

    #[test]
    fn quota_exhaustion_is_distinguished_from_a_bad_key() {
        let e = classify(r#"{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}"#);
        assert_eq!(e.action, ErrorAction::OpenSettings);
        assert!(e.message.contains("quota"));
    }

    #[test]
    fn a_network_failure_is_not_blamed_on_the_key() {
        let e = classify("FetchError: request to https://api.example.com failed, reason: socket hang up");
        assert_eq!(e.action, ErrorAction::Retry);
        assert!(e.message.contains("reach the provider"));
    }

    #[test]
    fn an_unrecognized_error_still_shows_the_providers_words() {
        let e = classify("something entirely novel went wrong");
        assert_eq!(e.action, ErrorAction::None);
        assert!(e.message.contains("something entirely novel"));
    }

    /// The raw text is what the debug panel shows, so it must survive intact
    /// even when the summary is rewritten.
    #[test]
    fn the_original_text_is_always_kept() {
        let raw = r#"{"error":{"message":"Incorrect API key"}}"#;
        assert_eq!(classify(raw).detail, raw);
    }

    #[test]
    fn a_multiline_blob_does_not_become_a_multiline_title() {
        let e = classify("first line of trouble\nsecond line\nthird line");
        assert!(!e.message.contains('\n'));
        assert!(e.message.contains("first line of trouble"));
    }

    #[test]
    fn non_ascii_provider_text_is_not_split_mid_character() {
        let raw = "요청이 거부되었습니다 ".repeat(40);
        let e = classify(&raw);
        assert!(e.message.contains("요청이"));
    }
}
