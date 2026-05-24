use reqwest::{RequestBuilder, Response};
use tokio::time::{timeout, Duration};

pub async fn send_with_retry(request: RequestBuilder) -> Result<Response, String> {
    for attempt in 1..=3 {
        let request_clone = request
            .try_clone()
            .ok_or("Cannot clone request for retry")?;

        let result = timeout(Duration::from_secs(10), request_clone.send()).await;

        match result {
            Ok(Ok(res)) => {
                if res.status().is_server_error() && attempt < 3 {
                    let backoff = 2_u64.pow(attempt - 1);
                    tracing::warn!(
                        " Request returned {}, retrying in {}s (attempt {}/3)",
                        res.status(),
                        backoff,
                        attempt
                    );
                    tokio::time::sleep(Duration::from_secs(backoff)).await;
                    continue;
                }
                return Ok(res);
            }
            Ok(Err(e)) => {
                if attempt < 3 {
                    tracing::warn!(" Request failed: {}, retrying...", e);
                    tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt - 1))).await;
                    continue;
                }
                return Err(format!("Request failed after 3 attempts: {e}"));
            }
            Err(_) => {
                if attempt < 3 {
                    tracing::warn!(" Request timeout (10s), retrying...");
                    tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt - 1))).await;
                    continue;
                }
                return Err("Request timeout after 3 attempts (10s each)".to_string());
            }
        }
    }
    Err("Request failed after all retries".to_string())
}
