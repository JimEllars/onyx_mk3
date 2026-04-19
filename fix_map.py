import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

content = content.replace(""".map(std::path::PathBuf::from)
                    .unwrap_or_else(|_| {
                        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                        std::path::PathBuf::from(home).join(".onyx")
                    });""", """.map_or_else(|_| {
                        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                        std::path::PathBuf::from(home).join(".onyx")
                    }, std::path::PathBuf::from);""")


with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
