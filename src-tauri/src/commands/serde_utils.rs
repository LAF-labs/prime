//! Serde utilities for handling LLM tool argument quirks.
//!
//! Handles common LLM quirks where models sometimes stringify JSON arguments
//! instead of providing structured values. For example, a model might return:
//!
//! ```json
//! { "path": "/src/main.rs", "content": "{\"key\": \"value\"}" }
//! ```
//!
//! Instead of the expected:
//!
//! ```json
//! { "path": "/src/main.rs", "content": { "key": "value" } }
//! ```
//!
//! The `deserialize_maybe_stringified` function handles both cases transparently.

use serde::de::{DeserializeOwned, Deserializer, Error as _};
use serde::Deserialize;

/// Deserialize a value that may have been provided as a JSON-encoded string
/// instead of the structured value.
///
/// Some models occasionally stringify nested arguments, so we accept either form.
/// This is used as a serde field attribute:
///
/// ```rust,ignore
/// #[derive(Deserialize)]
/// struct ToolInput {
///     #[serde(deserialize_with = "deserialize_maybe_stringified")]
///     content: MyStruct,
/// }
/// ```
pub fn deserialize_maybe_stringified<'de, T, D>(deserializer: D) -> Result<T, D::Error>
where
    T: DeserializeOwned,
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ValueOrJsonString<T> {
        Value(T),
        String(String),
    }

    match ValueOrJsonString::<T>::deserialize(deserializer)? {
        ValueOrJsonString::Value(value) => Ok(value),
        ValueOrJsonString::String(string) => serde_json::from_str::<T>(&string).map_err(|error| {
            D::Error::custom(format!("failed to parse stringified value: {error}"))
        }),
    }
}

/// Like `deserialize_maybe_stringified` but for `Option<T>` fields.
///
/// Handles:
/// - `null` / missing → `None`
/// - Structured value → `Some(T)`
/// - JSON string → parse and return `Some(T)`
pub fn deserialize_maybe_stringified_option<'de, T, D>(
    deserializer: D,
) -> Result<Option<T>, D::Error>
where
    T: DeserializeOwned,
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ValueOrJsonString<T> {
        Null,
        Value(T),
        String(String),
    }

    // First try to deserialize as Option
    let opt: Option<serde_json::Value> = Option::deserialize(deserializer)?;

    match opt {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => {
            // Try to parse the string as JSON
            match serde_json::from_str::<T>(&s) {
                Ok(value) => Ok(Some(value)),
                Err(e) => Err(D::Error::custom(format!(
                    "failed to parse stringified optional value: {e}"
                ))),
            }
        }
        Some(value) => {
            let parsed = serde_json::from_value::<T>(value).map_err(|e| {
                D::Error::custom(format!("failed to parse value: {e}"))
            })?;
            Ok(Some(parsed))
        }
    }
}

/// Deserialize a value that might be a number encoded as a string.
///
/// Handles cases where models return `"42"` instead of `42`.
pub fn deserialize_maybe_stringified_number<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum NumberOrString {
        Number(u64),
        String(String),
    }

    match NumberOrString::deserialize(deserializer)? {
        NumberOrString::Number(n) => Ok(n),
        NumberOrString::String(s) => s.parse::<u64>().map_err(|e| {
            D::Error::custom(format!("failed to parse stringified number: {e}"))
        }),
    }
}

/// Deserialize a boolean that might be encoded as a string ("true"/"false").
pub fn deserialize_maybe_stringified_bool<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum BoolOrString {
        Bool(bool),
        String(String),
    }

    match BoolOrString::deserialize(deserializer)? {
        BoolOrString::Bool(b) => Ok(b),
        BoolOrString::String(s) => match s.to_lowercase().as_str() {
            "true" | "1" | "yes" => Ok(true),
            "false" | "0" | "no" => Ok(false),
            _ => Err(D::Error::custom(format!(
                "failed to parse stringified bool: '{s}'"
            ))),
        },
    }
}

/// Normalize tool call arguments from an LLM response.
///
/// Handles the case where the entire `arguments` field is a JSON string
/// instead of a JSON object. Returns the parsed Value in either case.
pub fn normalize_tool_arguments(raw: &serde_json::Value) -> serde_json::Value {
    match raw {
        serde_json::Value::String(s) => {
            serde_json::from_str(s).unwrap_or_else(|_| raw.clone())
        }
        other => other.clone(),
    }
}

