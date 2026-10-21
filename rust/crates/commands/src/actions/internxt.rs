use serde_json::Value;

pub struct InternxtAction;

impl InternxtAction {
    #[allow(clippy::unused_async)]
    pub async fn secure_backup(payload: &Value) -> Result<(), String> {
        let _client = reqwest::Client::new();
        let _endpoint = std::env::var("INTERNXT_ENDPOINT")
            .unwrap_or_else(|_| "https://api.internxt.com/v1/files".to_string());

        let _access_token =
            std::env::var("INTERNXT_TOKEN").unwrap_or_else(|_| "mock_internxt_token".to_string());

        println!("Mock: Securing backup via Internxt... {payload:?}");

        /*
        let _res = _client
            .post(&_endpoint)
            .header("Authorization", format!("Bearer {}", _access_token))
            .json(payload)
            .send()
            .await
            .map_err(|e| format!("Failed to backup to Internxt: {e}"))?;
        */

        Ok(())
    }
}
