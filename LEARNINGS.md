## Edge Bridge and Rust Core Synchronization
When adding cross-service telemetry and resilient fallback states, ensuring deep synchronization between Edge environments (Cloudflare Workers) and the inner Daemon is critical.
1. `GET /health` and `GET /ready` act as fundamental uptime checkpoints to verify upstream dependencies seamlessly.
2. In `edge-bridge/src/index.ts`, logging should strip credentials and output structured JSON, mapping directly to analytics workflows.
3. Fallback logic within Cloudflare isolates external outages while retaining data transparency (`code: "502" | "504"` for context mapping inside `emailDispatchManager.ts`).
4. In `rust/crates/api/src/client.rs`, errors from Edge/Providers shouldn't halt the user instance logic or lock TUI frames. Utilizing structured map_err boundaries and logging asynchronous SQLite records ensures observability without UI friction.
5. In integration tests like `mock-anthropic-service/tests/scenario.rs`, you must replicate the entire mock environment explicitly (e.g. `DEEPSEEK_API_KEY` for the default internal model wrapper fallback) so CI tests won't flake across developers who haven't populated `.env`.

## Additions — 2026-11-01 session (HUD / edge bridge)

6. **A UI permission check is only correct if it parses the token the issuer actually
   mints.** `useAximAuth` read `app_metadata.SUPER_ADMIN_ROLES`, a claim nobody issues, and
   referenced an undeclared `role`, so every real Passport token threw before the role was
   ever compared. Read `edge-bridge/src/passport.ts` (`adminRoleFrom`) and mirror it —
   `app_metadata.role` or `role`, lower-cased, `super_admin` authoritative with the legacy
   spellings reported. Deny on a parse failure; never let the throw escape the auth effect.

7. **`recorded` is not `applied`.** `POST /api/v1/hitl/action` returns 200 only when Core
   accepted the decision; 502/503 mean it is in `HITL_APPROVAL_KV` and nothing resumed.
   Collapsing both into `response.ok ? success : failure` hides the state that needs an
   operator retry. Carry `applied`, `recorded`, `core_status` and `reason` into the UI.

8. **A control the backend ignores is worse than no control.** The persona dropdown would
   have been decorative: the edge's provider fallback forwarded `payload.message` only.
   Whatever the cockpit sends must be *read* somewhere downstream, and the allow-list
   belongs server-side so a browser cannot inject a system prompt. Use
   `Object.prototype.hasOwnProperty`, not `in` — `"toString" in {}` is true and the payload
   is caller-controlled.

9. **Syntax-check the whole tree after a batch of edits.** A single missing backtick in a
   template literal (`` `${base}/api/v1/...` ``) produced `PARSE_ERROR` pointing at a line 17
   lines below the actual mistake, and cost three full test runs to find. `node -e` with
   `@babel/parser` over `find src -name '*.jsx' -o -name '*.js'` takes two seconds.

10. **Vitest on two cores: default to the node environment.** `environment: 'jsdom'` for
    every suite spent 115 s of a 158 s run creating jsdom. `environment: 'node'` plus a
    `// @vitest-environment jsdom` docblock in the RTL suites, `fileParallelism: false`,
    and a shared `setupFiles` for `scrollIntoView`/`matchMedia` shims cut the run to ~50 s.

11. **Sandbox Rust recipe (this image has no C toolchain, no glibc headers).** For the next
    session, before spending an hour:
    - `zig cc -c file.c` works; **`zig cc` linking hangs** on a futex (both gnu and musl
      targets) — it cannot be used as a linker.
    - `rustup target add x86_64-unknown-linux-musl` + `CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=<toolchain>/lib/rustlib/x86_64-unknown-linux-gnu/bin/rust-lld`
      links pure-Rust binaries without a system linker.
    - `aws-lc-sys` needs `cmake` + `ninja`: `python3 -m pip install --break-system-packages --target=/tmp/pytools cmake ninja`.
    - `openssl-sys` needs headers: extract `libssl-dev` from the Debian 12 pool (`ar` +
      `lzma` in Python, no `ar`/`xz` binary needed) and point `OPENSSL_DIR` at it.
    - Even with all of that, `reqwest`+`native-tls` for the **musl** target cannot link a
      glibc `libssl`, so the `commands`/`runtime`/`telemetry`/`onyx` crates stay
      unverifiable here. `plugins` is the only crate with no `reqwest`, and therefore the
      only one that can be linted or tested in-sandbox.

