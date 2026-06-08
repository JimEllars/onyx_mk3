sed -i 's/"mock_live_/"sk_live_/g' rust/crates/commands/src/extensions/support_triage.rs
sed -i 's/"Using mock_live_{timestamp} for initialization."/"Using sk_live_{timestamp} for initialization."/g' rust/crates/commands/src/extensions/support_triage.rs
