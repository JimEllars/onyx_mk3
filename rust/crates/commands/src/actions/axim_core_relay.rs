use ring::hmac;
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct AximCoreRelayAction;

impl AximCoreRelayAction {
    pub async fn execute(payload: &Value) -> Result<(), String> {
        let endpoint_env = "AXIM_CORE_API_URL";
        let key_env = "AXIM_INTERNAL_KEY";

        let webhook_url =
            std::env::var(endpoint_env).map_err(|e| format!("Missing {endpoint_env}: {e}"))?;
        let secret_key = std::env::var(key_env).unwrap_or_default();

        let payload_str =
            serde_json::to_string(payload).map_err(|e| format!("Serialization error: {e}"))?;

        let key = hmac::Key::new(hmac::HMAC_SHA256, secret_key.as_bytes());
        let signature = hmac::sign(&key, payload_str.as_bytes());
        let signature_hex = hex::encode(signature.as_ref());

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(5000))
            .build()
            .map_err(|e| format!("Client build error: {e}"))?;

        let res = client
            .post(&webhook_url)
            .header("Content-Type", "application/json")
            .header("X-Axim-Signature", format!("sha256={signature_hex}"))
            .body(payload_str.clone())
            .send()
            .await;

        match res {
            Ok(response) if response.status().is_success() => Ok(()),
            Ok(response) => {
                let status = response.status();
                let error_msg = format!("HTTP error: {status}");
                Self::write_to_dlq(payload, &webhook_url, &error_msg).await;
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Network error: {e}");
                Self::write_to_dlq(payload, &webhook_url, &error_msg).await;
                Ok(())
            }
        }
    }

    #[allow(clippy::unused_async)]
    pub async fn write_to_dlq(payload: &Value, endpoint: &str, reason: &str) {
        let dlq_path = std::path::PathBuf::from(".claw/unsynced_relays.jsonl");
        if let Some(parent) = dlq_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let dlq_entry = serde_json::json!({
            "timestamp": timestamp.to_string(),
            "endpoint": endpoint,
            "payload": payload,
            "reason": reason
        });

        if let Ok(dlq_str) = serde_json::to_string(&dlq_entry) {
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&dlq_path) {
                let _ = writeln!(file, "{dlq_str}");
            }
        }
    }
}
