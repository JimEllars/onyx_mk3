/**
 * Dual-accept signature window (Onyx edge).
 *
 * The rollout spans two repositories that deploy asynchronously, so both the
 * timestamped (v2) and body-only (legacy) forms must verify until a sunset date,
 * and the legacy form must stop working by date rather than by coordination.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEGACY_SUNSET,
  SIGNATURE_MAX_SKEW_SECONDS,
  verifyRequestSignature,
} from '../src/index';

const SECRET = 'shared-secret';
const BODY = JSON.stringify({ app_id: 'onyx', event: 'ping' });
const NOW = Date.parse('2026-11-01T12:00:00Z');
const nowSeconds = Math.floor(NOW / 1000);

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function request(headers: Record<string, string>): Request {
  return new Request('https://edge.example/api/v1/telemetry/flush', {
    method: 'POST',
    headers,
    body: BODY,
  });
}

describe('v2 signatures', () => {
  it('accepts a fresh timestamped signature', async () => {
    const ts = nowSeconds;
    const sig = await hmacHex(SECRET, `${ts}.${BODY}`);
    const verdict = await verifyRequestSignature(
      request({
        'X-Axim-Signature-Version': '2',
        'X-Axim-Timestamp': String(ts),
        'X-Axim-Signature': `sha256=${sig}`,
      }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(verdict).toMatchObject({ ok: true, mode: 'v2' });
  });

  it('refuses a replay older than the window', async () => {
    const ts = nowSeconds - (SIGNATURE_MAX_SKEW_SECONDS + 1);
    const sig = await hmacHex(SECRET, `${ts}.${BODY}`);
    const verdict = await verifyRequestSignature(
      request({
        'X-Axim-Signature-Version': '2',
        'X-Axim-Timestamp': String(ts),
        'X-Axim-Signature': sig,
      }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(false);
    expect(String(verdict.reason)).toContain('window');
  });

  it('cannot be re-dated (timestamp is signed)', async () => {
    const originalTs = nowSeconds - 3600;
    const sig = await hmacHex(SECRET, `${originalTs}.${BODY}`);
    const verdict = await verifyRequestSignature(
      request({
        'X-Axim-Signature-Version': '2',
        'X-Axim-Timestamp': String(nowSeconds),
        'X-Axim-Signature': sig,
      }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(false);
    expect(String(verdict.reason)).toContain('mismatch');
  });

  it('refuses a body-only signature presented as v2', async () => {
    const legacySig = await hmacHex(SECRET, BODY);
    const verdict = await verifyRequestSignature(
      request({
        'X-Axim-Signature-Version': '2',
        'X-Axim-Timestamp': String(nowSeconds),
        'X-Axim-Signature': legacySig,
      }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(false);
  });

  it('requires the timestamp when the version is v2', async () => {
    const sig = await hmacHex(SECRET, BODY);
    const verdict = await verifyRequestSignature(
      request({ 'X-Axim-Signature-Version': '2', 'X-Axim-Signature': sig }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(verdict).toMatchObject({ ok: false, mode: 'v2' });
  });
});

describe('legacy signatures during the window', () => {
  it('accepts a body-only signature before the sunset', async () => {
    const sig = await hmacHex(SECRET, BODY);
    const verdict = await verifyRequestSignature(
      request({ 'X-Axim-Signature': `sha256=${sig}` }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(verdict).toMatchObject({ ok: true, mode: 'legacy' });
  });

  it('refuses the same signature after the sunset', async () => {
    const sig = await hmacHex(SECRET, BODY);
    const afterSunset = Date.parse(DEFAULT_LEGACY_SUNSET) + 1000;
    const verdict = await verifyRequestSignature(
      request({ 'X-Axim-Signature': sig }),
      BODY,
      SECRET,
      { nowMs: afterSunset },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.mode).toBe('legacy');
    expect(String(verdict.reason)).toContain('retired');
  });

  it('honours a caller-supplied timestamp even on the legacy path', async () => {
    const sig = await hmacHex(SECRET, BODY);
    const verdict = await verifyRequestSignature(
      request({
        'X-Axim-Signature': sig,
        'X-Axim-Timestamp': String(nowSeconds - 10_000),
      }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(false);
  });

  it('respects a configured sunset override', async () => {
    const sig = await hmacHex(SECRET, BODY);
    const verdict = await verifyRequestSignature(
      request({ 'X-Axim-Signature': sig }),
      BODY,
      SECRET,
      { nowMs: NOW, legacySunset: '2026-01-01T00:00:00Z' },
    );
    expect(verdict.ok).toBe(false);
  });
});

describe('both forms', () => {
  it('reject a wrong secret', async () => {
    const ts = nowSeconds;
    const v2sig = await hmacHex('wrong', `${ts}.${BODY}`);
    const v2 = await verifyRequestSignature(
      request({
        'X-Axim-Signature-Version': '2',
        'X-Axim-Timestamp': String(ts),
        'X-Axim-Signature': v2sig,
      }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(v2.ok).toBe(false);

    const legacySig = await hmacHex('wrong', BODY);
    const legacy = await verifyRequestSignature(
      request({ 'X-Axim-Signature': legacySig }),
      BODY,
      SECRET,
      { nowMs: NOW },
    );
    expect(legacy.ok).toBe(false);
  });

  it('fail closed with no configured secret', async () => {
    const verdict = await verifyRequestSignature(
      request({ 'X-Axim-Signature': 'a'.repeat(64) }),
      BODY,
      undefined,
      { nowMs: NOW },
    );
    expect(verdict.ok).toBe(false);
  });

  it('refuse a malformed signature without throwing', async () => {
    for (const value of ['not-hex', 'sha256=', 'sha256=zz']) {
      const verdict = await verifyRequestSignature(
        request({ 'X-Axim-Signature': value }),
        BODY,
        SECRET,
        { nowMs: NOW },
      );
      expect(verdict.ok).toBe(false);
    }
  });
});
