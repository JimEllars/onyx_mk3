with open("rust/crates/runtime/src/worker_boot.rs", "r") as f:
    content = f.read()

sub_agent_function = """

pub async fn spawn_sub_agent_delegation(role: &str, task: &str, parent_worker_id: &str) -> Result<String, String> {
    let sub_agent_id = format!("sub-agent-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
    let role_clone = role.to_string();
    let task_clone = task.to_string();
    let parent_worker_id_clone = parent_worker_id.to_string();
    let sub_agent_id_clone = sub_agent_id.clone();

    crate::ui_stream::stream_log_to_ui(&sub_agent_id, "LaneEventName::SubAgentSpawned", &role_clone).await;
    crate::ui_stream::stream_log_to_ui(&sub_agent_id, "LaneEventName::SubAgentWorking", &role_clone).await;

    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        let result = format!("Task completed by {role_clone}: {task_clone}");

        crate::ui_stream::stream_log_to_ui(&sub_agent_id_clone, "LaneEventName::SubAgentCompleted", &role_clone).await;

        let completion_event = crate::lane_events::TelemetryEvent {
            r#type: "sub_agent_completed".to_string(),
            payload: serde_json::json!({
                "sub_agent_id": sub_agent_id_clone,
                "role": role_clone,
                "result": result,
                "parent_worker_id": parent_worker_id_clone
            })
        };
        let _ = crate::lane_events::handle_telemetry_event(&completion_event).await;
    });

    Ok(sub_agent_id)
}
"""

content += sub_agent_function

with open("rust/crates/runtime/src/worker_boot.rs", "w") as f:
    f.write(content)
