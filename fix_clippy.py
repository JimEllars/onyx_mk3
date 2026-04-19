import re
import subprocess

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

content = content.replace('println!("[Executing MCP Tool: {}...]", tool_name);', 'println!("[Executing MCP Tool: {tool_name}...]");')
content = content.replace('format!("{}/rest/v1/incident_memory?order=created_at.desc&limit=10", supabase_url)', 'format!("{supabase_url}/rest/v1/incident_memory?order=created_at.desc&limit=10")')
content = content.replace('format!("Bearer {}", supabase_key)', 'format!("Bearer {supabase_key}")')

# map unwrap or
content = content.replace(""".map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            std::path::PathBuf::from(home).join(".onyx")
        });""", """.map_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            std::path::PathBuf::from(home).join(".onyx")
        }, std::path::PathBuf::from);""")

content = content.replace(""".map(std::path::PathBuf::from)
                            .unwrap_or_else(|_| {
                                let home =
                                    std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                                std::path::PathBuf::from(home).join(".onyx")
                            });""", """.map_or_else(|_| {
                                let home =
                                    std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                                std::path::PathBuf::from(home).join(".onyx")
                            }, std::path::PathBuf::from);""")

content = content.replace('format!("{}/api/approvals", edge_url)', 'format!("{edge_url}/api/approvals")')
content = content.replace('format!("Bearer {}", secret)', 'format!("Bearer {secret}")')
content = content.replace('for approval in approvals {', 'for approval in approvals.iter() {')

content = content.replace('for action in current_status.pending_actions.iter_mut() {', 'for action in &mut current_status.pending_actions {')
content = content.replace('for a in current_status.pending_actions.iter_mut() {', 'for a in &mut current_status.pending_actions {')

content = content.replace('exec_details = format!("MCP tool executed successfully: {:?}", result);', 'exec_details = format!("MCP tool executed successfully: {result:?}");')
content = content.replace('exec_details = format!("MCP tool execution failed: {}", e);', 'exec_details = format!("MCP tool execution failed: {e}");')

content = content.replace('exec_details = format!("Error: {}", e);', 'exec_details = format!("Error: {e}");')

content = content.replace('Ok(_) => {', 'Ok(()) => {')

content = content.replace('format!("{}/rest/v1/incident_memory", supabase_url);', 'format!("{supabase_url}/rest/v1/incident_memory");')

content = content.replace('println!(\n                            "[Incident resolution logged to memory bank for {}]",\n                            tool_name\n                        );', 'println!(\n                            "[Incident resolution logged to memory bank for {tool_name}]"\n                        );')

content = content.replace('let feedback_url = format!("{}/api/v1/task-status", edge_url);', 'let feedback_url = format!("{edge_url}/api/v1/task-status");')

with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)

subprocess.run(["cargo", "fmt", "--all"], cwd="rust")
