//! Retry Strategy with Exponential Backoff.
//!
//! Provides configurable retry logic for ACP connections, model API calls,
//! and other fallible operations. Supports both exponential backoff and
//! fixed-delay strategies.
//!
//! # Usage
//!
//! ```rust,ignore
//! use crate::commands::retry::{RetryStrategy, retry_with_strategy};
//!
//! let result = retry_with_strategy(
//!     RetryStrategy::exponential(Duration::from_secs(1), 4),
//!     || async { some_fallible_operation().await },
//! ).await;
//! ```

use serde::Serialize;
use std::future::Future;
use std::time::Duration;
use tokio::time::sleep;

// ── Retry Strategy ────────────────────────────────────────────────────────────

/// Maximum retry attempts for ACP connections.
pub const MAX_RETRY_ATTEMPTS: u8 = 4;

/// Base delay for exponential backoff (5 seconds).
pub const BASE_RETRY_DELAY: Duration = Duration::from_secs(5);

/// Maximum delay cap to prevent excessively long waits.
pub const MAX_RETRY_DELAY: Duration = Duration::from_secs(60);

/// Configurable retry strategy.
#[derive(Debug, Clone)]
pub enum RetryStrategy {
    /// Exponential backoff: delay doubles after each attempt.
    /// delay = initial_delay * 2^attempt (capped at MAX_RETRY_DELAY)
    ExponentialBackoff {
        initial_delay: Duration,
        max_attempts: u8,
    },
    /// Fixed delay between attempts.
    Fixed {
        delay: Duration,
        max_attempts: u8,
    },
    /// No retry — fail immediately.
    None,
}

impl RetryStrategy {
    /// Create an exponential backoff strategy with the given initial delay and max attempts.
    pub fn exponential(initial_delay: Duration, max_attempts: u8) -> Self {
        Self::ExponentialBackoff {
            initial_delay,
            max_attempts,
        }
    }

    /// Create a fixed-delay strategy.
    pub fn fixed(delay: Duration, max_attempts: u8) -> Self {
        Self::Fixed {
            delay,
            max_attempts,
        }
    }

    /// Default strategy for ACP connection attempts.
    pub fn acp_default() -> Self {
        Self::ExponentialBackoff {
            initial_delay: BASE_RETRY_DELAY,
            max_attempts: MAX_RETRY_ATTEMPTS,
        }
    }

    /// Strategy for model API calls (shorter delays, more attempts).
    pub fn model_api() -> Self {
        Self::ExponentialBackoff {
            initial_delay: Duration::from_secs(2),
            max_attempts: 3,
        }
    }

    /// Strategy for transient network errors.
    pub fn network() -> Self {
        Self::ExponentialBackoff {
            initial_delay: Duration::from_secs(1),
            max_attempts: 5,
        }
    }

    /// Get the maximum number of attempts for this strategy.
    pub fn max_attempts(&self) -> u8 {
        match self {
            Self::ExponentialBackoff { max_attempts, .. } => *max_attempts,
            Self::Fixed { max_attempts, .. } => *max_attempts,
            Self::None => 1,
        }
    }

    /// Calculate the delay for a given attempt number (0-indexed).
    pub fn delay_for_attempt(&self, attempt: u8) -> Duration {
        match self {
            Self::ExponentialBackoff { initial_delay, .. } => {
                let multiplier = 2u64.saturating_pow(attempt as u32);
                let delay = initial_delay.saturating_mul(multiplier as u32);
                delay.min(MAX_RETRY_DELAY)
            }
            Self::Fixed { delay, .. } => *delay,
            Self::None => Duration::ZERO,
        }
    }
}

// ── Retry Result ──────────────────────────────────────────────────────────────

/// Outcome of a retry operation.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RetryOutcome<T: Serialize> {
    /// The successful result, if any.
    pub result: Option<T>,
    /// Total number of attempts made.
    pub attempts: u8,
    /// Whether the operation ultimately succeeded.
    pub success: bool,
    /// The last error message, if the operation failed.
    pub last_error: Option<String>,
}

// ── Retry Execution ───────────────────────────────────────────────────────────

