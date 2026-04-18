import sys

content = open("rust/crates/onyx/src/main.rs", "r").read()

search = """let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".onyx"));"""
replace = """let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| {
                    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                    std::path::PathBuf::from(home).join(".onyx")
                });"""

content = content.replace(search, replace)
with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
