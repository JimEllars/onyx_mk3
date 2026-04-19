import sys

content = open("rust/crates/onyx/src/main.rs", "r").read()

search = """        let fleet_status_polling = fleet_status.clone();
        tokio::spawn(async move {
            let secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
            let edge_url = std::env::var("VITE_ONYX_WORKER_URL").unwrap_or_else(|_| "https://onyx-edge-worker.yourdomain.workers.dev".to_string());
            let client = reqwest::Client::new();
            runtime::fleet_health::start_approval_polling_loop(fleet_status_polling, client, edge_url, secret).await;
        });"""

replace = """        let fleet_status_polling = fleet_status.clone();
        tokio::spawn(async move {
            let secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
            let edge_url = std::env::var("VITE_ONYX_WORKER_URL").unwrap_or_else(|_| "https://onyx-edge-worker.yourdomain.workers.dev".to_string());
            let client = reqwest::Client::new();
            runtime::fleet_health::start_approval_polling_loop(fleet_status_polling, client, edge_url, secret).await;
        });

        let fleet_status_telemetry = fleet_status.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
            loop {
                interval.tick().await;

                let workspace = runtime::ProjectContext::detect_workspace(std::env::current_dir().unwrap_or_default()).unwrap_or_default();
                let config_home = runtime::ProjectContext::config_home();
                let loader = runtime::ConfigLoader::new(&workspace, &config_home);
                let runtime_config = loader.load().unwrap_or_default();

                let input = tools::supabase_ops::QueryTelemetryLogsInput {
                    brand_id: "all".to_string(),
                    since_minutes: 60,
                    approval_token: Some("auto".to_string()),
                };

                match tools::supabase_ops::execute_query_telemetry_logs(input, &runtime_config).await {
                    Ok(output) => {
                        runtime::fleet_health::evaluate_fleet_health(&fleet_status_telemetry, &output.logs);
                    }
                    Err(e) => {
                        eprintln!("[Telemetry Polling] Error querying telemetry logs: {}", e);
                    }
                }
            }
        });"""

content = content.replace(search, replace)

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
