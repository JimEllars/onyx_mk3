use axum::{
    extract::{rejection::JsonRejection, Json, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Router,
};
use chrono::Utc;
use commands::extensions::demand_letter::{DemandLetterGenerator, DemandLetterRequest};
use commands::extensions::lead_scoring::PredictiveLeadScoring;
use commands::extensions::nda::NDAGenerator;
use commands::extensions::support_triage::SupportTriage;
use commands::micro_program::MicroProgram;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use runtime::dispatch::Dispatcher;
use serde_json::json;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub dispatcher: Arc<Dispatcher>,
    pub auth_token: String,
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/v1/commands/dispatch", post(handle_dispatch))
        .route("/v1/generate/nda", post(handle_generate_nda))
        .route(
            "/v1/generate/demand-letter",
            post(handle_generate_demand_letter),
        )
        .with_state(state)
}

fn route_to_dlq(payload_text: &str, route: &str, error_msg: &str) {
    let dlq_path = ".claw/unsynced_receipts.jsonl";
    let _ = std::fs::create_dir_all(".claw");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(dlq_path) {
        let entry = json!({
            "timestamp": Utc::now().to_rfc3339(),
            "route": route,
            "error": error_msg,
            "raw_payload": payload_text
        });
        let _ = file.write_all(format!("{entry}\n").as_bytes());
    }
}

#[axum::debug_handler]
pub async fn handle_generate_nda(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    payload_result: Result<Json<serde_json::Value>, JsonRejection>,
) -> impl IntoResponse {
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    let expected_token = format!("Bearer {}", state.auth_token);

    if auth_header != Some(&expected_token) {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"error": "Unauthorized"})),
        )
            .into_response();
    }

    let _payload_val = match payload_result {
        Ok(Json(v)) => v,
        Err(e) => {
            let error_msg = format!("Malformed JSON payload: {}", e.body_text());
            route_to_dlq(&e.body_text(), "/v1/generate/nda", &error_msg);
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(json!({
                    "error": "Malformed payload structure",
                    "details": e.body_text()
                })),
            )
                .into_response();
        }
    };

    let packet = runtime::TaskPacket {
        job_id: None,
        worker_id: None,
        objective: "Generate NDA document".to_string(),
        scope: "micro_program".to_string(),
        repo: "axim-core".to_string(),
        branch_policy: "main".to_string(),
        acceptance_tests: vec![],
        commit_policy: "strict".to_string(),
        reporting_contract: "none".to_string(),
        escalation_policy: "halt".to_string(),
        context: "nda generator context".to_string(),
        goal: "generate_nda".to_string(),
        expected_schema: serde_json::Value::Null,
        reasoning_effort: None,
    };

    if let Err(e) = state
        .dispatcher
        .dispatch(runtime::dispatch::TaskPriority::Standard, packet)
        .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({"error": e})),
        )
            .into_response();
    }

    (
        StatusCode::ACCEPTED,
        axum::Json(json!({"status": "Success", "message": "NDA generation task dispatched"})),
    )
        .into_response()
}

