/**
 * One signature header, one key.
 *
 * `_fetch` verifies `X-Axim-Signature` over the raw body with AXIM_INTERNAL_KEY at
 * the global gate. Two handlers then re-verified the same header against
 * AXIM_ONYX_SECRET, which cannot succeed: a single digest cannot match two
 * different keys. Both routes answered 401 for every caller — unreachable, not
 * protected — and a caller holding both keys still had only one header to put
 * them in.
 *
 * `/api/v1/ecosystem/event` had the identical defect and was fixed on 2026-11-03.
 * These tests pin the same property for the two dispatch routes: the gate's
 * credential is the credential, and whatever else the handler checks (the
 * operator bearer on /commands/dispatch) still applies.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

const ENV = {
  AXIM_INTERNAL_KEY: 'internal-key',
  AXIM_ONYX_SECRET: 'onyx-secret',
  AXIM_SERVICE_KEY: 'service-key',
  CORE_INGEST_URL: 'https://api.axim.us.com/telemetry',
} as any;

const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

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

function stubCore() {
  const stub = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/api/v1/tasks/dispatch', () => {
  it('is reachable with the signature the gate verifies', async () => {
    const core = stubCore();
    const body = JSON.stringify({ intent: 'sync_lead_enrich', meta: { lead_id: 'l1' } });

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/tasks/dispatch', {
        method: 'POST',
        headers: {
          'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
          'Content-Type': 'application/json',
        },
        body,
      }),
      ENV,
      CTX,
    );

    expect(res.status).toBe(200);
    expect(core).toHaveBeenCalledTimes(1);
    expect(String(core.mock.calls[0][0])).toBe('https://api.axim.us.com/api/v1/tasks/execute');
  });

  it('still refuses a signature made with a key the gate does not use', async () => {
    const core = stubCore();
    const body = JSON.stringify({ intent: 'sync_lead_enrich' });

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/tasks/dispatch', {
        method: 'POST',
        headers: {
          'x-axim-signature': await sign(body, ENV.AXIM_ONYX_SECRET),
          'Content-Type': 'application/json',
        },
        body,
      }),
      ENV,
      CTX,
    );

    expect(res.status).toBe(403);
    expect(core).not.toHaveBeenCalled();
  });
});

describe('/api/v1/commands/dispatch', () => {
  it('is reachable with the gate signature plus a super-admin bearer', async () => {
    const core = stubCore();
    const body = JSON.stringify({ task: 'status', args: {} });

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/commands/dispatch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.AXIM_SERVICE_KEY}`,
          'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
          'Content-Type': 'application/json',
        },
        body,
      }),
      ENV,
      CTX,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"status":"dispatched"');
    expect(core).toHaveBeenCalledTimes(1);
  });

  it('still refuses a signed call with no operator credential', async () => {
    const core = stubCore();
    const body = JSON.stringify({ task: 'status' });

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/commands/dispatch', {
        method: 'POST',
        headers: {
          'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
          'Content-Type': 'application/json',
        },
        body,
      }),
      ENV,
      CTX,
    );

    expect(res.status).toBe(401);
    expect(core).not.toHaveBeenCalled();
  });

  it('still refuses a payload with no task', async () => {
    stubCore();
    const body = JSON.stringify({ args: { deep: true } });

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/commands/dispatch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.AXIM_SERVICE_KEY}`,
          'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
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
