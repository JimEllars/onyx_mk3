#!/bin/bash
# Modify handle_onyx_summon to wire it up with the unified SSE Stream from client.rs

cat << 'ROUTER_PATCH' > patch_router.py
import re

with open("rust/crates/api/src/router.rs", "r") as f:
    content = f.read()

new_func = """pub async fn handle_onyx_summon(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    payload_result: Result<Json<serde_json::Value>, JsonRejection>,
) -> Result<
    Sse<ReceiverStream<Result<AxumSseEvent, Infallible>>>,
    (StatusCode, axum::Json<serde_json::Value>),
> {
    let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
    let expected_token = format!("Bearer {}", state.auth_token);

    if auth_header != Some(&expected_token) {
        return Err((
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({"error": "Unauthorized"})),
        ));
    }

    let payload = match payload_result {
        Ok(Json(v)) => v,
        Err(e) => {
            return Err((
                StatusCode::BAD_REQUEST,
                axum::Json(
                    serde_json::json!({"error": "Malformed payload", "details": e.body_text()}),
                ),
            ));
        }
    };

    let (tx, rx) = tokio::sync::mpsc::channel(10);

    tokio::spawn(async move {
        let Ok(mut client) = crate::client::ProviderClient::from_model("claude-3-7-sonnet-latest") else { return };

        let message = payload.get("message").and_then(|v| v.as_str()).unwrap_or("Hello");

        let request = crate::types::MessageRequest {
            model: "claude-3-7-sonnet-latest".to_string(),
            max_tokens: 1024,
            messages: vec![crate::types::InputMessage::user_text(message)],
            system: Some("You are Onyx Mk3. Reply concisely.".to_string()),
            tools: None,
            tool_choice: None,
            stream: true,
            temperature: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            stop: None,
            reasoning_effort: None,
            budget_priority: None,
            response_format: None,
            web3_wallet_address: None,
        };

        if let Ok(mut stream) = client.stream_message(&request).await {
            while let Ok(Some(event)) = stream.next_event().await {
                match event {
                    crate::types::StreamEvent::ContentBlockDelta(delta_event) => {
                        if let crate::types::ContentBlockDelta::TextDelta { text } = delta_event.delta {
                            let mut buf = Vec::new();
                            let payload = crate::sse::SsePayload::new(text, false);
                            if payload.emit(&mut buf).is_ok() {
                                let _ = tx.send(Ok::<_, Infallible>(
                                    AxumSseEvent::default().data(String::from_utf8_lossy(&buf)),
                                )).await;
                            }
                        }
                    },
                    crate::types::StreamEvent::MessageStop(_) => {
                        let mut buf = Vec::new();
                        let payload = crate::sse::SsePayload::new("", true);
                        if payload.emit(&mut buf).is_ok() {
                            let _ = tx.send(Ok::<_, Infallible>(
                                AxumSseEvent::default().data(String::from_utf8_lossy(&buf)),
                            )).await;
                        }

                        let _ = tx.send(Ok::<_, Infallible>(
                            AxumSseEvent::default().data("[DONE]"),
                        )).await;
                        break;
                    },
                    _ => {}
                }
            }
        }
    });

    Ok(Sse::new(ReceiverStream::new(rx)))
}"""

pattern = re.compile(r"pub async fn handle_onyx_summon\(.*?\n\}(?=\n\n#\[axum::debug_handler\]\npub async fn handle_llm_health)", re.DOTALL)
content = pattern.sub(new_func, content)

with open("rust/crates/api/src/router.rs", "w") as f:
    f.write(content)
ROUTER_PATCH
python3 patch_router.py
