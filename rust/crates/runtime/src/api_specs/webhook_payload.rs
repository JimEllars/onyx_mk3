use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::dispatch::TaskPriority;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AximWebhookPayload {
    pub source_channel: String,
    pub intent: String,
    pub priority: TaskPriority,
    pub meta_data: Value,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

impl AximWebhookPayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.source_channel.trim().is_empty() {
            return Err("source_channel cannot be empty".into());
        }
        if self.intent.trim().is_empty() {
            return Err("intent cannot be empty".into());
        }
        if !self.meta_data.is_object() {
            return Err("meta_data must be a valid JSON object".into());
        }
        Ok(())
    }
}
