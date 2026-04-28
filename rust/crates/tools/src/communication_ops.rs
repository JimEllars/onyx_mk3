use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchSecureMessageInput {
    pub channel: String, // 'email', 'sms', 'system_alert'
    pub body: String,
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchSecureMessageOutput {
    pub success: bool,
    pub error: Option<String>,
}

pub async fn execute_dispatch_secure_message(
    input: DispatchSecureMessageInput,
) -> Result<DispatchSecureMessageOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key =
        std::env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY is not set".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/send-message");

    let payload = serde_json::json!({
        "channel": input.channel,
        "body": input.body,
        "thread_id": input.thread_id,
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if res.status().is_success() {
        Ok(DispatchSecureMessageOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchExecutiveBriefInput {
    pub message_body: String,
    pub priority: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchExecutiveBriefOutput {
    pub success: bool,
    pub error: Option<String>,
}

pub async fn execute_dispatch_executive_brief(
    input: DispatchExecutiveBriefInput,
) -> Result<DispatchExecutiveBriefOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key =
        std::env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY is not set".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/functions/send-email");

    let payload = serde_json::json!({
        "to": "james.ellars@axim.us.com",
        "priority": input.priority,
        "message": input.message_body,
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if res.status().is_success() {
        Ok(DispatchExecutiveBriefOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

pub async fn execute_send_email(to: &str, subject: &str, body: &str) -> Result<(), String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").map_err(|_| "AXIM_CORE_URL is not set".to_string())?;
    let service_key =
        std::env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY is not set".to_string())?;

    let client = reqwest::Client::new();
    let url = format!("{axim_core_url}/api/v1/email/send");

    let payload = serde_json::json!({
        "to": to,
        "subject": subject,
        "body": body
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

pub async fn execute_read_recent_emails(limit: u32) -> Result<serde_json::Value, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").map_err(|_| "AXIM_CORE_URL is not set".to_string())?;
    let service_key =
        std::env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY is not set".to_string())?;

    let client = reqwest::Client::new();
    let url = format!("{axim_core_url}/api/v1/email/inbox");

    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .query(&[("limit", limit)])
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if res.status().is_success() {
        let data: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        Ok(data)
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}
