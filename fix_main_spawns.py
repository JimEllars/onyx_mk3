import re

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

target = """        let _bg = tokio::spawn(async move {
            runtime::team_cron_registry::start_background_tick_loop(cron_registry, fleet_status_clone);
        });

        let fleet_status_polling = fleet_status.clone();
        tokio::spawn(async move {
            let secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
            let edge_url = std::env::var("VITE_ONYX_WORKER_URL").unwrap_or_else(|_| "https://onyx-edge-worker.yourdomain.workers.dev".to_string());
            let client = reqwest::Client::new();
            runtime::fleet_health::start_approval_polling_loop(fleet_status_polling, client, edge_url, secret).await;
        });"""

replacement = """        let _bg = runtime::team_cron_registry::start_background_tick_loop(cron_registry, fleet_status_clone);

        let fleet_status_polling = fleet_status.clone();
        let _bg_polling = {
            let secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
            let edge_url = std::env::var("VITE_ONYX_WORKER_URL").unwrap_or_else(|_| "https://onyx-edge-worker.yourdomain.workers.dev".to_string());
            let client = reqwest::Client::new();
            runtime::fleet_health::start_approval_polling_loop(fleet_status_polling, client, edge_url, secret)
        };"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/onyx/src/main.rs", "w") as f:
        f.write(content)
    print("Fixed spawns in main.rs")
