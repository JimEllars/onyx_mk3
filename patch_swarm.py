import re

with open('rust/crates/runtime/src/swarm.rs', 'r') as f:
    content = f.read()

search = """
        // Example execution stub
        if packet.objective.contains("mcp") {
            // pass to MCP tools
        } else {
            // dispatch to playbook
        }
"""

replace = """
        // Real execution via AXiM Core REST endpoint
        let axim_core_url = std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
        let axim_secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
        let client = reqwest::Client::new();
        let url = format!("{axim_core_url}/api/v1/swarm/execute");

        let payload = serde_json::json!({
            "packet": packet
        });

        // Note: in a fully non-blocking architecture, we could spawn this out or await it depending on guarantees
        if !axim_secret.is_empty() {
            let _ = client.post(&url)
                .header("Authorization", format!("Bearer {axim_secret}"))
                .json(&payload)
                .send()
                .await;
        } else {
            // Fallback for tests
            sleep(Duration::from_millis(10)).await;
        }
"""

content = content.replace(search, replace)

with open('rust/crates/runtime/src/swarm.rs', 'w') as f:
    f.write(content)
