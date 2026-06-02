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
