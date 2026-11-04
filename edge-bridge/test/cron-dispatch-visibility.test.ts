/**
 * Daily-cron dispatch visibility tests.
 *
 * Two defects on the pre-fix head (7f229c1):
 *
 * 1. **Silent dispatch.** The daily run's call to the Core cron endpoint ended in
 *    `.then((res) => void 0).catch((e) => void 0)` — it discarded the status and
 *    swallowed the throw. A 302 to a 404 page is a *successful* fetch, so a dead
 *    `CORE_INGEST_URL` produced no log, no DLQ entry and no signal at all. The
 *    dispatch could fail every night for months and nobody would know.
 *
 * 2. **Wrong URL.** The endpoint was derived with
 *    `CORE_INGEST_URL.replace("/v1/functions/telemetry-ingest", "/api/v1/...")`.
 *    When the configured value did not contain that exact substring — a bare
 *    origin, or the `/telemetry` suffix wrangler.jsonc actually deploys — the
 *    replace was a silent no-op and the cron POST went to the *ingest* path.
 *
 * `resolveCronUrl` is now exported and unit-tested directly, so a future refactor
 * of the derivation is caught without needing to stand up a fake fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveCronUrl } from '../src/index';

const CRON_PATH = '/api/v1/internal/cron/daily-run';

describe('resolveCronUrl', () => {
    it('re-roots a bare origin onto the cron path', () => {
        expect(resolveCronUrl('https://api.axim.us.com')).toBe(
            `https://api.axim.us.com${CRON_PATH}`,
        );
    });

    it('re-roots the /telemetry suffix wrangler.jsonc actually deploys', () => {
        expect(resolveCronUrl('https://api.axim.us.com/telemetry')).toBe(
            `https://api.axim.us.com${CRON_PATH}`,
        );
    });

    it('re-roots the legacy /v1/functions/telemetry-ingest suffix', () => {
        expect(
            resolveCronUrl('https://api.axim.us.com/v1/functions/telemetry-ingest'),
        ).toBe(`https://api.axim.us.com${CRON_PATH}`);
    });

    it('re-roots the bare /telemetry-ingress suffix', () => {
        expect(resolveCronUrl('https://core.example.dev/telemetry-ingress')).toBe(
            `https://core.example.dev${CRON_PATH}`,
        );
    });

    it('tolerates a trailing slash without doubling it', () => {
        expect(resolveCronUrl('https://api.axim.us.com/telemetry/')).toBe(
            `https://api.axim.us.com${CRON_PATH}`,
        );
    });

    it('falls back to localhost when CORE_INGEST_URL is unset', () => {
        expect(resolveCronUrl(undefined)).toBe(`http://localhost:3000${CRON_PATH}`);
    });

    it('does not leave the ingest path in the result', () => {
        for (const base of [
            'https://api.axim.us.com',
            'https://api.axim.us.com/telemetry',
            'https://api.axim.us.com/v1/functions/telemetry-ingest',
        ]) {
            const out = resolveCronUrl(base);
            expect(out).not.toMatch(/telemetry(-ingress|-ingest)?$/);
            expect(out).not.toContain('/functions/');
        }
    });
});

/**
 * The regression guard for defect 1: assert the dispatch no longer discards its
 * outcome. This reads the source rather than exercising the scheduler, because
 * what regressed was the *shape* of the promise chain, not its behaviour.
 */
describe('daily-run dispatch does not swallow failures', () => {
    let source: string;

    beforeEach(async () => {
        source = await import('node:fs/promises').then((fs) =>
            fs.readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
        );
    });

    it('contains no `.then((res) => void 0)` fast-path in the cron dispatch', () => {
        expect(source).not.toContain('.then((res) => void 0)');
    });

    it('logs a non-ok status from the daily run', () => {
        expect(source).toContain('edge.cron.daily_run_failed');
    });

    it('logs a thrown daily run', () => {
        expect(source).toContain('edge.cron.daily_run_threw');
    });

    it('warns when CRON_SECRET_KEY is unbound rather than sending "Bearer undefined"', () => {
        expect(source).toContain('edge.cron.daily_run_unauthenticated');
    });

    it('derives the cron URL through resolveCronUrl', () => {
        expect(source).toContain('resolveCronUrl(env.CORE_INGEST_URL)');
    });
});
