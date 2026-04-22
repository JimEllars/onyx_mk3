use crate::swarm_lock::DistributedLock;
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
        }
    }

    // In a real implementation, this would make a network call to the LLM
    // with a prompt like:
    // "You are Onyx, AXiM's infrastructure AI. Review the following recent telemetry logs. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them: {logs}"

    // For this sprint, we mock the LLM network call and its response.
    // We simulate the AI analyzing logs and finding a degradation.
    let _prompt = format!("You are Onyx, AXiM's infrastructure AI. Review the following recent telemetry logs: {telemetry_logs}. Also consider recent incident memory to avoid loops: {recent_incidents}. Identify any degraded micro-apps and return a JSON array of tools to execute to fix them.");

    if let Some(logs) = telemetry_logs.as_array() {
        let mut has_errors = false;
        let mut degraded_app = String::new();
        for log in logs {
            if let (Some(app), Some(status_code)) = (
                log.get("app_name").and_then(|v| v.as_str()),
                log.get("status_code").and_then(serde_json::Value::as_u64),
            ) {
                if status_code >= 500 {
                    has_errors = true;
                    degraded_app = app.to_string();
                    break;
                }
            }
        }

        if has_errors {
            let mut ai_response_actions = Vec::new();

            let mut manager =
                crate::mcp_stdio::McpServerManager::from_runtime_config(&runtime_config);
            let discovery = manager.discover_tools_best_effort().await;

            // Try to find a relevant tool dynamically by evaluating actual health capabilities
            let mut selected_tool = None;
            for tool in &discovery.tools {
                let matches = tool.qualified_name.contains("purge_zone_cache")
                    || tool.raw_name.contains("purge_zone_cache")
                    || tool.qualified_name.contains("restart_service")
                    || tool.raw_name.contains("restart_service")
                    || tool.qualified_name.contains("revert_deployment")
                    || tool.raw_name.contains("revert_deployment");

                if matches {
                    selected_tool = Some(tool);
                    break;
                }
            }

            if let Some(tool) = selected_tool {
                ai_response_actions.push(serde_json::json!({
                    "tool_name": tool.qualified_name.clone(),
                    "arguments": { "zone_id": degraded_app }
                }));
            } else {
                // If no specific remediation tool is found, we should not blindly run random tools.
                // We leave ai_response_actions empty.
            }

            let ai_response = serde_json::Value::Array(ai_response_actions);

            let mut current_status = status.write().unwrap();
            current_status.apps.insert(
                degraded_app.clone(),
                AppStatus::Degraded("AI detected anomalies".to_string()),
            );

            if let Some(actions) = ai_response.as_array() {
                for action_val in actions {
                    if let (Some(tool_name), Some(args)) = (
                        action_val.get("tool_name").and_then(|v| v.as_str()),
                        action_val.get("arguments"),
                    ) {
                        let action_id = format!(
                            "action-{}",
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_nanos()
                        );
                        let proposed_action = ProposedAction {
                            tool_name: tool_name.to_string(),
                            arguments: args.clone(),
                            id: action_id.clone(),
                            status: ActionStatus::Pending,
                            created_at: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_secs(),
                        };
                        println!("[AI Self-Healing: Anomaly detected in {degraded_app}. Status set to DEGRADED. Pushing ProposedAction: {action_id}]");
                        current_status.pending_actions.push(proposed_action);
                    }
                }
            }
        }
    }
}

