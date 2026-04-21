use axum::{routing::post, Router};
use mock_anthropic_service::MockAnthropicService;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

#[tokio::test]
async fn axim_headless() {
    // 1. Setup AXiM core mock server
    let state_transitions = Arc::new(Mutex::new(Vec::new()));
    let lane_events = Arc::new(Mutex::new(Vec::new()));

    let st = state_transitions.clone();
    let le = lane_events.clone();

    let app = Router::new()
        .route(
            "/api/state",
            post(move |body: axum::body::Bytes| async move {
                st.lock()
                    .unwrap()
                    .push(String::from_utf8(body.to_vec()).unwrap());
                axum::http::StatusCode::OK
            }),
        )
        .route(
            "/api/lane",
            post(move |body: axum::body::Bytes| async move {
                le.lock()
                    .unwrap()
                    .push(String::from_utf8(body.to_vec()).unwrap());
                axum::http::StatusCode::OK
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let mock_anthropic = MockAnthropicService::spawn().await.unwrap();

    // Use cargo's CARGO_BIN_EXE_<name> if available, otherwise fallback to the
    // relative location from the test executable (target/debug/deps/xxx -> target/debug/onyx)
    let onyx_bin = if let Ok(bin) = std::env::var("CARGO_BIN_EXE_onyx") {
        std::path::PathBuf::from(bin)
    } else {
        let mut exe = std::env::current_exe().unwrap();
        exe.pop(); // remove test binary name
        exe.pop(); // remove `deps` directory
        exe.push("onyx");
        exe
    };


    // Find a free port
    let headless_port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let mut command = Command::new(onyx_bin);
    command.env(
        "AXIM_CORE_STATE_ENDPOINT",
        format!("http://{addr}/api/state"),
    );
    command.env(
        "AXIM_CORE_LANE_EVENTS_ENDPOINT",
        format!("http://{addr}/api/lane"),
    );
    command.env("ANTHROPIC_BASE_URL", mock_anthropic.base_url());
    command.env("ANTHROPIC_API_KEY", "test-parity-key");
    command.args(["serve-headless", "--port", &headless_port.to_string()]);
    #[allow(clippy::zombie_processes)]
    let mut child = command.spawn().expect("failed to start headless server");

    tokio::time::sleep(Duration::from_secs(2)).await;

    // 2. Post a task packet to /tasks
    let client = reqwest::Client::new();
    let task_packet = serde_json::json!({
        "objective": "Fix the bug",
        "scope": "src/",
        "repo": "onyx-ai",
        "branch_policy": "read-only",
        "acceptance_tests": [],
        "commit_policy": "skip",
        "reporting_contract": "default",
        "escalation_policy": "abort"
    });

    let resp = client
        .post(format!("http://127.0.0.1:{headless_port}/tasks"))
        .json(&task_packet)
        .send()
        .await;

    assert!(resp.is_ok());
    let status = resp.as_ref().unwrap().status();
    let body = resp.unwrap().text().await.unwrap();
    assert!(
        status == reqwest::StatusCode::ACCEPTED,
        "Failed to submit task packet: {status} - {body}"
    );

    let parsed_body: serde_json::Value = serde_json::from_str(&body).unwrap();
    let _task_id = parsed_body["task_id"].as_str().unwrap();

    // 3. Give the background loop enough time to receive the task, spin up the CLI context,
    // hit the MockAnthropicService and report the state transitions
    // Onyx CLI might take a couple of seconds to run even with mock responses
    tokio::time::sleep(Duration::from_secs(3)).await;

    let reported_states = state_transitions.lock().unwrap().clone();

    child.kill().expect("failed to kill headless server");

    assert!(
        !reported_states.is_empty(),
        "Expected state transitions to be streamed via background execution loop"
    );
}
