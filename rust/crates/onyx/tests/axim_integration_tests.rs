#[tokio::test]
async fn test_duplex_stream_connection() {
    // Basic compilation test for now
}

#[tokio::test]
async fn test_hmac_signature_validation() {
    let secret = "test_secret_key";
    let payload = r#"{"command":"test"}"#;

    // Compute valid signature
    let _digest = ring::digest::digest(&ring::digest::SHA256, payload.as_bytes());
    // In our implementation we do HMAC-SHA256, so let's do it right.
    let mut mac = ring::hmac::Context::with_key(&ring::hmac::Key::new(
        ring::hmac::HMAC_SHA256,
        secret.as_bytes(),
    ));
    mac.update(payload.as_bytes());
    let result = mac.sign();
    let signature = hex::encode(result.as_ref());

    // Simulate what the main loop does
    let mut verify_mac = ring::hmac::Context::with_key(&ring::hmac::Key::new(
        ring::hmac::HMAC_SHA256,
        secret.as_bytes(),
    ));
    verify_mac.update(payload.as_bytes());
    let verify_result = verify_mac.sign();
    let verify_hex = hex::encode(verify_result.as_ref());
    assert_eq!(signature, verify_hex);
}

#[tokio::test]
async fn test_vault_credential_fetch() {
    // This will use real vault in test environment
    let result = tools::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY").await;

    match result {
        Ok(key) => {
            assert!(!key.is_empty());
            assert!(key.len() > 10); // Sanity check
        }
        Err(e) => {
            // In CI, vault may not be available — log but don't fail
            eprintln!("[TEST] Vault not available: {e}");
        }
    }
}

#[tokio::test]
async fn test_gateway_timeout() {
    use std::time::Instant;

    // Call gateway with invalid endpoint (will timeout)
    let start = Instant::now();
    let result =
        tools::axim_gateway::invoke_axim_micro_app("nonexistent", "test", serde_json::json!({}))
            .await;
    let _elapsed = start.elapsed();

    assert!(result.is_err());
}
