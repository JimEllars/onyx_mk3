import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

# We will refactor start_approval_polling_loop to take an execution callback
# Or we just inline the reqwest logic into fleet_health.rs and simulate `tools::cloudflare_ops`

new_execution_logic = """
        for action in actions_to_execute {
            let mut exec_status = "Failed";
            #[allow(unused_assignments)]
            let mut exec_details = "Unknown error".to_string();

            match action.tool_name.as_str() {
                "purge_zone_cache" => {
                    #[derive(serde::Deserialize)]
                    struct PurgeInput { zone_id: String }

                    if let Ok(input) = serde_json::from_value::<PurgeInput>(action.arguments.clone()) {
                        println!("[Executing: Purging cache for zone_id {}...]", input.zone_id);

                        let api_key = std::env::var("CLOUDFLARE_API_TOKEN").unwrap_or_default();
                        let email = std::env::var("CLOUDFLARE_EMAIL").unwrap_or_default();
                        let cf_client = reqwest::Client::new();
                        let cf_url = format!("https://api.cloudflare.com/client/v4/zones/{}/purge_cache", input.zone_id);

                        let result: Result<(), String> = match cf_client.post(&cf_url)
                            .header("X-Auth-Key", api_key)
                            .header("X-Auth-Email", email)
                            .header("Content-Type", "application/json")
                            .json(&serde_json::json!({ "purge_everything": true }))
                            .send()
                            .await {
                            Ok(res) if res.status().is_success() => Ok(()),
                            Ok(res) => Err(format!("Cloudflare API error: {}", res.status())),
                            Err(e) => Err(e.to_string()),
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
                        }
                    } else {
                        exec_details = "Missing or invalid zone_id".to_string();
                        eprintln!("[Execution failed: Missing or invalid zone_id]");
                    }
                }
                "trigger_pages_deployment" => {
                    #[derive(serde::Deserialize)]
                    struct TriggerInput { project_name: String }

                    if let Ok(input) = serde_json::from_value::<TriggerInput>(action.arguments.clone()) {
                        println!("[Executing: Triggering deployment for project {}...]", input.project_name);

                        let account_id = std::env::var("CLOUDFLARE_ACCOUNT_ID").unwrap_or_default();
                        let api_key = std::env::var("CLOUDFLARE_API_TOKEN").unwrap_or_default();
                        let email = std::env::var("CLOUDFLARE_EMAIL").unwrap_or_default();
                        let cf_client = reqwest::Client::new();
                        let cf_url = format!("https://api.cloudflare.com/client/v4/accounts/{}/pages/projects/{}/deployments", account_id, input.project_name);

                        let result: Result<(), String> = match cf_client.post(&cf_url)
                            .header("X-Auth-Key", api_key)
                            .header("X-Auth-Email", email)
                            .send()
                            .await {
                            Ok(res) if res.status().is_success() => Ok(()),
                            Ok(res) => Err(format!("Cloudflare API error: {}", res.status())),
                            Err(e) => Err(e.to_string()),
                        };

                        match result {
                            Ok(_) => {
                                exec_status = "Completed";
                                exec_details = "Deployment triggered successfully".to_string();
                                println!("[Execution completed for task_id {}]", action.id);
                            }
                            Err(e) => {
                                exec_status = "Failed";
                                exec_details = format!("Error: {}", e);
                                eprintln!("[Execution failed for task_id {}: {}]", action.id, e);
                            }
                        }
                    } else {
                        exec_details = "Missing or invalid project_name".to_string();
                        eprintln!("[Execution failed: Missing or invalid project_name]");
                    }
                }
                _ => {
                    exec_details = format!("Unknown tool: {}", action.tool_name);
                    eprintln!("[Execution failed: Unknown tool {}]", action.tool_name);
                }
            }
"""

start_idx = content.find("        for action in actions_to_execute {")
end_idx = content.find("            {", start_idx + 10)
end_idx = content.find("let mut current_status = status.write().unwrap();", end_idx)
end_idx = content.rfind("            {", 0, end_idx)

if start_idx != -1 and end_idx != -1:
    new_content = content[:start_idx] + new_execution_logic + content[end_idx:]
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(new_content)
    print("Patched successfully")
else:
    print("Could not find patch locations")
