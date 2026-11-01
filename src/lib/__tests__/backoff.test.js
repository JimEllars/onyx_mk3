import { describe, it, expect, vi } from 'vitest';
import { BACKOFF_MAX_MS, BACKOFF_MIN_MS, isRetryExhausted, nextRetryDelay } from '../../lib/backoff';

describe('nextRetryDelay', () => {
    it('starts at 1s and doubles without jitter', () => {
        const jitterless = { jitter: false };
        expect(nextRetryDelay(0, jitterless)).toBe(1000);
        expect(nextRetryDelay(1, jitterless)).toBe(2000);
        expect(nextRetryDelay(2, jitterless)).toBe(4000);
        expect(nextRetryDelay(3, jitterless)).toBe(8000);
        expect(nextRetryDelay(4, jitterless)).toBe(16000);
    });

    it('clamps at 30s however long the outage runs', () => {
        for (const attempt of [5, 8, 20, 500]) {
            expect(nextRetryDelay(attempt, { jitter: false })).toBe(BACKOFF_MAX_MS);
            expect(nextRetryDelay(attempt)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
        }
    });

    it('keeps jittered delays inside the 1s-30s window', () => {
        for (const random of [0, 0.5, 0.999999]) {
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const delay = nextRetryDelay(attempt, { random: () => random });
                expect(delay).toBeGreaterThanOrEqual(BACKOFF_MIN_MS);
                expect(delay).toBeLessThanOrEqual(BACKOFF_MAX_MS);
            }
        }
    });

    it('treats a non-numeric attempt as the first retry', () => {
        expect(nextRetryDelay(undefined, { jitter: false })).toBe(1000);
        expect(nextRetryDelay(-3, { jitter: false })).toBe(1000);
        expect(nextRetryDelay(Number.NaN, { jitter: false })).toBe(1000);
    });

    it('honours a custom floor', () => {
        expect(nextRetryDelay(0, { minMs: 15000, maxMs: 120000, jitter: false })).toBe(15000);
    });
});

describe('isRetryExhausted', () => {
    it('never exhausts when maxAttempts is 0', () => {
        expect(isRetryExhausted(99, 0)).toBe(false);
    });

    it('exhausts at the limit', () => {
        expect(isRetryExhausted(2, 3)).toBe(false);
        expect(isRetryExhausted(3, 3)).toBe(true);
    });
});
