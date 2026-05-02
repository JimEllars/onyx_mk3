use crate::mcp_tool_bridge::{McpConnectionStatus, McpToolInfo, McpToolRegistry};

#[allow(clippy::too_many_lines)]
pub fn register_internal_mcp_server(registry: &McpToolRegistry) {
    let tools = vec![
        McpToolInfo {
            name: "execute_query_telemetry_logs".to_string(),
            description: Some("Query telemetry logs from Supabase".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "brand_id": {"type": "string"},
                    "since_minutes": {"type": "integer"},
                    "approval_token": {"type": ["string", "null"]}
                },
                "required": ["brand_id", "since_minutes"]
            })),
        },
        McpToolInfo {
            name: "execute_record_incident_resolution".to_string(),
            description: Some("Record incident resolution".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "incident": {"type": "string"},
                    "tool_executed": {"type": "string"},
                    "approval_token": {"type": ["string", "null"]}
                },
                "required": ["incident", "tool_executed"]
            })),
        },
        McpToolInfo {
            name: "execute_check_micro_app_transactions".to_string(),
            description: Some(
                "Check micro app transactions from Supabase for a specific app.".to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "app_name": {"type": "string"},
                    "since_minutes": {"type": "integer"},
                    "approval_token": {"type": ["string", "null"]}
                },
                "required": ["app_name", "since_minutes"]
            })),
        },
        McpToolInfo {
            name: "execute_fetch_post".to_string(),
            description: Some("Fetch a post from Headless WordPress".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "post_id": {"type": "integer"}
                },
                "required": ["post_id"]
            })),
        },
        McpToolInfo {
            name: "execute_update_post_content".to_string(),
            description: Some("Update content of a post in Headless WordPress".to_string()),
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
            name: "execute_update_seo_metadata".to_string(),
            description: Some("Update SEO metadata for a post".to_string()),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "post_id": {"type": "integer"},
                    "helmet_payload": {"type": "object"}
                },
                "required": ["post_id", "helmet_payload"]
            })),
        },
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
        McpToolInfo {
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
    ];

    registry.register_server(
        "__internal__",
        McpConnectionStatus::Connected,
        tools,
        vec![],
        Some("Internal Rust Tools".to_string()),
    );
}

use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;

type InternalToolHandler = Box<
    dyn Fn(
            &str,
            &serde_json::Value,
            &crate::config::RuntimeConfig,
        ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send>>
        + Send
        + Sync,
>;

pub static INTERNAL_TOOL_HANDLER: OnceLock<InternalToolHandler> = OnceLock::new();

pub fn set_internal_tool_handler(handler: InternalToolHandler) {
    let _ = INTERNAL_TOOL_HANDLER.set(handler);
}

pub async fn call_internal_tool(
    tool_name: &str,
    arguments: &serde_json::Value,
    config: &crate::config::RuntimeConfig,
) -> Result<serde_json::Value, String> {
    if let Some(handler) = INTERNAL_TOOL_HANDLER.get() {
        handler(tool_name, arguments, config).await
    } else {
        Err("Internal tool handler is not configured".to_string())
    }
}
