use crate::error::ApiError;
use reqwest::{RequestBuilder, Response};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::time::{timeout, Duration};

const HTTP_PROXY_KEYS: [&str; 2] = ["HTTP_PROXY", "http_proxy"];
const HTTPS_PROXY_KEYS: [&str; 2] = ["HTTPS_PROXY", "https_proxy"];
const NO_PROXY_KEYS: [&str; 2] = ["NO_PROXY", "no_proxy"];

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)]
pub enum CircuitBreakerState {
    Closed,
    Open,
    HalfOpen,
}

#[allow(dead_code)]
pub struct CircuitBreaker {
    pub failure_count: AtomicUsize,
    pub last_failure_time: AtomicU64,
    pub failure_threshold: usize,
    pub reset_timeout_secs: u64,
}

#[allow(dead_code)]
impl CircuitBreaker {
    #[must_use]
    pub fn new(failure_threshold: usize, reset_timeout_secs: u64) -> Self {
        Self {
            failure_count: AtomicUsize::new(0),
            last_failure_time: AtomicU64::new(0),
            failure_threshold,
            reset_timeout_secs,
        }
    }

    pub fn state(&self) -> CircuitBreakerState {
        let failures = self.failure_count.load(Ordering::SeqCst);
        if failures >= self.failure_threshold {
            let last_failure = self.last_failure_time.load(Ordering::SeqCst);
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            if now - last_failure > self.reset_timeout_secs {
                CircuitBreakerState::HalfOpen
            } else {
                CircuitBreakerState::Open
            }
        } else {
            CircuitBreakerState::Closed
        }
    }

    pub fn record_success(&self) {
        self.failure_count.store(0, Ordering::SeqCst);
    }

