use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use chrono::Utc;

use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct NDARequest {
    #[serde(default)]
    pub disclosing_party: Option<String>,
    #[serde(default)]
    pub receiving_party: Option<String>,
    #[serde(default)]
    pub purpose: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NDAResponse {
    pub document_url: Option<String>,
    pub status: String,
    pub warnings: crate::extensions::WarningMetadata,
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

    async fn execute(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let req: NDARequest = serde_json::from_value(payload.meta_data.clone())
            .unwrap_or_default();

        let mut missing_fields = Vec::new();

        if req.disclosing_party.is_none() {
            missing_fields.push("disclosing_party".to_string());
        }
        if req.receiving_party.is_none() {
            missing_fields.push("receiving_party".to_string());
        }
        if req.purpose.is_none() {
            missing_fields.push("purpose".to_string());
        }

        let timestamp = Utc::now().timestamp_millis();

        let (status, document_url) = if missing_fields.is_empty() {
            (
                "Generated".to_string(),
                Some(format!("https://storage.axim.us.com/secure/docs/temp_nda_{timestamp}.pdf")),
            )
        } else {
            (
                "Partial_Draft".to_string(),
                Some(format!("https://storage.axim.us.com/secure/docs/draft_nda_{timestamp}.pdf")),
            )
        };

        let res = NDAResponse {
            document_url,
            status,
            warnings: crate::extensions::WarningMetadata { missing_fields },
        };

        Ok(json!(res))
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use runtime::dispatch::TaskPriority;

    fn create_payload(meta_data: Value) -> AximWebhookPayload {
        AximWebhookPayload {
            source_channel: format!("channel_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)),
            intent: "generate_nda".to_string(),
            priority: TaskPriority::Standard,
            meta_data,
            timestamp: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_full_nda_payload() {
        let generator = NDAGenerator;
        let disclosing = format!("Disclosing_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let receiving = format!("Receiving_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let purpose = format!("Purpose_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));

        let meta = json!({
            "disclosing_party": disclosing,
            "receiving_party": receiving,
            "purpose": purpose
        });

        let payload = create_payload(meta);
        let result = generator.execute(&payload).await.unwrap();
        let res: NDAResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Generated");
        assert!(res.warnings.missing_fields.is_empty());
        assert!(res.document_url.unwrap().contains("temp_nda_"));
    }

    #[tokio::test]
    async fn test_partial_nda_payload() {
        let generator = NDAGenerator;
        let disclosing = format!("Disclosing_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let meta = json!({
            "disclosing_party": disclosing
        });

        let payload = create_payload(meta);
        let result = generator.execute(&payload).await.unwrap();
        let res: NDAResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Partial_Draft");
        assert!(res.warnings.missing_fields.contains(&"receiving_party".to_string()));
        assert!(res.warnings.missing_fields.contains(&"purpose".to_string()));
        assert!(res.document_url.unwrap().contains("draft_nda_"));
    }

    #[tokio::test]
    async fn test_malformed_nda_payload() {
        let generator = NDAGenerator;
        let meta = json!("completely invalid string");

        let payload = create_payload(meta);
        let result = generator.execute(&payload).await.unwrap();
        let res: NDAResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Partial_Draft");
        assert_eq!(res.warnings.missing_fields.len(), 3);
        assert!(res.document_url.unwrap().contains("draft_nda_"));
    }
}
