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

        let Ok(webhook_url) = std::env::var(endpoint_env) else {
            // Fallback to Supabase
            Self::fallback_to_supabase(payload).await?;
            return Ok(());
        };

        // Fail closed: signing with an empty key (the old `unwrap_or_default`)
        // produced a valid-looking signature that no receiver would accept, and
        // hid the misconfiguration until delivery failed.
        let secret_key = std::env::var(key_env)
            .map_err(|_| format!("{key_env} is not set; refusing to send an unsigned relay"))?;

        let payload_str =
            serde_json::to_string(payload).map_err(|e| format!("Serialization error: {e}"))?;

        // Version 2 signature: HMAC over "<timestamp>.<body>", with the timestamp
        // sent in a header. Binding the timestamp into the signed bytes means a
        // captured request cannot be re-dated. Receivers accept the legacy
        // body-only form until their SIGNATURE_LEGACY_SUNSET.
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string();
        let signed_payload = format!("{timestamp}.{payload_str}");

        let key = hmac::Key::new(hmac::HMAC_SHA256, secret_key.as_bytes());
        let signature = hmac::sign(&key, signed_payload.as_bytes());
        let signature_hex = hex::encode(signature.as_ref());

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(5000))
            .build()
            .map_err(|e| format!("Client build error: {e}"))?;

        let res = client
            .post(&webhook_url)
            .header("Content-Type", "application/json")
            .header("X-Axim-Timestamp", timestamp.as_str())
            .header("X-Axim-Signature-Version", "2")
            .header("X-Axim-Signature", format!("sha256={signature_hex}"))
            .body(payload_str.clone())
            .send()
            .await;

        match res {
            Ok(response) if response.status().is_success() => Ok(()),
            Ok(response) => {
                let status = response.status();
                let error_msg = format!("HTTP error: {status}");

                // Fallback to Supabase on non-success status
                Self::fallback_to_supabase(payload).await?;
                Self::write_to_dlq(payload, &webhook_url, &error_msg).await;
                Ok(())
            }
            Err(e) => {
                let error_msg = format!("Network error: {e}");

                // Fallback to Supabase on network error
                Self::fallback_to_supabase(payload).await?;
                Self::write_to_dlq(payload, &webhook_url, &error_msg).await;
                Ok(())
            }
        }
    }

    async fn fallback_to_supabase(payload: &Value) -> Result<(), String> {
        let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
        let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default();

        if supabase_url.is_empty() || supabase_key.is_empty() {
            return Err("Missing Supabase credentials for fallback".to_string());
        }

        let client = reqwest::Client::new();
        let url = format!("{supabase_url}/rest/v1/axim_core_events");

        let source = payload
            .get("source_channel")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let intent = payload
            .get("intent")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let metadata = payload
            .get("meta_data")
            .unwrap_or(&serde_json::json!({}))
            .clone();

        let db_payload = serde_json::json!({
            "source": source,
            "intent": intent,
            "metadata": metadata,
        });

        let res = client
            .post(&url)
            .header("apikey", &supabase_key)
            .header("Authorization", format!("Bearer {supabase_key}"))
            .header("Content-Type", "application/json")
            .json(&db_payload)
            .send()
            .await
            .map_err(|e| format!("Supabase fallback network error: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("Supabase fallback error: {}", res.status()));
        }

        Ok(())
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
