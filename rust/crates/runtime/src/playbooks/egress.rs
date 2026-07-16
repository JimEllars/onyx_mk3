use tools::wp_proxy_worker::{execute_publish_to_proxy, WpProxyPayload};
use std::time::Duration;
use std::fs::OpenOptions;
use std::io::Write;

pub async fn run_egress_publish(content: String, brand_id: String) -> Result<bool, String> {
    let payload = WpProxyPayload { content, brand_id };

    for attempt in 1..=3 {
        match execute_publish_to_proxy(payload.clone()).await {
            Ok(resp) if resp.success => {
                return Ok(true);
            }
            Ok(_) | Err(_) => {
                if attempt == 3 {
                    // Log to DLQ
                    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(".claw/dlq.log") {
                        let _ = writeln!(file, "{}", serde_json::to_string(&payload).unwrap_or_default());
                    }
                    return Err("Payload routed to DLQ".to_string());
                }
                // Backoff
                tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
            }
        }
    }

    Err("Payload routed to DLQ".to_string())
}
