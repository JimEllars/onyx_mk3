// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useDlqStatus from '../../hooks/useDlqStatus';

const LIVE_BODY = {
    status: 'healthy',
    unsynced_relays_depth: 7,
    unsynced_receipts_depth: 2,
    edge_circuit_breaker: 'closed',
    upstream_core_ok: true,
};

function jsonResponse(status, body) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe('useDlqStatus', () => {
    it('polls the real dlq-status endpoint and exposes the numbers', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, LIVE_BODY));

        const { result, unmount } = renderHook(() =>
            useDlqStatus({ apiUrl: 'https://edge.example.com', token: 'jwt', fetchImpl, intervalMs: 60000 }),
        );

        await waitFor(() => expect(result.current.status).toBe('live'));

        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://edge.example.com/api/v1/telemetry/dlq-status');
        expect(init.headers.Authorization).toBe('Bearer jwt');
        expect(result.current.data.unsynced_relays_depth).toBe(7);
        expect(result.current.data.upstream_core_ok).toBe(true);
        expect(result.current.lastUpdatedAt).toBeTypeOf('number');
        unmount();
    });

    it('reports offline before the first success and stale afterwards', async () => {
        const fetchImpl = vi
            .fn()
            .mockRejectedValueOnce(new Error('edge unreachable'))
            .mockResolvedValueOnce(jsonResponse(200, LIVE_BODY))
            .mockRejectedValueOnce(new Error('edge unreachable again'));

        const { result, unmount } = renderHook(() =>
            useDlqStatus({ apiUrl: '', token: null, fetchImpl, intervalMs: 60000 }),
        );

        await waitFor(() => expect(result.current.status).toBe('offline'));
        expect(result.current.error).toBe('edge unreachable');

        await act(async () => {
            await result.current.refresh();
        });
        await waitFor(() => expect(result.current.status).toBe('live'));
        expect(result.current.error).toBeNull();

        await act(async () => {
            await result.current.refresh();
        });
        await waitFor(() => expect(result.current.status).toBe('stale'));
        expect(result.current.data.unsynced_relays_depth).toBe(7);
        expect(result.current.consecutiveFailures).toBe(1);
        unmount();
    });

    it('treats a non-2xx answer as a failure', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' }));
        const { result, unmount } = renderHook(() =>
            useDlqStatus({ apiUrl: '', token: null, fetchImpl, intervalMs: 60000 }),
        );
        await waitFor(() => expect(result.current.status).toBe('offline'));
        expect(result.current.error).toContain('401');
        unmount();
    });

    it('does not poll when disabled', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, LIVE_BODY));
        const { unmount } = renderHook(() =>
            useDlqStatus({ apiUrl: '', token: null, fetchImpl, enabled: false }),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fetchImpl).not.toHaveBeenCalled();
        unmount();
    });
});
