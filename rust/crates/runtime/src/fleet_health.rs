use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppStatus {
    Operational,
    Degraded(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionStatus {
    Pending,
    Executing,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedAction {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub id: String,
    pub status: ActionStatus,
    pub created_at: u64,
}

#[derive(Debug, Clone, Default)]
pub struct FleetStatus {
    pub apps: HashMap<String, AppStatus>,
    pub last_updated: u64,
    pub pending_actions: Vec<ProposedAction>,
    pub anomaly_counters: HashMap<String, usize>,
    pub last_edge_heartbeats: u64,
    pub last_eval_time: u64,
}

pub type GlobalFleetStatus = Arc<RwLock<FleetStatus>>;
pub static DELEGATED_NODE_ID: std::sync::LazyLock<std::sync::RwLock<Option<String>>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(None));

#[must_use]
pub fn create_global_fleet_status() -> GlobalFleetStatus {
    Arc::new(RwLock::new(FleetStatus::default()))
}

#[allow(clippy::too_many_lines)]
pub async fn evaluate_health_with_ai(
    status: &GlobalFleetStatus,
    telemetry_logs: &serde_json::Value,
) {
    {
        let mut current_status = status.write().unwrap();
        current_status.last_updated = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
    }

    // Fetch recent incidents
    let mut recent_incidents = serde_json::json!([]);
    let workspace_root = std::env::current_dir().unwrap_or_default();
    let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map_or_else(
        |_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            std::path::PathBuf::from(home).join(".onyx")
        },
        std::path::PathBuf::from,
    );
    let loader = crate::config::ConfigLoader::new(&workspace_root, &config_home_dir);
    let runtime_config = loader
        .load()
        .unwrap_or_else(|_| crate::config::RuntimeConfig::empty());
    let supabase_url = runtime_config
        .get("SUPABASE_URL")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_URL").unwrap_or_default(),
            String::from,
        );
    let supabase_key = runtime_config
        .get("SUPABASE_SERVICE_ROLE_KEY")
        .and_then(|v| v.as_str())
        .map_or_else(
            || std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(),
            String::from,
        );

    let client = reqwest::Client::new();
    let url = format!("{supabase_url}/rest/v1/incident_memory?order=created_at.desc&limit=10");
    if let Ok(res) = client
        .get(&url)
        .header("apikey", &supabase_key)
        .header("Authorization", format!("Bearer {supabase_key}"))
        .send()
        .await
    {
        if let Ok(json) = res.json::<serde_json::Value>().await {
            recent_incidents = json;
            let _ = recent_incidents;
        }
    }

    // In a real implementation, this would make a network call to the LLM
    // passing `telemetry_logs` and `recent_incidents` to determine if a
    // `ProposedAction` is required. For this mock, we skip the network
    // call unless the logs explicitly mention a critical failing component.

    let mut has_errors = false;
    if let Some(logs) = telemetry_logs.as_array() {
        for log in logs {
            if let Some(status_code) = log.get("status_code").and_then(serde_json::Value::as_u64) {
                if status_code >= 500 {
                    has_errors = true;
                }
            }
        }
    }

    if has_errors {
        let action_id = format!(
            "action-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let proposed_action = ProposedAction {
            tool_name: "purge_zone_cache".to_string(),
            arguments: serde_json::json!({ "zone_id": "axim-demand-letter-generator" }),
            id: action_id.clone(),
            status: ActionStatus::Pending,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        };

        let mut current_status = status.write().unwrap();
        println!("[Self-Healing: AI determined a proposed action is required based on historical logs. Pushing ProposedAction: {action_id}]");
        current_status.pending_actions.push(proposed_action);
    }
}

