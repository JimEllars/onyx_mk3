use serde_json::Value;

pub struct GoogleWorkspaceAction;

impl GoogleWorkspaceAction {
    // Stub: the real call is commented out below. The async signature is kept so
    // the call sites do not have to change when it is wired up. `unused_async`
    // covered this until clippy 1.99 started reporting it as
    // `unused_async_trait_impl`; both names are allowed for toolchain spread.
    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)]
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

    // Stub: the real call is commented out below. The async signature is kept so
    // the call sites do not have to change when it is wired up. `unused_async`
    // covered this until clippy 1.99 started reporting it as
    // `unused_async_trait_impl`; both names are allowed for toolchain spread.
    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)]
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
