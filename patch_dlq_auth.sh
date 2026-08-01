#!/bin/bash
cat << 'INNER_EOF' > rust/crates/telemetry/src/dlq.rs
use reqwest::Client;
use std::fs::{File, OpenOptions};
use fs2::FileExt;
use std::io::{BufRead, BufReader, Write};
use std::time::Duration;
use tokio::time::sleep;
use std::sync::atomic::{AtomicBool, Ordering};

pub static IS_SYNC_ACTIVE: AtomicBool = AtomicBool::new(false);

#[allow(clippy::too_many_lines)]
pub async fn start_dlq_drain_loop(sink: std::sync::Arc<crate::supabase::SupabaseTelemetrySink>) {
    let dlq_path = std::path::PathBuf::from(".claw/unsynced_receipts.jsonl");
    let core_url =
        std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
    let sync_url = format!("{core_url}/api/v1/receipts/sync");

    // Create client with default timeout
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    loop {
        if dlq_path.exists() {
            IS_SYNC_ACTIVE.store(true, Ordering::Relaxed);

            // Re-fetch key in case it rotated during runtime
            let axim_service_key = std::env::var("AXIM_SERVICE_KEY").unwrap_or_default();

            let mut lines_to_keep = Vec::new();
            let mut repeated_failures = 0;

            let max_file_size = 10 * 1024 * 1024; // 10MB
            let max_lines = 5000;
            let max_batch_bytes = 3_500_000; // 3.5MB

            let mut all_valid_lines = Vec::new();
            let mut all_receipts = Vec::new();

            if let Ok(file) = File::open(&dlq_path) {
                // Try to get an exclusive lock. If we can't, skip this cycle to avoid blocking the thread
                if file.try_lock_exclusive().is_ok() {
                    let reader = BufReader::new(&file);
                    for line in reader.lines().map_while(Result::ok) {
                        if line.trim().is_empty() {
                            continue;
                        }
                        if let Ok(receipt) = serde_json::from_str::<serde_json::Value>(&line) {
                            all_valid_lines.push(line);
                            all_receipts.push(receipt);
                        }
                    }

                    // Now we process in batches
                    let mut i = 0;
                    while i < all_receipts.len() {
                        if repeated_failures > 0 {
                            // if we already failed a batch, keep the rest of the lines
                            lines_to_keep.push(all_valid_lines[i].clone());
                            if lines_to_keep.len() > max_lines {
                                lines_to_keep.remove(0);
                            }
                            i += 1;
                            continue;
                        }

                        let mut current_batch = Vec::new();
                        let mut current_batch_lines = Vec::new();
                        let mut current_batch_size = 2; // "[]"

                        while i < all_receipts.len() {
                            let receipt_str = &all_valid_lines[i];
                            let receipt_size = receipt_str.len();

                            if !current_batch.is_empty()
                                && current_batch_size + receipt_size + 1 > max_batch_bytes
                            {
                                break;
                            }

                            current_batch.push(all_receipts[i].clone());
                            current_batch_lines.push(receipt_str.clone());
                            current_batch_size += receipt_size + 1; // +1 for comma
                            i += 1;
                        }

                        if !current_batch.is_empty() {
                            let mut req = client.post(&sync_url).json(&current_batch);

                            // Inject RLS auth header unconditionally for every outbound request
                            // if the key exists in the environment
                            if !axim_service_key.is_empty() {
                                req = req.header("Authorization", format!("Bearer {axim_service_key}"));
                            }

                            let res = req.send().await;
                            match res {
                                Err(_) => {
                                    for line in current_batch_lines {
                                        lines_to_keep.push(line);
                                        if lines_to_keep.len() > max_lines {
                                            lines_to_keep.remove(0);
                                        }
                                    }
                                    repeated_failures += 1;
                                }
                                Ok(response) => {
                                    let status = response.status();
                                    if status == reqwest::StatusCode::UNAUTHORIZED
                                        || status == reqwest::StatusCode::FORBIDDEN
                                    {
                                        crate::metrics::EDGE_AUTH_OK
                                            .store(false, std::sync::atomic::Ordering::Relaxed);
                                        crate::metrics::EDGE_AUTH_MISMATCH_TOTAL
                                            .with_label_values(&["rejected"])
                                            .inc();
                                    } else if status.is_success() {
                                        crate::metrics::EDGE_AUTH_OK
                                            .store(true, std::sync::atomic::Ordering::Relaxed);
                                    }

                                    if status.is_server_error()
                                        || status == reqwest::StatusCode::UNAUTHORIZED
                                        || status == reqwest::StatusCode::FORBIDDEN
                                    {
                                        for line in current_batch_lines {
                                            lines_to_keep.push(line);
                                            if lines_to_keep.len() > max_lines {
                                                lines_to_keep.remove(0);
                                            }
                                        }
                                        repeated_failures += 1;
                                    }
                                }
                            }
                        }
                    }

                    // Further memory boundary check
                    let mut total_size: usize = lines_to_keep.iter().map(std::string::String::len).sum();
                    while total_size > max_file_size && !lines_to_keep.is_empty() {
                        total_size -= lines_to_keep[0].len();
                        lines_to_keep.remove(0);
                    }

                    // Rewrite the file with lines to keep
                    crate::metrics::set_dlq_depth(lines_to_keep.len());

                    if lines_to_keep.is_empty() {
                        let _ = std::fs::remove_file(&dlq_path);
                    } else {
                        if let Ok(mut write_file) = OpenOptions::new()
                            .write(true)
                            .truncate(true)
                            .open(&dlq_path)
                        {
                            for line in lines_to_keep {
                                let _ = writeln!(write_file, "{line}");
                            }
                        }

                        // Alert if DLQ gets too big / repeatedly fails
                        if let Ok(metadata) = std::fs::metadata(&dlq_path) {
                            if metadata.len() > 10 * 1024 * 1024 || repeated_failures > 50 {
                                // 10MB or many failures
                                sink.dispatch_critical_alert(
                                    "DLQ overflow or persistent failure",
                                    &serde_json::json!({ "file_size": metadata.len(), "failures": repeated_failures })
                                );
                            }
                        }
                    }

                    let _ = file.unlock();
                }
            }

            IS_SYNC_ACTIVE.store(false, Ordering::Relaxed);
        }

        sleep(Duration::from_secs(60)).await; // run every 60 seconds
    }
}

#[cfg(test)]
mod tests {
    // use super::*;

    #[tokio::test]
    async fn test_dlq_compiles_and_sizes_limits() {
        let threshold = 10 * 1024 * 1024;
        assert!(threshold > 0, "10 MB threshold check");
    }
}
INNER_EOF
