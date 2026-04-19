import re
import subprocess

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

content = content.replace('fn run_serve_headless(port: u16) -> Result<(), Box<dyn std::error::Error>> {', '#[allow(clippy::too_many_lines)]\nfn run_serve_headless(port: u16) -> Result<(), Box<dyn std::error::Error>> {')
content = content.replace('let telemetry_url = format!("{}/api/v1/telemetry", edge_url);', 'let telemetry_url = format!("{edge_url}/api/v1/telemetry");')
content = content.replace('.header("Authorization", format!("Bearer {}", secret))', '.header("Authorization", format!("Bearer {secret}"))')
content = content.replace('println!(\n                            "[Heartbeat] Successfully broadcast load: {} pending, {} active",\n                            pending_tasks, active_tasks\n                        );', 'println!(\n                            "[Heartbeat] Successfully broadcast load: {pending_tasks} pending, {active_tasks} active"\n                        );')
content = content.replace('println!(\n                            "[Heartbeat] Successfully broadcast load: {} pending, {} active",\n                            pending_tasks, active_tasks\n                        );', 'println!("[Heartbeat] Successfully broadcast load: {pending_tasks} pending, {active_tasks} active");')

content = content.replace('println!("[Heartbeat] Successfully broadcast load: {} pending, {} active", pending_tasks, active_tasks);', 'println!("[Heartbeat] Successfully broadcast load: {pending_tasks} pending, {active_tasks} active");')

content = content.replace('eprintln!("[Heartbeat] Error broadcasting load: {}", e);', 'eprintln!("[Heartbeat] Error broadcasting load: {e}");')

content = content.replace('eprintln!("[Telemetry Polling] Error querying telemetry logs: {}", e);', 'eprintln!("[Telemetry Polling] Error querying telemetry logs: {e}");')

content = content.replace(""".map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                    std::path::PathBuf::from(home).join(".onyx")
                });""", """.map_or_else(|_| {
                    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                    std::path::PathBuf::from(home).join(".onyx")
                }, std::path::PathBuf::from);""")


with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)

subprocess.run(["cargo", "fmt", "--all"], cwd="rust")
