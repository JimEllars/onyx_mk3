import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logError, logRequest } from '../src/logging';

const here = dirname(fileURLToPath(import.meta.url));

function lastJsonLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  const raw = spy.mock.calls[0][0] as string;
  expect(typeof raw).toBe('string');
  return JSON.parse(raw) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logError', () => {
  it('emits one parseable line carrying the event and the error message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logError('edge.kv.read_timeout', new Error('KV read exceeded 500ms'), {
      trace_id: 'abc-123',
    });

    expect(lastJsonLine(spy)).toEqual({
      level: 'error',
      event: 'edge.kv.read_timeout',
      message: 'KV read exceeded 500ms',
      error_name: 'Error',
      trace_id: 'abc-123',
    });
  });

  it('names the failure even when nothing was thrown', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logError('edge.kv.write_timeout', undefined, { timeout_ms: 500 });

    expect(lastJsonLine(spy)).toEqual({
      level: 'error',
      event: 'edge.kv.write_timeout',
      timeout_ms: 500,
    });
  });

  it.each([
    ['a string throw', 'upstream 502', 'upstream 502'],
    ['a number throw', 42, '42'],
    ['a non-Error object', { code: 'E_AI' }, '[object Object]'],
  ])('normalises %s', (_label, thrown, message) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logError('edge.llm.fallback_triggered', thrown);

    expect(lastJsonLine(spy).message).toBe(message);
  });

  it('drops undefined context values instead of serialising them', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logError('edge.request.unhandled', undefined, {
      trace_id: undefined,
      route: '/api/v1/onyx/summon',
    });

    expect(lastJsonLine(spy)).toEqual({
      level: 'error',
      event: 'edge.request.unhandled',
      route: '/api/v1/onyx/summon',
    });
  });

  it('never throws when the context cannot be serialised', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => logError('edge.request.unhandled', new Error('boom'), { circular })).not.toThrow();

    const raw = spy.mock.calls[0][0] as string;
    expect(JSON.parse(raw)).toEqual({
      level: 'error',
      event: 'edge.request.unhandled',
      unserializable_context: true,
    });
  });
});

describe('logRequest', () => {
  it('logs at info level so healthy traffic stays out of the error stream', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logRequest('edge.request.completed', {
      method: 'POST',
      path: '/api/v1/onyx/summon',
      status: 200,
      duration_ms: 12.5,
      trace_id: 'trace-1',
    });

    expect(lastJsonLine(spy)).toEqual({
      level: 'info',
      event: 'edge.request.completed',
      method: 'POST',
      path: '/api/v1/onyx/summon',
      status: 200,
      duration_ms: 12.5,
      trace_id: 'trace-1',
    });
  });
});

describe('index.ts call sites', () => {
  const source = readFileSync(resolve(here, '../src/index.ts'), 'utf8');

  it('has no bare console.error("error") left', () => {
    // Each of these named neither the subsystem nor the request, so a production
    // log line could not be traced back to anything. All 21 were replaced with
    // logError("edge.<subsystem>.<what_happened>", err, context).
    const bare = source
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /console\.error\(\s*["']error["']\s*\)/.test(line));

    expect(bare).toEqual([]);
  });

  it('logs every error through logError so the event vocabulary stays uniform', () => {
    const direct = source
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /console\.error\(/.test(line));

    expect(direct).toEqual([]);
  });
});
