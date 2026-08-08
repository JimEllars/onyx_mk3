import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

# Insert api::spawn_provider_health_heartbeat(); early in main
# find the first fn main()
main_idx = content.find("fn main() {")

if main_idx != -1:
    body_idx = main_idx + len("fn main() {")
    new_content = content[:body_idx] + "\n    api::spawn_provider_health_heartbeat();" + content[body_idx:]
    with open("rust/crates/onyx/src/main.rs", "w") as f:
        f.write(new_content)
    print("Patched main.rs")
else:
    print("main() not found")
