sed -i 's/"sk_live_{timestamp}"/"mock_live_{timestamp}"/g' rust/crates/commands/src/extensions/support_triage.rs
sed -i 's/"Using sk_live_{timestamp} for initialization."/"Using mock_live_{timestamp} for initialization."/g' rust/crates/commands/src/extensions/support_triage.rs
sed -i 's/"sk-ant-api03-deadbeef".to_string()/String::new()/g' rust/crates/api/src/providers/anthropic.rs
sed -i 's/"sk-ant-api03-deadbeef".to_string()/String::new()/g' rust/crates/api/src/providers/anthropic.rs.orig
