import sys

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

search = """                let proposed_action = ProposedAction {
                    tool_name: "purge_zone_cache".to_string(),
                    arguments: serde_json::json!({ "zone_id": app }), // Simple mapping for now
                    id: action_id.clone(),
                    status: ActionStatus::Pending,
                };"""
replace = """                let proposed_action = ProposedAction {
                    tool_name: "purge_zone_cache".to_string(),
                    arguments: serde_json::json!({ "zone_id": app }), // Simple mapping for now
                    id: action_id.clone(),
                    status: ActionStatus::Pending,
                    created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
                };"""

content = content.replace(search, replace)

with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)
