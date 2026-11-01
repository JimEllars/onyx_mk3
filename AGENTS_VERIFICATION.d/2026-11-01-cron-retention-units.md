# 2026-11-01 — Daily cron never ran, and its retention cutoff would have emptied the telemetry table

Branch: `feat/onyx-fleet-health-rollup` (stacked on `feat/onyx-hud-phase1-connection-hardening`, PR #292)
Base commit: `237bce7`
Session: second pass of the recurring 6-hour audit

Two defects in the `scheduled()` handler of `edge-bridge/src/index.ts`. No Rust source
touched, no frontend source touched (the embedded bundle is unchanged).

---

## Defect 1 — the daily branch tested a cron string that is not deployed

**File:** `edge-bridge/src/index.ts` (881–896, 952)
**Deployed config:** `edge-bridge/wrangler.jsonc:84-87` → `crons: ["0 0 * * *", "*/5 * * * *"]`
**Proving test:** `edge-bridge/test/cron-retention.test.ts` — `runs the retention batch on the trigger that is actually deployed`

```ts
if (controller.cron === "0 12 * * *") {   // ← nothing ever fires this
```

The deployed triggers are midnight-daily and every-five-minutes. The handler compared
against `0 12 * * *` exactly, so the whole branch — the HITL digest email **and** the
retention pass — was dead code in production. Nothing failed, nothing logged; the work just
never happened.

Fixed by matching a set rather than one literal:

```ts
export const DAILY_CRONS = ["0 0 * * *", "0 12 * * *"];
export function isDailyCron(cron: string | undefined): boolean { ... }
```

so the daily job runs on the deployed schedule and keeps working if the schedule is later
moved to midday.

## Defect 2 — the retention cutoff mixed epoch seconds with a millisecond column

**File:** `edge-bridge/src/index.ts` (1006–1038)
**Proving tests:** `binds the telemetry cutoff in milliseconds`, `never shares one cutoff between the two tables`

```ts
const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;  // seconds
...
"DELETE FROM onyx_telemetry_logs WHERE created_at < ?"  // created_at is Date.now() → milliseconds
```

`onyx_telemetry_logs.created_at` is written in **milliseconds** (`src/index.ts:1364`,
`Date.now()`), while `onyx_rate_limit_logs.blocked_at` is written in **seconds**
(`src/index.ts:1989`). One cutoff was bound to both. `1.79e9 < 1.79e12` is true for every
row ever written, so the statement deleted the entire table.

Fixed by binding each cutoff in the unit its own column uses — `telemetryCutoffMs` and
`secondsCutoff` — computed independently and asserted to differ.

## Defect 3 — the retention pass ran on every tick, not daily

**File:** `edge-bridge/src/index.ts` (952–1039)
**Proving test:** `issues no DELETE on the five-minute tick`

The `DELETE` batch was placed *after* the closing brace of the daily branch, so it executed
on **every** scheduled invocation, including the five-minute DLQ drain.

Combined with defect 2 the blast radius is: **`onyx_telemetry_logs` emptied every five
minutes in production.** That is the table `drainIngestDlq` (line 881) replays from and the
table `GET /api/v1/telemetry/dlq-status` counts (`synced = 0`) for `unsynced_receipts_depth`
— the field the Action Console panel added in PR #292 reads. So the panel would have shown
a permanently empty receipt queue, and any receipt that failed to reach Core was
unrecoverable within five minutes.

The batch now lives inside the daily branch.

## Related finding — `onyx_command_audit_logs` has no writer

`grep` over `src/*.ts` finds exactly one reference to `onyx_command_audit_logs`: the
`DELETE` in this batch. Nothing inserts into it. Its first three columns are also
`NOT NULL` (`migrations/0001_onyx_operational_tables.sql:32-40`), so any future insert must
supply them.

Consequence: the delete is a no-op, and **no fleet-health or audit panel can be built over
this table** — it would report zeros forever. Recorded in the code comment at the delete and
in `WEB_APP_DEVELOPMENT_PLAN.md`, because "build a panel on the audit table" is the obvious
next idea and it does not work.

---

## Verification

```
$ cd edge-bridge && npx vitest run
  Test Files  7 passed (7)
       Tests  80 passed (80)          # 71 existing + 9 new
$ cd edge-bridge && npm run build      # wrangler types + tsc --noEmit, exit 0
$ cd edge-bridge && npx wrangler deploy --dry-run --config wrangler.jsonc
  Total Upload: 116.42 KiB / gzip: 21.09 KiB
  --dry-run: exiting now.
$ cd rust && cargo fmt --all -- --check   # exit 0 (no Rust changed)
```

No frontend file changed, so `vite build` was not re-run and the embedded bundle in
`rust/crates/onyx/static` is untouched.

## Demonstrated failing before each fix

Both dimensions reverted one at a time against the same suite:

| Reverted | Result |
|---|---|
| `isDailyCron(controller.cron)` → `true` (retention back on every tick) | `Tests 1 failed \| 8 passed (9)` — `issues no DELETE on the five-minute tick` |
| `telemetryCutoffMs` → `secondsCutoff` | `Tests 2 failed \| 7 passed (9)` — `binds the telemetry cutoff in milliseconds`, `never shares one cutoff between the two tables` |

## Not fixed here — flagged for the operator

- **The digest now sends at 00:00 UTC, not 12:00.** The deployed trigger is `0 0 * * *`; the
  code previously *intended* `0 12 * * *`. I made the handler honour what is deployed rather
  than silently re-schedule a production email. If midday was the intent, change
  `wrangler.jsonc:85` to `0 12 * * *` — the handler accepts both.
- **Rust was not compiled in this sandbox** (no C toolchain / glibc headers; see
  `2026-11-01-hud-telemetry-personas.md`). Nothing Rust changed here; CI is the authority.
