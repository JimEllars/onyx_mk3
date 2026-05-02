import sys
import re

with open("rust/crates/runtime/src/internal_mcp.rs", "r") as f:
    text = f.read()

new_tool = """        McpToolInfo {
            name: "delegate_to_sub_agent".to_string(),
            description: Some("Use this tool to spawn a specialized sub-agent for discrete, complex tasks. Do not wait for the result immediately; the system will notify you when the sub-agent completes.".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "role": {"type": "string"},
                    "task_description": {"type": "string"}
                },
                "required": ["role", "task_description"]
            })),
        },
"""

search = '        McpToolInfo {\n            name: "generate_memory_embedding".to_string(),\n'

if search in text:
    text = text.replace(search, new_tool + search)
    with open("rust/crates/runtime/src/internal_mcp.rs", "w") as f:
        f.write(text)
    print("Success")
else:
    print("Failed")
