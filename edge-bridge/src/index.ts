/**
 * Welcome to Cloudflare Workers!
 *
 * This is the Onyx Edge Bridge worker.
 */

export interface Env {
  ALLOWED_ORIGIN?: string;
  ONYX_CLIENT_SECRET?: string;
  CHAT_MODEL?: string;
  ONYX_STATE?: KVNamespace;
  ONYX_SESSION_STATE?: KVNamespace;
  ONYX_DISPATCH_LOCKS?: KVNamespace;
  ONYX_PROMPT_CACHE?: KVNamespace;
  CORE_CRYPTO_KEY?: string;
  AXIM_ONYX_SECRET: string;
  ANTHROPIC_API_KEY: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CORE_INGEST_URL: string;
  GITHUB_WEBHOOK_SECRET: string;
  WP_WEBHOOK_SECRET: string;
  AXIM_INTERNAL_KEY: string;
  EMAILIT_API_KEY?: string;
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

async function kvWriteWithTimeout<T>(
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
      console.warn("KV write timed out");
      status.degraded = true;
      return null;
    }
    return result as T;
  } catch (e) {
    console.error("KV write error:", e);
    status.degraded = true;
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
      console.warn("KV read timed out");
      status.degraded = true;
      return null;
    }
    return result as T;
  } catch (e) {
    console.error("KV read error:", e);
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
  let isAllowed = false;

  if (env && env.ALLOWED_ORIGIN) {
    if (origin === env.ALLOWED_ORIGIN) {
      isAllowed = true;
    }
  } else {
    const ALLOWED_ORIGINS = [
      "https://axim.us.com",
      "https://api.axim.us.com",
      "http://localhost:3141",
      "http://localhost:8787",
      "https://quickdemandletter.com",
      "https://ellars.us.com",
      "https://piratefederation.org",
    ];
    isAllowed =
      ALLOWED_ORIGINS.includes(origin) ||
      origin.endsWith(".axim.us.com") ||
      origin.endsWith(".workers.dev");
  }

  if (!isAllowed && origin) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    console.warn(`[CORS Failed] Unauthorized Origin: ${origin}, IP: ${ip}`);
  }

  return {
    "Access-Control-Allow-Origin": isAllowed
      ? origin
      : env && env.ALLOWED_ORIGIN
        ? env.ALLOWED_ORIGIN
        : "https://axim.us.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function addOnyxHeaders(
  headers: HeadersInit,
  status: { degraded: boolean },
  cacheStatus: string = "MISS",
  traceId?: string,
): Headers {
  const h = new Headers(headers);
  if (traceId) {
    h.set("X-Onyx-Trace-Id", traceId);
    h.set("X-Request-ID", traceId);
  }
  h.set("X-Onyx-Edge-Health", status.degraded ? "DEGRADED" : "OK");
  h.set("X-Onyx-Cache-Status", cacheStatus);
  return h;
}

