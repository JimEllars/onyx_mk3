use commands::extensions::{
    demand_letter::{DemandLetterGenerator, DemandLetterResponse},
    nda::{NDAGenerator, NDAResponse},
    lead_scoring::{PredictiveLeadScoring, LeadScoringResponse},
};
use commands::micro_program::MicroProgram;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use runtime::dispatch::TaskPriority;
use serde_json::json;
use chrono::Utc;

#[tokio::test]
async fn test_end_to_end_pipeline() {
    let lead_scorer = PredictiveLeadScoring;
    let nda_gen = NDAGenerator;
    let demand_letter_gen = DemandLetterGenerator;

    let payload = AximWebhookPayload {
        source_channel: "test".to_string(),
        intent: "sync_lead_enrich".to_string(),
        priority: TaskPriority::Standard,
        meta_data: json!({
            "lead_id": "lead_123",
            "industry": "technology",
            "company_size": 200,
        }),
        timestamp: Utc::now(),
    };

    let score_res_val = lead_scorer.execute(&payload).await.unwrap();
    let score_res: LeadScoringResponse = serde_json::from_value(score_res_val).unwrap();

    assert_eq!(score_res.status, "Enriched");

    let nda_payload = AximWebhookPayload {
        source_channel: "test".to_string(),
        intent: "generate_nda".to_string(),
        priority: TaskPriority::Standard,
        meta_data: json!({
            "disclosing_party": "Axim",
            "receiving_party": "lead_123",
            "purpose": "Evaluation",
        }),
        timestamp: Utc::now(),
    };

    let nda_res_val = nda_gen.execute(&nda_payload).await.unwrap();
    let nda_res: NDAResponse = serde_json::from_value(nda_res_val).unwrap();

    assert_eq!(nda_res.status, "Generated");

    let dl_payload = AximWebhookPayload {
        source_channel: "test".to_string(),
        intent: "generate_demand_letter".to_string(),
        priority: TaskPriority::Standard,
        meta_data: json!({
            "creditor_name": "Axim",
            "debtor_name": "lead_123",
            "amount": 100.0,
            "items": ["Item A"]
        }),
        timestamp: Utc::now(),
    };

    let dl_res_val = demand_letter_gen.execute(&dl_payload).await.unwrap();
    let dl_res: DemandLetterResponse = serde_json::from_value(dl_res_val).unwrap();

    assert_eq!(dl_res.status, "Generated");
}

#[tokio::test]
async fn test_fuzzing_edge_cases() {
    let lead_scorer = PredictiveLeadScoring;
    let nda_gen = NDAGenerator;
    let demand_letter_gen = DemandLetterGenerator;

    // Test deeply nested empty object
    let payload_empty_obj = AximWebhookPayload {
        source_channel: "test".to_string(),
        intent: "sync_lead_enrich".to_string(),
        priority: TaskPriority::Standard,
        meta_data: json!({ "nested": {} }),
        timestamp: Utc::now(),
    };

    let score_res_val = lead_scorer.execute(&payload_empty_obj).await.unwrap();
    let score_res: LeadScoringResponse = serde_json::from_value(score_res_val).unwrap();
    assert_eq!(score_res.status, "Partial_Enrichment");
    assert_eq!(score_res.warnings.missing_fields.len(), 3);

    // Test wrong types (numbers instead of strings, array instead of object)
    let nda_payload_wrong_type = AximWebhookPayload {
        source_channel: "test".to_string(),
        intent: "generate_nda".to_string(),
        priority: TaskPriority::Standard,
        meta_data: json!({
            "disclosing_party": 123,
            "receiving_party": ["array"],
            "purpose": true
        }),
        timestamp: Utc::now(),
    };

    let nda_res_val = nda_gen.execute(&nda_payload_wrong_type).await.unwrap();
    let nda_res: NDAResponse = serde_json::from_value(nda_res_val).unwrap();
    assert_eq!(nda_res.status, "Partial_Draft");

    let dl_payload_wrong_type = AximWebhookPayload {
        source_channel: "test".to_string(),
        intent: "generate_demand_letter".to_string(),
        priority: TaskPriority::Standard,
        meta_data: json!([1, 2, 3]),
        timestamp: Utc::now(),
    };

    let dl_res_val = demand_letter_gen.execute(&dl_payload_wrong_type).await.unwrap();
    let dl_res: DemandLetterResponse = serde_json::from_value(dl_res_val).unwrap();
    assert_eq!(dl_res.status, "Partial_Draft");
}