/// Execute an async operation with the given retry strategy.
///
/// The `should_retry` closure determines whether a given error is retryable.
/// Non-retryable errors (e.g., auth failures, invalid params) fail immediately.
pub async fn retry_with_strategy<F, Fut, T, E>(
    strategy: RetryStrategy,
    mut operation: F,
) -> Result<T, RetryError<E>>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display + IsRetryable,
{
    let max_attempts = strategy.max_attempts();

    for attempt in 0..max_attempts {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(e) => {
                // Don't retry non-retryable errors
                if !e.is_retryable() {
                    return Err(RetryError::NonRetryable {
                        error: e,
                        attempt: attempt + 1,
                    });
                }

                // Last attempt — don't sleep, just fail
                if attempt + 1 >= max_attempts {
                    return Err(RetryError::Exhausted {
                        error: e,
                        attempts: max_attempts,
                    });
                }

                // Sleep before next attempt
                let delay = strategy.delay_for_attempt(attempt);
                log::warn!(
                    "Retry attempt {}/{} failed: {}. Retrying in {:?}...",
                    attempt + 1,
                    max_attempts,
                    e,
                    delay
                );
                sleep(delay).await;
            }
        }
    }

    unreachable!("loop should have returned")
}

/// Execute with retry, using a simpler interface that always retries on error.
pub async fn retry_simple<F, Fut, T, E>(
    strategy: RetryStrategy,
    mut operation: F,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let max_attempts = strategy.max_attempts();

    let mut last_error: Option<E> = None;

    for attempt in 0..max_attempts {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(e) => {
                if attempt + 1 >= max_attempts {
                    last_error = Some(e);
                    break;
                }

                let delay = strategy.delay_for_attempt(attempt);
                log::warn!(
                    "Attempt {}/{} failed: {}. Retrying in {:?}...",
                    attempt + 1,
                    max_attempts,
                    e,
                    delay
                );
                sleep(delay).await;
            }
        }
    }

    Err(last_error.unwrap())
}

// ── Error Types ───────────────────────────────────────────────────────────────

/// Error returned by `retry_with_strategy`.
#[derive(Debug)]
pub enum RetryError<E> {
    /// All retry attempts exhausted.
    Exhausted { error: E, attempts: u8 },
    /// Error is not retryable (e.g., auth failure).
    NonRetryable { error: E, attempt: u8 },
}

impl<E: std::fmt::Display> std::fmt::Display for RetryError<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Exhausted { error, attempts } => {
                write!(f, "Failed after {} attempts: {}", attempts, error)
            }
            Self::NonRetryable { error, attempt } => {
                write!(
                    f,
                    "Non-retryable error on attempt {}: {}",
                    attempt, error
                )
            }
        }
    }
}

impl<E: std::fmt::Display + std::fmt::Debug> std::error::Error for RetryError<E> {}

/// Trait to determine if an error is retryable.
pub trait IsRetryable {
    fn is_retryable(&self) -> bool;
}

// ── Common retryable error classifications ────────────────────────────────────

/// Classification of ACP/model errors for retry decisions.
#[derive(Debug, Clone, PartialEq)]
pub enum ErrorKind {
    /// Transient network error (timeout, connection reset)
    Network,
    /// Rate limiting (429 Too Many Requests)
    RateLimited,
    /// Server error (5xx)
    ServerError,
    /// Authentication failure (401/403) — NOT retryable
    AuthFailure,
    /// Invalid request (400) — NOT retryable
    InvalidRequest,
    /// Model not found — NOT retryable
    ModelNotFound,
    /// Unknown error — retryable by default
    Unknown,
}

impl ErrorKind {
    /// Classify an error string into an ErrorKind.
    pub fn classify(error: &str) -> Self {
        let lower = error.to_lowercase();

        if lower.contains("throttling")
            || lower.contains("rate exceeded")
            || lower.contains("too many requests")
            || lower.contains("429")
        {
            return Self::RateLimited;
        }

        if lower.contains("timeout")
            || lower.contains("connection reset")
            || lower.contains("connection refused")
            || lower.contains("broken pipe")
            || lower.contains("eof")
        {
            return Self::Network;
        }

        if lower.contains("500")
            || lower.contains("502")
            || lower.contains("503")
            || lower.contains("504")
            || lower.contains("internal server error")
            || lower.contains("service unavailable")
            || lower.contains("bad gateway")
            || lower.contains("modelerrorexception")
            || lower.contains("internalservererror")
            || lower.contains("serviceexception")
        {
            return Self::ServerError;
        }

        if lower.contains("accessdenied")
            || lower.contains("unauthorized")
            || lower.contains("security token")
            || lower.contains("not authorized")
            || lower.contains("401")
            || lower.contains("403")
        {
            return Self::AuthFailure;
        }

        if lower.contains("validationexception")
            || lower.contains("invalid")
            || lower.contains("400")
        {
            return Self::InvalidRequest;
        }

        if lower.contains("resourcenotfound") || lower.contains("model not found") {
            return Self::ModelNotFound;
        }

        Self::Unknown
    }

    /// Whether this error kind is retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::Network | Self::RateLimited | Self::ServerError | Self::Unknown
        )
    }
}

