

<!-- =========================
Source: AXIM_EDGE_INTEGRATION.md
========================= -->

# Master Integration Plan: AXiM Core + Onyx mk3 Edge Bridge

## The Goal
Create a serverless 'Edge Bridge' that allows AXiM Core to communicate with Onyx's intelligence. This provides a highly performant, serverless, and cost-effective way to expose Onyx's core LLM routing logic as a lightweight TypeScript Edge function via Cloudflare Workers.

## The Architecture
We will create a new subdirectory containing a Cloudflare Worker project. This worker will receive commands, inject Onyx's system prompts, and route them to the appropriate LLM (starting with Anthropic/Claude).

## The API Contract
The worker will expose a `POST /api/v1/chat` endpoint. It expects a JSON payload containing:
```json
{
  "command": "user command string",
  "context": "context string or object"
}
```

## Security
All requests must include an `Authorization: Bearer <token>` header, matching a secret we will store in the worker's environment variables (`AXIM_ONYX_SECRET`).


<!-- =========================
Source: PHILOSOPHY.md
========================= -->

# Claw Code Philosophy

## Stop Staring at the Files

If you only look at the generated files in this repository, you are looking at the wrong layer.

The Python rewrite was a byproduct. The Rust rewrite was also a byproduct. The real thing worth studying is the **system that produced them**: a clawhip-based coordination loop where humans give direction and autonomous claws execute the work.

Claw Code is not just a codebase. It is a public demonstration of what happens when:

- a human provides clear direction,
- multiple coding agents coordinate in parallel,
- notification routing is pushed out of the agent context window,
- planning, execution, review, and retry loops are automated,
- and the human does **not** sit in a terminal micromanaging every step.

## The Human Interface Is Discord

The important interface here is not tmux, Vim, SSH, or a terminal multiplexer.

The real human interface is a Discord channel.

A person can type a sentence from a phone, walk away, sleep, or do something else. The claws read the directive, break it into tasks, assign roles, write code, run tests, argue over failures, recover, and push when the work passes.

That is the philosophy: **humans set direction; claws perform the labor.**

## The Three-Part System

### 1. OmX (`oh-my-codex`)
[oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) provides the workflow layer.

It turns short directives into structured execution:
- planning keywords
- execution modes
- persistent verification loops
- parallel multi-agent workflows

This is the layer that converts a sentence into a repeatable work protocol.

### 2. clawhip
[clawhip](https://github.com/Yeachan-Heo/clawhip) is the event and notification router.

It watches:
- git commits
- tmux sessions
- GitHub issues and PRs
- agent lifecycle events
- channel delivery

Its job is to keep monitoring and delivery **outside** the coding agent's context window so the agents can stay focused on implementation instead of status formatting and notification routing.

### 3. OmO (`oh-my-openagent`)
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) handles multi-agent coordination.

This is where planning, handoffs, disagreement resolution, and verification loops happen across agents.

When Architect, Executor, and Reviewer disagree, OmO provides the structure for that loop to converge instead of collapse.

## The Real Bottleneck Changed

The bottleneck is no longer typing speed.

When agent systems can rebuild a codebase in hours, the scarce resource becomes:
- architectural clarity
- task decomposition
- judgment
- taste
- conviction about what is worth building
- knowing which parts can be parallelized and which parts must stay constrained

A fast agent team does not remove the need for thinking. It makes clear thinking even more valuable.

## What Claw Code Demonstrates

Claw Code demonstrates that a repository can be:

- **autonomously built in public**
- coordinated by claws/lobsters rather than human pair-programming alone
- operated through a chat interface
- continuously improved by structured planning/execution/review loops
- maintained as a showcase of the coordination layer, not just the output files

The code is evidence.
The coordination system is the product lesson.

## What Still Matters

As coding intelligence gets cheaper and more available, the durable differentiators are not raw coding output.

What still matters:
- product taste
- direction
- system design
- human trust
- operational stability
- judgment about what to build next

In that world, the job of the human is not to out-type the machine.
The job of the human is to decide what deserves to exist.

## Short Version

**Claw Code is a demo of autonomous software development.**

Humans provide direction.
Claws coordinate, build, test, recover, and push.
The repository is the artifact.
The philosophy is the system behind it.

## Related explanation

For the longer public explanation behind this philosophy, see:

- https://x.com/realsigridjin/status/2039472968624185713


<!-- =========================
Source: PARITY.md
========================= -->

# Phase 23 Parity Update

- Added team_cron_registry.rs scheduled polling via internal asynchronous ticker.
- Configured 5-minute schedule checks for predictive_ops::analyze_fleet_degradation.
- Added autonomous preemptive HITL ticketing inside support_ops.
- Handlers passed down via standard standard function box PREDICTIVE_ANALYSIS_HANDLER.
## Phase 24 Updates
- Established **Continuous Edge Parity Enforcement** via `.github/workflows/edge-bridge-sync.yml`.
- Activated deployment monitor within `cloudflare_ops.rs` that verifies Cloudflare worker status post-deployment and triggers human escalation emails if the edge worker goes out of sync.
- Updated `edge-bridge/src/index.ts` to support Phase 20-23 schemas (`/api/v1/ingress/customer_leads`, `/api/v1/billing/fallback-blockchain`).

## Cloudflare Ingress Verification Sync
- Updated the deployment verification route: `VerifyEdgeDeploymentInput` -> Cloudflare API `/workers/deployments/by-script/{project_name}`
- The tool maps success states directly to `VerifyEdgeDeploymentOutput { is_synced: true, status: "success" }` when at least one active deployment is returned.
- Mismatched versions and execution exceptions are logged and escalated sequentially via `execute_send_email`.
- Validation: Integration test vectors in `test_async_state_polling_validation` confirm that KV queues can be read safely and handle malformed execution states without propagating panics.

## Phase 27 Edge Stream Hardening & Final Traffic Routing
- Implemented Server-Sent Events (SSE) streaming passthrough natively in the `edge-bridge` Cloudflare Worker for `/api/v1/chat`. Ensure the response body from the upstream LLM API is streamed directly and not buffered using `await claudeResponse.json()`.
- Added strict HMAC SHA-256 signature validation within the worker for WordPress webhooks (`x-wp-webhook-signature`) utilizing WebCrypto (`crypto.subtle`), ensuring invalid requests drop with a `401 Unauthorized` before hitting `ctx.waitUntil`.
- Hardened Rust axum router extraction in tests for both `authorization` and `cf-connecting-ip` headers. Verified against a mock `axim_core_router_header_parsing` test within `edge_bridge_communication.rs` ensuring correct handling of edge worker payloads.


<!-- =========================
Source: mcp_manager_plan.md
========================= -->

Currently evaluate_health_with_ai is hardcoded to return `purge_zone_cache`. We need it to be dynamic.
1. Add `mcp_client` dispatcher. We need to query McpManager or ToolRegistry.
Let's see how `evaluate_health_with_ai` gets called and what we have available.
