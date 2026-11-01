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
