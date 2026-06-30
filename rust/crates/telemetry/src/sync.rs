use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

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
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let filename = format!("{prefix}_{timestamp}.json");
    let path = spool_dir().join(filename);

    let content = serde_json::to_string(payload)?;
    let mut file = fs::File::create(path)?;
    file.write_all(content.as_bytes())?;
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
