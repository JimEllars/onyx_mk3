use std::time::{SystemTime, UNIX_EPOCH};

pub struct DistributedLock;

impl DistributedLock {
    pub async fn acquire(resource_id: &str, ttl_secs: u64) -> Result<bool, String> {
        let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
        let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
            .unwrap_or_else(|_| std::env::var("AXIM_ONYX_SECRET").unwrap_or_default());

        if supabase_url.is_empty() || supabase_key.is_empty() {
            return Err("Missing Supabase credentials for locks".to_string());
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let expires_at = now + ttl_secs;

        let client = reqwest::Client::new();
        let url = format!("{supabase_url}/rest/v1/execution_locks");

        let payload = serde_json::json!({
            "resource_id": resource_id,
            "expires_at": expires_at,
        });

        // Use Postgres ON CONFLICT or simple insert if unique constraint fails.
        // We do a simple insert. If it fails with 409 Conflict, lock is held.
        let res = client
            .post(&url)
            .header("apikey", &supabase_key)
            .header("Authorization", format!("Bearer {supabase_key}"))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Network error: {e}"))?;

        if res.status() == reqwest::StatusCode::CONFLICT {
            // Check if the existing lock is expired
            let get_url = format!("{url}?resource_id=eq.{resource_id}");
            let get_res = client
                .get(&get_url)
                .header("apikey", &supabase_key)
                .header("Authorization", format!("Bearer {supabase_key}"))
                .send()
                .await
                .map_err(|e| format!("Network error fetching lock: {e}"))?;

            if get_res.status().is_success() {
                let locks: Vec<serde_json::Value> = get_res.json().await.unwrap_or_default();
                if let Some(lock) = locks.first() {
                    if let Some(exp) = lock["expires_at"].as_u64() {
                        if now > exp {
                            // Lock is expired, try to update it
                            let patch_url = format!("{url}?resource_id=eq.{resource_id}");
                            let patch_res = client
                                .patch(&patch_url)
                                .header("apikey", &supabase_key)
                                .header("Authorization", format!("Bearer {supabase_key}"))
                                .header("Content-Type", "application/json")
                                .json(&payload)
                                .send()
                                .await
                                .map_err(|e| format!("Network error updating lock: {e}"))?;
                            return Ok(patch_res.status().is_success());
                        }
                    }
                }
            }
            return Ok(false);
        }

        Ok(res.status().is_success())
    }

    pub async fn release(resource_id: &str) -> Result<(), String> {
        let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
        let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
            .unwrap_or_else(|_| std::env::var("AXIM_ONYX_SECRET").unwrap_or_default());

        if supabase_url.is_empty() || supabase_key.is_empty() {
            return Err("Missing Supabase credentials for locks".to_string());
        }

        let client = reqwest::Client::new();
        let url = format!("{supabase_url}/rest/v1/execution_locks?resource_id=eq.{resource_id}");

        let res = client
            .delete(&url)
            .header("apikey", &supabase_key)
            .header("Authorization", format!("Bearer {supabase_key}"))
            .send()
            .await
            .map_err(|e| format!("Network error releasing lock: {e}"))?;

        if !res.status().is_success() {
            return Err(format!(
                "Supabase API error releasing lock: {}",
                res.status()
            ));
        }

        Ok(())
    }
}