12. **Check which clippy gate CI actually uses before "fixing" a lint failure.**
    `rust-ci.yml` runs `cargo clippy --workspace` with **no** `-D warnings`; the runbook's
    stricter form turns clippy 1.99's new `assert_is_empty` warnings in
    `crates/plugins/src/lib.rs` into errors that CI does not care about. Confirm the gate
    before editing Rust you cannot compile.

13. **Test a cron branch against the cron strings that are actually deployed.** The
    `scheduled()` handler compared `controller.cron === "0 12 * * *"` while
    `wrangler.jsonc` deploys `0 0 * * *` and `*/5 * * * *`. Nothing throws when the literal
    never matches — the work is simply skipped forever, and the cron string lives in a
    different file from the code that reads it. Prefer a set/predicate (`isDailyCron`) over
    exact equality, and read `wrangler.jsonc` before trusting any schedule comment.

14. **Edge D1 columns do not share an epoch.** `onyx_telemetry_logs.created_at` is written
    with `Date.now()` (milliseconds); `onyx_user_sessions.last_seen` and
    `onyx_rate_limit_logs.blocked_at` are written as epoch seconds. One `thirtyDaysAgo`
    variable was bound to both families, which made `created_at < cutoff` true for every row
    and emptied the table on each run. Compute one cutoff per unit, never reuse the variable,
    and assert the magnitude in a test (`> 1e12` for ms, `< 1e11` for s).

15. **Where a statement sits in a handler is part of its behaviour.** The retention `batch()`
    was placed after the closing brace of the daily branch, so it ran on the five-minute tick
    too. Cadence bugs are invisible in the SQL and invisible in the cron config — they are
    only visible in the nesting. Test the cadence, not just the statement.

16. **`*/` inside a block comment ends the comment.** Writing a cron expression like
    `*/5 * * * *` inside `/** ... */` produces `PARSE_ERROR` fifteen lines later and reads
    like a lost brace. Same class of failure as the missing backtick in item 9: cheap parser
    run over the changed files before believing a build error is real. Use line comments, or
    quote the expression as a string.

17. **A stacked PR gets almost no CI in this repo.** `web-ci.yml` and
    `edge-bridge-sync.yml` declare `pull_request: branches: [main]`, so a PR whose base is
    another feature branch runs only `Workers Builds` and GitGuardian. When stacking, the
    suites that would exercise the change (including `npm test` in `edge-bridge`) run for the
    first time only after the base merges and the PR is retargeted. Verify locally and say so
    in the PR body; do not read "green checks" on a stacked PR as coverage of the change.

## Embedded HUD daemon (2026-11-01)

1. `vite.config.js` writes the HUD bundle to `rust/crates/onyx/static` and that directory is
   tracked, so `rust-embed` can point at `#[folder = "static"]` with no `build.rs` staging and
   no risk of a compile error in CI, where no JS toolchain runs before `cargo test`.
2. Enable the `debug-embed` feature, otherwise `rust-embed` reads from the filesystem relative
   to the *current working directory* in debug builds — unit tests then pass or fail depending
   on where `cargo test` was invoked from.
3. The workspace carries **axum 0.7 (`onyx`) and axum 0.8 (`api`) at the same time**. A
   handler from `api::router` cannot be mounted on an `onyx` router; share behaviour through
   plain statics (`DAILY_CRON_RUNS`, `EDGE_HEARTBEAT_INTERCEPTS`) instead of composing routers
   across the version boundary. Aligning both crates on 0.8 is a follow-up.
4. `tui/status_bar.rs` polls `/api/telemetry/summary` on the daemon port, a path only the edge
   worker served. When adding a poller, assert in a test that *some* server in the same
   topology answers the path, or the badge silently stays dark forever.
5. This authoring sandbox has no C toolchain (`cc`/`gcc`/`clang`/`ld` all missing, no `sudo`),
   so `libc`'s build script cannot link and `cargo clippy` / `cargo test` cannot run at all,
   even for `cargo check`. A downloaded Zig 0.17.0 used as `CC`/linker hangs in this container.
   `cargo fmt --check` and `cargo metadata` still work — use them as the local gate and let
   `rust-ci.yml` be the compiler of record. Say so explicitly in `AGENTS_VERIFICATION.md`
   instead of implying the Rust side compiled.

## Chasing a route change to everything that links to it (2026-11-02)

1. **Changing a route's contract is not done when the handler is updated.** Phase B removed
   mutating GET from `/api/v1/hitl/action`, and the daily digest email kept emitting
   `?decision=approve` links for weeks — every button in the operator's briefing answered 405,
   discovered only after the click. Grep the repo for the *old URL shape*, including strings
   built by interpolation in HTML and markdown templates, not just `fetch(` call sites.
