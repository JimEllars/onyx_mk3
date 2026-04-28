use reqwest;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

pub async fn stream_log_to_ui(worker_id: &str, message: &str, role: &str) {
    if let Ok(endpoint) = std::env::var("AXIM_CORE_UI_STREAM_ENDPOINT") {
        let current_unix_epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let payload = json!({
            "worker_id": worker_id,
            "message": message,
            "role": role,
            "timestamp": current_unix_epoch
        });

        // Fire and forget, don't crash on network failure
        let client = reqwest::Client::new();
        let _ = client.post(&endpoint).json(&payload).send().await;
    }
}
