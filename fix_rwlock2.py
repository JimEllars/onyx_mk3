import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """            current_status.apps.insert(degraded_app.clone(), AppStatus::Degraded("AI detected anomalies".to_string()));

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
            }"""

replacement = """            let mut current_status = status.write().unwrap();
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
            }"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Fixed evaluate_health_with_ai pt 2")
else:
    print("Cannot find target")
