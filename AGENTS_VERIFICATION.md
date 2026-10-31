# Verification Log - Sprint 8.1

### Step 1 & 2: HMAC Signatures & DLQ Replay
**Files Modified:**
- `rust/crates/commands/src/actions/axim_core_relay.rs`
- `rust/crates/telemetry/src/dlq.rs`
**Changes:**
- Configured a 5-second `reqwest` timeout.
- Used `ring::hmac` to implement the `sha256=` signed header.
- Implemented `.claw/unsynced_relays.jsonl` queueing on HTTP or network failures.
- Hooked `.claw/unsynced_relays.jsonl` into the background `start_dlq_drain_loop` in telemetry crate for retry.
**Verification:**
- `cargo fmt --all -- --check` passed.
- `cargo clippy --workspace --all-targets -- -D warnings` passed.
- `cargo test --workspace` passed.

### Step 3: PHP2Shell & CGI Exploits Hardening
**Files Modified:**
- `edge-bridge/src/index.ts`
**Changes:**
- Injected specific URL and search param filters at the top of the main `fetch` handler.
- Explicitly blocked PHP variants (CVEs via `?-d`, `auto_prepend_file`, `disable_functions`, etc).
- Blocked `xmlrpc.php`, `wp-login.php`, and `wp-admin`.
**Verification:**
- `cd edge-bridge && npm run typecheck` passed cleanly.

### Step 4: SSRF Defense
**Files Modified:**
- `rust/crates/commands/src/extensions/contact_scraper.rs`
**Changes:**
- Processed the target host using the `url` crate.
- Blocked port numbers 6543, 5432, 8080, and 9000.
- Resolved IPs via `ToSocketAddrs` and blocked `is_loopback()`, `is_private()`, and `is_link_local()`.
**Verification:**
- `cargo test --workspace` passed.
- `cargo clippy --workspace --all-targets -- -D warnings` passed.

### Step 5: Robotics Lab MCP Tools
**Files Modified:**
- `rust/crates/tools/src/lib.rs`
**Changes:**
- Appended `robot_create_project`, `robot_spawn_sim`, `robot_evaluate_policy`, `robot_deploy_ota`, and `robot_emergency_stop` schemas to `mvp_tool_specs()`.
- Standardized `RequiredPermissions` (`PermissionMode::Destructive` originally but mapped to `PermissionMode::Prompt` to match the enum definitions).
**Verification:**
- `cargo clippy --workspace --all-targets -- -D warnings` passed.
- `cargo test --workspace` passed.

---

# Verification Log — Phase A: Edge Bridge Containment (2026-10-31)

