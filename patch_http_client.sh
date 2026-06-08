sed -i '102i\
\
use std::sync::atomic::{AtomicUsize, AtomicU64, Ordering};\
use std::sync::Arc;\
use tokio::time::{timeout, Duration};\
\
#[derive(Debug, Clone, PartialEq, Eq)]\
pub enum CircuitBreakerState {\
    Closed,\
    Open,\
    HalfOpen,\
}\
\
pub struct CircuitBreaker {\
    pub failure_count: AtomicUsize,\
    pub last_failure_time: AtomicU64,\
    pub failure_threshold: usize,\
    pub reset_timeout_secs: u64,\
}\
\
impl CircuitBreaker {\
    pub fn new(failure_threshold: usize, reset_timeout_secs: u64) -> Self {\
        Self {\
            failure_count: AtomicUsize::new(0),\
            last_failure_time: AtomicU64::new(0),\
            failure_threshold,\
            reset_timeout_secs,\
        }\
    }\
\
    pub fn state(&self) -> CircuitBreakerState {\
        let failures = self.failure_count.load(Ordering::SeqCst);\
        if failures >= self.failure_threshold {\
            let last_failure = self.last_failure_time.load(Ordering::SeqCst);\
            let now = std::time::SystemTime::now()\
                .duration_since(std::time::UNIX_EPOCH)\
                .unwrap()\
                .as_secs();\
            if now - last_failure > self.reset_timeout_secs {\
                CircuitBreakerState::HalfOpen\
            } else {\
                CircuitBreakerState::Open\
            }\
        } else {\
            CircuitBreakerState::Closed\
        }\
    }\
\
    pub fn record_success(&self) {\
        self.failure_count.store(0, Ordering::SeqCst);\
    }\
\
    pub fn record_failure(&self) {\
        self.failure_count.fetch_add(1, Ordering::SeqCst);\
        self.last_failure_time.store(\
            std::time::SystemTime::now()\
                .duration_since(std::time::UNIX_EPOCH)\
                .unwrap()\
                .as_secs(),\
            Ordering::SeqCst,\
        );\
    }\
}\
\
lazy_static::lazy_static! {\
    pub static ref GLOBAL_CIRCUIT_BREAKER: Arc<CircuitBreaker> = Arc::new(CircuitBreaker::new(3, 30));\
}\
\
use reqwest::{RequestBuilder, Response};\
\
pub async fn send_with_circuit_breaker(request: RequestBuilder) -> Result<Response, String> {\
    let state = GLOBAL_CIRCUIT_BREAKER.state();\
    if state == CircuitBreakerState::Open {\
        let body = r#"{"warning": "Circuit breaker is OPEN. Service Unavailable."}"#;\
        let response = http::response::Builder::new()\
            .status(503)\
            .body(body.to_string())\
            .unwrap();\
        return Ok(response.into());\
    }\
\
    for attempt in 1..=3 {\
        let request_clone = request\
            .try_clone()\
            .ok_or("Cannot clone request for retry")?;\
\
        let result = timeout(Duration::from_secs(10), request_clone.send()).await;\
\
        match result {\
            Ok(Ok(res)) => {\
                if res.status().is_server_error() {\
                    if attempt < 3 {\
                        let backoff = 2_u64.pow(attempt - 1);\
                        tokio::time::sleep(Duration::from_secs(backoff)).await;\
                        continue;\
                    } else {\
                        GLOBAL_CIRCUIT_BREAKER.record_failure();\
                        return Ok(res);\
                    }\
                }\
                GLOBAL_CIRCUIT_BREAKER.record_success();\
                return Ok(res);\
            }\
            Ok(Err(e)) => {\
                if attempt < 3 {\
                    tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt - 1))).await;\
                    continue;\
                }\
                GLOBAL_CIRCUIT_BREAKER.record_failure();\
                return Err(format!("Request failed after 3 attempts: {e}"));\
            }\
            Err(_) => {\
                if attempt < 3 {\
                    tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt - 1))).await;\
                    continue;\
                }\
                GLOBAL_CIRCUIT_BREAKER.record_failure();\
                return Err("Request timeout after 3 attempts (10s each)".to_string());\
            }\
        }\
    }\
    \
    GLOBAL_CIRCUIT_BREAKER.record_failure();\
    Err("Request failed after all retries".to_string())\
}\
' rust/crates/api/src/http_client.rs
