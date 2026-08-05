//! Pattern extraction — extract code signatures for agent context.
//!
//! Extracts function/class/type signatures from source files to provide
//! lightweight context to the agent without sending entire file contents.
//! This reduces token usage while maintaining structural awareness.
//!
//! Uses file-extension-based language detection and line-by-line pattern
//! matching to extract declarations. For languages without a dedicated
//! extractor, falls back to generic function-like pattern detection.

use serde::Serialize;
use std::path::Path;

use super::error::AppError;

/// A single extracted symbol from a source file.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedSymbol {
    /// Symbol name (e.g. "MyClass", "handle_request").
    pub name: String,
    /// Symbol kind (function, class, interface, type, struct, enum, trait, const).
    pub kind: String,
    /// The signature line(s) — just the declaration, not the body.
    pub signature: String,
    /// 1-indexed line number where the symbol starts.
    pub line: u32,
    /// Whether this is exported/public.
    pub is_public: bool,
}

/// Result of extracting patterns from a file.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FilePatterns {
    pub path: String,
    pub language: String,
    pub symbols: Vec<ExtractedSymbol>,
    /// Total lines in the file (for context).
    pub total_lines: u32,
}

/// Maximum file size to process (2 MB). Larger files (generated code,
/// minified bundles) are skipped to avoid excessive memory usage.
const MAX_FILE_SIZE: u64 = 2_000_000;

/// Extract code patterns/signatures from a source file.
#[tauri::command]
pub fn extract_patterns(file_path: String) -> Result<FilePatterns, AppError> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::Other(format!("File not found: {file_path}")));
    }

    // Skip very large files (generated code, minified bundles, etc.)
    let metadata = std::fs::metadata(path)
        .map_err(|e| AppError::Other(format!("Failed to stat file: {e}")))?;
    if metadata.len() > MAX_FILE_SIZE {
        let language = detect_language(path);
        return Ok(FilePatterns {
            path: file_path,
            language,
            symbols: vec![],
            total_lines: 0,
        });
    }

    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::Other(format!("Failed to read file: {e}")))?;

    let language = detect_language(path);
    let total_lines = content.lines().count() as u32;
    let symbols = extract_symbols(&content, &language);

    Ok(FilePatterns {
        path: file_path,
        language,
        symbols,
        total_lines,
    })
}

/// Extract patterns from multiple files (batch operation for workspace context).
#[tauri::command]
pub fn extract_patterns_batch(file_paths: Vec<String>) -> Result<Vec<FilePatterns>, AppError> {
    let mut results = Vec::with_capacity(file_paths.len());
    for path in file_paths {
        match extract_patterns(path) {
            Ok(patterns) => results.push(patterns),
            Err(_) => continue, // Skip files that can't be read
        }
    }
    Ok(results)
}

// ── Language detection ───────────────────────────────────────────────────

fn detect_language(path: &Path) -> String {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    match ext {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" => "python",
        "go" => "go",
        "rb" => "ruby",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "zig" => "zig",
        "lua" => "lua",
        "ex" | "exs" => "elixir",
        _ => "unknown",
    }
    .to_string()
}

// ── Symbol extraction ────────────────────────────────────────────────────

fn extract_symbols(content: &str, language: &str) -> Vec<ExtractedSymbol> {
    match language {
        "rust" => extract_rust_symbols(content),
        "typescript" | "javascript" => extract_ts_symbols(content),
        "python" => extract_python_symbols(content),
        "go" => extract_go_symbols(content),
        _ => extract_generic_symbols(content),
    }
}

