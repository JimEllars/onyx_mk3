import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """pub fn evaluate_fleet_health(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {
    let mut current_status = status.write().unwrap();
    current_status.last_updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();"""

replacement = """pub fn evaluate_fleet_health(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {
    {
        let mut current_status = status.write().unwrap();
        current_status.last_updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    }"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Fixed evaluate_fleet_health pt 1")

target2 = """        for (app, count) in error_counts {
            if count > 5 {
                current_status.apps.insert(app.clone(), AppStatus::Degraded(format!("Spike in 500 errors ({count} recent)")));

                let action_id = format!("action-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
                let proposed_action = ProposedAction {
                    tool_name: "purge_zone_cache".to_string(),
                    arguments: serde_json::json!({ "zone_id": app }), // Simple mapping for now
                    id: action_id.clone(),
                    status: ActionStatus::Pending,
                    created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
                };
                println!("[Self-Healing: Spiking errors detected in {app}. Status set to DEGRADED. Pushing ProposedAction: {action_id}]");
                current_status.pending_actions.push(proposed_action);
            } else {
                current_status.apps.insert(app.clone(), AppStatus::Operational);
            }
        }"""

replacement2 = """        for (app, count) in error_counts {
            let mut current_status = status.write().unwrap();
            if count > 5 {
                current_status.apps.insert(app.clone(), AppStatus::Degraded(format!("Spike in 500 errors ({count} recent)")));

                let action_id = format!("action-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
                let proposed_action = ProposedAction {
                    tool_name: "purge_zone_cache".to_string(),
                    arguments: serde_json::json!({ "zone_id": app }), // Simple mapping for now
                    id: action_id.clone(),
                    status: ActionStatus::Pending,
                    created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
                };
                println!("[Self-Healing: Spiking errors detected in {app}. Status set to DEGRADED. Pushing ProposedAction: {action_id}]");
                current_status.pending_actions.push(proposed_action);
            } else {
                current_status.apps.insert(app.clone(), AppStatus::Operational);
            }
        }"""

if target2 in content:
    content = content.replace(target2, replacement2)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Fixed evaluate_fleet_health pt 2")
