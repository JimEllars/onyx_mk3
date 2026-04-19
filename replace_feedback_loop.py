import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

# Define the target block to replace
target_block = """            // Task 2: Feedback Loop
            let feedback_url = format!("{}/api/v1/task-status", edge_url);
            let payload = serde_json::json!({
                "task_id": action.id,
                "status": exec_status,
                "details": exec_details
            });

            match client.post(&feedback_url)
                .header("Authorization", format!("Bearer {}", secret))
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await {
                Ok(resp) if resp.status().is_success() => {
                    println!("[Feedback sent for task_id {}]", action.id);
                }
                Ok(resp) => {
                    eprintln!("[Feedback failed for task_id {} with status: {}]", action.id, resp.status());
                }
                Err(e) => {
                    eprintln!("[Feedback error for task_id {}: {}]", action.id, e);
                }
            }"""

replacement_block = """            // Task 2: Feedback Loop
            let feedback_url = format!("{}/api/v1/task-status", edge_url);
            let payload = serde_json::json!({
                "task_id": action.id,
                "status": exec_status,
                "details": exec_details
            });

            let mut retries = 3;
            while retries > 0 {
                match client.post(&feedback_url)
                    .header("Authorization", format!("Bearer {}", secret))
                    .header("Content-Type", "application/json")
                    .timeout(std::time::Duration::from_secs(10))
                    .json(&payload)
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

if target_block in content:
    content = content.replace(target_block, replacement_block)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Replaced feedback loop successfully.")
else:
    print("Target block not found.")
