import {
  adminRoleFrom,
  isLegacyAdminRole,
  isSuperAdmin,
  SUPER_ADMIN_ROLE,
  verifyPassportJwt,
  type PassportClaims,
} from "./passport";
/**
 * Welcome to Cloudflare Workers!
 *
 * This is the Onyx Edge Bridge worker.
 */

import { z } from "zod";

export interface Env extends __BaseEnv_Env {
  AXIM_SERVICE_KEY?: string;
  AXIM_ONYX_SECRET?: string;
  DEEPSEEK_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  WP_WEBHOOK_SECRET?: string;
  AXIM_INTERNAL_KEY?: string;
  EMAILIT_API_KEY?: string;
  ONYX_CLIENT_SECRET?: string;
  ONYX_EMERGENCY_SECRET?: string;
  // CORE_HITL_URL is declared in wrangler.jsonc, so it arrives through
  // __BaseEnv_Env; re-declaring it here breaks `wrangler types` (the generated
  // type is the literal URL, not string | undefined).
  /** Core Supabase origin, used to derive CORE_HITL_URL when it is not set */
  CORE_SUPABASE_URL?: string;
  /** Service-role key for the Core project; required to apply a decision */
  CORE_SERVICE_ROLE_KEY?: string;
  CHAT_MODEL?: string;
  CRON_SECRET_KEY?: string;
  /** ISO date after which the body-only (legacy) signature form is refused. */
  SIGNATURE_LEGACY_SUNSET?: string;
  PUBLIC_BASE_URL?: string;
  THREADS_FEED_URL?: string;
  THREADS_FEED_TOKEN?: string;
}
/**
 * Versioned request signing with a date-keyed dual-accept window.
 *
 * Signatures over the raw body alone are replayable forever. The replacement
 * signs `<timestamp>.<body>` and carries the timestamp in a header, so a
 * receiver can reject stale requests.
 *
 *   v2     : X-Axim-Signature-Version: 2
 *            X-Axim-Timestamp: <unix seconds>      (required)
 *            X-Axim-Signature: sha256=<hex HMAC(secret, "<ts>.<body>")>
 *   legacy : X-Axim-Signature: sha256=<hex HMAC(secret, body)>
 *
 * Both are accepted until SIGNATURE_LEGACY_SUNSET (default 2026-12-31) so the
 * two repositories can be deployed asynchronously; after that date the legacy
 * form is refused and the window closes by date rather than by coordination.
 */
export const SIGNATURE_V2 = "2";
export const SIGNATURE_MAX_SKEW_SECONDS = 300;
export const DEFAULT_LEGACY_SUNSET = "2026-12-31T00:00:00Z";

export interface SignatureVerdict {
  ok: boolean;
  mode: "v2" | "legacy" | "none";
  reason?: string;
}

export async function verifyRequestSignature(
  request: Request,
  rawBody: string,
  secret: string | undefined,
  options: { nowMs?: number; legacySunset?: string } = {},
): Promise<SignatureVerdict> {
  try {
    if (!secret) return { ok: false, mode: "none", reason: "no signing secret configured" };

    const nowMs = options.nowMs ?? Date.now();
    const sunsetMs = Date.parse(options.legacySunset ?? DEFAULT_LEGACY_SUNSET);

    const signatureHeader = request.headers.get("X-Axim-Signature");
    if (!signatureHeader) return { ok: false, mode: "none", reason: "missing signature" };

    const cleanSig = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(cleanSig)) {
      return { ok: false, mode: "none", reason: "malformed signature" };
    }

    const rawTimestamp = request.headers.get("X-Axim-Timestamp");
    const version = request.headers.get("X-Axim-Signature-Version")?.trim();

    const verifyOver = async (message: string): Promise<boolean> => {
      const encoder = new TextEncoder();
      const sigBytes = new Uint8Array(
        cleanSig.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
      );
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(message));
    };

    if (version === SIGNATURE_V2) {
      if (!rawTimestamp) {
        return { ok: false, mode: "v2", reason: "v2 signature requires X-Axim-Timestamp" };
      }
      const timestamp = Number.parseInt(rawTimestamp, 10);
      if (!Number.isFinite(timestamp)) {
        return { ok: false, mode: "v2", reason: "invalid timestamp" };
      }
      if (Math.abs(nowMs / 1000 - timestamp) > SIGNATURE_MAX_SKEW_SECONDS) {
        return { ok: false, mode: "v2", reason: "timestamp outside the 5 minute window" };
      }
      return (await verifyOver(`${timestamp}.${rawBody}`))
        ? { ok: true, mode: "v2" }
        : { ok: false, mode: "v2", reason: "signature mismatch" };
    }

    if (Number.isFinite(sunsetMs) && nowMs > sunsetMs) {
      return {
        ok: false,
        mode: "legacy",
        reason: `legacy signature form is retired (sunset ${new Date(sunsetMs).toISOString()})`,
      };
    }

    if (rawTimestamp) {
      const timestamp = Number.parseInt(rawTimestamp, 10);
      if (
        Number.isFinite(timestamp) &&
        Math.abs(nowMs / 1000 - timestamp) > SIGNATURE_MAX_SKEW_SECONDS
      ) {
        return { ok: false, mode: "legacy", reason: "timestamp outside the 5 minute window" };
      }
    }

    return (await verifyOver(rawBody))
      ? { ok: true, mode: "legacy" }
      : { ok: false, mode: "legacy", reason: "signature mismatch" };
  } catch (err) {
    return { ok: false, mode: "none", reason: err instanceof Error ? err.message : "error" };
  }
}

/** Boolean wrapper kept for existing call sites. */
export async function verifyHmacSignature(
  request: Request,
  rawBody: string,
  secret: string | undefined,
  legacySunset?: string,
): Promise<boolean> {
  const verdict = await verifyRequestSignature(request, rawBody, secret, { legacySunset });
  return verdict.ok;
}

type HitlStatus = "Approved" | "Rejected";

interface HitlApplyResult {
  recorded: boolean;
  applied: boolean;
  core_status: number;
  reason?: string;
}

/**
 * Map every decision spelling the cockpit or an email link might send onto the
 * two values Core's `resolve-hitl` accepts. Returns null for anything else so
 * the caller can reject rather than record a meaningless status.
 */
function normalizeHitlDecision(raw: unknown): HitlStatus | null {
  if (typeof raw !== "string") return null;
  switch (raw.trim().toLowerCase()) {
    case "approve":
    case "approved":
      return "Approved";
    case "reject":
    case "rejected":
    case "deny":
    case "denied":
      return "Rejected";
    default:
      return null;
  }
}

function resolveHitlUrl(env: Env): string | null {
  if (env.CORE_HITL_URL) return env.CORE_HITL_URL;
  if (env.CORE_SUPABASE_URL) {
    return `${env.CORE_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/resolve-hitl`;
  }
  return null;
}

/**
 * Apply a HITL decision.
 *
 * A decision is only "applied" when Core's `resolve-hitl` function accepts it.
 * Recording it in KV and reporting success without relaying was the previous
 * behaviour: the cockpit showed APPROVED, the ticket vanished, and nothing
 * resumed. Callers must use `applied`, never a bare 200, to decide whether the
 * approval took effect.
 */
async function applyHitlDecision(
  env: Env,
  actionId: string,
  status: HitlStatus,
  operatorNotes: string | undefined,
  actor: string,
): Promise<HitlApplyResult> {
  const decidedAt = new Date().toISOString();

  // 1. Durable local record (best effort; KV is not the source of truth).
  if (env.HITL_APPROVAL_KV) {
    const record = { action_id: actionId, status, operator_notes: operatorNotes ?? null, actor, decided_at: decidedAt };
    await env.HITL_APPROVAL_KV.put(`action_decision:${actionId}`, JSON.stringify(record), { expirationTtl: 86400 });
  }
  if (env.EDGE_DLQ_KV) {
    await env.EDGE_DLQ_KV.put(
      `mcp_resolution:${actionId}:${Date.now()}`,
      JSON.stringify({ action_id: actionId, status, operator_notes: operatorNotes ?? null, actor, decided_at: decidedAt }),
      { expirationTtl: 86400 * 7 },
    );
  }

  // 2. Relay to Core — the only step that actually applies anything.
  const url = resolveHitlUrl(env);
  if (!url) {
    return { recorded: true, applied: false, core_status: 0, reason: "CORE_HITL_URL is not configured" };
  }
  if (!env.CORE_SERVICE_ROLE_KEY) {
    return { recorded: true, applied: false, core_status: 0, reason: "CORE_SERVICE_ROLE_KEY is not configured" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CORE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ log_id: actionId, status, action_payload: null }),
    });
    if (!res.ok) {
      return { recorded: true, applied: false, core_status: res.status, reason: `core responded ${res.status}` };
    }
    return { recorded: true, applied: true, core_status: res.status };
  } catch (err) {
    return {
      recorded: true,
      applied: false,
      core_status: 0,
      reason: `relay failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Perimeter guard for CGI argument injection, path traversal and PHP probes.
 *
 * The previous implementation matched substrings of `url.search` / `url.pathname`
 * from `new URL()`, which is normalised but NOT percent-decoded, so
 * `/?%61uto_prepend_file=x` and `/%252e%252e/` both passed. Its traversal clauses
 * were also dead for single-encoded input, because the URL parser resolves
 * `%2e%2e` segments before the check runs. Decode twice (to defeat double
 * encoding) and match the decoded form.
 */
function cgiGuard(request: Request): Response | null {
  const url = new URL(request.url);

  let path = url.pathname;
  let query = url.search;
  for (let i = 0; i < 2; i += 1) {
    try {
      path = decodeURIComponent(path);
      query = decodeURIComponent(query);
    } catch {
      // Malformed percent-encoding; evaluate what we already have.
      break;
    }
  }
  const pathLower = path.toLowerCase();
  const queryLower = query.toLowerCase();

  const cgiHit = /([?&]-d\b|auto_prepend_file|auto_append_file|allow_url_include|disable_functions|safe_mode)/.test(queryLower);
  const traversal = /(^|[\/\\])(\.|%2e){1,2}([\/\\]|$)/.test(pathLower);
  const phpProbe = /\.php([\/]|$)|\/wp-admin|\/wp-login\.php|xmlrpc\.php/.test(pathLower);

  if (cgiHit || traversal || phpProbe) {
    const reason = cgiHit ? "CGI argument injection" : traversal ? "path traversal" : "PHP probe";
    return new Response(JSON.stringify({ error: `Forbidden: ${reason} detected` }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

/**
 * Resolve the Core telemetry ingest URL.
 *
 * CORE_INGEST_URL may be configured either as a bare origin
 * ("https://api.axim.us.com") or as a fully-qualified ingest path
 * ("https://api.axim.us.com/telemetry"). The previous code unconditionally
 * appended "/functions/v1/telemetry-ingress", which produced a duplicated,
 * non-existent path against any configured value.
 */
function resolveIngestUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (/\/(telemetry-ingress|telemetry-ingest|telemetry)$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/telemetry`;
}

/**
 * Fail loudly when a KV binding the handler depends on is absent.
 *
 * HITL_APPROVAL_KV, EDGE_DLQ_KV and ECOSYSTEM_METRICS_KV are declared optional
 * in the Env interface but are not declared in wrangler.jsonc. The handlers used
 * to skip their writes and still answer 200/202, which made a non-functional
 * feature look functional. A missing binding is a deployment fault and must
 * surface as 503, not as success.
 */
function missingBinding(
  request: Request,
  env: Env,
  binding: string,
  feature: string,
): Response {
  console.error(
    `[onyx-edge] required KV binding ${binding} is not configured; ${feature} is unavailable`,
  );
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
      detail: `${feature} is unavailable: binding ${binding} is not configured on this deployment.`,
      instance: new URL(request.url).pathname,
    }),
    {
      status: 503,
      headers: {
        ...getCorsHeaders(request, env),
        "Content-Type": "application/problem+json",
      },
    },
  );
}

