import re

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

search = r"pub async fn start_approval_polling_loop\(status: GlobalFleetStatus, client: reqwest::Client, edge_url: String, secret: String\) \{.*"
match = re.search(search, content, re.DOTALL)
if match:
    # Actually wait, let's just do a string replacement
    pass