/// A simple string-based error that implements IsRetryable via classification.
#[derive(Debug, Clone)]
pub struct ClassifiedError {
    pub message: String,
    pub kind: ErrorKind,
}

impl ClassifiedError {
    pub fn new(message: impl Into<String>) -> Self {
        let message = message.into();
        let kind = ErrorKind::classify(&message);
        Self { message, kind }
    }
}

impl std::fmt::Display for ClassifiedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ClassifiedError {}

impl IsRetryable for ClassifiedError {
    fn is_retryable(&self) -> bool {
        self.kind.is_retryable()
    }
}

// Blanket impl for String errors (always retryable for backward compat)
impl IsRetryable for String {
    fn is_retryable(&self) -> bool {
        ErrorKind::classify(self).is_retryable()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn test_retry_succeeds_first_attempt() {
        let result = retry_simple(RetryStrategy::fixed(Duration::from_millis(10), 3), || async {
            Ok::<_, String>("success")
        })
        .await;

        assert_eq!(result.unwrap(), "success");
    }

    #[tokio::test]
    async fn test_retry_succeeds_after_failures() {
        let attempts = Arc::new(AtomicU8::new(0));
        let attempts_clone = attempts.clone();

        let result = retry_simple(
            RetryStrategy::fixed(Duration::from_millis(10), 3),
            || {
                let attempts = attempts_clone.clone();
                async move {
                    let n = attempts.fetch_add(1, Ordering::SeqCst);
                    if n < 2 {
                        Err::<String, _>("transient error".to_string())
                    } else {
                        Ok("success".to_string())
                    }
                }
            },
        )
        .await;

        assert_eq!(result.unwrap(), "success");
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_retry_exhausted() {
        let attempts = Arc::new(AtomicU8::new(0));
        let attempts_clone = attempts.clone();

        let result = retry_simple(
            RetryStrategy::fixed(Duration::from_millis(10), 3),
            || {
                let attempts = attempts_clone.clone();
                async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err::<String, _>("always fails".to_string())
                }
            },
        )
        .await;

        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_non_retryable_error() {
        let attempts = Arc::new(AtomicU8::new(0));
        let attempts_clone = attempts.clone();

        let result = retry_with_strategy(
            RetryStrategy::fixed(Duration::from_millis(10), 5),
            || {
                let attempts = attempts_clone.clone();
                async move {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    Err::<String, _>(ClassifiedError::new(
                        "AccessDeniedException: not authorized",
                    ))
                }
            },
        )
        .await;

        assert!(result.is_err());
        // Should only attempt once since auth errors are not retryable
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_exponential_backoff_delays() {
        let strategy = RetryStrategy::exponential(Duration::from_secs(1), 5);
        assert_eq!(strategy.delay_for_attempt(0), Duration::from_secs(1));
        assert_eq!(strategy.delay_for_attempt(1), Duration::from_secs(2));
        assert_eq!(strategy.delay_for_attempt(2), Duration::from_secs(4));
        assert_eq!(strategy.delay_for_attempt(3), Duration::from_secs(8));
        assert_eq!(strategy.delay_for_attempt(4), Duration::from_secs(16));
    }

    #[test]
    fn test_delay_capped_at_max() {
        let strategy = RetryStrategy::exponential(Duration::from_secs(30), 5);
        // 30 * 2^2 = 120, but capped at 60
        assert_eq!(strategy.delay_for_attempt(2), MAX_RETRY_DELAY);
    }

    #[test]
    fn test_error_classification() {
        assert_eq!(
            ErrorKind::classify("ThrottlingException: rate exceeded"),
            ErrorKind::RateLimited
        );
        assert_eq!(
            ErrorKind::classify("connection timeout after 30s"),
            ErrorKind::Network
        );
        assert_eq!(
            ErrorKind::classify("AccessDeniedException"),
            ErrorKind::AuthFailure
        );
        assert_eq!(
            ErrorKind::classify("InternalServerError"),
            ErrorKind::ServerError
        );
        assert_eq!(
            ErrorKind::classify("ResourceNotFoundException: model not found"),
            ErrorKind::ModelNotFound
        );
        assert_eq!(
            ErrorKind::classify("something weird happened"),
            ErrorKind::Unknown
        );
    }

    #[test]
    fn test_retryable_classification() {
        assert!(ErrorKind::Network.is_retryable());
        assert!(ErrorKind::RateLimited.is_retryable());
        assert!(ErrorKind::ServerError.is_retryable());
        assert!(ErrorKind::Unknown.is_retryable());
        assert!(!ErrorKind::AuthFailure.is_retryable());
        assert!(!ErrorKind::InvalidRequest.is_retryable());
        assert!(!ErrorKind::ModelNotFound.is_retryable());
    }
}
