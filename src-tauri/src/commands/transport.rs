//! MCP Transport Abstraction.
//!
//! Provides a `Transport` trait with implementations for:
//! - **Stdio**: Communicates with a subprocess via stdin/stdout (current kirodex behavior)
//! - **HTTP (SSE)**: Communicates with remote MCP servers via HTTP + Server-Sent Events
//!
//! This allows kirodex to support both local CLI-based MCP servers and remote
//! cloud-hosted MCP servers (with OAuth support).

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

// ── Transport Trait ───────────────────────────────────────────────────────────

/// Abstraction over MCP server communication channels.
///
/// Implementations handle the low-level details of sending JSON-RPC messages
/// to and receiving responses from MCP servers, regardless of transport mechanism.
#[async_trait]
pub trait Transport: Send + Sync {
    /// Send a JSON-RPC message to the server.
    async fn send(&self, message: String) -> Result<(), TransportError>;

    /// Receive the next message from the server (blocks until available).
    async fn receive(&self) -> Option<String>;

    /// Receive stderr output (for logging/debugging).
    async fn receive_err(&self) -> Option<String>;

    /// Notify the transport of the negotiated protocol version (for HTTP headers).
    fn set_protocol_version(&self, _version: &str) {}

    /// Shut down the transport gracefully.
    async fn shutdown(&self) -> Result<(), TransportError>;
}

// ── Transport Errors ──────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Process exited unexpectedly")]
    ProcessExited,

    #[error("Channel closed")]
    ChannelClosed,

    #[error("HTTP error: {status} {body}")]
    Http { status: u16, body: String },

    #[error("Authentication required: {url}")]
    AuthRequired { url: String },

    #[error("Connection timeout")]
    Timeout,

    #[error("{0}")]
    Other(String),
}

impl Serialize for TransportError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ── Stdio Transport ───────────────────────────────────────────────────────────

/// Configuration for spawning a stdio-based MCP server.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StdioConfig {
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
    pub working_directory: Option<PathBuf>,
}

/// Communicates with an MCP server subprocess via stdin/stdout.
pub struct StdioTransport {
    stdin_tx: mpsc::UnboundedSender<String>,
    stdout_rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<String>>,
    stderr_rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<String>>,
    child: tokio::sync::Mutex<Option<Child>>,
}

impl StdioTransport {
    /// Spawn a new MCP server subprocess.
    pub async fn new(config: StdioConfig) -> Result<Self, TransportError> {
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args);

        for (key, value) in &config.env {
            cmd.env(key, value);
        }

        if let Some(ref cwd) = config.working_directory {
            cmd.current_dir(cwd);
        }

        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn()?;

        let stdin = child.stdin.take().ok_or_else(|| {
            TransportError::Other("Failed to capture stdin".into())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            TransportError::Other("Failed to capture stdout".into())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            TransportError::Other("Failed to capture stderr".into())
        })?;

        // Channel for outgoing messages (stdin)
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();

        // Channel for incoming messages (stdout)
        let (stdout_tx, stdout_rx) = mpsc::unbounded_channel::<String>();

        // Channel for stderr
        let (stderr_tx, stderr_rx) = mpsc::unbounded_channel::<String>();

        // Task: write messages to stdin
        tokio::spawn(async move {
            let mut writer = stdin;
            while let Some(msg) = stdin_rx.recv().await {
                let framed = format!("Content-Length: {}\r\n\r\n{}", msg.len(), msg);
                if writer.write_all(framed.as_bytes()).await.is_err() {
                    break;
                }
                if writer.flush().await.is_err() {
                    break;
                }
            }
        });

        // Task: read messages from stdout (JSON-RPC framing with Content-Length)
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                // Read headers
                let mut content_length: Option<usize> = None;
                loop {
                    let mut header_line = String::new();
                    match reader.read_line(&mut header_line).await {
                        Ok(0) => return, // EOF
                        Ok(_) => {
                            let trimmed = header_line.trim();
                            if trimmed.is_empty() {
                                break; // End of headers
                            }
                            if let Some(len_str) =
                                trimmed.strip_prefix("Content-Length:")
                            {
                                content_length =
                                    len_str.trim().parse::<usize>().ok();
                            }
                        }
                        Err(_) => return,
                    }
                }

