/**
 * Daily briefing (HITL digest) tests.
 *
 * Two defects on the pre-fix head (97630c3):
 *
 * 1. The digest's primary calls to action were dead. Phase B removed mutating GET
 *    from `/api/v1/hitl/action`, so a `?token=…&decision=approve` link now answers
 *    **405**. The email was never updated, so every "Approve Action" / "Reject
 *    Action" button in the daily briefing failed — silently, because the operator
 *    only sees a 405 JSON body after they have already committed to the decision.
 * 2. `parsed.description` was interpolated into the email HTML unescaped. A ticket
 *    description comes from a tool proposal, so it is attacker-influenceable input
 *    rendered into a message that arrives from a trusted internal sender.
 *
 * The tests below exercise the shipped functions and the real `worker.fetch`
 * handler, not a re-declaration of the logic.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, {
  escapeHtml,
  loadPendingHitlTickets,
  renderHitlDigestSection,
  renderHitlTicket,
  COCKPIT_ACTIONS_URL,
} from '../src/index';

const BASE = 'https://onyx-edge.axim.us.com';

const ENV = {
  AXIM_INTERNAL_KEY: 'internal-key',
  AXIM_ONYX_SECRET: 'onyx-secret',
  AXIM_SERVICE_KEY: 'service-key',
  ONYX_EMERGENCY_SECRET: 'emergency-secret',
  ONYX_CLIENT_SECRET: 'client-secret',
  CORE_INGEST_URL: 'https://api.axim.us.com/telemetry',
} as any;

/** Minimal in-memory KVNamespace, matching the shape used by the other suites. */
function fakeKV(seed: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
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

function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {},
  } as any;
}

