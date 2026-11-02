// HITL decision relay for the cockpit.
//
// The edge worker's `POST /api/v1/hitl/action` answers 200 only when Core
// accepted the decision. A 502/503 means the decision was *recorded* in
// HITL_APPROVAL_KV but not applied upstream — the previous console collapsed
// that into a bare "FAILED", which told the operator nothing about whether they
// needed to retry. This module keeps the distinction.

export const HITL_ENDPOINT = '/api/v1/hitl/action';

export const HITL_OUTCOME = {
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    QUEUED: 'QUEUED',
    FAILED: 'FAILED',
};

/**
 * Normalise a decision body returned by the edge bridge.
 *
 * - 200 + applied    -> APPROVED / REJECTED
 * - non-200 + recorded -> QUEUED (Core unreachable; operator must retry)
 * - anything else    -> FAILED
 */
export function classifyDecision({ httpStatus, body, decision }) {
    const applied = Boolean(body?.applied ?? (httpStatus === 200 && body?.success));
    const recorded = Boolean(body?.recorded);
    const coreStatus = typeof body?.core_status === 'number' ? body.core_status : null;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;
    const approved = decision === 'approve';

    if (httpStatus === 200 && applied) {
        return {
            outcome: approved ? HITL_OUTCOME.APPROVED : HITL_OUTCOME.REJECTED,
            applied: true,
            recorded,
            coreStatus,
            reason,
        };
    }

    if (recorded) {
        return { outcome: HITL_OUTCOME.QUEUED, applied: false, recorded: true, coreStatus, reason };
    }

    return { outcome: HITL_OUTCOME.FAILED, applied: false, recorded: false, coreStatus, reason };
}

/**
 * Relay a decision to the edge bridge.
 *
 * Returns the classified outcome instead of throwing, so the caller can always
 * render something truthful — including the transport failure case, which has no
 * HTTP status at all.
 */
export async function submitHitlDecision({
    actionId,
    decision,
    token,
    apiUrl = '',
    fetchImpl = fetch,
    operatorNotes,
}) {
    const normalized = decision === 'reject' ? 'reject' : 'approve';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
        response = await fetchImpl(`${apiUrl}${HITL_ENDPOINT}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action_id: actionId,
                decision: normalized,
                ...(operatorNotes ? { operator_notes: operatorNotes } : {}),
            }),
        });
    } catch (error) {
        return {
            outcome: HITL_OUTCOME.FAILED,
            applied: false,
            recorded: false,
            coreStatus: null,
            reason: error instanceof Error ? error.message : 'transport error',
            httpStatus: 0,
        };
    }

    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }

    return {
        ...classifyDecision({ httpStatus: response.status, body, decision: normalized }),
        httpStatus: response.status,
    };
}

/** Operator-facing label for an outcome, including why a decision queued. */
export function decisionLabel(result) {
    switch (result?.outcome) {
        case HITL_OUTCOME.APPROVED:
            return 'APPROVED';
        case HITL_OUTCOME.REJECTED:
            return 'REJECTED';
        case HITL_OUTCOME.QUEUED:
            return 'RECORDED · CORE UNREACHABLE';
        case HITL_OUTCOME.FAILED:
            return 'FAILED';
        default:
            return 'PENDING';
    }
}
