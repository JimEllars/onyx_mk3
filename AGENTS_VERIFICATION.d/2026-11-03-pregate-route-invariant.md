# Verification Log — Pre-gate route registry, structured error logging, constant-time secret checks (2026-11-03)

**Branch:** `fix/onyx-pregate-route-invariant`
**Base:** `0ce4e8e` (main, post-PR #303)
**Scope:** `edge-bridge/` source + tests, and the embedded HUD bundle under
`rust/crates/onyx/static/`. No Rust source change.

## Why

Main is green (`Rust CI`, `Web CI` and `Edge Bridge Sync Guardrail` all `success` at
`0ce4e8e`), there are no open PRs and no open issues, so this cycle is defect work rather
than feature work. Three things were buttoned up, all from the "Still open" list in
`WEB_APP_DEVELOPMENT_PLAN.md`:

1. **Standing defect 5 — the global HMAC gate sits mid-chain in `_fetch`.** Thirteen routes
   are declared above it, so they never reach it and each authenticates itself or not at
   all. Nothing stopped the fourteenth from landing unauthenticated. There was no test that
   could tell.
2. **Standing defect 4 — unlabelled error logging.** 21 bare `console.error("error")` calls
   plus 13 ad-hoc ones: a production log line named neither the subsystem nor the request.
   While surveying them, one turned out to be worse than unlabelled: `fetch()` called
   `console.error("error")` on the **success** path, so every request that returned normally
   logged an error line. That is how a real failure gets ignored.
3. **Two secret comparisons still used `!==`.** The GitHub and WordPress webhook handlers
   computed their own HMAC and compared hex strings with `!==`, and the emergency-direct
   bearer was compared with `!==` — both short-circuit on the first differing character and
   leak the expected value through timing. `verifyRequestSignature` and `checkAuth` already
   used constant-time verification; these three call sites were the stragglers.

Also fixed, because it is shipped output: the embedded HUD bundle committed under
`rust/crates/onyx/static/` still contained **React 19.2.8** after #298 moved the HUD to
19.3.1, so `onyx daemon` served the old runtime from the binary.

## What

### New: `edge-bridge/src/preGateRoutes.ts` (273 lines)

A registry of every route answered before the gate — path, match kind, methods, auth mode,
the auth evidence that must remain in its handler, and *why*. Plus `classifyPreGateRoute()`
(longest-prefix match, method-aware) as the API the eventual route-table refactor will
consume, and `requiresAuthEvidence()` so "public" and "read-only proxy" are the only modes
allowed to be evidence-free.

All 17 literals registered: `/health`, `/api/v1/health`, `/healthz`, `/readyz`, `/ready`,
`/functions/v1/telemetry-ingress`, `/api/v1/dlq-drain`, `/api/v1/telemetry/dlq-status`,
`/api/v1/telemetry/flush`, `/api/v1/onyx/emergency-direct`, `/api/v1/onyx/summon`,
`/api/v1/schema`, `/api/v1/template`, `/api/v1/telemetry/health`, `/api/v1/llm/health`,
`/api/v1/generate/`, `/api/v1/generate/nda`, plus the one gate exemption
`/api/v1/webhooks`.

### New: `edge-bridge/test/pre-gate-routes.test.ts` (228 lines, 13 tests)

Parses `src/index.ts` and asserts:

- the gate marker appears exactly once, so "above the gate" is unambiguous;
- every `"/path"` literal on a `pathname` line above the marker is registered (the
  extraction over-captures on purpose — an unregistered path fails the test, which is the
  safe direction), with a `>= 17` count guard against the regex silently matching nothing;
- no registry entry outlives its route (rename/deletion detection);
- every non-credential-free route declares evidence, and that evidence is still present in
  its handler block (whitespace-insensitive, so prettier reflows do not matter);
- gate-exempt routes are declared after the gate *and* verify the caller themselves;
- `classifyPreGateRoute` semantics, including that prefix matching is plain `startsWith`,
  mirroring `_fetch` exactly.

### New: `edge-bridge/src/logging.ts` (65 lines)

`logError(event, error?, context?)` and `logRequest(event, context?)`. One
`JSON.stringify` per line, `<subsystem>.<what_happened>` event vocabulary, `Error`
normalised to `{message, error_name}`, and a fallback for context that cannot serialise —
a logger inside a `catch` must never throw.

### `edge-bridge/src/index.ts` (3774 → 3798 lines)

34 logging call sites converted, so that `console.error` no longer appears in the file at
all (`test/logging.test.ts` asserts both "no bare `console.error(\"error\")`" and "no direct
`console.error`"), and every error now carries an event name:

| Line (was → now) | Site | Event |
|---|---|---|
| 335-339 → 337 | `missingBinding()` | `edge.config.binding_missing` |
| 381, 387 | `kvWriteWithTimeout()` | `edge.kv.write_timeout` / `.write_error` |
| 404, 410 | `kvReadWithTimeout()` | `edge.kv.read_timeout` / `.read_error` |
| 523, 532, 538 | `invokeDeepSeek()` | `edge.llm.deepseek_http_error` / `_empty_completion` / `_failed` |
| 567, 576, 582 | `invokeAnthropic()` | `edge.llm.anthropic_http_error` / `_empty_completion` / `_failed` |
| 668 | `checkReadiness()` | `edge.readiness.probe_failed` |
| 720 | `dispatchToCore()` | `edge.ingest.outbound_failed` |
| 797 | `enforceAsguardRateLimit()` | `edge.ratelimit.kv_error` |
| 947-949 | `loadPendingHitlTickets()` | `edge.hitl.ticket_unparseable` |
| 1030 | `drainIngestDlq()` | `edge.dlq_drain.ingest_replay_failed` |
| 1050 | `scheduled()` miss | `edge.cron.hitl_digest_skipped` |
| 1213 | `scheduled()` pulse sync | `edge.cron.content_engine_sync_failed` |
| **1240 → 1285** | **`fetch()` success path** | **`edge.request.completed` at info level (was an error log on every successful request)** |
| 1248 → 1302 | `fetch()` catch | `edge.request.unhandled` |
| 1274 → 1328 | 405 branch | `edge.request.method_not_allowed` at info level |
| 1559 → 1613 | DLQ drain route | `edge.dlq_drain.route_replay_failed` |
| 1611 → 1665 | `/api/v1/telemetry/dlq-status` | `edge.telemetry.dlq_status_failed` |
| 1890 → 1946 | `/api/v1/onyx/summon` body | `edge.summon.body_unparsable` |
| 1920 → 1976 | summon Core call | `edge.summon.core_unreachable` |
| 2121 → 2177 | idempotent replay | `edge.request.idempotent_replay` at info level |
| 2363 → 2419 | rate-limit metrics | `edge.ratelimit.metrics_query_failed` |
| 2743 → 2799 | session heartbeat forward | `edge.session.heartbeat_forward_failed` |
| 2817 → 2873 | session heartbeat catch | `edge.session.heartbeat_failed` |
| 3220 → 3276 | email DLQ write | `edge.email.dlq_write_failed` |
| 3547 → 3571 | asset fetch | `edge.assets.fetch_failed` |
| 3569 → 3593 | top-level 500 | `edge.request.unhandled` |
| 3617 → 3641 | provider fallback | `edge.llm.fallback_triggered` |
| 3756 → 3780 | analytics write | `edge.telemetry.write_failed` |

Two comparisons hardened:

- **`verifyHexHmacSignature(secret, body, header)`** (new, exported, index.ts:599-645):
  optional `sha256=` prefix, hex validated before use, `crypto.subtle.verify` instead of
  sign-then-compare, fails closed on a missing secret/header/malformed digest and never
  throws. Used by both webhook branches (index.ts:3387-3420), replacing 42 lines of
  compute-then-`!==`.
- **`/api/v1/onyx/emergency-direct`** (index.ts:1828): `authHeader !== expectedToken`
  became `!equalSecrets(authHeader, expectedToken)`.

### New: `edge-bridge/test/webhook-signature.test.ts` (242 lines, 16 tests)

Behavioural pins: a correct GitHub signature is accepted (proven by reaching the
`CORE_INGEST_URL` guard, which a refused signature cannot reach), upper-case hex accepted,
wrong-secret / wrong-body / malformed-digest / unsigned all refused with their exact
status and body, a missing secret fails closed, WordPress bare-hex and `sha256=`-prefixed
both accepted, wrong digest and wrong `wp_secret` refused. Emergency-direct: correct
bearer + signature reaches the 403 email allow-list (so both checks passed), wrong bearer
with a valid signature is 401, valid bearer with a wrong signature is 401.

## Proving runs

```
$ cd edge-bridge && npx tsc --noEmit
$ echo $?
0

$ npx vitest run
 Test Files  11 passed (11)
      Tests  132 passed (132)
   Duration  10.23s
```

Was 8 files / 93 tests at `0ce4e8e`; +3 files, +39 tests.

```
$ ./node_modules/.bin/wrangler deploy --dry-run --config wrangler.jsonc
✨ Read 4 files from the assets directory .../rust/crates/onyx/static
Total Upload: 119.10 KiB / gzip: 21.94 KiB
--dry-run: exiting now.
exit 0

$ cd .. && npx vitest run        # HUD suite, unchanged by this branch
 Test Files  7 passed (7)
      Tests  49 passed (49)

$ npx vite build
rust/crates/onyx/static/index.html                   3.01 kB │ gzip:   1.19 kB
rust/crates/onyx/static/assets/index-BKVYMyrj.css   21.00 kB │ gzip:   5.07 kB
rust/crates/onyx/static/assets/index-CllMSb_c.js   481.69 kB │ gzip: 143.80 kB
✓ built in 1.25s
```

### Negative controls — the guard actually bites

Both were run against a temporarily modified `index.ts`, then reverted.

**(a) An unregistered route above the gate:**

```ts
// injected after the /ready block
if (request.method === "GET" && url.pathname === "/api/v1/debug/operator-secrets") {
  return new Response("leaked");
}
```

```
FAIL  test/pre-gate-routes.test.ts > routes declared above the HMAC gate > are all registered with an auth mode
AssertionError: Routes declared above the global HMAC gate must be listed in
src/preGateRoutes.ts with the mechanism that authenticates them. An unregistered
pre-gate route is a silent fail-open.: expected [ '/api/v1/debug/operator-secrets' ] to deeply equal []
 Tests  1 failed | 12 passed (13)
```

**(b) A deleted auth check on a registered route** (removed
`checkAuth(request, env, true)` from `/api/v1/telemetry/flush`):

```
FAIL  test/pre-gate-routes.test.ts > routes declared above the HMAC gate > still contain the auth call each entry claims
AssertionError: Auth evidence declared in preGateRoutes.ts is absent from the handler, so the
check was removed, renamed or moved out of the block.: expected [ Array(1) ] to deeply equal []
  "/api/v1/telemetry/flush → checkAuth(request, env, true)"
 Tests  1 failed | 12 passed (13)
```

After reverting both, `11 passed (11) / 132 passed (132)`.

## Embedded bundle regenerated

`rust/crates/onyx/static/assets/index-2CSI7Ry0.js` (442,869 bytes, `react-dom` **19.2.8**)
replaced by `index-CllMSb_c.js` (481,695 bytes, **19.3.1**). The old bundle predates #298's
React bump, so the Phase 4 daemon was serving the pre-bump runtime out of the binary.

Checks: both bundles are production builds (`grep -c 'react-dom.development'` → 0), both
contain the Phase 2/3 features (`dlq-status`, `RcaInspector`, `DomainContextSwitcher`,
`AXiM Academy`, `RECONNECTING`), and `rust/crates/onyx/src/daemon.rs` pins no asset hash —
its content-type tests use the placeholder `assets/index-abc123.js`, and the only real
requirement is that `index.html` is embedded (daemon.rs:495). The 39 KB growth comes from
the vite/rolldown patch (8.3.0 → 8.3.5 in #274/#299), not from dev code.

Committing the bundle also gives `Rust CI` a reason to run on this PR (`rust/**` is in its
path filter), which is the only way the 442-test Rust workspace gets compiled for these
changes.

## Not verified — read this before merging

- **No Rust compilation happened here.** This sandbox has no C toolchain and no working
  linker for `reqwest`/`native-tls` (see `LEARNINGS.md` §11), so `cargo fmt`, `cargo clippy`
  and `cargo test` were not run locally. No Rust *source* changed, but the embedded assets
  did, and `daemon.rs` asserts `index.html` is embedded. `rust-ci.yml` is the compiler of
  record for this branch; do not merge on local evidence alone.
- **The constant-time claim is structural, not measured.** The tests pin the *outcome* (a
  right secret passes, a wrong one is refused); no test can observe the removal of a timing
  side channel. The mechanism is `crypto.subtle.verify` / `equalSecrets`, the same primitives
  already used by `verifyRequestSignature` and `checkAuth`.
- **`equalSecrets` still returns early on a length mismatch**, which leaks length, not
  content. Consistent with the existing call sites; changing it means hashing both sides
  first, which is a separate decision.

## Environment caveat worth knowing

This sandbox exports `NODE_ENV=production`, so a plain `npm ci` omits every devDependency
(4 packages installed, no `vitest`, no `jsdom`) and `npm run build` fails at `vite build`
with `ERR_MODULE_NOT_FOUND`. Every command above was run with `NODE_ENV=development`, which
is also what the runner uses. CI is unaffected (it does not set `NODE_ENV`).
