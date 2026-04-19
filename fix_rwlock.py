import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """    let mut current_status = status.write().unwrap();
    current_status.last_updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();"""

replacement = """    {
        let mut current_status = status.write().unwrap();
        current_status.last_updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    }"""

if target in content:
    content = content.replace(target, replacement)

    # Needs to re-acquire the write lock before modifying state. Let's do it right.
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Fixed evaluate_health_with_ai")
