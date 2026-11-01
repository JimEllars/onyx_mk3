import test from 'node:test';
import assert from 'node:assert/strict';

import {
    collectRcaRecords,
    computeErrorRate,
    formatRcaJson,
    isFailureEvent,
    isServerError,
    summarizeDlqStatus,
    toRcaRecord,
} from '../../src/lib/rca.js';

test('isServerError covers 5xx only', () => {
    assert.equal(isServerError(500), true);
    assert.equal(isServerError(503), true);
    assert.equal(isServerError(599), true);
    assert.equal(isServerError(499), false);
    assert.equal(isServerError(600), false);
    assert.equal(isServerError('500'), true);
    assert.equal(isServerError(null), false);
    assert.equal(isServerError('boom'), false);
});

test('failure detection reads status_code, status and level', () => {
    assert.equal(isFailureEvent({ status_code: 502 }), true);
    assert.equal(isFailureEvent({ status: 500 }), true);
    assert.equal(isFailureEvent({ level: 'error' }), true);
    assert.equal(isFailureEvent({ status: 'ok', status_code: 200 }), false);
    assert.equal(isFailureEvent(null), false);
});

test('toRcaRecord normalises a micro-app error', () => {
    const record = toRcaRecord({
        micro_app: 'speedreport',
        status_code: 502,
        error: { message: 'upstream timeout' },
        trace_id: 'abc123',
        timestamp: '2026-11-01T10:00:00Z',
    });
    assert.equal(record.app, 'speedreport');
    assert.equal(record.statusCode, 502);
    assert.equal(record.message, 'upstream timeout');
    assert.equal(record.traceId, 'abc123');
    assert.equal(record.id, 'trace:abc123');
});

test('toRcaRecord fills gaps instead of emitting undefined', () => {
    const record = toRcaRecord({}, 7);
    assert.equal(record.app, 'unknown-app');
    assert.equal(record.statusCode, null);
    assert.equal(record.message, 'No message supplied.');
    assert.equal(record.traceId, null);
    assert.equal(record.id, 'evt:na:7');
});

test('collectRcaRecords returns failures newest-first and skips healthy events', () => {
    const events = [
        { micro_app: 'a', status_code: 200, message: 'ok' },
        { micro_app: 'b', status_code: 500, message: 'first failure' },
        { micro_app: 'c', status_code: 200, message: 'ok' },
        { micro_app: 'd', status_code: 504, message: 'second failure' },
    ];
    const records = collectRcaRecords(events);
    assert.equal(records.length, 2);
    assert.equal(records[0].message, 'second failure');
    assert.equal(records[1].message, 'first failure');
});

test('collectRcaRecords honours the limit and bad input', () => {
    const events = Array.from({ length: 40 }, (_, i) => ({ status_code: 500, id: `e${i}` }));
    assert.equal(collectRcaRecords(events, 5).length, 5);
    assert.deepEqual(collectRcaRecords(null), []);
    assert.deepEqual(collectRcaRecords('nope'), []);
});

test('summarizeDlqStatus totals both depths and flags health', () => {
    const summary = summarizeDlqStatus({
        unsynced_relays_depth: 3,
        unsynced_receipts_depth: 4,
        edge_circuit_breaker: 'closed',
        upstream_core_ok: true,
        timestamp: '2026-11-01T10:00:00Z',
    });
    assert.deepEqual(summary, {
        relays: 3,
        receipts: 4,
        total: 7,
        circuitBreaker: 'closed',
        upstreamCoreOk: true,
        reportedAt: '2026-11-01T10:00:00Z',
        healthy: true,
    });
});

test('summarizeDlqStatus reports unhealthy when Core is down or breaker open', () => {
    assert.equal(summarizeDlqStatus({ upstream_core_ok: false }).healthy, false);
    assert.equal(summarizeDlqStatus({ edge_circuit_breaker: 'open' }).healthy, false);
    assert.equal(summarizeDlqStatus(undefined).total, 0);
    assert.equal(summarizeDlqStatus(null).upstreamCoreOk, true);
});

test('computeErrorRate rounds to whole percent', () => {
    assert.equal(computeErrorRate([]), 0);
    assert.equal(computeErrorRate(null), 0);
    assert.equal(computeErrorRate([{ status_code: 200 }, { status_code: 500 }]), 50);
    assert.equal(
        computeErrorRate([{ status_code: 500 }, { status_code: 200 }, { status_code: 200 }]),
        33,
    );
});

test('formatRcaJson pretty-prints and survives cycles', () => {
    assert.equal(formatRcaJson({ a: 1 }), '{\n  "a": 1\n}');
    const cyclic = {};
    cyclic.self = cyclic;
    assert.equal(typeof formatRcaJson(cyclic), 'string');
});
