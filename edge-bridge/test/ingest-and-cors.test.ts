/**
 * Ingest URL, CORS and telemetry-signature tests.
 *
 * Three defects on the pre-fix head (22591e2), all found by auditing production
 * on 2026-11-04:
 *
 * 1. **CORE_INGEST_URL pointed at a dead host, three different ways.**
 *    `wrangler.jsonc` said `https://api.axim.us.com/telemetry`,
 *    `.dev.vars.example` said `https://api.axim.us.com/v1/functions/telemetry-ingest`,
 *    and the in-code fallback agreed with the latter. Every path on
 *    `api.axim.us.com` returns `302 -> /404.html`, so `drainIngestDlq` re-queued
 *    forever and the "submit before idle" loop could never close.
 *
 * 2. **CORS rejected the dashboard's own GETs.** `Access-Control-Allow-Methods`
 *    was `"POST, OPTIONS"` while the HUD polls `GET /health` and
 *    `GET /api/telemetry/summary`, so the browser refused both at preflight and
 *    the status bar could only ever render OFFLINE. `ALLOWED_ORIGIN` was also
 *    compared with strict equality against a single value, so a comma-separated
 *    list could never match — adding an origin meant editing code.
 *
 * 3. **The telemetry signer emitted the legacy v1 form.** `telemetry-ingress`
 *    verifies v2 (HMAC over `"<timestamp>.<body>"`) and retires the body-only
 *    form on 2026-12-31 via `DEFAULT_LEGACY_SUNSET`. Signing v1 would have worked
 *    until that date and then failed silently, which is the exact failure mode
 *    this whole branch exists to eliminate.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import worker, { DEFAULT_CORE_INGEST_URL, resolveCronUrl } from '../src/index';

const INGEST_FN = '/functions/v1/telemetry-ingress';
const PROJECT = 'pvbcdndqjguzqeafhwhw';

describe('DEFAULT_CORE_INGEST_URL', () => {
    it('names the telemetry-ingress edge function', () => {
        expect(DEFAULT_CORE_INGEST_URL).toContain(INGEST_FN);
    });

    it('targets the same project as CORE_HITL_URL', () => {
        // Both must live on one project; if the project moves, both move.
        expect(DEFAULT_CORE_INGEST_URL).toContain(PROJECT);
    });

    it('does not point at api.axim.us.com', () => {
        // That host 302s to /404.html on every path. It must never come back.
        expect(DEFAULT_CORE_INGEST_URL).not.toContain('api.axim.us.com');
    });

    it('is an absolute https URL', () => {
        const url = new URL(DEFAULT_CORE_INGEST_URL);
        expect(url.protocol).toBe('https:');
        expect(url.pathname).toBe(INGEST_FN);
    });
});

describe('CORE_INGEST_URL is consistent across every declaration', () => {
    it('wrangler.jsonc and the code default agree', async () => {
        const raw = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
        const configured = raw.match(/"CORE_INGEST_URL"\s*:\s*"([^"]+)"/)?.[1];
        expect(configured).toBeDefined();
        expect(configured).toBe(DEFAULT_CORE_INGEST_URL);
    });

    it('.dev.vars.example agrees with the code default', async () => {
        const raw = await readFile(new URL('../.dev.vars.example', import.meta.url), 'utf8');
        const configured = raw.match(/^CORE_INGEST_URL=(.+)$/m)?.[1]?.trim();
        expect(configured).toBe(DEFAULT_CORE_INGEST_URL);
    });

    it('no declaration still points at the dead host', async () => {
        for (const file of ['../wrangler.jsonc', '../.dev.vars.example']) {
            const raw = await readFile(new URL(file, import.meta.url), 'utf8');
            // Strip comment lines so the explanatory note about api.axim.us.com
            // does not trip the assertion.
            const active = raw
                .split('\n')
                .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('#'))
                .join('\n');
            expect(active).not.toContain('api.axim.us.com/telemetry');
        }
    });
});

describe('CORS allows what the dashboard actually does', () => {
    const origin = 'https://axim.us.com';

    async function preflight(env = {}) {
        const res = await worker.fetch(
            new Request('https://onyx-edge.axim.us.com/api/v1/chat', {
                method: 'OPTIONS',
                headers: { Origin: origin },
            }),
            env,
            { waitUntil: () => {}, passThroughOnException: () => {} },
        );
        return res.headers;
    }

    it('permits GET, not just POST', async () => {
        const headers = await preflight();
        const methods = headers.get('access-control-allow-methods') || '';
        expect(methods).toContain('GET');
        expect(methods).toContain('POST');
        expect(methods).toContain('OPTIONS');
    });

    it('allows the X-Axim-* signing headers through preflight', async () => {
        const headers = await preflight();
        const allow = headers.get('access-control-allow-headers') || '';
        for (const h of [
            'X-Axim-Signature',
            'X-Axim-Signature-Version',
            'X-Axim-Timestamp',
            'Idempotency-Key',
        ]) {
            expect(allow.toLowerCase()).toContain(h.toLowerCase());
        }
    });

    it('echoes an allowed origin from the built-in list', async () => {
        const headers = await preflight();
        expect(headers.get('access-control-allow-origin')).toBe(origin);
    });

    it('accepts a comma-separated ALLOWED_ORIGIN list', async () => {
        // The old comparison was strict equality against one value, so a list
        // could never match and every entry after the first was dead config.
        const headers = await preflight({
            ALLOWED_ORIGIN: 'tauri://localhost, https://axim.us.com ,https://passport.axim.us.com',
        });
        expect(headers.get('access-control-allow-origin')).toBe(origin);
    });

    it('still refuses an unlisted origin', async () => {
        const res = await worker.fetch(
            new Request('https://onyx-edge.axim.us.com/api/v1/chat', {
                method: 'OPTIONS',
                headers: { Origin: 'https://evil.example.com' },
            }),
            { ALLOWED_ORIGIN: 'tauri://localhost,https://axim.us.com' },
            { waitUntil: () => {}, passThroughOnException: () => {} },
        );
        expect(res.headers.get('access-control-allow-origin')).toBe('null');
    });

    it('varies on Origin so caches do not cross-serve', async () => {
        const headers = await preflight();
        expect((headers.get('vary') || '').toLowerCase()).toContain('origin');
    });
});

describe('telemetry signer emits v2', () => {
    let source: string;

    it('signs "<timestamp>.<body>", not the body alone', async () => {
        source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
        expect(source).toContain('`${signatureTimestamp}.${String(row.payload)}`');
    });

    it('sends X-Axim-Signature-Version: 2', async () => {
        source ??= await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
        expect(source).toContain('"X-Axim-Signature-Version": "2"');
    });

    it('sends X-Axim-Timestamp alongside the signature', async () => {
        source ??= await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
        expect(source).toContain('"X-Axim-Timestamp": String(signatureTimestamp)');
    });

    it('never falls back to a literal signing key', async () => {
        source ??= await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
        // A missing secret must fail closed. The previous signer used
        // "default_internal_key_fallback", which meant an unconfigured deploy
        // signed with a public string.
        expect(source).not.toContain('default_internal_key_fallback');
    });

    it('warns when AXIM_INTERNAL_KEY is unbound', async () => {
        source ??= await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
        expect(source).toContain('edge.telemetry.ingest_unsigned');
    });
});

describe('resolveCronUrl still re-roots onto the new host', () => {
    it('derives the cron path from the telemetry-ingress URL', () => {
        expect(resolveCronUrl(DEFAULT_CORE_INGEST_URL)).toBe(
            `https://${PROJECT}.supabase.co/api/v1/internal/cron/daily-run`,
        );
    });
});
