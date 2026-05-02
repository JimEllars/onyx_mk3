import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

handler_code = """                "generate_memory_embedding" => {
                    let text = arguments
                        .get("text")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| "Missing 'text' argument".to_string())?;
                    let output = tools::vector_memory::generate_embedding(text).await?;
                    Ok(serde_json::to_value(output)
                        .map_err(|e| format!("Serialization error: {e}"))?)
                }
"""

content = content.replace("                _ => Err(format!(\"Unknown internal tool: {tool_name}\")),", handler_code + "                _ => Err(format!(\"Unknown internal tool: {tool_name}\")),")

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
