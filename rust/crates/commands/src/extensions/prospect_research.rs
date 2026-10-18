use async_trait::async_trait;
use reqwest::Client;
use runtime::api_specs::webhook_payload::AximWebhookPayload;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;

use crate::micro_program::MicroProgram;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ProspectResearchRequest {
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProspectResearchResponse {
    pub status: String,
    pub report: String,
    pub warnings: crate::extensions::WarningMetadata,
}

#[derive(Debug)]
pub struct ProspectResearch;

#[async_trait]
impl MicroProgram for ProspectResearch {
    fn name(&self) -> &'static str {
        "Prospect Research Report"
    }

    fn signature(&self) -> &'static str {
        "generate_prospect_report"
    }

    async fn check_idempotency(
        &self,
        _payload: &AximWebhookPayload,
    ) -> Result<Option<Value>, String> {
        Ok(None)
    }

    async fn execute_internal(&self, payload: &AximWebhookPayload) -> Result<Value, String> {
        let req: ProspectResearchRequest =
            serde_json::from_value(payload.meta_data.clone()).unwrap_or_default();

        let mut missing_fields = Vec::new();

        if req.company_name.is_none() {
            missing_fields.push("company_name".to_string());
        }

        let company_name = req.company_name.unwrap_or_else(|| "Unknown Company".to_string());
        let context = req.context.unwrap_or_else(|| "".to_string());

        let prompt = format!(
            "Generate a comprehensive Prospect Research Report for the company: {}\n\nContext provided: {}\n\nThe output must include:\n1. Company founding and history.\n2. Key decision-makers and contact information.\n3. Local locations, cross-referencing the Longview, TX territory zip codes (75654, 75667, 75633, 75643, 75681, 75639, 75669, 75652, 75631, 75691, 75684, 75662, 75603, 75672, 75602, 75692, 75661, 75657, 75630, 75683, 75640, 75651, 75670, 75672, 75604, 75691, 75692, 75695) while allowing for minor zip code errors.\n4. Analysis of uniform and facility services opportunities, heavily prioritizing rental programs or standard lease options over direct purchase due to recurring revenue benefits.\n5. Recent news, key initiatives, brand logos, colors, competitors, and industry market conditions.\n\nFormat the final output string exactly starting with the header: \"UniFirst Prospect Research Template\"",
            company_name, context
        );
        let request_payload = json!({
            "model": "axim-default",
            "messages": [{
                "role": "user",
                "content": prompt,
            }],
            "system": "You are an expert sales prospect researcher. Generate detailed and accurate prospect research reports.",
            "temperature": 0.2,
            "max_tokens": 4096
        });

        let base_url =
            env::var("AXIM_CORE_URL").unwrap_or_else(|_| "http://127.0.0.1:3141".to_string());
        let token = env::var("AXIM_ONYX_SECRET").unwrap_or_else(|_| String::new());

        let client = Client::new();
        let res = client
            .post(format!("{}/api/v1/chat", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&request_payload)
            .send()
            .await;

        let mut report_text = String::new();
        if let Ok(resp) = res {
            if let Ok(text) = resp.text().await {
                if let Ok(json_body) = serde_json::from_str::<Value>(&text) {
                    if let Some(content) = json_body
                        .pointer("/data/parts/0/text")
                        .and_then(|v| v.as_str())
                    {
                        report_text = content.to_string();
                    }
                }
            }
        }

        if report_text.is_empty() {
             report_text = format!("UniFirst Prospect Research Template\n\nFailed to generate report for {}.", company_name);
        }

        let status = if missing_fields.is_empty() {
            "Report_Generated".to_string()
        } else {
            "Partial_Generation".to_string()
        };

        let res = ProspectResearchResponse {
            status,
            report: report_text,
            warnings: crate::extensions::WarningMetadata { missing_fields },
        };

        Ok(json!(res))
    }
}
