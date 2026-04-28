import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

content = content.replace("fn main() {", "#[allow(clippy::too_many_lines)]\nfn main() {")

content = content.replace(".and_then(|v| v.as_u64())", ".and_then(serde_json::Value::as_u64)")

# The limit line
limit_old = """let limit = arguments
                        .get("limit")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(10) as u32;"""
limit_new = """let limit = arguments
                        .get("limit")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(10);
                    let limit = u32::try_from(limit).unwrap_or(10);"""

content = content.replace(limit_old, limit_new)

# if limit_old wasn't exactly formatted that way:
limit_inline = 'let limit = arguments.get("limit").and_then(serde_json::Value::as_u64).unwrap_or(10) as u32;'
limit_inline_new = 'let limit = arguments.get("limit").and_then(serde_json::Value::as_u64).unwrap_or(10);\n                    let limit = u32::try_from(limit).unwrap_or(10);'
content = content.replace(limit_inline, limit_inline_new)

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