2. **A link in an email cannot be an authorisation.** Mail scanners, link previewers and
   browser prefetch all issue GET against every href, so a one-click approve link is an
   unauthenticated mutation that fires without the operator. Emails should deep-link to a
   review surface; the decision goes out as an authenticated POST from that surface.
3. **Escape anything interpolated into an email template.** A HITL ticket's `description`
   originates as a tool-proposal field, so it is attacker-influenced input rendered into a
   message from a trusted internal sender. `escapeHtml` on the text, `encodeURIComponent` on
   the token, and escape the href as well.
4. **Assert link liveness against the real handler.** The digest test builds the markup, pulls
   every `href` out of it with a regex, and dispatches each one at `worker.fetch`. That is the
   only assertion that would have caught the 405: a test that only compares the URL string to
   an expected string passes happily while the route returns an error.
5. **A bare `console.error("error")` in a `catch` costs nothing to add and makes the log
   useless later.** One of them sat at the top of `scheduled()` and ran on every five-minute
   tick, so the worker emitted an error line every five minutes forever and any error-rate
   alert on that worker was noise. Log `{"event": ..., "trace_id": ...}` or nothing.
6. **The append-only index file conflicts on every rebase — by design.** `AGENTS_VERIFICATION.md`
   conflicted a fourth time on 2026-11-02. Resolve it by keeping *both* tables' rows, newest
   last, and never by choosing a side; selecting a side silently drops another change's
   verification record.

## Additions — 2026-11-03 session (pre-gate routes, logging, timing-safe compares)

7. **A `console.error` on the success path is worse than a missing log line.** `fetch()` in
   `edge-bridge/src/index.ts` logged an error and *then* returned the successful response, so
   every request that worked produced an error record. Anything watching error rate had a
   permanent floor and no signal. When converting unlabelled logs, check the control flow
   around each one: 2 of the 34 sites were not errors at all (the 405 branch and the
   idempotent-replay branch) and belonged at info level.

8. **A "checklist with teeth" is how you guard a positional guarantee.** The global HMAC gate
   in `_fetch` only protects routes declared *below* it, so its safety depends on file order —
   which nothing enforces. The fix that fits: register each pre-gate route with its auth mode
   *and* the literal auth call that must remain in its handler, then have a test parse
   `src/index.ts`, find every route literal above a named marker, and fail on any path that is
   not registered. Two rules make it trustworthy:
   - the extraction must **over-capture** (any `"/path"` literal on a line mentioning
     `pathname`), so an unrecognised declaration fails the test rather than slipping past;
   - add a **count floor** (`>= 17`) plus spot-checks, or a broken regex makes the test pass
     by finding nothing.
   Prove both directions before believing it: inject an unregistered route, and delete a real
   `checkAuth` call. Both must fail with a message that names the path.

9. **`crypto.subtle.verify` is the constant-time primitive you already have.** Three call
   sites still signed the body themselves and compared hex with `!==`, which short-circuits at
   the first differing byte. `verifyRequestSignature` had used `crypto.subtle.verify` for
   weeks; the stragglers were in older hand-rolled branches. When you harden one comparison,
   grep for the *shape* (`!== expectedSignature`, `!== expectedToken`) across the whole file,
   not just the family you were already looking at.

10. **A source-scanning test needs whitespace-insensitivity, or prettier breaks it.** Evidence
    needles like `verifyHexHmacSignature(env.GITHUB_WEBHOOK_SECRET` stopped matching the
    moment the call was wrapped across four lines. Compare with all whitespace stripped from
    both sides (`text.replace(/\s+/g, '')`) — line breaks are formatting, not part of the claim.

11. **Tracked build output drifts silently.** `rust/crates/onyx/static/` is committed and
    embedded by `rust-embed`, but `web-ci.yml` builds the HUD and discards the result, so the
    bundle in `main` was one React bump behind `src/` and `onyx daemon` served the old
    runtime. If an artifact is tracked *and* generated, either regenerate it in CI or fail the
    build when regeneration produces a different hash. Check the version strings inside a
    bundle before assuming two hashes mean the same content: `grep -o '19\.[0-9]*\.[0-9]*'`.

12. **This sandbox exports `NODE_ENV=production`, and `npm ci` believes it.** A plain `npm ci`
    installs 4 packages instead of 182 — no `vitest`, no `jsdom` — and the failure surfaces
    later as `ERR_MODULE_NOT_FOUND` from a vitest worker, or as `npx` silently fetching a
    *different* vitest from its cache. Always `NODE_ENV=development npm ci --include=dev`
    here, and invoke `./node_modules/.bin/vitest` rather than `npx vitest` so the run cannot
    pick up the npx cache copy.
