use crate::axim_vault::fetch_temporal_credential;
use reqwest::Client;
use runtime::ToolError;
use serde_json::Value;

pub async fn invoke_axim_micro_app(
    app_target: &str,
    action: &str,
    payload: Value,
) -> Result<String, ToolError> {
    // We request a short-lived credential for the gateway via the vault.
    let temporal_token = fetch_temporal_credential("axim_gateway").await?;

    let base_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    // According to specs, gateway endpoint could be /api-gateway or /universal-dispatcher
    // Assume /api-gateway or /api/v1/gateway, using /api/v1/gateway as per common AXiM Core conventions
    let url = format!("{base_url}/api/v1/gateway");

    let client = Client::new();

    let gateway_payload = serde_json::json!({
        "target": app_target,
        "action": action,
        "payload": payload
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {temporal_token}"))
        .json(&gateway_payload)
        .send()
        .await
        .map_err(|e| ToolError::new(format!("Gateway request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(ToolError::new(format!(
            "Gateway returned error: {status} - {body}"
        )));
    }

    let response_body = res
        .text()
        .await
        .map_err(|e| ToolError::new(format!("Failed to read gateway response: {e}")))?;

    Ok(response_body)
}