#[axum::debug_handler]
pub async fn handle_generate_demand_letter(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    payload_result: Result<Json<DemandLetterRequest>, JsonRejection>,
) -> impl IntoResponse {
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    let expected_token = format!("Bearer {}", state.auth_token);

    if auth_header != Some(&expected_token) {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"error": "Unauthorized"})),
        )
            .into_response();
    }

    let payload = match payload_result {
        Ok(Json(v)) => v,
        Err(e) => {
            let error_msg = format!("Malformed payload structure: {}", e.body_text());
            route_to_dlq(&e.body_text(), "/v1/generate/demand-letter", &error_msg);
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(json!({
                    "error": "Malformed payload structure",
                    "details": e.body_text()
                })),
            )
                .into_response();
        }
    };

    let generator = DemandLetterGenerator;

    let webhook_payload = AximWebhookPayload {
        source_channel: "api_gateway".to_string(),
        intent: generator.signature().to_string(),
        priority: runtime::dispatch::TaskPriority::Standard,
        meta_data: json!(payload),
        timestamp: Utc::now(),
    };

    // Asynchronous dispatch to the Swarm for telemetry
    let packet = runtime::TaskPacket {
        job_id: None,
        worker_id: None,
        objective: "Log Demand Letter generation telemetry".to_string(),
        scope: "micro_program_telemetry".to_string(),
        repo: "axim-core".to_string(),
        branch_policy: "main".to_string(),
        acceptance_tests: vec![],
        commit_policy: "strict".to_string(),
        reporting_contract: "none".to_string(),
        escalation_policy: "halt".to_string(),
        context: json!({
            "status": "processing",
            "metadata_scrubbed": true
        })
        .to_string(),
        goal: "log_telemetry".to_string(),
        expected_schema: serde_json::Value::Null,
        reasoning_effort: None,
    };

    // Spawn task to background the telemetry dispatch so we don't block
    let dispatcher = state.dispatcher.clone();
    tokio::spawn(async move {
        let _ = dispatcher
            .dispatch(runtime::dispatch::TaskPriority::Low, packet)
            .await;
    });

    // Immediate document generation using the micro-program execution path
    match generator.execute(&webhook_payload).await {
        Ok(res) => (
            StatusCode::OK,
            axum::Json(json!({
                "status": "Success",
                "data": res
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({"error": e})),
        )
            .into_response(),
    }
}

#[axum::debug_handler]
#[allow(clippy::too_many_lines)]
pub async fn handle_dispatch(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    payload_result: Result<Json<AximWebhookPayload>, JsonRejection>,
) -> impl IntoResponse {
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    let expected_token = format!("Bearer {}", state.auth_token);

    if auth_header != Some(&expected_token) {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"error": "Unauthorized"})),
        )
            .into_response();
    }

    let payload = match payload_result {
        Ok(Json(payload)) => {
            if let Err(validation_err) = payload.validate() {
                let _ =
                    runtime::internal_mcp::call_telemetry_event_handler(&runtime::TelemetryEvent {
                        r#type: "webhook_ingest_validation_error".to_string(),
                        payload: json!({
                            "session_id": "system",
                            "agent_id": "axim_router",
                            "error": validation_err
                        }),
                    })
                    .await;

                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(json!({
                        "error": "Validation failed",
                        "details": validation_err
                    })),
                )
                    .into_response();
            }
            payload
        }
        Err(e) => {
            let error_msg = format!("Malformed payload structure: {}", e.body_text());
            let _ = runtime::internal_mcp::call_telemetry_event_handler(&runtime::TelemetryEvent {
                r#type: "webhook_ingest_error".to_string(),
                payload: json!({
                    "session_id": "system",
                    "agent_id": "axim_router",
                    "error": error_msg
                }),
            })
            .await;

            route_to_dlq(&e.body_text(), "/v1/commands/dispatch", &error_msg);

            return (
                StatusCode::BAD_REQUEST,
                axum::Json(json!({
                    "error": "Malformed payload structure",
                    "details": e.body_text()
                })),
            )
                .into_response();
        }
    };

    let lead_scoring = PredictiveLeadScoring;
    let demand_letter = DemandLetterGenerator;
    let nda = NDAGenerator;
    let support_triage = SupportTriage;
    let billing_fallback = commands::extensions::billing_fallback::BillingFallback;

    let mut micro_program_result = None;

    if payload.intent == lead_scoring.signature() {
        if let Ok(Some(cached)) = lead_scoring.check_idempotency(&payload).await {
            micro_program_result = Some(Ok(cached));
        } else {
            micro_program_result = Some(lead_scoring.execute(&payload).await);
        }
    } else if payload.intent == demand_letter.signature() {
        if let Ok(Some(cached)) = demand_letter.check_idempotency(&payload).await {
            micro_program_result = Some(Ok(cached));
        } else {
            micro_program_result = Some(demand_letter.execute(&payload).await);
        }
    } else if payload.intent == nda.signature() {
        if let Ok(Some(cached)) = nda.check_idempotency(&payload).await {
            micro_program_result = Some(Ok(cached));
        } else {
            micro_program_result = Some(nda.execute(&payload).await);
        }
    } else if payload.intent == support_triage.signature() {
        if let Ok(Some(cached)) = support_triage.check_idempotency(&payload).await {
            micro_program_result = Some(Ok(cached));
        } else {
            micro_program_result = Some(support_triage.execute(&payload).await);
        }
    } else if payload.intent == billing_fallback.signature() {
        if let Ok(Some(cached)) = billing_fallback.check_idempotency(&payload).await {
            micro_program_result = Some(Ok(cached));
        } else {
            micro_program_result = Some(billing_fallback.execute(&payload).await);
        }
    }

    if let Some(result) = micro_program_result {
        return match result {
            Ok(data) => (
                StatusCode::OK,
                axum::Json(json!({"status": "Success", "data": data})),
            )
                .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(json!({"error": e})),
            )
                .into_response(),
        };
    }

    let packet = runtime::TaskPacket {
        job_id: None,
        worker_id: None,
        objective: format!("Handle intent: {}", payload.intent),
        scope: "webhook_processing".to_string(),
        repo: "axim-core".to_string(),
        branch_policy: "main".to_string(),
        acceptance_tests: vec![],
        commit_policy: "strict".to_string(),
        reporting_contract: "none".to_string(),
        escalation_policy: "halt".to_string(),
        context: "webhook context".to_string(),
        goal: payload.intent.clone(),
        expected_schema: serde_json::Value::Null,
        reasoning_effort: None,
    };

    if let Err(e) = state.dispatcher.dispatch(payload.priority, packet).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({"error": e})),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        axum::Json(json!({"status": "Success", "message": "Task dispatched"})),
    )
        .into_response()
}
