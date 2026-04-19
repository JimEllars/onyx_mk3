import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

content = content.replace("let mut mcp_server = String::new();", "let mut _mcp_server = String::new();")
content = content.replace("mcp_server = parts[1].to_string();", "_mcp_server = parts[1].to_string();")
content = content.replace("pub fn start_session_background_loop", "#[must_use]\npub fn start_session_background_loop")

content = content.replace("#[must_use]\n#[must_use]", "#[must_use]")
content = content.replace('format!(\n        "{}/rest/v1/incident_memory?order=created_at.desc&limit=10",\n        supabase_url\n    );', 'format!("{supabase_url}/rest/v1/incident_memory?order=created_at.desc&limit=10");')
content = content.replace('let _prompt = format!("You are Onyx, AXiM\'s infrastructure AI. Review the following recent telemetry logs: {}. Also consider recent incident memory to avoid loops: {}. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them.", telemetry_logs, recent_incidents);', 'let _prompt = format!("You are Onyx, AXiM\'s infrastructure AI. Review the following recent telemetry logs: {telemetry_logs}. Also consider recent incident memory to avoid loops: {recent_incidents}. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them.");')

content = content.replace('println!("[AI Self-Healing: Anomaly detected in {}. Status set to DEGRADED. Pushing ProposedAction: {}]", degraded_app, action_id);', 'println!("[AI Self-Healing: Anomaly detected in {degraded_app}. Status set to DEGRADED. Pushing ProposedAction: {action_id}]");')
content = content.replace('for approval in approvals.iter() {', 'for approval in approvals {')

content = content.replace('eprintln!("[Approval polling error: {}]", e);', 'eprintln!("[Approval polling error: {e}]");')

content = content.replace(""".map(std::path::PathBuf::from)
                    .unwrap_or_else(|_| {
                        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                        std::path::PathBuf::from(home).join(".onyx")
                    });""", """.map_or_else(|_| {
                        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                        std::path::PathBuf::from(home).join(".onyx")
                    }, std::path::PathBuf::from);""")


with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)

with open("rust/crates/runtime/src/session_control.rs", "r") as f:
    content = f.read()

content = content.replace("pub fn start_session_background_loop", "#[must_use]\npub fn start_session_background_loop")

with open("rust/crates/runtime/src/session_control.rs", "w") as f:
    f.write(content)
