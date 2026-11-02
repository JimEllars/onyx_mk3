import { useCallback, useEffect, useRef, useState } from 'react';
import { nextRetryDelay } from '../lib/backoff';

const DLQ_ENDPOINT = '/api/v1/telemetry/dlq-status';
const DEFAULT_INTERVAL_MS = 15000;

function defaultApiUrl() {
    return (import.meta.env?.VITE_ONYX_WORKER_URL || '').replace(/\/$/, '');
}

function defaultToken() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('axim_passport_token');
}

/**
 * Polls `GET /api/v1/telemetry/dlq-status` and reports the fleet's unsynced
 * queue depth.
 *
 * The console used to synthesise these numbers from local event buffers, which
 * meant the panel kept showing a healthy queue while the edge was backed up.
 * Polling the real endpoint is the whole point of Phase 2.
 *
 * States:
 *   loading  - first poll in flight
 *   live     - last poll succeeded
 *   stale    - previously succeeded, most recent poll failed
 *   offline  - never succeeded
 */
export function useDlqStatus(options = {}) {
    const {
        apiUrl = defaultApiUrl(),
        token = defaultToken(),
        intervalMs = DEFAULT_INTERVAL_MS,
        enabled = true,
        fetchImpl,
        maxAttempts = 0,
    } = options;

    const [state, setState] = useState({
        status: 'loading',
        data: null,
        error: null,
        lastUpdatedAt: null,
        consecutiveFailures: 0,
    });

    const mountedRef = useRef(true);
    const timerRef = useRef(null);
    const aborterRef = useRef(null);
    const failuresRef = useRef(0);
    const hasSucceededRef = useRef(false);

    const poll = useCallback(async () => {
        const doFetch = fetchImpl ?? globalThis.fetch;
        if (!doFetch) return;

        aborterRef.current?.abort();
        const controller = new AbortController();
        aborterRef.current = controller;

        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        try {
            const response = await doFetch(`${apiUrl}${DLQ_ENDPOINT}`, {
                method: 'GET',
                headers,
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`dlq-status HTTP ${response.status}`);
            }
            const data = await response.json();
            if (!mountedRef.current) return;
            failuresRef.current = 0;
            hasSucceededRef.current = true;
            setState({
                status: 'live',
                data,
                error: null,
                lastUpdatedAt: Date.now(),
                consecutiveFailures: 0,
            });
        } catch (error) {
            if (!mountedRef.current || controller.signal.aborted) return;
            failuresRef.current += 1;
            setState((prev) => ({
                ...prev,
                status: hasSucceededRef.current ? 'stale' : 'offline',
                error: error instanceof Error ? error.message : 'dlq-status failed',
                consecutiveFailures: failuresRef.current,
            }));
        }
    }, [apiUrl, token, fetchImpl]);

    const scheduleNext = useCallback(
        (failures) => {
            if (timerRef.current) clearTimeout(timerRef.current);
            const delay =
                failures === 0 ? intervalMs : nextRetryDelay(failures - 1, { minMs: intervalMs, maxMs: 120000 });
            timerRef.current = setTimeout(async () => {
                if (!mountedRef.current) return;
                await poll();
                if (!mountedRef.current) return;
                const exhausted = maxAttempts > 0 && failuresRef.current >= maxAttempts;
                if (!exhausted) scheduleNext(failuresRef.current);
            }, delay);
        },
        [intervalMs, poll, maxAttempts],
    );

    useEffect(() => {
        mountedRef.current = true;
        if (!enabled) {
            setState((prev) => ({ ...prev, status: prev.data ? 'stale' : 'loading' }));
            return () => {};
        }

        let cancelled = false;
        (async () => {
            await poll();
            if (cancelled || !mountedRef.current) return;
            scheduleNext(failuresRef.current);
        })();

        return () => {
            cancelled = true;
            mountedRef.current = false;
            if (timerRef.current) clearTimeout(timerRef.current);
            aborterRef.current?.abort();
        };
    }, [enabled, poll, scheduleNext]);

    const refresh = useCallback(async () => {
        await poll();
        if (mountedRef.current) scheduleNext(failuresRef.current);
    }, [poll, scheduleNext]);

    return { ...state, refresh };
}

export default useDlqStatus;
