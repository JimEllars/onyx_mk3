use api::router::{create_router, AppState};
use axum::{body::Body, http::Request};
use chrono::Utc;
use runtime::dispatch::Dispatcher;
use serde_json::json;
use std::sync::Arc;
use tower::ServiceExt;

#[tokio::test]
async fn high_volume_throughput_and_priority() {
    let (dispatcher, mut queues) = Dispatcher::new(100);
    let app_state = AppState {
        dispatcher: Arc::new(dispatcher),
        auth_token: "test_token".to_string(),
    };

    let app = create_router(app_state);

    let mut requests = Vec::new();
    for i in 0..50 {
        let priority = match i % 4 {
            0 => "critical",
            1 => "high",
            2 => "standard",
            _ => "low",
        };

        let payload = json!({
            "source_channel": format!("channel_{i}"),
            "intent": format!("intent_{i}"),
            "priority": priority,
            "meta_data": {},
            "timestamp": Utc::now().to_rfc3339()
        });

        let request = Request::builder()
            .method("POST")
            .uri("/v1/commands/dispatch")
            .header("content-type", "application/json")
            .header("authorization", "Bearer test_token")
            .body(Body::from(payload.to_string()))
            .unwrap();

        requests.push(request);
    }

    let mut futures = Vec::new();
    for req in requests {
        let app_clone = app.clone();
        futures.push(tokio::spawn(async move {
            let response = app_clone.oneshot(req).await.unwrap();
            assert_eq!(response.status(), axum::http::StatusCode::OK);
        }));
    }

    for f in futures {
        f.await.unwrap();
    }

    let mut critical_count = 0;
    while queues.critical_rx.try_recv().is_ok() {
        critical_count += 1;
    }
    assert_eq!(critical_count, 13);

    let mut high_count = 0;
    while queues.high_rx.try_recv().is_ok() {
        high_count += 1;
    }
    assert_eq!(high_count, 13);
}

#[tokio::test]
async fn webhook_payload_bad_request() {
    let (dispatcher, _) = Dispatcher::new(100);
    let app_state = AppState {
        dispatcher: Arc::new(dispatcher),
        auth_token: "test_token".to_string(),
    };

    let app = create_router(app_state);

    let payload = json!({
        "intent": "missing_fields"
    });

    let request = Request::builder()
        .method("POST")
        .uri("/v1/commands/dispatch")
        .header("content-type", "application/json")
        .header("authorization", "Bearer test_token")
        .body(Body::from(payload.to_string()))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
}
