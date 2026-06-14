use serde_json::json;

#[tokio::test]
async fn test_webhook_ingestion_payload_structure() {
    let payload = json!({
        "wp_auth_key": "axim_wp_sync_secure_hash",
        "event": "post_published_direct",
        "post_id": 4102,
        "slug": "best-marketing-software-lifetime-deals",
        "status": "publish",
        "raw_content": "Reviewing top workflow software like Make and email senders..."
    });

    assert_eq!(payload["event"], "post_published_direct");
    assert_eq!(payload["status"], "publish");
    assert!(payload["raw_content"].as_str().unwrap().contains("Make"));
}
