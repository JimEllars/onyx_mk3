import re

with open("rust/crates/tools/src/communication_ops.rs", "r") as f:
    content = f.read()

content = content.replace(
    'let log_entry = format!("{{\\"uuid\\": \\"{}\\", \\"type\\": \\"{}\\", \\"timestamp\\": {}, \\"status_code\\": {}, \\"to\\": \\"{}\\"}}\\n", \n                uuid, payload_type, timestamp, status_code, to);',
    'let log_entry = format!("{{\\"uuid\\": \\"{uuid}\\", \\"type\\": \\"{payload_type}\\", \\"timestamp\\": {timestamp}, \\"status_code\\": {status_code}, \\"to\\": \\"{to}\\"}}\\n");'
)

content = content.replace(
    'Err(format!("Axim API error: {}", status))',
    'Err(format!("Axim API error: {status}"))'
)

with open("rust/crates/tools/src/communication_ops.rs", "w") as f:
    f.write(content)
