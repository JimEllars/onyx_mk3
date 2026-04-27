use crate::{TelemetryEvent, TelemetrySink};
use reqwest::blocking::Client;
use std::env;

pub struct SupabaseTelemetrySink {
    client: Client,
    endpoint: String,
    bearer_token: String,
}

impl SupabaseTelemetrySink {
    #[must_use]
    pub fn new() -> Option<Self> {
        let endpoint = env::var("AXIM_CORE_LANE_EVENTS_ENDPOINT").ok()?;
        let bearer_token = env::var("AXIM_ONYX_SECRET").unwrap_or_default();
        Some(Self {
            client: Client::new(),
            endpoint,
            bearer_token,
        })
    }
}

impl TelemetrySink for SupabaseTelemetrySink {
    fn record(&self, event: TelemetryEvent) {
        if let Ok(json) = serde_json::to_string(&event) {
            let _ = self
                .client
                .post(&self.endpoint)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", self.bearer_token))
                .body(json)
                .send();
        }
    }
}

impl SupabaseTelemetrySink {
    pub fn dispatch_critical_alert(&self, message: &str, details: &serde_json::Value) {
        let event = serde_json::json!({
            "severity": "CRITICAL",
            "message": message,
            "details": details,
            "timestamp": crate::current_timestamp_ms(),
        });

        if let Ok(json) = serde_json::to_string(&event) {
            let _ = self
                .client
                .post(&self.endpoint)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", self.bearer_token))
                .body(json)
                .send();
        }
    }
}

impl SupabaseTelemetrySink {
    pub fn dispatch_sub_agent_event(&self, event_type: &str, agent_id: &str, attributes: &serde_json::Map<String, serde_json::Value>) {
        let event = serde_json::json!({
            "type": "sub_agent_event",
            "event_type": event_type,
            "agent_id": agent_id,
            "attributes": attributes,
            "timestamp": crate::current_timestamp_ms(),
        });

        if let Ok(json) = serde_json::to_string(&event) {
            let _ = self
                .client
                .post(&self.endpoint)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", self.bearer_token))
                .body(json)
                .send();
        }
    }
}
