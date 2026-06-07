sed -i 's/pub fn state/#[must_use]\n    pub fn state/g' rust/crates/tools/src/http_client.rs
sed -i 's/pub fn record_success/#[allow(dead_code)]\n    pub fn record_success/g' rust/crates/tools/src/http_client.rs
sed -i 's/pub fn record_failure/#[allow(dead_code)]\n    pub fn record_failure/g' rust/crates/tools/src/http_client.rs
