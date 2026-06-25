import re

with open('rust/crates/runtime/src/swarm.rs', 'r') as f:
    content = f.read()

search = """
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

replace = """
        if axim_secret.is_empty() {
            // Fallback for tests
            sleep(Duration::from_millis(10)).await;
        } else {
            let _ = client.post(&url)
                .header("Authorization", format!("Bearer {axim_secret}"))
                .json(&payload)
                .send()
                .await;
        }
"""

content = content.replace(search, replace)

with open('rust/crates/runtime/src/swarm.rs', 'w') as f:
    f.write(content)
