import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

# Add evaluate_health_with_ai before evaluate_fleet_health

new_func = """
pub async fn evaluate_health_with_ai(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {
    let mut current_status = status.write().unwrap();
    current_status.last_updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

    // In a real implementation, this would make a network call to the LLM
    // with a prompt like:
    // "You are Onyx, AXiM's infrastructure AI. Review the following recent telemetry logs. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them: {logs}"

    // For this sprint, we mock the LLM network call and its response.
    // We simulate the AI analyzing logs and finding a degradation.
    let _prompt = format!("You are Onyx, AXiM's infrastructure AI. Review the following recent telemetry logs. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them: {}", telemetry_logs);

    if let Some(logs) = telemetry_logs.as_array() {
        let mut has_errors = false;
        let mut degraded_app = String::new();
        for log in logs {
            if let (Some(app), Some(status_code)) = (log.get("app_name").and_then(|v| v.as_str()), log.get("status_code").and_then(serde_json::Value::as_u64)) {
                if status_code >= 500 {
                    has_errors = true;
                    degraded_app = app.to_string();
                    break;
                }
            }
        }

        if has_errors {
            // Mocking the AI returning a dynamic JSON tool array
            let ai_response = serde_json::json!([
                {
                    "tool_name": "purge_zone_cache",
                    "arguments": { "zone_id": degraded_app }
                }
            ]);

            current_status.apps.insert(degraded_app.clone(), AppStatus::Degraded("AI detected anomalies".to_string()));

            if let Some(actions) = ai_response.as_array() {
                for action_val in actions {
                    if let (Some(tool_name), Some(args)) = (
                        action_val.get("tool_name").and_then(|v| v.as_str()),
                        action_val.get("arguments")
                    ) {
                        let action_id = format!("action-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
                        let proposed_action = ProposedAction {
                            tool_name: tool_name.to_string(),
                            arguments: args.clone(),
                            id: action_id.clone(),
                            status: ActionStatus::Pending,
                            created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
                        };
                        println!("[AI Self-Healing: Anomaly detected in {}. Status set to DEGRADED. Pushing ProposedAction: {}]", degraded_app, action_id);
                        current_status.pending_actions.push(proposed_action);
                    }
                }
            }
        }
    }
}

"""

idx = content.find("pub fn evaluate_fleet_health")
if idx != -1:
    new_content = content[:idx] + new_func + content[idx:]
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(new_content)
    print("Patched successfully")
else:
    print("Could not find evaluate_fleet_health")
