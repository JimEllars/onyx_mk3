import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyPassportJwt, isSuperAdmin } from '../src/passport';

const ISS = 'https://example.supabase.co/auth/v1';
const JWKS = 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
const env = { PASSPORT_JWT_ISSUER: ISS, PASSPORT_JWKS_URL: JWKS };

const b64u = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function setup(kid = 'k1') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'ES256' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))));
  const sign = async (claims: Record<string, unknown>, headerKid = kid) => {
    const head = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: headerKid }));
    const body = b64u(JSON.stringify(claims));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64u(sig)}`;
  };
  return sign;
}

const good = () => ({
  iss: ISS,
  aud: 'authenticated',
  sub: 'user-1',
  exp: Math.floor(Date.now() / 1000) + 600,
  app_metadata: { role: 'super-admin' },
});

describe('verifyPassportJwt', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a valid token and reads the super-admin role claim', async () => {
    const sign = await setup('valid');
    const claims = await verifyPassportJwt(await sign(good()), env);
    expect(claims?.sub).toBe('user-1');
    expect(isSuperAdmin(claims!)).toBe(true);
  });

  it('rejects wrong issuer, audience, expired and unknown kid', async () => {
    const sign = await setup('rejects');
    expect(await verifyPassportJwt(await sign({ ...good(), iss: 'https://evil' }), env)).toBeNull();
    expect(await verifyPassportJwt(await sign({ ...good(), aud: 'other' }), env)).toBeNull();
    expect(await verifyPassportJwt(await sign({ ...good(), exp: 1 }), env)).toBeNull();
    expect(await verifyPassportJwt(await sign(good(), 'unknown'), env)).toBeNull();
  });

  it('rejects tampered payloads and unconfigured environments', async () => {
    const sign = await setup('tamper');
    const token = await sign({ ...good(), app_metadata: {} });
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64u(JSON.stringify(good()))}.${s}`;
    expect(await verifyPassportJwt(forged, env)).toBeNull();
    expect(await verifyPassportJwt(token, {})).toBeNull();
  });

  it('does not treat a normal user as super-admin', async () => {
    const sign = await setup('normal');
    const claims = await verifyPassportJwt(await sign({ ...good(), app_metadata: { role: 'user' } }), env);
    expect(claims).not.toBeNull();
    expect(isSuperAdmin(claims!)).toBe(false);
  });
});
