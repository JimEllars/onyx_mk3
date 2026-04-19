import sys

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

search = """                        Ok(_) => {
                            exec_status = "Completed";
                            exec_details = "Cache purged successfully".to_string();
                            println!("[Execution completed for task_id {}]", action.id);
                        }
                        Ok(_) => {
                            exec_status = "Failed";
                            exec_details = "Cache purge returned false success".to_string();
                            eprintln!("[Execution failed for task_id {}]", action.id);
                        }"""

replace = """                        Ok(_) => {
                            exec_status = "Completed";
                            exec_details = "Cache purged successfully".to_string();
                            println!("[Execution completed for task_id {}]", action.id);
                        }"""

content = content.replace(search, replace)
with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)
