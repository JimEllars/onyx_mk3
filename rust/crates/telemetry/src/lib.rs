pub mod metrics;
use std::fmt::{Debug, Formatter};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const DEFAULT_ANTHROPIC_VERSION: &str = "2023-06-01";
pub const DEFAULT_APP_NAME: &str = "claude-code";
pub const DEFAULT_RUNTIME: &str = "rust";
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AximTelemetryPayload {
    pub app_id: String,
    pub timestamp: u64,
    pub active_users: u32,
    pub revenue_cents: u64,
    pub error_rate_percent: f32,
    pub server_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TelemetryStatus {
    Healthy,
    Degraded,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryMetrics {
    pub ttft: f64,
    pub latency: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AximTelemetryEnvelope {
    pub timestamp: u64,
    pub service_name: String,
    pub status: TelemetryStatus,
    pub metrics: TelemetryMetrics,
    pub anomalies: Vec<String>,
}

impl Default for AximTelemetryEnvelope {
    fn default() -> Self {
        Self {
            timestamp: current_timestamp_ms(),
            service_name: "onyx_mk3_core".to_string(),
            status: TelemetryStatus::Healthy,
            metrics: TelemetryMetrics {
                ttft: 0.0,
                latency: 0.0,
            },
            anomalies: vec![],
        }
    }
}

pub static QUEUED_TELEMETRY: std::sync::LazyLock<Arc<Mutex<Vec<AximTelemetryEnvelope>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(Vec::new())));

pub fn dispatch_to_axim_ingress(envelope: AximTelemetryEnvelope) {
    if let Ok(url) = std::env::var("CORE_INGEST_URL") {
        let endpoint = format!("{url}/functions/v1/telemetry-ingress");
        let client = reqwest::Client::new();
        tokio::spawn(async move {
            let request_id = uuid::Uuid::new_v4().to_string();

            let mut retries = 0;
            let mut backoff = 200;
            let mut success = false;

            while retries < 3 {
                let req = client
                    .post(&endpoint)
                    .header("X-Request-ID", request_id.clone())
                    .json(&envelope);

                let mut should_retry = false;
                let mut err_msg = String::new();

                match req.send().await {
                    Ok(resp) => {
                        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                            crate::metrics::RATE_LIMIT_COUNT
                                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        }
                        if !resp.status().is_success() {
                            should_retry = true;
                            err_msg = format!("HTTP error: {}", resp.status());
                        }
                    }
                    Err(e) => {
                        should_retry = true;
                        err_msg = e.to_string();
                    }
                }

                if should_retry {
                    tracing::warn!(
                        "Failed to dispatch telemetry to AXiM ingress (attempt {}): {}",
                        retries + 1,
                        err_msg
                    );
                    retries += 1;
                    if retries < 3 {
                        tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
                        backoff *= 2;
                    }
                } else {
                    success = true;
                    break;
                }
            }

            if success {
                metrics::LAST_TELEMETRY_DISPATCH_SUCCESS
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            } else {
                tracing::error!("All retries failed for telemetry dispatch. Queuing internally.");
                metrics::LAST_TELEMETRY_DISPATCH_SUCCESS
                    .store(false, std::sync::atomic::Ordering::Relaxed);
                if let Ok(mut queue) = QUEUED_TELEMETRY.lock() {
                    queue.push(envelope);
                }
            }
        });
    }
}

