use crossterm::{
    cursor::{MoveTo, RestorePosition, SavePosition},
    style::{Color, Print, ResetColor, SetBackgroundColor, SetForegroundColor},
    terminal::{size, Clear, ClearType},
    QueueableCommand,
};
use runtime::fleet_health::{ActionStatus, GlobalFleetStatus};
use runtime::TokenUsage;
use std::fmt::Write as _;
use std::io::{stdout, Write};

#[allow(clippy::too_many_arguments)]
pub fn render_status_bar_text(
    model: &str,
    session_id: &str,
    usage: &TokenUsage,
    cost: f64,
    fleet_status: Option<&GlobalFleetStatus>,
    worker_status: Option<&runtime::WorkerStatus>,
    playbook_status: Option<&Vec<(String, String, String)>>,
    focus_state: Option<&crate::app::FocusState>,
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
        "⚡ Tx: Active | Threads: {} | Model: {} | Session: {} | Tokens: In {}, Out {} | Cost: ${:.4}{}",
        std::thread::available_parallelism().map(std::num::NonZero::get).unwrap_or(1),
        model, session_id, usage.input_tokens, usage.output_tokens, cost, worker_state_str
    );

    let mut playbook_str = String::new();
    if let Some(tasks) = playbook_status {
        if !tasks.is_empty() {
            playbook_str.push_str(" | [Playbook: ");
            for (id, name, status) in tasks {
                let icon = match status.as_str() {
                    "completed" => "✓",
                    "running" => "⠼",
                    _ => " ",
                };
                let _ = write!(playbook_str, "{icon} {name} ");
            }
            playbook_str.push(']');
        }
    }

    if has_executing {
        text = format!("{text} | [EXECUTING_REMOTE_TASK]");
    } else if has_pending {
        text = format!("{text} | [ACTION_REQUIRED]");
    }

    let delegated = runtime::fleet_health::DELEGATED_NODE_ID
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if let Some(node_id) = delegated {
        text = format!("{text} | ⠼ Onyx delegating to [{node_id}]");
    }
    text = format!("{text}{playbook_str}");

    text
}

#[allow(clippy::too_many_arguments)]
pub fn draw_status_bar(
    model: &str,
    session_id: &str,
    usage: &TokenUsage,
    cost: f64,
    fleet_status: Option<&GlobalFleetStatus>,
    worker_status: Option<&runtime::WorkerStatus>,
    playbook_status: Option<&Vec<(String, String, String)>>,
    focus_state: Option<&crate::app::FocusState>,
) {
    if let Ok((cols, rows)) = size() {
        if rows < 12 || cols < 45 {
            return;
        }
    }

    let text = render_status_bar_text(
        model,
        session_id,
        usage,
        cost,
        fleet_status,
        worker_status,
        playbook_status,
        focus_state,
    );

    if let Ok((cols, rows)) = size() {
        let mut out = stdout();

        let truncated_text = if text.len() > cols as usize {
            &text[0..cols as usize]
        } else {
            &text
        };

        let _ = out.queue(SavePosition);
        let _ = out.queue(MoveTo(0, rows - 1));

        let (bg, fg) = if let Some(focus) = focus_state {
            match focus {
                crate::app::FocusState::CommandPalette => (Color::DarkGrey, Color::Cyan), // Active
                _ => (Color::Black, Color::DarkGrey), // Inactive dims
            }
        } else {
            (Color::DarkGrey, Color::Cyan)
        };
        let _ = out.queue(SetBackgroundColor(bg));
        let _ = out.queue(SetForegroundColor(fg));

        let _ = out.queue(Print(format!(
            "{:<width$}",
            truncated_text,
            width = cols as usize
        )));
        let _ = out.queue(ResetColor);
        let _ = out.queue(RestorePosition);
        let _ = out.flush();
    }
}
