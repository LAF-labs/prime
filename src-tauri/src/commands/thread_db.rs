//! Thread Persistence with SQLite.
//!
//! Architecture:
//!
//! - **Background write queue**: All write operations are dispatched to a dedicated
//!   background thread via a `tokio::sync::mpsc` channel, preventing the Tauri
//!   command thread from blocking on disk I/O or lock contention.
//!
//! - **Transactions**: Multi-step mutations (e.g. delete_thread) are wrapped in
//!   explicit transactions for atomicity.
//!
//! - **Busy timeout**: `PRAGMA busy_timeout=5000` ensures transient lock contention
//!   (from WAL checkpointing or concurrent readers) is retried for up to 5 seconds
//!   before returning SQLITE_BUSY.
//!
//! - **Fallback in-memory DB**: If the file-based database cannot be opened (disk
//!   full, permissions, corruption), the system degrades gracefully to an in-memory
//!   database so the app remains functional.
//!
//! - **Incremental migrations**: Schema changes are expressed as an ordered array of
//!   SQL statements. Each migration runs exactly once, tracked by a version counter.
//!
//! - **Integrity checks**: On startup, `PRAGMA integrity_check` is run. If corruption
//!   is detected, the DB file is moved aside and a fresh one is created.
//!
//! The database is stored at the platform-standard app data directory:
//! - macOS: ~/Library/Application Support/rs.kirodex/threads.db
//! - Linux: ~/.local/share/kirodex/threads.db
//! - Windows: %APPDATA%/kirodex/threads.db

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

// ── Migrations ────────────────────────────────────────────────────────────────
//
// Each entry is applied exactly once, in order. To evolve the schema, append a
// new SQL string to this array. Never modify existing entries.

