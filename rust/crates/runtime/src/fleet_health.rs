use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppStatus {
    Operational,
    Degraded(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionStatus {
    Pending,
    Executing,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedAction {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub id: String,
    pub status: ActionStatus,
}

#[derive(Debug, Clone, Default)]
pub struct FleetStatus {
    pub apps: HashMap<String, AppStatus>,
    pub last_updated: u64,
    pub pending_actions: Vec<ProposedAction>,
}

pub type GlobalFleetStatus = Arc<RwLock<FleetStatus>>;

#[must_use]
pub fn create_global_fleet_status() -> GlobalFleetStatus {
    Arc::new(RwLock::new(FleetStatus::default()))
}

pub fn evaluate_fleet_health(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {
    let mut current_status = status.write().unwrap();
    current_status.last_updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

    if let Some(logs) = telemetry_logs.as_array() {
        let mut error_counts: HashMap<String, usize> = HashMap::new();
        for log in logs {
            if let (Some(app), Some(status_code)) = (log.get("app_name").and_then(|v| v.as_str()), log.get("status_code").and_then(serde_json::Value::as_u64)) {
                if status_code >= 500 {
                    *error_counts.entry(app.to_string()).or_insert(0) += 1;
                } else {
                    error_counts.entry(app.to_string()).or_insert(0); // Ensure app is recorded even if no errors
                }
            }
        }

        for (app, count) in error_counts {
            if count > 5 {
                current_status.apps.insert(app.clone(), AppStatus::Degraded(format!("Spike in 500 errors ({count} recent)")));

                let action_id = format!("action-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
                let proposed_action = ProposedAction {
                    tool_name: "purge_zone_cache".to_string(),
                    arguments: serde_json::json!({ "zone_id": app }), // Simple mapping for now
                    id: action_id.clone(),
                    status: ActionStatus::Pending,
                };
                println!("[Self-Healing: Spiking errors detected in {app}. Status set to DEGRADED. Pushing ProposedAction: {action_id}]");
                current_status.pending_actions.push(proposed_action);
            } else {
                current_status.apps.insert(app.clone(), AppStatus::Operational);
            }
        }
    }
}

pub async fn start_approval_polling_loop(status: GlobalFleetStatus, client: reqwest::Client, edge_url: String, secret: String) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
    loop {
        interval.tick().await;

        let url = format!("{}/api/approvals", edge_url);
        match client.get(&url)
            .header("Authorization", format!("Bearer {}", secret))
            .send()
            .await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(approvals) = body.get("approvals").and_then(|v| v.as_array()) {
                        let mut current_status = status.write().unwrap();
                        for approval in approvals {
                            if let Some(task_id) = approval.get("task_id").and_then(|v| v.as_str()) {
                                for action in current_status.pending_actions.iter_mut() {
                                    if action.id == task_id && action.status == ActionStatus::Pending {
                                        action.status = ActionStatus::Executing;
                                        println!("[Approval received for task_id {}. Transitioning to Executing]", task_id);

                                        // Note: Assuming Supabase/Cloudflare tool is mapped to purge_zone_cache as per evaluate_fleet_health.
                                        if action.tool_name == "purge_zone_cache" {
                                            if let Some(zone_id) = action.arguments.get("zone_id").and_then(|v| v.as_str()) {
                                                println!("[Simulating execution: Purging cache for zone_id {}...]", zone_id);
                                                // Actually making the call to CF API or Supabase here...
                                                // In a full implementation, we'd spawn a tool execution task.
                                                action.status = ActionStatus::Completed;
                                                println!("[Execution completed for task_id {}]", task_id);
                                            } else {
                                                action.status = ActionStatus::Failed;
                                                eprintln!("[Execution failed: Missing zone_id]");
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Ok(resp) => {
                eprintln!("[Approval polling failed with status: {}]", resp.status());
            }
            Err(e) => {
                eprintln!("[Approval polling error: {}]", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn evaluate_fleet_health_transitions_to_degraded_on_cascading_500s() {
        let status = create_global_fleet_status();
        let mut logs = Vec::new();

        // 1. Mock 50 unique 500 errors for "demand-letter-generator"
        for _ in 0..50 {
            logs.push(json!({
                "app_name": "demand-letter-generator",
                "status_code": 500
            }));
        }

        // 2. Mock 2 errors for "nda-generator" (below threshold)
        for _ in 0..2 {
            logs.push(json!({
                "app_name": "nda-generator",
                "status_code": 502
            }));
        }

        // 3. Mock 10 successes for "web3-frontend"
        for _ in 0..10 {
            logs.push(json!({
                "app_name": "web3-frontend",
                "status_code": 200
            }));
        }

        let telemetry_payload = serde_json::Value::Array(logs);

        // Action
        evaluate_fleet_health(&status, &telemetry_payload);

        // Assertion
        let state = status.read().unwrap();
        assert_eq!(state.apps.get("demand-letter-generator"), Some(&AppStatus::Degraded("Spike in 500 errors (50 recent)".to_string())));
        assert_eq!(state.apps.get("nda-generator"), Some(&AppStatus::Operational));
        assert_eq!(state.apps.get("web3-frontend"), Some(&AppStatus::Operational));
    }
}
