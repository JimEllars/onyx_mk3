# 2026-11-06 — Routes no caller could reach, and a bundle the daemon could not serve

Branch `fix/onyx-unreachable-routes-and-bundle-drift`, base `05749b8`.

Three defects of the same shape — a route or asset that looks healthy in source
and cannot work at runtime — plus the two dependency/build chores that were
holding the embedded daemon's HUD out of date.

---

## 1. Every cockpit POST was answered by the gate, not the handler

`_fetch` declares the global HMAC gate ("Strict HMAC Validation for
payload-mutating requests") after most of the route table. The gate demands
`X-Axim-Signature`, an HMAC over the raw body keyed with `AXIM_INTERNAL_KEY`:

```
edge-bridge/src/index.ts:2321  if (!sigOk) { ... 401 "Missing x-axim-signature header" ... }
```

A browser cannot produce that digest and must never be given the key. The two
mutating calls the HUD actually makes — `src/lib/hitlDecision.js` →
`POST /api/v1/hitl/action`, and `src/components/hud/PlaybookTrigger.jsx` →
`POST /api/v1/playbook/trigger` — send an operator Passport bearer and nothing
else, so both were refused before `checkAuth()` in the handler ever ran.

Proven against the worker, pre-fix (bearer only, no signature):

```
HITL      status 401 Missing x-axim-signature header
PLAYBOOK  status 401 Missing x-axim-signature header
DISPATCH  status 401 Missing x-axim-signature header
```

The existing handler tests did not catch it because they sign with
`AXIM_INTERNAL_KEY` (`test/phase-b-hardening.test.ts:123`), i.e. they exercise
the server-to-server path only.

**Fix.** `edge-bridge/src/operatorAuthRoutes.ts` (new, 85 lines) is a registry
of mutating routes whose handler authenticates the caller itself. The gate
consults it when the signature check fails: a registered route is authenticated
with `checkAuth()` at the gate and then re-checked in its handler; every other
mutating route keeps the old HMAC-only behaviour byte for byte. Lookup is exact
path + method, so a nested path cannot inherit the exemption.

```ts
// index.ts, gate block
const operatorRoute = findOperatorAuthRoute(request.method, url.pathname);
if (operatorRoute) {
  const authError = await checkAuth(request, env, requiresSuperUser(operatorRoute));
  if (authError) return authError;
} else {
  return new Response(/* unchanged 401/403 body */);
}
```

Registered today: `/api/v1/hitl/action` (POST, super-admin) and
`/api/v1/playbook/trigger` (POST, super-admin). Entries carry the `checkAuth`
snippet they depend on; `test/operator-auth-routes.test.ts` parses `index.ts`
and fails if the call is deleted, if the entry is stale, or if the declared flag
does not match the handler's.

## 2. `/api/v1/tasks/dispatch` and `/api/v1/commands/dispatch` required two signatures from one header

Both handlers re-verified the same `X-Axim-Signature` header against
`AXIM_ONYX_SECRET` after the gate had already verified it against
`AXIM_INTERNAL_KEY`. One digest cannot match two different keys, so every
dispatch — including one carrying both keys — answered 401:

```
commands/dispatch 401 {"error":"Unauthorized"}
tasks/dispatch    401 {"error":"Unauthorized Signature"}
```

`/api/v1/ecosystem/event` had the same defect and was fixed on 2026-11-03. The
same fix applied here: the gate's credential is the credential, the redundant
re-verification is gone, and `/commands/dispatch` still requires the super-admin
bearer.

## 3. `/api/v1/tasks/dispatch` asked Core for a URL that does not exist

Found while proving §2. The handler derived its target with

```ts
env.CORE_INGEST_URL.replace(/\/v1\/commands\/dispatch$/, "")   // suffix never present
  + "/api/v1/tasks/execute"
```

`CORE_INGEST_URL` names an ingest path (`.../functions/v1/telemetry-ingress`),
so the request went to `.../telemetry-ingress/api/v1/tasks/execute`. The other
two dispatch handlers already used the origin. All three now share
`coreTaskExecuteUrl(base)` in `index.ts:346`.

## 4. The embedded HUD bundle was stale, and nothing checked it

`onyx daemon` serves `rust/crates/onyx/static` from inside the binary. A fresh
`npx vite build` on `05749b8` replaced the committed
`assets/index-CllMSb_c.js` (481,695 B, 258 lines, unminified) with
`assets/index-Cz7yW5cY.js` (263,143 B, 24 lines, minified). Feature markers are
identical in both (`dlq-status` ×5, `axim_passport_token` ×11, `RECONNECTING`
×5); the committed file was simply a build artefact from a different mode.
Regenerated and committed.

`web-ci.yml` now fails when `vite build` leaves `rust/crates/onyx/static`
dirty — the check and the regeneration land together, which is what
`WEB_APP_DEVELOPMENT_PLAN.md` said was required for the check to be honest.

## 5. Tailwind v4 plugin skew removed

`@tailwindcss/postcss` ^4.3.3 was a devDependency that nothing referenced —
`postcss.config.js` drives the v3 `tailwindcss` plugin. Dropped from
`package.json`; lockfile regenerated (−687 lines, all transitive to the v4
plugin). A rebuild after removal produced a byte-identical bundle hash
(`af10f8a7…` JS, `b1a211ae…` CSS), which is the proof it was inert.

## 6. `npm run build` under `NODE_ENV=production`

The root script runs `npm ci`, which omits devDependencies when
`NODE_ENV=production` is set in the environment (containers, prod boxes), and
then dies with `sh: 1: vite: not found`. Both installs now pass
`--include=dev`.

---

## Verification

Sandbox: `cargo` present, but **no C toolchain, no `pkg-config`, no
`libssl-dev`**, so `cargo clippy`/`cargo test` cannot run here
(`openssl-sys` fails at build-script time). No Rust source was changed. CI is
the compiler of record — `rust-ci.yml` triggers on `rust/**`, and the
regenerated bundle lives under `rust/`, so this PR gets the full
`cargo fmt` / `clippy -D warnings` / `cargo test --workspace` run.

Local, Rust:

```
$ cargo fmt --all -- --check
FMT_EXIT=0
```

Local, edge bridge (`edge-bridge/`):

```
$ npm run typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run
 Test Files  15 passed (15)
      Tests  177 passed (177)

$ npm run deploy:dry-run
Total Upload: 119.83 KiB / gzip: 22.31 KiB
--dry-run: exiting now.
DRYRUN_EXIT=0
```

The new suites fail on the pre-fix tree and pass after — checked by stashing
`edge-bridge/src/index.ts` and re-running:

```
$ git stash push -q src/index.ts && npx vitest run test/single-credential.test.ts test/operator-auth-routes.test.ts
     × accepts a super-admin bearer with no signature and reaches the handler
     × accepts a super-admin bearer with no signature
     × still rejects a playbook name that is not on the allow list
     × is reachable with the signature the gate verifies
     × is reachable with the gate signature plus a super-admin bearer
     × still refuses a payload with no task
      Tests  6 failed | 10 passed (16)
$ git stash pop -q && npx vitest run test/single-credential.test.ts test/operator-auth-routes.test.ts
      Tests  16 passed (16)
```

Local, HUD (repo root):

```
$ npx vitest run
 Test Files  7 passed (7)
      Tests  49 passed (49)

$ npx vite build
rust/crates/onyx/static/index.html                   3.01 kB
rust/crates/onyx/static/assets/index-BKVYMyrj.css   21.00 kB │ gzip:  5.07 kB
rust/crates/onyx/static/assets/index-Cz7yW5cY.js   263.14 kB │ gzip: 81.26 kB
✓ built in 22.18s
```

Bundle hashes are stable across three consecutive builds before and after the
dependency removal, so the CI drift check is not flaky in this environment.

## Files

| File | Change |
|---|---|
| `edge-bridge/src/operatorAuthRoutes.ts` | new, 85 lines — registry + `findOperatorAuthRoute`, `requiresSuperUser` |
| `edge-bridge/src/index.ts` | +1 import; gate consults the registry (2,321-2,352); `coreTaskExecuteUrl()` helper (346-356); `/tasks/dispatch` redundant re-verify and URL derivation (2,727-2,752); `/playbook/trigger` target (2,791); `/commands/dispatch` redundant re-verify (2,812-2,825) |
| `edge-bridge/src/preGateRoutes.ts` | doc: distinguishes this registry from `operatorAuthRoutes.ts` |
| `edge-bridge/test/operator-auth-routes.test.ts` | new, 306 lines, 11 tests |
| `edge-bridge/test/single-credential.test.ts` | new, 165 lines, 5 tests |
| `.github/workflows/web-ci.yml` | embedded-bundle drift check after `vite build` |
| `package.json` / `package-lock.json` | drop unused `@tailwindcss/postcss`; `npm ci --include=dev` in `build` |
| `rust/crates/onyx/static/` | regenerated `index.html` + `assets/index-Cz7yW5cY.js`, removed `index-CllMSb_c.js` |

## Still open (unchanged today)

- `classifyPreGateRoute()` is still documentation-only; the gate still sits
  mid-chain and pre-gate routes still rely on positional ordering (`WEB_APP`
  item 4). The registry added today covers the opposite case — routes below the
  gate whose caller cannot sign.
- `onyx_command_audit_logs` still has no writer.
- Golden-image / `cargo update` work on the Rust advisory backlog still needs an
  environment with a C toolchain.
