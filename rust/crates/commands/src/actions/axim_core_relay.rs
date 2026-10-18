use serde_json::Value;

pub struct AximCoreRelayAction;

impl AximCoreRelayAction {
    pub async fn execute(payload: &Value) -> Result<(), String> {
        let is_deskera = payload.get("intent").and_then(|i| i.as_str()) == Some("sync_lead_enrich");
        let endpoint_env = if is_deskera {
            "AXIM_CORE_CRM_URL"
        } else {
            "AXIM_CORE_API_URL"
        };
        if let Ok(webhook_url) = std::env::var(endpoint_env) {
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
