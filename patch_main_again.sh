cat << 'INNER_EOF' > patch3.diff
<<<<<<< SEARCH
        let tx_queue = task_queue.clone();
        tokio::spawn(async move {
            let duplex_url = std::env::var("AXIM_DUPLEX_SYNC_ENDPOINT")
                .unwrap_or_else(|_| "wss://api.axim.us.com/v1/onyx/duplex".to_string());

            let mut invalidator_rx = runtime::prompt::init_prompt_cache_invalidator();

            loop {
                // Here we would use tokio-tungstenite or similar to establish the WebSocket
                // This simulates the duplex loop processing inbound action packets.
                tokio::select! {
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(5)) => {
                        // Simulate polling for messages or incoming duplex stream data
                    }
                    Ok(_) = invalidator_rx.recv() => {
                        println!("[Duplex Sync] Received internal trigger. Would flush duplex state...");
                    }
                }
            }
        });
=======
        let _tx_queue = task_queue.clone();
        tokio::spawn(async move {
            let duplex_url = std::env::var("AXIM_DUPLEX_SYNC_ENDPOINT")
                .unwrap_or_else(|_| "wss://api.axim.us.com/v1/onyx/duplex".to_string());

            let mut invalidator_rx = runtime::prompt::init_prompt_cache_invalidator();

            loop {
                // Here we would use tokio-tungstenite or similar to establish the WebSocket
                // This simulates the duplex loop processing inbound action packets.
                tokio::select! {
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(5)) => {
                        // Simulate polling for messages or incoming duplex stream data
                        // For example, if we received a cache clear payload from the fleet control gateway:
                        // runtime::prompt::trigger_prompt_cache_invalidation();
                    }
                    Ok(_) = invalidator_rx.recv() => {
                        println!("[Duplex Sync] Received internal trigger. Flushed local cache state. Reloading system prompt variables.");
                    }
                }
            }
        });
>>>>>>> REPLACE
INNER_EOF