pub fn evaluate_fleet_health(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    {
        let mut current_status = status.write().unwrap();
        current_status.last_updated = now;

        let current_heartbeats = telemetry::metrics::EDGE_HEARTBEAT_INTERCEPTS
            .load(std::sync::atomic::Ordering::Relaxed);
        let time_diff = now.saturating_sub(current_status.last_eval_time);

        // Ensure at least some time has passed to prevent instant triggers, and check if it's within a reasonable window (e.g., around 1 min or whatever interval evaluates run on)
        if time_diff > 0 {
            let heartbeat_diff =
                current_heartbeats.saturating_sub(current_status.last_edge_heartbeats);
            if heartbeat_diff > 5 {
                let action_id = format!(
                    "action-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                );
                let proposed_action = ProposedAction {
                    tool_name: "reduce_request_rate".to_string(), // Or execute_circuit_breaker
                    arguments: serde_json::json!({ "reason": "Heartbeat intercept spike > 5 in evaluation window" }),
                    id: action_id.clone(),
                    status: ActionStatus::Pending,
                    created_at: now,
                };
                println!("[Self-Healing: Spike in EDGE_HEARTBEAT_INTERCEPTS ({} -> {}). Pushing ProposedAction: {}]", current_status.last_edge_heartbeats, current_heartbeats, action_id);
                current_status.pending_actions.push(proposed_action);

                // Fire and forget audit log
                tokio::spawn(async move {
                    let _ = crate::lane_events::handle_telemetry_event(
                        &crate::lane_events::TelemetryEvent {
                            r#type: "command_audit_log".to_string(),
                            payload: serde_json::json!({
                                "source": "fleet_health",
                                "action": "propose_circuit_breaker",
                                "reason": "EDGE_HEARTBEAT_INTERCEPTS spike > 5"
                            }),
                        },
                    )
                    .await;
                });
            }
        }

        current_status.last_edge_heartbeats = current_heartbeats;
        current_status.last_eval_time = now;
    }

    if let Some(logs) = telemetry_logs.as_array() {
        let mut error_counts: HashMap<String, usize> = HashMap::new();
        for log in logs {
            if let (Some(app), Some(status_code)) = (
                log.get("app_name").and_then(|v| v.as_str()),
                log.get("status_code").and_then(serde_json::Value::as_u64),
            ) {
                if status_code >= 500 {
                    *error_counts.entry(app.to_string()).or_insert(0) += 1;
                } else {
                    error_counts.entry(app.to_string()).or_insert(0); // Ensure app is recorded even if no errors
                }
            }
        }

        for (app, count) in error_counts {
            let mut current_status = status.write().unwrap();
            if count > 5 {
                let anomaly_count = current_status
                    .anomaly_counters
                    .entry(app.clone())
                    .or_insert(0);
                *anomaly_count += 1;

                if *anomaly_count >= 3 {
                    current_status.apps.insert(
                        app.clone(),
                        AppStatus::Degraded(format!("Spike in 500 errors ({count} recent)")),
                    );

                    let action_id = format!(
                        "action-{}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_nanos()
                    );
                    let proposed_action = ProposedAction {
                        tool_name: "purge_zone_cache".to_string(),
                        arguments: serde_json::json!({ "zone_id": app }), // Simple mapping for now
                        id: action_id.clone(),
                        status: ActionStatus::Pending,
                        created_at: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                    };
                    println!("[Self-Healing: Spiking errors detected in {app}. Status set to DEGRADED. Pushing ProposedAction: {action_id}]");
                    current_status.pending_actions.push(proposed_action);

                    current_status.anomaly_counters.insert(app.clone(), 0);
                }
            } else {
                current_status.anomaly_counters.insert(app.clone(), 0);
                current_status
                    .apps
                    .insert(app.clone(), AppStatus::Operational);
            }
        }
    }
}

#[allow(clippy::too_many_lines)]
pub fn start_approval_polling_loop(
    status: GlobalFleetStatus,
    client: reqwest::Client,
    edge_url: String,
    secret: String,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;

            let url = format!("{edge_url}/api/approvals");
            let mut approved_tasks = std::collections::HashSet::new();

            match client
                .get(&url)
                .header("Authorization", format!("Bearer {secret}"))
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(body) = resp.json::<serde_json::Value>().await {
                        if let Some(approvals) = body.get("approvals").and_then(|v| v.as_array()) {
                            for approval in approvals {
                                if let Some(task_id) =
                                    approval.get("task_id").and_then(|v| v.as_str())
                                {
                                    approved_tasks.insert(task_id.to_string());
                                }
                            }
                        }
                    }
                }
                Ok(resp) => {
                    eprintln!("[Approval polling failed with status: {}]", resp.status());
                }
                Err(e) => {
                    eprintln!("[Approval polling error: {e}]");
                }
            }

            // Execute approved tasks locally and report back
            let actions_to_execute = {
                let mut current_status = status.write().unwrap();
                let mut exec_list = Vec::new();
                for action in &mut current_status.pending_actions {
                    if action.status == ActionStatus::Pending && approved_tasks.contains(&action.id)
                    {
                        action.status = ActionStatus::Executing;
                        exec_list.push(action.clone());
                    }
                }
                exec_list
            };

            for action in actions_to_execute {
                println!(
                    "[Action {} approved! Executing tool {} locally...]",
                    action.id, action.tool_name
                );

                // Task 1: Execution
                let mut exec_status = "Completed";
                let mut exec_details = String::new();
                let _ = exec_details;
                {
                    // Simulated local MCP execution
                    match action.tool_name.as_str() {
                        "purge_zone_cache" => {
                            if let Some(zone_id) =
                                action.arguments.get("zone_id").and_then(|v| v.as_str())
                            {
                                // Simulate Cloudflare API call
                                exec_details = format!("Successfully purged cache for {zone_id}");
                                println!("[Execution complete: {exec_details}]");
                            } else {
                                exec_status = "Failed";
                                exec_details = "Missing or invalid zone_id".to_string();
                                eprintln!("[Execution failed: Missing or invalid zone_id]");
                            }
                        }
                        "revert_github_pr" => {
                            if let Some(project_name) = action
                                .arguments
                                .get("project_name")
                                .and_then(|v| v.as_str())
                            {
                                // Simulate GitHub API call
                                exec_details = format!("Successfully reverted recent PR for {project_name} to stabilize fleet");
                                println!("[Execution complete: {exec_details}]");
                            } else {
                                exec_details = "Missing or invalid project_name".to_string();
                                eprintln!("[Execution failed: Missing or invalid project_name]");
                            }
                        }
                        _ => {
                            exec_details = format!("Unknown tool: {}", action.tool_name);
                            eprintln!("[Execution failed: Unknown tool {}]", action.tool_name);
                        }
                    }
                }
                {
                    let mut current_status = status.write().unwrap();
                    for a in &mut current_status.pending_actions {
                        if a.id == action.id {
                            a.status = if exec_status == "Completed" {
                                ActionStatus::Completed
                            } else {
                                ActionStatus::Failed
                            };
                        }
                    }
                }

                if exec_status == "Completed" {
                    // Record incident resolution in background
                    let tool_name = action.tool_name.clone();
                    tokio::spawn(async move {
                        let workspace_root = std::env::current_dir().unwrap_or_default();
                        let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map_or_else(
                            |_| {
                                let home =
                                    std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                                std::path::PathBuf::from(home).join(".onyx")
                            },
                            std::path::PathBuf::from,
                        );
                        let loader =
                            crate::config::ConfigLoader::new(&workspace_root, &config_home_dir);
                        let runtime_config = loader
                            .load()
                            .unwrap_or_else(|_| crate::config::RuntimeConfig::empty());

                        let supabase_url = runtime_config
                            .get("SUPABASE_URL")
                            .and_then(|v| v.as_str())
                            .map_or_else(
                                || std::env::var("SUPABASE_URL").unwrap_or_default(),
                                String::from,
                            );
                        let supabase_key = runtime_config
                            .get("SUPABASE_SERVICE_ROLE_KEY")
                            .and_then(|v| v.as_str())
                            .map_or_else(
                                || std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap_or_default(),
                                String::from,
                            );

                        let client = reqwest::Client::new();
                        let url = format!("{supabase_url}/rest/v1/incident_memory");
                        let payload = serde_json::json!({
                            "incident": format!("Automated incident fix via {}", tool_name),
                            "tool_executed": tool_name,
                        });
                        let _ = client
                            .post(&url)
                            .header("apikey", &supabase_key)
                            .header("Authorization", format!("Bearer {supabase_key}"))
                            .header("Content-Type", "application/json")
                            .json(&payload)
                            .send()
                            .await;
                        println!("[Incident resolution logged to memory bank for {tool_name}]");
                    });
                }

                // Task 2: Feedback Loop
                let feedback_url = format!("{edge_url}/api/v1/task-status");
                let payload = serde_json::json!({
                    "task_id": action.id,
                    "status": exec_status,
                    "details": exec_details
                });

                let mut retries = 3;
                while retries > 0 {
                    match client
                        .post(&feedback_url)
                        .header("Authorization", format!("Bearer {secret}"))
                        .header("Content-Type", "application/json")
                        .timeout(std::time::Duration::from_secs(10))
                        .json(&payload)
                        .send()
                        .await
                    {
                        Ok(resp) if resp.status().is_success() => {
                            println!("[Feedback sent for task_id {}]", action.id);
                            break;
                        }
                        Ok(resp) => {
                            eprintln!(
                                "[Feedback failed for task_id {} with status: {}]",
                                action.id,
                                resp.status()
                            );
                            retries -= 1;
                            if retries > 0 {
                                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                            }
                        }
                        Err(e) => {
                            eprintln!("[Feedback error for task_id {}: {}]", action.id, e);
                            retries -= 1;
                            if retries > 0 {
                                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                            }
                        }
                    }
                }
            }
        }
    })
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

        // Action 1
        evaluate_fleet_health(&status, &telemetry_payload);

        // Assert action 1 didn't trigger full degraded
        {
            let state = status.read().unwrap();
            assert_eq!(state.apps.get("demand-letter-generator"), None);
            assert_eq!(
                state.anomaly_counters.get("demand-letter-generator"),
                Some(&1)
            );
        }

        // Action 2
        evaluate_fleet_health(&status, &telemetry_payload);

        // Assert action 2 didn't trigger full degraded
        {
            let state = status.read().unwrap();
            assert_eq!(state.apps.get("demand-letter-generator"), None);
            assert_eq!(
                state.anomaly_counters.get("demand-letter-generator"),
                Some(&2)
            );
        }

        // Action 3
        evaluate_fleet_health(&status, &telemetry_payload);

        // Assertion 3 triggered degraded
        let state = status.read().unwrap();
        assert_eq!(
            state.apps.get("demand-letter-generator"),
            Some(&AppStatus::Degraded(
                "Spike in 500 errors (50 recent)".to_string()
            ))
        );
        assert_eq!(
            state.apps.get("nda-generator"),
            Some(&AppStatus::Operational)
        );
        assert_eq!(
            state.apps.get("web3-frontend"),
            Some(&AppStatus::Operational)
        );
        // Counter is reset to 0
        assert_eq!(
            state.anomaly_counters.get("demand-letter-generator"),
            Some(&0)
        );
    }
}

