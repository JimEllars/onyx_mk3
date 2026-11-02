# 2026-11-01 — HUD connection hardening, DLQ telemetry, RCA inspector, personas, HITL relay

Branch: `feat/onyx-hud-phase1-connection-hardening`
Base: `origin/main` @ `17dbe89` (merge of PR #291)
Session: 6-hour recurring audit, 11:00–13:00 America/Chicago

Two kinds of change here: **defects found while auditing the live tree**, and the
**Phase 2 / Phase 3 items** from `WEB_APP_DEVELOPMENT_PLAN.md` that the tree showed were
still missing. No Rust source was modified in this session.

---

## 1. Defect — the HUD auth gate threw instead of denying

**File:** `src/hooks/useAximAuth.js` (lines 1–10, 25–64, 70–81)
**New file:** `src/lib/roles.js` (1–41)
**Proving test:** `src/lib/__tests__/roles.test.js` (10 tests)

`hasSuperAdminRole` was:

```js
return payload.app_metadata?.SUPER_ADMIN_ROLES.includes(String(role || '').toLowerCase());
```

`SUPER_ADMIN_ROLES` is not a claim Passport issues, and `role` was never declared in
scope. A real token therefore either threw `TypeError: Cannot read properties of
undefined (reading 'includes')` (when `app_metadata` exists) or
`ReferenceError: role is not defined`. Either way the throw escaped
`validateToken`, which called it outside its `try` — the auth effect rejected, so
`isAuthenticated` never settled and a valid super-admin saw the login wall.

Now the HUD uses `src/lib/roles.js`, a deliberate mirror of `adminRoleFrom()` in
`edge-bridge/src/passport.ts`: role read from `app_metadata.role` or `role`,
lower-cased, matched against `super_admin` plus the four legacy spellings, with legacy
use reported to the console. `validateToken` additionally wraps the check so a malformed
token denies rather than throws.

**Demonstrated failing before the fix** (old implementation restored verbatim, test run):

```
× grants a valid super-admin token
× warns when the token carries a legacy spelling
× does not throw on a token whose app_metadata has no role claim
× does not throw on a token with no app_metadata at all
TypeError: Cannot read properties of undefined (reading 'includes')
Tests  4 failed | 6 passed (10)
```

After: `Tests  10 passed (10)`.

Also in this file: `parseJwt` now uses `globalThis.atob` instead of `window.atob`, so
claim parsing is testable outside a browser.

---

## 2. Defect — the action console relayed decisions to the wrong endpoint and flattened the result

**File:** `src/components/hud/ActionConsole.jsx` (1–120, 121–180, 296–300)
**New file:** `src/lib/hitlDecision.js` (1–117)
**Proving test:** `src/components/hud/__tests__/ActionConsole.test.jsx` (7 tests)

The console POSTed to `/api/v1/mcp/execute` and treated `response.ok` as success. The
edge worker's canonical route is `POST /api/v1/hitl/action` (both reach
`applyHitlDecision`), and it answers **200 only when Core accepted the decision** —
`502`/`503` mean *recorded in `HITL_APPROVAL_KV` but not applied*. The console rendered
that as a bare `FAILED`, which told the operator nothing about whether the approval would
ever resume.

`src/lib/hitlDecision.js` classifies the body into `APPROVED` / `REJECTED` / `QUEUED` /
`FAILED`, carries `applied`, `recorded`, `core_status` and `reason` through, and never
throws on a transport failure. `ActionConsole` now:

- posts to `/api/v1/hitl/action` with `{ action_id, decision: 'approve' | 'reject' }`,
  normalising the two spellings the edge accepts;
- renders `RECORDED · CORE UNREACHABLE — <reason>` for a queued decision;
- **keeps the ticket on screen** for `QUEUED` and `FAILED` — only a confirmed outcome
  retires the row. The old code hid it regardless.

---

## 3. Phase 2 — live DLQ telemetry replaced the synthesised panel

