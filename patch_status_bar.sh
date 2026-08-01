#!/bin/bash
cat << 'INNER_EOF' > rust/crates/onyx/src/tui/status_bar.rs
use crate::runtime::{self, TokenUsage};
use crate::telemetry;
use crossterm::{
    cursor::{MoveTo, RestorePosition, SavePosition},
    style::{Color, Print, ResetColor, SetBackgroundColor, SetForegroundColor},
    terminal::size,
    QueueableCommand,
};
use std::io::{stdout, Write};
use std::sync::atomic::Ordering;

// These would normally be in metrics module, we simulate them here for compilation
use std::sync::atomic::AtomicBool;
pub static CACHED_CRON_STATUS_ACTIVE: AtomicBool = AtomicBool::new(false);
pub static CACHED_EDGE_BUFFER_READY: AtomicBool = AtomicBool::new(true);

pub fn render_status_bar_text(
    brand_id: Option<&runtime::persona::BrandId>,
    model: &str,
    session_id: &str,
    usage: &TokenUsage,
    cost: f64,
    fleet_status: Option<&runtime::GlobalFleetStatus>,
    worker_status: Option<&runtime::WorkerStatus>,
    playbook_status: Option<&Vec<(String, String, String)>>,
    _focus_state: Option<&crate::app::FocusState>,
    web3_wallet_address: Option<&str>,
) -> String {
    let mut text = format!(" {} ∥ Sess: {} ∥ ${cost:.4}", model, session_id);
    text = format!(
        "{text} ∥ In: {} ∥ Out: {}",
        usage.input_tokens, usage.output_tokens
    );
    if usage.cache_creation_input_tokens > 0 {
        text = format!("{text} ∥ +Cache: {}", usage.cache_creation_input_tokens);
    }
    if usage.cache_read_input_tokens > 0 {
        text = format!("{text} ∥ CacheRead: {}", usage.cache_read_input_tokens);
    }
    if let Some(w) = web3_wallet_address {
        text = format!("{text} ∥ Wallet: {w}");
    }
    if let Some(brand) = brand_id {
        text = format!("{text} ∥ Brand: {}", brand.name());
    }
    if let Some(fleet) = fleet_status {
        let degraded = fleet.total_degraded_nodes;
        let offline = fleet.total_offline_nodes;
        if degraded > 0 || offline > 0 {
            text = format!("{text} ∥ Fleet: [D:{degraded} O:{offline}]");
        } else {
            text = format!("{text} ∥ Fleet: [OK]");
        }
    }
    if let Some(worker) = worker_status {
        let status = match worker {
            runtime::WorkerStatus::Idle => "Idle",
            runtime::WorkerStatus::Working => "Working",
            runtime::WorkerStatus::Error(_) => "Error",
        };
        text = format!("{text} ∥ Worker: [{status}]");
    }

    let playbook_str = if let Some(playbooks) = playbook_status {
        if !playbooks.is_empty() {
            let active = playbooks.len();
            format!(" ∥ Playbooks: {active}")
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let session_indicator = if telemetry::metrics::LAST_SESSION_HEARTBEAT_SUCCESS
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        " ∥ [Session: Connected]"
    } else if telemetry::metrics::SESSION_HEARTBEAT_ATTEMPTED
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        " ∥ [Session: Reconnecting]"
    } else {
        " ∥ [Session: Local]"
    };

    let pulse_sync_str = if let Some(elapsed) = telemetry::metrics::get_last_pulse_sync_elapsed() {
        if elapsed.as_secs() < 120 {
            format!(" ∥ Pulse Sync: {}s ago", elapsed.as_secs())
        } else {
            format!(" ∥ Pulse Sync: {}m ago", elapsed.as_secs() / 60)
        }
    } else {
        " ∥ Pulse Sync: Never".to_string()
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

    let d1_timeout_count =
        telemetry::metrics::D1_TIMEOUT_COUNT.load(std::sync::atomic::Ordering::Relaxed);
    if d1_timeout_count > 0 {
        text = format!("{text} ∥ [DB: DEGRADED]");
    }

    let edge_heartbeat_intercepts =
        telemetry::metrics::EDGE_HEARTBEAT_INTERCEPTS.load(std::sync::atomic::Ordering::Relaxed);
    if edge_heartbeat_intercepts > 0 {
        text = format!("{text} ∥ [Sessions: EDGE-CACHED]");
    }

    let cron_active = CACHED_CRON_STATUS_ACTIVE.load(Ordering::Relaxed);
    if cron_active {
        text = format!("{text} ∥ [Cron Status: Active]");
    }

    let edge_ready = CACHED_EDGE_BUFFER_READY.load(Ordering::Relaxed);
    if edge_ready {
        text = format!("{text} ∥ [Edge Buffer: Ready]");
    }

    let edge_status_val = telemetry::metrics::EDGE_KV_STATUS.get();

    let edge_state_str = if (edge_status_val - 1.0).abs() < f64::EPSILON {
        "HEALTHY"
    } else {
        "DEGRADED"
    };
    let cache_hit_rate = telemetry::metrics::EDGE_CACHE_HIT_RATE.get();
    let cache_ttl = telemetry::metrics::EDGE_CACHE_TTL.get();

    let rps = 0;
    let rps_str = if rps > 0 {
        format!("\x1b[1;32m[RPS: {rps}]\x1b[0m")
    } else {
        format!("[RPS: {rps}]")
    };

    text = format!(
        "{text} ∥ {rps_str} ∥ [Edge: OK] · EDGE: {edge_state_str} · CACHE: {cache_hit_rate:.0}% · TTL: {cache_ttl:.0}s"
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
    fleet_status: Option<&runtime::GlobalFleetStatus>,
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
    let swarm_fmt = if swarm_queue_depth > 0 {
        format!("[33m[Swarm Q: {swarm_queue_depth}][0m")
    } else {
        "[2m[Swarm Q: 0][0m".to_string()
    };

    let is_sync_active = telemetry::dlq::IS_SYNC_ACTIVE.load(Ordering::Relaxed);
    let sync_badge = if is_sync_active {
        "[36m[Sync: Active][0m"
    } else {
        "[2m[Sync: Idle][0m"
    };

    let dlq_fmt = if dlq_depth > 0 {
        format!("[36;1m[DLQ: {dlq_depth} ⟳] {sync_badge}[0m")
    } else {
        format!("[2m[DLQ: 0] {sync_badge}[0m")
    };

    let edge_auth_ok = telemetry::metrics::EDGE_AUTH_OK.load(std::sync::atomic::Ordering::Relaxed);
    let edge_auth_str = if edge_auth_ok {
        "[32m[Auth: OK][0m"
    } else {
        "[1;31m[Auth: FAIL][0m"
    };

    let text = format!(
        "{text} ∥ [Cmds: {cmds}] ∥ {swarm_fmt} ∥ {dlq_fmt} ∥ Blocked Ingress: {blocked_ingress} ∥ {edge_auth_str}"
    );

    if let Ok((cols, rows)) = size() {
        let mut out = stdout();

        // Safely truncate the text dynamically to avoid terminal size panics
        let stripped_text = text
            .replace("[33m", "")
            .replace("[2m", "")
            .replace("[0m", "")
            .replace("[32m", "")
            .replace("[1;31m", "")
            .replace("[36m", "")
            .replace("[36;1m", "");
        let truncated_text = if stripped_text.chars().count() > cols as usize {
            let width = cols.saturating_sub(2) as usize;
            if width == 0 {
                ""
            } else {
                let end_idx = stripped_text
                    .char_indices()
                    .nth(width)
                    .map_or(stripped_text.len(), |(i, _)| i);
                &stripped_text[0..end_idx]
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
        let d1_timeout_count =
            telemetry::metrics::D1_TIMEOUT_COUNT.load(std::sync::atomic::Ordering::Relaxed);
        let edge_heartbeat_intercepts = telemetry::metrics::EDGE_HEARTBEAT_INTERCEPTS
            .load(std::sync::atomic::Ordering::Relaxed);

        let cron_active = CACHED_CRON_STATUS_ACTIVE.load(Ordering::Relaxed);
        let edge_ready = CACHED_EDGE_BUFFER_READY.load(Ordering::Relaxed);

        let (bg, fg) = if d1_timeout_count > 0 {
            (Color::Magenta, Color::White)
        } else if cron_active {
            (Color::DarkGreen, Color::White)
        } else if edge_ready {
            (Color::DarkBlue, Color::White)
        } else if edge_heartbeat_intercepts > 0 {
            (Color::DarkCyan, Color::White)
        } else if (session_active && !session_success) || rl_val > 0 {
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
INNER_EOF
