# 2026-11-04 — `cargo clippy -D warnings` is clean, and CI now enforces it

Branch: `fix/onyx-clippy-strict-gate`
Base commit: `22591e2` (main, post-PR #306)
Session: daily 2:35 AM ET run

The runbook's baseline gate is `cargo clippy --workspace --all-targets -- -D warnings`.
It did not pass, and nothing noticed, because `.github/workflows/rust-ci.yml` ran
`cargo clippy --workspace` with no `-D warnings`: findings were printed into the log and
the job exited 0. Seventy-four hits had accumulated on `main`.

This branch fixes all 74 and turns the flag on in CI, so the next one cannot accumulate
silently.

---

## Why this was worth a whole branch

Three of the findings were in the retry path of the provider clients, not in test code:

| File | Was | Why it matters |
| --- | --- | --- |
| `rust/crates/api/src/providers/anthropic.rs:709-714` | `.map(\|elapsed\| …).unwrap_or(0)` on a `Result` | the jitter seed for every retry; now `map_or(0, …)` |
| `rust/crates/api/src/providers/openai_compat.rs:334-339` | same expression | same jitter helper, second provider |
| `rust/crates/api/src/providers/anthropic.rs:995-1010` | `StreamEvent::MessageStop(_) => { if !self.usage_recorded { … } }` | collapsed into a match guard; the arm is now a no-op when usage was already recorded, which is what the nested `if` already did |

The rest is hygiene, but the hygiene is what stops the *next* review from having to read
52 lines of noise to find a real defect.

## Changes by lint

| Lint | Hits | Resolution |
| --- | --- | --- |
| `assert_is_empty` | 42 | `assert!(x.is_empty())` → `assert!(x.is_empty(), "{x:?} should be empty")` (and the negated form). Chosen over clippy's `assert_eq!(x, [] as [T; 0])` suggestion because it also reads well for `String` fields, which clippy's array cast does not cover. |
| `unused_async_trait_impl` | 12 | Six stub functions in `rust/crates/commands` and two in `api/providers/gemini.rs` already carried `#[allow(clippy::unused_async)]`; clippy 1.99 reports them under the new name, so the attribute silently stopped matching. Both names are now allowed, with a comment saying the async-ness is kept for the call sites when the stub is wired up. |
| `duration_suboptimal_units` | 6 | `Duration::from_secs(60 * 60)` → `from_hours` / `from_mins` / `from_days`. Identical values. |
| `map_unwrap_or` / `map_unwrap_or_sanitized` | 10 | `Result::map(..).unwrap_or(..)` → `map_or` / `is_ok_and`; `.ok().is_some_and(..)` → `is_ok_and`. |
| `manual_assert_eq` | 3 | `assert!(a == b)` → `assert_eq!(a, b)` — the failure output now names both sides. |
| `uninlined_format_args` | part of the 42 | `"{:?} should be empty", x` → `"{x:?} should be empty"` for plain identifiers. |
| `manual_let_else` | 1 | `daemon.rs:518` `match … None => panic!(..)` → `let … else`. |
| `assigning_clones` | 1 | `daemon.rs:97` `host = value.clone()` → `host.clone_from(value)`. |
| `useless_format` | 1 | `main.rs:5701` `format!("literal")` → `"literal".to_string()`. |
| `unnecessary_trailing_comma` | 2 | removed. |

## Files modified (40, +221 / −111)

`.github/workflows/rust-ci.yml` (+7/−1), and under `rust/crates/`:
`api/src/providers/{anthropic,gemini,openai_compat}.rs`, `api/src/sse.rs`,
`commands/src/actions/{axim_core_relay,google_sheets,google_workspace,internxt}.rs`,
`commands/src/extensions/{demand_letter,lead_scoring,nda,support_triage}.rs`,
`compat-harness/src/lib.rs`, `onyx/src/{daemon,main}.rs`, `onyx/src/tui/status_bar.rs`,
`onyx/tests/{axim_integration_tests,mock_parity_harness,output_format_contract,resume_slash_commands}.rs`,
`plugins/src/lib.rs`,
`runtime/src/{branch_lock,compact,config,config_validate,git_context,mcp_stdio,oauth,plugin_lifecycle,policy_engine,recovery_recipes,sandbox,session,sse,task_registry}.rs`,
`runtime/src/playbooks/triage_support.rs`, `runtime/tests/integration_tests.rs`,
`tools/src/lib.rs`, `tools/src/pdf_extract.rs`.

## CI change

```diff
       - name: Run workspace clippy
-        run: cargo clippy --workspace
+        run: cargo clippy --workspace --all-targets -- -D warnings
```

`--all-targets` is in there deliberately: most of the 42 assertion hits were in `#[cfg(test)]` blocks
and test files, which `cargo clippy --workspace` does not lint. A gate that skips the test
code would have missed them.

## Verification — local

Every command below was run on this branch in the authoring sandbox. The sandbox has no
system C toolchain, so `cc`/`ar` were mapped onto the vendored `zig` (`zig cc` / `zig ar`),
`OPENSSL_DIR` pointed at an extracted `libssl-dev`, and `OPENSSL_STATIC=1` — see
`LEARNINGS.md` for the exact incantation.

```
$ cd rust && cargo fmt --all -- --check
(no output)                                        # exit 0

$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s)
                                                   # exit 0, zero warnings

$ cargo clippy --workspace -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s)
                                                   # exit 0 — the shape CI now runs

$ cd ../edge-bridge && npm test
 Test Files  12 passed (12)
      Tests  144 passed (144)

$ npm run typecheck
> tsc --noEmit                                     # exit 0

$ cd .. && NODE_ENV=test npm test                  # HUD
 Test Files  7 passed (7)
      Tests  49 passed (49)
```

`NODE_ENV=test` is load-bearing in this sandbox: it exports `NODE_ENV=production`
globally, and React's production build does not export `act`, so Testing Library's
`act-compat` throws `React.act is not a function` in all 16 component tests. GitHub
Actions leaves `NODE_ENV` unset, which is why `web-ci.yml` has never seen it.

## Verification — not local

`cargo test --workspace` was **not** run to completion locally. Linking the `onyx` binary
(the ratatui + onig + sqlite + static-openssl combination) aborts under `zig cc` on this
20 GB sandbox, and the disk is shared with the other project checkouts, so the full sweep
kept running out of space. `rust-ci.yml` is the compiler of record for the test suite, as
it has been for every Rust-touching PR in this repo since Phase 4. The PR is gated on
`cargo test --workspace`, `cargo test --test '*' --features integration` and
`cargo clippy --workspace --all-targets -- -D warnings` all reporting green before merge.

What that means for review: the assertion rewrites are mechanically checkable. Every one
of the 31 single-line rewrites was paired against its original line and asserted to keep
the same expression and the same polarity
(`assert!(x.is_empty())` → `assert!(x.is_empty(), …)`; `assert!(!x.is_empty())` →
`assert!(!x.is_empty(), …)`). The five multi-line ones were rewritten by hand and are
listed here:

- `api/src/sse.rs:188` — the original called `parser.push(first)` **once**; an intermediate
  version of this branch called it twice inside the assertion. Now bound to `let buffered`
  first, so it is still called once.
- `compat-harness/src/lib.rs:319-321` — `assert_ne!(…, [] as [T; 0])`, where clippy's
  array-cast form does fit (the receivers are `&[T]`).
- `plugins/src/lib.rs:2519-2541` — `assert_eq!(manifest.tools, Vec::new())`.
- `onyx/tests/resume_slash_commands.rs:74` — negated, message form.
- `onyx/tests/output_format_contract.rs:77` — `assert_eq!(…, &Vec::<Value>::new())`.

## Follow-up found while doing this (not in this PR)

A fresh `npx vite build` on this base produces `rust/crates/onyx/static/assets/index-Cz7yW5cY.js`,
**not** the committed `index-CllMSb_c.js` (263 KB vs 481 KB). The embedded bundle the
`onyx daemon` serves therefore does not match `src/`. Nothing in CI builds the bundle and
compares, which is open item 5 of `WEB_APP_DEVELOPMENT_PLAN.md`; this run confirms it is
live drift, not a theoretical one. The bundle is unchanged by this branch.
