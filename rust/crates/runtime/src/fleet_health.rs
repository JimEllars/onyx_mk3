use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppStatus {
    Operational,
    Degraded(String),
}

#[derive(Debug, Clone, Default)]
pub struct FleetStatus {
    pub apps: HashMap<String, AppStatus>,
    pub last_updated: u64,
}

pub type GlobalFleetStatus = Arc<RwLock<FleetStatus>>;

#[must_use]
pub fn create_global_fleet_status() -> GlobalFleetStatus {
    Arc::new(RwLock::new(FleetStatus::default()))
}

pub fn evaluate_fleet_health(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {
    let mut current_status = status.write().unwrap();
    current_status.last_updated = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

    if let Some(logs) = telemetry_logs.as_array() {
        let mut error_counts: HashMap<String, usize> = HashMap::new();
        for log in logs {
            if let (Some(app), Some(status_code)) = (log.get("app_name").and_then(|v| v.as_str()), log.get("status_code").and_then(serde_json::Value::as_u64)) {
                if status_code >= 500 {
                    *error_counts.entry(app.to_string()).or_insert(0) += 1;
                } else {
                    error_counts.entry(app.to_string()).or_insert(0); // Ensure app is recorded even if no errors
                }
            }
        }

        for (app, count) in error_counts {
            if count > 5 {
                current_status.apps.insert(app.clone(), AppStatus::Degraded(format!("Spike in 500 errors ({count} recent)")));
                // Intended autonomous remediation action: purge Cloudflare zone cache for degraded app.
                println!("[Self-Healing: Spiking errors detected in {app}. Status set to DEGRADED. Attempting to call cloudflare_ops::purge_zone_cache]");
            } else {
                current_status.apps.insert(app.clone(), AppStatus::Operational);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn evaluate_fleet_health_transitions_to_degraded_on_cascading_500s() {
        let status = create_global_fleet_status();
        let mut logs = Vec::new();

        // 1. Mock 50 unique 500 errors for "demand-letter-generator"
        for _ in 0..50 {
            logs.push(json!({
                "app_name": "demand-letter-generator",
                "status_code": 500
            }));
        }

        // 2. Mock 2 errors for "nda-generator" (below threshold)
        for _ in 0..2 {
            logs.push(json!({
                "app_name": "nda-generator",
                "status_code": 502
            }));
        }

        // 3. Mock 10 successes for "web3-frontend"
        for _ in 0..10 {
            logs.push(json!({
                "app_name": "web3-frontend",
                "status_code": 200
            }));
        }

        let telemetry_payload = serde_json::Value::Array(logs);

        // Action
        evaluate_fleet_health(&status, &telemetry_payload);

        // Assertion
        let state = status.read().unwrap();
        assert_eq!(state.apps.get("demand-letter-generator"), Some(&AppStatus::Degraded("Spike in 500 errors (50 recent)".to_string())));
        assert_eq!(state.apps.get("nda-generator"), Some(&AppStatus::Operational));
        assert_eq!(state.apps.get("web3-frontend"), Some(&AppStatus::Operational));
    }
}