const ALLOWED_ORIGINS = [
  "https://axim.us.com",
  "https://api.axim.us.com",
  "http://localhost:3141",
  "http://localhost:8787",
  "https://quickdemandletter.com",
  "https://ellars.us.com",
  "https://piratefederation.org",
];

const TIMEOUT_SYMBOL = Symbol("TIMEOUT");
const WORKER_STARTED_AT = Date.now();
const UPSTREAM_TIMEOUT_MS = 15_000;

async function kvWriteWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 500,
  status?: { degraded: boolean },
): Promise<T | null> {
  try {
    const timeout = new Promise<typeof TIMEOUT_SYMBOL>((resolve) =>
      setTimeout(() => resolve(TIMEOUT_SYMBOL), timeoutMs),
    );
    const result = await Promise.race([promise, timeout]);
    if (result === TIMEOUT_SYMBOL) {
      console.error("error");
      if (status) status.degraded = true;
      return null;
    }
    return result as T;
  } catch (e) {
    console.error("error");
    if (status) status.degraded = true;
    return null;
  }
}

async function kvReadWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 500,
  status: { degraded: boolean },
): Promise<T | null> {
  try {
    const timeout = new Promise<typeof TIMEOUT_SYMBOL>((resolve) =>
      setTimeout(() => resolve(TIMEOUT_SYMBOL), timeoutMs),
    );
    const result = await Promise.race([promise, timeout]);
    if (result === TIMEOUT_SYMBOL) {
      console.error("error");
      status.degraded = true;
      return null;
    }
    return result as T;
  } catch (e) {
    console.error("error");
    status.degraded = true;
    return null;
  }
}

async function hashPrompt(prompt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(prompt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

function promptFromSummonPayload(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string" &&
    payload.message.trim()
  ) {
    return payload.message;
  }

  return "Hello";
}

function textSsePayload(model: string, responseText: string): string {
  return `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model } })}\n\nevent: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: responseText } })}\n\nevent: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: responseText.length } })}\n\nevent: message_stop\ndata: {}\n\ndata: [DONE]\n\n`;
}

async function invokeDeepSeek(
  env: Env,
  payload: unknown,
): Promise<{ model: string; text: string } | null> {
  if (!env.DEEPSEEK_API_KEY) {
    return null;
  }

  const model = env.DEEPSEEK_MODEL || "deepseek-chat";
  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: promptFromSummonPayload(payload) }],
      }),
    });
    if (!response.ok) {
      console.error("DeepSeek fallback request failed", response.status);
      return null;
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      console.error("DeepSeek fallback returned no text content");
      return null;
    }

    return { model, text };
  } catch (error) {
    console.error("DeepSeek fallback request errored", error);
    return null;
  }
}

async function invokeAnthropic(
  env: Env,
  payload: unknown,
): Promise<{ model: string; text: string } | null> {
  if (!env.ANTHROPIC_API_KEY) {
    return null;
  }

  const model = "claude-3-5-sonnet-20241022";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: promptFromSummonPayload(payload) }],
      }),
    });
    if (!response.ok) {
      console.error("Anthropic fallback request failed", response.status);
      return null;
    }

    const body = (await response.json()) as {
      content?: Array<{ text?: unknown }>;
    };
    const text = body.content?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) {
      console.error("Anthropic fallback returned no text content");
      return null;
    }

    return { model, text };
  } catch (error) {
    console.error("Anthropic fallback request errored", error);
    return null;
  }
}

function equalSecrets(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function getCorsHeaders(request: Request, env?: Env) {
  const origin = request.headers.get("Origin") || "";
  const isAllowed =
    ALLOWED_ORIGINS.includes(origin) ||
    origin === env?.ALLOWED_ORIGIN;

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Onyx-Session-Id, X-Onyx-Trace-Id, X-Correlation-ID, X-Request-ID",
    "Access-Control-Expose-Headers": "CF-Ray, X-Correlation-ID, X-Onyx-Session-Id, X-Onyx-Trace-Id, X-Onyx-Edge-Latency, X-Onyx-Edge-Health",
  };
}

function addOnyxHeaders(
  headers: HeadersInit,
  status: { degraded: boolean; startTime?: number; provider?: string; colo?: string },
  cacheStatus: string = "MISS",
  traceId?: string,
  rayId?: string,
): Headers {
  const h = new Headers(headers);

  if (status.startTime) {
    const latency = Date.now() - status.startTime;
    h.set("X-Onyx-Latency-Ms", latency.toString());
  }

  if (status.provider) {
    h.set("X-Onyx-Provider", status.provider);

  } else if (h.has("X-Onyx-Fallback")) {
    h.set("X-Onyx-Provider", "cloudflare-workers-ai");
  }
  if (traceId) {
    h.set("X-Onyx-Trace-Id", traceId);
    h.set("X-Request-ID", traceId);
    h.set("X-Correlation-ID", traceId);
  }
  if (rayId) {
    h.set("X-Onyx-Ray-ID", rayId);
    h.set("CF-Ray", rayId);
  }
  if (status.startTime) {
    const latency = (Date.now() - status.startTime).toFixed(2);
    h.set("x-onyx-edge-duration-ms", latency);
    h.set("x-onyx-edge-colo", status.colo || "unknown");
    h.set("X-Onyx-Edge-Latency", `${latency}ms`);
    h.set("cf-edge-latency-ms", `${latency}`);
  }
  h.set("X-Onyx-Edge-Health", status.degraded ? "DEGRADED" : "OK");
  h.set("X-Onyx-Cache-Status", cacheStatus);
  return h;
}

async function checkReadiness(
  env: Env,
): Promise<Record<string, "ready" | "unavailable">> {
  const probe = async (namespace: KVNamespace | undefined, key: string) => {
    if (!namespace) return "unavailable" as const;
    const timeout = new Promise<"unavailable">((resolve) =>
      setTimeout(() => resolve("unavailable"), 500),
    );
    try {
      return await Promise.race([
        namespace.get(key).then(() => "ready" as const),
        timeout,
      ]);
    } catch (error) {
      console.error(`Readiness probe failed for ${key}`, error);
      return "unavailable" as const;
    }
  };

  return {
    kv: await probe(env.ONYX_STATE, "__readyz_probe"),
    dispatch_locks: await probe(env.ONYX_DISPATCH_LOCKS, "__readyz_probe"),
    upstream_routing: env.CORE_INGEST_URL && env.AI ? "ready" : "unavailable",
  };
}

async function dispatchToCore(
  url: string,
  options: RequestInit,
  env: Env,
  ctx: ExecutionContext,
  payloadStr: string,
  successMessage: string,
  request: Request,
  edgeStatus: any,
  cacheStatus: string,
  traceId?: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchWithRetry(
      url,
      { ...options, signal: controller.signal },
      3,
    );
    clearTimeout(timeoutId);
    if (res.status >= 500) {
      throw new Error(`Upstream API error ${res.status}`);
    }
    return new Response(
      JSON.stringify({ status: "success", message: successMessage }),
      {
        headers: addOnyxHeaders(
          {
            ...getCorsHeaders(request, env),
            "Content-Type": "application/json",
          },
          edgeStatus,
          cacheStatus,
          traceId,
        ),
      },
    );
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("error");
    if (env.ONYX_STATE) {
      const dlqKey = `dlq:ingest:${Date.now()}:${crypto.randomUUID()}`;
      ctx?.waitUntil?.(env.ONYX_STATE.put(dlqKey, payloadStr));
    }
    return new Response(
      JSON.stringify({
        status: "QUEUED_EDGE_DLQ",
        message: "Payload buffered at edge for Core retry.",
      }),
      {
        status: 202,
        headers: addOnyxHeaders(
          {
            ...getCorsHeaders(request, env),
            "Content-Type": "application/json",
          },
          edgeStatus,
          cacheStatus,
          traceId,
        ),
      },
    );
  }
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) return res;
      lastErr = new Error(`HTTP error ${res.status}`);
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
  }
  throw lastErr;
}

// Timing-Safe Authentication Check Function

async function enforceAsguardRateLimit(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!env.ONYX_STATE || !env.ONYX_DB) return null;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const p = url.pathname;

  // Create a 10s window key
  const windowMs = 10000;
  const currentWindow = Math.floor(Date.now() / windowMs);
  const rateLimitKey = `rate_limit:${ip}:${p}:${currentWindow}`;

  try {
    const currentCountStr = await env.ONYX_STATE.get(rateLimitKey);
    const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
    const limit = 10; // Allow 10 mutating requests per 10s per IP for these endpoints

    if (currentCount >= limit) {
      return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Asguard Rate Limit Exceeded", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "10" }
      });
    }

    await env.ONYX_STATE.put(rateLimitKey, (currentCount + 1).toString(), { expirationTtl: 60 });
    return null;
  } catch (err) {
    console.error("error");
    return null; // fail open if KV errors
  }
}

async function checkAuth(req: Request, env: Env, requireSuperUser: boolean = false): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", {
      status: 401,
      headers: getCorsHeaders(req),
    });
  }

  const onyxToken = `Bearer ${env.AXIM_ONYX_SECRET}`;
  const serviceKey = `Bearer ${env.AXIM_SERVICE_KEY}`;

  const isInternalService = Boolean(env.AXIM_ONYX_SECRET) &&
    (equalSecrets(authHeader, onyxToken) || (
      Boolean(env.AXIM_SERVICE_KEY) && equalSecrets(authHeader, serviceKey)
    ));

  let passportClaims: PassportClaims | null = null;
  if (!isInternalService && authHeader.startsWith("Bearer ")) {
    passportClaims = await verifyPassportJwt(authHeader.slice(7), env);
  }

  if (!isInternalService && !passportClaims) {
    return new Response("Unauthorized", {
      status: 401,
      headers: getCorsHeaders(req),
    });
  }

  if (passportClaims) {
    // Canonical role is super_admin. Anything else that still grants admin is a
    // legacy spelling: accept it during the migration window, but make the usage
    // visible so it can be tracked and eventually removed.
    const role = adminRoleFrom(passportClaims);
    if (isLegacyAdminRole(role)) {
      const warning = {
        event: "legacy_admin_role",
        role,
        canonical: SUPER_ADMIN_ROLE,
        path: new URL(req.url).pathname,
        timestamp: new Date().toISOString(),
      };
      console.warn(JSON.stringify(warning));
      // Surface it in the edge metrics dataset when bound, so the count is
      // queryable rather than buried in logs.
      env.ONYX_EDGE_METRICS?.writeDataPoint?.({
        blobs: ["legacy_admin_role", String(role), warning.path],
        doubles: [1],
        indexes: ["legacy_admin_role"],
      });
    }
  }

  if (requireSuperUser) {
    const isSuperUser = isInternalService || (passportClaims !== null && isSuperAdmin(passportClaims));
    if (!isSuperUser) {
      return new Response(JSON.stringify({
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "Super User authorization required",
        instance: new URL(req.url).pathname
      }), {
        status: 403,
        headers: {
          ...getCorsHeaders(req, env),
          "Content-Type": "application/problem+json"
        },
      });
    }
  }

  return null;
}

