sed -i 's/let mut recent_incidents = serde_json::json!([]);/let mut recent_incidents = serde_json::json!([]);\n    let _ = recent_incidents;/g' rust/crates/runtime/src/fleet_health.rs
sed -i 's/recent_incidents = json;/recent_incidents = json;\n            let _ = recent_incidents;/g' rust/crates/runtime/src/fleet_health.rs
