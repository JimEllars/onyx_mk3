/**
 * Daily-cron retention tests.
 *
 * Two defects on the pre-fix head (237bce7):
 *
 * 1. The scheduled handler tested `controller.cron === "0 12 * * *"`, but the
 *    deployed triggers are midnight-daily and every-five-minutes (wrangler.jsonc),
 *    so the daily digest never ran.
 * 2. The retention batch sat *outside* that branch and shared one cutoff value:
 *    epoch **seconds**, while `onyx_telemetry_logs.created_at` is written with
 *    `Date.now()` (**milliseconds**). Every row was older than the cutoff, so the
 *    whole telemetry table — the table `drainIngestDlq` replays from — was deleted
 *    on every five-minute tick.
 */
import { describe, it, expect } from 'vitest';
import worker, { DAILY_CRONS, isDailyCron, RETENTION_WINDOW_DAYS } from '../src/index';

const DAY_MS = 24 * 60 * 60 * 1000;

type Statement = { sql: string; params: unknown[] };

/** Minimal D1 stand-in that records what `batch()` was asked to execute. */
function fakeDB() {
    const batches: Statement[][] = [];
    return {
        batches,
        prepare(sql: string) {
            return {
                sql,
                params: [] as unknown[],
                bind(...params: unknown[]): Statement {
                    return { sql, params };
                },
                async run() {
                    return { success: true };
                },
                async first() {
                    return null;
                },
                async all() {
                    return { results: [] };
                },
            };
        },
        async batch(statements: Statement[]) {
            batches.push(statements.map((s) => ({ sql: s.sql, params: s.params })));
            return statements.map(() => ({ success: true }));
        },
    };
}

function fakeCtx() {
    const pending: Promise<unknown>[] = [];
    return {
        pending,
        waitUntil: (promise: Promise<unknown>) => {
            pending.push(promise);
        },
        passThroughOnException: () => {},
    };
}

async function runCron(cron: string, env: unknown) {
    const ctx = fakeCtx();
    await worker.scheduled({ cron }, env as never, ctx as never);
    // waitUntil work is part of the contract: the cleanup is scheduled, not awaited.
    await Promise.all(ctx.pending);
    return ctx;
}

function deletes(db: { batches: Statement[][] }): Statement[] {
    return db.batches.flat().filter((s) => s.sql.toUpperCase().includes('DELETE'));
}

describe('isDailyCron', () => {
    it('recognises the crons that mean "daily"', () => {
        expect(isDailyCron('0 0 * * *')).toBe(true);
        expect(isDailyCron('0 12 * * *')).toBe(true);
        expect(DAILY_CRONS).toContain('0 0 * * *');
    });

    it('does not mistake the five-minute drain for the daily run', () => {
        expect(isDailyCron('*/5 * * * *')).toBe(false);
        expect(isDailyCron(undefined)).toBe(false);
        expect(isDailyCron('')).toBe(false);
    });
});

describe('retention cadence', () => {
    it('issues no DELETE on the five-minute tick', async () => {
        const db = fakeDB();
        await runCron('*/5 * * * *', { ONYX_DB: db });
        expect(deletes(db)).toHaveLength(0);
    });

    it('runs the retention batch on the trigger that is actually deployed', async () => {
        const db = fakeDB();
        await runCron('0 0 * * *', { ONYX_DB: db });
        expect(deletes(db)).toHaveLength(3);
    });

    it('still runs if the schedule moves to midday', async () => {
        const db = fakeDB();
        await runCron('0 12 * * *', { ONYX_DB: db });
        expect(deletes(db)).toHaveLength(3);
    });

    it('does not require a D1 binding', async () => {
        await expect(runCron('0 0 * * *', {})).resolves.toBeTruthy();
    });
});

describe('retention cutoffs use the unit each column is written in', () => {
    it('binds the telemetry cutoff in milliseconds', async () => {
        const db = fakeDB();
        await runCron('0 0 * * *', { ONYX_DB: db });

        const telemetry = deletes(db).find((s) => s.sql.includes('onyx_telemetry_logs'));
        expect(telemetry).toBeTruthy();

        const cutoff = telemetry!.params[0] as number;
        // The pre-fix value was ~1.79e9 (seconds). A millisecond cutoff is ~1.79e12.
        expect(cutoff).toBeGreaterThan(1e12);
        const age = Date.now() - cutoff;
        expect(Math.abs(age - RETENTION_WINDOW_DAYS * DAY_MS)).toBeLessThan(60_000);
    });

    it('binds the rate-limit cutoff in seconds', async () => {
        const db = fakeDB();
        await runCron('0 0 * * *', { ONYX_DB: db });

        const rateLimit = deletes(db).find((s) => s.sql.includes('onyx_rate_limit_logs'));
        expect(rateLimit).toBeTruthy();

        const cutoff = rateLimit!.params[0] as number;
        expect(cutoff).toBeLessThan(1e11);
        const ageSeconds = Math.floor(Date.now() / 1000) - cutoff;
        expect(Math.abs(ageSeconds - RETENTION_WINDOW_DAYS * 24 * 60 * 60)).toBeLessThan(60);
    });

    it('never shares one cutoff between the two tables', async () => {
        const db = fakeDB();
        await runCron('0 0 * * *', { ONYX_DB: db });

        const telemetry = deletes(db).find((s) => s.sql.includes('onyx_telemetry_logs'));
        const rateLimit = deletes(db).find((s) => s.sql.includes('onyx_rate_limit_logs'));
        expect(telemetry!.params[0]).not.toBe(rateLimit!.params[0]);
    });
});
