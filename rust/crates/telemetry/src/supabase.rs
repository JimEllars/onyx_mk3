use crate::{TelemetryEvent, TelemetrySink};
use reqwest::Client;
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
        let payload = match &event {
            TelemetryEvent::ApiUsageLog {
                session_id,
                job_id,
                worker_id,
                tenant_id,
                event_type,
                tokens_input,
                tokens_output,
                cost_usd,
                model,
            } => {
                serde_json::json!({
                    "table": "api_usage_logs",
                    "data": {
                        "session_id": session_id,
                        "job_id": job_id,
                        "worker_id": worker_id,
                        "tenant_id": tenant_id,
                        "event_type": event_type,
                        "tokens_input": tokens_input,
                        "tokens_output": tokens_output,
                        "cost_usd": cost_usd,
                        "model": model,
                        "timestamp": crate::current_timestamp_ms(),
                    }
                })
            }
            TelemetryEvent::SubAgentEvent {
                session_id,
                event_type,
                agent_id,
                attributes,
            } => {
                serde_json::json!({
                    "table": "events_ax2024",
                    "data": {
                        "session_id": session_id,
                        "worker_id": agent_id,
                        "event_type": event_type,
                        "attributes": attributes,
                        "timestamp": crate::current_timestamp_ms(),
                    }
                })
            }
            _ => {
                serde_json::json!({
                    "table": "events_ax2024",
                    "data": event,
                    "timestamp": crate::current_timestamp_ms()
                })
            }
        };

        if let Ok(json) = serde_json::to_string(&payload) {
            let client = self.client.clone();
            let endpoint = self.endpoint.clone();
            let bearer_token = self.bearer_token.clone();

            // Spawn task to send telemetry asynchronously
            tokio::spawn(async move {
                let _ = client
                    .post(&endpoint)
                    .header("Content-Type", "application/json")
                    .header("Authorization", format!("Bearer {bearer_token}"))
                    .body(json)
                    .send()
                    .await;
            });
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
            let client = self.client.clone();
            let endpoint = self.endpoint.clone();
            let bearer_token = self.bearer_token.clone();

            tokio::spawn(async move {
                let _ = client
                    .post(&endpoint)
                    .header("Content-Type", "application/json")
                    .header("Authorization", format!("Bearer {bearer_token}"))
                    .body(json)
                    .send()
                    .await;
            });
        }
    }
}

impl SupabaseTelemetrySink {
    pub fn dispatch_sub_agent_event(
        &self,
        event_type: &str,
        agent_id: &str,
        attributes: &serde_json::Map<String, serde_json::Value>,
    ) {
        let event = serde_json::json!({
            "type": "sub_agent_event",
            "event_type": event_type,
            "agent_id": agent_id,
            "attributes": attributes,
            "timestamp": crate::current_timestamp_ms(),
        });

        if let Ok(json) = serde_json::to_string(&event) {
            let client = self.client.clone();
            let endpoint = self.endpoint.clone();
            let bearer_token = self.bearer_token.clone();

            tokio::spawn(async move {
                let _ = client
                    .post(&endpoint)
                    .header("Content-Type", "application/json")
                    .header("Authorization", format!("Bearer {bearer_token}"))
                    .body(json)
                    .send()
                    .await;
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supabase_sink_builds_only_when_configured() {
        std::env::remove_var("AXIM_CORE_LANE_EVENTS_ENDPOINT");
        let sink = SupabaseTelemetrySink::new();
        assert!(sink.is_none());

        std::env::set_var("AXIM_CORE_LANE_EVENTS_ENDPOINT", "http://localhost");
        let sink = SupabaseTelemetrySink::new();
        assert!(sink.is_some());
    }
}
