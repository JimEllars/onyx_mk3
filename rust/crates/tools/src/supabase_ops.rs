use serde::{Deserialize, Serialize};
use serde_json::Value;
use runtime::RuntimeConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryTelemetryLogsInput {
    pub brand_id: String,
    pub since_minutes: u64,
    pub approval_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryTelemetryLogsOutput {
    pub logs: Value,
    pub log_only: Option<bool>,
}

pub async fn execute_query_telemetry_logs(input: QueryTelemetryLogsInput, config: &RuntimeConfig) -> Result<QueryTelemetryLogsOutput, String> {
    let supabase_url = config.get("SUPABASE_URL").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_URL").unwrap_or_default(), String::from);
    let supabase_key = config.get("SUPABASE_SERVICE_ROLE_KEY").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(), String::from);

    if input.approval_token.is_none() {
        println!("[Dry Run] Would query telemetry logs for brand_id: {}", input.brand_id);
        return Ok(QueryTelemetryLogsOutput { logs: Value::Null, log_only: Some(true) });
    }

    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/telemetry_logs?brand_id=eq.{}", supabase_url, input.brand_id); // Basic query

    let res = client
        .get(&url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {supabase_key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let logs: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(QueryTelemetryLogsOutput { logs, log_only: None })
    } else {
        Err(format!("Supabase API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckMicroAppTransactionsInput {
    pub app_name: String,
    pub since_minutes: u64,
    pub approval_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckMicroAppTransactionsOutput {
    pub transactions: Value,
    pub log_only: Option<bool>,
}

pub async fn execute_check_micro_app_transactions(input: CheckMicroAppTransactionsInput, config: &RuntimeConfig) -> Result<CheckMicroAppTransactionsOutput, String> {
    let supabase_url = config.get("SUPABASE_URL").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_URL").unwrap_or_default(), String::from);
    let supabase_key = config.get("SUPABASE_SERVICE_ROLE_KEY").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(), String::from);

    if input.approval_token.is_none() {
        println!("[Dry Run] Would check micro app transactions for app_name: {}", input.app_name);
        return Ok(CheckMicroAppTransactionsOutput { transactions: Value::Null, log_only: Some(true) });
    }

    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/micro_app_transactions?app_name=eq.{}", supabase_url, input.app_name); // Basic query

    let res = client
        .get(&url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {supabase_key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let transactions: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(CheckMicroAppTransactionsOutput { transactions, log_only: None })
    } else {
        Err(format!("Supabase API error: {}", res.status()))
    }
}
