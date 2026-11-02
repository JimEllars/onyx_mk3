import { describe, it, expect, vi } from 'vitest';
import {
    classifyDecision,
    decisionLabel,
    HITL_ENDPOINT,
    HITL_OUTCOME,
    submitHitlDecision,
} from '../../lib/hitlDecision';

function jsonResponse(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
    };
}

describe('classifyDecision', () => {
    it('treats 200 + applied as approved', () => {
        const result = classifyDecision({
            httpStatus: 200,
            body: { success: true, applied: true, recorded: true, core_status: 200 },
            decision: 'approve',
        });
        expect(result.outcome).toBe(HITL_OUTCOME.APPROVED);
        expect(result.applied).toBe(true);
        expect(result.coreStatus).toBe(200);
    });

    it('treats 200 + applied as rejected for a reject decision', () => {
        const result = classifyDecision({ httpStatus: 200, body: { applied: true }, decision: 'reject' });
        expect(result.outcome).toBe(HITL_OUTCOME.REJECTED);
    });

    it('keeps a recorded-but-unapplied decision visible as QUEUED', () => {
        // The edge answers 502 when Core refused: the decision is in KV but
        // nothing resumed. Collapsing this to FAILED hid the retry.
        const result = classifyDecision({
            httpStatus: 502,
            body: { applied: false, recorded: true, core_status: 500, reason: 'core rejected' },
            decision: 'approve',
        });
        expect(result.outcome).toBe(HITL_OUTCOME.QUEUED);
        expect(result.recorded).toBe(true);
        expect(result.applied).toBe(false);
        expect(result.reason).toBe('core rejected');
    });

    it('treats an auth failure as failed', () => {
        const result = classifyDecision({ httpStatus: 401, body: null, decision: 'approve' });
        expect(result.outcome).toBe(HITL_OUTCOME.FAILED);
        expect(result.recorded).toBe(false);
    });
});

describe('submitHitlDecision', () => {
    it('posts to the canonical endpoint with a normalised decision', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, { applied: true, recorded: true }));

        const result = await submitHitlDecision({
            actionId: 'act-1',
            decision: 'reject',
            token: 'passport-jwt',
            apiUrl: 'https://edge.example.com',
            fetchImpl,
        });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(`https://edge.example.com${HITL_ENDPOINT}`);
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer passport-jwt');
        expect(JSON.parse(init.body)).toEqual({ action_id: 'act-1', decision: 'reject' });
        expect(result.outcome).toBe(HITL_OUTCOME.REJECTED);
        expect(result.httpStatus).toBe(200);
    });

    it('sends operator notes when provided', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse(200, { applied: true }));
        await submitHitlDecision({
            actionId: 'act-2',
            decision: 'approve',
            operatorNotes: 'checked the diff',
            fetchImpl,
        });
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).operator_notes).toBe('checked the diff');
    });

    it('reports a transport failure instead of throwing', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new Error('network down');
        });
        const result = await submitHitlDecision({ actionId: 'a', decision: 'approve', fetchImpl });
        expect(result.outcome).toBe(HITL_OUTCOME.FAILED);
        expect(result.httpStatus).toBe(0);
        expect(result.reason).toBe('network down');
    });

    it('survives a non-JSON error body', async () => {
        const fetchImpl = vi.fn(async () => ({
            status: 503,
            ok: false,
            json: async () => {
                throw new Error('not json');
            },
        }));
        const result = await submitHitlDecision({ actionId: 'a', decision: 'approve', fetchImpl });
        expect(result.outcome).toBe(HITL_OUTCOME.FAILED);
        expect(result.httpStatus).toBe(503);
    });
});

describe('decisionLabel', () => {
    it('spells out a queued decision', () => {
        expect(decisionLabel({ outcome: HITL_OUTCOME.QUEUED })).toBe('RECORDED · CORE UNREACHABLE');
        expect(decisionLabel({ outcome: HITL_OUTCOME.APPROVED })).toBe('APPROVED');
        expect(decisionLabel({ outcome: 'PENDING' })).toBe('PENDING');
        expect(decisionLabel(null)).toBe('PENDING');
    });
});
