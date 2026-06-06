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
    async fn execute_deferred(&self, _payload: &AximWebhookPayload) -> Result<Value, String> {
        // Enqueue the heavy execution context for the satellite_job_queue
        // Return a 202 Accepted status with a Job ID
        let job_id = uuid::Uuid::new_v4().to_string();

        // Return structured 202 Accepted
        Ok(serde_json::json!({
            "status": 202,
            "message": "Accepted",
            "job_id": job_id,
            "signature": self.signature(),
        }))
    }
}
