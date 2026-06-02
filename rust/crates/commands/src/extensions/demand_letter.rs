use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use runtime::api_specs::webhook_payload::AximWebhookPayload;

use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize)]
pub struct DemandLetterRequest {
    pub creditor_name: String,
    pub debtor_name: String,
    pub amount: f64,
    pub items: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DemandLetterResponse {
    pub document_url: String,
    pub status: String,
}

#[derive(Debug)]
pub struct DemandLetterGenerator;

#[async_trait]
impl MicroProgram for DemandLetterGenerator {
    fn name(&self) -> &'static str {
        "Demand Letter Generator"
    }

    fn signature(&self) -> &'static str {
        "generate_demand_letter"
    }

    async fn execute(&self, _payload: &AximWebhookPayload) -> Result<Value, String> {
        // Here we would parse _payload.meta_data into DemandLetterRequest
        // For now, return a mock response
        let res = DemandLetterResponse {
            document_url: "https://storage.axim.us.com/secure/docs/temp_a1b2c3.pdf".to_string(),
            status: "Generated".to_string(),
        };
        Ok(json!(res))
    }
}
