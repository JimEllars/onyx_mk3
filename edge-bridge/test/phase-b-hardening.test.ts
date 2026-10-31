/**
 * Phase B tests.
 *
 * B1 passport-authenticated chat, B3 HITL decision relay, B5 role unification,
 * B6 authenticated swarm state, B7 decode-aware deny list.
 *
 * Each case fails on the Phase A head (e559a3c) and passes after Phase B.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../src/index';
import { isSuperAdmin } from '../src/passport';

const SRC = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');

const ENV = {
  AXIM_INTERNAL_KEY: 'internal-key',
  AXIM_ONYX_SECRET: 'onyx-secret',
  AXIM_SERVICE_KEY: 'service-key',
  ONYX_EMERGENCY_SECRET: 'emergency-secret',
  ONYX_CLIENT_SECRET: 'client-secret',
  CORE_INGEST_URL: 'https://api.axim.us.com/telemetry',
} as any;

const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

/** Minimal in-memory KVNamespace, enough for the recording paths. */
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
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('B1 — the chat route accepts an operator credential', () => {
  it('accepts a service bearer without an HMAC (the cockpit path)', async () => {
    // Stub the upstream so the test never leaves the process.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('data: {"chunk":"hi"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ));

    const req = new Request('http://localhost/api/v1/onyx/summon', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'status?' }),
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).not.toBe(401);
  });

  it('still rejects a caller with no credential at all', async () => {
    const req = new Request('http://localhost/api/v1/onyx/summon', {
      method: 'POST',
      body: JSON.stringify({ message: 'status?' }),
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(401);
  });

  it('no longer trusts a presence-only session cookie', () => {
    expect(SRC).not.toContain('hasValidCookie');
  });
});

describe('B3 — HITL decisions are POSTed, authenticated, and relayed', () => {
  it('rejects an unauthenticated decision', async () => {
    const req = new Request('http://localhost/api/v1/hitl/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_id: 'a1', decision: 'approve' }),
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(401);
  });

  it('refuses a decision on GET', async () => {
    const req = new Request(
      'http://localhost/api/v1/hitl/action?token=abc&decision=approve',
      { method: 'GET' },
    );
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('rejects an unknown decision value instead of recording it', async () => {
    const body = JSON.stringify({ action_id: 'a1', decision: 'hacked' });
    const req = new Request('http://localhost/api/v1/hitl/action', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
        'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
      },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(400);
  });

  it('reports applied:false when Core is not configured, rather than success', async () => {
    const env = { ...ENV, HITL_APPROVAL_KV: fakeKV() };
    const body = JSON.stringify({ action_id: 'a1', decision: 'approve' });
    const req = new Request('http://localhost/api/v1/hitl/action', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
        'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
      },
      body,
    });
    const res = await worker.fetch(req, env, CTX);
    expect(res.status).toBe(503);
    const payload = JSON.parse(await res.text());
    expect(payload).toMatchObject({ applied: false, recorded: true, status: 'Approved' });
    // It must still have recorded the decision locally.
    expect([...env.HITL_APPROVAL_KV.store.keys()].some((k: string) => k.startsWith('action_decision:'))).toBe(true);
  });

  it('relays to Core and reports applied:true when Core accepts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      ...ENV,
      HITL_APPROVAL_KV: fakeKV(),
      CORE_HITL_URL: 'https://core.example/functions/v1/resolve-hitl',
      CORE_SERVICE_ROLE_KEY: 'core-service-role',
    };
    const body = JSON.stringify({ action_id: 'log-123', decision: 'reject', operator_notes: 'no' });
    const req = new Request('http://localhost/api/v1/hitl/action', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
        'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
      },
      body,
    });
    const res = await worker.fetch(req, env, CTX);

    expect(res.status).toBe(200);
    const payload = JSON.parse(await res.text());
    expect(payload).toMatchObject({ applied: true, status: 'Rejected', core_status: 200 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://core.example/functions/v1/resolve-hitl');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer core-service-role');
    expect(JSON.parse(init.body)).toMatchObject({ log_id: 'log-123', status: 'Rejected' });
  });

  it('reports applied:false when Core rejects the decision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));

    const env = {
      ...ENV,
      HITL_APPROVAL_KV: fakeKV(),
      CORE_HITL_URL: 'https://core.example/functions/v1/resolve-hitl',
      CORE_SERVICE_ROLE_KEY: 'core-service-role',
    };
    const body = JSON.stringify({ action_id: 'log-9', decision: 'approve' });
    const req = new Request('http://localhost/api/v1/hitl/action', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
        'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
      },
      body,
    });
    const res = await worker.fetch(req, env, CTX);
    expect(res.status).toBe(502);
    expect(JSON.parse(await res.text())).toMatchObject({ applied: false, core_status: 500 });
  });
});

describe('B5 — one administrator role, however it is spelled', () => {
  it.each([
    ['super-admin', { app_metadata: { role: 'super-admin' } }],
    ['super_admin', { app_metadata: { role: 'super_admin' } }],
    ['super_user', { app_metadata: { role: 'super_user' } }],
    ['top-level role', { role: 'super_admin' }],
  ])('accepts %s', (_label, claims) => {
    expect(isSuperAdmin(claims as any)).toBe(true);
  });

  it('rejects a normal user and a missing role', () => {
    expect(isSuperAdmin({ app_metadata: { role: 'user' } } as any)).toBe(false);
    expect(isSuperAdmin({} as any)).toBe(false);
  });
});

describe('B6 — swarm state requires a credential', () => {
  it('rejects an anonymous read of the dispatch locks', async () => {
    const req = new Request('http://localhost/api/v1/onyx/swarm-state', { method: 'GET' });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(401);
  });
});

describe('B7 — the deny list decodes before it matches', () => {
  it.each([
    ['plain CGI name', '/?auto_prepend_file=x'],
    ['percent-encoded name', '/?%61uto_prepend_file=x'],
    ['encoded -d', '/?%2d%64+x'],
    ['encoded underscore', '/?auto%5fprepend_file=x'],
    ['double-encoded traversal', '/%252e%252e/%252e%252e/etc/passwd'],
    ['path-info php', '/index.php/anything'],
    ['wp-admin', '/wp-admin/setup.php'],
    ['xmlrpc', '/xmlrpc.php'],
  ])('blocks %s', async (_label, path) => {
    const req = new Request(`http://localhost${path}`, { method: 'GET' });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(403);
  });

  it('plain dot traversal is neutralised before routing (no 200, never served)', async () => {
    // The WHATWG URL parser resolves `/a/../../../etc/passwd` to `/etc/passwd`
    // before the guard runs, so there is nothing left to match: it falls through
    // to 404. That is safe — the assertion that matters is that it is not served.
    const req = new Request('http://localhost/a/../../../etc/passwd', { method: 'GET' });
    const res = await worker.fetch(req, ENV, CTX);
    expect([403, 404]).toContain(res.status);
  });

  it('still serves a normal health check', async () => {
    const req = new Request('http://localhost/health', { method: 'GET' });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(200);
  });
});
