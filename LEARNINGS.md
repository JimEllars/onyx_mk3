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
