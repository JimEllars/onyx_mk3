cat << 'INNER_EOF' > rust/crates/runtime/src/axim_stream.rs
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

pub async fn stream_voice_response(worker_id: &str, message: &str) -> Result<(), String> {
    let endpoint = std::env::var("AXIM_CORE_VOICE_STREAM_ENDPOINT")
        .map_err(|_| "AXIM_CORE_VOICE_STREAM_ENDPOINT not configured".to_string())?;

    // Removed std::env::var("AXIM_SERVICE_KEY") to prevent secret sniffing.
    // Replace crate::ecosystem_tools::fetch_temporal_credential with tools::axim_vault::fetch_temporal_credential
    let service_key = tools::axim_vault::fetch_temporal_credential("voice_stream")
        .await
        .map_err(|e| e.to_string())?;

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

    Ok(())
}

pub async fn stream_assistant_event(worker_id: &str, event_type: &str, data: serde_json::Value) {
    if let Ok(endpoint) = std::env::var("AXIM_CORE_SSE_STREAM_ENDPOINT") {
        // Fire and forget execution to avoid crashing the runner
        let _ = tokio::spawn({
            let worker_id = worker_id.to_string();
            let event_type = event_type.to_string();
            async move {
                // Fixed: Replace crate::ecosystem_tools::fetch_temporal_credential with tools::axim_vault::fetch_temporal_credential
                if let Ok(token) = tools::axim_vault::fetch_temporal_credential("axim_core_stream").await {
                    let current_unix_epoch = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();

                    let payload = json!({
                        "worker_id": worker_id,
                        "event_type": event_type,
                        "data": data,
                        "timestamp": current_unix_epoch
                    });

                    let client = reqwest::Client::builder()
                        .timeout(std::time::Duration::from_secs(5))
                        .build()
                        .unwrap_or_default();

                    // Fire and forget, don't crash on network failure
                    let _ = client
                        .post(&endpoint)
                        .header("Authorization", format!("Bearer {}", token))
                        .header("Content-Type", "application/json")
                        .json(&payload)
                        .send()
                        .await;
                }
            }
        });
    }
}
INNER_EOF
