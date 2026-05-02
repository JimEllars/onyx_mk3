with open("rust/crates/runtime/src/lane_events.rs", "r") as f:
    content = f.read()

sub_agent_block = """
    } else if event.r#type == "sub_agent_completed" {
        if let Some(role) = event.payload.get("role").and_then(|v| v.as_str()) {
            if let Some(result) = event.payload.get("result").and_then(|v| v.as_str()) {
                // Route back into parent active session queue as System message
                return Some(format!(
                    "[SUB-AGENT RESULT - Role: {}]: {}. Please synthesize this into your overall objective.",
                    role, result
                ));
            }
        }
"""

import re
content = content.replace('} else if event.r#type == "admin_inbound_message" {', sub_agent_block + '    } else if event.r#type == "admin_inbound_message" {')

with open("rust/crates/runtime/src/lane_events.rs", "w") as f:
    f.write(content)
