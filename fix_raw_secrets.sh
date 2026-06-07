sed -i 's/"sk-ant-api03-deadbeef".to_string()/String::new()/g' rust/crates/api/src/providers/anthropic.rs
sed -i 's/"sk-ant-api03-legitimate".to_string()/String::new()/g' rust/crates/api/src/providers/anthropic.rs
