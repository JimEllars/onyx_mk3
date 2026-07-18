const fs = require('fs');

let content = fs.readFileSync('rust/crates/api/src/router.rs', 'utf8');

// Insert route
content = content.replace(
    /\.route\("\/v1\/commands\/dispatch", post\(handle_dispatch\)\)/,
    '.route("/v1/commands/dispatch", post(handle_dispatch))\n        .route("/api/v1/onyx/summon", post(handle_onyx_summon))'
);

// Append the new handler and imports
const handlerCode = `
use axum::response::sse::{Event as AxumSseEvent, Sse};
use std::convert::Infallible;
use tokio_stream::wrappers::ReceiverStream;

#[axum::debug_handler]
pub async fn handle_onyx_summon(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    payload_result: Result<Json<serde_json::Value>, JsonRejection>,
) -> Result<Sse<ReceiverStream<Result<AxumSseEvent, Infallible>>>, (StatusCode, axum::Json<serde_json::Value>)> {
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    let expected_token = format!("Bearer {}", state.auth_token);

    if auth_header != Some(&expected_token) {
        return Err((
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({"error": "Unauthorized"})),
        ));
    }

    let _payload = match payload_result {
        Ok(Json(v)) => v,
        Err(e) => {
            return Err((
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": "Malformed payload", "details": e.body_text()})),
            ));
        }
    };

    let (tx, rx) = tokio::sync::mpsc::channel(10);

    tokio::spawn(async move {
        let mut buf = Vec::new();
        let payload1 = crate::sse::SsePayload::new("Summoning Onyx Mk3...", false);
        if payload1.emit(&mut buf).is_ok() {
            let _ = tx.send(Ok::<_, Infallible>(AxumSseEvent::default().data(String::from_utf8_lossy(&buf).to_string()))).await;
        }

        buf.clear();
        let payload2 = crate::sse::SsePayload::new("Context initialized.", true);
        if payload2.emit(&mut buf).is_ok() {
            let _ = tx.send(Ok::<_, Infallible>(AxumSseEvent::default().data(String::from_utf8_lossy(&buf).to_string()))).await;
        }
    });

    Ok(Sse::new(ReceiverStream::new(rx)))
}
`;

content += handlerCode;
fs.writeFileSync('rust/crates/api/src/router.rs', content);
