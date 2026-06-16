# Phase 23 Learnings

- OnceLock with tokio handlers provides an effective decoupled approach to connect runtime generic systems to tools modules without creating direct circular crate dependencies.
- It is vital to decouple predictive_ops to operate purely on telemetry metric fetching without blocking the main event loops.
## Phase 24
- We must enforce that edge-bridge (Cloudflare Worker) deployments remain constantly synchronized with the core API.
- Using Rust to hit Cloudflare's `/deployments` API provides a reliable check that triggers human email alerts on sync failure.
- `execute_send_email` requires the `jrellars@gmail.com` and `james.ellars@axim.us.com` targets as an escalation fallback.

## Cloudflare Workers Sync Hardening (Sprint Phase 26)

- Identified and corrected the Cloudflare API endpoint for validating Worker deployments in `rust/crates/tools/src/cloudflare_ops.rs` to point to `/accounts/{account_id}/workers/deployments/by-script/{script_id}` instead of the Pages endpoint.
- Handled deployment logic accurately by checking the array response length, matching Cloudflare's structural model for worker environments.
- Implemented human alerting fail-safes via `execute_send_email` using `jrellars@gmail.com` and `james.ellars@axim.us.com` to notify administrators of verification failures or edge API desyncs.
- Tested and verified async KV polling behavior simulating missing cryptographic signatures and invalid JSON using integration tests.
- Audited the CI/CD deployment workflows in `.github/workflows/edge-bridge-sync.yml` to confirm successful paths and environment settings.