**New file:** `src/hooks/useDlqStatus.js` (1–143)
**File:** `src/components/hud/ActionConsole.jsx` (25–60, 140–180)

The panel that looked like queue telemetry was arithmetic on the local event buffer plus
a latency probe of `/api/v1/telemetry/health`. It stayed green while the edge was backed
up, because it never asked the edge.

`useDlqStatus` polls `GET /api/v1/telemetry/dlq-status` (authenticated, `Authorization:
Bearer` from the Passport token), reports `loading | live | stale | offline`, aborts the
in-flight request on unmount, and backs off exponentially on failure using the shared
`nextRetryDelay` helper. The console renders **Unsynced** (relays + receipts), **Core
Sync** (`upstream_core_ok`), **DLQ Feed** state and the breaker/relay/receipt line from
the real response.

The endpoint is authenticated (`checkAuth` at `edge-bridge/src/index.ts:1411`) — this is
a super-admin surface, not a public one.

---

## 4. Phase 2 — RCA inspector drawer for micro-app 5xx

**New file:** `src/components/hud/RcaInspector.jsx` (1–109)
**File:** `src/components/hud/ActionConsole.jsx` (275–300)

Recent 5xx events from `telemetryEvents` are listed with an **RCA** button that opens a
drawer (`role="dialog"`, `aria-label="RCA inspector"`) showing the structured `rca`
block, a toggle to the untouched raw event, and a copy button. When an event carries no
`rca` block the drawer says so and shows the raw payload rather than an empty pane.
Read-only: nothing in the drawer mutates fleet state.

---

## 5. Phase 3 — domain-context personas, end to end

**New file:** `src/lib/domainContexts.js` (1–60)
**New file:** `src/components/hud/DomainContextSwitcher.jsx` (1–43)
**File:** `src/components/hud/ChatInterface.jsx` (1–17, 168–178)
**File:** `edge-bridge/src/index.ts` (426–496)
**Proving tests:** `src/lib/__tests__/domainContexts.test.js` (7),
`src/components/hud/__tests__/ChatInterface.test.jsx` (5),
`edge-bridge/test/domain-context.test.ts` (9)

The cockpit had no persona concept. It now sends `domain_context` on every summon —
`axim-core`, `robotics-lab`, `speedreport-network`, `axim-academy` — and the HUD only
ever sends an **id**.

The wording lives server-side in `DOMAIN_CONTEXT_PREAMBLES`, applied by
`promptFromSummonPayload`, which previously forwarded `payload.message` untouched:
without that change the switcher moved a dropdown and changed nothing, because the
DeepSeek/Anthropic fallback never saw a persona. Lookup is
`Object.prototype.hasOwnProperty` guarded — `"toString" in {}` is true and the payload is
caller-controlled, so an unguarded `in` would accept `domain_context: "constructor"`.
Two properties are pinned by tests: the SpeedReport persona must stay white-label, and the
Robotics persona must not discuss CAD/BOM.

The Core path is untouched: `payload` (including `domain_context`) is forwarded to
`CORE_INGEST_URL` exactly as before.

**Demonstrated failing before the fix** (persona application removed, test run):
`Tests  3 failed | 6 passed (9)` — including
`sends the persona preamble down the DeepSeek fallback path`.

---

## 6. Phase 1 remediation — failover backoff and a message that survives the catch

**Files:** `src/lib/backoff.js` (1–36), `src/components/hud/ChatInterface.jsx` (27–75, 121–131)
**Proving test:** `src/lib/__tests__/backoff.test.js` (7), ChatInterface suite (5)

The summon retry loop slept a flat 2000 ms. It now uses `nextRetryDelay`: 1s → 2s → 4s
→ 8s → 16s, clamped to 30s, with jitter, one shared implementation also used by the DLQ
poller. The test asserts nothing fires at 900 ms and the first retry lands after ~1 s.

Second defect in the same function: every classified failure (429, 401/403, exhausted
failover) was immediately overwritten by the catch block's generic *"Stream failed.
Attempting reconnect without refresh…"*, so an auth failure told the operator to wait for
a reconnect that could never succeed. The catch now defers to the classified message.

