/**
 * The cockpit path: mutating routes reachable with an operator credential.
 *
 * The global HMAC gate demands `X-Axim-Signature`, an HMAC over the raw body
 * keyed with `AXIM_INTERNAL_KEY`. A browser cannot produce one and must never
 * hold the key, so before this fix the HUD's Approve/Reject and playbook buttons
 * were answered by the gate — 401 "Missing x-axim-signature header" — and their
 * handlers never ran. The handler-level tests did not catch it because they
 * signed with `AXIM_INTERNAL_KEY`, which is the server-to-server path.
 *
 * These tests drive the worker the way the cockpit does (bearer only, no
 * signature), and pin the two properties that make the fix safe:
 *
 *   - an unregistered mutating route is still HMAC-only, so this is not a
 *     general widening of the gate;
 *   - the handler still calls `checkAuth()` itself, so the gate is not the only
 *     thing standing between a request and the action.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../src/index';
import {
  OPERATOR_AUTH_ROUTES,
  findOperatorAuthRoute,
  requiresSuperUser,
} from '../src/operatorAuthRoutes';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../src/index.ts'), 'utf8');
const lines = source.split('\n');

const GATE_MARKER = 'Strict HMAC Validation for payload-mutating requests';
const gateIndex = lines.findIndex((line) => line.includes(GATE_MARKER));
const squash = (text: string): string => text.replace(/\s+/g, '');

const ENV = {
  AXIM_INTERNAL_KEY: 'internal-key',
  AXIM_ONYX_SECRET: 'onyx-secret',
  AXIM_SERVICE_KEY: 'service-key',
  ONYX_EMERGENCY_SECRET: 'emergency-secret',
  ONYX_CLIENT_SECRET: 'client-secret',
  CORE_INGEST_URL: 'https://api.axim.us.com/telemetry',
} as any;

const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
    list: async () => ({ keys: [...store.keys()].map((name) => ({ name })) }),
  } as any;
}

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Handler block for a path: from the line that declares it to the next line that
 * declares a different route, capped at 250 lines. Same extraction the pre-gate
 * invariant uses, so both tests agree on what "the handler" means.
 */
function handlerBlock(path: string): string {
  const routeLiteral = /"(\/[A-Za-z0-9._\-/]*)"/g;
  const declares = (line: string, candidate: string) =>
    line.includes('pathname') &&
    !line.includes('!==') &&
    [...line.matchAll(routeLiteral)].some((match) => match[1] === candidate);

  const start = lines.findIndex((line, index) => index > gateIndex && declares(line, path));
  if (start < 0) return '';

  let end = Math.min(lines.length, start + 250);
  for (let index = start + 1; index < end; index++) {
    if (
      lines[index].includes('pathname') &&
      [...lines[index].matchAll(routeLiteral)].some((match) => match[1] !== path)
    ) {
      end = index;
      break;
    }
  }

  return squash(lines.slice(start, end).join('\n'));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the cockpit can decide on a HITL ticket', () => {
  it('accepts a super-admin bearer with no signature and reaches the handler', async () => {
    const env = { ...ENV, HITL_APPROVAL_KV: fakeKV() };
    const body = JSON.stringify({ action_id: 'a1', decision: 'approve' });

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/hitl/action', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
          'Content-Type': 'application/json',
        },
        body,
      }),
      env,
      CTX,
    );

    // No CORE_HITL_URL bound, so Core is unreachable by design here: the decision
    // is recorded locally and reported as unapplied. The point is that the gate
    // no longer answers for the handler.
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('"recorded":true');
    expect(env.HITL_APPROVAL_KV.store.has('action_decision:a1')).toBe(true);
  });

  it('still refuses an anonymous decision', async () => {
    const body = JSON.stringify({ action_id: 'a1', decision: 'approve' });
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/hitl/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      ENV,
      CTX,
    );
    expect(res.status).toBe(401);
  });

  it('still refuses a bearer that is not an operator credential', async () => {
    const body = JSON.stringify({ action_id: 'a1', decision: 'approve' });
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/hitl/action', {
        method: 'POST',
        headers: { Authorization: 'Bearer not-a-real-token', 'Content-Type': 'application/json' },
        body,
      }),
      ENV,
      CTX,
    );
    expect(res.status).toBe(401);
  });

  it('still accepts a signed server-to-server call', async () => {
    const body = JSON.stringify({ action_id: 'a1', decision: 'hacked' });
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/hitl/action', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
          'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
        },
        body,
      }),
      ENV,
      CTX,
    );
    expect(res.status).toBe(400);
  });
});

describe('the cockpit can run a playbook', () => {
  it('accepts a super-admin bearer with no signature', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const body = JSON.stringify({ playbook: 'support_triage' });

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/playbook/trigger', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
          'Content-Type': 'application/json',
        },
        body,
      }),
      ENV,
      CTX,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"ok":true');
  });

  it('still rejects a playbook name that is not on the allow list', async () => {
    const body = JSON.stringify({ playbook: 'rm_rf' });
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/playbook/trigger', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
          'Content-Type': 'application/json',
        },
        body,
      }),
      ENV,
      CTX,
    );
    expect(res.status).toBe(400);
  });
});

describe('the gate is not opened up generally', () => {
  it('an unregistered mutating route still demands a signature', async () => {
    const body = JSON.stringify({ event: 'x' });
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/ecosystem/event', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
          'Content-Type': 'application/json',
        },
        body,
      }),
      ENV,
      CTX,
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Missing x-axim-signature header');
  });

  it('an unregistered mutating route still rejects a bad signature', async () => {
    const body = JSON.stringify({ event: 'x' });
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/ecosystem/event', {
        method: 'POST',
        headers: { 'x-axim-signature': 'deadbeef' },
        body,
      }),
      ENV,
      CTX,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Invalid HMAC signature');
  });

  it('looks up exact paths only, so a nested path is not exempted', () => {
    expect(findOperatorAuthRoute('POST', '/api/v1/hitl/action')).toBeDefined();
    expect(findOperatorAuthRoute('POST', '/api/v1/hitl/action/approve')).toBeUndefined();
    expect(findOperatorAuthRoute('GET', '/api/v1/hitl/action')).toBeUndefined();
  });
});

describe('the registry stays true to the source', () => {
  it('is non-empty and only lists mutating verbs below the gate', () => {
    expect(OPERATOR_AUTH_ROUTES.length).toBeGreaterThan(0);
    for (const route of OPERATOR_AUTH_ROUTES) {
      expect(route.methods.length).toBeGreaterThan(0);
      for (const method of route.methods) {
        expect(['POST', 'PUT', 'DELETE']).toContain(method);
      }
      expect(handlerBlock(route.path), `${route.path} is not declared below the gate`).not.toBe('');
    }
  });

  it('every entry still carries the checkAuth call it relies on', () => {
    const missing: string[] = [];
    for (const route of OPERATOR_AUTH_ROUTES) {
      const block = handlerBlock(route.path);
      for (const needle of route.evidence) {
        if (!block.includes(squash(needle))) {
          missing.push(`${route.path} → ${needle}`);
        }
      }
      // The flag the registry claims must match the call in the handler.
      const expected = squash(
        `checkAuth(request, env${requiresSuperUser(route) ? ', true' : ''});`,
      );
      if (!block.includes(expected)) {
        missing.push(`${route.path} → checkAuth flag does not match auth mode`);
      }
    }
    expect(
      missing,
      'A route listed as operator-authenticated must re-check the caller itself. ' +
        'If the check is gone, remove the entry — do not let the gate be the only door.',
    ).toEqual([]);
  });
});
