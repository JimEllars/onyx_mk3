sed -i 's/pub fn new(failure_threshold: usize/#[must_use]\n    pub fn new(failure_threshold: usize/g' rust/crates/tools/src/http_client.rs
