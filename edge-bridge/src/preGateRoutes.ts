/**
 * Registry of every route the edge bridge answers *before* the global HMAC gate.
 *
 * `_fetch` in `index.ts` declares a dozen routes ahead of the "Strict HMAC
 * Validation for payload-mutating requests" gate, so those routes never reach
 * it and each has to authenticate itself. Adding another one above the gate is a
 * silent fail-open: it simply runs unauthenticated and nothing complains.
 *
 * This module is the checklist that stops that. `test/pre-gate-routes.test.ts`
 * parses `index.ts`, finds every route literal declared above the gate marker
 * (and every path the gate deliberately exempts), and fails if one is not
 * registered here — or if a registered route's declared `evidence` snippets are
 * no longer present in its handler block. So a new pre-gate route cannot land
 * without a reviewer-visible statement of how it authenticates, and an existing
 * one cannot quietly lose its check.
 *
 * Keep this list in step with `_fetch`. It is documentation with teeth, not a
 * dispatch table (yet) — the next step is to feed `classifyPreGateRoute()` into
 * the request path so the gate consults it instead of positional ordering.
 *
 * Not to be confused with `src/operatorAuthRoutes.ts`: that registry is consulted
 * by the gate at request time for routes *below* the marker whose handler
 * authenticates with an operator credential (a browser cannot produce the HMAC
 * the gate asks for). This file still describes the routes that never reach the
 * gate at all.
 */

export type PreGateAuthMode =
  /** No credential. Response carries nothing but liveness/status detail. */
  | "public"
  /** No credential, but a read-only pass-through to Core with no local state. */
  | "public-proxy"
  /** Verifies an HMAC over the raw body itself. */
  | "hmac"
  /** `checkAuth(request, env)` — operator secret, service key or Passport JWT. */
  | "operator"
  /** `checkAuth(request, env, true)` — super-admin only. */
  | "operator-superuser"
  /** Rate-limited here only; mutating calls still fall through to the global gate. */
  | "rate-limited"
  /** Handler-specific verification (e.g. a partner webhook signature). */
  | "route-specific";

export interface PreGateRoute {
  path: string;
  match: "exact" | "prefix";
  methods: string[];
  auth: PreGateAuthMode;
  /**
   * Normalised (whitespace-collapsed) source snippets that must appear in the
   * handler block for this route. Empty for `public` routes, which authenticate
   * by having nothing to protect.
   */
  evidence: string[];
  why: string;
}

/** Marks the boundary in `index.ts`; the invariant test measures "above" from here. */
export const GATE_MARKER = "Strict HMAC Validation for payload-mutating requests";

/**
 * Modes that authenticate by having nothing to protect: either a static health/
 * status body, or a read-only pass-through that touches no local state.
 */
export const CREDENTIAL_FREE_AUTH_MODES: PreGateAuthMode[] = [
  "public",
  "public-proxy",
];

/**
 * True when the route is expected to show its work: a credential check, a
 * signature check, or the rate-limit key it maintains.
 */
export function requiresAuthEvidence(route: PreGateRoute): boolean {
  return !CREDENTIAL_FREE_AUTH_MODES.includes(route.auth);
}