pub fn evaluate_fleet_health(status: &GlobalFleetStatus, telemetry_logs: &serde_json::Value) {
    {
        let mut current_status = status.write().unwrap();
        current_status.last_updated = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
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
            } else {
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

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let mut actions_to_execute = Vec::new();

            {
                let mut current_status = status.write().unwrap();
                for action in &mut current_status.pending_actions {
                    if action.status == ActionStatus::Pending {
                        let mut should_execute = false;

                        if approved_tasks.contains(&action.id) {
                            println!(
                                "[Approval received for task_id {}. Transitioning to Executing]",
                                action.id
                            );
                            should_execute = true;
                        } else if now >= action.created_at + (12 * 3600) {
                            println!("[Auto-approving task_id {} after 12 hours. Transitioning to Executing]", action.id);
                            should_execute = true;
                        }

                        if should_execute {
                            action.status = ActionStatus::Executing;
                            actions_to_execute.push(action.clone());
                        }
                    }
                }
            }

            for action in actions_to_execute {
                let lock_id = format!("action_{}", action.id);
                let acquired = DistributedLock::acquire(&lock_id, 300)
                    .await
                    .unwrap_or(false);
                if !acquired {
                    println!(
                        "[Skipping action {} - lock already held by another node]",
                        action.id
                    );
                    {
                        let mut current_status = status.write().unwrap();
                        if let Some(a) = current_status
                            .pending_actions
                            .iter_mut()
                            .find(|a| a.id == action.id)
                        {
                            a.status = ActionStatus::Pending;
                        }
                    }
                    continue;
                }

                let mut exec_status = "Failed";
                #[allow(unused_assignments)]
                let mut exec_details = "Unknown error".to_string();

                let tool_name = action.tool_name.clone();
                let mut is_mcp = false;
                let mut _mcp_server = String::new();

                // Assume format "mcp__SERVERNAME__TOOLNAME" for MCP tools
                if tool_name.starts_with("mcp__") {
                    let parts: Vec<&str> = tool_name.split("__").collect();
                    if parts.len() >= 3 {
                        is_mcp = true;
                        _mcp_server = parts[1].to_string();
                    }
                }

                if is_mcp {
                    println!("[Executing MCP Tool: {tool_name}...]");
                    // Dynamic dispatch via MCP client
                    let workspace_root = std::env::current_dir().unwrap_or_default();
                    let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map_or_else(
                        |_| {
                            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                            std::path::PathBuf::from(home).join(".onyx")
                        },
                        std::path::PathBuf::from,
                    );
                    let loader =
                        crate::config::ConfigLoader::new(&workspace_root, &config_home_dir);
                    let runtime_config = loader
                        .load()
                        .unwrap_or_else(|_| crate::config::RuntimeConfig::empty());

                    let mut manager =
                        crate::mcp_stdio::McpServerManager::from_runtime_config(&runtime_config);
                    match manager
                        .call_tool(&tool_name, Some(action.arguments.clone()))
                        .await
                    {
                        Ok(result) => {
                            exec_status = "Completed";
                            exec_details = format!("MCP tool executed successfully: {result:?}");
                            println!("[Execution completed for MCP task_id {}]", action.id);
                        }
                        Err(e) => {
                            exec_status = "Failed";
                            exec_details = format!("MCP tool execution failed: {e}");
                            eprintln!("[Execution failed for MCP task_id {}: {}]", action.id, e);
                        }
                    }
                } else {
                    match action.tool_name.as_str() {
                        "purge_zone_cache" => {
                            #[derive(serde::Deserialize)]
                            struct PurgeInput {
                                zone_id: String,
                            }

                            if let Ok(input) =
                                serde_json::from_value::<PurgeInput>(action.arguments.clone())
                            {
                                println!(
                                    "[Executing: Purging cache for zone_id {}...]",
                                    input.zone_id
                                );

                                let api_key =
                                    std::env::var("CLOUDFLARE_API_TOKEN").unwrap_or_default();
                                let email = std::env::var("CLOUDFLARE_EMAIL").unwrap_or_default();
                                let cf_client = reqwest::Client::new();
                                let cf_url = format!(
                                    "https://api.cloudflare.com/client/v4/zones/{}/purge_cache",
                                    input.zone_id
                                );

                                let result: Result<(), String> = match cf_client
                                    .post(&cf_url)
                                    .header("X-Auth-Key", api_key)
                                    .header("X-Auth-Email", email)
                                    .header("Content-Type", "application/json")
                                    .json(&serde_json::json!({ "purge_everything": true }))
                                    .send()
                                    .await
                                {
                                    Ok(res) if res.status().is_success() => Ok(()),
                                    Ok(res) => {
                                        Err(format!("Cloudflare API error: {}", res.status()))
                                    }
                                    Err(e) => Err(e.to_string()),
                                };

                                match result {
                                    Ok(()) => {
                                        exec_status = "Completed";
                                        exec_details = "Cache purged successfully".to_string();
                                        println!("[Execution completed for task_id {}]", action.id);
                                    }
                                    Err(e) => {
                                        exec_status = "Failed";
                                        exec_details = format!("Error: {e}");
                                        eprintln!(
                                            "[Execution failed for task_id {}: {}]",
                                            action.id, e
                                        );
                                    }
                                }
                            } else {
                                exec_details = "Missing or invalid zone_id".to_string();
                                eprintln!("[Execution failed: Missing or invalid zone_id]");
                            }
                        }
                        "trigger_pages_deployment" => {
                            #[derive(serde::Deserialize)]
                            struct TriggerInput {
                                project_name: String,
                            }

                            if let Ok(input) =
                                serde_json::from_value::<TriggerInput>(action.arguments.clone())
                            {
                                println!(
                                    "[Executing: Triggering deployment for project {}...]",
                                    input.project_name
                                );

                                let account_id =
                                    std::env::var("CLOUDFLARE_ACCOUNT_ID").unwrap_or_default();
                                let api_key =
                                    std::env::var("CLOUDFLARE_API_TOKEN").unwrap_or_default();
                                let email = std::env::var("CLOUDFLARE_EMAIL").unwrap_or_default();
                                let cf_client = reqwest::Client::new();
                                let cf_url = format!("https://api.cloudflare.com/client/v4/accounts/{}/pages/projects/{}/deployments", account_id, input.project_name);

                                let result: Result<(), String> = match cf_client
                                    .post(&cf_url)
                                    .header("X-Auth-Key", api_key)
                                    .header("X-Auth-Email", email)
                                    .send()
                                    .await
                                {
                                    Ok(res) if res.status().is_success() => Ok(()),
                                    Ok(res) => {
                                        Err(format!("Cloudflare API error: {}", res.status()))
                                    }
                                    Err(e) => Err(e.to_string()),
                                };

                                match result {
                                    Ok(()) => {
                                        exec_status = "Completed";
                                        exec_details =
                                            "Deployment triggered successfully".to_string();
                                        println!("[Execution completed for task_id {}]", action.id);
                                    }
                                    Err(e) => {
                                        exec_status = "Failed";
                                        exec_details = format!("Error: {e}");
                                        eprintln!(
                                            "[Execution failed for task_id {}: {}]",
                                            action.id, e
                                        );
                                    }
                                }
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

        // Action
        evaluate_fleet_health(&status, &telemetry_payload);

        // Assertion
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
    }
}