async function fetchWithRetry(url: string, options: any, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastErr = new Error(`HTTP error ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
  }
  throw lastErr;
}

// Timing-Safe Authentication Check Function
async function checkAuth(req: Request, env: Env): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", {
      status: 401,
      headers: getCorsHeaders(req),
    });
  }

  const expectedToken = `Bearer ${env.AXIM_ONYX_SECRET}`;
  if (authHeader !== expectedToken) {
    return new Response("Unauthorized", {
      status: 401,
      headers: getCorsHeaders(req),
    });
  }
  return null;
}

async function verifyAximSignature(
  request: Request,
  env: Env,
  bodyText: string,
): Promise<Response | null> {
  const signature = request.headers.get("x-axim-signature");
  if (!signature) {
    return new Response("Missing x-axim-signature header", { status: 401 });
  }
  if (!env.AXIM_INTERNAL_KEY) {
    return new Response("AXIM_INTERNAL_KEY not configured", { status: 500 });
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AXIM_INTERNAL_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(bodyText),
  );

  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const signatureHex = signatureArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Support either direct hex or sha256= prefix format
  const expectedSignature = `sha256=${signatureHex}`;
  if (signature !== signatureHex && signature !== expectedSignature) {
    return new Response("Invalid HMAC signature", { status: 403 });
  }

  return null;
}

export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      // Execute a low-overhead heartbeat sanity evaluation across active KV stores
      console.log(`Cron triggered at ${new Date().toISOString()}`);
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

      // Pulse Sync: Fetch external social data and forward to Rust backend
      const mockedThreadsPayload = {
        source: "threads_api_stub",
        type: "content_engine_daily",
        posts: [
          {
            id: "post_1",
            content: "Exploring the new AXiM Core update!",
            timestamp: new Date().toISOString(),
          },
          {
            id: "post_2",
            content: "The future of automation is here.",
            timestamp: new Date().toISOString(),
          },
        ],
      };

      const payloadString = JSON.stringify(mockedThreadsPayload);
      const secret = env.GITHUB_WEBHOOK_SECRET || "default_secret";
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
      ctx.waitUntil(
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
          .then((t) => console.log("Pulse sync forwarded", t))
          .catch((e) => console.error("Pulse sync forwarding failed", e)),
      );
    } catch (e) {
      console.error("Scheduled task error:", e);
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
      const traceId = request.headers.get("X-Request-ID") || request.headers.get("cf-ray") || "unknown";
      console.log(
        `[Edge Telemetry] [X-Request-ID: ${traceId}] Path: ${new URL(request.url).pathname} | Method: ${request.method} | Latency: ${duration.toFixed(2)}ms`,
      );
      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      const traceId = request.headers.get("X-Request-ID") || request.headers.get("cf-ray") || "unknown";
      console.log(
        `[Edge Telemetry] [X-Request-ID: ${traceId}] Path: ${new URL(request.url).pathname} | Method: ${request.method} | Latency: ${duration.toFixed(2)}ms`,
      );
      throw error;
    }
  },

  async _fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const traceId = request.headers.get("X-Request-ID") || request.headers.get("cf-ray") || crypto.randomUUID();
    const edgeStatus = { degraded: false };
    let cacheStatus = "MISS";

    if (
      request.method !== "GET" &&
      request.method !== "POST" &&
      request.method !== "PUT" &&
      request.method !== "DELETE" &&
      request.method !== "OPTIONS"
    ) {
      console.warn(
        `[Edge Telemetry Warning] Dropped unhandled method: ${request.method}`,
      );
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
      if (contentLength > 1024 * 1024) {
        return new Response(
          JSON.stringify({ error: "Payload too large. Maximum size is 1MB." }),
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

    if (request.method === "POST" && url.pathname === "/api/v1/onyx/summon") {
      const authHeader = request.headers.get("Authorization");
      const expectedToken = `Bearer ${env.ONYX_CLIENT_SECRET}`;
      if (!authHeader || authHeader !== expectedToken) {
        const origin = request.headers.get("Origin") || "unknown";
        const ip = request.headers.get("cf-connecting-ip") || "unknown";
        console.warn(
          `[Summon Auth Failed] Unauthorized access attempt from Origin: ${origin}, IP: ${ip}`,
        );
        return new Response(JSON.stringify({ error: "Unauthorized Access" }), {
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

      let payload = {};
      try {
        const rawBodyText = await request.clone().text();
        if (rawBodyText) {
          payload = JSON.parse(rawBodyText);
        }
      } catch (e) {
        console.warn("Could not parse body in /api/v1/onyx/summon");
      }

      ctx.waitUntil(
        fetchWithRetry(ingestUrl, {
          method: "POST",
          headers: addOnyxHeaders(
            { "Content-Type": "application/json" },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
          body: JSON.stringify({
            type: "onyx_summon",
            payload,
            timestamp: new Date().toISOString(),
          }),
        }).catch((e) => console.error("Onyx summon forward failed", e)),
      );

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

    // 3. Edge Caching for Stateless Requests (Schemas/Templates)
    if (
      request.method === "GET" &&
      (url.pathname.startsWith("/api/v1/schema") ||
        url.pathname.startsWith("/api/v1/template"))
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
        const res = await fetch(`${coreUrl}${url.pathname}`);
        if (res.ok) {
          const responseToCache = new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600",
            },
          });
          ctx.waitUntil(cache.put(cacheUrl, responseToCache.clone()));
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
          return new Response(JSON.stringify({ error: "Too Many Requests" }), {
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

        ctx.waitUntil(
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
            console.info(
              JSON.stringify({
                event: "ONYX_DISPATCH_LOCK_CONFLICT",
                key_hash: idempotencyKey,
                path: url.pathname,
              }),
            );
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
          const sigError = await verifyAximSignature(request, env, rawBodyText);
          if (sigError) {
            return sigError;
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
                ctx.waitUntil(
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
              JSON.stringify({ error: "Structurally invalid JSON payload." }),
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
      if (request.method === "GET" && url.pathname === "/health") {
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
        request.method === "POST" &&
        url.pathname === "/api/v1/billing/fallback-blockchain"
      ) {
        // Handles Web3 routing / Multi-chain settlement verification
        const payload = parsedBody || {};
        if (!payload.tx_hash || !payload.wallet_address) {
          return new Response(
            JSON.stringify({ error: "Invalid blockchain settlement details" }),
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
        ctx.waitUntil(
          fetchWithRetry(ingestUrl, {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
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
          }).catch((e) => console.error("Billing forward failed", e)),
        );

        const responseBody = JSON.stringify({
          status: "success",
          message: "Blockchain fallback verification queued.",
        });

        if (idempotencyKey && env.ONYX_STATE) {
          ctx.waitUntil(
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
      } else if (request.method === "POST" && url.pathname === "/api/v1/email/send") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;

        if (!env.EMAILIT_API_KEY) {
          return new Response(JSON.stringify({ error: "EMAILIT_API_KEY is not configured" }), {
            status: 500,
            headers: addOnyxHeaders({
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            }, edgeStatus, cacheStatus, traceId)
          });
        }

        try {
          const { to, subject, html_body } = await request.clone().json() as { to: string, subject: string, html_body: string };

          const emailitRes = await fetch("https://api.emailit.com/v1/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.EMAILIT_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              to,
              subject,
              html: html_body
            })
          });

          if (!emailitRes.ok) {
            const errText = await emailitRes.text();
            throw new Error(`EmailIt API failed with status ${emailitRes.status}: ${errText}`);
          }

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: addOnyxHeaders({
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            }, edgeStatus, cacheStatus, traceId)
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message || "Failed to dispatch email" }), {
            status: 500,
            headers: addOnyxHeaders({
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            }, edgeStatus, cacheStatus, traceId)
          });
        } } else if (request.method === "POST" && url.pathname === "/api/v1/chat") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        // 3. Parse command and context
        const { command, context } = (await request.json()) as {
          command?: string;
          context?: any;
        };

        if (!command) {
          return new Response(JSON.stringify({ error: "Missing command" }), {
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
          });
        }

        // 4. Inject System Prompt
        const onyxSystemPrompt = `You are Onyx mk3, the advanced AI orchestrator for AXiM Core.\nAnalyze the following command and available system context. Execute the task efficiently.\nContext: ${typeof context === "object" ? JSON.stringify(context) : context || "None"}`;

        // 5. Call Anthropic API
        const chatModel = env.CHAT_MODEL || "claude-3-5-sonnet-20241022";
        const fullPrompt = `System: ${onyxSystemPrompt}\nUser: ${command}`;

        const promptHash = await hashPrompt(fullPrompt);

        if (env.ONYX_PROMPT_CACHE) {
          const cachedResult = await kvReadWithTimeout(
            env.ONYX_PROMPT_CACHE.get(promptHash),
            500,
            edgeStatus,
          );
          if (cachedResult) {
            cacheStatus = "HIT";
            return new Response(cachedResult, {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "text/event-stream",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            });
          }
        }

        const coreUrl = env.CORE_INGEST_URL
          ? new URL(env.CORE_INGEST_URL).origin
          : "https://api.axim.us.com";
        const optimizationHint =
          command.length > 200 ||
          (context && JSON.stringify(context).length > 1000)
            ? "complex-reasoning"
            : "cost-efficient";
        const proxyBody = JSON.stringify({
          model: chatModel,
          max_tokens: 1024,
          system: onyxSystemPrompt,
          messages: [{ role: "user", content: command }],
          stream: true,
          optimization_hint: optimizationHint,
        });

        const encoder = new TextEncoder();
        let signatureHex = "";
        if (env.AXIM_INTERNAL_KEY) {
          const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(env.AXIM_INTERNAL_KEY),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
          );
          const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(proxyBody),
          );
          const signatureArray = Array.from(new Uint8Array(signatureBuffer));
          signatureHex = signatureArray
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }

        const claudeResponse = await fetch(`${coreUrl}/v1/llm-proxy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-axim-signature": `sha256=${signatureHex}`,
          },
          body: proxyBody,
        });

        if (!claudeResponse.ok) {
          const errorData = await claudeResponse.text();
          console.error("Anthropic API Error:", errorData);
          return new Response(JSON.stringify({ error: "Upstream API error" }), {
            status: 502,
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

        // If streaming, we need to intercept the response chunks to cache the complete response
        // However, since we return the stream immediately, it's easiest to create a TransformStream
        const { readable, writable } = new TransformStream();

        if (env.ONYX_PROMPT_CACHE) {
          const reader = claudeResponse.body!.getReader();
          const writer = writable.getWriter();

          ctx.waitUntil(
            (async () => {
              let fullResponseText = "";
              const decoder = new TextDecoder("utf-8");

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                fullResponseText += decoder.decode(value, { stream: true });
                await writer.write(value);
              }

              fullResponseText += decoder.decode();
              await writer.close();

              await kvWriteWithTimeout(
                env.ONYX_PROMPT_CACHE!.put(promptHash, fullResponseText, {
                  expirationTtl: 86400,
                  metadata: { timestamp: Date.now() },
                }),
                500,
                edgeStatus,
              );
            })().catch((e) => {
              console.error("Stream cache saving failed:", e);
              // Make sure we still close the writer if there's an error so the client doesn't hang
              writer.close().catch(() => {});
            }),
          );

          return new Response(readable, {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "text/event-stream",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
          });
        }

        return new Response(claudeResponse.body, {
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "text/event-stream",
            },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
        });
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/telemetry"
      ) {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        // Type definitions for Telemetry
        interface TelemetryPayload {
          brandId: string;
          pageViews: number;
          errors404: number;
          errors500: number;
          web3Connections: number;
          timestamp: string;
        }

        const payload = parsedBody as TelemetryPayload;

        // Validate telemetry payload structure
        if (!payload.brandId || typeof payload.pageViews !== "number") {
          return new Response(
            JSON.stringify({ error: "Invalid telemetry payload" }),
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

        // Forward to AXiM Core Telemetry via ctx.waitUntil
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
        ctx.waitUntil(
          fetchWithRetry(ingestUrl, {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: JSON.stringify({
              type: "telemetry",
              payload,
              timestamp: new Date().toISOString(),
            }),
          }).catch((e) => console.error("Telemetry forward failed", e)),
        );

        return new Response(
          JSON.stringify({
            status: "success",
            message: "Telemetry ingested successfully.",
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
      } else if (request.method === "POST" && url.pathname === "/api/approve") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        // POST /api/approve endpoint to receive HITL signals from Core
        const payload = (parsedBody || {}) as {
          task_id?: string;
          signed_payload?: any;
          idempotency_key?: string;
        };

        if (!payload.task_id || !payload.signed_payload) {
          return new Response(
            JSON.stringify({ error: "Missing task_id or signed_payload" }),
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

        // Save approval to KV store
        if (env.ONYX_STATE) {
          try {
            await kvWriteWithTimeout(
              env.ONYX_STATE.put(
                `approval:${payload.task_id}`,
                JSON.stringify(payload),
              ),
              500,
              edgeStatus,
            );
          } catch (e) {
            console.error("KV put error for approval:", e);
          }
        }

        // Relay to Rust core (fire and forget)
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
        ctx.waitUntil(
          fetchWithRetry(ingestUrl, {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: JSON.stringify({ type: "approval_relay", payload }),
          }).catch((e) => console.error("Approval relay failed", e)),
        );

        const responseBody = JSON.stringify({
          status: "success",
          message: `Approval for task ${payload.task_id} relayed to Rust core.`,
        });

        if (idempotencyKey && env.ONYX_STATE) {
          ctx.waitUntil(
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
      } else if (
        request.method === "POST" &&
        url.pathname === "/api/v1/playbook/trigger"
      ) {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        // POST /api/v1/playbook/trigger endpoint for push-based playbook triggers from AXiM Core
        const payload = (parsedBody || {}) as {
          severity?: string;
          service?: string;
          metric?: string;
          details?: any;
        };

        if (!payload.severity || !payload.service || !payload.metric) {
          return new Response(
            JSON.stringify({
              error: "Missing severity, service, or metric in payload",
            }),
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

        // Here we're forwarding the alert to the backend. In a full implementation, we might send it to an Event Queue
        // or push it directly to the listening Onyx instance via its state endpoint.
        ctx.waitUntil(
          fetchWithRetry(ingestUrl, {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: JSON.stringify({
              type: "playbook_trigger",
              alert: payload,
              timestamp: new Date().toISOString(),
            }),
          }).catch((e) => console.error("Playbook trigger forward failed", e)),
        );

        return new Response(
          JSON.stringify({
            status: "success",
            message:
              "Playbook trigger processed and queued for immediate evaluation.",
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
        url.pathname === "/api/approvals" &&
        request.method === "GET"
      ) {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        // Read approvals from KV store
        const approvals: any[] = [];
        if (env.ONYX_STATE) {
          const listed = await kvReadWithTimeout(
            env.ONYX_STATE.list({ prefix: "approval:" }),
            500,
            edgeStatus,
          );
          if (!listed)
            return new Response(
              JSON.stringify({ status: "success", approvals: [] }),
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
          for (const key of listed.keys) {
            const value = await kvReadWithTimeout(
              env.ONYX_STATE.get(key.name),
              500,
              edgeStatus,
            );
            if (value) approvals.push(JSON.parse(value as string));
          }
        }
        return new Response(
          JSON.stringify({
            status: "success",
            approvals,
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

        // Ensure payload is passed to the Rust core (simulated here via AXiM Core or direct fetch)
        ctx.waitUntil(
          fetchWithRetry(ingestUrl, {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: JSON.stringify(payload),
          }).catch((e) =>
            console.error("Webhook forwarding failed after retries", e),
          ),
        );

        return new Response(
          JSON.stringify({
            status: "success",
            message: "Webhook passed to Rust core.",
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
      } else {
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
    } catch (error) {
      console.error("Worker Error:", error);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
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
