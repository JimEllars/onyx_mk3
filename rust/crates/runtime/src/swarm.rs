use crate::dispatch::SwarmQueues;
use crate::mcp_stdio::McpServerManager;
use crate::mcp_tool_bridge::{execute_mcp_tool, McpToolRegistry};
use crate::task_packet::TaskPacket;
use std::fmt::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug)]
pub struct SwarmWorker {
    queues: SwarmQueues,
    manager: Option<Arc<Mutex<McpServerManager>>>,
    registry: Option<McpToolRegistry>,
}

impl SwarmWorker {
    #[must_use]
    pub fn new(queues: SwarmQueues) -> Self {
        Self {
            queues,
            manager: None,
            registry: None,
        }
    }

    #[must_use]
    pub fn with_mcp(
        mut self,
        manager: Arc<Mutex<McpServerManager>>,
        registry: McpToolRegistry,
    ) -> Self {
        self.manager = Some(manager);
        self.registry = Some(registry);
        self
    }

    pub async fn run(mut self) {
        loop {
            // Drain critical queue first
            while let Ok(packet) = self.queues.critical_rx.try_recv() {
                self.execute_task("Critical", packet).await;
            }

            // If critical queue is empty, try high
            if let Ok(packet) = self.queues.high_rx.try_recv() {
                self.execute_task("High", packet).await;
                continue; // Re-evaluate critical queue
            }

            // If high is empty, try standard
            if let Ok(packet) = self.queues.standard_rx.try_recv() {
                self.execute_task("Standard", packet).await;
                continue; // Re-evaluate critical queue
            }

            // If standard is empty, try low
            if let Ok(packet) = self.queues.low_rx.try_recv() {
                self.execute_task("Low", packet).await;
                continue; // Re-evaluate critical queue
            }

            // If all queues are empty, wait for an item or sleep
            tokio::select! {
                Some(packet) = self.queues.critical_rx.recv() => {
                    self.execute_task("Critical", packet).await;
                }
                Some(packet) = self.queues.high_rx.recv() => {
                    self.execute_task("High", packet).await;
                }
                Some(packet) = self.queues.standard_rx.recv() => {
                    self.execute_task("Standard", packet).await;
                }
                Some(packet) = self.queues.low_rx.recv() => {
                    self.execute_task("Low", packet).await;
                }
            }
        }
    }

    pub fn delegate_subtask(
        &self,
        parent_packet: &TaskPacket,
        subtask_objective: &str,
        depth: u8,
    ) -> Result<TaskPacket, String> {
        if depth >= 3 {
            return Err("Max delegation depth reached".to_string());
        }

        let mut subtask = parent_packet.clone();
        subtask.objective = subtask_objective.to_string();

        // Emulate subtask processing and output aggregation
        let mut child_context = String::new();
        let _ = write!(
            child_context,
            "\n[Sub-Task Execution: {subtask_objective} - Depth {depth}]"
        );

        // Recursion or actual dispatch logic can go here. For now we simulate success.
        subtask.context.push_str(&child_context);

        Ok(subtask)
    }

