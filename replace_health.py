import sys

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

# Replace ProposedAction
search1 = """#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedAction {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub id: String,
    pub status: ActionStatus,
}"""
replace1 = """#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedAction {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub id: String,
    pub status: ActionStatus,
    pub created_at: u64,
}"""

content = content.replace(search1, replace1)

# Replace evaluate_fleet_health body push
search2 = """                let proposed_action = ProposedAction {
                    tool_name: "purge_zone_cache".to_string(),
                    arguments: serde_json::json!({ "zone_id": app }), // Simple mapping for now
                    id: action_id.clone(),
                    status: ActionStatus::Pending,
                };"""
replace2 = """                let proposed_action = ProposedAction {
                    tool_name: "purge_zone_cache".to_string(),
                    arguments: serde_json::json!({ "zone_id": app }), // Simple mapping for now
                    id: action_id.clone(),
                    status: ActionStatus::Pending,
                    created_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
                };"""

content = content.replace(search2, replace2)

with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)
