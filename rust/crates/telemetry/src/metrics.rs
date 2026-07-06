use prometheus::{
    register_counter_vec, register_gauge, register_histogram_vec, CounterVec, Encoder, Gauge,
    HistogramVec, TextEncoder,
};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::LazyLock;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

static LAST_TUI_RESIZE: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));

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

pub enum MetricEvent {
    TuiResize(String),
}

pub static METRIC_TX: LazyLock<Mutex<Sender<MetricEvent>>> = LazyLock::new(|| {
    let (tx, rx): (Sender<MetricEvent>, Receiver<MetricEvent>) = mpsc::channel();
    thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            match event {
                MetricEvent::TuiResize(event_name) => {
                    TUI_RESIZE_EVENTS_TOTAL
                        .with_label_values(&[&event_name])
                        .inc();
                }
            }
        }
    });
    Mutex::new(tx)
});

pub fn enqueue_metric_event(event: MetricEvent) {
    match event {
        MetricEvent::TuiResize(_) => {
            let mut should_send = false;
            if let Ok(mut last) = LAST_TUI_RESIZE.lock() {
                let now = Instant::now();
                if last.is_none() || now.duration_since(last.unwrap()) > Duration::from_millis(500)
                {
                    *last = Some(now);
                    should_send = true;
                }
            }
            if !should_send {
                return;
            }
        }
    }

    if let Ok(tx) = METRIC_TX.lock() {
        let _ = tx.send(event);
    }
}

pub static EDGE_KV_STATUS: LazyLock<Gauge> = LazyLock::new(|| {
    let gauge = register_gauge!(
        "onyx_edge_kv_status",
        "Status of the Cloudflare KV Edge (1=OK, 0=Degraded)"
    )
    .unwrap();
    gauge.set(1.0); // Default to OK
    gauge
});

pub static EDGE_CACHE_HITS_TOTAL: LazyLock<prometheus::Counter> = LazyLock::new(|| {
    prometheus::register_counter!(
        "onyx_edge_cache_hits_total",
        "Total number of prompt cache hits intercepted by Cloudflare KV"
    )
    .unwrap()
});

pub static EDGE_CACHE_HIT_RATE: LazyLock<Gauge> = LazyLock::new(|| {
    let gauge = register_gauge!(
        "onyx_edge_cache_hit_rate",
        "Rolling cache hit-rate percentage (0.0 to 100.0)"
    )
    .unwrap();
    gauge.set(0.0);
    gauge
});

pub static EDGE_CACHE_TTL: LazyLock<Gauge> = LazyLock::new(|| {
    let gauge = register_gauge!(
        "onyx_edge_cache_ttl",
        "Last received edge cache TTL in seconds"
    )
    .unwrap();
    gauge.set(0.0);
    gauge
});

use std::sync::atomic::{AtomicUsize, Ordering};

pub static WORKER_QUEUE_DEPTH: LazyLock<AtomicUsize> = LazyLock::new(|| AtomicUsize::new(0));
pub static WORKER_PROCESSED_TOTAL: LazyLock<AtomicUsize> = LazyLock::new(|| AtomicUsize::new(0));
pub static POOL_EXHAUSTION_EVENTS: LazyLock<AtomicUsize> = LazyLock::new(|| AtomicUsize::new(0));

pub fn set_worker_queue_depth(depth: usize) {
    WORKER_QUEUE_DEPTH.store(depth, Ordering::Relaxed);
}

pub fn increment_worker_processed() {
    WORKER_PROCESSED_TOTAL.fetch_add(1, Ordering::Relaxed);
}

pub fn get_worker_queue_depth() -> usize {
    WORKER_QUEUE_DEPTH.load(Ordering::Relaxed)
}

pub fn get_worker_processed_total() -> usize {
    WORKER_PROCESSED_TOTAL.load(Ordering::Relaxed)
}

pub fn increment_pool_exhaustion() {
    POOL_EXHAUSTION_EVENTS.fetch_add(1, Ordering::Relaxed);
}

pub fn get_pool_exhaustion_total() -> usize {
    POOL_EXHAUSTION_EVENTS.load(Ordering::Relaxed)
}
