/**
 * Phase A hardening tests.
 *
 * Every case below fails against the pre-Phase-A worker and passes after it.
 * They assert on observable responses, not on re-declared logic, and they
 * deliberately exercise the *unauthenticated* and *binding-missing* paths that
 * the existing security.test.ts never reaches (those four tests all stop at the
 * global HMAC gate).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../src/index';

const ENV = {
  AXIM_INTERNAL_KEY: 'internal-key',
  AXIM_ONYX_SECRET: 'onyx-secret',
  AXIM_SERVICE_KEY: 'service-key',
  ONYX_EMERGENCY_SECRET: 'emergency-secret',
  ONYX_CLIENT_SECRET: 'client-secret',
  CORE_INGEST_URL: 'https://api.axim.us.com/telemetry',
} as any;

const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

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

const SRC = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');

describe('A1 — no server secret is reflected to callers', () => {
  it('emergency-direct 401 does not return AXIM_ONYX_SECRET in a header', async () => {
    const body = JSON.stringify({ email: 'jrellars@gmail.com' });
    const req = new Request('http://localhost/api/v1/onyx/emergency-direct', {
      method: 'POST',
      headers: {
        'x-axim-signature': await sign(body, ENV.ONYX_EMERGENCY_SECRET),
        // deliberately wrong bearer so we take the 401 branch that used to leak
        Authorization: 'Bearer not-the-emergency-secret',
      },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);

    expect(res.status).toBe(401);
    expect(res.headers.get('authorization')).toBeNull();
    const text = await res.text();
    expect(text).not.toContain('onyx-secret');
  });

  it('emergency-direct 403 does not return AXIM_ONYX_SECRET in a header', async () => {
    const body = JSON.stringify({ email: 'stranger@example.com' });
    const req = new Request('http://localhost/api/v1/onyx/emergency-direct', {
      method: 'POST',
      headers: {
        'x-axim-signature': await sign(body, ENV.ONYX_EMERGENCY_SECRET),
        Authorization: `Bearer ${ENV.ONYX_EMERGENCY_SECRET}`,
      },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);

    expect(res.status).toBe(403);
    expect(res.headers.get('authorization')).toBeNull();
  });
});

describe('A2 — the mock Passport session mint is gone', () => {
  it('POST /api/v1/passport/verify no longer exists, even with a valid signature', async () => {
    const body = JSON.stringify({ token: 'test_jrellars' });
    const req = new Request('http://localhost/api/v1/passport/verify', {
      method: 'POST',
      headers: { 'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY) },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('access_token');
    expect(text).not.toContain('mock_supabase');
  });

  it('the dev bypass tokens no longer appear in the source', () => {
    expect(SRC).not.toContain('test_jrellars');
    expect(SRC).not.toContain('test_jamesellars');
    expect(SRC).not.toContain('test_wallet');
    expect(SRC).not.toContain('mock_supabase_access_token');
    expect(SRC).not.toContain('parsePassportSession');
  });
});

describe('A3 — telemetry routes require authentication', () => {
  it('POST /functions/v1/telemetry-ingress rejects an anonymous caller', async () => {
    const req = new Request('http://localhost/functions/v1/telemetry-ingress', {
      method: 'POST',
      body: JSON.stringify({ session_id: 's1', status: 'healthy' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(401);
  });

  it('POST /functions/v1/telemetry-ingress accepts a valid HMAC', async () => {
    const body = JSON.stringify({ session_id: 's1', status: 'healthy' });
    const req = new Request('http://localhost/functions/v1/telemetry-ingress', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
      },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).not.toBe(401);
  });

  it('POST /api/v1/telemetry/flush rejects an anonymous caller', async () => {
    const req = new Request('http://localhost/api/v1/telemetry/flush', {
      method: 'POST',
      body: '{}',
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(401);
  });
});

describe('A4 — missing KV bindings fail loudly instead of reporting success', () => {
  it('dlq-status returns 503 rather than zeroes when EDGE_DLQ_KV is absent', async () => {
    const req = new Request('http://localhost/api/v1/telemetry/dlq-status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}` },
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('EDGE_DLQ_KV');
  });

  it('mcp/execute returns 503 rather than success when HITL_APPROVAL_KV is absent', async () => {
    const body = JSON.stringify({ action_id: 'a1', decision: 'approve' });
    const req = new Request('http://localhost/api/v1/mcp/execute', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
        'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
      },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('HITL_APPROVAL_KV');
    expect(text).not.toContain('"success":true');
  });

  it('ecosystem/event returns 503 rather than a 202 drop when ECOSYSTEM_METRICS_KV is absent', async () => {
    const body = JSON.stringify({ source_app: 'speedreport', event_type: 'ping' });
    const req = new Request('http://localhost/api/v1/ecosystem/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-axim-signature': await sign(body, ENV.AXIM_INTERNAL_KEY),
      },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('ECOSYSTEM_METRICS_KV');
  });
});

describe('A6 — the global gate verifies HMAC in constant time', () => {
  // NOTE: the gate sits mid-chain, so it only covers routes defined after it.
  // /api/v1/mcp/execute is a post-gate POST route; with a valid signature it
  // reaches the handler (which 503s on the missing KV binding), which is how we
  // prove the gate accepted the signature.
  const target = 'http://localhost/api/v1/mcp/execute';
  const body = JSON.stringify({ action_id: 'a1', decision: 'approve' });

  it('rejects a missing signature with 401', async () => {
    const req = new Request(target, { method: 'POST', body });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(401);
  });

  it('rejects a forged signature with 403', async () => {
    const req = new Request(target, {
      method: 'POST',
      headers: { 'x-axim-signature': 'a'.repeat(64) },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(403);
  });

  it('rejects a malformed signature header with 403', async () => {
    const req = new Request(target, {
      method: 'POST',
      headers: { 'x-axim-signature': 'not-hex' },
      body,
    });
    const res = await worker.fetch(req, ENV, CTX);
    expect(res.status).toBe(403);
  });

  it('accepts the sha256= prefixed form and the bare hex form identically', async () => {
    const sig = await sign(body, ENV.AXIM_INTERNAL_KEY);
    for (const prefix of ['', 'sha256=']) {
      const req = new Request(target, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.AXIM_ONYX_SECRET}`,
          'x-axim-signature': prefix + sig,
        },
        body,
      });
      const res = await worker.fetch(req, ENV, CTX);
      expect(res.status, `prefix="${prefix}" should pass the gate`).toBe(503);
    }
  });

  it('the timing-unsafe comparison implementation is gone', () => {
    expect(SRC).not.toContain('async function verifyAximSignature');
    expect(SRC).not.toContain('signature !== signatureHex');
  });
});
