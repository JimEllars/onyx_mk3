cat << 'INNER_EOF' > patch_main_clippy_if_else.diff
<<<<<<< SEARCH
                                    let result_hex = hex::encode(result.as_ref());
                                    if result_hex != simulated_signature {
                                        eprintln!("[SECURITY ANOMALY] HMAC signature mismatch on out-of-band creator command. Execution isolated.");
                                        // Stop processing this packet, don't ingest it to _tx_queue
                                    } else {
                                        println!("[Duplex Sync] Out-of-band creator command signature verified. Ingesting.");
                                        // _tx_queue.send(...)
                                    }
=======
                                    let result_hex = hex::encode(result.as_ref());
                                    if result_hex == simulated_signature {
                                        println!("[Duplex Sync] Out-of-band creator command signature verified. Ingesting.");
                                        // _tx_queue.send(...)
                                    } else {
                                        eprintln!("[SECURITY ANOMALY] HMAC signature mismatch on out-of-band creator command. Execution isolated.");
                                        // Stop processing this packet, don't ingest it to _tx_queue
                                    }
>>>>>>> REPLACE
INNER_EOF
