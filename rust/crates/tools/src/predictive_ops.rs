use runtime::ToolError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DegradedApp {
    pub app_id: String,
    pub latency_ms: u64,
    pub error_count: u64,
}

pub async fn check_predictive_engagement() -> Result<Option<Value>, ToolError> {
    let axim_core_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

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
        let response_data = res
            .json::<Value>()
            .await
            .map_err(|e| ToolError::new(format!("Failed to parse response: {e}")))?;

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

pub async fn analyze_fleet_degradation() -> Result<Vec<DegradedApp>, String> {
    let apps_to_check = vec![
        "axim-demand-letter-generator",
        "axim-nda-generator",
        "axim-pay-stub-generator",
    ];

    let mut degraded_apps = Vec::new();

    for app_id in apps_to_check {
        match crate::support_ops::fetch_app_diagnostics(app_id).await {
            Ok(diagnostics) => {
                let mut latency_ms = 0;
                let mut error_count = 0;

                if let Some(metrics) = diagnostics.get("metrics") {
                    latency_ms = metrics
                        .get("average_latency_ms")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0);
                    let count_429 = metrics
                        .get("error_429_count")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0);
                    let count_499 = metrics
                        .get("error_499_count")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0);
                    error_count = count_429 + count_499;
                }

                if latency_ms > 1500 || error_count > 10 {
                    degraded_apps.push(DegradedApp {
                        app_id: app_id.to_string(),
                        latency_ms,
                        error_count,
                    });
                }
            }
            Err(e) => eprintln!("Failed to fetch diagnostics for {app_id}: {e}"),
        }
    }

    Ok(degraded_apps)
}
