/**
 * Parsing helpers for the Edge Bridge chat stream.
 *
 * `/api/v1/onyx/summon` answers in one of two shapes depending on whether AXiM
 * Core accepted the payload:
 *
 *   1. `application/json`  -> `{ status: "success", message: "..." }` (queued)
 *   2. `text/event-stream` -> Anthropic-shaped SSE frames emitted by
 *      `textSsePayload()` in `edge-bridge/src/index.ts`:
 *
 *          event: content_block_delta
 *          data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
 *
 * The HUD previously only understood a third, non-existent shape
 * (`{"chunk": "..."}`), so assistant text was silently dropped on both paths.
 * These helpers are pure so they can be unit-tested without a DOM.
 */

export const SSE_FRAME_SEPARATOR = '\n\n';

const TOOL_START = new Set(['tool_start', 'tool_use']);
const TOOL_FINISH = new Set(['tool_finish', 'tool_result']);

/**
 * Split a raw SSE buffer into complete frames plus the trailing partial frame.
 *
 * @param {string} buffer
 * @returns {{ frames: string[], rest: string }}
 */
export function splitSseFrames(buffer) {
    if (!buffer) return { frames: [], rest: '' };
    const parts = buffer.split(SSE_FRAME_SEPARATOR);
    const rest = parts.pop() ?? '';
    return { frames: parts, rest };
}

/**
 * Pull the payload strings out of a single SSE frame.
 *
 * A frame may carry several `data:` lines (they are concatenated per the SSE
 * spec) and may carry an `event:` line we do not need. Comment frames that
 * start with `:` (keepalives from `/events`) yield nothing.
 *
 * @param {string} frame
 * @returns {string[]}
 */
export function extractSseData(frame) {
    if (!frame) return [];
    const dataLines = [];
    for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(line.startsWith('data: ') ? 6 : 5));
        }
    }
    return dataLines.length > 0 ? [dataLines.join('\n')] : [];
}

/**
 * Normalise one decoded SSE/JSON payload into an event the HUD understands.
 *
 * Returned kinds:
 *   - `delta`    { text }            append to the open assistant bubble
 *   - `status`   { state }           provider/routing status line
 *   - `tool`     { name, started }   swarm tool lifecycle
 *   - `done`                          stream finished
 *   - `ignore`                        recognised but not rendered
 *
 * @param {string} raw
 * @returns {{ kind: 'delta', text: string }
 *          | { kind: 'status', state: string }
 *          | { kind: 'tool', name: string, started: boolean }
 *          | { kind: 'done' }
 *          | { kind: 'ignore' }}
 */
export function normalizeStreamPayload(raw) {
    if (typeof raw !== 'string') return { kind: 'ignore' };
    const trimmed = raw.trim();
    if (!trimmed) return { kind: 'ignore' };
    if (trimmed === '[DONE]') return { kind: 'done' };

    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        // Plain-text chunk (some upstreams stream raw tokens).
        return { kind: 'delta', text: raw };
    }
    if (!parsed || typeof parsed !== 'object') return { kind: 'ignore' };

    const type = typeof parsed.type === 'string' ? parsed.type : '';

    // Anthropic-style content deltas, as produced by textSsePayload().
    if (type === 'content_block_delta') {
        const delta = parsed.delta ?? {};
        if (typeof delta.text === 'string') return { kind: 'delta', text: delta.text };
        if (typeof delta.partial_json === 'string') return { kind: 'ignore' };
        return { kind: 'ignore' };
    }

    // Legacy shape the old HUD expected. Kept so a Core that streams
    // `{chunk: "..."}` keeps working.
    if (typeof parsed.chunk === 'string') return { kind: 'delta', text: parsed.chunk };

    // OpenAI-style choices[0].delta.content
    const choiceText = parsed.choices?.[0]?.delta?.content;
    if (typeof choiceText === 'string') return { kind: 'delta', text: choiceText };

    if (type === 'status' && typeof parsed.state === 'string') {
        return { kind: 'status', state: parsed.state };
    }

    if (TOOL_START.has(type)) {
        return { kind: 'tool', name: parsed.tool_name || parsed.name || 'tool', started: true };
    }
    if (TOOL_FINISH.has(type)) {
        return { kind: 'tool', name: parsed.tool_name || parsed.name || 'tool', started: false };
    }

    if (type === 'message_stop' || type === 'message_delta' || type === 'message_start') {
        return { kind: 'ignore' };
    }

    // A queued-acknowledgement body served as SSE without frames.
    if (typeof parsed.message === 'string' && typeof parsed.status === 'string') {
        return { kind: 'delta', text: parsed.message };
    }

    return { kind: 'ignore' };
}

/**
 * Describe a non-streamed JSON response body.
 *
 * `POST /api/v1/onyx/summon` returns `{ status: "success", message: "Summon
 * payload queued successfully." }` when Core accepts the payload. The HUD must
 * surface that instead of leaving an empty assistant bubble.
 *
 * @param {unknown} body
 * @param {number} httpStatus
 * @returns {{ text: string, queued: boolean }}
 */
export function describeJsonResponse(body, httpStatus) {
    const status = typeof body?.status === 'string' ? body.status : null;
    const message = typeof body?.message === 'string' ? body.message : '';
    const errorMessage =
        typeof body?.error === 'string'
            ? body.error
            : typeof body?.error?.message === 'string'
              ? body.error.message
              : '';

    const ok = httpStatus >= 200 && httpStatus < 300;
    if (ok) {
        return {
            text: message || (status === 'success' ? 'Dispatched to AXiM Core.' : 'Request accepted.'),
            queued: status === 'success' || status === 'queued',
        };
    }

    return {
        text: errorMessage || message || `Request failed (HTTP ${httpStatus}).`,
        queued: false,
    };
}

/**
 * True when a response should be treated as an event stream.
 *
 * @param {string | null | undefined} contentType
 * @returns {boolean}
 */
export function isEventStream(contentType) {
    return typeof contentType === 'string' && contentType.toLowerCase().includes('text/event-stream');
}