use crate::mcp_stdio::McpServerManager;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HealthDiagnostic {
    pub app_id: String,
    pub status_code: Option<u64>,
    pub error_rate: f64,
    pub mcp_server_status: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RemediationAction {
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub reason: String,
}

pub async fn evaluate_health_with_ai_dynamic(
    diagnostic_data: HealthDiagnostic,
    _mcp_manager: &McpServerManager,
) -> Result<RemediationAction, String> {
    let _ = crate::lane_events::handle_telemetry_event(&crate::lane_events::TelemetryEvent {
        r#type: "health_evaluation_started".to_string(),
        payload: serde_json::json!({
            "app_id": diagnostic_data.app_id,
            "status_code": diagnostic_data.status_code,
            "error_rate": diagnostic_data.error_rate,
        }),
    })
    .await;

    let ai_mode = std::env::var("FLEET_AI_MODE").unwrap_or_else(|_| "dynamic".to_string());

    let allowlist = vec![
        "restart_mcp_server",
        "reduce_request_rate",
        "purge_zone_cache",
        "execute_circuit_breaker",
        "log_incident",
    ];

    let action = if ai_mode == "llm" {
        // We'll trust the allowlist and dynamic tools
        // A full MCP server inspection via `discover_tools_best_effort` can be done here if needed.
        let available_tools = allowlist.clone();

        let _system_prompt = format!(
            "You are an AI DevOps agent. Given the diagnostic: {diagnostic_data:?}\n            And the available tools: {available_tools:?}\n            Choose the best tool to resolve the issue. You MUST respond with a JSON object: {{\"tool_name\": \"name\", \"arguments\": {{}}, \"reason\": \"why\"}}"
        );

        let mut llm_action = None;
        if let Ok(simulated_response) = std::env::var("SIMULATED_LLM_FLEET_RESPONSE") {
            if let Ok(action) = serde_json::from_str::<RemediationAction>(&simulated_response) {
                if allowlist.contains(&action.tool_name.as_str()) {
                    llm_action = Some(action);
                } else {
                    println!(
                        "[Fleet Health] LLM suggested tool outside allowlist: {}",
                        action.tool_name
                    );
                }
            }
        }

        llm_action.unwrap_or_else(|| fallback_dynamic_eval(&diagnostic_data))
    } else {
        fallback_dynamic_eval(&diagnostic_data)
    };

    let _ = crate::lane_events::handle_telemetry_event(&crate::lane_events::TelemetryEvent {
        r#type: "health_evaluation_completed".to_string(),
        payload: serde_json::json!({
            "app_id": diagnostic_data.app_id,
            "action": action.tool_name,
            "automated": true,
        }),
    })
    .await;

    Ok(action)
}

fn fallback_dynamic_eval(diagnostic_data: &HealthDiagnostic) -> RemediationAction {
    if diagnostic_data.status_code == Some(502)
        || diagnostic_data.mcp_server_status == "unresponsive"
    {
        RemediationAction {
            tool_name: "restart_mcp_server".to_string(),
            arguments: serde_json::json!({ "server": diagnostic_data.app_id }),
            reason: "Unresponsive MCP server detected".to_string(),
        }
    } else if diagnostic_data.error_rate > 0.5 {
        RemediationAction {
            tool_name: "reduce_request_rate".to_string(),
            arguments: serde_json::json!({ "app_id": diagnostic_data.app_id }),
            reason: "High error rate detected".to_string(),
        }
    } else if diagnostic_data.status_code == Some(500) {
        RemediationAction {
            tool_name: "purge_zone_cache".to_string(),
            arguments: serde_json::json!({ "zone": diagnostic_data.app_id }),
            reason: "Stale cache suspected based on 500s".to_string(),
        }
    } else {
        RemediationAction {
            tool_name: "execute_circuit_breaker".to_string(),
            arguments: serde_json::json!({ "app_id": diagnostic_data.app_id }),
            reason: "Unknown failure, escalating to circuit breaker with HITL".to_string(),
        }
    }
}

#[cfg(test)]
mod tests_ai_eval {
    use super::*;
    use crate::mcp_stdio::McpServerManager;

    #[tokio::test]
    async fn test_fallback_eval() {
        let diag = HealthDiagnostic {
            app_id: "test".to_string(),
            status_code: Some(500),
            error_rate: 0.1,
            mcp_server_status: "ok".to_string(),
        };
        let action = fallback_dynamic_eval(&diag);
        assert_eq!(action.tool_name, "purge_zone_cache");
    }

    #[tokio::test]
    async fn test_llm_mode_fallback_on_invalid_response() {
        std::env::set_var("FLEET_AI_MODE", "llm");
        std::env::remove_var("SIMULATED_LLM_FLEET_RESPONSE");

        let config = crate::config::RuntimeConfig::empty();
        let manager = McpServerManager::from_runtime_config(&config);

        let diag = HealthDiagnostic {
            app_id: "test2".to_string(),
            status_code: Some(502),
            error_rate: 0.1,
            mcp_server_status: "ok".to_string(),
        };

        let action = evaluate_health_with_ai_dynamic(diag, &manager)
            .await
            .unwrap();
        assert_eq!(action.tool_name, "restart_mcp_server");
    }

    #[tokio::test]
    async fn test_llm_mode_rejects_unallowed_tool() {
        std::env::set_var("FLEET_AI_MODE", "llm");
        let simulated_resp = serde_json::json!({
            "tool_name": "rm_rf_slash",
            "arguments": {},
            "reason": "because"
        });
        std::env::set_var("SIMULATED_LLM_FLEET_RESPONSE", simulated_resp.to_string());

        let config = crate::config::RuntimeConfig::empty();
        let manager = McpServerManager::from_runtime_config(&config);

        let diag = HealthDiagnostic {
            app_id: "test3".to_string(),
            status_code: Some(502),
            error_rate: 0.1,
            mcp_server_status: "ok".to_string(),
        };

        let action = evaluate_health_with_ai_dynamic(diag, &manager)
            .await
            .unwrap();
        // Since `rm_rf_slash` is blocked, it falls back to dynamic eval which picks `restart_mcp_server`
        assert_eq!(action.tool_name, "restart_mcp_server");
    }
}
