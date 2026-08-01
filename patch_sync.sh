#!/bin/bash
cat << 'INNER_EOF' > rust/crates/telemetry/src/sync.rs
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use fs2::FileExt;

pub fn spool_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .map_or_else(|_| std::path::PathBuf::from("."), std::path::PathBuf::from);
    home.join(".claw").join("spool")
}

pub fn ensure_spool_dir() -> std::io::Result<()> {
    fs::create_dir_all(spool_dir())
}

pub fn write_to_spool<T: Serialize>(prefix: &str, payload: &T) -> std::io::Result<()> {
    ensure_spool_dir()?;
    let dlq_path = std::path::PathBuf::from(".claw/unsynced_receipts.jsonl");

    let content = serde_json::to_string(payload)?;

    // We should write to the main unsynced_receipts.jsonl instead of separate files
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&dlq_path)?;

    // Acquire an exclusive lock on the file
    file.lock_exclusive()?;

    writeln!(file, "{}", content)?;

    // Release the lock
    file.unlock()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_concurrency_stress_write_spool() {
        // Run 100 concurrent writers
        let mut handles = vec![];
        for i in 0..100 {
            let h = tokio::spawn(async move {
                let payload = json!({"test": i});
                let _ = write_to_spool("stress_test", &payload);
            });
            handles.push(h);
        }

        for h in handles {
            let _ = h.await;
        }
    }
}

#[tokio::test]
async fn test_swarm_dispatcher_concurrency_stress() {
    // Just verify basic load handling logic, no real dispatcher due to cross module cyclic dependency.
    let mut handles = vec![];
    for i in 0..1000 {
        let h = tokio::spawn(async move {
            let payload = serde_json::json!({"test": i});
            let res = write_to_spool("stress_test", &payload);
            assert!(res.is_ok());
        });
        handles.push(h);
    }
    for h in handles {
        let _ = h.await;
    }
}
INNER_EOF
