use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use runtime::dispatch::Dispatcher;
use api::router::{create_router, AppState};
use std::sync::Arc;
use tower::ServiceExt;

#[tokio::test]
async fn test_generate_nda_malformed_payload() {
    let dispatcher = Arc::new(Dispatcher::new(10).0);
    let state = AppState {
        dispatcher,
        auth_token: "test_token".to_string(),
    };
    let app = create_router(state);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/generate/nda")
        .header("authorization", "Bearer test_token")
        .header("content-type", "application/json")
        .body(Body::from("{ malformed json"))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_generate_demand_letter_malformed_payload() {
    let dispatcher = Arc::new(Dispatcher::new(10).0);
    let state = AppState {
        dispatcher,
        auth_token: "test_token".to_string(),
    };
    let app = create_router(state);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/generate/demand-letter")
        .header("authorization", "Bearer test_token")
        .header("content-type", "application/json")
        .body(Body::from("{ malformed json"))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_dispatch_malformed_payload() {
    let dispatcher = Arc::new(Dispatcher::new(10).0);
    let state = AppState {
        dispatcher,
        auth_token: "test_token".to_string(),
    };
    let app = create_router(state);

    let req = Request::builder()
        .method("POST")
        .uri("/v1/commands/dispatch")
        .header("authorization", "Bearer test_token")
        .header("content-type", "application/json")
        .body(Body::from("{ malformed json"))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
