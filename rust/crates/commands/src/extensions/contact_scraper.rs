use async_trait::async_trait;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::actions::axim_core_relay::AximCoreRelayAction;
use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ContactScraperRequest {
    #[serde(default)]
    pub target_domain: Option<String>,
    #[serde(default)]
    pub search_query: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactScraperResponse {
    pub status: String,
    pub leads_found: usize,
    pub payload_forwarded: bool,
    pub warnings: crate::extensions::WarningMetadata,
}

#[derive(Debug)]
pub struct ContactScraper;

#[async_trait]
impl MicroProgram for ContactScraper {
    fn name(&self) -> &'static str {
        "Contact Scraper & Enricher"
    }

    fn signature(&self) -> &'static str {
        "run_contact_scraper"
    }

    async fn check_idempotency(
        &self,
        _payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        Ok(None)
    }

    async fn execute_internal(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let req: ContactScraperRequest =
            serde_json::from_value(payload.meta_data.clone()).unwrap_or_default();

        let mut missing_fields = Vec::new();

        if req.target_domain.is_none() {
            missing_fields.push("target_domain".to_string());
        }

        let target = req.target_domain.unwrap_or_else(|| "Unknown".to_string());
        let scraped_data = json!({
            "entity_type": "business",
            "name": target,
            "contact_info": {
                "email": "mock@example.com",
                "phone": "555-0199"
            },
            "industry": "Unknown",
            "source": "automated_scraper",
        });

        // Generalized ecosystem broadcast payload
        let enrich_payload = json!({
            "intent": "ecosystem_entity_discovery",
            "entity": scraped_data,
        });

        // Pass to AximCoreRelayAction to route to the ecosystem (Deskera CRM routing removed)
        let forward_res = AximCoreRelayAction::execute(&enrich_payload).await;

        let status = if missing_fields.is_empty() {
            "Completed".to_string()
        } else {
            "Partial_Completion".to_string()
        };

        let res = ContactScraperResponse {
            status,
            leads_found: 1, // simulated
            payload_forwarded: forward_res.is_ok(),
            warnings: crate::extensions::WarningMetadata { missing_fields },
        };

        Ok(json!(res))
    }
}
