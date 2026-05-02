import re

with open("rust/crates/runtime/src/internal_mcp.rs", "r") as f:
    content = f.read()

tool_code = """        McpToolInfo {
            name: "generate_memory_embedding".to_string(),
            description: Some("Use this tool to convert important contextual summaries into vector embeddings for long-term storage.".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string"}
                },
                "required": ["text"]
            })),
        },
"""

# Insert before `    ];`
content = content.replace("    ];\n\n    registry.register_server", tool_code + "    ];\n\n    registry.register_server")

with open("rust/crates/runtime/src/internal_mcp.rs", "w") as f:
    f.write(content)
