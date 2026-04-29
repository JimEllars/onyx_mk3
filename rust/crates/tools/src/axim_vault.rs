use reqwest::Client;
use runtime::ToolError;
use std::env;

pub async fn fetch_vault_artifact(trace_id: &str) -> Result<String, ToolError> {
    let api_key = env::var("AXIM_SERVICE_KEY")
        .map_err(|_| ToolError::new("AXIM_SERVICE_KEY not set".to_string()))?;

    let vault_url = env::var("AXIM_VAULT_URL")
        .unwrap_or_else(|_| "https://api.axim.us.com/v1/vault".to_string());

    let url = format!("{vault_url}/{trace_id}");

    let client = Client::new();
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| ToolError::new(format!("Request failed: {e}")))?;

    if !res.status().is_success() {
        return Err(ToolError::new(format!(
            "API returned error: {}",
            res.status()
        )));
    }

    let pdf_bytes = res
        .bytes()
        .await
        .map_err(|e| ToolError::new(format!("Failed to read bytes: {e}")))?;

    let extracted_text = crate::pdf_extract::extract_text_from_bytes(pdf_bytes.as_ref());

    if extracted_text.is_empty() {
        return Err(ToolError::new(
            "Extracted text is empty or PDF is invalid".to_string(),
        ));
    }

    Ok(extracted_text)
}

pub async fn fetch_vault_secret(secret_name: &str) -> Result<String, String> {
    let api_key = env::var("AXIM_SERVICE_KEY")
        .map_err(|_| "AXIM_SERVICE_KEY not set".to_string())?;

    let base_url = env::var("AXIM_CORE_URL")
        .unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let url = format!("{base_url}/api/v1/vault/{secret_name}");

    let client = Client::new();
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("API returned error: {}", res.status()));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse JSON: {e}"))?;

    let secret_value = json["secret_value"]
        .as_str()
        .ok_or_else(|| "secret_value not found or not a string".to_string())?;

    Ok(secret_value.to_string())
}
