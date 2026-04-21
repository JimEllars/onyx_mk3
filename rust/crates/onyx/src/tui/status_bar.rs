use runtime::fleet_health::{ActionStatus, GlobalFleetStatus};
use runtime::TokenUsage;
use std::io::Write;

pub fn render_status_bar(
    model: &str,
    session_id: &str,
    usage: &TokenUsage,
    cost: f64,
    fleet_status: Option<&GlobalFleetStatus>,
    worker_status: Option<&runtime::WorkerStatus>,
) -> String {
    let mut has_executing = false;
    let mut has_pending = false;

    if let Some(status) = fleet_status {
        let state = status.read().unwrap();
        for action in &state.pending_actions {
            if action.status == ActionStatus::Executing {
                has_executing = true;
            } else if action.status == ActionStatus::Pending {
                has_pending = true;
            }
        }
    }

    let worker_state_str = if let Some(ws) = worker_status {
        format!(" | State: {ws}")
    } else {
        String::new()
    };

    let mut text = format!(
        "Model: {} | Session: {} | Tokens: In {}, Out {} | Cost: ${:.4}{}",
        model, session_id, usage.input_tokens, usage.output_tokens, cost, worker_state_str
    );

    if has_executing {
        text = format!("{text} | \x1b[38;5;46;5m[EXECUTING_REMOTE_TASK]\x1b[0m");
    } else if has_pending {
        text = format!("{text} | \x1b[38;5;214;5m[ACTION_REQUIRED]\x1b[0m");
    }

    text
}
