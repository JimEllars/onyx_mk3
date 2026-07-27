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

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
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
    let edge_status_val_conn = telemetry::metrics::EDGE_KV_STATUS.get();
    let edge_conn_str = if (edge_status_val_conn - 1.0).abs() < f64::EPSILON {
        "Connected (Cloudflare Edge)"
    } else {
        "Offline"
    };
    let edge_latency_val = telemetry::metrics::EDGE_LATENCY_MS.get();

    let mut text = format!(
        "⚡ {} ∥ Persona: {} ∥ Auth: {} ∥ Threads: {} ∥ Model: {} ∥ Session: {} ∥ Tokens: In {}, Out {} ∥ Cost: ${:.4}{} ∥ Latency: {:.2}ms",
        edge_conn_str, brand_str, identity_str, std::thread::available_parallelism().map(std::num::NonZero::get).unwrap_or(1),
        model, session_id, usage.input_tokens, usage.output_tokens, cost, worker_state_str, edge_latency_val
    );

    if let Ok((cols, _)) = size() {
        if cols < 80 {
            // Collapse non-essential widgets
            text = format!(
                "⚡ {edge_conn_str} ∥ {model} ∥ {session_id} ∥ Cost: ${cost:.4} ∥ Lat: {edge_latency_val:.2}ms"
            );
        }
    }

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

    let session_active =
        telemetry::metrics::SESSION_HEARTBEAT_ATTEMPTED.load(std::sync::atomic::Ordering::Relaxed);
    let session_success = telemetry::metrics::LAST_SESSION_HEARTBEAT_SUCCESS
        .load(std::sync::atomic::Ordering::Relaxed);
    let session_indicator = if session_active {
        if session_success {
            " ∥ [Session: Active]"
        } else {
            " ∥ [Session: Retrying]"
        }
    } else {
        ""
    };

    let pulse_sync_str = if let Some(elapsed) = telemetry::metrics::get_last_pulse_sync_elapsed() {
        let secs = elapsed.as_secs();
        if secs < 60 {
            format!(" ∥ Last Pulse Sync: {secs}s ago")
        } else if secs < 3600 {
            format!(" ∥ Last Pulse Sync: {}m ago", secs / 60)
        } else {
            format!(" ∥ Last Pulse Sync: {}h ago", secs / 3600)
        }
    } else {
        " ∥ Last Pulse Sync: Never".to_string()
    };

    let pulse_sync_str = format!("{session_indicator}{pulse_sync_str}");

    let axim_sync_ok = telemetry::metrics::LAST_TELEMETRY_DISPATCH_SUCCESS
        .load(std::sync::atomic::Ordering::Relaxed);
    let axim_sync_str = if axim_sync_ok {
        format!(
            " ∥ AXiM Sync: OK [Telemetry Q:{}]",
            telemetry::get_telemetry_queue_depth()
        )
    } else {
        let q_depth = telemetry::get_telemetry_queue_depth();
        format!(" ∥ AXiM Sync: FAIL [Telemetry Q:{q_depth}]")
    };

    text = format!("{text}{playbook_str}{pulse_sync_str}{axim_sync_str}");

    let rate_limit_val =
        telemetry::metrics::RATE_LIMIT_COUNT.load(std::sync::atomic::Ordering::Relaxed);
    text = format!("{text} ∥ [RL: {rate_limit_val}]");

    let edge_status_val = telemetry::metrics::EDGE_KV_STATUS.get();

    let edge_state_str = if (edge_status_val - 1.0).abs() < f64::EPSILON {
        "HEALTHY"
    } else {
        "DEGRADED"
    };
    let cache_hit_rate = telemetry::metrics::EDGE_CACHE_HIT_RATE.get();
    let cache_ttl = telemetry::metrics::EDGE_CACHE_TTL.get();

    text = format!(
        "{text} ∥ [Edge: OK] · EDGE: {edge_state_str} · CACHE: {cache_hit_rate:.0}% · TTL: {cache_ttl:.0}s"
    );

    let email_status = telemetry::metrics::get_last_email_status();
    if !email_status.is_empty() {
        let display_status = match email_status.as_str() {
            "sent" => "Sent",
            "delivered" => "Delivered",
            "bounced" => "Bounced",
            "failed" => "Failed",
            _ => &email_status,
        };
        text = format!("{text} ∥ [Email: {display_status}]");
    } else if telemetry::metrics::LAST_TELEMETRY_DISPATCH_SUCCESS
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        text = format!("{text} ∥ [Email Dispatched: success]");
    }

    let mem_count = if let Some(brand) = brand_id {
        runtime::vector_memory::global_memory()
            .read()
            .unwrap()
            .get_memory_count(brand)
    } else {
        0
    };
    text = format!("{text} ∥ Mem: {mem_count} Snapshots");

    text
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
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
        if lp.elapsed() >= std::time::Duration::from_millis(33) {
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

    let cmds = telemetry::metrics::get_command_execution_total();
    let text = format!("{text} ∥ [Cmds: {cmds}] ∥ Worker Load: {swarm_queue_depth} · DLQ Depth: {dlq_depth} ∥ Blocked Ingress: {blocked_ingress}");

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
        let q_depth = telemetry::get_telemetry_queue_depth();

        let session_active = telemetry::metrics::SESSION_HEARTBEAT_ATTEMPTED
            .load(std::sync::atomic::Ordering::Relaxed);
        let session_success = telemetry::metrics::LAST_SESSION_HEARTBEAT_SUCCESS
            .load(std::sync::atomic::Ordering::Relaxed);

        let rl_val =
            telemetry::metrics::RATE_LIMIT_COUNT.load(std::sync::atomic::Ordering::Relaxed);
        let (bg, fg) = if (session_active && !session_success) || rl_val > 0 {
            (Color::Yellow, Color::Black)
        } else if session_active && session_success {
            (Color::DarkGreen, Color::White)
        } else if q_depth > 0 {
            (Color::Yellow, Color::Black)
        } else if web3_wallet_address.is_some() {
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
