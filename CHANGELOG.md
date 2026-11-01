# Changelog

All notable changes to Onyx Mk3 are recorded here. Entries are newest-first.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — 2026-11-01

Six-hour recurring maintenance cycle. Baseline re-verified, two HUD defects fixed,
plan Phases 2 and 3 landed. No Rust source changed.

### Fixed

- **HUD discarded every assistant reply.** `ChatInterface` parsed only
  `{"chunk": "..."}`, which neither response shape carries: the edge streams
  `{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}`
  (`edge-bridge/src/index.ts:354`), and an accepted payload returns
  `application/json` `{"status":"success","message":"..."}` with no SSE frames.
  Every turn produced an empty assistant bubble on both paths. Response handling
  now branches on `content-type`; legacy `{chunk}` and OpenAI
  `choices[0].delta.content` shapes remain accepted.
- **Action Console rebuilt its ticket-expiry timer on every telemetry event.**
  `telemetryEvents` sat in the interval's dependency array, so each event tore
  down and recreated the 5s timer — and each tick issued a `fetch`. Expiry is now
  its own effect over tickets only.
- **HITL failures were indistinguishable from success.** The console mapped any
  non-`ok` response to a bare `FAILED`. The edge only returns `200` when Core
  applied the decision, and otherwise `502`/`503` with `reason` + `core_status`;
  the operator now sees `Decision not applied — <reason>`. Decisions also moved to
  the canonical `POST /api/v1/hitl/action` (was `/api/v1/mcp/execute`; both share
  `applyHitlDecision`).
- **Approval keyboard shortcuts captured while typing.** `Enter`/`Y`/`N`/`Escape`
  now ignored when the focus target is an input or textarea.
- **`useAgentConnection` returned a non-reactive `retryCount`** (`retryCountRef.current`,
  so consumers never re-rendered) and capped the WebRTC backoff at 10s while the
  SSE path used 30s. Both transports now share one 1s → 30s curve with jitter.
- **Sidebar exposed raw transport enums** (`CONNECTING`, `RECONNECT NEEDED`,
  `ACTIVE`). Both connection rows now render `ONLINE` / `RECONNECTING` / `OFFLINE`.
- **Embedded HUD bundle was stale.** The committed
  `static/assets/index-BQrnB38z.js` predated `src/`. `wrangler.jsonc` serves that
  same directory as worker assets, so the edge and the daemon were both shipping
  an outdated HUD. Bundle regenerated.

### Added

- **Live DLQ telemetry in the Action Console** (plan Phase 2): polls
  `GET /api/v1/telemetry/dlq-status` with the Passport bearer and shows depth,
  circuit-breaker state and Core reachability.
- **RCA JSON inspector drawer** (plan Phase 2): expandable list of 5xx / error
  telemetry records, newest first, with app, status code, trace id and the
  formatted payload.
- **Multi-persona context switcher** (plan Phase 3): AXiM Core, Robotics Lab,
  SpeedReport Network, AXiM Academy. Selection persists and is sent as
  `domain_context` in the summon body; the edge forwards the parsed body to
  `CORE_INGEST_URL` opaquely, so no edge change was required.
- **`npm test` at the repository root** (37 assertions, `node:test`, no new
  dependencies) covering SSE framing and the exact edge wire fixture, the backoff
  curve and state mapping, persona resolution, and RCA normalisation.
- `src/lib/chatStream.js`, `src/lib/connectionState.js`, `src/lib/domainContexts.js`,
  `src/lib/rca.js` — pure, DOM-free logic extracted so it can be tested.

### Changed

- `useAgentConnection` state is now `{ status, retryCount }` with `retryCount` as
  React state rather than a ref read.

### Not changed (with reasons)

- **Phase 4 `--daemon` mode.** `CliAction::ServeHeadless` already binds an axum
  router (`rust/crates/onyx/src/main.rs:2060`) and the HUD assets already live in
  `rust/crates/onyx/static/`; the remaining gap is a `--daemon` alias plus
  `rust-embed` replacing `tower-http`'s `fs` feature. This authoring environment
  cannot link Rust binaries (no `cc`, no root, no glibc CRT objects), so a
  type-checked Rust change was not written blind. Needs a runner with
  `build-essential`.
- **`rust/build.log` / `rust/test.log`.** Both record `E0428`/`E0004` against
  `/app/rust` and predate the current head; at this commit `State` is declared
  once and `ServeHeadless` is handled. Ignore them; they are gitignored.
