import re

with open("rust/crates/runtime/src/internal_mcp.rs", "r") as f:
    content = f.read()

replacement = """        },
        McpToolInfo {
            name: "execute_create_wordpress_post".to_string(),
            description: Some("Create a new post in Headless WordPress".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                    "status": {"type": "string"}
                },
                "required": ["title", "content", "status"]
            })),
        },
        McpToolInfo {
            name: "execute_update_wordpress_post".to_string(),
            description: Some("Update an existing post in Headless WordPress".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "post_id": {"type": "integer"},
                    "content": {"type": "string"}
                },
                "required": ["post_id", "content"]
            })),
        },
        McpToolInfo {
            name: "execute_send_email".to_string(),
            description: Some("Send an email via AXiM Core".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "to": {"type": "string"},
                    "subject": {"type": "string"},
                    "body": {"type": "string"}
                },
                "required": ["to", "subject", "body"]
            })),
        },
        McpToolInfo {
            name: "execute_read_recent_emails".to_string(),
            description: Some("Read recent emails from AXiM Core inbox".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "limit": {"type": "integer"}
                },
                "required": ["limit"]
            })),
        },
    ];"""

content = content.replace("        },\n    ];", replacement)

with open("rust/crates/runtime/src/internal_mcp.rs", "w") as f:
    f.write(content)
