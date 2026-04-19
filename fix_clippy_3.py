import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

content = content.replace("pub async fn evaluate_health_with_ai", "#[allow(clippy::too_many_lines)]\npub async fn evaluate_health_with_ai")
content = content.replace("pub fn start_approval_polling_loop", "#[allow(clippy::too_many_lines)]\npub fn start_approval_polling_loop")

content = content.replace(""".map(std::path::PathBuf::from)
                    .unwrap_or_else(|_| {
                        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                        std::path::PathBuf::from(home).join(".onyx")
                    });""", """.map_or_else(|_| {
                        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                        std::path::PathBuf::from(home).join(".onyx")
                    }, std::path::PathBuf::from);""")


with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)
