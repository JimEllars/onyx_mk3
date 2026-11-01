/**
 * Root-cause-analysis helpers for the Action Console.
 *
 * `GET /api/v1/telemetry/dlq-status` returns aggregate depths, not individual
 * failures:
 *
 *     { status, timestamp, unsynced_relays_depth, unsynced_receipts_depth,
 *       edge_circuit_breaker, upstream_core_ok }
 *
 * Individual failures arrive on the telemetry event stream. The inspector
 * therefore joins the two: depths for the header, per-event records for the
 * payload drawer.
 */

const SERVER_ERROR_FLOOR = 500;
const SERVER_ERROR_CEIL = 600;

/**
 * True for HTTP 5xx.
 *
 * @param {unknown} statusCode
 * @returns {boolean}
 */
export function isServerError(statusCode) {
    const code = Number(statusCode);
    return Number.isFinite(code) && code >= SERVER_ERROR_FLOOR && code < SERVER_ERROR_CEIL;
}

/**
 * Best-effort numeric status out of a loosely typed telemetry event.
 *
 * @param {Record<string, any>} event
 * @returns {number | null}
 */
function readStatusCode(event) {
    const candidates = [
        event.statusCode,
        event.status_code,
        event.http_status,
        event.status,
        event.response?.status,
    ];
    for (const candidate of candidates) {
        const code = Number(candidate);
        if (Number.isFinite(code) && code >= 100 && code < 600) return code;
    }
    return null;
}

/**
 * True when an event looks like a failure worth inspecting.
 *
 * @param {Record<string, any>} event
 * @returns {boolean}
 */
export function isFailureEvent(event) {
    if (!event || typeof event !== 'object') return false;
    const code = readStatusCode(event);
    if (isServerError(code)) return true;
    const level = String(event.level ?? event.status ?? '').toLowerCase();
    if (level === 'error' || level === 'fatal' || level === 'critical') return true;
    return event.ok === false;
}

/**
 * Normalise a telemetry event into an RCA record for the drawer.
 *
 * @param {Record<string, any>} event
 * @param {number} [index]
 * @returns {{ id: string, app: string, statusCode: number | null, message: string,
 *             traceId: string | null, timestamp: string | null, raw: Record<string, any> }}
 */
export function toRcaRecord(event, index = 0) {
    const safe = event && typeof event === 'object' ? event : {};
    const app =
        safe.micro_app ||
        safe.microApp ||
        safe.service ||
        safe.provider ||
        safe.source ||
        'unknown-app';

    const message =
        safe.message ||
        safe.error?.message ||
        safe.detail ||
        safe.reason ||
        (safe.error ? String(safe.error) : 'No message supplied.');

    const traceId = safe.trace_id || safe.traceId || safe['x-request-id'] || null;
    const timestamp = safe.timestamp || safe.ts || null;
    const statusCode = readStatusCode(safe);

    const id =
        safe.id ||
        safe.action_id ||
        (traceId ? `trace:${traceId}` : `evt:${timestamp ?? 'na'}:${index}`);

    return {
        id: String(id),
        app: String(app),
        statusCode,
        message: String(message),
        traceId: traceId ? String(traceId) : null,
        timestamp: timestamp ? String(timestamp) : null,
        raw: safe,
    };
}

/**
 * Collect every 5xx / error record from a telemetry buffer, newest first.
 *
 * @param {Array<Record<string, any>>} telemetryEvents
 * @param {number} [limit]
 * @returns {Array<ReturnType<typeof toRcaRecord>>}
 */
export function collectRcaRecords(telemetryEvents, limit = 25) {
    if (!Array.isArray(telemetryEvents)) return [];
    const records = [];
    telemetryEvents.forEach((event, index) => {
        if (isFailureEvent(event)) records.push(toRcaRecord(event, index));
    });
    // Newest first: telemetry is appended in arrival order.
    records.reverse();
    return records.slice(0, limit);
}

/**
 * Shape the DLQ depth response for display.
 *
 * @param {Record<string, any> | null | undefined} status
 * @returns {{ relays: number, receipts: number, total: number,
 *             circuitBreaker: string, upstreamCoreOk: boolean,
 *             reportedAt: string | null, healthy: boolean }}
 */
export function summarizeDlqStatus(status) {
    const safe = status && typeof status === 'object' ? status : {};
    const relays = Number(safe.unsynced_relays_depth ?? 0) || 0;
    const receipts = Number(safe.unsynced_receipts_depth ?? 0) || 0;
    const circuitBreaker = String(safe.edge_circuit_breaker ?? 'unknown');
    const upstreamCoreOk = safe.upstream_core_ok !== false;

    return {
        relays,
        receipts,
        total: relays + receipts,
        circuitBreaker,
        upstreamCoreOk,
        reportedAt: safe.timestamp ? String(safe.timestamp) : null,
        healthy: circuitBreaker === 'closed' && upstreamCoreOk,
    };
}

/**
 * Pretty-print a record for the drawer.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function formatRcaJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

/**
 * Error rate (0-100) across a telemetry buffer.
 *
 * @param {Array<Record<string, any>>} telemetryEvents
 * @returns {number}
 */
export function computeErrorRate(telemetryEvents) {
    if (!Array.isArray(telemetryEvents) || telemetryEvents.length === 0) return 0;
    const failures = telemetryEvents.filter(isFailureEvent).length;
    return Math.round((failures / telemetryEvents.length) * 100);
}
