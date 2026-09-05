use runtime::ToolError;
use std::env;
use std::fmt::Write;

pub async fn audit_financial_metrics(timeframe: &str) -> Result<String, ToolError> {
    let axim_core_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    // Security: Use axim_vault::fetch_temporal_credential("financial_readonly") to authorize the request
    let service_key = crate::axim_vault::fetch_temporal_credential("financial_readonly")
        .await
        .map_err(|e| ToolError::new(format!("Failed to fetch credentials: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ToolError::new(format!("Failed to build reqwest client: {e}")))?;

    let audit_url = format!("{axim_core_url}/financial-audit");
    let billing_url = format!("{axim_core_url}/autonomous-billing");

    let payload = serde_json::json!({
        "timeframe": timeframe,
    });

    let (audit_res, billing_res) = tokio::join!(
        client
            .post(&audit_url)
            .header("Authorization", format!("Bearer {service_key}"))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send(),
        client
            .post(&billing_url)
            .header("Authorization", format!("Bearer {service_key}"))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
    );

    let audit_res = audit_res.map_err(|e| ToolError::new(format!("Audit request failed: {e}")))?;
    let billing_res =
        billing_res.map_err(|e| ToolError::new(format!("Billing request failed: {e}")))?;

    let mut report = String::from("# Financial & Billing Overwatch Report\n\n");

    if audit_res.status().is_success() {
        let audit_data = audit_res.text().await.unwrap_or_default();
        let _ = write!(report, "## Financial Audit ({timeframe})\n{audit_data}\n\n");
    } else {
        let _ = write!(
            report,
            "## Financial Audit ({timeframe})\nFailed to retrieve data: HTTP {}\n\n",
            audit_res.status()
        );
    }

    if billing_res.status().is_success() {
        let billing_data = billing_res.text().await.unwrap_or_default();
        let _ = write!(
            report,
            "## Autonomous Billing ({timeframe})\n{billing_data}\n\n"
        );
    } else {
        let _ = write!(
            report,
            "## Autonomous Billing ({timeframe})\nFailed to retrieve data: HTTP {}\n\n",
            billing_res.status()
        );
    }

    Ok(report)
}

pub async fn execute_financial_summary() -> Result<serde_json::Value, String> {
    let axim_core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key = crate::axim_vault::fetch_temporal_credential("financial_readonly")
        .await
        .map_err(|e| format!("Failed to fetch credentials: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {e}"))?;

    let url = format!("{axim_core_url}/api/v1/financial/summary");

    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if res.status().is_success() {
        let data: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse JSON: {e}"))?;
        Ok(data)
    } else {
        Err(format!("Axim API error: {}", res.status()))
    }
}
