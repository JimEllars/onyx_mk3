use async_trait::async_trait;
use chrono::Utc;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::actions::google_sheets::GoogleSheetsAction;
use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct OrchestratorRequest {
    #[serde(default)]
    pub lead_id: Option<String>,
    #[serde(default)]
    pub score: Option<u32>,
    #[serde(default)]
    pub transaction_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OrchestratorResponse {
    pub status: String,
    pub warnings: crate::extensions::WarningMetadata,
}

#[derive(Debug)]
pub struct AutonomousOrchestrator;

#[async_trait]
impl MicroProgram for AutonomousOrchestrator {
    fn name(&self) -> &'static str {
        "Autonomous Orchestrator"
    }

    fn signature(&self) -> &'static str {
        "autonomous_orchestrator"
    }

    async fn check_idempotency(
        &self,
        _payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        Ok(None)
    }

    async fn execute_internal(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let req: OrchestratorRequest =
            serde_json::from_value(payload.meta_data.clone()).unwrap_or_default();

        let mut missing_fields = Vec::new();

        if req.lead_id.is_none() {
            missing_fields.push("lead_id".to_string());
        }
        if req.score.is_none() {
            missing_fields.push("score".to_string());
        }
        if req.transaction_id.is_none() {
            missing_fields.push("transaction_id".to_string());
        }

        if missing_fields.is_empty() {
            if let Some(score) = req.score {
                if score > 85 {
                    let tx_id = req.transaction_id.clone().unwrap_or_default();
                    let timestamp = Utc::now().to_rfc3339();

                    println!("Mock: Triggering smart contract for transaction {tx_id}");

                    let log_payload = json!({
                        "transaction_id": tx_id,
                        "score": score,
                        "timestamp": timestamp,
                    });

                    let _ = GoogleSheetsAction::log_record(&log_payload).await;
                }
            }
        }

        let status = if missing_fields.is_empty() {
            "Orchestrated".to_string()
        } else {
            "Missing_Fields".to_string()
        };

        let res = OrchestratorResponse {
            status,
            warnings: crate::extensions::WarningMetadata { missing_fields },
        };

        Ok(json!(res))
    }
}