                // Read body
                if let Some(len) = content_length {
                    let mut body = vec![0u8; len];
                    if reader.read_exact(&mut body).await.is_err() {
                        return;
                    }
                    if let Ok(msg) = String::from_utf8(body) {
                        if stdout_tx.send(msg).is_err() {
                            return;
                        }
                    }
                }
            }
        });

        // Task: read stderr
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => return,
                    Ok(_) => {
                        if stderr_tx.send(line.clone()).is_err() {
                            return;
                        }
                    }
                    Err(_) => return,
                }
            }
        });

        Ok(Self {
            stdin_tx,
            stdout_rx: tokio::sync::Mutex::new(stdout_rx),
            stderr_rx: tokio::sync::Mutex::new(stderr_rx),
            child: tokio::sync::Mutex::new(Some(child)),
        })
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn send(&self, message: String) -> Result<(), TransportError> {
        self.stdin_tx
            .send(message)
            .map_err(|_| TransportError::ChannelClosed)
    }

    async fn receive(&self) -> Option<String> {
        self.stdout_rx.lock().await.recv().await
    }

    async fn receive_err(&self) -> Option<String> {
        self.stderr_rx.lock().await.recv().await
    }

    async fn shutdown(&self) -> Result<(), TransportError> {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }
        Ok(())
    }
}

// ── HTTP Transport (SSE) ──────────────────────────────────────────────────────

/// Configuration for connecting to a remote HTTP-based MCP server.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpConfig {
    /// Base URL of the MCP server (e.g. "https://mcp.example.com")
    pub url: String,
    /// Optional bearer token for authentication
    pub token: Option<String>,
    /// Optional OAuth callback URL
    pub oauth_url: Option<String>,
    /// Request timeout in seconds (default: 60)
    pub timeout_secs: Option<u64>,
}

/// Communicates with a remote MCP server via HTTP POST + Server-Sent Events.
///
/// Messages are sent via HTTP POST to the server URL.
/// Responses come back either as direct HTTP responses or via SSE stream.
///
/// **Note:** The current SSE implementation buffers the entire response body before
/// parsing events. This works well for short-lived request/response patterns but
/// does not support long-lived streaming connections. A future iteration should use
/// `response.bytes_stream()` for true incremental SSE processing.
pub struct HttpTransport {
    config: HttpConfig,
    response_rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<String>>,
    response_tx: mpsc::UnboundedSender<String>,
    protocol_version: tokio::sync::Mutex<Option<String>>,
}

impl HttpTransport {
    pub fn new(config: HttpConfig) -> Result<Self, TransportError> {
        validate_mcp_url(&config.url)?;
        let (response_tx, response_rx) = mpsc::unbounded_channel();
        Ok(Self {
            config,
            response_rx: tokio::sync::Mutex::new(response_rx),
            response_tx,
            protocol_version: tokio::sync::Mutex::new(None),
        })
    }
}

/// Validate that an MCP server URL is safe to connect to.
/// Rejects private/link-local IPs and non-HTTP(S) schemes to prevent SSRF.
fn validate_mcp_url(url: &str) -> Result<(), TransportError> {
    let parsed = url::Url::parse(url)
        .map_err(|e| TransportError::Other(format!("Invalid URL: {e}")))?;
    match parsed.scheme() {
        "https" => {} // always allowed
        "http" => {
            // http only allowed for localhost
            let host = parsed.host_str().unwrap_or("");
            let is_localhost = host == "localhost"
                || host == "127.0.0.1"
                || host == "::1"
                || host == "[::1]";
            if !is_localhost {
                return Err(TransportError::Other(
                    "HTTP (non-TLS) is only allowed for localhost. Use HTTPS for remote servers.".to_string()
                ));
            }
        }
        other => {
            return Err(TransportError::Other(
                format!("Unsupported URL scheme: {other}. Only http and https are allowed.")
            ));
        }
    }
    // Reject known internal/metadata IP ranges
    if let Some(host) = parsed.host_str() {
        let is_private = host.starts_with("10.")
            || host.starts_with("192.168.")
            || host.starts_with("172.16.") || host.starts_with("172.17.")
            || host.starts_with("172.18.") || host.starts_with("172.19.")
            || host.starts_with("172.20.") || host.starts_with("172.21.")
            || host.starts_with("172.22.") || host.starts_with("172.23.")
            || host.starts_with("172.24.") || host.starts_with("172.25.")
            || host.starts_with("172.26.") || host.starts_with("172.27.")
            || host.starts_with("172.28.") || host.starts_with("172.29.")
            || host.starts_with("172.30.") || host.starts_with("172.31.")
            || host.starts_with("169.254.")  // link-local / cloud metadata
            || host == "metadata.google.internal";
        if is_private {
            return Err(TransportError::Other(
                format!("Refusing to connect to private/internal address: {host}")
            ));
        }
    }
    Ok(())
}

