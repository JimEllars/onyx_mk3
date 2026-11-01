// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import useDesktopAgentStore from '../../../store/useDesktopAgentStore';
import ActionConsole from '../ActionConsole';

const DLQ_BODY = {
    status: 'healthy',
    unsynced_relays_depth: 7,
    unsynced_receipts_depth: 2,
    edge_circuit_breaker: 'closed',
    upstream_core_ok: true,
};

function jsonResponse(status, body) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
}

let actionSeq = 0;

function pendingAction(overrides = {}) {
    actionSeq += 1;
    return {
        // Unique per test: the console retires a decided ticket on a 1.5s timer,
        // and a stale timer must not delete the next test's ticket.
        id: `act-${actionSeq}-1234567890`,
        tool_name: 'deploy_worker',
        risk_level: 'MEDIUM',
        description: 'Deploy the edge worker to production.',
        params: { target: 'edge-bridge' },
        status: 'PENDING',
        timestamp: Date.now(),
        ...overrides,
    };
}

function seed(events = [], actions = [pendingAction()]) {
    useDesktopAgentStore.setState({
        pendingHitlActions: actions,
        telemetryEvents: events,
        eventBuffer: [],
        pendingUpdate: false,
    });
}

beforeEach(() => {
    localStorage.setItem('axim_passport_token', 'passport-jwt');
});

afterEach(() => {
    localStorage.clear();
    useDesktopAgentStore.setState({ pendingHitlActions: [], telemetryEvents: [] });
    vi.unstubAllGlobals();
});

describe('ActionConsole DLQ telemetry', () => {
    it('renders the polled queue depth instead of synthesised numbers', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse(200, DLQ_BODY)),
        );
        seed();

        render(<ActionConsole />);

        await waitFor(() => expect(screen.getByText('9')).toBeTruthy()); // 7 relays + 2 receipts
        expect(screen.getByText('UP')).toBeTruthy();
        expect(screen.getByText('LIVE')).toBeTruthy();
        expect(fetch).toHaveBeenCalledWith(
            '/api/v1/telemetry/dlq-status',
            expect.objectContaining({
                method: 'GET',
                headers: { Authorization: 'Bearer passport-jwt' },
            }),
        );
    });

    it('shows the failure reason when the edge will not answer', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' })),
        );
        seed();

        render(<ActionConsole />);

        await waitFor(() => expect(screen.getByText(/dlq-status: dlq-status HTTP 401/)).toBeTruthy());
        expect(screen.getByText('OFFLINE')).toBeTruthy();
    });
});

describe('ActionConsole HITL relay', () => {
    it('posts to the canonical /api/v1/hitl/action endpoint', async () => {
        const fetchMock = vi.fn(async (url, init) => {
            if (url.includes('dlq-status')) return jsonResponse(200, DLQ_BODY);
            return jsonResponse(200, { applied: true, recorded: true, core_status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        seed();

        render(<ActionConsole />);
        fireEvent.click(screen.getByText('APPROVE (Y)'));

        await waitFor(() => {
            const hitlCall = fetchMock.mock.calls.find(([url]) => url.includes('/api/v1/hitl/action'));
            expect(hitlCall).toBeTruthy();
        });

        const [url, init] = fetchMock.mock.calls.find(([u]) => u.includes('/api/v1/hitl/action'));
        expect(url).toBe('/api/v1/hitl/action');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            action_id: useDesktopAgentStore.getState().pendingHitlActions[0].id,
            decision: 'approve',
        });
        await waitFor(() => expect(screen.getByText('APPROVED')).toBeTruthy());
    });

    it('keeps a recorded-but-unapplied decision visible with the Core reason', async () => {
        // 502 + recorded:true means the decision is in KV but Core refused it.
        const fetchMock = vi.fn(async (url) =>
            url.includes('dlq-status')
                ? jsonResponse(200, DLQ_BODY)
                : jsonResponse(502, { applied: false, recorded: true, core_status: 500, reason: 'core rejected' }),
        );
        vi.stubGlobal('fetch', fetchMock);
        seed();

        render(<ActionConsole />);
        fireEvent.click(screen.getByText('REJECT (N)'));

        await waitFor(() =>
            expect(screen.getByText('RECORDED · CORE UNREACHABLE — core rejected')).toBeTruthy(),
        );
        // The ticket must not be retired: the operator still has work to do.
        expect(useDesktopAgentStore.getState().pendingHitlActions).toHaveLength(1);
    });
});

describe('ActionConsole RCA inspector', () => {
    it('opens a drawer with the structured RCA of a 5xx event', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, DLQ_BODY)));
        seed([
            {
                id: 'evt-1',
                micro_app: 'support-system',
                status_code: 503,
                timestamp: Date.parse('2026-11-01T16:00:00Z'),
                rca: { failure_domain: 'upstream_timeout', retry_after_ms: 2000 },
            },
        ]);

        render(<ActionConsole />);

        await waitFor(() => expect(screen.getByText(/support-system · 503/)).toBeTruthy());
        fireEvent.click(screen.getByText('RCA'));

        const drawer = await screen.findByRole('dialog', { name: 'RCA inspector' });
        expect(drawer.textContent).toContain('upstream_timeout');
        expect(drawer.textContent).toContain('support-system');

        fireEvent.click(screen.getByLabelText('Close RCA inspector'));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'RCA inspector' })).toBeNull());
    });

    it('falls back to the raw event when no RCA block was shipped', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, DLQ_BODY)));
        seed([{ id: 'evt-2', micro_app: 'nexus-crm', status_code: 500, raw_error: 'boom' }]);

        render(<ActionConsole />);
        await waitFor(() => expect(screen.getByText(/nexus-crm · 500/)).toBeTruthy());
        fireEvent.click(screen.getByText('RCA'));

        const drawer = await screen.findByRole('dialog', { name: 'RCA inspector' });
        expect(drawer.textContent).toContain('raw_error');
        expect(drawer.textContent).toMatch(/no structured RCA block/i);
    });

    it('ignores 4xx events', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, DLQ_BODY)));
        seed([{ id: 'evt-3', micro_app: 'speedreport', status_code: 404 }]);

        render(<ActionConsole />);
        await waitFor(() => expect(screen.getByText('COMMAND HUB')).toBeTruthy());
        expect(screen.queryByText('RCA')).toBeNull();
    });
});