Phase 1's other two items were already in the tree and were verified rather than
rewritten: `ErrorBoundary` wraps the app and both panels in `src/main.jsx` / `src/App.jsx`,
and `SystemSidebar` already renders the three-state stream badge
(`ONLINE` / `RECONNECTING` / `OFFLINE`) plus the `RECONNECT NEEDED` voice state.

---

## 7. Test harness (net new)

The HUD had no JavaScript test runner at all — `tests/` contained one Python parity
script. Added `vitest` + `jsdom` + `@testing-library/react` with:

- `vite.config.js` — `test` block, `environment: 'node'` by default with
  `// @vitest-environment jsdom` opted into per suite (jsdom start-up dominated the run
  otherwise), `fileParallelism: false` (two cores), shared setup file.
- `src/test/setup.js` — `scrollIntoView` / `matchMedia` shims.
- `package.json` — `"test": "vitest run"`.

All suites import the real modules; none re-declare logic inline.

---

## Verification runs (this session, in order)

```
$ cd rust && cargo fmt --all -- --check                       # exit 0, no output
$ npx vitest run                                             # root HUD suite
  Test Files  7 passed (7)
       Tests  49 passed (49)
$ npx vite build                                             # 26.2s
  rust/crates/onyx/static/assets/index-2CSI7Ry0.js   224.99 kB │ gzip: 69.70 kB
  rust/crates/onyx/static/assets/index-BKVYMyrj.css   20.06 kB │ gzip:  4.88 kB
$ cd edge-bridge && npm test
  Test Files  6 passed (6)
       Tests  71 passed (71)          # 62 existing + 9 new
$ cd edge-bridge && npm run build                            # typegen + tsc --noEmit, exit 0
$ cd edge-bridge && npx wrangler deploy --dry-run --config wrangler.jsonc
  Total Upload: 115.77 KiB / gzip: 20.82 KiB
  --dry-run: exiting now.
```

## Not verified — read this before merging

**The Rust workspace was not compiled in this sandbox, and that is an environment
limitation, not a green result.** There is no C toolchain here: no `cc`, no `clang`, no
`gcc`, no glibc development files (`/usr/include/stdio.h` and
`/usr/lib/x86_64-linux-gnu/crt1.o` are both absent), so `cargo clippy --workspace` fails
at `libc`'s build script with `error: linker `cc` not found`.

Workarounds attempted and their limits, so the next session does not repeat them:

| Attempt | Result |
|---|---|
| Zig 0.14.1 as `cc` (`zig cc -c`) | **works** for compiling C to objects (`aws-lc-sys`, `ring`, `sqlite3` built) |
| Zig as the **linker** | **hangs** — `zig cc t.o -o t.out` sleeps on a futex indefinitely, both `-target x86_64-linux-gnu` and `-musl` |
| `rustup target add x86_64-unknown-linux-musl` + `rust-lld` | works for pure-Rust links; cannot link `libssl`, which this workspace needs |
| `cmake`/`ninja` from the PyPI wheels into `/tmp/pytools` | works; `aws-lc-sys` builds |
| `libssl-dev` 3.0.17 extracted from the Debian 12 pool | headers + `libssl.so.3` symlinks available, but a *glibc* library cannot be linked into the musl target, and the gnu target needs a linker that zig cannot provide |

`cargo clippy -p plugins --all-targets -- -D warnings` was run because `plugins` is the
only crate in the workspace that does not pull `reqwest` → `native-tls` → `openssl-sys`.

**No Rust source changed on this branch**, which bounds the exposure: `cargo fmt` is
green, and Rust CI (which has `libssl-dev`) remains the authority for clippy and the
96 tool / 441 runtime test counts.

**Phase 4 (embedded daemon via `rust-embed`) was deliberately not attempted** for the
same reason — untestable Rust is not shippable Rust. See `WEB_APP_DEVELOPMENT_PLAN.md`.