fn extract_rust_symbols(content: &str) -> Vec<ExtractedSymbol> {
    let mut symbols = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        let is_public = trimmed.starts_with("pub ");

        // Functions
        if let Some(sig) = extract_rust_fn(trimmed) {
            symbols.push(ExtractedSymbol {
                name: sig.0,
                kind: "function".to_string(),
                signature: sig.1,
                line: (line_idx + 1) as u32,
                is_public,
            });
        }
        // Structs
        else if trimmed.starts_with("pub struct ") || trimmed.starts_with("struct ") {
            if let Some(name) = extract_word_after(trimmed, "struct ") {
                symbols.push(ExtractedSymbol {
                    name: name.clone(),
                    kind: "struct".to_string(),
                    signature: trimmed.trim_end_matches('{').trim().to_string(),
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Enums
        else if trimmed.starts_with("pub enum ") || trimmed.starts_with("enum ") {
            if let Some(name) = extract_word_after(trimmed, "enum ") {
                symbols.push(ExtractedSymbol {
                    name: name.clone(),
                    kind: "enum".to_string(),
                    signature: trimmed.trim_end_matches('{').trim().to_string(),
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Traits
        else if trimmed.starts_with("pub trait ") || trimmed.starts_with("trait ") {
            if let Some(name) = extract_word_after(trimmed, "trait ") {
                symbols.push(ExtractedSymbol {
                    name: name.clone(),
                    kind: "trait".to_string(),
                    signature: trimmed.trim_end_matches('{').trim().to_string(),
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Impl blocks
        else if trimmed.starts_with("impl ") || trimmed.starts_with("impl<") {
            let sig = trimmed.trim_end_matches('{').trim().to_string();
            let after_impl = sig.strip_prefix("impl").unwrap_or(&sig).trim_start();
            // Skip generic params: impl<T: Clone> MyStruct<T> → MyStruct
            let after_generics = if after_impl.starts_with('<') {
                // Find matching '>' accounting for nested generics
                let mut depth = 0;
                let mut end = 0;
                for (i, ch) in after_impl.chars().enumerate() {
                    match ch {
                        '<' => depth += 1,
                        '>' => {
                            depth -= 1;
                            if depth == 0 {
                                end = i + 1;
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                after_impl[end..].trim_start()
            } else {
                after_impl
            };
            let name = after_generics
                .split(|c: char| c == '<' || c == ' ' || c == '{')
                .next()
                .unwrap_or("impl")
                .to_string();
            symbols.push(ExtractedSymbol {
                name: if name.is_empty() { "impl".to_string() } else { name },
                kind: "impl".to_string(),
                signature: sig,
                line: (line_idx + 1) as u32,
                is_public: false,
            });
        }
        // Type aliases
        else if trimmed.starts_with("pub type ") || trimmed.starts_with("type ") {
            if let Some(name) = extract_word_after(trimmed, "type ") {
                symbols.push(ExtractedSymbol {
                    name: name.clone(),
                    kind: "type".to_string(),
                    signature: trimmed.trim_end_matches(';').trim().to_string(),
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Constants
        else if trimmed.starts_with("pub const ") || trimmed.starts_with("const ") {
            if let Some(name) = extract_word_after(trimmed, "const ") {
                if name != "_" && name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                    symbols.push(ExtractedSymbol {
                        name: name.clone(),
                        kind: "const".to_string(),
                        signature: trimmed.split('=').next().unwrap_or(trimmed).trim().to_string(),
                        line: (line_idx + 1) as u32,
                        is_public,
                    });
                }
            }
        }
    }

    symbols
}

fn extract_rust_fn(line: &str) -> Option<(String, String)> {
    let stripped = line
        .strip_prefix("pub ")
        .or_else(|| line.strip_prefix("pub(crate) "))
        .or_else(|| line.strip_prefix("pub(super) "))
        .unwrap_or(line);

    let stripped = stripped
        .strip_prefix("async ")
        .unwrap_or(stripped);
    let stripped = stripped
        .strip_prefix("unsafe ")
        .unwrap_or(stripped);
    let stripped = stripped
        .strip_prefix("const ")
        .unwrap_or(stripped);

    if !stripped.starts_with("fn ") {
        return None;
    }

    let after_fn = &stripped[3..];
    let name_end = after_fn.find(|c: char| c == '(' || c == '<' || c.is_whitespace())?;
    let name = after_fn[..name_end].to_string();

    if name.is_empty() {
        return None;
    }

    // Build signature up to the opening brace
    let sig = line.split('{').next().unwrap_or(line).trim().to_string();
    Some((name, sig))
}

fn extract_ts_symbols(content: &str) -> Vec<ExtractedSymbol> {
    let mut symbols = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        let is_public = trimmed.starts_with("export ");

        // Functions
        if trimmed.contains("function ") && (trimmed.starts_with("export ") || trimmed.starts_with("function ") || trimmed.starts_with("async function ") || trimmed.starts_with("export async function ") || trimmed.starts_with("export default function ")) {
            if let Some(name) = extract_word_after(trimmed, "function ") {
                let sig = trimmed.split('{').next().unwrap_or(trimmed).trim().to_string();
                symbols.push(ExtractedSymbol {
                    name,
                    kind: "function".to_string(),
                    signature: sig,
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Arrow function assignments (const foo = ...)
        else if (trimmed.starts_with("export const ") || trimmed.starts_with("const "))
            && (trimmed.contains(" = (") || trimmed.contains(" = async ("))
        {
            if let Some(name) = extract_word_after(trimmed, "const ") {
                let sig = trimmed.split('=').next().unwrap_or(trimmed).trim().to_string();
                symbols.push(ExtractedSymbol {
                    name,
                    kind: "function".to_string(),
                    signature: sig,
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Classes
        else if trimmed.contains("class ") && (trimmed.starts_with("export ") || trimmed.starts_with("class ") || trimmed.starts_with("abstract class ") || trimmed.starts_with("export abstract class ")) {
            if let Some(name) = extract_word_after(trimmed, "class ") {
                let sig = trimmed.split('{').next().unwrap_or(trimmed).trim().to_string();
                symbols.push(ExtractedSymbol {
                    name,
                    kind: "class".to_string(),
                    signature: sig,
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Interfaces
        else if trimmed.starts_with("export interface ") || trimmed.starts_with("interface ") {
            if let Some(name) = extract_word_after(trimmed, "interface ") {
                let sig = trimmed.split('{').next().unwrap_or(trimmed).trim().to_string();
                symbols.push(ExtractedSymbol {
                    name,
                    kind: "interface".to_string(),
                    signature: sig,
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Type aliases
        else if trimmed.starts_with("export type ") || trimmed.starts_with("type ") {
            if let Some(name) = extract_word_after(trimmed, "type ") {
                if !name.starts_with('{') {
                    let sig = trimmed.split('=').next().unwrap_or(trimmed).trim().to_string();
                    symbols.push(ExtractedSymbol {
                        name,
                        kind: "type".to_string(),
                        signature: sig,
                        line: (line_idx + 1) as u32,
                        is_public,
                    });
                }
            }
        }
        // Enums
        else if trimmed.starts_with("export enum ") || trimmed.starts_with("enum ") {
            if let Some(name) = extract_word_after(trimmed, "enum ") {
                symbols.push(ExtractedSymbol {
                    name,
                    kind: "enum".to_string(),
                    signature: trimmed.split('{').next().unwrap_or(trimmed).trim().to_string(),
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
    }

    symbols
}

fn extract_python_symbols(content: &str) -> Vec<ExtractedSymbol> {
    let mut symbols = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        let indent = line.len() - line.trim_start().len();

        // Functions/methods
        if trimmed.starts_with("def ") || trimmed.starts_with("async def ") {
            let after_def = if trimmed.starts_with("async def ") {
                &trimmed[10..]
            } else {
                &trimmed[4..]
            };
            if let Some(paren) = after_def.find('(') {
                let name = after_def[..paren].to_string();
                let sig = trimmed.trim_end_matches(':').to_string();
                let kind = if indent > 0 { "method" } else { "function" };
                let is_public = !name.starts_with('_') || name.starts_with("__");
                symbols.push(ExtractedSymbol {
                    name,
                    kind: kind.to_string(),
                    signature: sig,
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
        // Classes
        else if trimmed.starts_with("class ") {
            let after_class = &trimmed[6..];
            let name_end = after_class.find(|c: char| c == '(' || c == ':').unwrap_or(after_class.len());
            let name = after_class[..name_end].trim().to_string();
            let sig = trimmed.trim_end_matches(':').to_string();
            let is_pub = !name.starts_with('_');
            symbols.push(ExtractedSymbol {
                name,
                kind: "class".to_string(),
                signature: sig,
                line: (line_idx + 1) as u32,
                is_public: is_pub,
            });
        }
    }

    symbols
}

fn extract_go_symbols(content: &str) -> Vec<ExtractedSymbol> {
    let mut symbols = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        // Functions
        if trimmed.starts_with("func ") {
            let after_func = &trimmed[5..];
            // Method (has receiver)
            if after_func.starts_with('(') {
                if let Some(close_paren) = after_func.find(") ") {
                    let after_receiver = &after_func[close_paren + 2..];
                    if let Some(paren) = after_receiver.find('(') {
                        let name = after_receiver[..paren].to_string();
                        let is_public = name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false);
                        let sig = trimmed.split('{').next().unwrap_or(trimmed).trim().to_string();
                        symbols.push(ExtractedSymbol {
                            name,
                            kind: "method".to_string(),
                            signature: sig,
                            line: (line_idx + 1) as u32,
                            is_public,
                        });
                    }
                }
            } else {
                // Regular function
                if let Some(paren) = after_func.find('(') {
                    let name = after_func[..paren].to_string();
                    let is_public = name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false);
                    let sig = trimmed.split('{').next().unwrap_or(trimmed).trim().to_string();
                    symbols.push(ExtractedSymbol {
                        name,
                        kind: "function".to_string(),
                        signature: sig,
                        line: (line_idx + 1) as u32,
                        is_public,
                    });
                }
            }
        }
        // Types
        else if trimmed.starts_with("type ") {
            if let Some(name) = extract_word_after(trimmed, "type ") {
                let kind = if trimmed.contains(" struct") {
                    "struct"
                } else if trimmed.contains(" interface") {
                    "interface"
                } else {
                    "type"
                };
                let is_public = name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false);
                let sig = trimmed.split('{').next().unwrap_or(trimmed).trim().to_string();
                symbols.push(ExtractedSymbol {
                    name,
                    kind: kind.to_string(),
                    signature: sig,
                    line: (line_idx + 1) as u32,
                    is_public,
                });
            }
        }
    }

    symbols
}

fn extract_generic_symbols(content: &str) -> Vec<ExtractedSymbol> {
    let mut symbols = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        // Look for common function-like patterns
        if (trimmed.starts_with("function ") || trimmed.starts_with("def ") || trimmed.starts_with("fn "))
            && trimmed.contains('(')
        {
            let keyword_end = trimmed.find(' ').unwrap_or(0) + 1;
            let after_keyword = &trimmed[keyword_end..];
            if let Some(paren) = after_keyword.find('(') {
                let name = after_keyword[..paren].trim().to_string();
                if !name.is_empty() {
                    symbols.push(ExtractedSymbol {
                        name,
                        kind: "function".to_string(),
                        signature: trimmed.split('{').next().unwrap_or(trimmed).trim().to_string(),
                        line: (line_idx + 1) as u32,
                        is_public: true,
                    });
                }
            }
        }
    }

    symbols
}

// ── Helpers ──────────────────────────────────────────────────────────────

/// Extract the first word after a keyword in a line.
fn extract_word_after(line: &str, keyword: &str) -> Option<String> {
    let after = line.split(keyword).nth(1)?;
    let word_end = after.find(|c: char| !c.is_alphanumeric() && c != '_')?;
    let word = &after[..word_end];
    if word.is_empty() {
        None
    } else {
        Some(word.to_string())
    }
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_rust_fn_basic() {
        let result = extract_rust_fn("pub fn hello(name: &str) -> String {");
        assert_eq!(result, Some(("hello".to_string(), "pub fn hello(name: &str) -> String".to_string())));
    }

    #[test]
    fn extract_rust_fn_async() {
        let result = extract_rust_fn("pub async fn fetch_data(url: &str) -> Result<String, Error> {");
        assert_eq!(result.unwrap().0, "fetch_data");
    }

    #[test]
    fn extract_rust_fn_generic() {
        let result = extract_rust_fn("fn process<T: Display>(item: T) {");
        assert_eq!(result.unwrap().0, "process");
    }

    #[test]
    fn extract_rust_symbols_full() {
        let code = r#"
pub struct MyStruct {
    field: String,
}

pub enum Status {
    Active,
    Inactive,
}

pub trait Handler {
    fn handle(&self);
}

impl MyStruct {
    pub fn new() -> Self {
        Self { field: String::new() }
    }

    pub async fn process(&self) -> Result<(), Error> {
        Ok(())
    }
}

pub const MAX_SIZE: usize = 1024;
"#;
        let symbols = extract_rust_symbols(code);
        let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"MyStruct"));
        assert!(names.contains(&"Status"));
        assert!(names.contains(&"Handler"));
        assert!(names.contains(&"new"));
        assert!(names.contains(&"process"));
        assert!(names.contains(&"MAX_SIZE"));
    }

    #[test]
    fn extract_ts_symbols_full() {
        let code = r#"
export interface UserService {
    getUser(id: string): Promise<User>;
}

export class AuthController {
    constructor(private service: UserService) {}
}

export type UserId = string;

export const handleRequest = async (req: Request) => {
    return new Response();
};

export function createApp(config: Config): App {
    return new App(config);
}

export enum Role {
    Admin,
    User,
}
"#;
        let symbols = extract_ts_symbols(code);
        let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"UserService"));
        assert!(names.contains(&"AuthController"));
        assert!(names.contains(&"UserId"));
        assert!(names.contains(&"handleRequest"));
        assert!(names.contains(&"createApp"));
        assert!(names.contains(&"Role"));
    }

    #[test]
    fn extract_python_symbols_full() {
        let code = r#"
class MyClass:
    def __init__(self, name: str):
        self.name = name

    def process(self) -> None:
        pass

    async def fetch(self, url: str) -> str:
        return ""

def helper_function(x: int) -> int:
    return x * 2
"#;
        let symbols = extract_python_symbols(code);
        let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"MyClass"));
        assert!(names.contains(&"__init__"));
        assert!(names.contains(&"process"));
        assert!(names.contains(&"fetch"));
        assert!(names.contains(&"helper_function"));
    }

    #[test]
    fn detect_language_from_extension() {
        assert_eq!(detect_language(Path::new("main.rs")), "rust");
        assert_eq!(detect_language(Path::new("app.tsx")), "typescript");
        assert_eq!(detect_language(Path::new("server.py")), "python");
        assert_eq!(detect_language(Path::new("main.go")), "go");
        assert_eq!(detect_language(Path::new("unknown.xyz")), "unknown");
    }
}
