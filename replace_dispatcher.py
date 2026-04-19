import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """            match action.tool_name.as_str() {
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
            }"""

replacement = """            let tool_name = action.tool_name.clone();
            let mut is_mcp = false;
            let mut mcp_server = String::new();

            // Assume format "mcp__SERVERNAME__TOOLNAME" for MCP tools
            if tool_name.starts_with("mcp__") {
                let parts: Vec<&str> = tool_name.split("__").collect();
                if parts.len() >= 3 {
                    is_mcp = true;
                    mcp_server = parts[1].to_string();
                }
            }

            if is_mcp {
                println!("[Executing MCP Tool: {}...]", tool_name);
                // Dynamic dispatch via MCP client
                let workspace_root = std::env::current_dir().unwrap_or_default();
                let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| {
                    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                    std::path::PathBuf::from(home).join(".onyx")
                });
                let loader = crate::config::ConfigLoader::new(&workspace_root, &config_home_dir);
                let runtime_config = loader.load().unwrap_or_else(|_| crate::config::RuntimeConfig::empty());

                let mut manager = crate::mcp_stdio::McpServerManager::from_runtime_config(&runtime_config);
                match manager.call_tool(&tool_name, Some(action.arguments.clone())).await {
                    Ok(result) => {
                        exec_status = "Completed";
                        exec_details = format!("MCP tool executed successfully: {:?}", result);
                        println!("[Execution completed for MCP task_id {}]", action.id);
                    }
                    Err(e) => {
                        exec_status = "Failed";
                        exec_details = format!("MCP tool execution failed: {}", e);
                        eprintln!("[Execution failed for MCP task_id {}: {}]", action.id, e);
                    }
                }
            } else {
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
            }"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Replaced execution block")
