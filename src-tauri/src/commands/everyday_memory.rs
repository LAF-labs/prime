//! The facts the everyday assistant remembers about its user.
//!
//! In simple mode the bundled gate extension registers a `remember` tool that
//! appends stable facts about the user to `~/.laf-agent/memories.json`, and
//! every turn's system prompt carries them. Anything that silently shapes what
//! the model is told has to be visible and removable, so this module is the
//! read/delete half of that store — the agent writes it, the settings panel
//! reads and prunes it.
//!
//! Two properties matter here. Reads never fail: a missing file is a user with
//! no memories yet, and a damaged one must not wedge the settings panel — both
//! read as an empty list, exactly as the gate's own `loadMemories` treats them.
//! Writes never truncate: the file is written to a sibling temp file, fsynced,
//! and renamed over the original, so a crash mid-write leaves the previous
//! memories intact rather than a half-written array the gate would silently
//! drop.

use crate::commands::error::AppError;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// One remembered fact, in the shape the gate extension writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Memory {
    pub fact: String,
    /// ISO-8601 timestamp of when it was remembered. Defaulted rather than
    /// required: a fact with no date is still a fact the user should see.
    #[serde(default)]
    pub at: String,
}

fn memories_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Other("no home directory".into()))?;
    Ok(home.join(".laf-agent").join("memories.json"))
}

/// Read the store, tolerating every way it can be unreadable.
///
/// Entry-by-entry filtering rather than `from_str::<Vec<Memory>>` is
/// deliberate: one malformed element should cost the user that element, not
/// the whole list.
fn list_at(path: &Path) -> Vec<Memory> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let fact = item.get("fact")?.as_str()?;
            let at = item.get("at").and_then(|a| a.as_str()).unwrap_or_default();
            Some(Memory { fact: fact.to_string(), at: at.to_string() })
        })
        .collect()
}

/// Serialize with the tab indentation the gate's `JSON.stringify(…, "\t")`
/// produces, so the app and the agent do not rewrite each other's formatting.
fn encode(memories: &[Memory]) -> Result<Vec<u8>, AppError> {
    let mut buf = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"\t");
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    memories.serialize(&mut ser)?;
    buf.push(b'\n');
    Ok(buf)
}

/// Temp file + fsync + rename. See the module docs for why.
fn write_at(path: &Path, memories: &[Memory]) -> Result<(), AppError> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Other("memories path has no parent directory".into()))?;
    std::fs::create_dir_all(dir)?;

    let body = encode(memories)?;
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    // Scoped so the handle is closed before the rename — Windows refuses to
    // rename a file that is still open.
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(&body)?;
        file.sync_all()?;
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Remove the entry whose fact matches exactly. A miss is a no-op, and a
/// missing file stays missing rather than becoming an empty array.
fn delete_at(path: &Path, fact: &str) -> Result<(), AppError> {
    let memories = list_at(path);
    let before = memories.len();
    let remaining: Vec<Memory> = memories.into_iter().filter(|m| m.fact != fact).collect();
    if remaining.len() == before {
        return Ok(());
    }
    write_at(path, &remaining)
}

