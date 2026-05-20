cat << 'INNER_EOF' > rust/crates/onyx/src/main.rs.patch
<<<<<<< SEARCH
        let fleet_status_polling = fleet_status.clone();
        let _bg_polling = {
            let secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
            let edge_url = std::env::var("VITE_ONYX_WORKER_URL")
                .unwrap_or_else(|_| "https://onyx-edge-worker.yourdomain.workers.dev".to_string());
            let client = reqwest::Client::new();
            runtime::fleet_health::start_approval_polling_loop(
                fleet_status_polling,
                client,
                edge_url,
                secret,
            )
        };
=======
        let fleet_status_polling = fleet_status.clone();
        let _bg_polling = {
            let secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
            let edge_url = std::env::var("VITE_ONYX_WORKER_URL")
                .unwrap_or_else(|_| "https://onyx-edge-worker.yourdomain.workers.dev".to_string());
            let client = reqwest::Client::new();
            runtime::fleet_health::start_approval_polling_loop(
                fleet_status_polling,
                client,
                edge_url,
                secret,
            )
        };

        let tx_queue = task_queue.clone();
        tokio::spawn(async move {
            let duplex_url = std::env::var("AXIM_DUPLEX_SYNC_ENDPOINT")
                .unwrap_or_else(|_| "ws://api.axim.us.com/v1/onyx/duplex".to_string());
            loop {
                // Connect to the WebSocket
                // This is a placeholder for actual tokio-tungstenite connection setup.
                println!("[Duplex Sync] Connecting to {duplex_url}");

                // For demonstration, simulating connection drop and retry.
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
            }
        });
>>>>>>> REPLACE
INNER_EOF
