# Verification Log — Daily briefing: HITL links and HTML escaping (2026-11-02)

**Branch:** `fix/onyx-hitl-digest-links`
**Base:** `97630c3` (main, post-PR #293); rebased onto `69ee55e` (post-#294/#274/#285) before merge.
**Scope:** `edge-bridge/src/index.ts` (scheduled handler + three new module-level helpers),
`edge-bridge/test/hitl-digest.test.ts` (new). No Rust, no `src/` HUD change.

## Defects

### 1. Every Approve/Reject button in the daily briefing was dead

Phase B (#289) removed the mutating GET from `/api/v1/hitl/action` and left the email
untouched. The digest still emitted:

```
${baseUrl}/api/v1/hitl/action?token=<kv key>&decision=approve
${baseUrl}/api/v1/hitl/action?token=<kv key>&decision=reject
```

and the handler now answers that exact shape with **405**:

```
Decisions are no longer accepted on GET. POST /api/v1/hitl/action with
{ action_id, decision } and an operator credential.
```

So the primary call to action of the operator's daily briefing failed, and it failed *after*
the click, which is the worst place to find out.

**Fix:** the email carries no decision at all. Each ticket renders two read-only links —
`GET /api/v1/hitl/action?token=…` (the ticket) and the cockpit
(`https://cockpit.axim.us.com/actions?ticket=…`), where the decision is POSTed with an
operator credential. A one-click approve-by-link is itself the defect class Phase B closed:
mail scanners, link previewers and browser prefetch all fire GET. Writing the link back into
the email would have re-opened it.

### 2. Ticket text was interpolated into the email HTML unescaped

`${parsed.description || 'System Proposal'}` went straight into the markup. A ticket
description originates as a tool-proposal field, so anyone who can influence a proposal could
inject links or markup into a message that arrives from a trusted internal sender with a
button-shaped CTA. Fixed with `escapeHtml()` applied to the description, the token (also
`encodeURIComponent`), and both hrefs.

### 3. Two smaller defects in the same block

- A malformed ticket was swallowed by `catch (e) {}`, so the digest silently under-reported
  the queue. It now logs `{"event":"hitl_ticket_unparseable","token":…}` and continues.
- `scheduled()` began with an unconditional `console.error("error")` under a comment about a
  "heartbeat sanity evaluation across active KV stores". It ran on **every** tick, including
  the five-minute one, so the worker emitted an error line every five minutes forever. Removed.

## Files and lines

| File | Lines | Change |
| --- | --- | --- |
| `edge-bridge/src/index.ts` | +100 / -23 | `escapeHtml`, `HitlDigestTicket`, `loadPendingHitlTickets`, `renderHitlTicket`, `renderHitlDigestSection`, `COCKPIT_ACTIONS_URL`; digest loop replaced by two calls; stray error log removed |
| `edge-bridge/test/hitl-digest.test.ts` | new, 248 | 13 tests across D1-D4 |
| `AGENTS_VERIFICATION.md` | +1 | index row for this appendix |
| `CHANGELOG.md` | +22 | 2026-11-02 entry |
| `LEARNINGS.md` | +14 | lesson 18 |
| `WEB_APP_DEVELOPMENT_PLAN.md` | +20/-12 | Phase 4 marked merged; standing defects refreshed |

## Proving runs

`edge-bridge` (real build command, not just the type checker):

```
$ npx vitest run
 Test Files  8 passed (8)
      Tests  93 passed (93)        # 80 before, 13 new

$ npm run build                  # wrangler types + tsc --noEmit
✨ Types written to ./src/worker-configuration.d.ts
> tsc --noEmit                   # clean, no output

$ npm run deploy:dry-run
Total Upload: 117.44 KiB / gzip: 21.49 KiB
--dry-run: exiting now.
```

`git status` after `npm run build`: clean, so the regenerated `worker-configuration.d.ts` is
byte-identical to the committed one.

## Failure-before-fix, per dimension

Each dimension was reverted on its own and the suite re-run.

**(a) Restore the pre-fix one-click links** (`?token=…&decision=approve`, `Approve Action`):

```
× D1 > a ticket block carries no decision query parameter
× D1 > every edge URL in a ticket block is served, not 405
× D4 > sends escaped ticket text and no decision links
      Tests  3 failed | 10 passed (13)
```

The 405 is the actual production symptom: `worker.fetch(GET ?token=…&decision=approve)`
returns 405 on the pre-fix handler.

**(b) Restore the pre-fix escaping** (`escapeHtml` as identity):

```
× D2 > escapes HTML metacharacters in the description
× D2 > a malicious description renders inert inside the ticket block
× D4 > sends escaped ticket text and no decision links
      Tests  3 failed | 10 passed (13)
```

Restored source is byte-identical to the fixed file (`diff -q` clean) and the suite returns
to 13/13.

## What "green" does not cover here

- The email was **not** delivered. `fetch` to `api.emailit.com` is stubbed; the assertion is
  on the JSON body handed to it. Rendering in a real mail client (Gmail strips `<style>` and
  rewrites links) is unverified.
- The cockpit URL is still hardcoded in the worker (`COCKPIT_ACTIONS_URL`), as it was before.
  A `PUBLIC_COCKPIT_URL` variable would be the right follow-up; not changed here because it
  touches `wrangler.jsonc` and the generated types.
- Nothing was deployed. `wrangler deploy` is an operator step.
