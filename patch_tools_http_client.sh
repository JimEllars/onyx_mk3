sed -i 's/pub async fn send_with_circuit_breaker/#[allow(dead_code)]\npub async fn send_with_circuit_breaker/g' rust/crates/api/src/http_client.rs
sed -i 's/pub enum CircuitBreakerState/#[allow(dead_code)]\npub enum CircuitBreakerState/g' rust/crates/api/src/http_client.rs
sed -i 's/pub struct CircuitBreaker/#[allow(dead_code)]\npub struct CircuitBreaker/g' rust/crates/api/src/http_client.rs
sed -i 's/impl CircuitBreaker/#[allow(dead_code)]\nimpl CircuitBreaker/g' rust/crates/api/src/http_client.rs
sed -i 's/pub static GLOBAL_CIRCUIT_BREAKER/#[allow(dead_code)]\npub static GLOBAL_CIRCUIT_BREAKER/g' rust/crates/api/src/http_client.rs
sed -i 's/let body = r#"{"warning": "Circuit breaker is OPEN. Service Unavailable."}"#;/let _body = r#"{"warning": "Circuit breaker is OPEN. Service Unavailable."}"#;/g' rust/crates/api/src/http_client.rs