/// Parse tool call input, handling both structured and stringified forms.
///
/// This is the main entry point for parsing tool inputs from LLM responses.
/// It first normalizes the arguments (handling stringification), then
/// deserializes into the target type.
pub fn parse_tool_input<T: DeserializeOwned>(
    raw_input: &serde_json::Value,
) -> Result<T, String> {
    let normalized = normalize_tool_arguments(raw_input);
    serde_json::from_value(normalized).map_err(|e| {
        format!("Failed to parse tool input: {e}")
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Inner {
        key: String,
        value: u32,
    }

    #[derive(Debug, Deserialize, PartialEq)]
    struct TestStruct {
        name: String,
        #[serde(deserialize_with = "deserialize_maybe_stringified")]
        data: Inner,
    }

    #[test]
    fn test_structured_value() {
        let json = r#"{"name": "test", "data": {"key": "hello", "value": 42}}"#;
        let result: TestStruct = serde_json::from_str(json).unwrap();
        assert_eq!(result.name, "test");
        assert_eq!(result.data.key, "hello");
        assert_eq!(result.data.value, 42);
    }

    #[test]
    fn test_stringified_value() {
        let json = r#"{"name": "test", "data": "{\"key\": \"hello\", \"value\": 42}"}"#;
        let result: TestStruct = serde_json::from_str(json).unwrap();
        assert_eq!(result.name, "test");
        assert_eq!(result.data.key, "hello");
        assert_eq!(result.data.value, 42);
    }

    #[derive(Debug, Deserialize, PartialEq)]
    struct OptionalStruct {
        name: String,
        #[serde(
            default,
            deserialize_with = "deserialize_maybe_stringified_option"
        )]
        data: Option<Inner>,
    }

    #[test]
    fn test_optional_null() {
        let json = r#"{"name": "test", "data": null}"#;
        let result: OptionalStruct = serde_json::from_str(json).unwrap();
        assert_eq!(result.data, None);
    }

    #[test]
    fn test_optional_structured() {
        let json = r#"{"name": "test", "data": {"key": "hi", "value": 1}}"#;
        let result: OptionalStruct = serde_json::from_str(json).unwrap();
        assert_eq!(result.data.unwrap().key, "hi");
    }

    #[test]
    fn test_optional_stringified() {
        let json = r#"{"name": "test", "data": "{\"key\": \"hi\", \"value\": 1}"}"#;
        let result: OptionalStruct = serde_json::from_str(json).unwrap();
        assert_eq!(result.data.unwrap().key, "hi");
    }

    #[test]
    fn test_normalize_tool_arguments_object() {
        let input = serde_json::json!({"path": "/src/main.rs"});
        let result = normalize_tool_arguments(&input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_normalize_tool_arguments_string() {
        let input = serde_json::json!(r#"{"path": "/src/main.rs"}"#);
        let result = normalize_tool_arguments(&input);
        assert_eq!(result, serde_json::json!({"path": "/src/main.rs"}));
    }

    #[test]
    fn test_normalize_tool_arguments_invalid_string() {
        let input = serde_json::json!("not valid json {{{");
        let result = normalize_tool_arguments(&input);
        // Falls back to original value
        assert_eq!(result, input);
    }

    #[test]
    fn test_parse_tool_input() {
        #[derive(Debug, Deserialize, PartialEq)]
        struct EditInput {
            path: String,
            content: String,
        }

        // Structured
        let input = serde_json::json!({"path": "/a.rs", "content": "fn main() {}"});
        let result: EditInput = parse_tool_input(&input).unwrap();
        assert_eq!(result.path, "/a.rs");

        // Stringified
        let input = serde_json::json!(r#"{"path": "/a.rs", "content": "fn main() {}"}"#);
        let result: EditInput = parse_tool_input(&input).unwrap();
        assert_eq!(result.path, "/a.rs");
    }

    #[derive(Debug, Deserialize)]
    struct NumberStruct {
        #[serde(deserialize_with = "deserialize_maybe_stringified_number")]
        count: u64,
    }

    #[test]
    fn test_number_as_number() {
        let json = r#"{"count": 42}"#;
        let result: NumberStruct = serde_json::from_str(json).unwrap();
        assert_eq!(result.count, 42);
    }

    #[test]
    fn test_number_as_string() {
        let json = r#"{"count": "42"}"#;
        let result: NumberStruct = serde_json::from_str(json).unwrap();
        assert_eq!(result.count, 42);
    }

    #[derive(Debug, Deserialize)]
    struct BoolStruct {
        #[serde(deserialize_with = "deserialize_maybe_stringified_bool")]
        flag: bool,
    }

    #[test]
    fn test_bool_as_bool() {
        let json = r#"{"flag": true}"#;
        let result: BoolStruct = serde_json::from_str(json).unwrap();
        assert!(result.flag);
    }

    #[test]
    fn test_bool_as_string() {
        let json = r#"{"flag": "true"}"#;
        let result: BoolStruct = serde_json::from_str(json).unwrap();
        assert!(result.flag);

        let json = r#"{"flag": "false"}"#;
        let result: BoolStruct = serde_json::from_str(json).unwrap();
        assert!(!result.flag);
    }
}