pub async fn flush_queued_telemetry() {
    let mut envelopes = {
        let Ok(mut queue) = QUEUED_TELEMETRY.lock() else {
            return;
        };
        if queue.is_empty() {
            return;
        }
        let elements = queue.clone();
        queue.clear();
        elements
    };

    // First try AXiM ingress directly
    if let Ok(url) = std::env::var("CORE_INGEST_URL") {
        let endpoint = format!("{url}/functions/v1/telemetry-ingress");
        let client = reqwest::Client::new();

        let mut failed = Vec::new();
        for env in envelopes {
            let request_id = uuid::Uuid::new_v4().to_string();
            let req = client
                .post(&endpoint)
                .header("X-Request-ID", request_id)
                .json(&env);

            if let Err(e) = req.send().await {
                tracing::warn!("Failed to flush queued telemetry directly: {}", e);
                failed.push(env);
            }
        }
        envelopes = failed;
    }

    if envelopes.is_empty() {
        return;
    }

    // Fallback: try edge bridge
    let edge_url =
        std::env::var("AXIM_ONYX_EDGE_URL").unwrap_or_else(|_| "http://localhost:8787".to_string());
    let endpoint = format!("{edge_url}/api/v1/telemetry/flush");
    let secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_else(|_| "default_secret".to_string());

    let client = reqwest::Client::new();
    let request_id = uuid::Uuid::new_v4().to_string();

    let req = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {secret}"))
        .header("X-Request-ID", request_id);

    match req.send().await {
        Err(e) => {
            tracing::warn!("Failed to flush queued telemetry via edge bridge: {}", e);
            if let Ok(mut queue) = QUEUED_TELEMETRY.lock() {
                queue.extend(envelopes);
            }
        }
        Ok(resp) => {
            if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                crate::metrics::RATE_LIMIT_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
}
pub const DEFAULT_AGENTIC_BETA: &str = "claude-code-20250219";
pub const DEFAULT_PROMPT_CACHING_SCOPE_BETA: &str = "prompt-caching-scope-2026-01-05";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientIdentity {
    pub app_name: String,
    pub app_version: String,
    pub runtime: String,
}

impl ClientIdentity {
    #[must_use]
    pub fn new(app_name: impl Into<String>, app_version: impl Into<String>) -> Self {
        Self {
            app_name: app_name.into(),
            app_version: app_version.into(),
            runtime: DEFAULT_RUNTIME.to_string(),
        }
    }

    #[must_use]
    pub fn with_runtime(mut self, runtime: impl Into<String>) -> Self {
        self.runtime = runtime.into();
        self
    }

    #[must_use]
    pub fn user_agent(&self) -> String {
        format!("{}/{}", self.app_name, self.app_version)
    }
}

impl Default for ClientIdentity {
    fn default() -> Self {
        Self::new(DEFAULT_APP_NAME, env!("CARGO_PKG_VERSION"))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnthropicRequestProfile {
    pub anthropic_version: String,
    pub client_identity: ClientIdentity,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub betas: Vec<String>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub extra_body: Map<String, Value>,
}

impl AnthropicRequestProfile {
    #[must_use]
    pub fn new(client_identity: ClientIdentity) -> Self {
        Self {
            anthropic_version: DEFAULT_ANTHROPIC_VERSION.to_string(),
            client_identity,
            betas: vec![
                DEFAULT_AGENTIC_BETA.to_string(),
                DEFAULT_PROMPT_CACHING_SCOPE_BETA.to_string(),
            ],
            extra_body: Map::new(),
        }
    }

    #[must_use]
    pub fn with_beta(mut self, beta: impl Into<String>) -> Self {
        let beta = beta.into();
        if !self.betas.contains(&beta) {
            self.betas.push(beta);
        }
        self
    }

    #[must_use]
    pub fn with_extra_body(mut self, key: impl Into<String>, value: Value) -> Self {
        self.extra_body.insert(key.into(), value);
        self
    }

    #[must_use]
    pub fn header_pairs(&self) -> Vec<(String, String)> {
        let mut headers = vec![
            (
                "anthropic-version".to_string(),
                self.anthropic_version.clone(),
            ),
            ("user-agent".to_string(), self.client_identity.user_agent()),
        ];
        if !self.betas.is_empty() {
            headers.push(("anthropic-beta".to_string(), self.betas.join(",")));
        }
        headers
    }

    pub fn render_json_body<T: Serialize>(&self, request: &T) -> Result<Value, serde_json::Error> {
        let mut body = serde_json::to_value(request)?;
        let object = body.as_object_mut().ok_or_else(|| {
            serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request body must serialize to a JSON object",
            ))
        })?;
        for (key, value) in &self.extra_body {
            object.insert(key.clone(), value.clone());
        }
        if !self.betas.is_empty() {
            object.insert(
                "betas".to_string(),
                Value::Array(self.betas.iter().cloned().map(Value::String).collect()),
            );
        }
        Ok(body)
    }
}

impl Default for AnthropicRequestProfile {
    fn default() -> Self {
        Self::new(ClientIdentity::default())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyticsEvent {
    pub namespace: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub properties: Map<String, Value>,
}

impl AnalyticsEvent {
    #[must_use]
    pub fn new(namespace: impl Into<String>, action: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
            action: action.into(),
            properties: Map::new(),
        }
    }

    #[must_use]
    pub fn with_property(mut self, key: impl Into<String>, value: Value) -> Self {
        self.properties.insert(key.into(), value);
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionTraceRecord {
    pub session_id: String,
    pub sequence: u64,
    pub name: String,
    pub timestamp_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web3_wallet_address: Option<String>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub attributes: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TelemetryEvent {
    ApiUsageLog {
        session_id: String,
        job_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        web3_wallet_address: Option<String>,
        worker_id: String,
        tenant_id: String,
        event_type: String,
        tokens_input: u32,
        tokens_output: u32,
        cost_usd: f64,
        model: String,
    },
    SubAgentEvent {
        session_id: String,
        event_type: String,
        agent_id: String,
        #[serde(default, skip_serializing_if = "Map::is_empty")]
        attributes: Map<String, Value>,
    },
    HttpRequestStarted {
        session_id: String,
        attempt: u32,
        method: String,
        path: String,
        #[serde(default, skip_serializing_if = "Map::is_empty")]
        attributes: Map<String, Value>,
    },
    HttpRequestSucceeded {
        session_id: String,
        attempt: u32,
        method: String,
        path: String,
        status: u16,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(default, skip_serializing_if = "Map::is_empty")]
        attributes: Map<String, Value>,
    },
    HttpRequestFailed {
        session_id: String,
        attempt: u32,
        method: String,
        path: String,
        error: String,
        retryable: bool,
        #[serde(default, skip_serializing_if = "Map::is_empty")]
        attributes: Map<String, Value>,
    },
    Analytics(AnalyticsEvent),
    SessionTrace(SessionTraceRecord),
}

pub mod supabase;

pub trait TelemetrySink: Send + Sync {
    fn record(&self, event: TelemetryEvent);
}

#[derive(Default)]
pub struct MemoryTelemetrySink {
    events: Mutex<Vec<TelemetryEvent>>,
}

impl MemoryTelemetrySink {
    #[must_use]
    pub fn events(&self) -> Vec<TelemetryEvent> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

impl TelemetrySink for MemoryTelemetrySink {
    fn record(&self, event: TelemetryEvent) {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event);
    }
}

pub struct JsonlTelemetrySink {
    path: PathBuf,
    file: Mutex<File>,
}

impl Debug for JsonlTelemetrySink {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JsonlTelemetrySink")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl JsonlTelemetrySink {
    pub fn new(path: impl AsRef<Path>) -> Result<Self, std::io::Error> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl TelemetrySink for JsonlTelemetrySink {
    fn record(&self, event: TelemetryEvent) {
        let Ok(line) = serde_json::to_string(&event) else {
            return;
        };
        let mut file = self
            .file
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
}

#[derive(Clone)]
pub struct SessionTracer {
    session_id: String,
    sequence: Arc<AtomicU64>,
    sink: Arc<dyn TelemetrySink>,
}

impl Debug for SessionTracer {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionTracer")
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl SessionTracer {
    #[must_use]
    pub fn new(session_id: impl Into<String>, sink: Arc<dyn TelemetrySink>) -> Self {
        Self {
            session_id: session_id.into(),
            sequence: Arc::new(AtomicU64::new(0)),
            sink,
        }
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn record(&self, name: impl Into<String>, attributes: Map<String, Value>) {
        let record = SessionTraceRecord {
            session_id: self.session_id.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            name: name.into(),
            timestamp_ms: current_timestamp_ms(),
            web3_wallet_address: None,
            attributes,
        };
        self.sink.record(TelemetryEvent::SessionTrace(record));
    }

    pub fn record_http_request_started(
        &self,
        attempt: u32,
        method: impl Into<String>,
        path: impl Into<String>,
        attributes: Map<String, Value>,
    ) {
        let method = method.into();
        let path = path.into();
        self.sink.record(TelemetryEvent::HttpRequestStarted {
            session_id: self.session_id.clone(),
            attempt,
            method: method.clone(),
            path: path.clone(),
            attributes: attributes.clone(),
        });
        self.record(
            "http_request_started",
            merge_trace_fields(method, path, attempt, attributes),
        );
    }

    pub fn record_http_request_succeeded(
        &self,
        attempt: u32,
        method: impl Into<String>,
        path: impl Into<String>,
        status: u16,
        request_id: Option<String>,
        attributes: Map<String, Value>,
    ) {
        let method = method.into();
        let path = path.into();
        if status == 429 {
            crate::metrics::RATE_LIMIT_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        self.sink.record(TelemetryEvent::HttpRequestSucceeded {
            session_id: self.session_id.clone(),
            attempt,
            method: method.clone(),
            path: path.clone(),
            status,
            request_id: request_id.clone(),
            attributes: attributes.clone(),
        });
        let mut trace_attributes = merge_trace_fields(method, path, attempt, attributes);
        trace_attributes.insert("status".to_string(), Value::from(status));
        if let Some(request_id) = request_id {
            trace_attributes.insert("request_id".to_string(), Value::String(request_id));
        }
        self.record("http_request_succeeded", trace_attributes);
    }

    pub fn record_http_request_failed(
        &self,
        attempt: u32,
        method: impl Into<String>,
        path: impl Into<String>,
        error: impl Into<String>,
        retryable: bool,
        attributes: Map<String, Value>,
    ) {
        let method = method.into();
        let path = path.into();
        let error = error.into();
        self.sink.record(TelemetryEvent::HttpRequestFailed {
            session_id: self.session_id.clone(),
            attempt,
            method: method.clone(),
            path: path.clone(),
            error: error.clone(),
            retryable,
            attributes: attributes.clone(),
        });
        let mut trace_attributes = merge_trace_fields(method, path, attempt, attributes);
        trace_attributes.insert("error".to_string(), Value::String(error));
        trace_attributes.insert("retryable".to_string(), Value::Bool(retryable));
        self.record("http_request_failed", trace_attributes);
    }

    pub fn record_analytics(&self, event: AnalyticsEvent) {
        let mut attributes = event.properties.clone();
        attributes.insert(
            "namespace".to_string(),
            Value::String(event.namespace.clone()),
        );
        attributes.insert("action".to_string(), Value::String(event.action.clone()));
        self.sink.record(TelemetryEvent::Analytics(event));
        self.record("analytics", attributes);
    }
}

fn merge_trace_fields(
    method: String,
    path: String,
    attempt: u32,
    mut attributes: Map<String, Value>,
) -> Map<String, Value> {
    attributes.insert("method".to_string(), Value::String(method));
    attributes.insert("path".to_string(), Value::String(path));
    attributes.insert("attempt".to_string(), Value::from(attempt));
    attributes
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_profile_emits_headers_and_merges_body() {
        let profile = AnthropicRequestProfile::new(
            ClientIdentity::new("claude-code", "1.2.3").with_runtime("rust-cli"),
        )
        .with_beta("tools-2026-04-01")
        .with_extra_body("metadata", serde_json::json!({"source": "test"}));

        assert_eq!(
            profile.header_pairs(),
            vec![
                (
                    "anthropic-version".to_string(),
                    DEFAULT_ANTHROPIC_VERSION.to_string()
                ),
                ("user-agent".to_string(), "claude-code/1.2.3".to_string()),
                (
                    "anthropic-beta".to_string(),
                    "claude-code-20250219,prompt-caching-scope-2026-01-05,tools-2026-04-01"
                        .to_string(),
                ),
            ]
        );

        let body = profile
            .render_json_body(&serde_json::json!({"model": "claude-sonnet"}))
            .expect("body should serialize");
        assert_eq!(
            body["metadata"]["source"],
            Value::String("test".to_string())
        );
        assert_eq!(
            body["betas"],
            serde_json::json!([
                "claude-code-20250219",
                "prompt-caching-scope-2026-01-05",
                "tools-2026-04-01"
            ])
        );
    }

    #[test]
    fn session_tracer_records_structured_events_and_trace_sequence() {
        let sink = Arc::new(MemoryTelemetrySink::default());
        let tracer = SessionTracer::new("session-123", sink.clone());

        tracer.record_http_request_started(1, "POST", "/v1/messages", Map::new());
        tracer.record_analytics(
            AnalyticsEvent::new("cli", "prompt_sent")
                .with_property("model", Value::String("claude-opus".to_string())),
        );

        let events = sink.events();
        assert!(matches!(
            &events[0],
            TelemetryEvent::HttpRequestStarted {
                session_id,
                attempt: 1,
                method,
                path,
                ..
            } if session_id == "session-123" && method == "POST" && path == "/v1/messages"
        ));
        assert!(matches!(
            &events[1],
            TelemetryEvent::SessionTrace(SessionTraceRecord { sequence: 0, name, .. })
            if name == "http_request_started"
        ));
        assert!(matches!(&events[2], TelemetryEvent::Analytics(_)));
        assert!(matches!(
            &events[3],
            TelemetryEvent::SessionTrace(SessionTraceRecord { sequence: 1, name, .. })
            if name == "analytics"
        ));
    }

    #[test]
    fn jsonl_sink_persists_events() {
        let path =
            std::env::temp_dir().join(format!("telemetry-jsonl-{}.log", current_timestamp_ms()));
        let sink = JsonlTelemetrySink::new(&path).expect("sink should create file");

        sink.record(TelemetryEvent::Analytics(
            AnalyticsEvent::new("cli", "turn_completed").with_property("ok", Value::Bool(true)),
        ));

        let contents = std::fs::read_to_string(&path).expect("telemetry log should be readable");
        assert!(contents.contains("\"type\":\"analytics\""));
        assert!(contents.contains("\"action\":\"turn_completed\""));

        let _ = std::fs::remove_file(path);
    }
}
pub mod sync;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FleetHealthMetrics {
    pub active_nodes: u32,
    pub degraded_nodes: u32,
    pub offline_nodes: u32,
    pub global_error_rate: f32,
    pub avg_latency_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EdgeBridgeStatus {
    pub is_connected: bool,
    pub last_heartbeat: u64,
    pub sync_status: String,
    pub pending_webhooks: u32,
}
pub mod dlq;

#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    #[error("HTTP client error: {0}")]
    Reqwest(#[from] reqwest::Error),
    #[error("Failed to parse edge bridge URL")]
    UrlParseError,
}

pub async fn send_session_heartbeat(session_id: &str, user_id: &str) -> Result<(), TelemetryError> {
    let bridge_url =
        std::env::var("AXIM_ONYX_EDGE_URL").unwrap_or_else(|_| "http://127.0.0.1:8787".to_string());
    let token = std::env::var("AXIM_SERVICE_KEY").unwrap_or_else(|_| std::env::var("AXIM_ONYX_SECRET").unwrap_or_default());
    let url = format!(
        "{}/api/v1/session/heartbeat",
        bridge_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "session_id": session_id,
        "user_id": user_id,
        "client_version": env!("CARGO_PKG_VERSION")
    });

    let _ = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .json(&payload)
        .send()
        .await?;

    Ok(())
}

pub fn get_telemetry_queue_depth() -> usize {
    if let Ok(queue) = QUEUED_TELEMETRY.lock() {
        queue.len()
    } else {
        0
    }
}
