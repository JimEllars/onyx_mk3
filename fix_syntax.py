import sys

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

search = """                    } {
                        Ok(_) => {
                        Ok(output) if output.success => {
                            exec_status = "Completed";
                            exec_details = "Cache purged successfully".to_string();
                            println!("[Execution completed for task_id {}]", action.id);
                        }
                        Ok(_) => {
                            exec_status = "Failed";
                            exec_details = "Cache purge returned false success".to_string();
                            eprintln!("[Execution failed for task_id {}]", action.id);
                        }
                        Err(e) => {
                            exec_status = "Failed";
                            exec_details = format!("Error: {}", e);
                            eprintln!("[Execution failed for task_id {}: {}]", action.id, e);
                        }
                    }"""

replace = """                    } {
                        Ok(output) => {
                            exec_status = "Completed";
                            exec_details = "Cache purged successfully".to_string();
                            println!("[Execution completed for task_id {}]", action.id);
                        }
                        Err(e) => {
                            exec_status = "Failed";
                            exec_details = format!("Error: {}", e);
                            eprintln!("[Execution failed for task_id {}: {}]", action.id, e);
                        }
                    }"""

content = content.replace(search, replace)
with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)
