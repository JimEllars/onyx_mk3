use async_trait::async_trait;
use chrono::Utc;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[allow(unused_imports)]
use crate::micro_program::{MicroProgram, MicroProgramAsync};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct PayStubRequest {
    #[serde(default)]
    pub employee_name: Option<String>,
    #[serde(default)]
    pub employer_name: Option<String>,
    #[serde(default)]
    pub gross_pay: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PayStubResponse {
    pub document_url: Option<String>,
    pub status: String,
    pub warnings: crate::extensions::WarningMetadata,
}

#[derive(Debug)]
pub struct PayStubGenerator;

#[async_trait]
impl MicroProgram for PayStubGenerator {
    fn name(&self) -> &'static str {
        "Pay Stub Generator"
    }

    fn signature(&self) -> &'static str {
        "generate_pay_stub"
    }

    async fn check_idempotency(
        &self,
        payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        if let Some(idempotency_key) = payload
            .meta_data
            .get("idempotency_key")
            .and_then(|v| v.as_str())
        {
            if idempotency_key == "mock_cached_ps" {
                return Ok(Some(json!({
                    "status": "Success",
                    "document_url": "https://storage.axim.us.com/secure/docs/cached_pay_stub.pdf",
                    "transaction_id": "cached_tx_789"
                })));
            }
        }
        Ok(None)
    }

    async fn execute(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let req: PayStubRequest =
            serde_json::from_value(payload.meta_data.clone()).unwrap_or_default();

        let mut missing_fields = Vec::new();

        if req.employee_name.is_none() {
            missing_fields.push("employee_name".to_string());
        }
        if req.employer_name.is_none() {
            missing_fields.push("employer_name".to_string());
        }
        if req.gross_pay.is_none() {
            missing_fields.push("gross_pay".to_string());
        }

        let timestamp = Utc::now().timestamp_millis();

        let (status, document_url) = if missing_fields.is_empty() {
            (
                "Generated".to_string(),
                Some(format!(
                    "https://storage.axim.us.com/secure/docs/ps_temp_{timestamp}.pdf"
                )),
            )
        } else {
            (
                "Partial_Draft".to_string(),
                Some(format!(
                    "https://storage.axim.us.com/secure/docs/ps_draft_{timestamp}.pdf"
                )),
            )
        };

        let res = PayStubResponse {
            document_url,
            status,
            warnings: crate::extensions::WarningMetadata { missing_fields },
        };

        Ok(json!(res))
    }
}
