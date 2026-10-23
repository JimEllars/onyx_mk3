use async_trait::async_trait;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{IpAddr, ToSocketAddrs};
use url::Url;

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

impl ContactScraper {
    fn is_protected_ip(ip: IpAddr) -> bool {
        match ip {
            IpAddr::V4(ipv4) => ipv4.is_loopback() || ipv4.is_private() || ipv4.is_link_local(),
            IpAddr::V6(ipv6) => ipv6.is_loopback(),
        }
    }
}

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

        if target != "Unknown" {
            let parsed_url = if target.starts_with("http") {
                Url::parse(&target).map_err(|e| format!("Invalid URL: {e}"))?
            } else {
                Url::parse(&format!("https://{target}"))
                    .map_err(|e| format!("Invalid URL: {e}"))?
            };

            if let Some(port) = parsed_url.port() {
                if matches!(port, 6543 | 5432 | 8080 | 9000) {
                    return Err(
                        "SSRF_VIOLATION: Target resolves to protected internal network".to_string(),
                    );
                }
            }

            if let Some(host) = parsed_url.host_str() {
                let addrs = format!("{}:{}", host, parsed_url.port().unwrap_or(443))
                    .to_socket_addrs()
                    .map_err(|e| format!("Failed to resolve host: {e}"))?;

                for addr in addrs {
                    if Self::is_protected_ip(addr.ip()) {
                        return Err(
                            "SSRF_VIOLATION: Target resolves to protected internal network"
                                .to_string(),
                        );
                    }
                }
            }
        }

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
