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
    brand_id: Option<&runtime::persona::BrandId>,
    model: &str,
    session_id: &str,
    usage: &TokenUsage,
    cost: f64,
    fleet_status: Option<&GlobalFleetStatus>,
    worker_status: Option<&runtime::WorkerStatus>,
    playbook_status: Option<&Vec<(String, String, String)>>,
    focus_state: Option<&crate::app::FocusState>,
    web3_wallet_address: Option<&str>,
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
        format!(" ∥ State: {ws}")
    } else {
        String::new()
    };

    let brand_str = brand_id.map_or_else(
        || "UNASSIGNED TENANT - BLOCKED".to_string(),
        |b| format!("{b:?}"),
    );
    let identity_str = if let Some(addr) = web3_wallet_address {
        if addr.len() >= 42 {
            format!("{}...{}", &addr[0..6], &addr[38..42])
        } else {
            addr.to_string()
        }
    } else {
        "Standard Auth".to_string()
    };
    let mut text = format!(
        "⚡ Tx: Active ∥ Persona: {} ∥ Auth: {} ∥ Threads: {} ∥ Model: {} ∥ Session: {} ∥ Tokens: In {}, Out {} ∥ Cost: ${:.4}{}",
        brand_str, identity_str, std::thread::available_parallelism().map(std::num::NonZero::get).unwrap_or(1),
        model, session_id, usage.input_tokens, usage.output_tokens, cost, worker_state_str
    );

    let mut playbook_str = String::new();
    if let Some(tasks) = playbook_status {
        if !tasks.is_empty() {
            playbook_str.push_str(" ∥ Playbook: ");
            for (id, name, status) in tasks {
                let icon = match status.as_str() {
                    "completed" => "✓",
                    "running" => "⠼",
                    _ => " ",
                };
                let _ = write!(playbook_str, "{icon} {name} ");
            }
        }
    }

    if has_executing {
        text = format!("{text} ∥ [EXECUTING_REMOTE_TASK]");
    } else if has_pending {
        text = format!("{text} ∥ [ACTION_REQUIRED]");
    }

    let delegated = runtime::fleet_health::DELEGATED_NODE_ID
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if let Some(node_id) = delegated {
        text = format!("{text} ∥ ⠼ Onyx delegating to [{node_id}]");
    }
    text = format!("{text}{playbook_str}");

    let edge_status_val = telemetry::metrics::EDGE_KV_STATUS.get();
    let edge_state_str = if (edge_status_val - 1.0).abs() < f64::EPSILON {
        "HEALTHY"
    } else {
        "DEGRADED"
    };
    let cache_hit_rate = telemetry::metrics::EDGE_CACHE_HIT_RATE.get();
    let cache_ttl = telemetry::metrics::EDGE_CACHE_TTL.get();

    let edge_latency = telemetry::metrics::EDGE_LATENCY_MS.get();

    text = format!(
        "{text} ∥ EDGE: {edge_state_str} · CACHE: {cache_hit_rate:.0}% · TTL: {cache_ttl:.0}s · LATENCY: {edge_latency:.2}ms"
    );

    text
}

#[allow(clippy::too_many_arguments)]
pub fn draw_status_bar(
    brand_id: Option<&runtime::persona::BrandId>,
    model: &str,
    session_id: &str,
    usage: &TokenUsage,
    cost: f64,
    fleet_status: Option<&GlobalFleetStatus>,
    worker_status: Option<&runtime::WorkerStatus>,
    playbook_status: Option<&Vec<(String, String, String)>>,
    focus_state: Option<&crate::app::FocusState>,
    web3_wallet_address: Option<&str>,
) {
    if let Ok((cols, rows)) = size() {
        if rows < 12 || cols < 45 {
            return;
        }
    }

    // Windowed redraw threshold check
    thread_local! {
        static LAST_PAINT: std::cell::RefCell<std::time::Instant> = std::cell::RefCell::new(
            std::time::Instant::now().checked_sub(std::time::Duration::from_millis(200)).unwrap()
        );
    }

    let should_paint = LAST_PAINT.with(|last_paint| {
        let mut lp = last_paint.borrow_mut();
        if lp.elapsed() >= std::time::Duration::from_millis(100) {
            *lp = std::time::Instant::now();
            true
        } else {
            false
        }
    });

    if !should_paint {
        return;
    }

    let text = render_status_bar_text(
        brand_id,
        model,
        session_id,
        usage,
        cost,
        fleet_status,
        worker_status,
        playbook_status,
        focus_state,
        web3_wallet_address,
    );

    // Check queues if we can. A bit of a hack to get Swarm size,
    // but typically we can append this via a global state if necessary.
    // For now we'll mock queue depth logic or fetch from telemetry
    let swarm_queue_depth = telemetry::metrics::get_worker_queue_depth();

    // DLQ Depth is now measured directly from the file via DLQ tracker
    let dlq_depth = telemetry::metrics::get_dlq_depth();

    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let blocked_ingress = telemetry::metrics::EDGE_AUTH_MISMATCH_TOTAL
        .get_metric_with_label_values(&["rejected"])
        .map(|m| m.get())
        .unwrap_or(0.0) as usize;

    let text = format!("{text} ∥ Worker Load: {swarm_queue_depth} · DLQ Depth: {dlq_depth} ∥ Blocked Ingress: {blocked_ingress}");

    if let Ok((cols, rows)) = size() {
        let mut out = stdout();

        // Safely truncate the text dynamically to avoid terminal size panics
        let truncated_text = if text.chars().count() > cols as usize {
            let width = cols.saturating_sub(2) as usize;
            if width == 0 {
                ""
            } else {
                let end_idx = text
                    .char_indices()
                    .nth(width)
                    .map_or(text.len(), |(i, _)| i);
                &text[0..end_idx]
            }
        } else {
            &text
        };

        let _ = out.queue(SavePosition);
        let _ = out.queue(MoveTo(0, rows - 1));

        let pulse_active = telemetry::metrics::is_trace_pulse_active();
        let (bg, fg) = if web3_wallet_address.is_some() {
            (Color::DarkBlue, Color::Cyan)
        } else if pulse_active {
            (Color::DarkGreen, Color::White)
        } else if let Some(focus) = focus_state {
            match focus {
                crate::app::FocusState::CommandPalette => (Color::DarkBlue, Color::White), // Vibrant Active
                _ => (Color::Reset, Color::DarkGrey), // Sleek Inactive
            }
        } else {
            (Color::DarkBlue, Color::White)
        };
        let _ = out.queue(SetBackgroundColor(bg));
        let _ = out.queue(SetForegroundColor(fg));

        let _ = out.queue(Print(format!(
            " {:<width$} ",
            truncated_text,
            width = cols.saturating_sub(2) as usize
        )));
        let _ = out.queue(ResetColor);
        let _ = out.queue(RestorePosition);
        let _ = out.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_bar_throttle() {
        let usage = runtime::TokenUsage {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        };
        for _ in 0..100 {
            draw_status_bar(
                None,
                "test_model",
                "test_session",
                &usage,
                0.0,
                None,
                None,
                None,
                None,
                None,
            );
        }
    }
}
