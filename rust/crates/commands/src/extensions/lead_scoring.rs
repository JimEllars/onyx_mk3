use async_trait::async_trait;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
    pub missing_fields: Vec<String>,
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

    async fn execute(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        // Parse payload meta_data with Default fallbacks for missing/malformed fields
        let req: LeadScoringRequest = serde_json::from_value(payload.meta_data.clone())
            .unwrap_or_default();

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

        // Calculate a score based on provided fields safely
        let mut score = 50; // Base score
        let mut confidence = 0.5; // Base confidence

        if let Some(ref ind) = req.industry {
            if ind.to_lowercase().contains("tech") {
                score += 20;
            } else {
                score += 10;
            }
            confidence += 0.2;
        }

        if let Some(size) = req.company_size {
            if size > 100 {
                score += 20;
            } else {
                score += 10;
            }
            confidence += 0.2;
        }

        // Cap at 100 max score and 1.0 confidence
        score = std::cmp::min(score, 100);
        if confidence > 1.0 {
            confidence = 1.0;
        }

        let status = if missing_fields.is_empty() {
            "Enriched".to_string()
        } else {
            "Partial_Enrichment".to_string()
        };

        let res = LeadScoringResponse {
            score,
            confidence,
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
    use chrono::Utc;

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
        let industry = format!("technology_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let meta = json!({
            "lead_id": lead_id,
            "industry": industry,
            "company_size": 250
        });

        let payload = create_payload(meta);
        let result = scorer.execute(&payload).await.unwrap();
        let res: LeadScoringResponse = serde_json::from_value(result).unwrap();

        assert_eq!(res.status, "Enriched");
        assert!(res.missing_fields.is_empty());
        assert_eq!(res.score, 90); // 50 base + 20 tech + 20 >100 size
        assert!((res.confidence - 0.9).abs() < f32::EPSILON);
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
        assert!(res.missing_fields.contains(&"industry".to_string()));
        assert!(res.missing_fields.contains(&"company_size".to_string()));
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
        assert_eq!(res.missing_fields.len(), 3);
        assert_eq!(res.score, 50);
        assert!((res.confidence - 0.5).abs() < f32::EPSILON);
    }
}
