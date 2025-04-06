use std::time::Duration;
use tracing::{error, warn};

pub async fn with_retry<F, Fut, T, E>(
    operation: F,
    retry_delay: u64,
    max_retries: u32,
    operation_name: &str,
) -> Result<T, E>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut attempt = 0;

    loop {
        attempt += 1;
        match operation().await {
            Ok(result) => return Ok(result),
            Err(err) => {
                if attempt > max_retries {
                    error!(
                        "Operation '{}' failed after {} attempts: {}",
                        operation_name, max_retries, err
                    );
                    return Err(err);
                }

                let backoff = exponential_backoff(retry_delay, attempt);
                warn!(
                    "Operation '{}' failed (attempt {}/{}): {}. Retrying in {}ms",
                    operation_name, attempt, max_retries, err, backoff
                );

                tokio::time::sleep(Duration::from_millis(backoff)).await;
            }
        }
    }
}

/// Calculate exponential backoff with jitter
fn exponential_backoff(base_delay: u64, attempt: u32) -> u64 {
    let exponential = base_delay * (2_u64.pow(attempt.saturating_sub(1)));
    let max_delay = std::cmp::min(exponential, 60_000); // Cap at 60 seconds
    
    // Add jitter (±20%)
    let jitter = (rand::random::<f64>() * 0.4 - 0.2) * max_delay as f64;
    (max_delay as f64 + jitter) as u64
}
