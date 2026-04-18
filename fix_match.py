import sys

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

search = """                    match cf_client.post(&cf_url)
                        .header("X-Auth-Key", api_key)
                        .header("X-Auth-Email", email)
                        .header("Content-Type", "application/json")
                        .json(&serde_json::json!({ "purge_everything": true }))
                        .send()
                        .await {
                        Ok(res) if res.status().is_success() => {
                            let output = serde_json::json!({ "success": true });
                            Ok(output)
                        }
                        Ok(res) => {
                            Err(format!("Cloudflare API error: {}", res.status()))
                        }
                        Err(e) => {
                            Err(e.to_string())
                        }
                    } {
                        Ok(output) => {
                            exec_status = "Completed";
                            exec_details = "Cache purged successfully".to_string();
                            println!("[Execution completed for task_id {}]", action.id);
                        }
                        Err(e) => {
                            exec_status = "Failed";
                            exec_details = format!("Error: {}", e);
                            eprintln!("[Execution failed for task_id {}: {}]", action.id, e);
                        }
                    }"""

replace = """                    let result: Result<(), String> = match cf_client.post(&cf_url)
                        .header("X-Auth-Key", api_key)
                        .header("X-Auth-Email", email)
                        .header("Content-Type", "application/json")
                        .json(&serde_json::json!({ "purge_everything": true }))
                        .send()
                        .await {
                        Ok(res) if res.status().is_success() => {
                            Ok(())
                        }
                        Ok(res) => {
                            Err(format!("Cloudflare API error: {}", res.status()))
                        }
                        Err(e) => {
                            Err(e.to_string())
                        }
                    };

                    match result {
                        Ok(_) => {
                            exec_status = "Completed";
                            exec_details = "Cache purged successfully".to_string();
                            println!("[Execution completed for task_id {}]", action.id);
                        }
                        Err(e) => {
                            exec_status = "Failed";
                            exec_details = format!("Error: {}", e);
                            eprintln!("[Execution failed for task_id {}: {}]", action.id, e);
                        }
                    }"""

content = content.replace(search, replace)
with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)
