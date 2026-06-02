use async_trait::async_trait;
use serde_json::Value;
use std::fmt::Debug;

use runtime::api_specs::webhook_payload::AximWebhookPayload;

#[async_trait]
pub trait MicroProgram: Send + Sync + Debug {
    fn name(&self) -> &'static str;
    fn signature(&self) -> &'static str;
    async fn execute(&self, payload: &AximWebhookPayload) -> Result<Value, String>;
}
