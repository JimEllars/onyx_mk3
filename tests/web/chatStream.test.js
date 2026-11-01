import test from 'node:test';
import assert from 'node:assert/strict';

import {
    describeJsonResponse,
    extractSseData,
    isEventStream,
    normalizeStreamPayload,
    splitSseFrames,
} from '../../src/lib/chatStream.js';

/**
 * Mirrors `textSsePayload()` in edge-bridge/src/index.ts so the fixture cannot
 * drift from the real wire format without a test failing.
 */
const EDGE_SSE_PAYLOAD =
    'event: message_start\n' +
    'data: {"type":"message_start","message":{"model":"deepseek-chat"}}\n\n' +
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n\n' +
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"operator."}}\n\n' +
    'event: message_delta\n' +
    'data: {"type":"message_delta","usage":{"output_tokens":15}}\n\n' +
    'event: message_stop\n' +
    'data: {}\n\n' +
    'data: [DONE]\n\n';

test('splitSseFrames keeps the trailing partial frame in rest', () => {
    const { frames, rest } = splitSseFrames('data: a\n\ndata: b\n\ndata: par');
    assert.deepEqual(frames, ['data: a', 'data: b']);
    assert.equal(rest, 'data: par');
});

test('splitSseFrames tolerates empty input', () => {
    assert.deepEqual(splitSseFrames(''), { frames: [], rest: '' });
});

test('extractSseData ignores event: lines and keepalive comments', () => {
    assert.deepEqual(extractSseData('event: message_stop\ndata: {}'), ['{}']);
    assert.deepEqual(extractSseData(': keepalive'), []);
    assert.deepEqual(extractSseData(': connected'), []);
});

test('content_block_delta yields a text delta (the shape the HUD used to drop)', () => {
    const event = normalizeStreamPayload(
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}',
    );
    assert.deepEqual(event, { kind: 'delta', text: 'Hello ' });
});

test('the edge SSE fixture reassembles the full assistant reply', () => {
    const { frames } = splitSseFrames(EDGE_SSE_PAYLOAD);
    let text = '';
    let sawDone = false;

    for (const frame of frames) {
        for (const data of extractSseData(frame)) {
            const event = normalizeStreamPayload(data);
            if (event.kind === 'delta') text += event.text;
            if (event.kind === 'done') sawDone = true;
        }
    }

    assert.equal(text, 'Hello operator.');
    assert.equal(sawDone, true);
});

test('legacy {chunk} and OpenAI-style deltas still parse', () => {
    assert.deepEqual(normalizeStreamPayload('{"chunk":"a"}'), { kind: 'delta', text: 'a' });
    assert.deepEqual(
        normalizeStreamPayload('{"choices":[{"delta":{"content":"b"}}]}'),
        { kind: 'delta', text: 'b' },
    );
});

test('status and tool frames are distinguished from text', () => {
    assert.deepEqual(
        normalizeStreamPayload('{"type":"status","state":"WAITING_ON_USER"}'),
        { kind: 'status', state: 'WAITING_ON_USER' },
    );
    assert.deepEqual(
        normalizeStreamPayload('{"type":"tool_start","tool_name":"read_file"}'),
        { kind: 'tool', name: 'read_file', started: true },
    );
    assert.deepEqual(
        normalizeStreamPayload('{"type":"tool_finish","tool_name":"read_file"}'),
        { kind: 'tool', name: 'read_file', started: false },
    );
});

test('lifecycle frames are recognised but not rendered', () => {
    for (const type of ['message_start', 'message_delta', 'message_stop']) {
        assert.deepEqual(normalizeStreamPayload(JSON.stringify({ type })), { kind: 'ignore' });
    }
    assert.deepEqual(normalizeStreamPayload('{"type":"content_block_delta","delta":{}}'), {
        kind: 'ignore',
    });
});

test('non-JSON payloads are treated as raw text', () => {
    assert.deepEqual(normalizeStreamPayload('plain token'), { kind: 'delta', text: 'plain token' });
});

test('[DONE] terminates the stream', () => {
    assert.deepEqual(normalizeStreamPayload('[DONE]'), { kind: 'done' });
});

test('queued JSON acknowledgement becomes a visible assistant line', () => {
    const body = { status: 'success', message: 'Summon payload queued successfully.' };
    assert.deepEqual(describeJsonResponse(body, 200), {
        text: 'Summon payload queued successfully.',
        queued: true,
    });
});

test('JSON error bodies surface the upstream message', () => {
    const body = { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'AXiM Core unavailable.' } };
    assert.deepEqual(describeJsonResponse(body, 503), {
        text: 'AXiM Core unavailable.',
        queued: false,
    });
    assert.equal(describeJsonResponse(null, 500).text, 'Request failed (HTTP 500).');
});

test('isEventStream detects the SSE content type only', () => {
    assert.equal(isEventStream('text/event-stream; charset=utf-8'), true);
    assert.equal(isEventStream('application/json'), false);
    assert.equal(isEventStream(undefined), false);
});
