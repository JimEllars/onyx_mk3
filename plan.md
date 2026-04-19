1. Modify `rust/crates/runtime/src/fleet_health.rs`:
   - Add `created_at: u64` to `ProposedAction`.
   - Update `evaluate_fleet_health` to populate `created_at` with `std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()`.
   - Change `start_approval_polling_loop` signature to take `config: std::sync::Arc<crate::RuntimeConfig>` or similarly handle config so tools can be called. Wait, `execute_purge_zone_cache` doesn't take config, it reads env vars. So no config needed for that one. Let's look at `execute_query_telemetry_logs`, it does take `&RuntimeConfig`. In `main.rs` I will need `RuntimeConfig` for the telemetry polling loop anyway.
   - Update `start_approval_polling_loop` body:
     - check for approvals
     - also check if `action.status == ActionStatus::Pending` and `current_time - action.created_at >= 12 * 3600`. If so, auto-approve and transition to Executing.
     - when in Executing state, call the tool:
       - if `action.tool_name == "purge_zone_cache"`, `tools::cloudflare_ops::execute_purge_zone_cache(tools::cloudflare_ops::PurgeZoneCacheInput { zone_id: ... }).await`.
       - if `action.tool_name == "restart_database"`, simulate or handle appropriately.
       - on success or failure, send POST to `{edge_url}/api/v1/task-status` with `{"task_id": "...", "status": "Completed" | "Failed", "details": "..."}`.

2. Modify `rust/crates/onyx/src/main.rs`:
   - In `run_serve_headless`, we need a `RuntimeConfig`. We can load it using `ConfigLoader` like in other parts of `main.rs`.
   - Spawn a Tokio background task:
     - Runs every 60 seconds.
     - Calls `tools::supabase_ops::execute_query_telemetry_logs` with `QueryTelemetryLogsInput { brand_id: "all".to_string(), since_minutes: 60, approval_token: Some("background_polling".to_string()) }`.
     - Calls `runtime::fleet_health::evaluate_fleet_health(&fleet_status, &output.logs)`.

3. Compile and fix any issues (`cargo check --workspace`).
4. Pre-commit tests.
