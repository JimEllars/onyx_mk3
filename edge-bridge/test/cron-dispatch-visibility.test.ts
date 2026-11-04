/**
 * Guard against the revival of the daemon daily-run dispatch.
 *
 * History
 * -------
 * The scheduled handler used to POST to
 * `resolveCronUrl(CORE_INGEST_URL)` — nominally the Rust daemon's
 * `/api/v1/internal/cron/daily-run`. Two defects were found and fixed there:
 *
 *   1. The call ended in `.then((res) => void 0).catch((e) => void 0)`, so it
 *      discarded the status and swallowed the throw. A 302 to a 404 page is a
 *      *successful* fetch: a dead URL produced no log, no DLQ entry, no signal.
 *   2. The URL was derived by `.replace()` on a substring that the deployed
 *      config did not contain, so the replace silently no-opped.
 *
 * Both were fixed. Then the target itself turned out to be hollow:
 *
 *   - `handle_daily_cron` in `rust/crates/api/src/router.rs` is a stub. It sleeps
 *     one second, increments a process-local `AtomicU64` and prints a line. The
 *     source comment reads `// Simulate an automation run`. The counter is only
 *     ever read back by `/api/v1/telemetry/health` as display-only telemetry.
 *   - The daemon is not deployed in production. `onyx-edge.axim.us.com` is a
 *     Cloudflare Worker and the only backend it can name is
 *     `http://localhost:3000`, unreachable from an edge isolate.
 *   - `CRON_SECRET_KEY` was bound nowhere, so the header was `Bearer undefined`.
 *   - Real scheduled work already runs on six `pg_cron` jobs in axim-core.
 *
 * So the dispatch and `resolveCronUrl` were removed on 2026-11-04 rather than
 * built out. These tests assert the removal holds. They exist so that if the
 * dispatch is ever reintroduced, it comes back with a real endpoint, a bound
 * secret, and error handling — not by quietly restoring dead code.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

const readSrc = () =>
    readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

/**
 * Strip `//` line comments and `/* *\/` block comments so assertions about
 * executable code are not satisfied or defeated by prose. The removal notes
 * deliberately name the endpoint and the handler; the code must not.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            return !t.startsWith('//') && !t.startsWith('*');
        })
        .join('\n');
}

describe('the daemon daily-run dispatch stays removed', () => {
    it('does not export resolveCronUrl', async () => {
        const mod = await import('../src/index');
        expect('resolveCronUrl' in mod).toBe(false);
    });

    it('does not build a cron URL at all', async () => {
        const code = stripComments(await readSrc());
        expect(code).not.toContain('/api/v1/internal/cron/daily-run');
    });

    it('does not declare CRON_SECRET_KEY on the Env type', async () => {
        const code = stripComments(await readSrc());
        expect(code).not.toMatch(/^\s*CRON_SECRET_KEY\?:\s*string;/m);
    });

    it('sends no Bearer token derived from a cron secret', async () => {
        const code = stripComments(await readSrc());
        expect(code).not.toContain('Bearer ${cronSecret}');
        expect(code).not.toContain('cronSecret');
    });

    it('contains no silent promise swallow in the scheduled handler', async () => {
        const code = stripComments(await readSrc());
        expect(code).not.toContain('.then((res) => void 0)');
    });

    it('records why the dispatch was removed, at the removal site', async () => {
        // A future maintainer must be able to find the reasoning without git
        // archaeology, and must not re-add it by accident.
        const source = await readSrc();
        expect(source).toContain('REMOVED: dispatch to the Rust daemon');
        expect(source).toContain('handle_daily_cron');
        expect(source).toContain('pg_cron');
    });
});

describe('the scheduled handler still does the work it should', () => {
    it('keeps the five-minute DLQ drain', async () => {
        const source = await readSrc();
        expect(source).toContain('drainIngestDlq');
    });

    it('keeps the daily retention batch', async () => {
        const source = await readSrc();
        expect(source).toContain('RETENTION_WINDOW_DAYS');
    });

    it('keeps the HITL digest email', async () => {
        const source = await readSrc();
        expect(source).toContain('loadPendingHitlTickets');
    });

    it('still distinguishes the daily cron from the five-minute one', async () => {
        const source = await readSrc();
        expect(source).toContain('isDailyCron');
    });
});
