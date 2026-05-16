use runtime::ToolError;
use serde_json::Value;
use std::env;

pub async fn check_predictive_engagement() -> Result<Option<Value>, ToolError> {
    let axim_core_url = env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    // Address code review feedback: Use temporal credential for zero-trust security
    let service_key = crate::axim_vault::fetch_temporal_credential("predictive_engagement")
        .await
        .map_err(|e| ToolError::new(format!("Failed to fetch credentials: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ToolError::new(format!("Failed to build reqwest client: {e}")))?;

    let url = format!("{axim_core_url}/predictive-engagement");

    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .send()
        .await
        .map_err(|e| ToolError::new(format!("Request failed: {e}")))?;

    if res.status().is_success() {
        let response_data = res.json::<Value>().await.map_err(|e| ToolError::new(format!("Failed to parse response: {e}")))?;

        // If the insight is present and valid, return it.
        // Assuming the endpoint returns an object with a field `insight` if there's one.
        if !response_data.is_null() && response_data.get("insight").is_some() {
            Ok(Some(response_data))
        } else {
            Ok(None)
        }
    } else {
        Err(ToolError::new(format!("Axim API error: {}", res.status())))
    }
}
