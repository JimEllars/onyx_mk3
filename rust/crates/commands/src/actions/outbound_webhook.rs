use serde_json::Value;

pub struct OutboundWebhookAction;

impl OutboundWebhookAction {
    pub async fn execute(payload: &Value) -> Result<(), String> {
        if let Ok(webhook_url) = std::env::var("ALBATO_OUTBOUND_WEBHOOK_URL") {
            let client = reqwest::Client::new();
            client
                .post(&webhook_url)
                .json(payload)
                .send()
                .await
                .map_err(|e| format!("Outbound request failed: {e}"))?;
        }
        Ok(())
    }
}
