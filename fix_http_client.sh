sed -i '1s/^/use std::sync::atomic::{AtomicUsize, AtomicU64, Ordering};\nuse std::sync::Arc;\nuse tokio::time::{timeout, Duration};\n/' rust/crates/api/src/http_client.rs
sed -i 's/let _body = r#"{"warning": "Circuit breaker is OPEN. Service Unavailable."}"#;//g' rust/crates/api/src/http_client.rs
sed -i '/use std::sync::atomic::{AtomicUsize, AtomicU64, Ordering};/d' rust/crates/api/src/http_client.rs
sed -i '/use std::sync::Arc;/d' rust/crates/api/src/http_client.rs
sed -i '/use tokio::time::{timeout, Duration};/d' rust/crates/api/src/http_client.rs
sed -i '1i\
use std::sync::atomic::{AtomicUsize, AtomicU64, Ordering};\
use std::sync::Arc;\
use tokio::time::{timeout, Duration};\
' rust/crates/api/src/http_client.rs