/** Every href in a fragment, unescaped back to a usable URL. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) =>
    m[1]
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('D1 — the digest offers no one-click decision', () => {
  it('a ticket block carries no decision query parameter', () => {
    const html = renderHitlTicket({ token: 'tkt_123', description: 'Deploy relay' }, BASE);

    expect(html).not.toContain('decision=');
    expect(html).not.toContain('approve');
    expect(html).not.toContain('reject');
    for (const href of hrefs(html)) {
      const url = new URL(href);
      expect(url.searchParams.has('decision')).toBe(false);
    }
  });

  it('every edge URL in a ticket block is served, not 405', async () => {
    const env = { ...ENV, HITL_APPROVAL_KV: fakeKV({ tkt_123: { status: 'pending' } }) };
    const html = renderHitlTicket({ token: 'tkt_123', description: 'Deploy relay' }, BASE);

    const edgeUrls = hrefs(html).filter((h) => h.startsWith(`${BASE}/api/`));
    expect(edgeUrls.length).toBeGreaterThan(0);

    for (const href of edgeUrls) {
      const res = await worker.fetch(new Request(href, { method: 'GET' }), env, fakeCtx());
      // 401/403 would still be a broken button for the operator reading the mail,
      // so the assertion is on the specific statuses the old links produced.
      expect([404, 405]).not.toContain(res.status);
      expect(res.status).toBe(200);
    }
  });

  it('the cockpit link points at the actions view', () => {
    const html = renderHitlTicket({ token: 'tkt_123' }, BASE);
    expect(hrefs(html)).toContain(`${COCKPIT_ACTIONS_URL}?ticket=tkt_123`);
  });

  it('a token that needs encoding is encoded, not concatenated raw', () => {
    const html = renderHitlTicket({ token: 'a b&c=d' }, BASE);
    const urls = hrefs(html);
    expect(urls.some((u) => u.includes('token=a%20b%26c%3Dd'))).toBe(true);
  });
});

describe('D2 — ticket text cannot become markup', () => {
  it('escapes HTML metacharacters in the description', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml('" onmouseover="x')).toBe('&quot; onmouseover=&quot;x');
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('a malicious description renders inert inside the ticket block', () => {
    const html = renderHitlTicket(
      { token: 't', description: '<a href="https://evil.example">Reset your password</a>' },
      BASE,
    );

    // The text survives (an operator should see what the ticket says), but inert.
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
    // Exactly the two links we wrote, none injected by the description.
    expect(hrefs(html)).toHaveLength(2);
    expect(hrefs(html).some((h) => h.includes('evil.example'))).toBe(false);
  });

  it('falls back to a placeholder when a ticket has no description', () => {
    expect(renderHitlTicket({ token: 't' }, BASE)).toContain('System Proposal');
  });
});

describe('D3 — the pending-ticket loader', () => {
  it('returns only pending tickets, skipping decision records by prefix', async () => {
    const env = {
      ...ENV,
      HITL_APPROVAL_KV: fakeKV({
        tkt_pending: { status: 'pending', description: 'Deploy relay' },
        tkt_done: { status: 'approved', description: 'Already handled' },
        'action_decision:tkt_done': { action_id: 'tkt_done', status: 'approved' },
      }),
    };

    const tickets = await loadPendingHitlTickets(env as never);
    expect(tickets.map((t) => t.token)).toEqual(['tkt_pending']);
    expect(tickets[0].description).toBe('Deploy relay');
  });

  it('returns an empty list when the binding is absent', async () => {
    expect(await loadPendingHitlTickets(ENV as never)).toEqual([]);
  });

  it('keeps going past an unparseable ticket instead of dropping the whole run', async () => {
    const env = {
      ...ENV,
      HITL_APPROVAL_KV: fakeKV({ tkt_broken: '{not json', tkt_ok: { status: 'pending' } }),
    };

    const tickets = await loadPendingHitlTickets(env as never);
    expect(tickets.map((t) => t.token)).toEqual(['tkt_ok']);
  });

  it('says "no pending actions" for an empty queue', () => {
    expect(renderHitlDigestSection([], BASE)).toContain('No pending actions');
  });
});

describe('D4 — the email actually sent by the daily cron', () => {
  it('sends escaped ticket text and no decision links', async () => {
    const bodies: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any, init?: any) => {
        if (String(input).includes('emailit.com')) {
          bodies.push(JSON.parse(init.body));
          return new Response('{"ok":true}', { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const env = {
      ...ENV,
      EMAILIT_API_KEY: 'email-key',
      PUBLIC_BASE_URL: 'https://onyx-edge.axim.us.com/',
      HITL_APPROVAL_KV: fakeKV({
        tkt_123: { status: 'pending', description: 'Rotate <b>relay</b> key' },
      }),
    } as any;

    const ctx = fakeCtx();
    await worker.scheduled({ cron: '0 0 * * *' }, env, ctx);
    await Promise.all(ctx.pending);

    expect(bodies).toHaveLength(1);
    const html: string = bodies[0].html;

    // The ticket made it into the mail, escaped, and the base URL has no double slash.
    expect(html).toContain('Rotate &lt;b&gt;relay&lt;/b&gt; key');
    expect(html).toContain('https://onyx-edge.axim.us.com/api/v1/hitl/action?token=tkt_123');

    // No dead one-click buttons.
    expect(html).not.toContain('decision=');
    expect(html).not.toContain('Approve Action');
    expect(html).not.toContain('Reject Action');
  });

  it('does not send a briefing when there is nothing configured to send it with', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        calls.push(String(input));
        return new Response('{}', { status: 200 });
      }),
    );

    const ctx = fakeCtx();
    // No EMAILIT_API_KEY.
    await worker.scheduled(
      { cron: '0 0 * * *' },
      { ...ENV, PUBLIC_BASE_URL: 'https://onyx-edge.axim.us.com', HITL_APPROVAL_KV: fakeKV() },
      ctx,
    );
    await Promise.all(ctx.pending);

    expect(calls.filter((c) => c.includes('emailit.com'))).toEqual([]);
  });
});
