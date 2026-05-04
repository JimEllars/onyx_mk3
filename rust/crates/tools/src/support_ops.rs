use reqwest::Client;
use serde_json::Value;
use std::env;
use uuid::Uuid;

pub async fn update_ticket_status(
    ticket_id: &str,
    status: &str,
    reply_text: &str,
) -> Result<(), String> {
    let base_url = env::var("AXIM_CORE_URL").map_err(|_| "AXIM_CORE_URL not set".to_string())?;
    let api_key =
        env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY not set".to_string())?;
    let idempotency_key = Uuid::new_v4().to_string();

    let url = format!("{}/api/v1/support/tickets/{}", base_url, ticket_id);

    let client = Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Idempotency-Key", idempotency_key)
        .json(&serde_json::json!({
            "status": status,
            "reply_text": reply_text
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("Request failed with status: {}", response.status()))
    }
}

pub async fn fetch_app_diagnostics(app_id: &str) -> Result<Value, String> {
    let base_url = env::var("AXIM_CORE_URL").map_err(|_| "AXIM_CORE_URL not set".to_string())?;
    let api_key =
        env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY not set".to_string())?;

    let url = format!("{}/api/v1/telemetry/apps/{}/diagnostics", base_url, app_id);

    let client = Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if response.status().is_success() {
        let json: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;
        Ok(json)
    } else {
        Err(format!("Request failed with status: {}", response.status()))
    }
}