export const PRE_GATE_ROUTES: PreGateRoute[] = [
  {
    path: "/health",
    match: "exact",
    methods: ["GET"],
    auth: "public",
    evidence: [],
    why: "Liveness probe. Returns a static status body; used by uptime monitors.",
  },
  {
    path: "/api/v1/health",
    match: "exact",
    methods: ["GET"],
    auth: "public",
    evidence: [],
    why: "Alias of /health, same static body.",
  },
  {
    path: "/healthz",
    match: "exact",
    methods: ["GET"],
    auth: "public",
    evidence: [],
    why: "Colo + latency probe. Exposes edge region and duration only.",
  },
  {
    path: "/readyz",
    match: "exact",
    methods: ["GET"],
    auth: "public",
    evidence: [],
    why: "Readiness probe. Reports dependency names and ready/degraded, no credential or config value.",
  },
  {
    path: "/ready",
    match: "exact",
    methods: ["GET"],
    auth: "public",
    evidence: [],
    why: "Alias of /readyz.",
  },
  {
    path: "/functions/v1/telemetry-ingress",
    match: "exact",
    methods: ["POST"],
    auth: "hmac",
    evidence: [
      "verifyHmacSignature(request, rawBody, env.AXIM_INTERNAL_KEY)",
      "checkAuth(request, env)",
    ],
    why: "Satellites sign the body; operators present a credential. Fails closed when neither is valid.",
  },
  {
    path: "/api/v1/dlq-drain",
    match: "exact",
    methods: ["POST"],
    auth: "operator-superuser",
    evidence: ["checkAuth(request, env, true)"],
    why: "Forces an outbound replay and clears DLQ keys, so it is super-admin only.",
  },
  {
    path: "/api/v1/telemetry/dlq-status",
    match: "exact",
    methods: ["GET"],
    auth: "operator",
    evidence: ["checkAuth(request, env)"],
    why: "Discloses DLQ depth and Core reachability; the HUD polls it with an operator credential.",
  },
  {
    path: "/api/v1/telemetry/flush",
    match: "exact",
    methods: ["POST"],
    auth: "operator-superuser",
    evidence: ["checkAuth(request, env, true)"],
    why: "Marks up to 100 stored rows synced and replays them outward — mutating, super-admin only.",
  },
  {
    path: "/api/v1/onyx/emergency-direct",
    match: "exact",
    methods: ["POST"],
    auth: "hmac",
    evidence: [
      "verifyHmacSignature(request, rawBody, env.ONYX_EMERGENCY_SECRET)",
      "equalSecrets(authHeader, expectedToken)",
    ],
    why: "Out-of-band line. Requires an HMAC *and* a bearer of ONYX_EMERGENCY_SECRET, then an allow-listed email.",
  },
  {
    path: "/api/v1/onyx/summon",
    match: "exact",
    methods: ["POST"],
    auth: "hmac",
    evidence: ["verifyHmacSignature(", "checkAuth(request, env)"],
    why: "Machine callers sign with ONYX_CLIENT_SECRET; the cockpit presents a Passport JWT. No cookie-only path.",
  },
  {
    path: "/api/v1/schema",
    match: "prefix",
    methods: ["GET"],
    auth: "public-proxy",
    evidence: [],
    why: "Read-only Core schema lookup, cached at the edge for an hour. No local state is touched.",
  },
  {
    path: "/api/v1/template",
    match: "prefix",
    methods: ["GET"],
    auth: "public-proxy",
    evidence: [],
    why: "Read-only Core template lookup, same cache path as /api/v1/schema.",
  },
  {
    path: "/api/v1/telemetry/health",
    match: "exact",
    methods: ["GET"],
    auth: "public-proxy",
    evidence: [],
    why: "Core health mirror with a 15s edge TTL, so a stale upstream is not cached for an hour.",
  },
  {
    path: "/api/v1/llm/health",
    match: "exact",
    methods: ["GET"],
    auth: "public-proxy",
    evidence: [],
    why: "Core LLM health mirror, 15s TTL.",
  },
  {
    path: "/api/v1/generate/",
    match: "prefix",
    methods: ["GET", "POST", "PUT", "DELETE"],
    auth: "rate-limited",
    evidence: ["rate_limit:${ip}:${url.pathname}"],
    why: "Per-IP counter is bumped here; every mutating verb still reaches the global HMAC gate below, and the generate handlers re-check auth.",
  },
  {
    path: "/api/v1/generate/nda",
    match: "exact",
    methods: ["POST"],
    auth: "rate-limited",
    evidence: ["Idempotency-Key"],
    why: "Takes an idempotency lock before the gate so a duplicate submission returns 202 instead of generating twice. Body is still HMAC-verified below.",
  },
];

/**
 * Routes declared *after* the gate but excluded from it. Each must authenticate
 * inside its own handler, which is exactly the property the invariant test pins.
 */
export const GATE_EXEMPT_ROUTES: PreGateRoute[] = [
  {
    path: "/api/v1/webhooks",
    match: "exact",
    methods: ["POST"],
    auth: "route-specific",
    evidence: [
      "x-hub-signature-256",
      "x-wp-webhook-signature",
      "verifyHexHmacSignature(env.GITHUB_WEBHOOK_SECRET",
      "verifyHexHmacSignature(env.WP_WEBHOOK_SECRET",
      "equalSecrets(wpSecretParam, env.WP_WEBHOOK_SECRET)",
      "Missing signature",
    ],
    why: "GitHub and WordPress sign with their own secrets, not AXIM_INTERNAL_KEY. An unsigned call is refused.",
  },
];

export const ALL_REGISTERED_ROUTES: PreGateRoute[] = [
  ...PRE_GATE_ROUTES,
  ...GATE_EXEMPT_ROUTES,
];

/**
 * Look up the registry entry for a request. Longest prefix wins, so a specific
 * route can be registered alongside the prefix that would otherwise swallow it.
 */
export function classifyPreGateRoute(
  method: string,
  pathname: string,
  routes: PreGateRoute[] = PRE_GATE_ROUTES,
): PreGateRoute | undefined {
  const upper = method.toUpperCase();
  let best: PreGateRoute | undefined;

  for (const route of routes) {
    const methodMatches =
      route.methods.length === 0 || route.methods.includes(upper);
    if (!methodMatches) continue;

    const pathMatches =
      route.match === "exact"
        ? pathname === route.path
        : pathname.startsWith(route.path);
    if (!pathMatches) continue;

    if (!best || route.path.length > best.path.length) {
      best = route;
    }
  }

  return best;
}
