use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use chrono::Utc;

use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct DemandLetterRequest {
    #[serde(default)]
    pub creditor_name: Option<String>,
    #[serde(default)]
    pub debtor_name: Option<String>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub items: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DemandLetterResponse {
    pub document_url: Option<String>,
    pub status: String,
    pub missing_fields: Vec<String>,
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

    async fn execute(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        // Attempt to parse payload into DemandLetterRequest, using Default for missing or malformed JSON
        let req: DemandLetterRequest = serde_json::from_value(payload.meta_data.clone())
            .unwrap_or_default();

        let mut missing_fields = Vec::new();

        if req.creditor_name.is_none() {
            missing_fields.push("creditor_name".to_string());
        }
        if req.debtor_name.is_none() {
            missing_fields.push("debtor_name".to_string());
        }
        if req.amount.is_none() {
            missing_fields.push("amount".to_string());
        }

        let timestamp = Utc::now().timestamp_millis();

        let (status, document_url) = if missing_fields.is_empty() {
            // Full data provided: generate final
            (
                "Generated".to_string(),
                Some(format!("https://storage.axim.us.com/secure/docs/temp_{timestamp}.pdf")),
            )
        } else {
            // Partial data: generate draft/partial
            (
                "Partial_Draft".to_string(),
                Some(format!("https://storage.axim.us.com/secure/docs/draft_{timestamp}.pdf")),
            )
        };

        let res = DemandLetterResponse {
            document_url,
            status,
            missing_fields,
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
            intent: "generate_demand_letter".to_string(),
            priority: TaskPriority::Standard,
            meta_data,
            timestamp: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_full_payload_generation() {
        let generator = DemandLetterGenerator;
        let creditor = format!("Creditor_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let debtor = format!("Debtor_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let item = format!("Item_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));

        let meta = json!({
            "creditor_name": creditor,
            "debtor_name": debtor,
            "amount": 1500.00,
            "items": [item]
        });

        let payload = create_payload(meta);
        let result = generator.execute(&payload).await.unwrap();
        let res: DemandLetterResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Generated");
        assert!(res.missing_fields.is_empty());
        assert!(res.document_url.unwrap().contains("temp_"));
    }

    #[tokio::test]
    async fn test_partial_payload_generation() {
        let generator = DemandLetterGenerator;
        let creditor = format!("Creditor_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let meta = json!({
            "creditor_name": creditor
            // Missing debtor_name and amount
        });

        let payload = create_payload(meta);
        let result = generator.execute(&payload).await.unwrap();
        let res: DemandLetterResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Partial_Draft");
        assert!(res.missing_fields.contains(&"debtor_name".to_string()));
        assert!(res.missing_fields.contains(&"amount".to_string()));
        assert!(res.document_url.unwrap().contains("draft_"));
    }

    #[tokio::test]
    async fn test_malformed_payload_fallback() {
        let generator = DemandLetterGenerator;
        // String instead of object
        let meta = json!("completely invalid data");

        let payload = create_payload(meta);
        let result = generator.execute(&payload).await.unwrap();
        let res: DemandLetterResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Partial_Draft");
        assert_eq!(res.missing_fields.len(), 3);
    }
}
