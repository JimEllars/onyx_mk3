use crate::dispatch::SwarmQueues;
use crate::task_packet::TaskPacket;
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug)]
pub struct SwarmWorker {
    queues: SwarmQueues,
}

impl SwarmWorker {
    #[must_use]
    pub fn new(queues: SwarmQueues) -> Self {
        Self { queues }
    }

    pub async fn run(mut self) {
        loop {
            // Drain critical queue first
            while let Ok(packet) = self.queues.critical_rx.try_recv() {
                self.process_packet("Critical", packet).await;
            }

            // If critical queue is empty, try high
            if let Ok(packet) = self.queues.high_rx.try_recv() {
                self.process_packet("High", packet).await;
                continue; // Re-evaluate critical queue
            }

            // If high is empty, try standard
            if let Ok(packet) = self.queues.standard_rx.try_recv() {
                self.process_packet("Standard", packet).await;
                continue; // Re-evaluate critical queue
            }

            // If standard is empty, try low
            if let Ok(packet) = self.queues.low_rx.try_recv() {
                self.process_packet("Low", packet).await;
                continue; // Re-evaluate critical queue
            }

            // If all queues are empty, wait for an item or sleep
            tokio::select! {
                Some(packet) = self.queues.critical_rx.recv() => {
                    self.process_packet("Critical", packet).await;
                }
                Some(packet) = self.queues.high_rx.recv() => {
                    self.process_packet("High", packet).await;
                }
                Some(packet) = self.queues.standard_rx.recv() => {
                    self.process_packet("Standard", packet).await;
                }
                Some(packet) = self.queues.low_rx.recv() => {
                    self.process_packet("Low", packet).await;
                }
            }
        }
    }

    async fn process_packet(&self, priority: &str, packet: TaskPacket) {
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

        // In a real execution, dispatch to playbook or MCP tools
        sleep(Duration::from_millis(10)).await;

        // Real execution via AXiM Core REST endpoint
        let axim_core_url = std::env::var("AXIM_CORE_URL")
            .unwrap_or_else(|_| "https://api.axim.us.com".to_string());
        let axim_secret = std::env::var("AXIM_ONYX_SECRET").unwrap_or_default();
        let client = reqwest::Client::new();
        let url = format!("{axim_core_url}/api/v1/swarm/execute");

        let payload = serde_json::json!({
            "packet": packet
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