/// Forget everything: the file itself goes, not just its contents. Leaving an
/// empty array behind would be the same information-free result with one more
/// artifact on disk.
fn clear_at(path: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn everyday_memories_list() -> Result<Vec<Memory>, AppError> {
    Ok(list_at(&memories_path()?))
}

#[tauri::command]
pub fn everyday_memory_delete(fact: String) -> Result<(), AppError> {
    delete_at(&memories_path()?, &fact)
}

#[tauri::command]
pub fn everyday_memories_clear() -> Result<(), AppError> {
    clear_at(&memories_path()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory(fact: &str) -> Memory {
        Memory { fact: fact.to_string(), at: "2026-08-09T10:00:00.000Z".to_string() }
    }

    fn store(contents: Option<&str>) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("memories.json");
        if let Some(text) = contents {
            std::fs::write(&path, text).expect("write");
        }
        (dir, path)
    }

    #[test]
    fn writes_and_reads_back_the_same_memories() {
        let (_d, path) = store(None);
        let written = vec![memory("The user is called Gibeom"), memory("Prefers Korean")];
        write_at(&path, &written).expect("write");
        assert_eq!(list_at(&path), written);
    }

    #[test]
    fn the_written_file_is_what_the_gate_would_read() {
        let (_d, path) = store(None);
        write_at(&path, &[memory("Lives in Dubai")]).expect("write");
        let text = std::fs::read_to_string(&path).expect("read");
        assert!(text.ends_with('\n'), "the gate writes a trailing newline");
        let parsed: serde_json::Value = serde_json::from_str(&text).expect("valid json");
        assert_eq!(parsed[0]["fact"], "Lives in Dubai");
        assert_eq!(parsed[0]["at"], "2026-08-09T10:00:00.000Z");
    }

    /// A user who has never been remembered has no file. That is not an error.
    #[test]
    fn a_missing_file_reads_as_no_memories() {
        let (_d, path) = store(None);
        assert!(list_at(&path).is_empty());
    }

    #[test]
    fn a_corrupt_file_reads_as_no_memories() {
        let (_d, path) = store(Some(r#"[{"fact":"half writ"#));
        assert!(list_at(&path).is_empty());
    }

    /// The gate always writes an array; anything else is not this store.
    #[test]
    fn a_non_array_file_reads_as_no_memories() {
        let (_d, path) = store(Some(r#"{"fact":"not in an array"}"#));
        assert!(list_at(&path).is_empty());
    }

    /// One junk element must not cost the user the memories around it.
    #[test]
    fn entries_without_a_fact_are_skipped_not_fatal() {
        let (_d, path) = store(Some(r#"[{"at":"x"},{"fact":"kept","at":"y"},7]"#));
        let listed = list_at(&path);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].fact, "kept");
    }

    /// The gate has written entries without `at` in the past; show them anyway.
    #[test]
    fn an_entry_without_a_date_still_lists() {
        let (_d, path) = store(Some(r#"[{"fact":"dateless"}]"#));
        let listed = list_at(&path);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].at, "");
    }

    #[test]
    fn delete_removes_only_the_exact_match() {
        let (_d, path) = store(None);
        write_at(&path, &[memory("keep me"), memory("drop me"), memory("keep me too")])
            .expect("write");
        delete_at(&path, "drop me").expect("delete");
        let facts: Vec<String> = list_at(&path).into_iter().map(|m| m.fact).collect();
        assert_eq!(facts, vec!["keep me".to_string(), "keep me too".to_string()]);
    }

    #[test]
    fn deleting_a_fact_that_is_not_there_changes_nothing() {
        let (_d, path) = store(None);
        write_at(&path, &[memory("only one")]).expect("write");
        delete_at(&path, "never remembered").expect("delete");
        assert_eq!(list_at(&path), vec![memory("only one")]);
    }

    /// Deleting against a store that does not exist must not create one.
    #[test]
    fn deleting_from_a_missing_file_succeeds_without_creating_it() {
        let (_d, path) = store(None);
        delete_at(&path, "anything").expect("delete");
        assert!(!path.exists(), "a no-op delete must not write a file");
    }

    #[test]
    fn clear_removes_the_file_entirely() {
        let (_d, path) = store(None);
        write_at(&path, &[memory("a"), memory("b")]).expect("write");
        clear_at(&path).expect("clear");
        assert!(!path.exists());
        assert!(list_at(&path).is_empty());
    }

    #[test]
    fn clearing_an_empty_store_is_not_an_error() {
        let (_d, path) = store(None);
        clear_at(&path).expect("clear");
    }

    /// The parent directory is created on demand — the gate may never have run.
    #[test]
    fn write_creates_the_directory_when_it_is_absent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("nested").join(".laf-agent").join("memories.json");
        write_at(&path, &[memory("first ever")]).expect("write");
        assert_eq!(list_at(&path).len(), 1);
    }

    /// The whole point of the rename dance: no temp file survives a write.
    #[test]
    fn writing_leaves_no_temp_file_behind() {
        let (dir, path) = store(None);
        write_at(&path, &[memory("a")]).expect("write");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .expect("read_dir")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name != "memories.json")
            .collect();
        assert!(leftovers.is_empty(), "unexpected leftovers: {leftovers:?}");
    }
}