#[async_trait]
impl Transport for HttpTransport {
    async fn send(&self, message: String) -> Result<(), TransportError> {
        let client = reqwest::Client::new();
        let timeout = std::time::Duration::from_secs(
            self.config.timeout_secs.unwrap_or(60),
        );

        let mut request = client
            .post(&self.config.url)
            .header("Content-Type", "application/json")
            .timeout(timeout);

        // Add auth token if available
        if let Some(ref token) = self.config.token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        // Add protocol version header if negotiated
        if let Some(ref version) = *self.protocol_version.lock().await {
            request = request.header("MCP-Protocol-Version", version.as_str());
        }

        let response = request
            .body(message)
            .send()
            .await
            .map_err(|e| TransportError::Other(e.to_string()))?;

        let status = response.status().as_u16();

        if status == 401 || status == 403 {
            let auth_url = self
                .config
                .oauth_url
                .clone()
                .unwrap_or_else(|| self.config.url.clone());
            return Err(TransportError::AuthRequired { url: auth_url });
        }

        if !response.status().is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".into());
            return Err(TransportError::Http { status, body });
        }

        // Check if response is SSE (streaming) or direct JSON
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if content_type.contains("text/event-stream") {
            // Parse SSE stream
            let tx = self.response_tx.clone();
            let body = response
                .text()
                .await
                .map_err(|e| TransportError::Other(e.to_string()))?;

            for line in body.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data.trim() != "[DONE]" {
                        let _ = tx.send(data.to_string());
                    }
                }
            }
        } else {
            // Direct JSON response
            let body = response
                .text()
                .await
                .map_err(|e| TransportError::Other(e.to_string()))?;
            let _ = self.response_tx.send(body);
        }

        Ok(())
    }

    async fn receive(&self) -> Option<String> {
        self.response_rx.lock().await.recv().await
    }

    async fn receive_err(&self) -> Option<String> {
        // HTTP transport doesn't have a separate error stream
        None
    }

    fn set_protocol_version(&self, version: &str) {
        // Use try_lock since this is a sync method on an async mutex.
        // If the lock is contended (extremely rare — only during an active send()),
        // log a warning rather than silently dropping the update.
        match self.protocol_version.try_lock() {
            Ok(mut v) => {
                *v = Some(version.to_string());
            }
            Err(_) => {
                log::warn!(
                    "set_protocol_version: mutex contended, protocol version '{}' was not set. \
                     It will be applied on the next successful lock acquisition.",
                    version
                );
            }
        }
    }

    async fn shutdown(&self) -> Result<(), TransportError> {
        // Nothing to shut down for HTTP — connections are stateless
        Ok(())
    }
}

// ── Transport Factory ─────────────────────────────────────────────────────────

/// Configuration for any transport type.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransportConfig {
    Stdio(StdioConfig),
    Http(HttpConfig),
}

/// Create a transport from configuration.
pub async fn create_transport(
    config: TransportConfig,
) -> Result<Arc<dyn Transport>, TransportError> {
    match config {
        TransportConfig::Stdio(stdio_config) => {
            let transport = StdioTransport::new(stdio_config).await?;
            Ok(Arc::new(transport))
        }
        TransportConfig::Http(http_config) => {
            let transport = HttpTransport::new(http_config)?;
            Ok(Arc::new(transport))
        }
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Test connectivity to an MCP server via the specified transport.
#[tauri::command]
pub async fn mcp_transport_test(config: TransportConfig) -> Result<String, String> {
    let transport = create_transport(config)
        .await
        .map_err(|e| e.to_string())?;

    // Send a basic JSON-RPC initialize probe
    let probe = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "kirodex",
                "version": "0.1.0"
            }
        }
    });

    transport
        .send(serde_json::to_string(&probe).unwrap())
        .await
        .map_err(|e| e.to_string())?;

    match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        transport.receive(),
    )
    .await
    {
        Ok(Some(response)) => {
            let _ = transport.shutdown().await;
            Ok(response)
        }
        Ok(None) => {
            let _ = transport.shutdown().await;
            Err("Server closed connection without responding".into())
        }
        Err(_) => {
            let _ = transport.shutdown().await;
            Err("Connection timed out after 10 seconds".into())
        }
    }
}
