use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiUsageLog {
    pub app_id: String,
    pub endpoint: String,
    pub execution_time_ms: i64,
    pub revenue_generated: f64,
    // Add timestamps for delta calculations
    #[serde(default)]
    pub t_ingress: Option<u64>,
    #[serde(default)]
    pub t_completion: Option<u64>,
}

pub fn process_log_telemetry(payload: Value) -> Result<(), String> {
    let mut log: ApiUsageLog = serde_json::from_value(payload).map_err(|e| e.to_string())?;

    // Implement explicit latency processing time delta formulas inside the telemetry pipeline.
    if let (Some(ingress), Some(completion)) = (log.t_ingress, log.t_completion) {
        if completion >= ingress {
            let delta_t = completion.saturating_sub(ingress);
            // Cast to i64 bounds safely
            log.execution_time_ms = i64::try_from(delta_t).unwrap_or(i64::MAX);
        }
    }

    if log.execution_time_ms == -1 || log.endpoint.contains("anomaly_signature") {
        // Log quarantine action via telemetry crate (simulated here)
        println!("Telemetry anomaly detected for app: {}. Triggering quarantine and triage support.", log.app_id);

        let _triage_payload = crate::task_packet::TaskPacket {
            objective: format!("Triage critical failure for app: {}", log.app_id),
            scope: "triage_support".to_string(),
            repo: "axim-core".to_string(),
            branch_policy: "main".to_string(),
            acceptance_tests: vec![],
            commit_policy: "strict".to_string(),
            reporting_contract: "none".to_string(),
            escalation_policy: "halt".to_string(),
            context: format!("Error in endpoint {} with execution time {}ms", log.endpoint, log.execution_time_ms),
            goal: "triage_support".to_string(),
            expected_schema: serde_json::Value::Null,
            job_id: None,
            worker_id: None,
            reasoning_effort: None,
        };

        // Here we would push this task packet to the execution channel with Priority::Critical
    } else {
        println!("Normal telemetry logged for app: {}", log.app_id);
    }

    Ok(())
}