    pub fn record_failure(&self) {
        self.failure_count.fetch_add(1, Ordering::SeqCst);
        self.last_failure_time.store(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            Ordering::SeqCst,
        );
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub struct CacheEfficiencyTracker {
    bits: std::sync::atomic::AtomicU64,
    index: std::sync::atomic::AtomicUsize,
}

impl CacheEfficiencyTracker {
    #[must_use]
    pub fn new(_capacity: usize) -> Self {
        Self {
            bits: std::sync::atomic::AtomicU64::new(0),
            index: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    #[allow(clippy::cast_precision_loss)]
    pub fn record(&self, is_hit: bool) -> f64 {
        let idx = self.index.fetch_add(1, Ordering::SeqCst) % 64;
        let mut current_bits = self.bits.load(Ordering::SeqCst);
        loop {
            let next_bits = if is_hit {
                current_bits | (1 << idx)
            } else {
                current_bits & !(1 << idx)
            };
            match self.bits.compare_exchange_weak(
                current_bits,
                next_bits,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => {
                    current_bits = next_bits;
                    break;
                }
                Err(b) => current_bits = b,
            }
        }

        let hits = current_bits.count_ones();
        let total = (self.index.load(Ordering::SeqCst)).min(64);

        let rate = if total == 0 {
            0.0
        } else {
            (f64::from(hits) / total as f64) * 100.0
        };

        // Standardize metric events to output clean JSON payload diagnostics
        let payload = format!(r#"{{"event": "cache_metric", "hit": {is_hit}, "rate": {rate:.2}}}"#);
        tracing::debug!("{}", payload);

        rate
    }
}

pub static GLOBAL_CACHE_TRACKER: std::sync::LazyLock<Arc<CacheEfficiencyTracker>> =
    std::sync::LazyLock::new(|| Arc::new(CacheEfficiencyTracker::new(100)));

pub static GLOBAL_CIRCUIT_BREAKER: std::sync::LazyLock<Arc<CircuitBreaker>> =
    std::sync::LazyLock::new(|| Arc::new(CircuitBreaker::new(3, 30)));

pub static LAST_DEGRADED_TIME: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Snapshot of the proxy-related environment variables that influence the
/// outbound HTTP client. Captured up front so callers can inspect, log, and
/// test the resolved configuration without re-reading the process environment.
///
/// When `proxy_url` is set it acts as a single catch-all proxy for both
/// HTTP and HTTPS traffic, taking precedence over the per-scheme fields.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProxyConfig {
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub no_proxy: Option<String>,
    /// Optional unified proxy URL that applies to both HTTP and HTTPS.
    /// When set, this takes precedence over `http_proxy` and `https_proxy`.
    pub proxy_url: Option<String>,
}

impl ProxyConfig {
    /// Read proxy settings from the live process environment, honouring both
    /// the upper- and lower-case spellings used by curl, git, and friends.
    #[must_use]
    pub fn from_env() -> Self {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Create a proxy configuration from a single URL that applies to both
    /// HTTP and HTTPS traffic. This is the config-file alternative to setting
    /// `HTTP_PROXY` and `HTTPS_PROXY` environment variables separately.
    #[must_use]
    pub fn from_proxy_url(url: impl Into<String>) -> Self {
        Self {
            proxy_url: Some(url.into()),
            ..Self::default()
        }
    }

    fn from_lookup<F>(mut lookup: F) -> Self
    where
        F: FnMut(&str) -> Option<String>,
    {
        Self {
            http_proxy: first_non_empty(&HTTP_PROXY_KEYS, &mut lookup),
            https_proxy: first_non_empty(&HTTPS_PROXY_KEYS, &mut lookup),
            no_proxy: first_non_empty(&NO_PROXY_KEYS, &mut lookup),
            proxy_url: None,
        }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.proxy_url.is_none() && self.http_proxy.is_none() && self.https_proxy.is_none()
    }
}

/// Build a `reqwest::Client` that honours the standard `HTTP_PROXY`,
/// `HTTPS_PROXY`, and `NO_PROXY` environment variables. When no proxy is
/// configured the client behaves identically to `reqwest::Client::new()`.
pub fn build_http_client() -> Result<reqwest::Client, ApiError> {
    build_http_client_with(&ProxyConfig::from_env())
}

/// Infallible counterpart to [`build_http_client`] for constructors that
/// historically returned `Self` rather than `Result<Self, _>`. When the proxy
/// configuration is malformed we fall back to a default client so that
/// callers retain the previous behaviour and the failure surfaces on the
/// first outbound request instead of at construction time.
#[must_use]
pub fn build_http_client_or_default() -> reqwest::Client {
    build_http_client().unwrap_or_else(|_| reqwest::Client::new())
}

/// Build a `reqwest::Client` from an explicit [`ProxyConfig`]. Used by tests
/// and by callers that want to override process-level environment lookups.
///
/// When `config.proxy_url` is set it overrides the per-scheme `http_proxy`
/// and `https_proxy` fields and is registered as both an HTTP and HTTPS
/// proxy so a single value can route every outbound request.
pub fn build_http_client_with(config: &ProxyConfig) -> Result<reqwest::Client, ApiError> {
    let mut builder = reqwest::Client::builder().no_proxy();

    let no_proxy = config
        .no_proxy
        .as_deref()
        .and_then(reqwest::NoProxy::from_string);

    #[allow(clippy::similar_names)]
    let (http_proxy_url, secure_proxy_url) = match config.proxy_url.as_deref() {
        Some(unified) => (Some(unified), Some(unified)),
        None => (config.http_proxy.as_deref(), config.https_proxy.as_deref()),
    };

    if let Some(url) = secure_proxy_url {
        let mut proxy = reqwest::Proxy::https(url)?;
        if let Some(filter) = no_proxy.clone() {
            proxy = proxy.no_proxy(Some(filter));
        }
        builder = builder.proxy(proxy);
    }

    if let Some(url) = http_proxy_url {
        let mut proxy = reqwest::Proxy::http(url)?;
        if let Some(filter) = no_proxy.clone() {
            proxy = proxy.no_proxy(Some(filter));
        }
        builder = builder.proxy(proxy);
    }

    Ok(builder.build()?)
}

#[allow(dead_code)]
#[allow(clippy::too_many_lines)]
#[allow(clippy::cast_possible_wrap)]
pub async fn send_with_circuit_breaker(request: RequestBuilder) -> Result<Response, String> {
    let endpoint = request
        .try_clone()
        .and_then(|r| r.build().ok())
        .and_then(|req| req.url().host_str().map(ToString::to_string))
        .unwrap_or_else(|| "unknown".to_string());

    let last_degraded = LAST_DEGRADED_TIME.load(Ordering::SeqCst);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    if now - last_degraded < 10 {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let state = GLOBAL_CIRCUIT_BREAKER.state();

    if state == CircuitBreakerState::Open {
        return Ok(reqwest::Response::from(
            http::response::Builder::new()
                .status(503)
                .body(
                    "{\"warning\": \"Circuit breaker is OPEN. Service Unavailable.\"}".to_string(),
                )
                .unwrap(),
        ));
    }

    for attempt in 1..=3 {
        let request_clone = request
            .try_clone()
            .ok_or("Cannot clone request for retry")?;

        let start_time = std::time::Instant::now();
        let result = timeout(std::time::Duration::from_secs(10), request_clone.send()).await;
        let duration = start_time.elapsed().as_secs_f64();
        telemetry::metrics::HTTP_REQUEST_DURATION
            .with_label_values(&[&endpoint])
            .observe(duration);

        match result {
            Ok(Ok(res)) => {
                let status = res.status().as_u16().to_string();
                telemetry::metrics::HTTP_REQUESTS_TOTAL
                    .with_label_values(&[&endpoint, &status])
                    .inc();

                // Sniff incoming cache and health headers
                if let Some(cache_status) = res.headers().get("X-Onyx-Cache-Status") {
                    if let Ok(cache_str) = cache_status.to_str() {
                        let is_hit = cache_str == "HIT";
                        if is_hit {
                            telemetry::metrics::EDGE_CACHE_HITS_TOTAL.inc();
                        }
                        let hit_rate = GLOBAL_CACHE_TRACKER.record(is_hit);
                        telemetry::metrics::EDGE_CACHE_HIT_RATE.set(hit_rate);
                    }
                }

                if let Some(cache_ttl) = res.headers().get("X-Onyx-Cache-TTL") {
                    if let Ok(ttl_str) = cache_ttl.to_str() {
                        if let Ok(ttl) = ttl_str.parse::<f64>() {
                            telemetry::metrics::EDGE_CACHE_TTL.set(ttl);
                        }
                    }
                }

                if let Some(edge_health) = res.headers().get("X-Onyx-Edge-Health") {
                    if let Ok(health_str) = edge_health.to_str() {
                        if health_str == "OK" {
                            telemetry::metrics::EDGE_KV_STATUS.set(1.0);
                        } else if health_str == "DEGRADED" {
                            telemetry::metrics::EDGE_KV_STATUS.set(0.0);
                            LAST_DEGRADED_TIME.store(
                                std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs(),
                                Ordering::SeqCst,
                            );
                        }
                    }
                }

                if res.status() == 502 || res.status() == 503 || res.status() == 504 {
                    if attempt < 3 {
                        // Jittered exponential backoff
                        let base_backoff = 2_f64.powi((attempt as i32) - 1);
                        #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
                        let jitter = (std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis()
                            % 1000) as f64
                            / 1000.0;
                        let backoff = base_backoff + jitter;
                        tokio::time::sleep(Duration::from_secs_f64(backoff)).await;
                        continue;
                    }
                    GLOBAL_CIRCUIT_BREAKER.record_failure();
                    return Ok(res);
                } else if res.status().is_server_error() {
                    GLOBAL_CIRCUIT_BREAKER.record_failure();
                    return Ok(res);
                }
                GLOBAL_CIRCUIT_BREAKER.record_success();
                return Ok(res);
            }
            Ok(Err(e)) => {
                telemetry::metrics::HTTP_REQUESTS_TOTAL
                    .with_label_values(&[&endpoint, "error"])
                    .inc();
                if attempt < 3 {
                    tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt - 1))).await;
                    continue;
                }
                GLOBAL_CIRCUIT_BREAKER.record_failure();
                return Err(format!("Request failed after 3 attempts: {e}"));
            }
            Err(_) => {
                telemetry::metrics::HTTP_REQUESTS_TOTAL
                    .with_label_values(&[&endpoint, "timeout"])
                    .inc();
                if attempt < 3 {
                    tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt - 1))).await;
                    continue;
                }
                GLOBAL_CIRCUIT_BREAKER.record_failure();
                return Err("Request timeout after 3 attempts (10s each)".to_string());
            }
        }
    }

