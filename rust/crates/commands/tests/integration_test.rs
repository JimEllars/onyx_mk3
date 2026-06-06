use chrono::Utc;
use commands::extensions::{
    demand_letter::{DemandLetterGenerator, DemandLetterResponse},
    lead_scoring::{LeadScoringResponse, PredictiveLeadScoring},
    nda::{NDAGenerator, NDAResponse},
};
use commands::micro_program::MicroProgram;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use runtime::dispatch::TaskPriority;
use serde_json::json;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

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

    let dl_res_val = demand_letter_gen
        .execute(&dl_payload_wrong_type)
        .await
        .unwrap();
    let dl_res: DemandLetterResponse = serde_json::from_value(dl_res_val).unwrap();
    assert_eq!(dl_res.status, "Partial_Draft");
}

#[tokio::test]
async fn test_concurrent_payload_stress_and_latency() {
    let lead_scorer = Arc::new(PredictiveLeadScoring);
    let demand_letter_gen = Arc::new(DemandLetterGenerator);
    let mut handles = vec![];

    let concurrency_level: u32 = 60; // Fire 60+ simultaneous payloads

    for i in 0..concurrency_level {
        let scorer = Arc::clone(&lead_scorer);
        let dl_gen = Arc::clone(&demand_letter_gen);

        let handle = tokio::spawn(async move {
            // Introduce artificial network latency (200ms - 1500ms)
            // Use simple pseudo-random generation based on iterator
            let latency_ms: u64 = u64::from(200 + (i * 21) % 1300);
            sleep(Duration::from_millis(latency_ms)).await;

            // Fuzzing with fragmented/partial payloads
            let is_partial = i % 2 == 0;

            let lead_payload = AximWebhookPayload {
                source_channel: format!("stress_test_{i}"),
                intent: "sync_lead_enrich".to_string(),
                priority: TaskPriority::Standard,
                meta_data: if is_partial {
                    json!({ "lead_id": format!("lead_{i}") })
                } else {
                    json!({
                        "lead_id": format!("lead_{i}"),
                        "industry": "technology",
                        "company_size": 200 + i,
                    })
                },
                timestamp: Utc::now(),
            };

            let score_res_val = scorer.execute(&lead_payload).await.unwrap();
            let score_res: LeadScoringResponse = serde_json::from_value(score_res_val).unwrap();

            if is_partial {
                assert_eq!(score_res.status, "Partial_Enrichment");
            } else {
                assert_eq!(score_res.status, "Enriched");
            }

            let amount_value = 100.0 + f64::from(i);
            let dl_payload = AximWebhookPayload {
                source_channel: format!("stress_test_{i}"),
                intent: "generate_demand_letter".to_string(),
                priority: TaskPriority::Standard,
                meta_data: if is_partial {
                    json!({ "creditor_name": "Axim" })
                } else {
                    json!({
                        "creditor_name": "Axim",
                        "debtor_name": format!("debtor_{i}"),
                        "amount": amount_value,
                        "items": ["Item A"]
                    })
                },
                timestamp: Utc::now(),
            };

            let dl_res_val = dl_gen.execute(&dl_payload).await.unwrap();
            let dl_res: DemandLetterResponse = serde_json::from_value(dl_res_val).unwrap();

            if is_partial {
                assert_eq!(dl_res.status, "Partial_Draft");
            } else {
                assert_eq!(dl_res.status, "Generated");
            }
        });

        handles.push(handle);
    }

    for handle in handles {
        handle.await.unwrap();
    }
}
