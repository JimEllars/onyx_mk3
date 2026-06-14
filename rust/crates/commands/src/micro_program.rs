use async_trait::async_trait;
use serde_json::Value;
use std::fmt::Debug;

use runtime::api_specs::webhook_payload::AximWebhookPayload;

#[async_trait]
pub trait MicroProgram: Send + Sync + Debug {
    fn name(&self) -> &'static str;
    fn signature(&self) -> &'static str;
    async fn execute(&self, _payload: &AximWebhookPayload) -> Result<Value, String>;

    /// Check if the payload has already been executed based on its idempotency key.
    /// By default, it returns None (not implemented). Extensions can override this
    /// to query the central `api_usage_logs`.
    async fn check_idempotency(
        &self,
        __payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        Ok(None)
    }
}

#[async_trait]
pub trait MicroProgramAsync: MicroProgram {
    /// Defer execution for long-running asynchronous tasks (e.g., PDF generation).
    /// Returns a 202 Accepted status with a Job ID, packaging the execution context.
    async fn execute_deferred(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let job_id = uuid::Uuid::new_v4().to_string();

        let axim_core_url = std::env::var("AXIM_CORE_URL")
            .unwrap_or_else(|_| "https://api.axim.us.com".to_string());
        let axim_mcp_token = std::env::var("AXIM_MCP_TOKEN").unwrap_or_else(|_| String::new());

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Failed to build client: {e}"))?;

        // 1. Send stateless initialization intent to establish polling marker immediately
        let intent_url = format!("{axim_core_url}/api/v1/satellite_job_queue/intent");
        let intent_payload = serde_json::json!({
            "job_id": job_id,
            "signature": self.signature(),
            "status": "initializing",
            "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
        });

        let intent_res = client
            .post(&intent_url)
            .header("Authorization", format!("Bearer {axim_mcp_token}"))
            .header("Content-Type", "application/json")
            .json(&intent_payload)
            .send()
            .await;

        match intent_res {
            Ok(res) if res.status().is_success() => {
                println!("Successfully registered INIT state for job {job_id}");
            }
            Ok(res) => {
                return Err(format!(
                    "Failed to register INIT state for job {job_id}: HTTP {}",
                    res.status()
                ));
            }
            Err(e) => {
                return Err(format!(
                    "Failed to register INIT state for job {job_id}: {e}"
                ));
            }
        }

        // 2. Dispatch heavy execution payload securely
        let url = format!("{axim_core_url}/api/v1/satellite_job_queue/spawn");

        let mut secure_payload = payload.clone();
        if let serde_json::Value::Object(ref mut map) = secure_payload.meta_data {
            map.remove("STRIPE_SECRET_KEY");
            map.remove("SUPABASE_SERVICE_ROLE_KEY");
        }

        let request_payload = serde_json::json!({
            "job_id": job_id,
            "signature": self.signature(),
            "payload": secure_payload,
            "type": "satellite_job"
        });

        let request = client
            .post(&url)
            .header("Authorization", format!("Bearer {axim_mcp_token}"))
            .header("Content-Type", "application/json")
            .json(&request_payload);

        match request.send().await {
            Ok(res) if res.status().is_success() => {
                println!("Successfully dispatched job {job_id} to satellite queue");
            }
            Ok(res) => {
                eprintln!(
                    "Failed to dispatch job {} to satellite queue: HTTP {}",
                    job_id,
                    res.status()
                );
            }
            Err(e) => {
                eprintln!("Failed to dispatch job {job_id} to satellite queue: {e}");
            }
        }

        // Return structured 202 Accepted
        Ok(serde_json::json!({
            "status": 202,
            "message": "Accepted",
            "job_id": job_id,
            "signature": self.signature(),
        }))
    }
}