**Branch:** `fix/onyx-phase-a-edge-hardening`
**Base:** `6baaaef` (main, post-PR #286)
**Scope:** `edge-bridge/` only. Rust workspace untouched (no `cargo` in the authoring environment — see "Not verified").

Every change below has a test in `edge-bridge/test/phase-a-hardening.test.ts`
that **failed against `6baaaef` and passes after**. Proof of that is recorded at
the end of this section.

## A1 — Secret reflected to callers (`index.ts:1358-1404`)

**Change.** Removed `"Authorization": \`Bearer ${env.AXIM_ONYX_SECRET}\`` from the
three responses of `/api/v1/onyx/emergency-direct` (the 401, 403 and 200 branches).
Any holder of `ONYX_EMERGENCY_SECRET` could send a wrong bearer, receive the master
Onyx secret in the response header, and then use it as a super-user credential
(`checkAuth` → `isInternalService`).

**Proving tests.** `emergency-direct 401 does not return AXIM_ONYX_SECRET in a header`,
`emergency-direct 403 does not return AXIM_ONYX_SECRET in a header`.

**Note.** Eight further occurrences of that header literal remain, all on *outbound*
requests to Core (`:1042, 1454, 2080, 2212, 2253, 2300, 2837, 3019`). Those are
legitimate server-to-server auth and were deliberately left intact.

**Operator action required: rotate `AXIM_ONYX_SECRET`.** Treat it as disclosed.

## A2 — Mock Passport session mint deleted (`index.ts:1903-1999`, `:27-41`)

**Change.** Removed the `/api/v1/passport/verify` branch — `atob` + `JSON.parse` of an
unsigned blob, `isWhitelistedWallet = !!wallet`, the `test_jrellars` /
`test_jamesellars` / `test_wallet` bypass tokens, and the hardcoded
`mock_supabase_access_token` it returned. Also removed `parsePassportSession`, which
was defined, never called, and would have trusted a client-supplied `role` from a
plain JSON cookie. `verifyPassportJwt` in `passport.ts` is now the only path.

**Proving tests.** `POST /api/v1/passport/verify no longer exists, even with a valid
signature` (404, no `access_token` in body); `the dev bypass tokens no longer appear
in the source`.

## A3 — Telemetry routes authenticated (`index.ts:985-1019`, `:1223-1231`)

**Change.** `/functions/v1/telemetry-ingress` and `/api/v1/telemetry/flush` both sit
*before* the global HMAC gate in the route chain, so they had no authentication.
Ingress accepted anonymous writes to `onyx_telemetry_logs` and forwarded them to Core
with the master secret; flush let anyone force an outbound replay of up to 100 rows
and have them marked synced. Both now require a valid HMAC over the raw body
(`AXIM_INTERNAL_KEY`) or a service/Passport credential.

**Proving tests.** `... rejects an anonymous caller` (×2, expect 401);
`... accepts a valid HMAC` (ingress, not 401).

**Breaking change.** Any external telemetry producer posting to these routes without
a signature or service bearer will now receive 401. Callers must add
`X-Axim-Signature: sha256=<hex HMAC of the raw body>` or a service bearer.

## A3b — Malformed Core ingest URL (`wrangler.jsonc:33`, `index.ts:74-85`)

**Change.** `CORE_INGEST_URL` was `https://api.axim.us.com/v1/functions/telemetry-ingest`,
and the handlers appended `/functions/v1/telemetry-ingress`, producing a path that
does not exist on either side. Added `resolveIngestUrl()` which accepts a bare origin or
a fully-qualified ingest path, and corrected the var to Core's documented route
`https://api.axim.us.com/telemetry`.

## A3c — `/api/v1/ecosystem/event` was unreachable by construction (`index.ts:2607-2620`)

**Change.** The global gate verifies `X-Axim-Signature` with `AXIM_INTERNAL_KEY`; the
route then re-verified the *same header* against `AXIM_ONYX_SECRET`. A caller would
have needed one signature valid under two different keys, so no client — including
Core's `onyx-bridge` relay — could ever satisfy it. Removed the redundant second
check; authentication remains the gate's responsibility and its coverage is unchanged.

## A4 — Missing KV bindings fail loudly (`index.ts:86-116`, `:1162-1166`, `:2478-2482`, `:2607-2611`)

**Change.** `HITL_APPROVAL_KV`, `EDGE_DLQ_KV` and `ECOSYSTEM_METRICS_KV` are declared
optional in `Env` but absent from `wrangler.jsonc`. Handlers silently skipped their
writes and still answered `200 {success:true}` / `202 {status:"ingested"}` /
`dlq-status: 0`. Added `missingBinding()` and applied it so these now return **503**
with the binding name.

**Proving tests.** `dlq-status returns 503 rather than zeroes`,
`mcp/execute returns 503 rather than success` (also asserts no `"success":true`),
`ecosystem/event returns 503 rather than a 202 drop`.

**Not done:** declaring the namespaces. That requires `wrangler kv namespace create`
and real IDs — an operator action, not a code change. Until then these three features
are correctly reported as unavailable rather than falsely reported as working.

## A5 — Stale build artifact removed

**Change.** `git rm -r edge-bridge/dist` (it still contained the `test_jrellars`
bypass) and added `dist/` to `edge-bridge/.gitignore`. `wrangler.jsonc` already
deployed `src/index.ts`, so nothing that runs is affected.

## A6 — Constant-time HMAC at the global gate (`index.ts:1745-1766`, `:561-608`)

**Change.** The gate used `verifyAximSignature`, which hex-encoded the expected digest
and compared with `!==` in two branches — short-circuiting on the first differing byte
and leaking the digest by timing. The gate now calls the existing
`verifyHmacSignature`, which hex-validates and uses `crypto.subtle.verify`
(constant-time) over the raw body. `verifyAximSignature` was deleted so no second,
weaker path remains. Missing header still 401, invalid 403, and both the bare-hex and
`sha256=`-prefixed forms are still accepted.

**Proving tests.** missing → 401; forged → 403; malformed → 403; both prefix forms
accepted; `verifyAximSignature` absent from source.

**Discovery while testing (not fixed, recorded).** The gate sits mid-chain, so it only
covers routes declared *after* it. Routes before it — `/functions/v1/telemetry-ingress`,
`/api/v1/dlq-drain`, `/api/v1/telemetry/dlq-status`, `/api/v1/telemetry/flush`,
`/api/v1/onyx/emergency-direct`, `/api/v1/onyx/summon`, the two health proxies,
`/api/v1/generate/nda` — rely entirely on their own auth. After A3 that is true for all
of them, but the ordering is fragile: a new route added in the wrong place gets no gate
and no warning. Replacing the if/else chain with a route table carrying an explicit
`{ hmac, auth }` per route is the durable fix (Phase B).

## Commands and results

```
cd edge-bridge
npm install --legacy-peer-deps     # repo pins vitest@5 but the cloudflare pool peer-needs vitest@4;
                                   # web-ci.yml:44 already uses --legacy-peer-deps. Pre-existing.
npx tsc --noEmit                   # exit 0, no diagnostics
npx vitest run                     # Test Files 3 passed | Tests 23 passed
npx wrangler deploy --dry-run      # exits cleanly, config valid
```

## Proof that the new tests fail on the old code

The 15 new tests were run against `6baaaef` with only `src/index.ts` and
`wrangler.jsonc` reverted:

```
Test Files  1 failed (1)
     Tests  11 failed | 4 passed (15)
```

The 11 failures map to A1 (×2), A2 (×2), A3 (×2), A4 (×3), A6 (×2). The 4 that pass
on the old code are deliberate regression guards (a missing signature and a forged
signature were already rejected; a valid HMAC was already accepted because *everything*
was accepted).

## Not verified

- **Rust workspace.** No `cargo` in the authoring environment, and no Rust file was
  touched by this change. The Sprint 8.1 claims above (`clippy -- -D warnings`) are
  contradicted by `Cargo.toml:21-26` (`level = "warn"`) and by
  `.github/workflows/rust-ci.yml:104` running bare `cargo clippy`; they are left in
  place as a historical log but should not be relied on.
- **Deployed runtime behaviour.** All evidence is from `workerd`-equivalent local runs
  (plain Node + vitest). The tests do not use `@cloudflare/vitest-pool-workers`, so KV,
  D1 and `request.cf` are still absent in tests; binding behaviour is inferred from
  guards, not exercised.

---

# Verification Log — Phase B: Decision Path & Operator Auth (2026-10-31)

**Branch:** `fix/onyx-phase-b-hitl-and-chat-auth`
**Base:** `e559a3c` (Phase A tip; Phase A is still unmerged, so this branch stacks on it)
**Scope:** `edge-bridge/` only.

Every change has a test in `edge-bridge/test/phase-b-hardening.test.ts` that **failed
against `e559a3c`**; the failure list is at the end.

## B1 — The cockpit can authenticate (`index.ts`, `/api/v1/onyx/summon`)

**Before.** The route required a valid HMAC over the body with `ONYX_CLIENT_SECRET`
**and** `Authorization: Bearer ${ONYX_CLIENT_SECRET}` **or** an `axim_session` cookie
whose value was never validated. `ChatInterface.jsx:24-31` sends
`Bearer <passport JWT>`, so every message 401'd. The only way to satisfy the old
contract was to ship a server secret in the browser bundle.

**After.** Machine callers still sign with `ONYX_CLIENT_SECRET`. Operators authenticate
with `checkAuth` (Passport JWT, or a service bearer). The presence-only cookie path is
removed — an unverified cookie is not a credential.

**Also removed.** The unreachable duplicate `/api/v1/onyx/summon` handler (~1.8 KB) that
sat after the global gate with weaker bearer-only auth. It was dead because the first
branch matched; one reordering would have made it live.

**Tests.** `accepts a service bearer without an HMAC`, `still rejects a caller with no
credential`, `no longer trusts a presence-only session cookie`.

## B3 — One HITL decision path, relayed to Core (`index.ts`)

**Before.** Two mechanisms, neither effective:

| Path | Behaviour |
|---|---|
| `POST /api/v1/mcp/execute` | wrote `action_decision:<id>` to KV, returned `{success:true}`; **nothing reads that key** |
| `GET /api/v1/hitl/action?token=&decision=` | state-changing GET, decision in the query string, no auth; comment: *"Ideally route this back to Rust runtime, here just update KV"* |

**After.**

- `POST /api/v1/hitl/action` — `checkAuth(…, requireSuperUser)`; body
  `{ action_id, decision, operator_notes? }`; `decision` normalised through an allowlist
  (`approve|approved` → `Approved`, `reject|rejected|deny|denied` → `Rejected`);
  records `actor` + `decided_at` in KV (best effort) and **relays to Core's
  `resolve-hitl`** with `{log_id, status, action_payload}`.
- `GET /api/v1/hitl/action` with a `decision` param → **405** with `Allow: POST`.
  Without one, it is a read-only ticket view.
- `POST /api/v1/mcp/execute` now calls the same `applyHitlDecision` helper.

**Response contract.** `applied` is true only when Core accepts the decision.
`200` applied · `502` Core rejected · `503` relay not configured. `recorded` and
`reason` are always present so an operator can tell "saved but not applied" from
"failed".

**New configuration.** `CORE_HITL_URL` (added to `wrangler.jsonc`, pointing at the
Core project's `resolve-hitl`), `CORE_SUPABASE_URL` (fallback for deriving the URL), and
`CORE_SERVICE_ROLE_KEY` (secret, must be set by an operator).

**Tests.** unauthenticated → 401; GET with decision → 405; unknown decision → 400;
no relay → 503 `applied:false` + local record written; Core 200 → 200 `applied:true`
with the exact URL/header/body asserted; Core 500 → 502 `applied:false`.

**Changed A4 assertion.** The Phase A test `mcp/execute returns 503 rather than success
when HITL_APPROVAL_KV is absent` was replaced with
`mcp/execute never reports success when the decision cannot be applied`. Decisions no
longer depend on KV — Core is the source of truth — so asserting that a missing binding
503s was asserting the wrong contract. The new assertion still forbids `success:true`
without an applied decision.

## B5 — One administrator role, all spellings (`passport.ts:18-36, 118-125`)

**Before.** `isSuperAdmin` required `app_metadata.role === "super-admin"` exactly.
The cockpit wrote `super_admin` to its store and Core's `AuthContext.jsx:121` issues
`super_user`, so a real token would have been treated as a normal user and every
privileged route would 403 while tests passed.

**After.** `SUPER_ADMIN_ROLES` accepts `super-admin`, `super_admin`, `superadmin`,
`super_user`, `superuser` from either `app_metadata.role` or a top-level `role` claim.

**Tests.** four accepted spellings, plus normal-user and missing-role rejection.

## B6 — Swarm state requires a credential (`index.ts`, `/api/v1/onyx/swarm-state`)

Anonymous callers could enumerate every dispatch lock. Now `checkAuth`.

**Test.** anonymous → 401.

## B7 — Deny list decodes before matching (`index.ts`, `cgiGuard`)

**Before.** Three copies of a substring check over `url.search` / `url.pathname` from
`new URL()`, which is normalised but **not** percent-decoded. `/?%61uto_prepend_file=x`
passed. The traversal clauses were dead for single-encoded input (the parser resolves
`%2e%2e` first). The third copy sat inside the 429 logger, unreachable, and would have
returned a response that skipped the Analytics write.

**After.** One `cgiGuard()`: decode path and query twice (defeating double-encoding),
then match `[?&]-d`, the five CGI keywords, a traversal regex, and
`\.php(/|$)|/wp-admin|/wp-login.php|xmlrpc.php`. The two live copies call it; the dead
third copy is deleted.

**Tests.** nine bypass vectors (encoded name, encoded `-d`, encoded underscore,
double-encoded traversal, path-info `.php`, wp-admin, xmlrpc) all 403; a plain
`../` path is 404 because the URL parser already neutralised it (asserted as
`[403,404]`, never served); `/health` still 200.

## Commands and results

```
cd edge-bridge
npx tsc --noEmit                      # exit 0
npx vitest run                        # 4 files, 48 tests, all pass
npx wrangler deploy --dry-run         # valid; CORE_INGEST_URL + CORE_HITL_URL present
```

## Proof that the new tests fail on the Phase A head

`test/phase-b-hardening.test.ts` run against `e559a3c` with `src/index.ts` and
`src/passport.ts` reverted:

```
Test Files  1 failed (1)
     Tests  16 failed | 9 passed (25)
```

The 16 failures cover B1 (×2), B3 (×5), B5 (×3), B6 (×1), B7 (×5). The 9 that pass are
regression guards for behaviour that was already correct (anonymous summon rejection,
anonymous decision rejection, plain CGI names, `/health`).

## Operator actions required

1. `wrangler secret put CORE_SERVICE_ROLE_KEY` — the Core project's service-role key.
   Until it is set, every decision returns `503 applied:false` with
   `reason: "CORE_SERVICE_ROLE_KEY is not configured"`. That is deliberate: the edge
   will not claim an approval it cannot apply.
2. Merge Phase A (`e559a3c`) before or with this branch — this stacks on it.

## Deliberately not in this change

- **B2 `X-Axim-Timestamp`.** Spans `rust/` and `axim-core-v1.2`; needs a coordinated
  release or a dual-accept window. Separate change.
- **B4 route-table refactor.** Replacing the 30-branch `if/else` chain is a mechanical
  refactor over 3,300 lines. It should not ride along with security fixes. The gate
  ordering hazard it addresses is documented in the Phase A appendix.
- **B8 workers test pool.** `@cloudflare/vitest-pool-workers` is installed but the repo
  pins vitest 5 against a peer of vitest 4; migrating needs a dependency decision first.
  Until then KV/D1 behaviour is asserted through guards and fakes, not `workerd`.
