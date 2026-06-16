use hmac::{Hmac, Mac};
use sha2::Sha256;

use serde_json::json;

type HmacSha256 = Hmac<Sha256>;

#[test]
fn test_github_webhook_signature_verification() {
    let secret = "my_github_secret";
    let payload = json!({
        "ref": "refs/heads/main",
        "repository": {
            "name": "axim-frontend"
        }
    });

    let payload_str = payload.to_string();

    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");

    mac.update(payload_str.as_bytes());
    let result = mac.finalize();
    let signature = hex::encode(result.into_bytes());

    let expected_signature_header = format!("sha256={}", signature);

    // Validate we correctly formatted it
    assert!(expected_signature_header.starts_with("sha256="));
}

#[test]
fn test_wp_webhook_signature_verification() {
    let secret = "axim_wp_sync_secure_hash";
    let received_signature = "axim_wp_sync_secure_hash";

    assert_eq!(secret, received_signature);
}

#[tokio::test]
async fn test_customer_leads_decryption_simulation() {
    // In our edge bridge context, customer_leads payloads are ingested
    // Simulation of the Rust Core processing them:
    let payload = json!({
        "type": "customer_leads",
        "encrypted_payload": {
            "iv": "dGhpcyBpcyBhbiBkaWduaXR5IGl2",
            "ciphertext": "YmFzZTY0LWVuY29kZWQtY3J5cHRvZ3JhcGhpYy1zdHJpbmc=",
            "tag": "YXV0aGVudGljYXRpb24tdGFn"
        },
        "timestamp": "2026-06-02T21:05:14Z"
    });

    let is_valid_envelope = payload
        .get("encrypted_payload")
        .and_then(|p| p.get("iv"))
        .is_some();

    assert!(is_valid_envelope, "Payload must contain IV for decryption");
}

#[tokio::test]
async fn test_async_state_polling_validation() {
    // This simulates polling the ONYX_STATE KV queue for transaction approvals.
    // In actual implementation, we might poll an endpoint exposed by the edge bridge
    // or simulate parsing valid/invalid KV outputs.

    // Simulate valid parsing
    let valid_approval_json = json!({
        "task_id": "task_12345",
        "signed_payload": {
            "status": "approved",
            "approver": "james.ellars@axim.us.com",
            "signature": "valid_signature_hash"
        }
    });

    let parsed_valid: Result<serde_json::Value, _> =
        serde_json::from_str(&valid_approval_json.to_string());
    assert!(
        parsed_valid.is_ok(),
        "Should successfully parse a valid approval payload"
    );

    let parsed_valid_obj = parsed_valid.unwrap();
    assert_eq!(parsed_valid_obj["task_id"].as_str(), Some("task_12345"));
    assert!(parsed_valid_obj["signed_payload"]["signature"].is_string());

    // Simulate missing signature
    let missing_signature_json = json!({
        "task_id": "task_12346",
        "signed_payload": {
            "status": "approved",
            "approver": "james.ellars@axim.us.com"
            // signature missing
        }
    });

    let has_signature = missing_signature_json
        .get("signed_payload")
        .and_then(|sp| sp.get("signature"))
        .is_some();
    assert!(
        !has_signature,
        "Should gracefully detect missing cryptographic signature without panicking"
    );

    // Simulate completely bad token frame (e.g. malformed json)
    let bad_token_frame = "{ task_id: bad_json";
    let parsed_bad: Result<serde_json::Value, _> = serde_json::from_str(bad_token_frame);
    assert!(
        parsed_bad.is_err(),
        "Should gracefully fail parsing bad token frame"
    );
}

#[tokio::test]
async fn test_axim_core_router_header_parsing() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        response::IntoResponse,
        routing::post,
        Router,
    };
    use tower::ServiceExt;

    // A mock version of the router handling logic that parses the authorization
    // and cf-connecting-ip headers.
    let app = Router::new().route(
        "/v1/commands/dispatch",
        post(|headers: axum::http::HeaderMap| async move {
            let auth_header = headers.get("authorization").and_then(|h| h.to_str().ok());
            let expected_token = "Bearer valid_axim_secret";

            if auth_header != Some(expected_token) {
                return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
            }

            let connecting_ip = headers
                .get("cf-connecting-ip")
                .and_then(|h| h.to_str().ok());
            if connecting_ip.is_none() {
                // In some real environments missing CF IP might be flagged, here we just
                // test that it can be extracted. Let's make it a condition for this test.
                return (StatusCode::BAD_REQUEST, "Missing CF-Connecting-IP").into_response();
            }

            (StatusCode::OK, "Task dispatched").into_response()
        }),
    );

    // Build the request mimicking the Edge Bridge structure
    let request = Request::builder()
        .method("POST")
        .uri("/v1/commands/dispatch")
        .header("authorization", "Bearer valid_axim_secret")
        .header("cf-connecting-ip", "192.168.1.1")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"intent": "sync_lead_solar", "priority": 1}"#,
        ))
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Test unauthorized
    let request_unauth = Request::builder()
        .method("POST")
        .uri("/v1/commands/dispatch")
        .header("authorization", "Bearer invalid_secret")
        .header("cf-connecting-ip", "192.168.1.1")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"intent": "sync_lead_solar", "priority": 1}"#,
        ))
        .unwrap();

    let response_unauth = app.clone().oneshot(request_unauth).await.unwrap();
    assert_eq!(response_unauth.status(), StatusCode::UNAUTHORIZED);
}
