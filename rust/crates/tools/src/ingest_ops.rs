use runtime::ToolError;
use serde_json::Value;
use std::env;

pub async fn ingest_to_knowledge_base(
    source_type: &str,
    uri: &str,
    metadata: Value,
) -> Result<String, ToolError> {
    let axim_core_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    // Use temporal credential
    let service_key = crate::axim_vault::fetch_temporal_credential("knowledge_ingest")
        .await
        .map_err(|e| ToolError::new(format!("Failed to fetch credentials: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| ToolError::new(format!("Failed to build reqwest client: {e}")))?;

    let url = if source_type.eq_ignore_ascii_case("audio") {
        format!("{axim_core_url}/axim-transcribe")
    } else {
        format!("{axim_core_url}/knowledge-ingest")
    };

    let payload = serde_json::json!({
        "source_type": source_type,
        "uri": uri,
        "metadata": metadata
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| ToolError::new(format!("Request failed: {e}")))?;

    if res.status().is_success() {
        let response_data = res
            .json::<Value>()
            .await
            .map_err(|e| ToolError::new(format!("Failed to parse response: {e}")))?;
        Ok(format!("Successfully ingested data: {response_data}"))
    } else {
        Err(ToolError::new(format!("Axim API error: {}", res.status())))
    }
}
