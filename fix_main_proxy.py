import re
import sys

def patch():
    with open("rust/crates/onyx/src/main.rs", "r") as f:
        content = f.read()

    replacement = """
    let env_map: std::collections::HashMap<String, String> = std::env::vars().collect();
    if let Err(e) = runtime::config_validate::validate_proxy_mode_secrets(&env_map) {
        eprintln!("[Boot Error]: {}", e);
        std::process::exit(1);
    }
"""

    start_idx = content.find("    let env_map: std::collections::HashMap<String, String> = std::env::vars().collect();")
    end_idx = content.find("    }", start_idx) + 5

    if start_idx == -1:
        print("Function not found!")
        sys.exit(1)

    new_content = content[:start_idx] + "\n" + content[end_idx:]

    main_idx = new_content.find("fn main() {")
    new_content = new_content[:main_idx+12] + replacement + new_content[main_idx+12:]

    with open("rust/crates/onyx/src/main.rs", "w") as f:
        f.write(new_content)

patch()
