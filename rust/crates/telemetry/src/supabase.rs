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
