import re

with open('rust/crates/runtime/src/fleet_health.rs', 'r') as f:
    content = f.read()

content = content.replace("mut mcp_manager: McpServerManager", "mcp_manager: &mut McpServerManager")
content = content.replace("evaluate_health_with_ai_dynamic(diag, manager.clone())", "evaluate_health_with_ai_dynamic(diag, &mut manager)")

with open('rust/crates/runtime/src/fleet_health.rs', 'w') as f:
    f.write(content)
