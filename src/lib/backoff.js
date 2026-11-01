// Reconnection backoff, shared by the SSE stream, the summon retry loop and the
// DLQ poller. Phase 1 of the web plan asks for 1s-30s exponential backoff; keeping
// one implementation means the three call sites cannot drift apart.

export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 30000;

/**
 * Delay before retry number `attempt` (0-based).
 *
 * `min * 2^attempt`, clamped to [min, max], plus up to `jitterRatio` of the base
 * delay so a fleet of HUDs does not reconnect in lockstep. Jitter is only ever
 * added, never subtracted, so the result stays inside [min, max + jitter] and the
 * caller-visible floor is still 1s.
 */
export function nextRetryDelay(attempt, options = {}) {
    const {
        minMs = BACKOFF_MIN_MS,
        maxMs = BACKOFF_MAX_MS,
        jitterRatio = 0.2,
        random = Math.random,
        jitter = true,
    } = options;

    const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
    const exponential = Math.min(maxMs, minMs * 2 ** safeAttempt);
    if (!jitter) return exponential;

    const jitterMs = jitterRatio > 0 ? exponential * jitterRatio * random() : 0;
    return Math.min(maxMs, Math.round(exponential + jitterMs));
}

/** True when `attempt` has exhausted `maxAttempts` (0 disables the limit). */
export function isRetryExhausted(attempt, maxAttempts) {
    return maxAttempts > 0 && attempt >= maxAttempts;
}
