use serde_json::Value;

pub struct GoogleSheetsAction;

impl GoogleSheetsAction {
    #[allow(clippy::unused_async)]
    pub async fn log_record(payload: &Value) -> Result<(), String> {
        let _client = reqwest::Client::new();
        let _endpoint = std::env::var("GOOGLE_SHEETS_ENDPOINT")
            .unwrap_or_else(|_| "https://sheets.googleapis.com/v4/spreadsheets/mock_spreadsheet_id/values/A1:append?valueInputOption=USER_ENTERED".to_string());

        let _access_token = std::env::var("GOOGLE_SHEETS_TOKEN")
            .unwrap_or_else(|_| "mock_bearer_token".to_string());

        println!("Mock: Logging record to Google Sheets for jrellars@gmail.com... {payload:?}");

        let _row_values = serde_json::json!({
            "values": [
                [payload.to_string()]
            ]
        });

        /*
        let _res = _client
            .post(&_endpoint)
            .header("Authorization", format!("Bearer {}", _access_token))
            .json(&_row_values)
            .send()
            .await
            .map_err(|e| format!("Failed to log to Google Sheets: {e}"))?;
        */

        Ok(())
    }
}
