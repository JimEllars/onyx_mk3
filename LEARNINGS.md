# Phase 23 Learnings

- OnceLock with tokio handlers provides an effective decoupled approach to connect runtime generic systems to tools modules without creating direct circular crate dependencies.
- It is vital to decouple predictive_ops to operate purely on telemetry metric fetching without blocking the main event loops.
## Phase 24
- We must enforce that edge-bridge (Cloudflare Worker) deployments remain constantly synchronized with the core API.
- Using Rust to hit Cloudflare's `/deployments` API provides a reliable check that triggers human email alerts on sync failure.
- `execute_send_email` requires the `jrellars@gmail.com` and `james.ellars@axim.us.com` targets as an escalation fallback.
