import sys

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

start_idx = content.find("pub async fn start_approval_polling_loop")
end_idx = content.find("#[cfg(test)]", start_idx)

new_func = """pub async fn start_approval_polling_loop(status: GlobalFleetStatus, client: reqwest::Client, edge_url: String, secret: String) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
    loop {
        interval.tick().await;

        let url = format!("{}/api/approvals", edge_url);
        let mut approved_tasks = std::collections::HashSet::new();

        match client.get(&url)
            .header("Authorization", format!("Bearer {}", secret))
            .send()
            .await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(approvals) = body.get("approvals").and_then(|v| v.as_array()) {
                        for approval in approvals {
                            if let Some(task_id) = approval.get("task_id").and_then(|v| v.as_str()) {
                                approved_tasks.insert(task_id.to_string());
                            }
                        }
                    }
                }
            }
            Ok(resp) => {
                eprintln!("[Approval polling failed with status: {}]", resp.status());
            }
            Err(e) => {
                eprintln!("[Approval polling error: {}]", e);
            }
        }

        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        let mut actions_to_execute = Vec::new();

        {
            let mut current_status = status.write().unwrap();
            for action in current_status.pending_actions.iter_mut() {
                if action.status == ActionStatus::Pending {
                    let mut should_execute = false;

                    if approved_tasks.contains(&action.id) {
                        println!("[Approval received for task_id {}. Transitioning to Executing]", action.id);
                        should_execute = true;
                    } else if now >= action.created_at + (12 * 3600) {
                        println!("[Auto-approving task_id {} after 12 hours. Transitioning to Executing]", action.id);
                        should_execute = true;
                    }

                    if should_execute {
                        action.status = ActionStatus::Executing;
                        actions_to_execute.push(action.clone());
                    }
                }
            }
        }

        for action in actions_to_execute {
            let mut exec_status = "Failed";
            let mut exec_details = "Unknown error".to_string();

            if action.tool_name == "purge_zone_cache" {
                if let Some(zone_id) = action.arguments.get("zone_id").and_then(|v| v.as_str()) {
                    println!("[Executing: Purging cache for zone_id {}...]", zone_id);
                    match tools::cloudflare_ops::execute_purge_zone_cache(tools::cloudflare_ops::PurgeZoneCacheInput { zone_id: zone_id.to_string() }).await {
                        Ok(output) if output.success => {
                            exec_status = "Completed";
                            exec_details = "Cache purged successfully".to_string();
                            println!("[Execution completed for task_id {}]", action.id);
                        }
                        Ok(_) => {
                            exec_status = "Failed";
                            exec_details = "Cache purge returned false success".to_string();
                            eprintln!("[Execution failed for task_id {}]", action.id);
                        }
                        Err(e) => {
                            exec_status = "Failed";
                            exec_details = format!("Error: {}", e);
                            eprintln!("[Execution failed for task_id {}: {}]", action.id, e);
                        }
                    }
                } else {
                    exec_details = "Missing zone_id".to_string();
                    eprintln!("[Execution failed: Missing zone_id]");
                }
            } else {
                exec_details = format!("Unknown tool: {}", action.tool_name);
                eprintln!("[Execution failed: Unknown tool {}]", action.tool_name);
            }

            {
                let mut current_status = status.write().unwrap();
                for a in current_status.pending_actions.iter_mut() {
                    if a.id == action.id {
                        a.status = if exec_status == "Completed" { ActionStatus::Completed } else { ActionStatus::Failed };
                    }
                }
            }

            // Task 2: Feedback Loop
            let feedback_url = format!("{}/api/v1/task-status", edge_url);
            let payload = serde_json::json!({
                "task_id": action.id,
                "status": exec_status,
                "details": exec_details
            });

            match client.post(&feedback_url)
                .header("Authorization", format!("Bearer {}", secret))
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await {
                Ok(resp) if resp.status().is_success() => {
                    println!("[Feedback sent for task_id {}]", action.id);
                }
                Ok(resp) => {
                    eprintln!("[Feedback failed for task_id {} with status: {}]", action.id, resp.status());
                }
                Err(e) => {
                    eprintln!("[Feedback error for task_id {}: {}]", action.id, e);
                }
            }
        }
    }
}

"""

new_content = content[:start_idx] + new_func + content[end_idx:]

with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(new_content)
