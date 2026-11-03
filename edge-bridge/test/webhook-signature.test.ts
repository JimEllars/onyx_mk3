/**
 * Behavioural pins for the shared-secret checks that used to compare hex strings
 * with `!==`:
 *
 *   - `POST /api/v1/webhooks` (GitHub + WordPress signatures)
 *   - `POST /api/v1/onyx/emergency-direct` (bearer of ONYX_EMERGENCY_SECRET)
 *
 * Both now verify with `crypto.subtle.verify` (webhooks) or `equalSecrets`
 * (bearer), so the comparison no longer short-circuits on the first differing
 * character. These tests assert the *outcome* is unchanged where it must be — a
 * right signature passes, a wrong one is refused — because a constant-time
 * rewrite that rejects valid callers is also a defect.
 */
import { describe, it, expect } from 'vitest';

import worker, { verifyHexHmacSignature } from '../src/index';

const encoder = new TextEncoder();

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const GITHUB_SECRET = 'github-webhook-secret';
const WP_SECRET = 'wp-webhook-secret';

async function postWebhook(
  body: string,
  headers: Record<string, string>,
  env: Record<string, unknown> = {},
): Promise<Response> {
  const request = new Request('http://localhost/api/v1/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });

  return worker.fetch(
    request,
    {
      AXIM_INTERNAL_KEY: 'internal',
      AXIM_ONYX_SECRET: 'onyx',
      GITHUB_WEBHOOK_SECRET: GITHUB_SECRET,
      WP_WEBHOOK_SECRET: WP_SECRET,
      ...env,
    } as any,
    { waitUntil: () => {} } as any,
  );
}

describe('POST /api/v1/webhooks — GitHub signature', () => {
  const body = JSON.stringify({ action: 'opened', number: 1 });

  it('accepts a correct sha256= signature', async () => {
    // No CORE_INGEST_URL, so a pass through the signature gate lands on the
    // configuration guard. Any 401 here would mean the signature was refused.
    const res = await postWebhook(body, {
      'x-hub-signature-256': `sha256=${await hmacHex(GITHUB_SECRET, body)}`,
    });

    expect(res.status).toBe(500);
    expect(await res.text()).toContain('CORE_INGEST_URL');
  });

  it('accepts an upper-case hex digest', async () => {
    const signature = (await hmacHex(GITHUB_SECRET, body)).toUpperCase();
    const res = await postWebhook(body, { 'x-hub-signature-256': `sha256=${signature}` });

    expect(res.status).toBe(500);
  });

  it('refuses a signature made with the wrong secret', async () => {
    const res = await postWebhook(body, {
      'x-hub-signature-256': `sha256=${await hmacHex('not-the-secret', body)}`,
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Invalid GitHub signature');
  });

  it('refuses a signature over a different body', async () => {
    const res = await postWebhook(body, {
      'x-hub-signature-256': `sha256=${await hmacHex(GITHUB_SECRET, '{"action":"closed"}')}`,
    });

    expect(res.status).toBe(401);
  });

  it('refuses a malformed digest without throwing', async () => {
    const res = await postWebhook(body, { 'x-hub-signature-256': 'sha256=not-hex' });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Invalid GitHub signature');
  });

  it('refuses an unsigned call', async () => {
    const res = await postWebhook(body, {});

    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Missing signature');
  });

  it('fails closed when the secret is not configured', async () => {
    const res = await postWebhook(
      body,
      { 'x-hub-signature-256': `sha256=${await hmacHex(GITHUB_SECRET, body)}` },
      { GITHUB_WEBHOOK_SECRET: undefined },
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Webhook secret not configured');
  });
});

describe('POST /api/v1/webhooks — WordPress signature', () => {
  const body = JSON.stringify({ event: 'order.created' });

  it('accepts a bare hex digest', async () => {
    const res = await postWebhook(body, {
      'x-wp-webhook-signature': await hmacHex(WP_SECRET, body),
    });

    expect(res.status).toBe(500);
  });

  it('accepts the sha256=-prefixed form some plugins send', async () => {
    const res = await postWebhook(body, {
      'x-wp-webhook-signature': `sha256=${await hmacHex(WP_SECRET, body)}`,
    });

    expect(res.status).toBe(500);
  });

  it('refuses a wrong digest', async () => {
    const res = await postWebhook(body, {
      'x-wp-webhook-signature': await hmacHex('not-the-secret', body),
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Invalid WP signature');
  });

  it('refuses a wrong wp_secret query parameter', async () => {
    const request = new Request('http://localhost/api/v1/webhooks?wp_secret=nope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const res = await worker.fetch(
      request,
      {
        AXIM_INTERNAL_KEY: 'internal',
        AXIM_ONYX_SECRET: 'onyx',
        WP_WEBHOOK_SECRET: WP_SECRET,
      } as any,
      { waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(401);
    expect(await res.text()).toBe('Invalid WP secret');
  });
});

describe('verifyHexHmacSignature', () => {
  it('is false without a secret, a header or a hex digest', async () => {
    const signature = await hmacHex(GITHUB_SECRET, 'body');

    expect(await verifyHexHmacSignature(undefined, 'body', signature)).toBe(false);
    expect(await verifyHexHmacSignature(GITHUB_SECRET, 'body', null)).toBe(false);
    expect(await verifyHexHmacSignature(GITHUB_SECRET, 'body', 'zzzz')).toBe(false);
    expect(await verifyHexHmacSignature(GITHUB_SECRET, 'body', '00'.repeat(32))).toBe(false);
  });

  it('is true for a correct digest with either prefix form', async () => {
    const signature = await hmacHex(GITHUB_SECRET, 'body');

    expect(await verifyHexHmacSignature(GITHUB_SECRET, 'body', signature)).toBe(true);
    expect(await verifyHexHmacSignature(GITHUB_SECRET, 'body', `sha256=${signature}`)).toBe(true);
    expect(await verifyHexHmacSignature(GITHUB_SECRET, 'body', `SHA256=${signature}`)).toBe(true);
  });
});

describe('POST /api/v1/onyx/emergency-direct', () => {
  const emergencySecret = 'emergency-secret';
  const body = JSON.stringify({ email: 'nobody@example.com', action: 'health_check' });

  async function postEmergency(headers: Record<string, string>): Promise<Response> {
    return worker.fetch(
      new Request('http://localhost/api/v1/onyx/emergency-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
      }),
      {
        AXIM_INTERNAL_KEY: 'internal',
        AXIM_ONYX_SECRET: 'onyx',
        ONYX_EMERGENCY_SECRET: emergencySecret,
      } as any,
      { waitUntil: () => {} } as any,
    );
  }

  it('accepts the correct bearer after the signature check', async () => {
    // 403 (email not allow-listed) proves both the HMAC and the constant-time
    // bearer comparison passed; either failing would answer 401.
    const res = await postEmergency({
      Authorization: `Bearer ${emergencySecret}`,
      'X-Axim-Signature': `sha256=${await hmacHex(emergencySecret, body)}`,
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Unrecognized executive identity');
  });

  it('refuses a wrong bearer even with a valid signature', async () => {
    const res = await postEmergency({
      Authorization: `Bearer ${emergencySecret}-wrong`,
      'X-Axim-Signature': `sha256=${await hmacHex(emergencySecret, body)}`,
    });

    expect(res.status).toBe(401);
  });

  it('refuses a wrong signature even with a valid bearer', async () => {
    const res = await postEmergency({
      Authorization: `Bearer ${emergencySecret}`,
      'X-Axim-Signature': `sha256=${await hmacHex('not-the-secret', body)}`,
    });

    expect(res.status).toBe(401);
  });
});
