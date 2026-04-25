use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscalateToAdminInput {
    pub subject: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscalateToAdminOutput {
    pub success: bool,
}

pub async fn execute_escalate_to_admin(
    input: EscalateToAdminInput,
) -> Result<EscalateToAdminOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key =
        std::env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY is not set".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/send-email");

    let payload = serde_json::json!({
        "to": "james.ellars@axim.us.com",
        "cc": "jrellars@gmail.com",
        "subject": input.subject,
        "severity": input.severity,
        "message": input.message,
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
        Ok(EscalateToAdminOutput { success: true })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerMarketingLoopInput {
    pub topic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerMarketingLoopOutput {
    pub success: bool,
    pub error: Option<String>,
}

pub async fn execute_trigger_marketing_loop(
    input: TriggerMarketingLoopInput,
) -> Result<TriggerMarketingLoopOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key =
        std::env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY is not set".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/functions/roundups-connector");

    let payload = serde_json::json!({
        "topic": input.topic,
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
        Ok(TriggerMarketingLoopOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileMicroAppRevenueInput {
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcileMicroAppRevenueOutput {
    pub success: bool,
    pub error: Option<String>,
}

pub async fn execute_reconcile_micro_app_revenue(
    input: ReconcileMicroAppRevenueInput,
) -> Result<ReconcileMicroAppRevenueOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key =
        std::env::var("AXIM_SERVICE_KEY").map_err(|_| "AXIM_SERVICE_KEY is not set".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    // As per instruction, fetches latest conversion events from Supabase and prepares them for Tabby accounting webhook.
    // In AXiM Core this might be exposed via an endpoint.
    let url = format!("{axim_core_url}/api/v1/functions/reconcile-revenue");

    let payload = serde_json::json!({
        "limit": input.limit.unwrap_or(100),
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
        Ok(ReconcileMicroAppRevenueOutput {
            success: true,
            error: None,
        })
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}
