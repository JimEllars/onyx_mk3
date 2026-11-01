/**
 * Connection-state helpers shared by the HUD connection hook and sidebar.
 *
 * Two independent transports feed the same badge:
 *   - WebRTC peer connection (voice trunk) via `useAgentConnection`
 *   - Server-Sent Events (`/events`) for HITL tickets
 *
 * Both must present the same three states so an operator can tell a live
 * stream from a retrying one without reading raw transport enums.
 */

/** @typedef {'ONLINE' | 'RECONNECTING' | 'OFFLINE'} ConnectionBadge */

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;

/**
 * Exponential backoff with full jitter, clamped to [base, max].
 *
 * Attempt 0 -> ~1s, attempt 1 -> ~2s, ... capped at 30s. Jitter is injected so
 * tests are deterministic.
 *
 * @param {number} attempt zero-based retry counter
 * @param {{ base?: number, max?: number, random?: () => number }} [options]
 * @returns {number} delay in milliseconds
 */
export function computeBackoffDelay(attempt, options = {}) {
    const base = options.base ?? BACKOFF_BASE_MS;
    const max = options.max ?? BACKOFF_MAX_MS;
    const random = options.random ?? Math.random;

    const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
    const raw = base * 2 ** safeAttempt;
    const capped = Math.min(max, raw);
    const jitter = random() * (base / 2);
    return Math.round(Math.min(max, capped + jitter));
}

/**
 * Collapse an internal stream status into the three operator-facing states.
 *
 * Internal statuses seen in the HUD: CONNECTING, ONLINE, RECONNECTING,
 * OFFLINE, CONNECTED, DISCONNECTED, RECONNECT NEEDED, plus the empty string
 * used before the first connection attempt.
 *
 * @param {string | null | undefined} streamStatus
 * @returns {ConnectionBadge}
 */
export function toConnectionBadge(streamStatus) {
    switch (streamStatus) {
        case 'ONLINE':
        case 'CONNECTED':
        case 'ACTIVE':
            return 'ONLINE';
        case 'CONNECTING':
        case 'RECONNECTING':
        case 'RECONNECT NEEDED':
            return 'RECONNECTING';
        default:
            return 'OFFLINE';
    }
}

/**
 * Tailwind classes for a badge state.
 *
 * @param {ConnectionBadge} badge
 * @returns {{ text: string, dot: string }}
 */
export function connectionBadgeClasses(badge) {
    switch (badge) {
        case 'ONLINE':
            return { text: 'text-emerald-500', dot: 'bg-emerald-500' };
        case 'RECONNECTING':
            return { text: 'text-amber-500', dot: 'bg-amber-500 animate-pulse' };
        default:
            return { text: 'text-red-500', dot: 'bg-red-500' };
    }
}

/**
 * HTTP statuses worth retrying. Asguard rate limits (429) and upstream
 * unavailability (502/503/504) are transient; 4xx auth failures are not.
 *
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableStatus(status) {
    return status === 429 || status === 502 || status === 503 || status === 504;
}
