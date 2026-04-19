import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """            {
                let mut current_status = status.write().unwrap();
                for a in current_status.pending_actions.iter_mut() {
                    if a.id == action.id {
                        a.status = if exec_status == "Completed" { ActionStatus::Completed } else { ActionStatus::Failed };
                    }
                }
            }"""

replacement = """            {
                let mut current_status = status.write().unwrap();
                for a in current_status.pending_actions.iter_mut() {
                    if a.id == action.id {
                        a.status = if exec_status == "Completed" { ActionStatus::Completed } else { ActionStatus::Failed };
                    }
                }
            }

            if exec_status == "Completed" {
                // Record incident resolution in background
                let tool_name = action.tool_name.clone();
                tokio::spawn(async move {
                    let workspace_root = std::env::current_dir().unwrap_or_default();
                    let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| {
                        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                        std::path::PathBuf::from(home).join(".onyx")
                    });
                    let loader = crate::config::ConfigLoader::new(&workspace_root, &config_home_dir);
                    let runtime_config = loader.load().unwrap_or_else(|_| crate::config::RuntimeConfig::empty());

                    let supabase_url = runtime_config.get("SUPABASE_URL").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_URL").unwrap_or_default(), String::from);
                    let supabase_key = runtime_config.get("SUPABASE_SERVICE_ROLE_KEY").and_then(|v| v.as_str()).map_or_else(|| std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(), String::from);

                    let client = reqwest::Client::new();
                    let url = format!("{}/rest/v1/incident_memory", supabase_url);
                    let payload = serde_json::json!({
                        "incident": format!("Automated incident fix via {}", tool_name),
                        "tool_executed": tool_name,
                    });
                    let _ = client.post(&url)
                        .header("apikey", &supabase_key)
                        .header("Authorization", format!("Bearer {}", supabase_key))
                        .header("Content-Type", "application/json")
                        .json(&payload)
                        .send()
                        .await;
                    println!("[Incident resolution logged to memory bank for {}]", tool_name);
                });
            }"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Added logic in fleet health")
