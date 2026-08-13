//! The knowledge base, read for display.
//!
//! The gate extension writes distilled markdown notes into
//! `~/.laf-agent/knowledge/` — one file per note, `[[note-name]]` references
//! between them. The agent is the writer; this module is the reader the graph
//! view uses: it scans the folder once and returns every note's name, title,
//! link list and a little metadata, which is exactly the node-and-edge list a
//! force layout needs.
//!
//! Same posture as `everyday_memory`: reads never fail. A missing folder is a
//! user who has not saved knowledge yet, and one unreadable file must not take
//! the whole graph down — both degrade to "fewer notes", never to an error.

use crate::commands::error::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeNote {
    /// The slug — the filename without `.md`, and what `[[links]]` point at.
    pub name: String,
    /// First `#` heading, for display; falls back to the name.
    pub title: String,
    /// `updated:` line if the note carries one.
    pub updated: Option<String>,
    /// Outgoing `[[links]]`, deduplicated, in order of first appearance.
    pub links: Vec<String>,
    /// Body length in characters — the graph scales nodes by substance.
    pub chars: usize,
}

fn knowledge_dir() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Other("no home directory".into()))?;
    Ok(home.join(".laf-agent").join("knowledge"))
}

/// Every `[[link]]` in the text, deduplicated, first-appearance order.
fn extract_links(text: &str) -> Vec<String> {
    let mut links: Vec<String> = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let link = after[..end].trim();
        // A link is a note name: short, no newlines. Anything else is the
        // model quoting markdown syntax, not a reference.
        if !link.is_empty() && link.len() <= 160 && !link.contains('\n') {
            let owned = link.to_string();
            if !links.contains(&owned) {
                links.push(owned);
            }
        }
        rest = &after[end + 2..];
    }
    links
}

fn first_heading(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|l| l.starts_with('#'))
        .map(|l| l.trim_start_matches('#').trim().to_string())
        .filter(|t| !t.is_empty())
}

fn updated_line(text: &str) -> Option<String> {
    text.lines()
        .take(5)
        .map(str::trim)
        .find_map(|l| l.strip_prefix("updated:").map(|v| v.trim().to_string()))
        .filter(|v| !v.is_empty())
}

fn read_notes_in(dir: &Path) -> Vec<KnowledgeNote> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut notes: Vec<KnowledgeNote> = entries
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_stem()?.to_str()?.to_string();
            if path.extension()?.to_str()? != "md" {
                return None;
            }
            let text = std::fs::read_to_string(&path).ok()?;
            Some(KnowledgeNote {
                title: first_heading(&text).unwrap_or_else(|| name.clone()),
                updated: updated_line(&text),
                links: extract_links(&text),
                chars: text.chars().count(),
                name,
            })
        })
        .collect();
    // Stable order so the layout does not reshuffle between opens.
    notes.sort_by(|a, b| a.name.cmp(&b.name));
    notes
}

/// The full graph: every note with its outgoing links.
#[tauri::command]
pub async fn knowledge_graph() -> Result<Vec<KnowledgeNote>, AppError> {
    Ok(read_notes_in(&knowledge_dir()?))
}

/// One note's body, for the panel that opens when a node is clicked.
#[tauri::command]
pub async fn knowledge_note_body(name: String) -> Result<String, AppError> {
    // The name came from `knowledge_graph`, but never trust it as a path:
    // reject separators so `../` cannot leave the knowledge folder.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(AppError::Other("invalid note name".into()));
    }
    let path = knowledge_dir()?.join(format!("{name}.md"));
    std::fs::read_to_string(path).map_err(|_| AppError::Other("note not found".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(format!("{name}.md")), body).unwrap();
    }

    #[test]
    fn reads_notes_with_titles_links_and_dates() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "케이리뷰",
            "updated: 2026-08-14\n\n# 케이리뷰 (KReview)\n\n[[kreview-계약]] 참고. [[kreview-계약]] 중복은 한 번만.",
        );
        write(dir.path(), "kreview-계약", "# 계약\n\n본문");
        let notes = read_notes_in(dir.path());
        assert_eq!(notes.len(), 2);
        let kr = notes.iter().find(|n| n.name == "케이리뷰").unwrap();
        assert_eq!(kr.title, "케이리뷰 (KReview)");
        assert_eq!(kr.updated.as_deref(), Some("2026-08-14"));
        assert_eq!(kr.links, vec!["kreview-계약"]);
    }

    #[test]
    fn a_missing_folder_is_an_empty_graph_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let notes = read_notes_in(&dir.path().join("no-such"));
        assert!(notes.is_empty());
    }

    #[test]
    fn a_note_with_no_heading_uses_its_name() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "메모", "그냥 본문 뿐");
        let notes = read_notes_in(dir.path());
        assert_eq!(notes[0].title, "메모");
        assert!(notes[0].links.is_empty());
    }

    #[test]
    fn non_markdown_files_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "노트", "# 노트");
        std::fs::write(dir.path().join("stray.tmp"), "x").unwrap();
        assert_eq!(read_notes_in(dir.path()).len(), 1);
    }
}
