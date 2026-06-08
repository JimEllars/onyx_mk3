sed -i 's/"".to_string()/String::new()/g' rust/crates/commands/src/micro_program.rs
sed -i 's/format!("Failed to build client: {}", e)/format!("Failed to build client: {e}")/g' rust/crates/commands/src/micro_program.rs
sed -i 's/format!("{}\\/api\\/v1\\/satellite_job_queue\\/spawn", axim_core_url)/format!("{axim_core_url}\\/api\\/v1\\/satellite_job_queue\\/spawn")/g' rust/crates/commands/src/micro_program.rs
sed -i 's/format!("Bearer {}", axim_mcp_token)/format!("Bearer {axim_mcp_token}")/g' rust/crates/commands/src/micro_program.rs
sed -i 's/println!("Successfully dispatched job {} to satellite queue", job_id);/println!("Successfully dispatched job {job_id} to satellite queue");/g' rust/crates/commands/src/micro_program.rs
sed -i 's/eprintln!("Failed to dispatch job {} to satellite queue: {}", job_id, e);/eprintln!("Failed to dispatch job {job_id} to satellite queue: {e}");/g' rust/crates/commands/src/micro_program.rs
