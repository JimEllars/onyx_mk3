import re

with open("rust/crates/runtime/src/internal_mcp.rs", "r") as f:
    content = f.read()

content = content.replace("pub fn register_internal_mcp_server(registry: &McpToolRegistry) {", "#[allow(clippy::too_many_lines)]\npub fn register_internal_mcp_server(registry: &McpToolRegistry) {")

with open("rust/crates/runtime/src/internal_mcp.rs", "w") as f:
    f.write(content)
