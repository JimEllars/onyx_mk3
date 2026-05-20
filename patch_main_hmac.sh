cat << 'INNER_EOF' > patch_main_hmac.diff
<<<<<<< SEARCH
        let _tx_queue = task_queue.clone();
        tokio::spawn(async move {
            let duplex_url = std::env::var("AXIM_DUPLEX_SYNC_ENDPOINT")
                .unwrap_or_else(|_| "wss://api.axim.us.com/v1/onyx/duplex".to_string());

            let mut invalidator_rx = runtime::prompt::init_prompt_cache_invalidator();

            loop {
                // Here we would use tokio-tungstenite or similar to establish the WebSocket
                // This simulates the duplex loop processing inbound action packets.
                tokio::select! {
                    () = tokio::time::sleep(tokio::time::Duration::from_secs(5)) => {
                        // Simulate polling for messages or incoming duplex stream data
                        // For example, if we received a cache clear payload from the fleet control gateway:
                        // runtime::prompt::trigger_prompt_cache_invalidation();
                    }
                    Ok(()) = invalidator_rx.recv() => {
                        println!("[Duplex Sync] Received internal trigger. Flushed local cache state. Reloading system prompt variables.");
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
                    () = tokio::time::sleep(tokio::time::Duration::from_secs(5)) => {
                        // Simulate polling for messages or incoming duplex stream data
                        // For example, if we received a cache clear payload from the fleet control gateway:
                        // runtime::prompt::trigger_prompt_cache_invalidation();

                        // Simulate parsing an out-of-band proxy command and validating its HMAC
                        if let Ok(simulated_payload) = std::env::var("SIMULATE_OOB_PAYLOAD") {
                            if let Ok(simulated_signature) = std::env::var("SIMULATE_OOB_SIGNATURE") {
                                if let Ok(secret) = tools::axim_vault::fetch_vault_secret("CREATOR_OOB_SIGNING_KEY").await {
                                    use sha2::{Digest, Sha256};
                                    use std::sync::Mutex;

                                    // Use simple hash for validation, in real usage it's HMAC-SHA256
                                    let mut mac = ring::hmac::Context::with_key(&ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.as_bytes()));
                                    mac.update(simulated_payload.as_bytes());
                                    let result = mac.sign();

                                    let result_hex = hex::encode(result.as_ref());
                                    if result_hex != simulated_signature {
                                        eprintln!("[SECURITY ANOMALY] HMAC signature mismatch on out-of-band creator command. Execution isolated.");
                                        // Stop processing this packet, don't ingest it to _tx_queue
                                    } else {
                                        println!("[Duplex Sync] Out-of-band creator command signature verified. Ingesting.");
                                        // _tx_queue.send(...)
                                    }
                                }
                            }
                        }
                    }
                    Ok(()) = invalidator_rx.recv() => {
                        println!("[Duplex Sync] Received internal trigger. Flushed local cache state. Reloading system prompt variables.");
                    }
                }
            }
        });
>>>>>>> REPLACE
INNER_EOF
