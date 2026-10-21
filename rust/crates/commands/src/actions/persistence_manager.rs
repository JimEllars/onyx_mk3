use serde_json::Value;

use crate::actions::google_workspace::GoogleWorkspaceAction;
use crate::actions::internxt::InternxtAction;

pub struct PersistenceManager;

impl PersistenceManager {
    pub async fn dual_save(payload: &Value) -> Result<(), String> {
        let (drive_res, internxt_res) = tokio::join!(
            GoogleWorkspaceAction::save_to_drive(payload),
            InternxtAction::secure_backup(payload)
        );

        if let Err(e) = drive_res {
            eprintln!("Failed to save to Google Drive: {e}");
        }
        if let Err(e) = internxt_res {
            eprintln!("Failed to secure backup to Internxt: {e}");
        }

        Ok(())
    }
}