const MIGRATIONS: &[&str] = &[
    // Migration 0: Initial schema
    r#"
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    workspace TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    parent_thread_id TEXT,
    auto_approve INTEGER NOT NULL DEFAULT 0,
    metadata TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    thinking TEXT,
    tool_calls TEXT,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS thread_context (
    thread_id TEXT PRIMARY KEY NOT NULL,
    context_used INTEGER NOT NULL DEFAULT 0,
    context_size INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_threads_workspace ON threads(workspace);
CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
"#,
    // Future migrations go here, e.g.:
    // "ALTER TABLE threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
];

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbThread {
    pub id: String,
    pub name: String,
    pub workspace: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub parent_thread_id: Option<String>,
    pub auto_approve: bool,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbMessage {
    pub id: i64,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub thinking: Option<String>,
    pub tool_calls: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSearchResult {
    pub thread_id: String,
    pub thread_name: String,
    pub message_content: String,
    pub message_timestamp: String,
    pub rank: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStats {
    pub total_threads: u64,
    pub total_messages: u64,
    pub threads_by_workspace: Vec<(String, u64)>,
}

/// Metadata returned for each auto-archived thread so the frontend can update
/// its local state without re-fetching everything.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedThreadInfo {
    pub id: String,
    pub name: String,
    pub workspace: String,
    pub created_at: String,
    pub last_activity_at: String,
    pub message_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_task_id: Option<String>,
}

// ── Error Type ────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum ThreadDbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database unavailable: {0}")]
    Unavailable(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for ThreadDbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ── Write Queue (background writer) ───────────────────────────────────────────
//
// All mutations are serialized through a single background task that owns the
// connection. One writer thread per DB file, reads can happen concurrently
// via WAL.

/// A type-erased write operation. The closure embeds its own result channel,
/// so we don't need a separate ack channel — all responses flow through the
/// closure's captured `oneshot::Sender`.
type DbOperation = Box<dyn FnOnce(&rusqlite::Connection) + Send>;

enum WriteCommand {
    /// Execute a write operation on the background thread.
    Execute(DbOperation),
    /// Shutdown the background writer.
    Shutdown,
}

/// How the database connection is shared between readers and writers.
///
/// File-based databases use two separate connections (writer thread owns one,
/// readers share another via mutex). In-memory databases must use a single
/// shared connection because in-memory state is not visible across connections.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConnectionMode {
    /// Two connections — writer-owned + shared read connection.
    FileSeparate,
    /// Single shared connection (in-memory or fallback).
    SharedSingle,
}

// ── Database Connection ───────────────────────────────────────────────────────

/// Thread-safe database handle. Reads use a shared connection (protected by
/// Mutex for SQLite's threading model). Writes are dispatched to a dedicated
/// background task via a channel, ensuring serialized write access without
/// blocking the caller beyond the channel send.
pub struct ThreadDatabase {
    /// Shared connection for read operations. WAL mode allows concurrent reads
    /// even while the write queue is active.
    read_conn: Arc<std::sync::Mutex<rusqlite::Connection>>,
    /// Channel to the background write task.
    write_tx: mpsc::Sender<WriteCommand>,
    /// How the connection is shared (FileSeparate or SharedSingle).
    mode: ConnectionMode,
}

impl ThreadDatabase {
    /// Open or create the thread database at the default location.
    /// Falls back to an in-memory database if the file-based DB cannot be opened.
    ///
    /// Note: this method tracks whether the fallback path was taken so callers
    /// can surface a warning to the user.
    pub fn open() -> Self {
        match Self::try_open_file() {
            Ok(db) => db,
            Err(e) => {
                log::error!(
                    "Failed to open thread database, falling back to in-memory: {}",
                    e
                );
                Self::open_fallback()
            }
        }
    }

    /// Returns whether this instance is a SharedSingle connection (in-memory
    /// fallback or test). When true, persistence is not durable across restarts.
    #[allow(dead_code)]
    pub fn is_fallback(&self) -> bool {
        matches!(self.mode, ConnectionMode::SharedSingle)
    }

    /// Attempt to open the file-based database with full robustness checks.
    fn try_open_file() -> Result<Self, ThreadDbError> {
        let path = Self::db_path()?;

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Try to open the database
        let conn = match rusqlite::Connection::open(&path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Cannot open DB at {}: {}", path.display(), e);
                return Err(e.into());
            }
        };

        // Initialize PRAGMAs
        Self::initialize_connection(&conn)?;

        // Integrity check — if corrupted, move aside and recreate
        if !Self::check_integrity(&conn) {
            drop(conn);
            // Use a timestamped backup name so repeated corruptions don't clobber forensics
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let backup_path = path.with_extension(format!("db.corrupt.{}", timestamp));
            log::warn!(
                "Database corruption detected, moving to {} and recreating",
                backup_path.display()
            );
            let _ = std::fs::rename(&path, &backup_path);
            let conn = rusqlite::Connection::open(&path)?;
            Self::initialize_connection(&conn)?;
            Self::run_migrations(&conn)?;
            return Self::build_from_connection(conn, ConnectionMode::FileSeparate);
        }

        // Run migrations
        Self::run_migrations(&conn)?;

        Self::build_from_connection(conn, ConnectionMode::FileSeparate)
    }

    /// Open an in-memory fallback database (app still works, just no persistence).
    fn open_fallback() -> Self {
        let conn = rusqlite::Connection::open_in_memory()
            .expect("Failed to open in-memory SQLite — this is a fatal error");
        Self::initialize_connection(&conn).expect("Failed to initialize in-memory DB");
        Self::run_migrations(&conn).expect("Failed to migrate in-memory DB");
        Self::build_from_connection(conn, ConnectionMode::SharedSingle)
            .expect("Failed to build from in-memory connection")
    }

    /// Open an in-memory database (for testing).
    #[cfg(test)]
    pub fn open_memory() -> Result<Self, ThreadDbError> {
        let conn = rusqlite::Connection::open_in_memory()?;
        Self::initialize_connection(&conn)?;
        Self::run_migrations(&conn)?;
        Self::build_from_connection(conn, ConnectionMode::SharedSingle)
    }

    /// Build the ThreadDatabase from an initialized + migrated connection.
    ///
    /// For file-based DBs (`FileSeparate`): opens a second read connection
    /// (WAL allows concurrent readers) and spawns a dedicated writer thread.
    ///
    /// For in-memory DBs (`SharedSingle`): uses a single shared connection for
    /// both reads and writes, with writes serialized through a tokio task.
    fn build_from_connection(
        write_conn: rusqlite::Connection,
        mode: ConnectionMode,
    ) -> Result<Self, ThreadDbError> {
        // In-memory databases cannot share state across connections, so we use
        // a single connection protected by a mutex for both reads and writes.
        if mode == ConnectionMode::SharedSingle {
            let shared = Arc::new(std::sync::Mutex::new(write_conn));
            let shared_for_writer = shared.clone();

            let (write_tx, mut write_rx) = mpsc::channel::<WriteCommand>(256);

            tokio::spawn(async move {
                while let Some(cmd) = write_rx.recv().await {
                    match cmd {
                        WriteCommand::Execute(op) => {
                            let conn = shared_for_writer.lock().unwrap();
                            op(&conn);
                        }
                        WriteCommand::Shutdown => break,
                    }
                }
            });

            return Ok(Self {
                read_conn: shared,
                write_tx,
                mode,
            });
        }

        // File-based: open a second connection for reads (WAL allows concurrent readers)
        let path = Self::db_path()?;
        let read_conn = rusqlite::Connection::open(&path)?;
        Self::initialize_connection(&read_conn)?;

        let read_conn = Arc::new(std::sync::Mutex::new(read_conn));
        let (write_tx, mut write_rx) = mpsc::channel::<WriteCommand>(256);

        // Spawn background writer on a dedicated OS thread (SQLite I/O is sync)
        std::thread::Builder::new()
            .name("thread-db-writer".into())
            .spawn(move || {
                let conn = write_conn;
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("Failed to build writer runtime");

                rt.block_on(async {
                    while let Some(cmd) = write_rx.recv().await {
                        match cmd {
                            WriteCommand::Execute(op) => op(&conn),
                            WriteCommand::Shutdown => break,
                        }
                    }
                });

                log::info!("Thread DB writer shut down cleanly");
            })
            .map_err(|e| ThreadDbError::Other(format!("Failed to spawn writer thread: {}", e)))?;

        Ok(Self {
            read_conn,
            write_tx,
            mode,
        })
    }

    /// Set PRAGMAs for robustness and performance.
    fn initialize_connection(conn: &rusqlite::Connection) -> Result<(), ThreadDbError> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA busy_timeout=5000;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA cache_size=-8000;",  // 8MB cache
        )?;
        Ok(())
    }

    /// Run `PRAGMA integrity_check` and return true if the DB is healthy.
    fn check_integrity(conn: &rusqlite::Connection) -> bool {
        match conn.query_row("PRAGMA integrity_check", [], |row| {
            row.get::<_, String>(0)
        }) {
            Ok(result) => result == "ok",
            Err(_) => false,
        }
    }

    /// Apply incremental migrations. Each migration in MIGRATIONS is run exactly
    /// once, tracked by a user_version PRAGMA.
    fn run_migrations(conn: &rusqlite::Connection) -> Result<(), ThreadDbError> {
        let current_version: u32 =
            conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

        for (i, migration) in MIGRATIONS.iter().enumerate() {
            let version = i as u32 + 1;
            if version > current_version {
                log::info!("Running thread DB migration {}", version);
                conn.execute_batch(migration)?;
                conn.pragma_update(None, "user_version", version)?;
            }
        }

        Ok(())
    }

    fn db_path() -> Result<PathBuf, ThreadDbError> {
        let data_dir = dirs::data_dir().ok_or_else(|| {
            ThreadDbError::Other("Could not determine app data directory".into())
        })?;
        Ok(data_dir.join("rs.kirodex").join("threads.db"))
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Execute a write operation on the background writer thread.
    /// The closure captures its own `oneshot::Sender` for the result, so we
    /// only allocate one channel pair per call.
    async fn write<F>(&self, op: F) -> Result<(), ThreadDbError>
    where
        F: FnOnce(&rusqlite::Connection) -> Result<(), ThreadDbError> + Send + 'static,
    {
        self.write_with_result(op).await
    }

    /// Execute a write operation that returns a value.
    async fn write_with_result<F, T>(&self, op: F) -> Result<T, ThreadDbError>
    where
        F: FnOnce(&rusqlite::Connection) -> Result<T, ThreadDbError> + Send + 'static,
        T: Send + 'static,
    {
        let (result_tx, result_rx) = oneshot::channel::<Result<T, ThreadDbError>>();

        let wrapped: DbOperation = Box::new(move |conn| {
            let _ = result_tx.send(op(conn));
        });

        self.write_tx
            .send(WriteCommand::Execute(wrapped))
            .await
            .map_err(|_| ThreadDbError::Unavailable("Write queue closed".into()))?;

        result_rx
            .await
            .map_err(|_| ThreadDbError::Unavailable("Writer dropped result channel".into()))?
    }

    /// Execute a read operation on the shared read connection.
    fn read<F, T>(&self, op: F) -> Result<T, ThreadDbError>
    where
        F: FnOnce(&rusqlite::Connection) -> Result<T, ThreadDbError>,
    {
        let conn = self
            .read_conn
            .lock()
            .map_err(|e| ThreadDbError::Other(format!("Read lock poisoned: {}", e)))?;
        op(&conn)
    }

    // ── Thread CRUD ───────────────────────────────────────────────────────────

    /// Save a thread (insert or update). Dispatched to background writer.
    ///
    /// Uses UPSERT (`ON CONFLICT … DO UPDATE`) rather than `INSERT OR REPLACE`
    /// because `messages.thread_id` and `thread_context.thread_id` reference
    /// `threads.id` with `ON DELETE CASCADE`. `INSERT OR REPLACE` is internally
    /// implemented as DELETE-then-INSERT on the conflicting row, which fires
    /// the cascade and silently wipes every message + the FTS index entries
    /// for the thread. UPSERT mutates the row in place, leaving children intact.
    ///
    /// `created_at` is excluded from the UPDATE clause so re-saves never
    /// overwrite the original creation time with a newer value the caller
    /// happened to pass in.
    pub async fn save_thread(&self, thread: &DbThread) -> Result<(), ThreadDbError> {
        let thread = thread.clone();
        self.write(move |conn| {
            conn.execute(
                r#"INSERT INTO threads (id, name, workspace, status, created_at, updated_at, parent_thread_id, auto_approve, metadata)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                   ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name,
                       workspace = excluded.workspace,
                       status = excluded.status,
                       updated_at = excluded.updated_at,
                       parent_thread_id = excluded.parent_thread_id,
                       auto_approve = excluded.auto_approve,
                       metadata = excluded.metadata"#,
                rusqlite::params![
                    thread.id,
                    thread.name,
                    thread.workspace,
                    thread.status,
                    thread.created_at,
                    thread.updated_at,
                    thread.parent_thread_id,
                    thread.auto_approve as i32,
                    thread.metadata.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()),
                ],
            )?;
            Ok(())
        })
        .await
    }

    /// Save multiple messages in a single transaction (batch insert).
    pub async fn save_messages_batch(
        &self,
        messages: Vec<DbMessage>,
    ) -> Result<Vec<i64>, ThreadDbError> {
        if messages.is_empty() {
            return Ok(vec![]);
        }
        self.write_with_result(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let mut ids = Vec::with_capacity(messages.len());
            for message in &messages {
                tx.execute(
                    r#"INSERT INTO messages (thread_id, role, content, timestamp, thinking, tool_calls)
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                    rusqlite::params![
                        message.thread_id,
                        message.role,
                        message.content,
                        message.timestamp,
                        message.thinking,
                        message.tool_calls.as_ref().map(|tc| serde_json::to_string(tc).unwrap_or_default()),
                    ],
                )?;
                ids.push(tx.last_insert_rowid());
            }
            tx.commit()?;
            Ok(ids)
        })
        .await
    }

    /// Load a thread by ID (read path — does not block writer).
    pub async fn load_thread(&self, id: &str) -> Result<Option<DbThread>, ThreadDbError> {
        let id = id.to_string();
        self.read(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, workspace, status, created_at, updated_at, parent_thread_id, auto_approve, metadata FROM threads WHERE id = ?1",
            )?;

            let result = stmt.query_row([&id], |row| {
                let metadata_str: Option<String> = row.get(8)?;
                Ok(DbThread {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    workspace: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    parent_thread_id: row.get(6)?,
                    auto_approve: row.get::<_, i32>(7)? != 0,
                    metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                })
            });

            match result {
                Ok(thread) => Ok(Some(thread)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(e.into()),
            }
        })
    }

    /// List all threads, ordered by most recently updated (read path).
    pub async fn list_threads(&self) -> Result<Vec<DbThread>, ThreadDbError> {
        self.read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, workspace, status, created_at, updated_at, parent_thread_id, auto_approve, metadata FROM threads ORDER BY updated_at DESC",
            )?;

            let threads = stmt
                .query_map([], |row| {
                    let metadata_str: Option<String> = row.get(8)?;
                    Ok(DbThread {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        workspace: row.get(2)?,
                        status: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        parent_thread_id: row.get(6)?,
                        auto_approve: row.get::<_, i32>(7)? != 0,
                        metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(threads)
        })
    }

    /// List threads for a specific workspace (read path).
    pub async fn list_threads_by_workspace(
        &self,
        workspace: &str,
    ) -> Result<Vec<DbThread>, ThreadDbError> {
        let workspace = workspace.to_string();
        self.read(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, workspace, status, created_at, updated_at, parent_thread_id, auto_approve, metadata FROM threads WHERE workspace = ?1 ORDER BY updated_at DESC",
            )?;

            let threads = stmt
                .query_map([&workspace], |row| {
                    let metadata_str: Option<String> = row.get(8)?;
                    Ok(DbThread {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        workspace: row.get(2)?,
                        status: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        parent_thread_id: row.get(6)?,
                        auto_approve: row.get::<_, i32>(7)? != 0,
                        metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(threads)
        })
    }

    /// Delete a thread and all its messages atomically within a transaction.
    ///
    /// Messages are deleted explicitly before the thread so that the `AFTER DELETE`
    /// trigger on `messages` fires and keeps the FTS index in sync. SQLite's
    /// `ON DELETE CASCADE` does not fire row-level triggers.
    pub async fn delete_thread(&self, id: &str) -> Result<(), ThreadDbError> {
        let id = id.to_string();
        self.write(move |conn| {
            let tx = conn.unchecked_transaction()?;
            // Delete messages first so the AFTER DELETE trigger cleans up the FTS index
            tx.execute("DELETE FROM messages WHERE thread_id = ?1", [&id])?;
            tx.execute("DELETE FROM thread_context WHERE thread_id = ?1", [&id])?;
            tx.execute("DELETE FROM threads WHERE id = ?1", [&id])?;
            tx.commit()?;
            Ok(())
        })
        .await
    }

    /// Delete ALL threads, messages, context, and FTS data. Used by "Clear conversation history".
    pub async fn clear_all(&self) -> Result<(), ThreadDbError> {
        self.write(move |conn| {
            let tx = conn.unchecked_transaction()?;
            // Delete messages first so the AFTER DELETE trigger cleans up the FTS index
            tx.execute_batch("DELETE FROM messages;")?;
            tx.execute_batch("DELETE FROM thread_context;")?;
            tx.execute_batch("DELETE FROM threads;")?;
            // Rebuild FTS index to reclaim space
            tx.execute_batch("INSERT INTO messages_fts(messages_fts) VALUES('rebuild');")?;
            tx.commit()?;
            Ok(())
        })
        .await
    }

    // ── Message CRUD ──────────────────────────────────────────────────────────

    /// Save a single message to a thread (dispatched to background writer).
    pub async fn save_message(&self, message: &DbMessage) -> Result<i64, ThreadDbError> {
        let message = message.clone();
        self.write_with_result(move |conn| {
            conn.execute(
                r#"INSERT INTO messages (thread_id, role, content, timestamp, thinking, tool_calls)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                rusqlite::params![
                    message.thread_id,
                    message.role,
                    message.content,
                    message.timestamp,
                    message.thinking,
                    message.tool_calls.as_ref().map(|tc| serde_json::to_string(tc).unwrap_or_default()),
                ],
            )?;
            Ok(conn.last_insert_rowid())
        })
        .await
    }

    /// Load all messages for a thread, ordered by timestamp (read path).
    pub async fn load_messages(&self, thread_id: &str) -> Result<Vec<DbMessage>, ThreadDbError> {
        let thread_id = thread_id.to_string();
        self.read(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, thread_id, role, content, timestamp, thinking, tool_calls FROM messages WHERE thread_id = ?1 ORDER BY timestamp ASC",
            )?;

            let messages = stmt
                .query_map([&thread_id], |row| {
                    let tool_calls_str: Option<String> = row.get(6)?;
                    Ok(DbMessage {
                        id: row.get(0)?,
                        thread_id: row.get(1)?,
                        role: row.get(2)?,
                        content: row.get(3)?,
                        timestamp: row.get(4)?,
                        thinking: row.get(5)?,
                        tool_calls: tool_calls_str.and_then(|s| serde_json::from_str(&s).ok()),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(messages)
        })
    }

    // ── Search ────────────────────────────────────────────────────────────────

    /// Full-text search across all message content (read path).
    pub async fn search_messages(
        &self,
        query: &str,
        limit: u32,
    ) -> Result<Vec<ThreadSearchResult>, ThreadDbError> {
        let query = query.to_string();
        self.read(move |conn| {
            let mut stmt = conn.prepare(
                r#"SELECT m.thread_id, t.name, m.content, m.timestamp, rank
                   FROM messages_fts
                   JOIN messages m ON m.id = messages_fts.rowid
                   JOIN threads t ON t.id = m.thread_id
                   WHERE messages_fts MATCH ?1
                   ORDER BY rank
                   LIMIT ?2"#,
            )?;

            let results = stmt
                .query_map(rusqlite::params![query, limit], |row| {
                    Ok(ThreadSearchResult {
                        thread_id: row.get(0)?,
                        thread_name: row.get(1)?,
                        message_content: row.get(2)?,
                        message_timestamp: row.get(3)?,
                        rank: row.get(4)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(results)
        })
    }

    // ── Context Usage ─────────────────────────────────────────────────────────

    /// Update context usage for a thread (dispatched to background writer).
    ///
    /// Uses UPSERT instead of `INSERT OR REPLACE` to avoid firing any future
    /// `ON DELETE CASCADE` constraints attached to `thread_context`. See
    /// [`save_thread`] for context — same trap, same fix applied prophylactically.
    pub async fn update_context_usage(
        &self,
        thread_id: &str,
        used: u64,
        size: u64,
    ) -> Result<(), ThreadDbError> {
        let thread_id = thread_id.to_string();
        self.write(move |conn| {
            conn.execute(
                r#"INSERT INTO thread_context (thread_id, context_used, context_size)
                   VALUES (?1, ?2, ?3)
                   ON CONFLICT(thread_id) DO UPDATE SET
                       context_used = excluded.context_used,
                       context_size = excluded.context_size"#,
                rusqlite::params![thread_id, used, size],
            )?;
            Ok(())
        })
        .await
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    /// Get aggregate statistics about threads and messages (read path).
    pub async fn stats(&self) -> Result<ThreadStats, ThreadDbError> {
        self.read(|conn| {
            let total_threads: u64 =
                conn.query_row("SELECT COUNT(*) FROM threads", [], |row| row.get(0))?;
            let total_messages: u64 =
                conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?;

            let mut stmt = conn.prepare(
                "SELECT workspace, COUNT(*) as cnt FROM threads GROUP BY workspace ORDER BY cnt DESC",
            )?;
            let threads_by_workspace = stmt
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(ThreadStats {
                total_threads,
                total_messages,
                threads_by_workspace,
            })
        })
    }

    // ── Auto-Archive ─────────────────────────────────────────────────────────

    /// Identify threads whose last activity is older than `days` and whose status
    /// is not "running" or "paused". Returns metadata for each stale thread and
    /// deletes them from the database.
    pub async fn auto_archive_stale(
        &self,
        days: u32,
    ) -> Result<Vec<ArchivedThreadInfo>, ThreadDbError> {
        if days == 0 {
            return Ok(vec![]);
        }

        // First, identify stale threads via a read query.
        // A thread is stale if:
        //   - Its status is NOT 'running' or 'paused'
        //   - The most recent message timestamp (or updated_at if no messages) is older than `days` ago
        let cutoff_seconds = days as i64 * 24 * 60 * 60;
        let stale_threads: Vec<ArchivedThreadInfo> = self.read(move |conn| {
            // Use a subquery to find the max message timestamp per thread,
            // falling back to the thread's updated_at.
            let mut stmt = conn.prepare(
                r#"
                SELECT
                    t.id,
                    t.name,
                    t.workspace,
                    t.created_at,
                    COALESCE(
                        (SELECT MAX(m.timestamp) FROM messages m WHERE m.thread_id = t.id),
                        t.updated_at
                    ) AS last_activity,
                    (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count,
                    t.metadata
                FROM threads t
                WHERE t.status NOT IN ('running', 'paused')
                  AND (julianday('now') - julianday(
                    COALESCE(
                        (SELECT MAX(m.timestamp) FROM messages m WHERE m.thread_id = t.id),
                        t.updated_at
                    )
                  )) * 86400 >= ?1
                "#,
            )?;

            let rows = stmt
                .query_map([cutoff_seconds], |row| {
                    let metadata_str: Option<String> = row.get(6)?;
                    Ok(ArchivedThreadInfo {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        workspace: row.get(2)?,
                        created_at: row.get(3)?,
                        last_activity_at: row.get(4)?,
                        message_count: row.get(5)?,
                        parent_task_id: metadata_str
                            .as_deref()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                            .and_then(|v| v.get("parentTaskId").and_then(|p| p.as_str().map(String::from))),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(rows)
        })?;

        if stale_threads.is_empty() {
            return Ok(vec![]);
        }

        // Delete the stale threads from the database (write path).
        let ids: Vec<String> = stale_threads.iter().map(|t| t.id.clone()).collect();
        self.write(move |conn| {
            let tx = conn.unchecked_transaction()?;
            for id in &ids {
                // Delete messages first so the AFTER DELETE trigger cleans up FTS
                tx.execute("DELETE FROM messages WHERE thread_id = ?1", [id])?;
                tx.execute("DELETE FROM thread_context WHERE thread_id = ?1", [id])?;
                tx.execute("DELETE FROM threads WHERE id = ?1", [id])?;
            }
            tx.commit()?;
            Ok(())
        })
        .await?;

        Ok(stale_threads)
    }

    // ── Shutdown ──────────────────────────────────────────────────────────────

    /// Gracefully shut down the background writer. Pending writes will complete.
    #[allow(dead_code)]
    pub async fn shutdown(&self) {
        let _ = self.write_tx.send(WriteCommand::Shutdown).await;
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

use tauri::State;

pub struct ThreadDbState {
    pub db: ThreadDatabase,
}

#[tauri::command]
pub async fn thread_db_list(
    state: State<'_, ThreadDbState>,
) -> Result<Vec<DbThread>, ThreadDbError> {
    state.db.list_threads().await
}

#[tauri::command]
pub async fn thread_db_load(
    state: State<'_, ThreadDbState>,
    thread_id: String,
) -> Result<Option<DbThread>, ThreadDbError> {
    state.db.load_thread(&thread_id).await
}

#[tauri::command]
pub async fn thread_db_save(
    state: State<'_, ThreadDbState>,
    thread: DbThread,
) -> Result<(), ThreadDbError> {
    state.db.save_thread(&thread).await
}

#[tauri::command]
pub async fn thread_db_delete(
    state: State<'_, ThreadDbState>,
    thread_id: String,
) -> Result<(), ThreadDbError> {
    state.db.delete_thread(&thread_id).await
}

#[tauri::command]
pub async fn thread_db_messages(
    state: State<'_, ThreadDbState>,
    thread_id: String,
) -> Result<Vec<DbMessage>, ThreadDbError> {
    state.db.load_messages(&thread_id).await
}

#[tauri::command]
pub async fn thread_db_save_message(
    state: State<'_, ThreadDbState>,
    message: DbMessage,
) -> Result<i64, ThreadDbError> {
    state.db.save_message(&message).await
}

#[tauri::command]
pub async fn thread_db_search(
    state: State<'_, ThreadDbState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<ThreadSearchResult>, ThreadDbError> {
    state.db.search_messages(&query, limit.unwrap_or(20)).await
}

#[tauri::command]
pub async fn thread_db_stats(
    state: State<'_, ThreadDbState>,
) -> Result<ThreadStats, ThreadDbError> {
    state.db.stats().await
}

#[tauri::command]
pub async fn thread_db_clear_all(
    state: State<'_, ThreadDbState>,
) -> Result<(), ThreadDbError> {
    state.db.clear_all().await
}

#[tauri::command]
pub async fn thread_db_auto_archive(
    state: State<'_, ThreadDbState>,
    days: u32,
) -> Result<Vec<ArchivedThreadInfo>, ThreadDbError> {
    state.db.auto_archive_stale(days).await
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_save_thread_preserves_messages_and_context() {
        // Regression: `save_thread` must not delete the thread's messages
        // when the thread row already exists. The original implementation
        // used `INSERT OR REPLACE`, which DELETE-then-INSERTs the conflicting
        // row and triggered `ON DELETE CASCADE` on `messages.thread_id`,
        // silently wiping every assistant/user message + the FTS index.
        // The frontend's persistHistory() loop calls save_thread on every
        // task in memory, so this bug manifested as "all messages disappear
        // after the next state change / app restart".
        let db = ThreadDatabase::open_memory().unwrap();

        let mut thread = DbThread {
            id: "preserve-1".into(),
            name: "Original Name".into(),
            workspace: "/tmp/project".into(),
            status: "running".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };
        db.save_thread(&thread).await.unwrap();

        // Insert a few messages and one context-usage row.
        for i in 0..5 {
            db.save_message(&DbMessage {
                id: 0,
                thread_id: "preserve-1".into(),
                role: if i % 2 == 0 { "user" } else { "assistant" }.into(),
                content: format!("message {}", i),
                timestamp: format!("2024-01-01T00:00:{:02}Z", i + 1),
                thinking: None,
                tool_calls: None,
            })
            .await
            .unwrap();
        }
        db.update_context_usage("preserve-1", 1234, 200_000)
            .await
            .unwrap();

        // Re-save the thread with mutated metadata — the kind of churn that
        // happens on every rename / status change / persistHistory run.
        thread.name = "Renamed Thread".into();
        thread.status = "paused".into();
        thread.updated_at = "2024-01-02T00:00:00Z".into();
        db.save_thread(&thread).await.unwrap();

        // Messages must still be there.
        let messages = db.load_messages("preserve-1").await.unwrap();
        assert_eq!(messages.len(), 5, "save_thread must not delete child messages");

        // FTS index must still find them.
        let hits = db.search_messages("message", 10).await.unwrap();
        assert!(!hits.is_empty(), "FTS index must survive thread re-save");

        // Thread metadata must reflect the update.
        let loaded = db.load_thread("preserve-1").await.unwrap().unwrap();
        assert_eq!(loaded.name, "Renamed Thread");
        assert_eq!(loaded.status, "paused");
        assert_eq!(loaded.updated_at, "2024-01-02T00:00:00Z");
    }

    #[tokio::test]
    async fn test_save_thread_preserves_created_at() {
        // UPSERT excludes `created_at` from the update clause so re-saving
        // a thread can never overwrite the original creation timestamp.
        let db = ThreadDatabase::open_memory().unwrap();
        let mut thread = DbThread {
            id: "created-1".into(),
            name: "Original".into(),
            workspace: "/tmp".into(),
            status: "idle".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };
        db.save_thread(&thread).await.unwrap();

        // Caller passes a different created_at on the re-save (this is what
        // the JS layer does — taskToDbThread always passes task.createdAt
        // even when it's been edited or migrated).
        thread.created_at = "1999-01-01T00:00:00Z".into();
        db.save_thread(&thread).await.unwrap();

        let loaded = db.load_thread("created-1").await.unwrap().unwrap();
        assert_eq!(
            loaded.created_at, "2024-01-01T00:00:00Z",
            "created_at must be immutable after the row exists",
        );
    }

    #[tokio::test]
    async fn test_create_and_load_thread() {
        let db = ThreadDatabase::open_memory().unwrap();

        let thread = DbThread {
            id: "test-1".into(),
            name: "Test Thread".into(),
            workspace: "/tmp/project".into(),
            status: "idle".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };

        db.save_thread(&thread).await.unwrap();

        let loaded = db.load_thread("test-1").await.unwrap();
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.name, "Test Thread");
        assert_eq!(loaded.workspace, "/tmp/project");
    }

    #[tokio::test]
    async fn test_save_and_load_messages() {
        let db = ThreadDatabase::open_memory().unwrap();

        let thread = DbThread {
            id: "thread-1".into(),
            name: "Test".into(),
            workspace: "/tmp".into(),
            status: "idle".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };
        db.save_thread(&thread).await.unwrap();

        let msg = DbMessage {
            id: 0,
            thread_id: "thread-1".into(),
            role: "user".into(),
            content: "Hello, world!".into(),
            timestamp: "2024-01-01T00:00:01Z".into(),
            thinking: None,
            tool_calls: None,
        };
        db.save_message(&msg).await.unwrap();

        let messages = db.load_messages("thread-1").await.unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Hello, world!");
    }

    #[tokio::test]
    async fn test_batch_save_messages() {
        let db = ThreadDatabase::open_memory().unwrap();

        let thread = DbThread {
            id: "batch-1".into(),
            name: "Batch Test".into(),
            workspace: "/tmp".into(),
            status: "idle".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };
        db.save_thread(&thread).await.unwrap();

        let messages: Vec<DbMessage> = (0..10)
            .map(|i| DbMessage {
                id: 0,
                thread_id: "batch-1".into(),
                role: "user".into(),
                content: format!("Message {}", i),
                timestamp: format!("2024-01-01T00:00:{:02}Z", i),
                thinking: None,
                tool_calls: None,
            })
            .collect();

        let ids = db.save_messages_batch(messages).await.unwrap();
        assert_eq!(ids.len(), 10);

        let loaded = db.load_messages("batch-1").await.unwrap();
        assert_eq!(loaded.len(), 10);
        assert_eq!(loaded[0].content, "Message 0");
        assert_eq!(loaded[9].content, "Message 9");
    }

    #[tokio::test]
    async fn test_delete_thread_is_atomic() {
        let db = ThreadDatabase::open_memory().unwrap();

        let thread = DbThread {
            id: "del-1".into(),
            name: "Delete Me".into(),
            workspace: "/tmp".into(),
            status: "idle".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };
        db.save_thread(&thread).await.unwrap();

        let msg = DbMessage {
            id: 0,
            thread_id: "del-1".into(),
            role: "user".into(),
            content: "test message for deletion".into(),
            timestamp: "2024-01-01T00:00:01Z".into(),
            thinking: None,
            tool_calls: None,
        };
        db.save_message(&msg).await.unwrap();

        db.delete_thread("del-1").await.unwrap();

        let loaded = db.load_thread("del-1").await.unwrap();
        assert!(loaded.is_none());

        let messages = db.load_messages("del-1").await.unwrap();
        assert!(messages.is_empty());
    }

    #[tokio::test]
    async fn test_full_text_search() {
        let db = ThreadDatabase::open_memory().unwrap();

        let thread = DbThread {
            id: "search-1".into(),
            name: "Search Thread".into(),
            workspace: "/tmp".into(),
            status: "idle".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };
        db.save_thread(&thread).await.unwrap();

        let msg1 = DbMessage {
            id: 0,
            thread_id: "search-1".into(),
            role: "user".into(),
            content: "How do I implement a binary search tree in Rust?".into(),
            timestamp: "2024-01-01T00:00:01Z".into(),
            thinking: None,
            tool_calls: None,
        };
        db.save_message(&msg1).await.unwrap();

        let msg2 = DbMessage {
            id: 0,
            thread_id: "search-1".into(),
            role: "assistant".into(),
            content: "Here's how to implement a BST in Rust using enums...".into(),
            timestamp: "2024-01-01T00:00:02Z".into(),
            thinking: None,
            tool_calls: None,
        };
        db.save_message(&msg2).await.unwrap();

        let results = db.search_messages("binary search", 10).await.unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].thread_name, "Search Thread");
    }

    #[tokio::test]
    async fn test_stats() {
        let db = ThreadDatabase::open_memory().unwrap();

        let thread = DbThread {
            id: "stats-1".into(),
            name: "Stats Thread".into(),
            workspace: "/projects/alpha".into(),
            status: "idle".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };
        db.save_thread(&thread).await.unwrap();

        let msg = DbMessage {
            id: 0,
            thread_id: "stats-1".into(),
            role: "user".into(),
            content: "test".into(),
            timestamp: "2024-01-01T00:00:01Z".into(),
            thinking: None,
            tool_calls: None,
        };
        db.save_message(&msg).await.unwrap();

        let stats = db.stats().await.unwrap();
        assert_eq!(stats.total_threads, 1);
        assert_eq!(stats.total_messages, 1);
        assert_eq!(stats.threads_by_workspace[0].0, "/projects/alpha");
    }

    #[tokio::test]
    async fn test_fallback_database() {
        // The fallback should always succeed
        let db = ThreadDatabase::open_fallback();
        assert!(db.is_fallback());

        // Should still be fully functional
        let thread = DbThread {
            id: "fallback-1".into(),
            name: "Fallback Thread".into(),
            workspace: "/tmp".into(),
            status: "idle".into(),
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
        };
        db.save_thread(&thread).await.unwrap();

        let loaded = db.load_thread("fallback-1").await.unwrap();
        assert!(loaded.is_some());
    }
}
