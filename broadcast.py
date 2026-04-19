import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

# Add heartbeat loop
heartbeat_logic = """
        let fleet_status_heartbeat = fleet_status.clone();
        tokio::spawn(async move {
            let edge_url = std::env::var("VITE_ONYX_WORKER_URL").unwrap_or_else(|_| "https://onyx-edge-worker.yourdomain.workers.dev".to_string());
            let secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
            let client = reqwest::Client::new();
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
            loop {
                interval.tick().await;

                let (pending_tasks, active_tasks) = {
                    let status = fleet_status_heartbeat.read().unwrap();
                    let pending = status.pending_actions.iter().filter(|a| a.status == runtime::fleet_health::ActionStatus::Pending).count();
                    let active = status.pending_actions.iter().filter(|a| a.status == runtime::fleet_health::ActionStatus::Executing).count();
                    (pending, active)
                };

                let payload = serde_json::json!({
                    "brandId": "onyx-core",
                    "pageViews": 0,
                    "pending_tasks": pending_tasks,
                    "active_tasks": active_tasks
                });

                let telemetry_url = format!("{}/api/v1/telemetry", edge_url);
                match client.post(&telemetry_url)
                    .header("Authorization", format!("Bearer {}", secret))
                    .header("Content-Type", "application/json")
                    .json(&payload)
                    .send()
                    .await {
                    Ok(resp) if resp.status().is_success() => {
                        println!("[Heartbeat] Successfully broadcast load: {} pending, {} active", pending_tasks, active_tasks);
                    }
                    Ok(resp) => {
                        eprintln!("[Heartbeat] Failed to broadcast load: status {}", resp.status());
                    }
                    Err(e) => {
                        eprintln!("[Heartbeat] Error broadcasting load: {}", e);
                    }
                }
            }
        });

"""

# Insert after tokio::spawn(async move { runtime::fleet_health::start_approval_polling_loop... });
idx = content.find("let fleet_status_telemetry = fleet_status.clone();")
if idx != -1:
    new_content = content[:idx] + heartbeat_logic + content[idx:]
    with open("rust/crates/onyx/src/main.rs", "w") as f:
        f.write(new_content)
    print("Patched successfully")
else:
    print("Could not find insertion point")
