use crate::http_client::send_with_retry;
use runtime::ToolError;
use serde_json::Value;
use std::env;

pub async fn spawn_sub_agent(
    role: &str,
    task: &str,
    parent_worker_id: &str,
) -> Result<String, ToolError> {
    let axim_core_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());

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

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&payload);
    let res: reqwest::Response = send_with_retry(request).await.map_err(ToolError::new)?;

    if res.status().is_success() {
        let response_data: Value = res.json::<Value>().await.unwrap_or_default();
        let job_id = response_data["job_id"]
            .as_str()
            .unwrap_or("unknown_job_id")
            .to_string();
        telemetry::metrics::SUB_AGENTS_SPAWNED
            .with_label_values(&[role])
            .inc();
        Ok(job_id)
    } else {
        Err(ToolError::new(format!("Axim API error: {}", res.status())))
    }
}

pub async fn check_swarm_status(parent_job_id: &str) -> Result<Value, ToolError> {
    let axim_core_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let service_key = crate::axim_vault::fetch_temporal_credential("satellite_job_queue")
        .await
        .map_err(|e| ToolError::new(format!("Failed to fetch credentials: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| ToolError::new(format!("Failed to build reqwest client: {e}")))?;

    let url =
        format!("{axim_core_url}/api/v1/satellite_job_queue/status?parent_job_id={parent_job_id}");

    let request = client
        .get(&url)
        .header("Authorization", format!("Bearer {service_key}"));
    let res: reqwest::Response = send_with_retry(request).await.map_err(ToolError::new)?;

    if res.status().is_success() {
        let response_data = res
            .json::<Value>()
            .await
            .map_err(|e| ToolError::new(format!("Failed to parse response: {e}")))?;
        Ok(response_data)
    } else {
        Err(ToolError::new(format!("Axim API error: {}", res.status())))
    }
}

use std::time::Instant;
use tokio::time::{timeout, Duration};

pub struct SubAgentHandle {
    pub job_id: String,
    pub role: String,
    pub started_at: Instant,
    pub max_runtime: Duration,
}

impl SubAgentHandle {
    #[must_use]
    pub fn is_expired(&self) -> bool {
        self.started_at.elapsed() > self.max_runtime
    }

    #[must_use]
    pub fn remaining_seconds(&self) -> u64 {
        self.max_runtime
            .saturating_sub(self.started_at.elapsed())
            .as_secs()
    }
}

pub async fn spawn_sub_agent_with_ttl(
    role: &str,
    task: &str,
    parent_worker_id: &str,
    max_runtime_secs: u64,
) -> Result<SubAgentHandle, ToolError> {
    let job_id = spawn_sub_agent(role, task, parent_worker_id).await?;

    Ok(SubAgentHandle {
        job_id,
        role: role.to_string(),
        started_at: Instant::now(),
        max_runtime: Duration::from_secs(max_runtime_secs),
    })
}

pub async fn monitor_sub_agents(mut handles: Vec<SubAgentHandle>) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));

    loop {
        interval.tick().await;

        handles.retain(|handle| {
            if handle.is_expired() {
                tracing::warn!(" Sub-agent {} exceeded TTL, terminating...", handle.job_id);
                let job_id_clone = handle.job_id.clone();
                tokio::spawn(async move {
                    let _ = kill_sub_agent(job_id_clone).await;
                });
                false
            } else {
                true
            }
        });

        if handles.is_empty() {
            break;
        }
    }
}

pub async fn kill_sub_agent(job_id: String) -> Result<(), ToolError> {
    let service_key = crate::axim_vault::fetch_temporal_credential("worker_interrupt").await?;
    let base_url =
        env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let url = format!("{base_url}/api/v1/worker-interrupt/{job_id}");

    let client = reqwest::Client::new();
    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {service_key}"));

    let response = timeout(Duration::from_secs(5), request.send())
        .await
        .map_err(|_| ToolError::new("Worker interrupt timeout".to_string()))?
        .map_err(|e| ToolError::new(format!("Worker interrupt failed: {e}")))?;

    if response.status().is_success() || response.status() == 404 {
        tracing::info!(" Successfully terminated sub-agent {}", job_id);
        Ok(())
    } else {
        Err(ToolError::new(format!(
            "Failed to kill sub-agent: {}",
            response.status()
        )))
    }
}
