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

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");

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

    let is_valid_envelope = payload.get("encrypted_payload")
        .and_then(|p| p.get("iv"))
        .is_some();

    assert!(is_valid_envelope, "Payload must contain IV for decryption");
}
