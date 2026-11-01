import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BACKOFF_MAX_MS,
    computeBackoffDelay,
    connectionBadgeClasses,
    isRetryableStatus,
    toConnectionBadge,
} from '../../src/lib/connectionState.js';

const noJitter = () => 0;

test('backoff grows exponentially from 1s', () => {
    for (const [attempt, expected] of [
        [0, 1000],
        [1, 2000],
        [2, 4000],
        [3, 8000],
        [4, 16000],
    ]) {
        assert.equal(computeBackoffDelay(attempt, { random: noJitter }), expected);
    }
});

test('backoff is clamped to the 30s ceiling', () => {
    for (const attempt of [5, 6, 10, 50]) {
        assert.equal(computeBackoffDelay(attempt, { random: noJitter }), BACKOFF_MAX_MS);
    }
});

test('jitter never pushes the delay past the ceiling', () => {
    const worstCase = () => 0.999999;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const delay = computeBackoffDelay(attempt, { random: worstCase });
        assert.ok(delay <= BACKOFF_MAX_MS, `attempt ${attempt} gave ${delay}`);
        assert.ok(delay >= 1000, `attempt ${attempt} gave ${delay}`);
    }
});

test('invalid attempts are treated as the first retry', () => {
    assert.equal(computeBackoffDelay(-3, { random: noJitter }), 1000);
    assert.equal(computeBackoffDelay(Number.NaN, { random: noJitter }), 1000);
});

test('internal statuses collapse to the three operator states', () => {
    const cases = {
        ONLINE: 'ONLINE',
        CONNECTED: 'ONLINE',
        ACTIVE: 'ONLINE',
        CONNECTING: 'RECONNECTING',
        RECONNECTING: 'RECONNECTING',
        'RECONNECT NEEDED': 'RECONNECTING',
        OFFLINE: 'OFFLINE',
        DISCONNECTED: 'OFFLINE',
        '': 'OFFLINE',
        undefined: 'OFFLINE',
        nonsense: 'OFFLINE',
    };
    for (const [input, expected] of Object.entries(cases)) {
        assert.equal(toConnectionBadge(input === 'undefined' ? undefined : input), expected);
    }
});

test('badge classes are distinct per state', () => {
    assert.equal(connectionBadgeClasses('ONLINE').text, 'text-emerald-500');
    assert.equal(connectionBadgeClasses('RECONNECTING').dot, 'bg-amber-500 animate-pulse');
    assert.equal(connectionBadgeClasses('OFFLINE').text, 'text-red-500');
});

test('only transient upstream failures are retryable', () => {
    for (const status of [429, 502, 503, 504]) {
        assert.equal(isRetryableStatus(status), true, `status ${status}`);
    }
    for (const status of [400, 401, 403, 404, 500]) {
        assert.equal(isRetryableStatus(status), false, `status ${status}`);
    }
});
