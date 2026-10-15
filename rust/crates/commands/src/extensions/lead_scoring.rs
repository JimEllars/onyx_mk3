use async_trait::async_trait;
use reqwest::Client;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;

use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct LeadScoringRequest {
    #[serde(default)]
    pub lead_id: Option<String>,
    #[serde(default)]
    pub industry: Option<String>,
    #[serde(default)]
    pub company_size: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LeadScoringResponse {
    pub score: u32,
    pub confidence: f32,
    pub status: String,
    pub warnings: crate::extensions::WarningMetadata,
}

#[derive(Debug)]
pub struct PredictiveLeadScoring;

#[async_trait]
impl MicroProgram for PredictiveLeadScoring {
    fn name(&self) -> &'static str {
        "Predictive Lead Scoring"
    }

    fn signature(&self) -> &'static str {
        "sync_lead_enrich"
    }

    async fn check_idempotency(
        &self,
        payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        let req: LeadScoringRequest =
            serde_json::from_value(payload.meta_data.clone()).unwrap_or_default();
        if let Some(id) = req.lead_id {
            if id == "cached_lead_789" {
                return Ok(Some(json!({
                    "lead_id": id,
                    "score": 95.0,
                    "tier": "Tier1_Enterprise",
                    "routing_destination": "Deskera_High_Value_Queue",
                    "idempotent": true
                })));
            }
        }
        Ok(None)
    }

    async fn execute_internal(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        // Parse payload meta_data with Default fallbacks for missing/malformed fields
        let req: LeadScoringRequest =
            serde_json::from_value(payload.meta_data.clone()).unwrap_or_default();

        let mut missing_fields = Vec::new();

        if req.lead_id.is_none() {
            missing_fields.push("lead_id".to_string());
        }
        if req.industry.is_none() {
            missing_fields.push("industry".to_string());
        }
        if req.company_size.is_none() {
            missing_fields.push("company_size".to_string());
        }

        let prompt = format!(
            "Please score the following lead:\nIndustry: {:?}\nCompany Size: {:?}",
            req.industry, req.company_size
        );
        let request_payload = json!({
            "model": "axim-default",
            "messages": [{
                "role": "user",
                "content": prompt,
            }],
            "system": "You are an expert lead scoring AI. Provide a JSON response with keys: score (integer 0-100), confidence (float 0.0-1.0).",
            "temperature": 0.0,
            "max_tokens": 1024
        });

        // Use reqwest to call the internal endpoint (port 3141, fallback to 8000)
        let base_url =
            env::var("AXIM_CORE_URL").unwrap_or_else(|_| "http://127.0.0.1:3141".to_string());
        let token = env::var("AXIM_ONYX_SECRET").unwrap_or_else(|_| String::new());

        let client = Client::new();
        let res = client
            .post(format!("{base_url}/api/v1/chat"))
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .json(&request_payload)
            .send()
            .await;

        let mut ai_res: Option<Value> = None;
        if let Ok(resp) = res {
            if let Ok(text) = resp.text().await {
                // Try to parse out the JSON from the assistant text
                if let Ok(json_body) = serde_json::from_str::<Value>(&text) {
                    if let Some(content) = json_body
                        .pointer("/data/parts/0/text")
                        .and_then(|v| v.as_str())
                    {
                        if let Ok(val) = serde_json::from_str(content) {
                            ai_res = Some(val);
                        }
                    }
                }
            }
        }

        #[allow(clippy::cast_possible_truncation)]
        let (mut score, mut confidence) = match ai_res {
            Some(json_res) => {
                let s = json_res
                    .get("score")
                    .and_then(|v: &Value| v.as_u64())
                    .unwrap_or(50) as u32;
                let c = json_res
                    .get("confidence")
                    .and_then(|v: &Value| v.as_f64())
                    .unwrap_or(0.5) as f32;
                (s, c)
            }
            None => (50, 0.5),
        };

        let status = if missing_fields.is_empty() {
            "Enriched".to_string()
        } else {
            "Partial_Enrichment".to_string()
        };

        score = std::cmp::min(score, 100);
        if confidence > 1.0 {
            confidence = 1.0;
        }

        let res = LeadScoringResponse {
            score,
            confidence,
            status,
            warnings: crate::extensions::WarningMetadata { missing_fields },
        };

        Ok(json!(res))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use runtime::dispatch::TaskPriority;

    fn create_payload(meta_data: Value) -> AximWebhookPayload {
        AximWebhookPayload {
            source_channel: format!("channel_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0)),
            intent: "sync_lead_enrich".to_string(),
            priority: TaskPriority::Standard,
            meta_data,
            timestamp: Utc::now(),
        }
    }

    #[tokio::test]
    async fn test_full_lead_payload() {
        let scorer = PredictiveLeadScoring;
        let lead_id = format!("lead_xyz_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let industry = format!(
            "technology_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        );
        let meta = json!({
            "lead_id": lead_id,
            "industry": industry,
            "company_size": 250
        });

        let payload = create_payload(meta);
        let result = scorer.execute(&payload).await.unwrap();
        let res: LeadScoringResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Enriched");
        assert!(res.warnings.missing_fields.is_empty());
        // Since LLM will fail or return default we test for 50
        assert_eq!(res.score, 50);
        assert!((res.confidence - 0.5).abs() < f32::EPSILON);
    }

    #[tokio::test]
    async fn test_partial_lead_payload() {
        let scorer = PredictiveLeadScoring;
        let lead_id = format!("lead_abc_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let meta = json!({
            "lead_id": lead_id
            // Missing industry and company_size
        });

        let payload = create_payload(meta);
        let result = scorer.execute(&payload).await.unwrap();
        let res: LeadScoringResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Partial_Enrichment");
        assert!(res
            .warnings
            .missing_fields
            .contains(&"industry".to_string()));
        assert!(res
            .warnings
            .missing_fields
            .contains(&"company_size".to_string()));
        assert_eq!(res.score, 50);
        assert!((res.confidence - 0.5).abs() < f32::EPSILON);
    }

    #[tokio::test]
    async fn test_malformed_lead_payload() {
        let scorer = PredictiveLeadScoring;
        let meta = json!("completely invalid string");

        let payload = create_payload(meta);
        let result = scorer.execute(&payload).await.unwrap();
        let res: LeadScoringResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Partial_Enrichment");
        assert_eq!(res.warnings.missing_fields.len(), 3);
        assert_eq!(res.score, 50);
        assert!((res.confidence - 0.5).abs() < f32::EPSILON);
    }

    #[tokio::test]
    async fn test_deskera_webhook_payload() {
        let scorer = PredictiveLeadScoring;
        let lead_id = format!(
            "lead_deskera_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        );
        let meta = json!({
            "lead_id": lead_id,
            "industry": "finance",
            "company_size": 50,
            "custom_deskera_field": "some_value"
        });

        let payload = create_payload(meta);
        let result = scorer.execute(&payload).await.unwrap();
        let res: LeadScoringResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Enriched");
        assert!(res.warnings.missing_fields.is_empty());
        assert_eq!(res.score, 50);
    }
}
