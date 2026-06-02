use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use runtime::api_specs::webhook_payload::AximWebhookPayload;

use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize)]
pub struct NDARequest {
    pub disclosing_party: String,
    pub receiving_party: String,
    pub purpose: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NDAResponse {
    pub document_url: String,
    pub status: String,
}

#[derive(Debug)]
pub struct NDAGenerator;

#[async_trait]
impl MicroProgram for NDAGenerator {
    fn name(&self) -> &'static str {
        "NDA Generator"
    }

    fn signature(&self) -> &'static str {
        "generate_nda"
    }

    async fn execute(&self, _payload: &AximWebhookPayload) -> Result<Value, String> {
        // Here we would parse _payload.meta_data into NDARequest
        // For now, return a mock response
        let res = NDAResponse {
            document_url: "https://storage.axim.us.com/secure/docs/temp_nda_xyz.pdf".to_string(),
            status: "Generated".to_string(),
        };
        Ok(json!(res))
    }
}