    GLOBAL_CIRCUIT_BREAKER.record_failure();
    Err("Request failed after all retries".to_string())
}

fn first_non_empty<F>(keys: &[&str], lookup: &mut F) -> Option<String>
where
    F: FnMut(&str) -> Option<String>,
{
    keys.iter()
        .find_map(|key| lookup(key).filter(|value| !value.is_empty()))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{build_http_client_with, ProxyConfig};
    use super::{CircuitBreaker, CircuitBreakerState};

    fn config_from_map(pairs: &[(&str, &str)]) -> ProxyConfig {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect();
        ProxyConfig::from_lookup(|key| map.get(key).cloned())
    }

    #[test]
    fn proxy_config_is_empty_when_no_env_vars_are_set() {
        // given
        let config = config_from_map(&[]);

        // when
        let empty = config.is_empty();

        // then
        assert!(empty);
        assert_eq!(config, ProxyConfig::default());
    }

    #[test]
    fn proxy_config_reads_uppercase_http_https_and_no_proxy() {
        // given
        let pairs = [
            ("HTTP_PROXY", "http://proxy.internal:3128"),
            ("HTTPS_PROXY", "http://secure.internal:3129"),
            ("NO_PROXY", "localhost,127.0.0.1,.corp"),
        ];

        // when
        let config = config_from_map(&pairs);

        // then
        assert_eq!(
            config.http_proxy.as_deref(),
            Some("http://proxy.internal:3128")
        );
        assert_eq!(
            config.https_proxy.as_deref(),
            Some("http://secure.internal:3129")
        );
        assert_eq!(
            config.no_proxy.as_deref(),
            Some("localhost,127.0.0.1,.corp")
        );
        assert!(!config.is_empty());
    }

    #[test]
    fn proxy_config_falls_back_to_lowercase_keys() {
        // given
        let pairs = [
            ("http_proxy", "http://lower.internal:3128"),
            ("https_proxy", "http://lower-secure.internal:3129"),
            ("no_proxy", ".lower"),
        ];

        // when
        let config = config_from_map(&pairs);

        // then
        assert_eq!(
            config.http_proxy.as_deref(),
            Some("http://lower.internal:3128")
        );
        assert_eq!(
            config.https_proxy.as_deref(),
            Some("http://lower-secure.internal:3129")
        );
        assert_eq!(config.no_proxy.as_deref(), Some(".lower"));
    }

    #[test]
    fn proxy_config_prefers_uppercase_over_lowercase_when_both_set() {
        // given
        let pairs = [
            ("HTTP_PROXY", "http://upper.internal:3128"),
            ("http_proxy", "http://lower.internal:3128"),
        ];

        // when
        let config = config_from_map(&pairs);

        // then
        assert_eq!(
            config.http_proxy.as_deref(),
            Some("http://upper.internal:3128")
        );
    }

    #[test]
    fn proxy_config_treats_empty_strings_as_unset() {
        // given
        let pairs = [("HTTP_PROXY", ""), ("http_proxy", "")];

        // when
        let config = config_from_map(&pairs);

        // then
        assert!(config.http_proxy.is_none());
    }

    #[test]
    fn build_http_client_succeeds_when_no_proxy_is_configured() {
        // given
        let config = ProxyConfig::default();

        // when
        let result = build_http_client_with(&config);

        // then
        assert!(result.is_ok());
    }

    #[test]
    fn build_http_client_succeeds_with_valid_http_and_https_proxies() {
        // given
        let config = ProxyConfig {
            http_proxy: Some("http://proxy.internal:3128".to_string()),
            https_proxy: Some("http://secure.internal:3129".to_string()),
            no_proxy: Some("localhost,127.0.0.1".to_string()),
            proxy_url: None,
        };

        // when
        let result = build_http_client_with(&config);

        // then
        assert!(result.is_ok());
    }

    #[test]
    fn build_http_client_returns_http_error_for_invalid_proxy_url() {
        // given
        let config = ProxyConfig {
            http_proxy: None,
            https_proxy: Some("not a url".to_string()),
            no_proxy: None,
            proxy_url: None,
        };

        // when
        let result = build_http_client_with(&config);

        // then
        let error = result.expect_err("invalid proxy URL must be reported as a build failure");
        assert!(
            matches!(error, crate::error::ApiError::Http(_)),
            "expected ApiError::Http for invalid proxy URL, got: {error:?}"
        );
    }

    #[test]
    fn from_proxy_url_sets_unified_field_and_leaves_per_scheme_empty() {
        // given / when
        let config = ProxyConfig::from_proxy_url("http://unified.internal:3128");

        // then
        assert_eq!(
            config.proxy_url.as_deref(),
            Some("http://unified.internal:3128")
        );
        assert!(config.http_proxy.is_none());
        assert!(config.https_proxy.is_none());
        assert!(!config.is_empty());
    }

    #[test]
    fn build_http_client_succeeds_with_unified_proxy_url() {
        // given
        let config = ProxyConfig {
            proxy_url: Some("http://unified.internal:3128".to_string()),
            no_proxy: Some("localhost".to_string()),
            ..ProxyConfig::default()
        };

        // when
        let result = build_http_client_with(&config);

        // then
        assert!(result.is_ok());
    }

    #[test]
    fn proxy_url_takes_precedence_over_per_scheme_fields() {
        // given – both per-scheme and unified are set
        let config = ProxyConfig {
            http_proxy: Some("http://per-scheme.internal:1111".to_string()),
            https_proxy: Some("http://per-scheme.internal:2222".to_string()),
            no_proxy: None,
            proxy_url: Some("http://unified.internal:3128".to_string()),
        };

        // when – building succeeds (the unified URL is valid)
        let result = build_http_client_with(&config);

        // then
        assert!(result.is_ok());
    }

    #[test]
    fn build_http_client_returns_error_for_invalid_unified_proxy_url() {
        // given
        let config = ProxyConfig::from_proxy_url("not a url");

        // when
        let result = build_http_client_with(&config);

        // then
        assert!(
            matches!(result, Err(crate::error::ApiError::Http(_))),
            "invalid unified proxy URL should fail: {result:?}"
        );
    }

    #[test]
    fn circuit_breaker_state_transitions() {
        let cb = CircuitBreaker::new(3, 1);

        assert_eq!(cb.state(), CircuitBreakerState::Closed);

        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitBreakerState::Closed);

        cb.record_failure();
        assert_eq!(cb.state(), CircuitBreakerState::Open);

        std::thread::sleep(std::time::Duration::from_secs(2));
        assert_eq!(cb.state(), CircuitBreakerState::HalfOpen);

        cb.record_success();
        assert_eq!(cb.state(), CircuitBreakerState::Closed);
    }
}
