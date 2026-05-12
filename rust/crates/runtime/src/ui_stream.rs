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

pub async fn broadcast_swarm_state(active_agents: Vec<serde_json::Value>) {
    if let Ok(endpoint) = std::env::var("AXIM_CORE_SWARM_STATE_ENDPOINT") {
        let current_unix_epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let payload = json!({
            "event": "swarm_update",
            "active_agents": active_agents,
            "timestamp": current_unix_epoch
        });

        // Fire and forget, don't crash on network failure
        let client = reqwest::Client::new();
        let _ = client.post(&endpoint).json(&payload).send().await;
    }
}

pub async fn stream_voice_response(worker_id: &str, message: &str) {
    let endpoint = std::env::var("AXIM_CORE_VOICE_STREAM_ENDPOINT")
        .unwrap_or_else(|_| "https://api.axim.us.com/api/v1/voice/stream".to_string());

    // In actual implementation, should correctly import tools depending on dependency tree
    let service_key = std::env::var("AXIM_SERVICE_KEY").unwrap_or_default();

    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "worker_id": worker_id,
        "message": message,
    });

    let _ = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;
}
