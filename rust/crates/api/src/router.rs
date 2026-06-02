use axum::{
    extract::{State, Json, rejection::JsonRejection},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Router,
};
use runtime::dispatch::Dispatcher;
use serde_json::json;
use crate::types::AximWebhookPayload;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub dispatcher: Arc<Dispatcher>,
    pub auth_token: String,
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/v1/commands/dispatch", post(handle_dispatch))
        .with_state(state)
}

#[axum::debug_handler]
pub async fn handle_dispatch(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    payload_result: Result<Json<AximWebhookPayload>, JsonRejection>,
) -> impl IntoResponse {
    // Verify authorization
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    let expected_token = format!("Bearer {}", state.auth_token);

    if auth_header != Some(&expected_token) {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({"error": "Unauthorized"})),
        ).into_response();
    }

    let payload = match payload_result {
        Ok(Json(payload)) => payload,
        Err(e) => {
            let error_msg = format!("Malformed payload structure: {}", e.body_text());

            // Record telemetry event before termination
            let _ = runtime::internal_mcp::call_telemetry_event_handler(&runtime::TelemetryEvent {
                r#type: "webhook_ingest_error".to_string(),
                payload: json!({
                    "session_id": "system",
                    "agent_id": "axim_router",
                    "error": error_msg
                }),
            }).await;

            return (
                StatusCode::BAD_REQUEST,
                axum::Json(json!({
                    "error": "Malformed payload structure",
                    "details": e.body_text()
                })),
            ).into_response();
        }
    };

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
        ).into_response();
    }

    (
        StatusCode::OK,
        axum::Json(json!({"status": "Success", "message": "Task dispatched"})),
    ).into_response()
}
