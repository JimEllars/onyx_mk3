import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

# Locate the match client.post(&feedback_url) block
match_str = """            match client.post(&feedback_url)
                .header("Authorization", format!("Bearer {}", secret))
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await {"""
replace_str = """            let mut retries = 3;
            while retries > 0 {
                match client.post(&feedback_url)
                    .header("Authorization", format!("Bearer {}", secret))
                    .header("Content-Type", "application/json")
                    .json(&payload)
                    .timeout(std::time::Duration::from_secs(10))
                    .send()
                    .await {
                    Ok(resp) if resp.status().is_success() => {
                        println!("[Feedback sent for task_id {}]", action.id);
                        break;
                    }
                    Ok(resp) => {
                        eprintln!("[Feedback failed for task_id {} with status: {}]", action.id, resp.status());
                        retries -= 1;
                        if retries > 0 {
                            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        }
                    }
                    Err(e) => {
                        eprintln!("[Feedback error for task_id {}: {}]", action.id, e);
                        retries -= 1;
                        if retries > 0 {
                            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        }
                    }
                }
            }"""

if match_str in content:
    content = content.replace(match_str, replace_str)

    # We also need to fix the closing brace of the match block if it's changed, but the replacement
    # replaces the `match...` down to `.await {` and the inner `Ok`, `Err` blocks. Let's just do a string replacement.
