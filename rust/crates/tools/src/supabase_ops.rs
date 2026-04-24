use runtime::RuntimeConfig;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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

pub async fn execute_query_telemetry_logs(
    input: QueryTelemetryLogsInput,
    config: &RuntimeConfig,
) -> Result<QueryTelemetryLogsOutput, String> {
    let supabase_url = config
        .get("SUPABASE_URL")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_URL").unwrap_or_default(),
            String::from,
        );
    let supabase_key = config
        .get("SUPABASE_SERVICE_ROLE_KEY")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(),
            String::from,
        );

    if input.approval_token.is_none() {
        println!(
            "[Dry Run] Would query telemetry logs for brand_id: {}",
            input.brand_id
        );
        return Ok(QueryTelemetryLogsOutput {
            logs: Value::Null,
            log_only: Some(true),
        });
    }

    let client = reqwest::Client::new();
    let url = format!(
        "{}/rest/v1/telemetry_logs?brand_id=eq.{}",
        supabase_url, input.brand_id
    ); // Basic query

    let res = client
        .get(&url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {supabase_key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let logs: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(QueryTelemetryLogsOutput {
            logs,
            log_only: None,
        })
    } else {
        Err(format!("Supabase API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordIncidentResolutionInput {
    pub incident: String,
    pub tool_executed: String,
    pub approval_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordIncidentResolutionOutput {
    pub success: bool,
    pub log_only: Option<bool>,
}

pub async fn execute_record_incident_resolution(
    input: RecordIncidentResolutionInput,
    config: &RuntimeConfig,
) -> Result<RecordIncidentResolutionOutput, String> {
    let supabase_url = config
        .get("SUPABASE_URL")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_URL").unwrap_or_default(),
            String::from,
        );
    let supabase_key = config
        .get("SUPABASE_SERVICE_ROLE_KEY")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(),
            String::from,
        );

    if input.approval_token.is_none() {
        println!(
            "[Dry Run] Would record incident resolution: {} via {}",
            input.incident, input.tool_executed
        );
        return Ok(RecordIncidentResolutionOutput {
            success: true,
            log_only: Some(true),
        });
    }

    let client = reqwest::Client::new();
    let url = format!("{supabase_url}/rest/v1/incident_memory");

    let payload = serde_json::json!({
        "incident": input.incident,
        "tool_executed": input.tool_executed,
    });

    let res = client
        .post(&url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {supabase_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(RecordIncidentResolutionOutput {
            success: true,
            log_only: None,
        })
    } else {
        Err(format!(
            "Supabase API error recording incident: {}",
            res.status()
        ))
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

pub async fn execute_check_micro_app_transactions(
    input: CheckMicroAppTransactionsInput,
    config: &RuntimeConfig,
) -> Result<CheckMicroAppTransactionsOutput, String> {
    let supabase_url = config
        .get("SUPABASE_URL")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_URL").unwrap_or_default(),
            String::from,
        );
    let supabase_key = config
        .get("SUPABASE_SERVICE_ROLE_KEY")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(),
            String::from,
        );

    if input.approval_token.is_none() {
        println!(
            "[Dry Run] Would check micro app transactions for app_name: {}",
            input.app_name
        );
        return Ok(CheckMicroAppTransactionsOutput {
            transactions: Value::Null,
            log_only: Some(true),
        });
    }

    let client = reqwest::Client::new();
    let url = format!(
        "{}/rest/v1/micro_app_transactions?app_name=eq.{}",
        supabase_url, input.app_name
    ); // Basic query

    let res = client
        .get(&url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {supabase_key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let transactions: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(CheckMicroAppTransactionsOutput {
            transactions,
            log_only: None,
        })
    } else {
        Err(format!("Supabase API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultArtifactInput {
    pub filename: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultArtifactOutput {
    pub url: String,
    pub success: bool,
}

pub async fn execute_vault_artifact(
    input: VaultArtifactInput,
    config: &RuntimeConfig,
) -> Result<VaultArtifactOutput, String> {
    let supabase_url = config
        .get("SUPABASE_URL")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_URL").unwrap_or_default(),
            String::from,
        );
    let supabase_key = config
        .get("SUPABASE_SERVICE_ROLE_KEY")
        .and_then(|v| v.as_str())
        .map_or_else(
            || {
                std::env::var("SUPABASE_SERVICE_ROLE_KEY")
                    .unwrap_or_else(|_| std::env::var("AXIM_ONYX_SECRET").unwrap_or_default())
            },
            String::from,
        );

    if supabase_url.is_empty() || supabase_key.is_empty() {
        return Err("Missing Supabase credentials".to_string());
    }

    let client = reqwest::Client::new();

    // We upload to the secure_artifacts bucket
    let bucket = "secure_artifacts";
    let url = format!(
        "{}/storage/v1/object/{}/{}",
        supabase_url, bucket, input.filename
    );

    let res = client
        .post(&url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {supabase_key}"))
        .header("Content-Type", "application/octet-stream")
        .body(input.content)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let signed_url_endpoint = format!(
            "{}/storage/v1/object/sign/{}/{}",
            supabase_url, bucket, input.filename
        );
        let signed_res = client
            .post(&signed_url_endpoint)
            .header("apikey", &supabase_key)
            .header("Authorization", format!("Bearer {supabase_key}"))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({"expiresIn": 3600}))
            .send()
            .await;

        let final_url = if let Ok(s_res) = signed_res {
            if s_res.status().is_success() {
                if let Ok(json) = s_res.json::<serde_json::Value>().await {
                    if let Some(signed_url) = json.get("signedURL").and_then(|s| s.as_str()) {
                        format!("{supabase_url}{signed_url}")
                    } else {
                        format!(
                            "{}/storage/v1/object/public/{}/{}",
                            supabase_url, bucket, input.filename
                        )
                    }
                } else {
                    format!(
                        "{}/storage/v1/object/public/{}/{}",
                        supabase_url, bucket, input.filename
                    )
                }
            } else {
                format!(
                    "{}/storage/v1/object/public/{}/{}",
                    supabase_url, bucket, input.filename
                )
            }
        } else {
            format!(
                "{}/storage/v1/object/public/{}/{}",
                supabase_url, bucket, input.filename
            )
        };

        Ok(VaultArtifactOutput {
            url: final_url,
            success: true,
        })
    } else {
        Err(format!("Supabase API error: {}", res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchCriticalAlertInput {
    pub event: String,
    pub severity: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchCriticalAlertOutput {
    pub success: bool,
}

pub async fn execute_dispatch_critical_alert(
    input: DispatchCriticalAlertInput,
    config: &RuntimeConfig,
) -> Result<DispatchCriticalAlertOutput, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let axim_secret = config
        .get("AXIM_ONYX_SECRET")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("AXIM_ONYX_SECRET").unwrap_or_default(),
            String::from,
        );

    let client = reqwest::Client::new();
    let url = format!("{axim_core_url}/api/v1/telemetry/ingest");

    let payload = serde_json::json!({
        "event": input.event,
        "severity": input.severity,
        "details": input.details,
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {axim_secret}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(DispatchCriticalAlertOutput { success: true })
    } else {
        Err(format!("Alert API error: {}", res.status()))
    }
}