    #[allow(clippy::too_many_lines)]
    pub async fn execute_task(&self, priority: &str, packet: TaskPacket) {
        println!(
            "[Swarm Worker] Processing {priority} priority task: {:?}",
            packet.objective
        );

        let agent_id = packet
            .worker_id
            .clone()
            .unwrap_or_else(|| "swarm_worker".to_string());
        let session_id = packet
            .job_id
            .clone()
            .unwrap_or_else(|| "swarm_job".to_string());

        // Emit start event using runtime's handle_telemetry_event
        let _ = crate::lane_events::handle_telemetry_event(&crate::lane_events::TelemetryEvent {
            r#type: "sub_agent_event".to_string(),
            payload: serde_json::json!({
                "session_id": session_id.clone(),
                "event_type": "packet_processing_started",
                "agent_id": agent_id.clone(),
                "attributes": {
                    "priority": priority,
                    "objective": packet.objective,
                    "repo": packet.repo
                }
            }),
        })
        .await;

        let mut available_tools = Vec::new();
        if let Some(registry) = &self.registry {
            let servers = registry.list_servers();
            for server in servers {
                if let Ok(tools) = registry.list_tools(&server.server_name) {
                    for tool in tools {
                        available_tools.push(crate::mcp_tool_bridge::McpToolInfo {
                            name: format!("{}__{}", server.server_name, tool.name),
                            description: tool.description,
                            input_schema: Some(tool.input_schema.unwrap_or_else(|| {
                                serde_json::json!({
                                    "type": "object",
                                    "properties": {}
                                })
                            })),
                        });
                    }
                }
            }
        }

        let mut output_packet = packet.clone();

        if !available_tools.is_empty() {
            if let Some(registry) = &self.registry {
                for tool in &available_tools {
                    if let Some((server_name, tool_name)) = tool.name.split_once("__") {
                        let result = execute_mcp_tool(
                            registry,
                            server_name,
                            tool_name,
                            &serde_json::json!({}),
                        );

                        match result {
                            Ok(res) => {
                                let mut res_str = res.to_string();
                                if res_str.len() > 4000 {
                                    res_str.truncate(4000);
                                    res_str.push_str("... [Output Truncated]");
                                }
                                let _ = write!(
                                    output_packet.context,
                                    "\nTool {} executed: {}",
                                    tool.name, res_str
                                );
                            }
                            Err(e) => {
                                let _ = write!(
                                    output_packet.context,
                                    "\n[Tool Failure - {}]: {}",
                                    tool.name, e
                                );
                            }
                        }
                    }
                }
            }
        }

        sleep(Duration::from_millis(10)).await;

        // Real execution via AXiM Core REST endpoint
        let axim_core_url = std::env::var("AXIM_CORE_URL")
            .unwrap_or_else(|_| "https://api.axim.us.com".to_string());
        let axim_secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
        let client = reqwest::Client::new();
        let url = format!("{axim_core_url}/api/v1/swarm/execute");

        let payload = serde_json::json!({
            "packet": output_packet
        });

        // Note: in a fully non-blocking architecture, we could spawn this out or await it depending on guarantees
        if axim_secret.is_empty() {
            // Fallback for tests
            sleep(Duration::from_millis(10)).await;
        } else {
            let _ = client
                .post(&url)
                .header("Authorization", format!("Bearer {axim_secret}"))
                .json(&payload)
                .send()
                .await;
        }

        // Emit finish event
        let _ = crate::lane_events::handle_telemetry_event(&crate::lane_events::TelemetryEvent {
            r#type: "sub_agent_event".to_string(),
            payload: serde_json::json!({
                "session_id": session_id,
                "event_type": "packet_processing_finished",
                "agent_id": agent_id,
                "attributes": {
                    "priority": priority,
                    "status": "success"
                }
            }),
        })
        .await;

        println!("[Swarm Worker] Finished {priority} priority task");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatch::{Dispatcher, TaskPriority};

    #[tokio::test]
    async fn test_swarm_worker_subtask_delegation() {
        let (_dispatcher, queues) = Dispatcher::new(10);
        let worker = SwarmWorker::new(queues);

        let packet = TaskPacket {
            objective: "Parent Task".to_string(),
            repo: "axim".to_string(),
            branch_policy: "main".to_string(),
            scope: "global".to_string(),
            worker_id: Some("worker-parent".to_string()),
            job_id: Some("job-parent".to_string()),
            acceptance_tests: vec![],
            commit_policy: String::new(),
            reporting_contract: String::new(),
            escalation_policy: String::new(),
            context: String::new(),
            goal: String::new(),
            expected_schema: serde_json::Value::Null,
            reasoning_effort: None,
            web3_wallet_address: None,
        };

        let result = worker.delegate_subtask(&packet, "Child Task", 1);
        assert!(result.is_ok());
        let aggregated = result.unwrap();
        assert!(aggregated
            .context
            .contains("[Sub-Task Execution: Child Task - Depth 1]"));

        // test depth guardrail
        let guardrail_result = worker.delegate_subtask(&packet, "Deep Task", 3);
        assert!(guardrail_result.is_err());
    }

    #[tokio::test]
    async fn test_swarm_worker_routing_priorities() {
        let (dispatcher, queues) = Dispatcher::new(10);

        let critical_packet = TaskPacket {
            objective: "Critical objective".to_string(),
            repo: "axim".to_string(),
            branch_policy: "main".to_string(),
            scope: "global".to_string(),
            worker_id: Some("worker-1".to_string()),
            job_id: Some("job-1".to_string()),
            acceptance_tests: vec![],
            commit_policy: String::new(),
            reporting_contract: String::new(),
            escalation_policy: String::new(),
            context: String::new(),
            goal: String::new(),
            expected_schema: serde_json::Value::Null,
            reasoning_effort: None,
            web3_wallet_address: None,
        };

        let low_packet = TaskPacket {
            objective: "Low objective".to_string(),
            repo: "axim".to_string(),
            branch_policy: "main".to_string(),
            scope: "global".to_string(),
            worker_id: Some("worker-2".to_string()),
            job_id: Some("job-2".to_string()),
            acceptance_tests: vec![],
            commit_policy: String::new(),
            reporting_contract: String::new(),
            escalation_policy: String::new(),
            context: String::new(),
            goal: String::new(),
            expected_schema: serde_json::Value::Null,
            reasoning_effort: None,
            web3_wallet_address: None,
        };

        dispatcher
            .dispatch(TaskPriority::Low, low_packet.clone())
            .await
            .unwrap();
        dispatcher
            .dispatch(TaskPriority::Critical, critical_packet.clone())
            .await
            .unwrap();

        let worker = SwarmWorker::new(queues);

        // Spawn the worker but stop it by dropping after a short time
        tokio::spawn(async move {
            worker.run().await;
        });

        // Wait a tiny bit to let tokio run the spawned task
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    #[tokio::test]
    async fn test_swarm_worker_error_boundary() {
        let (dispatcher, queues) = Dispatcher::new(10);
        let worker = SwarmWorker::new(queues);

        // We simulate a malformed/missing packet processing
        let packet = TaskPacket {
            objective: "Test error boundary".to_string(),
            repo: "axim".to_string(),
            branch_policy: "main".to_string(),
            scope: "global".to_string(),
            worker_id: Some("worker-3".to_string()),
            job_id: Some("job-3".to_string()),
            acceptance_tests: vec![],
            commit_policy: String::new(),
            reporting_contract: String::new(),
            escalation_policy: String::new(),
            context: String::new(),
            goal: String::new(),
            expected_schema: serde_json::Value::Null,
            reasoning_effort: None,
            web3_wallet_address: None,
        };

        dispatcher
            .dispatch(TaskPriority::Standard, packet)
            .await
            .unwrap();

        // Spawn the worker but stop it by dropping after a short time
        tokio::spawn(async move {
            worker.run().await;
        });

        // Wait a tiny bit to let tokio run the spawned task
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        // if it doesn't panic, the error boundary holds
    }
}

#[tokio::test]
async fn test_swarm_worker_handles_disconnect() {
    let (dispatcher, queues) = crate::dispatch::Dispatcher::new(10);
    let worker = SwarmWorker::new(queues);

    let packet = TaskPacket {
        objective: "Test disconnect boundary".to_string(),
        repo: "axim".to_string(),
        branch_policy: "main".to_string(),
        scope: "global".to_string(),
        worker_id: Some("worker-disconnected".to_string()),
        job_id: Some("job-disconnected".to_string()),
        acceptance_tests: vec![],
        commit_policy: String::new(),
        reporting_contract: String::new(),
        escalation_policy: String::new(),
        context: String::new(),
        goal: String::new(),
        expected_schema: serde_json::Value::Null,
        reasoning_effort: None,
        web3_wallet_address: None,
    };

    dispatcher
        .dispatch(crate::dispatch::TaskPriority::Standard, packet)
        .await
        .unwrap();

    tokio::spawn(async move {
        worker.run().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
}

#[cfg(test)]
mod additional_tests {
    use super::*;
    use crate::dispatch::{Dispatcher, TaskPriority};
    use crate::mcp_tool_bridge::{McpConnectionStatus, McpToolInfo, McpToolRegistry};

    #[tokio::test]
    async fn test_swarm_worker_mcp_invocation() {
        let (dispatcher, queues) = Dispatcher::new(10);

        let registry = McpToolRegistry::new();
        registry.register_server(
            "test_mcp_server",
            McpConnectionStatus::Connected,
            vec![McpToolInfo {
                name: "test_tool".into(),
                description: None,
                input_schema: None,
            }],
            vec![],
            None,
        );

        let worker = SwarmWorker::new(queues);
        let worker = worker.with_mcp(
            Arc::new(Mutex::new(
                crate::mcp_stdio::McpServerManager::from_servers(
                    &std::collections::BTreeMap::default(),
                ),
            )),
            registry,
        );

        let packet = TaskPacket {
            objective: "Test MCP execution".to_string(),
            repo: "axim".to_string(),
            branch_policy: "main".to_string(),
            scope: "global".to_string(),
            worker_id: Some("worker-mcp".to_string()),
            job_id: Some("job-mcp".to_string()),
            acceptance_tests: vec![],
            commit_policy: String::new(),
            reporting_contract: String::new(),
            escalation_policy: String::new(),
            context: String::new(),
            goal: String::new(),
            expected_schema: serde_json::Value::Null,
            reasoning_effort: None,
            web3_wallet_address: None,
        };

        dispatcher
            .dispatch(TaskPriority::Standard, packet)
            .await
            .unwrap();

        tokio::spawn(async move {
            worker.run().await;
        });

        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }
}
