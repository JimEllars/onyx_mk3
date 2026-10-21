use serde_json::Value;

pub struct GoogleWorkspaceAction;

impl GoogleWorkspaceAction {
    #[allow(clippy::unused_async)]
    pub async fn save_to_drive(payload: &Value) -> Result<(), String> {
        let _client = reqwest::Client::new();
        let _endpoint = std::env::var("GOOGLE_DRIVE_ENDPOINT").unwrap_or_else(|_| {
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart".to_string()
        });

        let _access_token = std::env::var("GOOGLE_WORKSPACE_TOKEN")
            .unwrap_or_else(|_| "mock_bearer_token".to_string());

        println!("Mock: Saving output to Google Drive for jrellars@gmail.com... {payload:?}");

        /*
        let _res = _client
            .post(&_endpoint)
            .header("Authorization", format!("Bearer {}", _access_token))
            .json(payload)
            .send()
            .await
            .map_err(|e| format!("Failed to save to Google Drive: {e}"))?;
        */

        Ok(())
    }

    #[allow(clippy::unused_async)]
    pub async fn send_via_gmail(payload: &Value) -> Result<(), String> {
        let _client = reqwest::Client::new();
        let _endpoint = std::env::var("GMAIL_ENDPOINT").unwrap_or_else(|_| {
            "https://gmail.googleapis.com/gmail/v1/users/jrellars@gmail.com/messages/send"
                .to_string()
        });

        let _access_token = std::env::var("GOOGLE_WORKSPACE_TOKEN")
            .unwrap_or_else(|_| "mock_bearer_token".to_string());

        println!("Mock: Sending output via Gmail for jrellars@gmail.com... {payload:?}");

        /*
        let _res = _client
            .post(&_endpoint)
            .header("Authorization", format!("Bearer {}", _access_token))
            .json(payload)
            .send()
            .await
            .map_err(|e| format!("Failed to send via Gmail: {e}"))?;
        */

        Ok(())
    }
}
