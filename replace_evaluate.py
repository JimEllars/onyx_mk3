import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """    if let Some(logs) = telemetry_logs.as_array() {
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
}"""

replacement = """    if let Some(logs) = telemetry_logs.as_array() {
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
            // Mocking dynamic tool discovery via MCP. We would query McpServerManager for available tools here.
            // Then we would prompt the LLM to choose among them.
            // Assuming the LLM chooses dynamically:
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
}"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Replaced evaluate_health_with_ai")
