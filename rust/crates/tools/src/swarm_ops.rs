use runtime::ToolError;
use serde_json::Value;
use std::env;

pub async fn spawn_sub_agent(role: &str, task: &str, parent_worker_id: &str) -> Result<String, ToolError> {
    let axim_core_url = env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

    let service_key = crate::axim_vault::fetch_temporal_credential("satellite_job_queue")
        .await
        .map_err(|e| ToolError::new(format!("Failed to fetch credentials: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ToolError::new(format!("Failed to build reqwest client: {e}")))?;

    let url = format!("{axim_core_url}/api/v1/satellite_job_queue/spawn");

    let payload = serde_json::json!({
        "role": role,
        "task": task,
        "parent_job_id": parent_worker_id,
        "type": "sub_agent"
    });

    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| ToolError::new(format!("Request failed: {e}")))?;

    if res.status().is_success() {
        let response_data: Value = res.json::<Value>().await.unwrap_or_default();
        let job_id = response_data["job_id"].as_str().unwrap_or("unknown_job_id").to_string();
        Ok(job_id)
    } else {
        Err(ToolError::new(format!("Axim API error: {}", res.status())))
    }
}

pub async fn check_swarm_status(parent_job_id: &str) -> Result<Value, ToolError> {
    let axim_core_url = env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_temporal_credential("satellite_job_queue")
        .await
        .map_err(|e| ToolError::new(format!("Failed to fetch credentials: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ToolError::new(format!("Failed to build reqwest client: {e}")))?;

    let url = format!("{axim_core_url}/api/v1/satellite_job_queue/status?parent_job_id={parent_job_id}");

    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .send()
        .await
        .map_err(|e| ToolError::new(format!("Request failed: {e}")))?;

    if res.status().is_success() {
        let response_data = res.json::<Value>().await.map_err(|e| ToolError::new(format!("Failed to parse response: {e}")))?;
        Ok(response_data)
    } else {
        Err(ToolError::new(format!("Axim API error: {}", res.status())))
    }
}
