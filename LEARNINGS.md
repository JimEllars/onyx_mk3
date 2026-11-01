## Edge Bridge and Rust Core Synchronization
When adding cross-service telemetry and resilient fallback states, ensuring deep synchronization between Edge environments (Cloudflare Workers) and the inner Daemon is critical.
1. `GET /health` and `GET /ready` act as fundamental uptime checkpoints to verify upstream dependencies seamlessly.
2. In `edge-bridge/src/index.ts`, logging should strip credentials and output structured JSON, mapping directly to analytics workflows.
3. Fallback logic within Cloudflare isolates external outages while retaining data transparency (`code: "502" | "504"` for context mapping inside `emailDispatchManager.ts`).
4. In `rust/crates/api/src/client.rs`, errors from Edge/Providers shouldn't halt the user instance logic or lock TUI frames. Utilizing structured map_err boundaries and logging asynchronous SQLite records ensures observability without UI friction.
5. In integration tests like `mock-anthropic-service/tests/scenario.rs`, you must replicate the entire mock environment explicitly (e.g. `DEEPSEEK_API_KEY` for the default internal model wrapper fallback) so CI tests won't flake across developers who haven't populated `.env`.

## HUD / Edge Contract Drift
The single highest-value lesson of the 2026-11-01 cycle: the HUD and the edge bridge had
silently diverged on the response contract, and nothing caught it because there was no
frontend test suite at all.

6. **Never infer a wire shape from the consumer side.** `ChatInterface` parsed
   `{"chunk": "..."}`. The edge emits `{"type":"content_block_delta","delta":{"text":...}}`
   (`textSsePayload()`, `index.ts:354`) and, on the accepted path, plain JSON with no SSE
   frames at all. Both paths rendered nothing. Read the producer before writing the parser —
   and pin the producer's exact output as a test fixture (`tests/web/chatStream.test.js`
   reconstructs `textSsePayload()` byte-for-byte so drift fails a test instead of the UI).
7. **An empty `<div>` is not a passing test.** The bug had been live and invisible because
   an empty assistant bubble looks like a slow stream. Assert on rendered text, not on the
   absence of exceptions.
8. **Keep pure logic out of components.** `src/lib/*.js` is DOM-free and `import.meta`-free,
   so `node --test` covers it with zero dependencies. React state, effects and Tailwind stay
   in the component. This is what made a 37-assertion suite possible with no new packages.
9. **Interval dependency arrays are a request amplifier.** Putting `telemetryEvents` in the
   dependency array of a `setInterval` effect recreated the timer on every event, and the
   timer body did a `fetch`. Polls belong in an effect that depends on nothing but config;
   derived values belong in `useMemo`.
10. **`response.ok` is not "the action was applied".** The edge returns `200` only when Core
    accepted an HITL decision, and `502`/`503` + `reason` + `core_status` when it recorded
    the decision locally but Core refused. Collapsing that to `FAILED` hides the one detail
    the operator needs.
11. **A `useRef` returned from a hook is a lie.** `retryCountRef.current` frozen at render
    time never triggers a re-render; return state, and keep the ref only for the timer logic.
12. **Stale build logs are worse than no logs.** `rust/build.log` and `rust/test.log` in the
    tree described `/app/rust` at an older commit (`E0428` duplicate `State`, missing
    `CliAction::State` arm). At the current head that enum member is declared once and
    handled. Logs are gitignored for a reason — never cite them as build state.
13. **`NODE_ENV=production` silently empties `node_modules`.** `npm ci` then skips
    devDependencies, `vite` is absent, and `npm run build` dies on `sh: vite: not found`.
    Pass `NODE_ENV=development` (or `--include=dev`) when installing build tooling.
14. **The embedded HUD bundle is a build artifact that must be committed.** `vite.config.js`
    emits into `rust/crates/onyx/static/`, and `edge-bridge/wrangler.jsonc` serves that same
    directory as worker assets. Forgetting to rebuild means the daemon and the edge both
    serve an older HUD than `src/`.