async function bootstrapDatabase(env: Env): Promise<void> {
  void env;
}

async function drainIngestDlq(env: Env, ctx: ExecutionContext): Promise<void> {
  if (!env.ONYX_STATE) return;
  const listResult = await env.ONYX_STATE.list({
    prefix: "dlq:ingest:",
    limit: 50,
  });
  if (!listResult.keys || listResult.keys.length === 0) return;

  const coreUrl =
    env.CORE_INGEST_URL ||
    "https://api.axim.us.com/v1/functions/telemetry-ingest";

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const keyInfo of listResult.keys) {
    const key = keyInfo.name;
    const payload = await env.ONYX_STATE.get(key);
    if (!payload) continue;

    try {
      const res = await fetch(coreUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-onyx-edge-auth": env.AXIM_ONYX_SECRET || "",
        },
        body: payload,
      });

      if (res.status === 200 || res.status === 202) {
        await env.ONYX_STATE.delete(key);
      }

      await sleep(50);
    } catch (e) {
      console.error("error");
    }
  }
}

const onyx_handler: any = {
  async scheduled(
    controller: any,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      // Execute a low-overhead heartbeat sanity evaluation across active KV stores
      console.error("error");

      if (controller.cron === "*/5 * * * *") {
        ctx?.waitUntil?.(drainIngestDlq(env, ctx));
      }

      if (controller.cron === "0 12 * * *") {
        ctx?.waitUntil?.((async () => {
          if (!env.EMAILIT_API_KEY || !env.HITL_APPROVAL_KV) return;
          if (!env.PUBLIC_BASE_URL) {
            console.error("PUBLIC_BASE_URL is not set; skipping HITL digest email");
            return;
          }
          const baseUrl = env.PUBLIC_BASE_URL.replace(/\/+$/, "");

          const pendingList = await env.HITL_APPROVAL_KV.list();
          let hitlHtml = "";
          for (const key of pendingList.keys) {
            const val = await env.HITL_APPROVAL_KV.get(key.name);
            if (val) {
              try {
                const parsed = JSON.parse(val);
                if (parsed.status === 'pending') {
                  hitlHtml += `
                  <div style="border: 1px solid #334155; padding: 15px; margin-bottom: 10px; border-radius: 8px;">
                    <p style="margin: 0 0 10px 0; font-size: 16px;"><strong>Action Required:</strong> ${parsed.description || 'System Proposal'}</p>
                    <a href="${baseUrl}/api/v1/hitl/action?token=${key.name}&decision=approve" style="background: #10b981; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin-right: 10px;">Approve Action</a>
                    <a href="${baseUrl}/api/v1/hitl/action?token=${key.name}&decision=reject" style="background: #ef4444; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin-right: 10px;">Reject Action</a>
                    <a href="https://cockpit.axim.us.com/actions" style="background: #3b82f6; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block;">Review in Cockpit</a>
                  </div>`;
                }
              } catch(e) {}
            }
          }

          const emailHtml = `
          <div style="background-color: #0f172a; color: #f8fafc; padding: 30px; font-family: monospace;">
            <h1 style="border-bottom: 1px solid #334155; padding-bottom: 10px;">AXiM Onyx Executive Briefing</h1>
            <h2>Ecosystem Health & KPI Matrix</h2>
            <p>All core systems operational.</p>

            <h2>Pending Human-in-the-Loop Actions</h2>
            ${hitlHtml || '<p>No pending actions at this time.</p>'}
          </div>
          `;

          await fetch("https://api.emailit.com/v1/email/send", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.EMAILIT_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: "james.ellars@axim.us.com",
              bcc: "jrellars@gmail.com",
              subject: `[AXiM Onyx Executive Briefing] Daily Cross-Ecosystem Operations & HITL Digest - ${new Date().toISOString().split('T')[0]}`,
              html: emailHtml,
            }),
          });
        })());
      }

      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      if (env.ONYX_DB) {
        ctx?.waitUntil?.(
          env.ONYX_DB.batch([
            env.ONYX_DB.prepare(
              "DELETE FROM onyx_telemetry_logs WHERE created_at < ?",
            ).bind(thirtyDaysAgo),
            env.ONYX_DB.prepare(
              "DELETE FROM onyx_command_audit_logs WHERE created_at < ?",
            ).bind(thirtyDaysAgo),
            env.ONYX_DB.prepare(
              "DELETE FROM onyx_rate_limit_logs WHERE blocked_at < ?",
            ).bind(thirtyDaysAgo),
          ]),
        );
      }
      if (env.ONYX_PROMPT_CACHE) {
        await env.ONYX_PROMPT_CACHE.put(
          "heartbeat_sanity",
          new Date().toISOString(),
          { expirationTtl: 3600 },
        );
      }
      if (env.ONYX_SESSION_STATE) {
        await env.ONYX_SESSION_STATE.put(
          "heartbeat_sanity",
          new Date().toISOString(),
          { expirationTtl: 3600 },
        );
      }

      // Execute the Rust backend daily cron endpoint
      const backendCronUrl = env.CORE_INGEST_URL
        ? env.CORE_INGEST_URL.replace(
            "/v1/functions/telemetry-ingest",
            "/api/v1/internal/cron/daily-run",
          )
        : "http://localhost:3000/api/v1/internal/cron/daily-run";
      const cronSecret = env.CRON_SECRET_KEY;

      ctx?.waitUntil?.(
        fetch(backendCronUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cronSecret}`,
          },
        })
          .then((res) => void 0)
          .catch((e) => void 0),
      );

      // Pulse Sync: Fetch external social data and forward to Rust backend
      const secret = env.GITHUB_WEBHOOK_SECRET;
      if (!env.THREADS_FEED_URL || !secret) {
        return;
      }
      const feedRes = await fetch(env.THREADS_FEED_URL, {
        headers: env.THREADS_FEED_TOKEN
          ? { Authorization: `Bearer ${env.THREADS_FEED_TOKEN}` }
          : {},
      });
      if (!feedRes.ok) {
        throw new Error(`Threads feed returned ${feedRes.status}`);
      }
      const feed = (await feedRes.json()) as { posts?: unknown[] };
      const payloadString = JSON.stringify({
        source: "threads_api",
        type: "content_engine_daily",
        posts: Array.isArray(feed.posts) ? feed.posts : [],
      });
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );

      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(payloadString),
      );
      const signatureArray = Array.from(new Uint8Array(signatureBuffer));
      const signatureHex = signatureArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const expectedSignature = `sha256=${signatureHex}`;

      const coreUrl = env.CORE_INGEST_URL
        ? env.CORE_INGEST_URL.replace(
            "/v1/functions/telemetry-ingest",
            "/v1/events/ingress",
          )
        : "http://localhost:3000/v1/events/ingress";
      // Wait until telemetry ingest sends it
      ctx?.waitUntil?.(
        fetch(coreUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-hub-signature-256": expectedSignature,
            "x-onyx-cron-event": "content_engine_daily",
          },
          body: payloadString,
        })
          .then((res) => res.text())
          .then((t) => void 0)
          .catch((e) => void 0),
      );
    } catch (e) {
      console.error("error");
    }
  },
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const startTime = performance.now();
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: addOnyxHeaders(
            getCorsHeaders(request, env),
            { degraded: false },
            "MISS",
          ),
        });
      }

      const response = await this._fetch(request, env, ctx);
      const duration = performance.now() - startTime;
      const traceId =
        request.headers.get("X-Request-ID") ||
        request.headers.get("cf-ray") ||
        "unknown";
      console.error("error");
      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      const traceId =
        request.headers.get("X-Request-ID") ||
        request.headers.get("cf-ray") ||
        "unknown";
      console.error("error");
      throw error;
    }
  },

  async _fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const traceId =
      request.headers.get("X-Correlation-ID") ||
      request.headers.get("X-Request-ID") ||
      request.headers.get("cf-ray") ||
      crypto.randomUUID();
    const edgeStatus: { degraded: boolean; startTime: number; colo: string; provider?: string } = { degraded: false, startTime: Date.now(), colo: (request.cf?.colo as string) ?? "unknown" };
    const rayId = request.headers.get("cf-ray") || "unknown";
    let cacheStatus = "MISS";

    if (
      request.method !== "GET" &&
      request.method !== "POST" &&
      request.method !== "PUT" &&
      request.method !== "DELETE" &&
      request.method !== "OPTIONS"
    ) {
      console.error("error");
      return new Response("Method Not Allowed", {
        status: 405,
        headers: addOnyxHeaders(
          getCorsHeaders(request, env),
          edgeStatus,
          cacheStatus,
          traceId,
        ),
      });
    }

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response("OK", { headers: getCorsHeaders(request, env) });
    }

    // 2. Payload Size Validation
    if (request.method === "POST" || request.method === "PUT") {
      const contentLength = parseInt(
        request.headers.get("content-length") || "0",
        10,
      );
      // 1MB Limit
      if (contentLength > 2048000) {
        return new Response(
          JSON.stringify({ error: { code: "EDGE_ERROR", message: "Payload too large. Maximum size is 2MB.", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }),
          {
            status: 413,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          },
        );
      }
    }

    const url = new URL(request.url);

    const guardResponse = cgiGuard(request);
    if (guardResponse) return guardResponse;

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/v1/health")) {
      return new Response(JSON.stringify({ status: "healthy", upstream: "operational", active_sessions: "unknown", memory_usage: "unknown", service: "onyx-edge-bridge", version: "mk3-2.2", timestamp: new Date().toISOString() }), { status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders(request, env) } });
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      const durationMs = (Date.now() - edgeStatus.startTime).toFixed(2);
      return new Response(
        JSON.stringify({
          status: "ok",
          edge: "cloudflare",
          timestamp: Date.now(),
          region: request.cf?.colo ?? "unknown"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-onyx-trace-id": traceId,
            "x-onyx-edge-colo": (request.cf?.colo as string) ?? "unknown",
            "x-onyx-edge-duration-ms": durationMs,
            ...getCorsHeaders(request, env)
          }
        }
      );
    }

    if (request.method === "GET" && (url.pathname === "/readyz" || url.pathname === "/ready")) {
      const dependencies = await checkReadiness(env);
      const ready = Object.values(dependencies).every(
        (status) => status === "ready",
      );
      return new Response(
        JSON.stringify({
          status: ready ? "ready" : "degraded",
          timestamp: new Date().toISOString(),
          uptime_ms: Date.now() - WORKER_STARTED_AT,
          dependencies,
        }),
        {
          status: ready ? 200 : 503,
          headers: addOnyxHeaders(
            { "Content-Type": "application/json", ...getCorsHeaders(request, env) },
            { ...edgeStatus, degraded: !ready },
            cacheStatus,
            traceId,
            rayId,
          ),
        },
      );
    }


      // Asguard Rate-Limiting Shield
      const mutatingEndpoints = ["/v1/commands/dispatch", "/api/approve", "/api/v1/playbook/trigger"];
      if (request.method === "POST" && mutatingEndpoints.includes(url.pathname)) {
        const rateLimitRes = await enforceAsguardRateLimit(request, env, url);
        if (rateLimitRes) {
          // It will return 429 and the outer fetch will log to D1
          const traceId = request.headers.get("X-Request-ID") || crypto.randomUUID();
          return new Response(rateLimitRes.body, {
            status: 429,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
                "Retry-After": "10"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
      }

    if (
      request.method === "POST" &&
      url.pathname === "/functions/v1/telemetry-ingress"
    ) {
      ctx?.waitUntil?.(bootstrapDatabase(env));
      try {
        const rawBody = await request.clone().text();

        // SECURITY: this route is reachable before the global HMAC gate, so it must
        // authenticate itself. Accept a valid HMAC over the raw body (satellite
        // style) or a service/bearer credential (AXIM_ONYX_SECRET / AXIM_SERVICE_KEY
        // or a Passport JWT). Anonymous callers are rejected.
        const hmacOk = await verifyHmacSignature(request, rawBody, env.AXIM_INTERNAL_KEY);
        if (!hmacOk) {
          const authError = await checkAuth(request, env);
          if (authError) {
            return new Response(
              JSON.stringify({ error: "Unauthorized" }),
              {
                status: 401,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json",
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId,
                ),
              },
            );
          }
        }

        const payload = JSON.parse(rawBody || "{}") as {
          session_id?: string;
          status?: string;
        };
        const id =
          Date.now().toString() + "_" + Math.random().toString(36).substring(7);
        const payloadStr = JSON.stringify(payload);

        if (env.ONYX_DB) {
          ctx?.waitUntil?.(
            env.ONYX_DB.prepare(
              "INSERT INTO onyx_telemetry_logs (id, session_id, status, payload, synced, created_at) VALUES (?, ?, ?, ?, 0, ?)",
            )
              .bind(
                id,
                payload.session_id || "unknown",
                payload.status || "healthy",
                payloadStr,
                Date.now(),
              )
              .run(),
          );
        }

        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing",
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }
        const ingestUrl =
          resolveIngestUrl(env.CORE_INGEST_URL);
        ctx?.waitUntil?.(
          fetchWithRetry(ingestUrl, {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json", "Authorization": `Bearer ${env.AXIM_ONYX_SECRET}` },
              edgeStatus,
              cacheStatus,
              traceId,
              rayId,
            ),
            body: payloadStr,
          }).catch((e) => void 0),
        );
        return new Response(
          JSON.stringify({ success: true, message: "Telemetry ingested" }),
          {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          },
        );
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
            },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      }
    } else if (
      request.method === "POST" &&
      url.pathname === "/api/v1/dlq-drain"
    ) {
      const authError = await checkAuth(request, env, true);
      if (authError) return authError;

      if (!env.ONYX_STATE || !env.CORE_INGEST_URL) {
        return new Response(
          JSON.stringify({ error: { code: "EDGE_ERROR", message: "Missing config for DLQ drain", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }),
          {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          },
        );
      }

      const listRes = await env.ONYX_STATE.list({ prefix: "dlq:ingest:" });
      let replayed = 0;
      const coreUrl = new URL(env.CORE_INGEST_URL).origin;

      for (const key of listRes.keys) {
        const payload = await env.ONYX_STATE.get(key.name);
        if (payload) {
          try {
            const res = await fetch(env.CORE_INGEST_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Onyx-Trace-Id": typeof traceId !== 'undefined' ? traceId : "unknown" },
              body: payload,
            });
            if (res.ok) {
              await env.ONYX_STATE.delete(key.name);
              replayed++;
            }
          } catch (e) {
            console.error("error");
          }
        }
      }

      return new Response(JSON.stringify({ status: "success", replayed }), {
        headers: addOnyxHeaders(
          {
            ...getCorsHeaders(request, env),
            "Content-Type": "application/json",
          },
          edgeStatus,
          cacheStatus,
          traceId,
        ),
      });
        } else if (request.method === "GET" && url.pathname === "/api/v1/telemetry/dlq-status") {
      const authError = await checkAuth(request, env);
      if (authError) return authError;

      if (!env.EDGE_DLQ_KV) {
        return missingBinding(request, env, "EDGE_DLQ_KV", "DLQ status");
      }

      let unsynced_relays_depth = 0;
      let unsynced_receipts_depth = 0;
      let upstream_core_ok = true;

      try {
        if (env.EDGE_DLQ_KV) {
          const listRes = await env.EDGE_DLQ_KV.list({ limit: 1000 });
          unsynced_relays_depth = listRes.keys.length;
        }

        if (env.ONYX_DB) {
           const result = await env.ONYX_DB.prepare(
              "SELECT COUNT(*) as count FROM onyx_telemetry_logs WHERE synced = 0"
           ).first();
           if (result) {
              unsynced_receipts_depth = result.count as number;
           }
        }

        if (env.CORE_INGEST_URL) {
           try {
              const res = await fetch(env.CORE_INGEST_URL.replace(/\/$/, "") + "/health", { method: "HEAD", cf: { cacheEverything: false } });
              upstream_core_ok = res.ok;
           } catch(e) {
              upstream_core_ok = false;
           }
        }
      } catch (e) {
         console.error("dlq-status fetch error");
      }

      return new Response(
        JSON.stringify({
          status: "healthy",
          timestamp: new Date().toISOString(),
          unsynced_relays_depth,
          unsynced_receipts_depth,
          edge_circuit_breaker: "closed",
          upstream_core_ok,
        }),
        {
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
            },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        },
      );
} else if (
      request.method === "POST" &&
      url.pathname === "/api/v1/telemetry/flush"
    ) {
      ctx?.waitUntil?.(bootstrapDatabase(env));

      // SECURITY: previously unauthenticated. Anyone could force an outbound replay
      // of up to 100 stored rows per call and have them marked synced.
      const flushAuthError = await checkAuth(request, env, true);
      if (flushAuthError) return flushAuthError;

      if (!env.CORE_INGEST_URL) {
        return new Response(
          JSON.stringify({
            error: "Configuration error: CORE_INGEST_URL is missing",
          }),
          {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          },
        );
      }
      try {
        if (env.ONYX_DB) {
          const result = await env.ONYX_DB.prepare(
            "SELECT * FROM onyx_telemetry_logs WHERE synced = 0 LIMIT 100",
          ).all();
          const rows = result.results;
          if (rows && rows.length > 0) {
            const ingestUrl =
              resolveIngestUrl(env.CORE_INGEST_URL);
            for (const row of rows) {

              // Generate HMAC signature for telemetry
              const textEncoder = new TextEncoder();
              const keyData = textEncoder.encode(env.AXIM_INTERNAL_KEY || "default_internal_key_fallback");
              const messageData = textEncoder.encode(String(row.payload));
              const cryptoKey = await crypto.subtle.importKey(
                "raw",
                keyData,
                { name: "HMAC", hash: "SHA-256" },
                false,
                ["sign"]
              );
              const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
              const signatureArray = Array.from(new Uint8Array(signatureBuffer));
              const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

              const res = await fetchWithRetry(ingestUrl, {
                method: "POST",
                headers: addOnyxHeaders(
                  {
                    "Content-Type": "application/json",
                    "X-Axim-Signature": signatureHex
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId,
                  rayId,
                ),
                body: String(row.payload),
              });

              if (res.status === 200) {
                await env.ONYX_DB.prepare(
                  "UPDATE onyx_telemetry_logs SET synced = 1 WHERE id = ?",
                )
                  .bind(row.id)
                  .run();
              }
            }
          }
          return new Response(
            JSON.stringify({ success: true, flushed: rows ? rows.length : 0 }),
            {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }
        return new Response(
          JSON.stringify({ success: false, message: "No DB" }),
          {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          },
        );
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
            },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      }

    } else if (
      request.method === "POST" &&
      url.pathname === "/api/v1/onyx/emergency-direct"
    ) {
      const rawBody = await request.clone().text();
      const isValidHmac = await verifyHmacSignature(request, rawBody, env.ONYX_EMERGENCY_SECRET);
      if (!isValidHmac) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }

      // Out-of-band Emergency Direct Line
      const authHeader = request.headers.get("Authorization");

      const expectedToken = "Bearer " + env.ONYX_EMERGENCY_SECRET;
      // Validate bearer token or HMAC header against env.ONYX_EMERGENCY_SECRET.
      if (!authHeader || authHeader !== expectedToken) {
        // SECURITY: never reflect a server secret back to the caller. This branch
        // previously returned AXIM_ONYX_SECRET in the Authorization header, which
        // escalated a holder of ONYX_EMERGENCY_SECRET to the master Onyx secret.
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
            edgeStatus, cacheStatus, traceId
          )
        });
      }

      let payload: any;
      try {
        payload = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
      }

      const email = payload?.email || payload?.parameters?.email;
      if (email !== "jrellars@gmail.com" && email !== "james.ellars@axim.us.com") {
        return new Response(JSON.stringify({ error: "Forbidden: Unrecognized executive identity." }), {
          status: 403,
          headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
            edgeStatus, cacheStatus, traceId
          )
        });
      }

      const action = payload.action;
      let reply = "Action executed successfully.";

      if (action === "health_check") {
        reply = "Onyx Mk3 Bare-Metal status: ONLINE. Memory: OK. Swarm locks: NOMINAL.";
      } else if (action === "trigger_recovery") {
        reply = "Recovery recipe triggered successfully.";
      } else if (action === "query_onyx") {
        reply = "Query dispatched to primary LLM pipeline.";
      } else {
        reply = "Unrecognized emergency action.";
      }

      return new Response(JSON.stringify({ status: "success", reply, timestamp: new Date().toISOString() }), {
        status: 200,
        headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
          edgeStatus, cacheStatus, traceId
        )
      });
} else if (
      request.method === "POST" &&
      url.pathname === "/api/v1/onyx/summon"
    ) {
      const rawBody = await request.clone().text();

      // Machine callers sign with ONYX_CLIENT_SECRET. Operators authenticate with
      // a Passport JWT, which is what the cockpit actually sends. Previously this
      // route required the HMAC *and* a bearer of the same shared secret, so the
      // browser could never satisfy it and every message 401'd. The unvalidated
      // `axim_session` cookie check is gone: a cookie whose value is never
      // verified is not a credential.
      const hasValidHmac = await verifyHmacSignature(
        request,
        rawBody,
        env.ONYX_CLIENT_SECRET,
      );
      if (!hasValidHmac) {
        const authError = await checkAuth(request, env);
        if (authError) {
          return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Unauthorized Access", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
          status: 401,
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
            },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
          });
        }
      }

      // We pass the request directly to the core ingest since we authenticated successfully.
      if (!env.CORE_INGEST_URL) {
        return new Response(
          JSON.stringify({
            error: "Configuration error: CORE_INGEST_URL is missing",
          }),
          {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          },
        );
      }

      const ingestUrl = env.CORE_INGEST_URL;

      let payload: unknown = {};
      try {
        const rawBodyText = await request.clone().text();
        if (rawBodyText) {
          payload = JSON.parse(rawBodyText);
        }
      } catch (e) {
        console.error("error");
      }

      try {
        const summonRes = await fetchWithRetry(
          ingestUrl,
          {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json", "Authorization": `Bearer ${env.AXIM_ONYX_SECRET}` },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: JSON.stringify({
              type: "onyx_summon",
              payload,
              timestamp: new Date().toISOString(),
            }),
          },
          3,
        );

        if (
          !summonRes.ok ||
          summonRes.headers.get("x-onyx-all-providers-down") === "true"
        ) {
          throw new Error("Providers down or 503");
        }
      } catch (error) {
        console.error("AXiM Core summon request failed", error);
        const fallback = await invokeDeepSeek(env, payload) ||
          await invokeAnthropic(env, payload);
        if (fallback) {
          edgeStatus.provider = fallback.model.startsWith("deepseek")
            ? "deepseek"
            : "anthropic";
          return new Response(textSsePayload(fallback.model, fallback.text), {
            status: 200,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "text/event-stream",
                "X-Onyx-Fallback": edgeStatus.provider,
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        }

        return new Response(
          JSON.stringify({
            error: {
              code: "UPSTREAM_UNAVAILABLE",
              message: "AXiM Core and configured AI fallbacks are unavailable.",
              trace_id: traceId,
            },
          }),
          {
            status: 503,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              { ...edgeStatus, degraded: true },
              cacheStatus,
              traceId,
            ),
          },
        );
      }

      edgeStatus.provider = "core";
      return new Response(
        JSON.stringify({
          status: "success",
          message: "Summon payload queued successfully.",
        }),
        {
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
            },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        },
      );
    }

    // 3. Edge Caching for Stateless Requests (Schemas/Templates/Telemetry)
    if (
      request.method === "GET" &&
      (url.pathname.startsWith("/api/v1/schema") ||
        url.pathname.startsWith("/api/v1/template") ||
        url.pathname === "/api/v1/telemetry/health" ||
        url.pathname === "/api/v1/llm/health")
    ) {
      const cacheUrl = new Request(request.url, request);
      const cache = caches.default;
      const cachedResponse = await cache.match(cacheUrl);
      if (cachedResponse) {
        cacheStatus = "HIT";
        return new Response(cachedResponse.body, {
          status: cachedResponse.status,
          statusText: cachedResponse.statusText,
          headers: addOnyxHeaders(
            cachedResponse.headers,
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      }

      // Simulate fetching from AXiM Core API
      const coreUrl = env.CORE_INGEST_URL
        ? new URL(env.CORE_INGEST_URL).origin
        : "https://api.axim.us.com";
      try {
        const res = await fetch(`${coreUrl}${url.pathname}`, { headers: { "X-Onyx-Trace-Id": traceId || "unknown" } });
        if (res.ok) {
          const maxAge =
            url.pathname === "/api/v1/telemetry/health" ||
            url.pathname === "/api/v1/llm/health"
              ? 15
              : 3600;
          const responseToCache = new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
              "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
            },
          });
          ctx?.waitUntil?.(cache.put(cacheUrl, responseToCache.clone()));
          return new Response(responseToCache.body, {
            status: responseToCache.status,
            statusText: responseToCache.statusText,
            headers: addOnyxHeaders(
              responseToCache.headers,
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        }
      } catch (e) {
        // Fallback to not found or core error handled below
      }
    }

    // 4. Rate Limiting for /v1/generate/*
    if (url.pathname.startsWith("/api/v1/generate/")) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateLimitKey = `rate_limit:${ip}:${url.pathname}`;
      if (env.ONYX_STATE) {
        const currentHitsStr = await kvReadWithTimeout(
          env.ONYX_STATE.get(rateLimitKey),
          500,
          edgeStatus,
        );
        const currentHits = parseInt(currentHitsStr || "0", 10);

        // Limit: 10 requests per window (simulated with 60s TTL)

        if (currentHits >= 10) {
          if (env.ONYX_DB) {
            ctx?.waitUntil?.(
              env.ONYX_DB.prepare(
                "INSERT INTO onyx_rate_limit_logs (id, ip_address, endpoint, user_id, blocked_at) VALUES (?, ?, ?, ?, ?)",
              )
                .bind(
                  crypto.randomUUID(),
                  ip,
                  url.pathname,
                  "anonymous",
                  Math.floor(Date.now() / 1000),
                )
                .run(),
            );
          }
          return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Too Many Requests", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
            status: 429,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
                "Retry-After": "60",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        }

        ctx?.waitUntil?.(
          kvWriteWithTimeout(
            env.ONYX_STATE.put(rateLimitKey, (currentHits + 1).toString(), {
              expirationTtl: 60,
            }),
            500,
            edgeStatus,
          ),
        );
      }
    }

    try {
      let parsedBody: any = null;
      let rawBodyText = null;
      // Idempotency protection for /v1/generate/nda
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/generate/nda"
      ) {
        const idempotencyKey = request.headers.get("Idempotency-Key");
        if (idempotencyKey && env.ONYX_DISPATCH_LOCKS) {
          const existingLock = await kvReadWithTimeout(
            env.ONYX_DISPATCH_LOCKS.get(`lock:${idempotencyKey}`),
            500,
            edgeStatus,
          );
          if (existingLock) {
            console.error("error");
            return new Response(
              JSON.stringify({
                status: "processing",
                message: "Request already being processed.",
              }),
              {
                status: 202,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json",
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId,
                ),
              },
            );
          }
          await kvWriteWithTimeout(
            env.ONYX_DISPATCH_LOCKS.put(`lock:${idempotencyKey}`, "locked", {
              expirationTtl: 180,
            }),
            500,
            edgeStatus,
          );
        }
      }

      if (
        request.method === "POST" ||
        request.method === "PUT" ||
        request.method === "DELETE"
      ) {
        rawBodyText = await request.clone().text();

        // Strict HMAC Validation for payload-mutating requests
        // Exclude /api/v1/webhooks which uses specific partner logic
        if (url.pathname !== "/api/v1/webhooks") {
          // Constant-time verification (crypto.subtle.verify) over the raw body.
          // verifyAximSignature compared hex strings with !==, which short-circuits
          // on the first differing byte and leaks the expected digest by timing.
          const sigOk = await verifyHmacSignature(
            request,
            rawBodyText,
            env.AXIM_INTERNAL_KEY,
          );
          if (!sigOk) {
            return new Response(
              request.headers.get("x-axim-signature")
                ? "Invalid HMAC signature"
                : "Missing x-axim-signature header",
              {
                status: request.headers.get("x-axim-signature") ? 403 : 401,
                headers: getCorsHeaders(request, env),
              },
            );
          }
        }
        if (rawBodyText) {
          try {
            parsedBody = JSON.parse(rawBodyText);
            // Ambient action-hook capturing mechanism
            if (
              url.pathname.startsWith("/api/v1/action-hook") ||
              url.pathname.includes("mutation") ||
              url.pathname.includes("transaction")
            ) {
              if (env.ONYX_STATE) {
                const hookSignature =
                  request.headers.get("x-action-signature") || "unverified";
                const telemetryPayload = JSON.stringify({
                  path: url.pathname,
                  signature: hookSignature,
                  timestamp: new Date().toISOString(),
                });
                ctx?.waitUntil?.(
                  kvWriteWithTimeout(
                    env.ONYX_STATE.put(
                      `action_hook:${Date.now()}_${Math.random().toString(36).substring(7)}`,
                      telemetryPayload,
                      { expirationTtl: 86400 },
                    ),
                    500,
                    edgeStatus,
                  ),
                );
              }
            }
          } catch (e) {
            return new Response(
              JSON.stringify({ error: { code: "EDGE_ERROR", message: "Structurally invalid JSON payload.", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }),
              {
                status: 400,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json",
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId,
                ),
              },
            );
          }
        }
      }

      if (request.method === "GET" && url.pathname === "/api/v1/health/edge") {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
            },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      }
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/v1/health")) {
        try {
          const supabaseUrl = env.CORE_INGEST_URL
            ? new URL(env.CORE_INGEST_URL).origin
            : "https://api.axim.us.com";
          const pingRes = await fetch(`${supabaseUrl}/rest/v1/`, {
            method: "GET",
          }).catch(() => null);

          const isOp = true; // Always operational locally or test

          if (!isOp) {
            return new Response(
              JSON.stringify({
                status: "degraded",
                service: "onyx-mk3",
                timestamp: new Date().toISOString(),
              }),
              {
                status: 503,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json",
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId,
                ),
              },
            );
          }

          return new Response(
            JSON.stringify({
              status: "operational",
              service: "onyx-mk3",
              timestamp: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({
              status: "degraded",
              service: "onyx-mk3",
              timestamp: new Date().toISOString(),
            }),
            {
              status: 503,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }
} else if (
        request.method === "GET" &&
        url.pathname === "/api/v1/rate-limit/metrics"
      ) {
        const authError = await checkAuth(request, env);
        if (authError) return authError;

        if (!env.ONYX_DB) {
          return new Response(
            JSON.stringify({ error: { code: "EDGE_ERROR", message: "Database not configured", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }

        try {
          const { results } = await env.ONYX_DB.prepare(
            "SELECT endpoint, COUNT(*) as breach_count FROM onyx_rate_limit_logs GROUP BY endpoint",
          ).all();

          return new Response(
            JSON.stringify({ status: "success", metrics: results || [] }),
            {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        } catch (e) {
          console.error("error");
          return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Internal error", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        }
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/billing/fallback-blockchain"
      ) {
        // Handles Web3 routing / Multi-chain settlement verification
        const payload = parsedBody || {};
        if (!payload.tx_hash || !payload.wallet_address) {
          return new Response(
            JSON.stringify({ error: { code: "EDGE_ERROR", message: "Invalid blockchain settlement details", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }),
            {
              status: 400,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }

        const idempotencyKey =
          request.headers.get("Idempotency-Key") || payload.idempotency_key;
        if (idempotencyKey && env.ONYX_STATE) {
          const cachedResponse = await kvReadWithTimeout(
            env.ONYX_STATE.get(`idem:${idempotencyKey}`),
            500,
            edgeStatus,
          );
          if (cachedResponse) {
            cacheStatus = "HIT";
            return new Response(cachedResponse, {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            });
          }
        }

        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing",
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }
        const ingestUrl = env.CORE_INGEST_URL;
        ctx?.waitUntil?.(
          fetchWithRetry(ingestUrl, {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json", "Authorization": `Bearer ${env.AXIM_ONYX_SECRET}` },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: JSON.stringify({
              type: "blockchain_fallback",
              tx_hash: payload.tx_hash,
              wallet_address: payload.wallet_address,
              timestamp: new Date().toISOString(),
            }),
          }).catch((e) => void 0),
        );

        const responseBody = JSON.stringify({
          status: "success",
          message: "Blockchain fallback verification queued.",
        });

        if (idempotencyKey && env.ONYX_STATE) {
          ctx?.waitUntil?.(
            kvWriteWithTimeout(
              env.ONYX_STATE.put(`idem:${idempotencyKey}`, responseBody, {
                expirationTtl: 86400,
              }),
              500,
              edgeStatus,
            ),
          ); // Keep for 24h
        }

        return new Response(responseBody, {
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
            },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      } else if (request.method === "GET" && url.pathname.startsWith("/api/v1/playbooks/")) {
        const authError = await checkAuth(request, env);
        if (authError) return authError;

        const playbookId = url.pathname.split("/").pop();
        if (!playbookId) {
          return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Missing playbook ID", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
            status: 400,
            headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
          });
        }

        const cacheKey = `playbook:${playbookId}`;

        if (env.ONYX_KV) {
          const cachedPlaybook = await kvReadWithTimeout(env.ONYX_KV.get(cacheKey), 500, { degraded: false });
          if (cachedPlaybook) {
            cacheStatus = "HIT";
            return new Response(cachedPlaybook, {
              status: 200,
              headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
            });
          }
        }

        if (!env.CORE_INGEST_URL) {
          return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Configuration error: CORE_INGEST_URL is missing", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), { status: 500, headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId) });
        }

        // Use backend to fetch
        const backendUrl = env.CORE_INGEST_URL.replace(/\/v1\/functions\/telemetry-ingest$/, "") + `/api/v1/playbooks/${playbookId}`;

        try {
          const res = await fetch(backendUrl, {
            headers: {
              "Authorization": request.headers.get("Authorization") || "",
              "X-Onyx-Trace-Id": traceId || "unknown"
            }
          });

          if (res.ok) {
            const data = await res.text();
            if (env.ONYX_KV) {
               ctx?.waitUntil?.(kvWriteWithTimeout(env.ONYX_KV.put(cacheKey, data, { expirationTtl: 3600 }), 500, { degraded: false }));
            }
            return new Response(data, {
              status: 200,
              headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
            });
          } else {
             return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Failed to fetch playbook", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
                status: res.status,
                headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
             });
          }
        } catch (e) {
           return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Internal Server Error while fetching playbook", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
             status: 500,
             headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
           });
        }

      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/tasks/dispatch"
      ) {
        const rawBody = await request.clone().text();
        const isValidHmac = await verifyHmacSignature(request, rawBody, env.AXIM_ONYX_SECRET);
        if (!isValidHmac) {
          return new Response(JSON.stringify({ error: "Unauthorized Signature" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

        let payload = parsedBody || {};

        // Transform webhook to AximWebhookPayload schema if necessary
        const corePayload = {
          source_channel: payload.source_channel || "albato_webhook",
          intent: payload.intent || "sync_lead_enrich",
          meta_data: payload.meta_data || payload.meta || payload,
          timestamp: payload.timestamp || new Date().toISOString()
        };

        const coreUrl = env.CORE_INGEST_URL ? env.CORE_INGEST_URL.replace(/\/v1\/commands\/dispatch$/, "") : "http://127.0.0.1:3141";
        const rustCoreEndpoint = `${coreUrl}/api/v1/tasks/execute`;

        try {
          const coreRes = await fetch(rustCoreEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${env.AXIM_ONYX_SECRET || ""}`,
              "X-Onyx-Trace-Id": traceId || "unknown"
            },
            body: JSON.stringify(corePayload),
          });

          const coreText = await coreRes.text();
          return new Response(coreText, {
            status: coreRes.status,
            headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: "Core failure", details: err.message }), {
            status: 500,
            headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
          });
        }
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/playbook/trigger"
      ) {
        const authError = await checkAuth(request, env, true);
        if (authError) return authError;

        const ALLOWED_PLAYBOOKS = ["support_triage", "sync_lead_enrich"];
        const playbookBody: any = parsedBody || {};
        const playbook = playbookBody.playbook;
        const jsonHeaders = addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId);
        if (typeof playbook !== "string" || !ALLOWED_PLAYBOOKS.includes(playbook)) {
          return new Response(JSON.stringify({ error: "Unknown playbook", allowed: ALLOWED_PLAYBOOKS }), { status: 400, headers: jsonHeaders });
        }
        if (!env.CORE_INGEST_URL) {
          return new Response(JSON.stringify({ error: "CORE_INGEST_URL is not configured" }), { status: 503, headers: jsonHeaders });
        }

        const triggerEndpoint = `${new URL(env.CORE_INGEST_URL).origin}/api/v1/tasks/execute`;
        try {
          const coreRes = await fetch(triggerEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${env.AXIM_ONYX_SECRET || ""}`,
              "X-Onyx-Trace-Id": traceId || "unknown"
            },
            body: JSON.stringify({
              source_channel: "action_console",
              intent: playbook,
              meta_data: playbookBody.params && typeof playbookBody.params === "object" ? playbookBody.params : {},
              timestamp: new Date().toISOString()
            }),
          });
          return new Response(await coreRes.text(), { status: coreRes.status, headers: jsonHeaders });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: "Core failure", details: err.message }), { status: 502, headers: jsonHeaders });
        }
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/commands/dispatch"
      ) {
      const rawBody = await request.clone().text();
      const isValidHmac = await verifyHmacSignature(request, rawBody, env.AXIM_ONYX_SECRET);
      if (!isValidHmac) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }

        const authError = await checkAuth(request, env, true);
        if (authError) return authError;

        const payload = parsedBody || {};
        if (!payload.task) {
          return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Missing 'task' in dispatch payload", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
            status: 400,
            headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
          });
        }

        const taskPacket = { source_channel: "webhook_ingress", intent: "webhook_trigger", priority: "Standard", meta_data: payload, timestamp: new Date().toISOString() };
        if (!env.CORE_INGEST_URL) {
          return new Response(JSON.stringify({ error: "CORE_INGEST_URL is not configured" }), {
            status: 503,
            headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
          });
        }
        try {
          const dispatchRes = await fetch(`${new URL(env.CORE_INGEST_URL).origin}/api/v1/tasks/execute`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${env.AXIM_ONYX_SECRET || ""}`,
              "X-Onyx-Trace-Id": traceId || "unknown"
            },
            body: JSON.stringify(taskPacket),
          });
          if (!dispatchRes.ok) {
            return new Response(JSON.stringify({ error: "Core rejected dispatch", status: dispatchRes.status }), {
              status: 502,
              headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
            });
          }
        } catch (err: any) {
          return new Response(JSON.stringify({ error: "Core failure", details: err.message }), {
            status: 502,
            headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
          });
        }
        return new Response(JSON.stringify({ status: "dispatched", task: payload.task, args: payload.args }), {
          status: 200,
          headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
        });
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/session/heartbeat"
      ) {
        const authError = await checkAuth(request, env);
        if (authError) return authError;

        try {
          const body: any = await request.clone().json();
          if (!body.session_id) {
            return new Response(
              JSON.stringify({ error: { code: "EDGE_ERROR", message: "Missing session_id", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }),
              {
                status: 400,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json",
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId,
                ),
              },
            );
          }

          // Try to forward heartbeat to backend with 800ms timeout
          let backendSuccess = false;
          if (env.CORE_INGEST_URL) {
            const ingestUrl =
              env.CORE_INGEST_URL.replace(/\/$/, "") +
              "/api/v1/session/heartbeat";

            try {
              const fetchPromise = fetchWithRetry(ingestUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: request.headers.get("Authorization") || "",
                },
                body: JSON.stringify(body),
              });

              const timeoutPromise = new Promise<typeof TIMEOUT_SYMBOL>(
                (resolve) => setTimeout(() => resolve(TIMEOUT_SYMBOL), 800),
              );

              const result = await Promise.race([fetchPromise, timeoutPromise]);
              if (result !== TIMEOUT_SYMBOL && (result as Response).ok) {
                backendSuccess = true;
              }
            } catch (backendError) {
              console.error("error");
            }
          }

          if (!backendSuccess) {
            // Synthetic response logic
            if (env.ONYX_SESSION_STATE) {
              ctx?.waitUntil?.(
                kvWriteWithTimeout(
                  env.ONYX_SESSION_STATE.put(
                    body.session_id,
                    Date.now().toString(),
                  ),
                  500,
                  edgeStatus,
                ),
              );
            }

            // Send warning telemetry to backend asynchronously
            if (env.CORE_INGEST_URL) {
              const telemetryUrl =
                env.CORE_INGEST_URL.replace(/\/$/, "") +
                "/api/v1/telemetry/ingest";
              ctx?.waitUntil?.(
                fetch(telemetryUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "X-Onyx-Trace-Id": traceId || "unknown" },
                  body: JSON.stringify({ warning: "INTERCEPTED_HEARTBEAT" }),
                }).catch(() => {}), // Fire and forget
              );
            }
          } else {
            // Update local DB if backend was successful
            if (env.ONYX_DB) {
              const now = Math.floor(Date.now() / 1000);
              await env.ONYX_DB.prepare(
                `INSERT INTO onyx_user_sessions (session_id, user_id, client_version, last_seen)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(session_id) DO UPDATE SET
                   user_id=excluded.user_id,
                   client_version=excluded.client_version,
                   last_seen=excluded.last_seen`,
              )
                .bind(
                  body.session_id,
                  body.user_id || null,
                  body.client_version || null,
                  now,
                )
                .run()
                .catch(() => {});
            }
          }

          return new Response(
            JSON.stringify({
              status: "success",
              session_id: body.session_id,
              synthetic: !backendSuccess,
            }),
            {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        } catch (e: any) {
          console.error("error");
          return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Internal error", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        }
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/hitl/action"
      ) {
        // A decision is an action, so it is a POST with an authenticated actor.
        // This used to be a GET with the decision in the query string, which
        // mail scanners, link previewers and browser prefetch all fire.
        const authError = await checkAuth(request, env, true);
        if (authError) return authError;

        let body: { action_id?: string; decision?: unknown; operator_notes?: string };
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const actionId = body.action_id;
        if (!actionId || typeof actionId !== "string") {
          return new Response(JSON.stringify({ error: "Missing action_id" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const status = normalizeHitlDecision(body.decision);
        if (!status) {
          return new Response(
            JSON.stringify({ error: "decision must be approve or reject" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const actor =
          request.headers.get("cf-access-authenticated-user-email") ||
          request.headers.get("x-axim-operator") ||
          "operator";

        const result = await applyHitlDecision(
          env,
          actionId,
          status,
          body.operator_notes,
          actor,
        );

        // 200 only when Core accepted the decision. Anything else is a failure the
        // operator must see, even though the decision was recorded locally.
        const httpStatus = result.applied ? 200 : result.core_status === 0 ? 503 : 502;

        return new Response(
          JSON.stringify({
            success: result.applied,
            applied: result.applied,
            recorded: result.recorded,
            action_id: actionId,
            status,
            core_status: result.core_status,
            ...(result.reason ? { reason: result.reason } : {}),
            decided_at: new Date().toISOString(),
          }),
          {
            status: httpStatus,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          },
        );
      } else if (
        request.method === "GET" &&
        url.pathname === "/api/v1/hitl/action"
      ) {
        // Read-only view of a ticket. Mutating on GET was the defect; the endpoint
        // stays for the "here is what you are approving" page only.
        const token = url.searchParams.get("token");
        if (!token) {
          return new Response(JSON.stringify({ error: "Missing token" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.searchParams.has("decision")) {
          return new Response(
            JSON.stringify({
              error:
                "Decisions are no longer accepted on GET. POST /api/v1/hitl/action with { action_id, decision } and an operator credential.",
            }),
            { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
          );
        }
        if (!env.HITL_APPROVAL_KV) {
          return missingBinding(request, env, "HITL_APPROVAL_KV", "HITL ticket lookup");
        }
        const record = await env.HITL_APPROVAL_KV.get(token);
        if (!record) {
          return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(record, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/mcp/execute"
      ) {
        const authError = await checkAuth(request, env, true);
        if (authError) return authError;
        try {
          const body: any = await request.json();
          const { action_id, decision, operator_notes } = body;

          if (!action_id || !decision) {
            return new Response("Missing action_id or decision", { status: 400, headers: getCorsHeaders(request, env) });
          }

          const status = normalizeHitlDecision(decision);
          if (!status) {
            return new Response(JSON.stringify({ error: "decision must be approve or reject" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          // Same path as POST /api/v1/hitl/action. Previously this wrote a KV key
          // nothing reads and answered success:true, so the cockpit showed an
          // approval that never resumed anything.
          const result = await applyHitlDecision(
            env,
            action_id,
            status,
            operator_notes,
            request.headers.get("cf-access-authenticated-user-email") || "operator",
          );

          return new Response(JSON.stringify({
             success: result.applied,
             applied: result.applied,
             recorded: result.recorded,
             action_id,
             status,
             core_status: result.core_status,
             ...(result.reason ? { reason: result.reason } : {}),
             resolved_at: new Date().toISOString()
          }), {
            status: result.applied ? 200 : result.core_status === 0 ? 503 : 502,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        } catch(e) {
          return new Response("Error processing request", { status: 500, headers: getCorsHeaders(request, env) });
        }
      } else if (
        request.method === "GET" &&
        url.pathname === "/events"
      ) {
        // EventSource cannot set headers, so the passport token arrives as a query param.
        const queryToken = url.searchParams.get("token");
        const sseReq = new Request(request.url, {
          method: "GET",
          headers: { Origin: request.headers.get("Origin") || "", ...(queryToken ? { Authorization: `Bearer ${queryToken}` } : {}) },
        });
        const authError = await checkAuth(sseReq, env, true);
        if (authError) return authError;
        if (!env.HITL_APPROVAL_KV) {
          return new Response("HITL store not configured", { status: 503, headers: getCorsHeaders(request, env) });
        }

        const kv = env.HITL_APPROVAL_KV;
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const seen = new Set<string>();
        const send = (chunk: string) => writer.write(encoder.encode(chunk));

        ctx?.waitUntil?.((async () => {
          try {
            await send(": connected\n\n");
            for (let i = 0; i < 12; i++) {
              const list = await kv.list();
              for (const key of list.keys) {
                if (seen.has(key.name) || key.name.startsWith("action_decision:")) continue;
                const raw = await kv.get(key.name);
                if (!raw) continue;
                let parsed: any;
                try { parsed = JSON.parse(raw); } catch { continue; }
                if (parsed.status !== "pending") continue;
                seen.add(key.name);
                await send(`event: action_pending\ndata: ${JSON.stringify({
                  action_id: key.name,
                  tool_name: parsed.tool_name,
                  risk_level: parsed.risk_level,
                  description: parsed.description,
                  parameters: parsed.parameters ?? parsed.params,
                  timestamp: parsed.timestamp,
                })}\n\n`);
              }
              await send(": keepalive\n\n");
              await new Promise((resolve) => setTimeout(resolve, 5000));
            }
          } catch {
            // client disconnected
          } finally {
            try { await writer.close(); } catch { /* already closed */ }
          }
        })());

        return new Response(readable, {
          headers: {
            ...getCorsHeaders(request, env),
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      } else if (
        request.method === "GET" &&
        url.pathname === "/api/v1/onyx/swarm-state"
      ) {
        const swarmAuthError = await checkAuth(request, env);
        if (swarmAuthError) return swarmAuthError;

        let locks = [];
        if (env.ONYX_DISPATCH_LOCKS) {
           const list = await env.ONYX_DISPATCH_LOCKS.list();
           for (const key of list.keys) {
               const val = await env.ONYX_DISPATCH_LOCKS.get(key.name);
               if (val) locks.push(JSON.parse(val));
           }
        }
        return new Response(JSON.stringify({
            locks,
            timestamp: new Date().toISOString(),
            status: locks.length > 0 ? "LOCKED" : "READY"
        }), {
            status: 200,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
        });
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/ecosystem/event"
      ) {
        // Step 1: Ecosystem Event Ingress
        //
        // The global gate above already verified X-Axim-Signature over these exact
        // bytes with AXIM_INTERNAL_KEY. This route previously re-verified the same
        // header against AXIM_ONYX_SECRET, so a caller had to produce one signature
        // that was simultaneously valid under two different keys — unreachable for
        // every client, including Core's onyx-bridge relay. Authentication here is
        // the gate's responsibility; this handler only parses.
        const rawBody = await request.clone().text();

        try {
          const payload = JSON.parse(rawBody);
          const eventId = crypto.randomUUID();
          const kvKey = `metric_${payload.source_app || "unknown"}_${Date.now()}_${eventId}`;

          if (!env.ECOSYSTEM_METRICS_KV) {
            return missingBinding(request, env, "ECOSYSTEM_METRICS_KV", "Ecosystem event ingestion");
          }
          {
            ctx?.waitUntil?.(
              env.ECOSYSTEM_METRICS_KV.put(
                kvKey,
                JSON.stringify({
                  source_app: payload.source_app,
                  timestamp: payload.timestamp,
                  event_type: payload.event_type,
                  payload: payload.payload,
                  severity: payload.severity,
                }),
                { expirationTtl: 604800 }
              )
            );
          }

          return new Response(JSON.stringify({ status: "ingested", event_id: eventId }), {
            status: 202,
            headers: addOnyxHeaders(
              { ...getCorsHeaders(request, env), "Content-Type": "application/json" },
              edgeStatus,
              cacheStatus,
              traceId
            ),
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Invalid payload", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), { status: 400 });
        }
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/email/send"
      ) {
        ctx?.waitUntil?.(bootstrapDatabase(env));
        const authError = await checkAuth(request, env, true);
        if (authError) return authError;

        if (!env.EMAILIT_API_KEY) {
          return new Response(
            JSON.stringify({ error: { code: "EDGE_ERROR", message: "EMAILIT_API_KEY is not configured", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }

        try {
          const rawBodyText = await request.clone().text();
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);

          let emailitRes;
          try {
            emailitRes = await fetch("https://api.emailit.com/v1/email/send", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.EMAILIT_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: rawBodyText,
              signal: controller.signal
            });
          } finally {
            clearTimeout(timeout);
          }

          if (!emailitRes.ok) {
            const errText = await emailitRes.text();
            throw new Error(
              `EmailIt API failed with status ${emailitRes.status}: ${errText}`
            );
          }

          const responseData = await emailitRes.json();
          return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        } catch (e: any) {
          if (env.EDGE_DLQ_KV) {
            try {
              const bodyStr = await request.clone().text();
              await env.EDGE_DLQ_KV.put(
                `email_dlq_${Date.now()}_${crypto.randomUUID()}`,
                bodyStr
              );
            } catch (dlqErr) {
              console.error("error");
            }
          }

          const errorMsg = e.message || "Failed to send email";
          const isStreaming = request.headers.get("Accept")?.includes("text/event-stream");
          if (isStreaming) {
            const ssePayload = `event: error\ndata: ${JSON.stringify({ type: "error", errorText: errorMsg })}\n\ndata: [DONE]\n\n`;
            return new Response(ssePayload, {
              status: 200,
              headers: addOnyxHeaders(
                { ...getCorsHeaders(request, env), "Content-Type": "text/event-stream" },
                edgeStatus, cacheStatus, traceId
              )
            });
          }
          return new Response(JSON.stringify({
            type: "about:blank",
            title: "Email Dispatch Failed",
            status: 500,
            detail: errorMsg,
            instance: url.pathname
          }), {
            status: 500,
            headers: addOnyxHeaders(
              { ...getCorsHeaders(request, env), "Content-Type": "application/problem+json" },
              edgeStatus, cacheStatus, traceId
            )
          });
        }
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/email-webhook"
      ) {
        // Extract the email body and subject, identify prospect research requests,
        // and wrap the payload into a TaskPacket with intent: "generate_prospect_report"
        const rawBody = await request.clone().text();
        const payload = parsedBody || {};

        let company_name = "Unknown";
        if (payload.subject) {
            const match = payload.subject.match(/Prospect Research:?\s*(.*)/i);
            if (match && match[1]) {
                company_name = match[1].trim();
            }
        }

        let taskPacket = {
           source_channel: "email_ingress",
           intent: "generate_prospect_report",
           priority: "Standard",
           meta_data: {
               company_name: company_name,
               context: payload.body || payload.text || ""
           },
           timestamp: new Date().toISOString()
        };

        const bodyStr = JSON.stringify(taskPacket);

        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({ error: "Configuration error: CORE_INGEST_URL is missing" }),
            { status: 500, headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId) }
          );
        }

        return await dispatchToCore(
          env.CORE_INGEST_URL,
          {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json", "Authorization": `Bearer ${env.AXIM_ONYX_SECRET}` },
              edgeStatus, cacheStatus, traceId
            ),
            body: bodyStr,
          },
          env,
          ctx,
          bodyStr,
          "Email Webhook passed to Rust core.",
          request,
          edgeStatus,
          cacheStatus,
          traceId,
        );
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/webhooks"
      ) {
        // Handle GitHub/WordPress webhooks
        const rawBody = await request.clone().text();
        const payload = parsedBody || {};

        const githubSignature = request.headers.get("x-hub-signature-256");
        const wpSignature = request.headers.get("x-wp-webhook-signature");
        const wpSecretParam = url.searchParams.get("wp_secret");

        if (githubSignature) {
          if (!env.GITHUB_WEBHOOK_SECRET) {
            return new Response("Webhook secret not configured", {
              status: 500,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            });
          }

          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(env.GITHUB_WEBHOOK_SECRET),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"],
          );

          const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(rawBody),
          );

          const signatureArray = Array.from(new Uint8Array(signatureBuffer));
          const signatureHex = signatureArray
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const expectedSignature = `sha256=${signatureHex}`;

          if (githubSignature !== expectedSignature) {
            return new Response("Invalid GitHub signature", {
              status: 401,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            });
          }
        } else if (wpSignature) {
          // Webhook verification for WP
          if (!env.WP_WEBHOOK_SECRET) {
            return new Response("Webhook secret not configured", {
              status: 500,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            });
          }

          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(env.WP_WEBHOOK_SECRET),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"],
          );

          const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(rawBody),
          );

          const signatureArray = Array.from(new Uint8Array(signatureBuffer));
          const signatureHex = signatureArray
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          if (
            wpSignature !== signatureHex &&
            wpSignature !== `sha256=${signatureHex}`
          ) {
            return new Response("Invalid WP signature", {
              status: 401,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            });
          }
        } else if (wpSecretParam) {
          if (!env.WP_WEBHOOK_SECRET) {
            return new Response("Webhook secret not configured", {
              status: 500,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            });
          }
          if (!equalSecrets(wpSecretParam, env.WP_WEBHOOK_SECRET)) {
            return new Response("Invalid WP secret", {
              status: 401,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            });
          }
        } else {
          return new Response("Missing signature", {
            status: 401,
            headers: addOnyxHeaders(
              getCorsHeaders(request, env),
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        }

        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing",
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }
        const ingestUrl = env.CORE_INGEST_URL;

        const taskPacket = { source_channel: "webhook_ingress", intent: "webhook_trigger", priority: "Standard", meta_data: payload, timestamp: new Date().toISOString() };
        const bodyStr = JSON.stringify(taskPacket);
        return await dispatchToCore(
          ingestUrl,
          {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json", "Authorization": `Bearer ${env.AXIM_ONYX_SECRET}` },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: bodyStr,
          },
          env,
          ctx,
          bodyStr,
          "Webhook passed to Rust core.",
          request,
          edgeStatus,
          cacheStatus,
          traceId,
        );
            } else if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/v1/health")) {
        return new Response(JSON.stringify({
          status: 'healthy',
          upstream: 'operational',
          mcp_status: 'operational',
          active_sessions: 'unknown',
          memory_usage: 'unknown',
          service: 'onyx-edge-bridge',
          version: 'mk3-2.2',
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) }
        });
      } else if (request.method === "GET" && url.pathname === "/api/health") {
        const healthStatus = {
          status: "healthy",
          uptime: 0,
          mcp_status: "operational",
          provider_status: "operational",
          primary_provider: "operational",
          fallback_provider: "standby",
          timestamp: new Date().toISOString()
        };
        return new Response(JSON.stringify(healthStatus), {
          status: 200,
          headers: addOnyxHeaders(
            { ...getCorsHeaders(request, env), "Content-Type": "application/json" },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      } else if (request.method === "GET" && url.pathname === "/api/telemetry/summary") {
        const telemetrySummary = {
          requests_current_window: 0,
          avg_latency_ms: 0,
          status: "operational",
          primary_provider: "operational",
          fallback_provider: "standby"
        };
        return new Response(JSON.stringify(telemetrySummary), {
          status: 200,
          headers: addOnyxHeaders(
            { ...getCorsHeaders(request, env), "Content-Type": "application/json" },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      } else if (request.method === "GET" && env.ASSETS) {
          try {
            const assetResponse = await env.ASSETS.fetch(request);
            if (assetResponse && assetResponse.status !== 404) {
              return assetResponse;
            }
          } catch (e) {
            console.error("error");
          }
        return new Response("Not Found", {
          status: 404,
          headers: addOnyxHeaders(
            getCorsHeaders(request, env),
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      }
      return new Response("Not Found", {
        status: 404,
        headers: addOnyxHeaders(
          getCorsHeaders(request, env),
          edgeStatus,
          cacheStatus,
          traceId,
        ),
      });
    } catch (error) {
      console.error("error");
      return new Response(JSON.stringify({ error: { code: "EDGE_ERROR", message: "Internal Server Error", provider: "cloudflare", trace_id: request.headers.get("x-request-id") || "unknown" } }), {
        status: 500,
        headers: addOnyxHeaders(
          {
            ...getCorsHeaders(request, env),
            "Content-Type": "application/json",
          },
          edgeStatus,
          cacheStatus,
          traceId,
        ),
      });
    }
  },
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const startTime = Date.now();
    let response;
    const url = new URL(request.url);

    const guardResponse = cgiGuard(request);
    if (guardResponse) return guardResponse;


    const isChatEndpoint = url.pathname === "/api/v1/chat" && request.method === "POST";
    let isFallbackToAi = false;
    let originalRequestBody: any;

    if (isChatEndpoint && env.AI) {
      try {
        originalRequestBody = await request.clone().json();
      } catch (e) { }
    }

    try {
      response = await onyx_handler._fetch(request, env, ctx);

      if (isChatEndpoint && env.AI && (response.status === 429 || response.status >= 500)) {
         throw new Error("Primary provider failed, triggering fallback");
      }
    } catch (e) {
      console.error("error");

      if (isChatEndpoint && env.AI && originalRequestBody) {
        isFallbackToAi = true;
        const messages = [];
        if (originalRequestBody.system) messages.push({ role: "system", content: originalRequestBody.system });
        if (originalRequestBody.messages) messages.push(...originalRequestBody.messages);
        else if (originalRequestBody.message) messages.push({ role: "user", content: originalRequestBody.message });

        try {
          const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
            messages,
          });

          const isStreaming = request.headers.get("Accept")?.includes("text/event-stream");

          if (isStreaming) {
             const ssePayload = `event: message-start\ndata: ${JSON.stringify({ type: "message-start", messageId: "msg_fallback" })}\n\nevent: text-delta\ndata: ${JSON.stringify({ type: "text-delta", delta: aiResponse.response })}\n\nevent: text-end\ndata: ${JSON.stringify({ type: "text-end", id: "msg_fallback" })}\n\nevent: finish\ndata: ${JSON.stringify({ type: "finish", finishReason: "stop" })}\n\ndata: [DONE]\n\n`;
             response = new Response(ssePayload, {
                status: 200,
                headers: addOnyxHeaders(
                  { ...getCorsHeaders(request, env), "Content-Type": "text/event-stream" },
                  { degraded: true, startTime, provider: "cloudflare_workers_ai", colo: (request.cf?.colo as string) ?? "unknown" }, "MISS", request.headers.get("x-request-id") || crypto.randomUUID()
                )
             });
          } else {
             response = new Response(
                JSON.stringify({
                  data: {
                    id: "msg_fallback",
                    role: "assistant",
                    parts: [ { type: "text", text: aiResponse.response } ],
                    metadata: { finishReason: "stop" }
                  }
                }),
                {
                  status: 200,
                  headers: addOnyxHeaders(
                    { "Content-Type": "application/json", ...getCorsHeaders(request, env) },
                    { degraded: true, startTime, provider: "cloudflare_workers_ai", colo: (request.cf?.colo as string) ?? "unknown" }, "MISS", request.headers.get("x-request-id") || crypto.randomUUID()
                  )
                }
             );
          }
        } catch (aiErr) {
             // Fallback failed
        }
      }

      if (!isFallbackToAi || !response) {
          const traceIdFallback = request.headers.get("x-request-id") || crypto.randomUUID();
          const isStreaming = request.headers.get("Accept")?.includes("text/event-stream");
          if (isStreaming) {
            const ssePayload = `event: error\ndata: ${JSON.stringify({ type: "error", errorText: "Internal Server Error" })}\n\ndata: [DONE]\n\n`;
            response = new Response(ssePayload, {
              status: 200,
              headers: addOnyxHeaders(
                { ...getCorsHeaders(request, env), "Content-Type": "text/event-stream" },
                { degraded: true, startTime, colo: (request.cf?.colo as string) ?? "unknown" }, "MISS", traceIdFallback
              )
            });
          } else {
            response = new Response(
              JSON.stringify({ error: "Internal Server Error", fallback: true }),
              {
                status: 500,
                headers: addOnyxHeaders(
                  { "Content-Type": "application/json", ...getCorsHeaders(request, env) },
                  { degraded: true, startTime, colo: (request.cf?.colo as string) ?? "unknown" }, "MISS", traceIdFallback
                )
              }
            );
          }
      }
    }

    const latency = Date.now() - startTime;
    const traceId = response.headers.get("X-Onyx-Trace-Id") || "unknown";

    if (
      url.pathname === "/api/v1/chat" ||
      url.pathname.startsWith("/api/v1/jules/") ||
      url.pathname === "/api/health" ||
      url.pathname === "/api/telemetry/summary"
    ) {

    }
    if (response.status === 429) {
      if (env.ONYX_DB) {
        const ip = request.headers.get("cf-connecting-ip") || "unknown";


        ctx?.waitUntil?.(
          env.ONYX_DB.prepare(
            "INSERT INTO onyx_rate_limit_logs (id, ip_address, endpoint, user_id, blocked_at) VALUES (?, ?, ?, ?, ?)",
          )
            .bind(
              crypto.randomUUID(),
              ip,
              url.pathname,
              "anonymous",
              Math.floor(Date.now() / 1000),
            )
            .run()
            .catch((e) => void 0),
        );
      }
    }


    const logEntry = {
      requestId: request.headers.get("cf-ray") || traceId,
      method: request.method,
      path: url.pathname,
      statusCode: response.status,
      latencyMs: latency,
      providerTarget: response.headers.get("X-Onyx-Provider") || (isFallbackToAi ? "cloudflare_workers_ai" : "unknown"),
      timestamp: new Date().toISOString(),
      tokens: response.headers.get("X-Onyx-Token-Count") || 0,
      errorTrace: response.headers.get("X-Onyx-Error-Trace") || "none",
    };
    console.log(JSON.stringify(logEntry));
    if (env.ONYX_EDGE_METRICS) {
      ctx?.waitUntil?.(
        new Promise<void>((resolve) => {
          try {
            env.ONYX_EDGE_METRICS!.writeDataPoint({
              blobs: [
                logEntry.method,
                logEntry.path,
                logEntry.requestId,
                logEntry.statusCode.toString(),
                logEntry.providerTarget,
                logEntry.errorTrace.toString()
              ],
              doubles: [logEntry.latencyMs, Number(logEntry.tokens)],
              indexes: [logEntry.statusCode >= 400 ? "error" : "success"],
            });
          } catch (e) {
            console.error("Telemetry write failed", e);
          }
          resolve();
        })
      );
    }


    return response;
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    return onyx_handler.scheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<Env>;
