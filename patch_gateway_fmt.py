with open('rust/crates/tools/src/axim_gateway.rs', 'r') as f:
    content = f.read()

content = content.replace('format!("{}/api/v1/gateway", base_url)', 'format!("{base_url}/api/v1/gateway")')
content = content.replace('format!("Bearer {}", temporal_token)', 'format!("Bearer {temporal_token}")')
content = content.replace('format!("Gateway request failed: {}", e)', 'format!("Gateway request failed: {e}")')
content = content.replace('format!("Failed to read gateway response: {}", e)', 'format!("Failed to read gateway response: {e}")')

old_err_fmt = """return Err(ToolError::new(format!(
            "Gateway returned error: {} - {}",
            status, body
        )));"""
new_err_fmt = """return Err(ToolError::new(format!(
            "Gateway returned error: {status} - {body}"
        )));"""

content = content.replace(old_err_fmt, new_err_fmt)

with open('rust/crates/tools/src/axim_gateway.rs', 'w') as f:
    f.write(content)
