use prometheus::{
    register_counter_vec, register_gauge, register_histogram_vec, CounterVec, Encoder, Gauge,
    HistogramVec, TextEncoder,
};
use std::sync::LazyLock;

pub static HTTP_REQUESTS_TOTAL: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "onyx_http_requests_total",
        "Total HTTP requests by endpoint and status",
        &["endpoint", "status"]
    )
    .unwrap()
});

pub static HTTP_REQUEST_DURATION: LazyLock<HistogramVec> = LazyLock::new(|| {
    register_histogram_vec!(
        "onyx_http_request_duration_seconds",
        "HTTP request latency in seconds",
        &["endpoint"],
        vec![0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0]
    )
    .unwrap()
});

pub static ACTIVE_CONNECTIONS: LazyLock<Gauge> = LazyLock::new(|| {
    register_gauge!(
        "onyx_active_connections",
        "Number of active WebSocket connections"
    )
    .unwrap()
});

pub static SUB_AGENTS_SPAWNED: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "onyx_sub_agents_spawned_total",
        "Total sub-agents spawned by role",
        &["role"]
    )
    .unwrap()
});

pub static SUB_AGENTS_KILLED: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "onyx_sub_agents_killed_total",
        "Sub-agents killed (timeout or manual)",
        &["role", "reason"]
    )
    .unwrap()
});

pub static VAULT_FETCHES_TOTAL: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "onyx_vault_fetches_total",
        "Total vault credential fetches by status",
        &["credential", "status"]
    )
    .unwrap()
});

pub static LLM_API_CALLS: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "onyx_llm_api_calls_total",
        "Total LLM API calls by provider and model",
        &["provider", "model", "status"]
    )
    .unwrap()
});

pub fn encode_metrics() -> Result<String, Box<dyn std::error::Error>> {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer)?;
    Ok(String::from_utf8(buffer)?)
}

pub static TUI_RESIZE_EVENTS_TOTAL: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "onyx_tui_resize_events_total",
        "Total number of layout recalculations",
        &["event"]
    )
    .unwrap()
});

pub static IO_STREAM_ERRORS_TOTAL: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "onyx_io_stream_errors_total",
        "Count of read/write stream drop occurrences through the OnyxIoStream interface",
        &["type"]
    )
    .unwrap()
});

pub static EDGE_AUTH_MISMATCH_TOTAL: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "onyx_edge_auth_mismatch_total",
        "Track rejected double-hash authorization matches on the edge-bridge layer",
        &["status"]
    )
    .unwrap()
});
