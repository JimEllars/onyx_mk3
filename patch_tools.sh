cat << 'INNER_EOF' > rust/crates/tools/src/communication_ops.rs
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

fn log_email_transaction(payload_type: &str, status_code: u16, to: &str) {
    std::thread::spawn({
        let payload_type = payload_type.to_string();
        let to = to.to_string();
        move || {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let uuid = uuid::Uuid::new_v4().to_string();
            let log_entry = format!("{{\"uuid\": \"{}\", \"type\": \"{}\", \"timestamp\": {}, \"status_code\": {}, \"to\": \"{}\"}}\n",
                uuid, payload_type, timestamp, status_code, to);

            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(".claw/email_transactions.log")
            {
                let _ = file.write_all(log_entry.as_bytes());
            }
        }
    });
}

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
        if input.channel == "email" {
            log_email_transaction("DispatchSecureMessage", res.status().as_u16(), "unknown");
        }
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

    let to_email = std::env::var("AXIM_PRIMARY_EMAIL").unwrap_or_else(|_| "james.ellars@axim.us.com".to_string());

    let payload = serde_json::json!({
        "to": to_email,
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

    let status = res.status();

    if to_email == "james.ellars@axim.us.com" {
        log_email_transaction("ExecutiveBrief", status.as_u16(), &to_email);
    }

    if status.is_success() {
        Ok(DispatchExecutiveBriefOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", status))
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

    let status = res.status();

    if to == "james.ellars@axim.us.com" {
        log_email_transaction("DirectEmail", status.as_u16(), to);
    }

    if status.is_success() {
        Ok(())
    } else {
        Err(format!("Axim API error: {}", status))
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

pub async fn execute_send_sms(to_number: &str, message: &str) -> Result<(), String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/sms/send");
    let payload = serde_json::json!({
        "to_number": to_number,
        "message": message,
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

pub async fn execute_initiate_voice_call(
    to_number: &str,
    initial_greeting: &str,
    context: &str,
) -> Result<(), String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")
        .await
        .map_err(|e| format!("Failed to fetch AXIM_SERVICE_KEY from Vault: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/voice/call");
    let payload = serde_json::json!({
        "to_number": to_number,
        "initial_greeting": initial_greeting,
        "context": context,
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

pub async fn escalate_to_creator(message: &str, urgency: &str) -> Result<String, String> {
    if urgency.eq_ignore_ascii_case("CRITICAL") {
        let phone = std::env::var("CREATOR_PHONE").unwrap_or_else(|_| "+15550000000".to_string());
        execute_initiate_voice_call(&phone, "Critical system alert from Onyx.", message)
            .await
            .map(|()| "Successfully initiated critical voice call to creator.".to_string())
    } else if urgency.eq_ignore_ascii_case("HIGH") {
        let phone = std::env::var("CREATOR_PHONE").unwrap_or_else(|_| "+15550000000".to_string());
        execute_send_sms(&phone, message)
            .await
            .map(|()| "Successfully dispatched high priority SMS to creator.".to_string())
    } else {
        // Medium/Low
        execute_send_email(
            &std::env::var("AXIM_PRIMARY_EMAIL")
                .unwrap_or_else(|_| "james.ellars@axim.us.com".to_string()),
            "Onyx Escaltion",
            message,
        )
        .await
        .map(|()| "Successfully dispatched escalation email to creator.".to_string())
    }
}
INNER_EOF
