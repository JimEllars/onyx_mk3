import re

with open("rust/crates/runtime/src/swarm.rs", "r") as f:
    content = f.read()

search = """        if !available_tools.is_empty() {
            if let Some(registry) = &self.registry {
                for tool in &available_tools {
                    if let Some((server_name, tool_name)) = tool.name.split_once("__") {
                        let result = execute_mcp_tool(
                            registry,
                            server_name,
                            tool_name,
                            &serde_json::json!({}),
                        );"""

replace = """        if let Some(registry) = &self.registry {
            let mut requested_tool = None;
            let mut tool_args = serde_json::json!({});

            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&packet.context) {
                if let Some(tool) = parsed.get("tool").and_then(|t| t.as_str()) {
                    requested_tool = Some(tool.to_string());
                }
                if let Some(args) = parsed.get("arguments") {
                    tool_args = args.clone();
                }
            } else {
                for tool in &available_tools {
                    if packet.objective.contains(&tool.name) || packet.context.contains(&tool.name) {
                        requested_tool = Some(tool.name.clone());
                        break;
                    }
                }
            }

            if let Some(target_tool_name) = requested_tool {
                if let Some(tool) = available_tools.iter().find(|t| t.name == target_tool_name) {
                    if let Some((server_name, tool_name)) = tool.name.split_once("__") {
                        println!("[Swarm Worker] Routing task to tool: {}", tool.name);
                        let result = execute_mcp_tool(
                            registry,
                            server_name,
                            tool_name,
                            &tool_args,
                        );"""

if search in content:
    content = content.replace(search, replace)

    # Also need to add the closing braces for `if let Some(target_tool_name)` at the end.
    search_end = """                            }
                        }
                    }
                }
            }
        }"""

    replace_end = """                            }
                        }
                    }
                } else {
                    println!("[Swarm Worker] Target tool {} not found in available tools", target_tool_name);
                }
            } else {
                println!("[Swarm Worker] No specific tool requested. Bypassing tool execution.");
            }
        }"""
    if search_end in content:
        content = content.replace(search_end, replace_end)
        with open("rust/crates/runtime/src/swarm.rs", "w") as f:
            f.write(content)
        print("Success")
    else:
        print("End not found")
else:
    print("Search not found")
