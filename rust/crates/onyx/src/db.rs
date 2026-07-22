use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub struct Database {
    pub conn: Connection,
}

impl Database {
    pub fn new() -> Result<Self> {
        let home_dir = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let db_dir = PathBuf::from(home_dir).join(".onyx");

        if !db_dir.exists() {
            std::fs::create_dir_all(&db_dir)
                .map_err(|e| rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(0),
                    Some(format!("Failed to create db dir: {e}"))
                ))?;
        }

        let db_path = db_dir.join("sessions.db");
        let conn = Connection::open(db_path)?;

        // Initialize schema
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
            [],
        )?;

        Ok(Self { conn })
    }
}

impl Database {
    pub fn save_session(&self, session_id: &str, title: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, title = excluded.title",
            [session_id, title, &now, &now],
        )?;
        Ok(())
    }

    pub fn save_message(&self, msg_id: &str, session_id: &str, role: &str, content: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO messages (id, session_id, role, content, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET content = excluded.content",
            [msg_id, session_id, role, content, &now],
        )?;
        Ok(())
    }
}
