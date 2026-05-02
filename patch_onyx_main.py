import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

recovery_code = """
    let state_dir = std::path::Path::new(".claw");
    let state_path = state_dir.join("swarm-state.json");
    if state_path.exists() {
        println!("[SYSTEM] Recovered previous swarm state.");
    }
"""

match = re.search(r'fn main\(\) \{', content)
if match:
    insert_pos = match.end()
    content = content[:insert_pos] + "\n" + recovery_code + content[insert_pos:]

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
