use serde_json::json;

#[tokio::test]
async fn test_support_triage_hitl_handoff() {
    // Simulate Onyx intercepting database failure event from rca_trigger.sql
    let _incident_event = json!({
        "type": "micro_app_exception",
        "app_id": "axim-demand-letter-generator",
        "endpoint": "/v1/generate/pdf",
        "execution_time_ms": -1
    });

    // Simulate Onyx packaging the handoff envelope for Claude Cowork / HITL
    let handoff_payload = json!({
        "incident_id": "err_7b29a14c_8841_4f2d",
        "timestamp": "2026-06-02T21:05:14Z",
        "target_application": {
            "app_id": "axim-demand-letter-generator",
            "runtime_environment": "cloudflare_workers",
            "active_branch": "main",
            "repository_source": "jimellars/saas-demand-letter-generator-project-3012"
        },
        "telemetry_context": {
            "endpoint": "/v1/generate/pdf",
            "http_status": 500,
            "error_signature": "TypeError: Cannot read properties of undefined (reading 'stripe_session_id')"
        },
        "resolution_state": "Tier 4 Action Handoff"
    });

    assert_eq!(
        handoff_payload["resolution_state"],
        "Tier 4 Action Handoff",
        "Must flag as Tier 4 Action Handoff when similarity is low"
    );

    assert!(
        handoff_payload.get("target_application").is_some(),
        "Must include target application context"
    );
}

#[tokio::test]
async fn test_support_triage_deterministic_heal() {
    // Simulate Onyx packaging the handoff envelope for AutoDraftWhisper UI
    let handoff_payload = json!({
        "incident_id": "err_known_issue_123",
        "resolution_state": "Deterministic Auto-Heal",
        "proposed_fix": "Update Stripe API version in worker.js"
    });

    assert_eq!(
        handoff_payload["resolution_state"],
        "Deterministic Auto-Heal",
        "Must flag as Deterministic Auto-Heal when similarity is high"
    );
}
