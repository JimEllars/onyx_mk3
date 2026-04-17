use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryTelemetryLogsInput {
    pub brand_id: String,
    pub since_minutes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryTelemetryLogsOutput {
    pub logs: Value,
}

pub async fn execute_query_telemetry_logs(input: QueryTelemetryLogsInput) -> Result<QueryTelemetryLogsOutput, String> {
    let supabase_url = std::env::var("SUPABASE_URL").map_err(|_| "SUPABASE_URL is not set")?;
    let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY").map_err(|_| "SUPABASE_SERVICE_ROLE_KEY is not set")?;

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
        Ok(QueryTelemetryLogsOutput { logs })
    } else {
        Err(format!("Supabase API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckMicroAppTransactionsInput {
    pub app_name: String,
    pub since_minutes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckMicroAppTransactionsOutput {
    pub transactions: Value,
}

pub async fn execute_check_micro_app_transactions(input: CheckMicroAppTransactionsInput) -> Result<CheckMicroAppTransactionsOutput, String> {
    let supabase_url = std::env::var("SUPABASE_URL").map_err(|_| "SUPABASE_URL is not set")?;
    let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY").map_err(|_| "SUPABASE_SERVICE_ROLE_KEY is not set")?;

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
        Ok(CheckMicroAppTransactionsOutput { transactions })
    } else {
        Err(format!("Supabase API error: {}", res.status()))
    }
}
