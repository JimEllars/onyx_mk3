<<<<<<< SEARCH
        if !available_tools.is_empty() {
            if let Some(registry) = &self.registry {
                for tool in &available_tools {
                    if let Some((server_name, tool_name)) = tool.name.split_once("__") {
                        let result = execute_mcp_tool(
                            registry,
                            server_name,
                            tool_name,
                            &serde_json::json!({}),
                        );
=======
        if let Some(registry) = &self.registry {
            // Attempt to parse tool name and arguments from packet context
            // Context might contain JSON describing the intended tool:
            // { "tool": "server__name", "arguments": { ... } }
            // If parsing fails, fall back to matching the objective or bypass.

            let mut requested_tool = None;
            let mut tool_args = serde_json::json!({});

            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&packet.context) {
                if let Some(tool) = parsed.get("tool").and_then(|t| t.as_str()) {
                    requested_tool = Some(tool.to_string());
                }
                if let Some(args) = parsed.get("arguments") {
                    tool_args = args.clone();
                }
            } else if packet.objective.contains("__") {
                // Heuristic for simple objective-based routing if context is not JSON
                // e.g. objective = "server__tool"
                for tool in &available_tools {
                    if packet.objective.contains(&tool.name) {
                        requested_tool = Some(tool.name.clone());
                        break;
                    }
                }
            }

            if let Some(target_tool_name) = requested_tool {
                if let Some(tool) = available_tools.iter().find(|t| t.name == target_tool_name) {
                    if let Some((server_name, tool_name)) = tool.name.split_once("__") {
                        let result = execute_mcp_tool(
                            registry,
                            server_name,
                            tool_name,
                            &tool_args,
                        );
>>>>>>> REPLACE
