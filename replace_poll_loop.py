import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """pub async fn start_approval_polling_loop(status: GlobalFleetStatus, client: reqwest::Client, edge_url: String, secret: String) {"""

replacement = """pub fn start_approval_polling_loop(status: GlobalFleetStatus, client: reqwest::Client, edge_url: String, secret: String) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {"""

if target in content:
    content = content.replace(target, replacement)

    # Needs to close the spawn block at the end of the file/function.
    # The function ends at the bottom of fleet_health.rs

    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Replaced poll loop signature")
