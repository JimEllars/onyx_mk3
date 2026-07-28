var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var TIMEOUT_SYMBOL = /* @__PURE__ */ Symbol("TIMEOUT");
async function kvWriteWithTimeout(promise, timeoutMs = 500, status) {
  try {
    const timeout = new Promise(
      (resolve) => setTimeout(() => resolve(TIMEOUT_SYMBOL), timeoutMs)
    );
    const result = await Promise.race([promise, timeout]);
    if (result === TIMEOUT_SYMBOL) {
      console.warn("KV write timed out");
      if (status) status.degraded = true;
      return null;
    }
    return result;
  } catch (e) {
    console.error("KV write error:", e);
    if (status) status.degraded = true;
    return null;
  }
}
__name(kvWriteWithTimeout, "kvWriteWithTimeout");
async function kvReadWithTimeout(promise, timeoutMs = 500, status) {
  try {
    const timeout = new Promise(
      (resolve) => setTimeout(() => resolve(TIMEOUT_SYMBOL), timeoutMs)
    );
    const result = await Promise.race([promise, timeout]);
    if (result === TIMEOUT_SYMBOL) {
      console.warn("KV read timed out");
      status.degraded = true;
      return null;
    }
    return result;
  } catch (e) {
    console.error("KV read error:", e);
    status.degraded = true;
    return null;
  }
}
__name(kvReadWithTimeout, "kvReadWithTimeout");
async function hashPrompt(prompt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(prompt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}
__name(hashPrompt, "hashPrompt");
function equalSecrets(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}
__name(equalSecrets, "equalSecrets");
function getCorsHeaders(request, env) {
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
      "https://piratefederation.org"
    ];
    const TIMEOUT_SYMBOL2 = /* @__PURE__ */ Symbol("TIMEOUT");
    async function kvWriteWithTimeout2(promise, timeoutMs = 500, status) {
      try {
        const timeout = new Promise(
          (resolve) => setTimeout(() => resolve(TIMEOUT_SYMBOL2), timeoutMs)
        );
        const result = await Promise.race([promise, timeout]);
        if (result === TIMEOUT_SYMBOL2) {
          console.warn("KV write timed out");
          if (status) status.degraded = true;
          return null;
        }
        return result;
      } catch (e) {
        console.error("KV write error:", e);
        if (status) status.degraded = true;
        return null;
      }
    }
    __name(kvWriteWithTimeout2, "kvWriteWithTimeout");
    isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".axim.us.com") || origin.endsWith(".workers.dev");
  }
  if (!isAllowed && origin) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    console.warn(`[CORS Failed] Unauthorized Origin: ${origin}, IP: ${ip}`);
  }
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : env && env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : "https://axim.us.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
__name(getCorsHeaders, "getCorsHeaders");
function addOnyxHeaders(headers, status, cacheStatus = "MISS", traceId, rayId) {
  const h = new Headers(headers);
  if (traceId) {
    h.set("X-Onyx-Trace-Id", traceId);
    h.set("X-Request-ID", traceId);
  }
  if (rayId) {
    h.set("X-Onyx-Ray-ID", rayId);
  }
  if (status.startTime) {
    const latency = Date.now() - status.startTime;
    h.set("X-Onyx-Edge-Latency", `${latency}ms`);
  }
  h.set("X-Onyx-Edge-Health", status.degraded ? "DEGRADED" : "OK");
  h.set("X-Onyx-Cache-Status", cacheStatus);
  return h;
}
__name(addOnyxHeaders, "addOnyxHeaders");
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastErr = new Error(`HTTP error ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1e3 * Math.pow(2, i)));
  }
  throw lastErr;
}
__name(fetchWithRetry, "fetchWithRetry");
async function checkAuth(req, env) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", {
      status: 401,
      headers: getCorsHeaders(req)
    });
  }
  const expectedToken = `Bearer ${env.AXIM_ONYX_SECRET}`;
  if (authHeader !== expectedToken) {
    return new Response("Unauthorized", {
      status: 401,
      headers: getCorsHeaders(req)
    });
  }
  return null;
}
__name(checkAuth, "checkAuth");
async function verifyAximSignature(request, env, bodyText) {
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
    ["sign", "verify"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(bodyText)
  );
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const signatureHex = signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  const expectedSignature = `sha256=${signatureHex}`;
  if (signature !== signatureHex && signature !== expectedSignature) {
    return new Response("Invalid HMAC signature", { status: 403 });
  }
  return null;
}
__name(verifyAximSignature, "verifyAximSignature");
async function bootstrapDatabase(env) {
  if (env.ONYX_DB) {
    await env.ONYX_DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS EmailLogs (
        id TEXT PRIMARY KEY,
        to_email TEXT,
        subject TEXT,
        status TEXT, -- 'sent', 'delivered', 'bounced', 'failed'
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS TelemetryLogs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        status TEXT, -- 'healthy', 'degraded', 'critical'
        payload TEXT,
        synced INTEGER DEFAULT 0,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS RateLimitLogs (
        id TEXT PRIMARY KEY,
        ip_address TEXT,
        endpoint TEXT,
        user_id TEXT,
        blocked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS CommandAuditLogs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        command_type TEXT,
        status TEXT,
        execution_time_ms INTEGER,
        details TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS RateLimitLogs (
        id TEXT PRIMARY KEY,
        ip_address TEXT,
        endpoint TEXT,
        user_id TEXT,
        blocked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS UserSessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT,
        client_version TEXT,
        last_seen INTEGER
      );
    `
    ).run();
  }
}
__name(bootstrapDatabase, "bootstrapDatabase");
var onyx_handler = {
  async scheduled(controller, env, ctx) {
    try {
      console.log(`Cron triggered at ${(/* @__PURE__ */ new Date()).toISOString()}`);
      const thirtyDaysAgo = Math.floor(Date.now() / 1e3) - 30 * 24 * 60 * 60;
      if (env.ONYX_DB) {
        ctx.waitUntil(
          env.ONYX_DB.batch([
            env.ONYX_DB.prepare(
              "DELETE FROM TelemetryLogs WHERE created_at < ?"
            ).bind(thirtyDaysAgo),
            env.ONYX_DB.prepare(
              "DELETE FROM CommandAuditLogs WHERE created_at < ?"
            ).bind(thirtyDaysAgo),
            env.ONYX_DB.prepare(
              "DELETE FROM RateLimitLogs WHERE blocked_at < ?"
            ).bind(thirtyDaysAgo)
          ])
        );
      }
      if (env.ONYX_PROMPT_CACHE) {
        await env.ONYX_PROMPT_CACHE.put(
          "heartbeat_sanity",
          (/* @__PURE__ */ new Date()).toISOString(),
          { expirationTtl: 3600 }
        );
      }
      if (env.ONYX_SESSION_STATE) {
        await env.ONYX_SESSION_STATE.put(
          "heartbeat_sanity",
          (/* @__PURE__ */ new Date()).toISOString(),
          { expirationTtl: 3600 }
        );
      }
      const mockedThreadsPayload = {
        source: "threads_api_stub",
        type: "content_engine_daily",
        posts: [
          {
            id: "post_1",
            content: "Exploring the new AXiM Core update!",
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          },
          {
            id: "post_2",
            content: "The future of automation is here.",
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          }
        ]
      };
      const payloadString = JSON.stringify(mockedThreadsPayload);
      const secret = env.GITHUB_WEBHOOK_SECRET || "default_secret";
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(payloadString)
      );
      const signatureArray = Array.from(new Uint8Array(signatureBuffer));
      const signatureHex = signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      const expectedSignature = `sha256=${signatureHex}`;
      const coreUrl = env.CORE_INGEST_URL ? env.CORE_INGEST_URL.replace(
        "/v1/functions/telemetry-ingest",
        "/v1/events/ingress"
      ) : "http://localhost:3000/v1/events/ingress";
      ctx.waitUntil(
        fetch(coreUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-hub-signature-256": expectedSignature,
            "x-onyx-cron-event": "content_engine_daily"
          },
          body: payloadString
        }).then((res) => res.text()).then((t) => console.log("Pulse sync forwarded", t)).catch((e) => console.error("Pulse sync forwarding failed", e))
      );
    } catch (e) {
      console.error("Scheduled task error:", e);
    }
  },
  async fetch(request, env, ctx) {
    const startTime = performance.now();
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: addOnyxHeaders(
            getCorsHeaders(request, env),
            { degraded: false },
            "MISS"
          )
        });
      }
      const response = await this._fetch(request, env, ctx);
      const duration = performance.now() - startTime;
      const traceId = request.headers.get("X-Request-ID") || request.headers.get("cf-ray") || "unknown";
      console.log(
        `[Edge Telemetry] [X-Request-ID: ${traceId}] Path: ${new URL(request.url).pathname} | Method: ${request.method} | Latency: ${duration.toFixed(2)}ms`
      );
      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      const traceId = request.headers.get("X-Request-ID") || request.headers.get("cf-ray") || "unknown";
      console.log(
        `[Edge Telemetry] [X-Request-ID: ${traceId}] Path: ${new URL(request.url).pathname} | Method: ${request.method} | Latency: ${duration.toFixed(2)}ms`
      );
      throw error;
    }
  },
  async _fetch(request, env, ctx) {
    const traceId = request.headers.get("X-Request-ID") || request.headers.get("cf-ray") || crypto.randomUUID();
    const edgeStatus = { degraded: false, startTime: Date.now() };
    const rayId = request.headers.get("cf-ray") || "unknown";
    let cacheStatus = "MISS";
    if (request.method !== "GET" && request.method !== "POST" && request.method !== "PUT" && request.method !== "DELETE" && request.method !== "OPTIONS") {
      console.warn(
        `[Edge Telemetry Warning] Dropped unhandled method: ${request.method}`
      );
      return new Response("Method Not Allowed", {
        status: 405,
        headers: addOnyxHeaders(
          getCorsHeaders(request, env),
          edgeStatus,
          cacheStatus,
          traceId
        )
      });
    }
    if (request.method === "OPTIONS") {
      return new Response("OK", { headers: getCorsHeaders(request, env) });
    }
    if (request.method === "POST" || request.method === "PUT") {
      const contentLength = parseInt(
        request.headers.get("content-length") || "0",
        10
      );
      if (contentLength > 1024 * 1024) {
        return new Response(
          JSON.stringify({ error: "Payload too large. Maximum size is 1MB." }),
          {
            status: 413,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      }
    }
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/functions/v1/telemetry-ingress") {
      ctx.waitUntil(bootstrapDatabase(env));
      try {
        const payload = await request.clone().json();
        const id = Date.now().toString() + "_" + Math.random().toString(36).substring(7);
        const payloadStr = JSON.stringify(payload);
        if (env.ONYX_DB) {
          ctx.waitUntil(
            env.ONYX_DB.prepare(
              "INSERT INTO TelemetryLogs (id, session_id, status, payload, synced, created_at) VALUES (?, ?, ?, ?, 0, ?)"
            ).bind(
              id,
              payload.session_id || "unknown",
              payload.status || "healthy",
              payloadStr,
              Date.now()
            ).run()
          );
        }
        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing"
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
        const ingestUrl = env.CORE_INGEST_URL.replace(/\/$/, "") + "/functions/v1/telemetry-ingress";
        ctx.waitUntil(
          fetchWithRetry(ingestUrl, {
            method: "POST",
            headers: addOnyxHeaders(
              { "Content-Type": "application/json" },
              edgeStatus,
              cacheStatus,
              traceId,
              rayId
            ),
            body: payloadStr
          }).catch((e) => console.error("Telemetry forward failed", e))
        );
        return new Response(
          JSON.stringify({ success: true, message: "Telemetry ingested" }),
          {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            },
            edgeStatus,
            cacheStatus,
            traceId
          )
        });
      }
    } else if (request.method === "POST" && url.pathname === "/api/v1/dlq-drain") {
      const authError = await checkAuth(request, env);
      if (authError) return authError;
      if (!env.ONYX_STATE || !env.CORE_INGEST_URL) {
        return new Response(
          JSON.stringify({ error: "Missing config for DLQ drain" }),
          {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      }
      const listRes = await env.ONYX_STATE.list({ prefix: "dlq:ingest:" });
      let replayed = 0;
      const coreUrl = new URL(env.CORE_INGEST_URL).origin;
      for (const key of listRes.keys) {
        const payload = await env.ONYX_STATE.get(key.name);
        if (payload) {
          try {
            const res = await fetch(`${coreUrl}/v1/llm-proxy`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload
            });
            if (res.ok) {
              await env.ONYX_STATE.delete(key.name);
              replayed++;
            }
          } catch (e) {
            console.error("DLQ drain failed for key", key.name, e);
          }
        }
      }
      return new Response(JSON.stringify({ status: "success", replayed }), {
        headers: addOnyxHeaders(
          {
            ...getCorsHeaders(request, env),
            "Content-Type": "application/json"
          },
          edgeStatus,
          cacheStatus,
          traceId
        )
      });
    } else if (request.method === "POST" && url.pathname === "/api/v1/telemetry/flush") {
      ctx.waitUntil(bootstrapDatabase(env));
      if (!env.CORE_INGEST_URL) {
        return new Response(
          JSON.stringify({
            error: "Configuration error: CORE_INGEST_URL is missing"
          }),
          {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      }
      try {
        if (env.ONYX_DB) {
          const result = await env.ONYX_DB.prepare(
            "SELECT * FROM TelemetryLogs WHERE synced = 0 LIMIT 100"
          ).all();
          const rows = result.results;
          if (rows && rows.length > 0) {
            const ingestUrl = env.CORE_INGEST_URL.replace(/\/$/, "") + "/functions/v1/telemetry-ingress";
            for (const row of rows) {
              await fetchWithRetry(ingestUrl, {
                method: "POST",
                headers: addOnyxHeaders(
                  { "Content-Type": "application/json" },
                  edgeStatus,
                  cacheStatus,
                  traceId,
                  rayId
                ),
                body: String(row.payload)
              });
              await env.ONYX_DB.prepare(
                "UPDATE TelemetryLogs SET synced = 1 WHERE id = ?"
              ).bind(row.id).run();
            }
          }
          return new Response(
            JSON.stringify({ success: true, flushed: rows ? rows.length : 0 }),
            {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
        return new Response(
          JSON.stringify({ success: false, message: "No DB" }),
          {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            },
            edgeStatus,
            cacheStatus,
            traceId
          )
        });
      }
    } else if (request.method === "POST" && url.pathname === "/api/v1/onyx/summon") {
      const authHeader = request.headers.get("Authorization");
      const expectedToken = `Bearer ${env.ONYX_CLIENT_SECRET}`;
      if (!authHeader || authHeader !== expectedToken) {
        const origin = request.headers.get("Origin") || "unknown";
        const ip = request.headers.get("cf-connecting-ip") || "unknown";
        console.warn(
          `[Summon Auth Failed] Unauthorized access attempt from Origin: ${origin}, IP: ${ip}`
        );
        return new Response(JSON.stringify({ error: "Unauthorized Access" }), {
          status: 401,
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            },
            edgeStatus,
            cacheStatus,
            traceId
          )
        });
      }
      if (!env.CORE_INGEST_URL) {
        return new Response(
          JSON.stringify({
            error: "Configuration error: CORE_INGEST_URL is missing"
          }),
          {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
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
            traceId
          ),
          body: JSON.stringify({
            type: "onyx_summon",
            payload,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          })
        }).catch((e) => console.error("Onyx summon forward failed", e))
      );
      return new Response(
        JSON.stringify({
          status: "success",
          message: "Summon payload queued successfully."
        }),
        {
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            },
            edgeStatus,
            cacheStatus,
            traceId
          )
        }
      );
    }
    if (request.method === "GET" && (url.pathname.startsWith("/api/v1/schema") || url.pathname.startsWith("/api/v1/template"))) {
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
            traceId
          )
        });
      }
      const coreUrl = env.CORE_INGEST_URL ? new URL(env.CORE_INGEST_URL).origin : "https://api.axim.us.com";
      try {
        const res = await fetch(`${coreUrl}${url.pathname}`);
        if (res.ok) {
          const responseToCache = new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600"
            }
          });
          ctx.waitUntil(cache.put(cacheUrl, responseToCache.clone()));
          return new Response(responseToCache.body, {
            status: responseToCache.status,
            statusText: responseToCache.statusText,
            headers: addOnyxHeaders(
              responseToCache.headers,
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
      } catch (e) {
      }
    }
    if (url.pathname.startsWith("/api/v1/generate/")) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateLimitKey = `rate_limit:${ip}:${url.pathname}`;
      if (env.ONYX_STATE) {
        const currentHitsStr = await kvReadWithTimeout(
          env.ONYX_STATE.get(rateLimitKey),
          500,
          edgeStatus
        );
        const currentHits = parseInt(currentHitsStr || "0", 10);
        if (currentHits >= 10) {
          if (env.ONYX_DB) {
            ctx.waitUntil(
              env.ONYX_DB.prepare(
                "INSERT INTO RateLimitLogs (id, ip_address, endpoint, user_id, blocked_at) VALUES (?, ?, ?, ?, ?)"
              ).bind(
                crypto.randomUUID(),
                ip,
                url.pathname,
                "anonymous",
                Math.floor(Date.now() / 1e3)
              ).run()
            );
          }
          return new Response(JSON.stringify({ error: "Too Many Requests" }), {
            status: 429,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
                "Retry-After": "60"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
        ctx.waitUntil(
          kvWriteWithTimeout(
            env.ONYX_STATE.put(rateLimitKey, (currentHits + 1).toString(), {
              expirationTtl: 60
            }),
            500,
            edgeStatus
          )
        );
      }
    }
    try {
      let parsedBody = null;
      let rawBodyText = null;
      if (request.method === "POST" && url.pathname === "/api/v1/generate/nda") {
        const idempotencyKey = request.headers.get("Idempotency-Key");
        if (idempotencyKey && env.ONYX_DISPATCH_LOCKS) {
          const existingLock = await kvReadWithTimeout(
            env.ONYX_DISPATCH_LOCKS.get(`lock:${idempotencyKey}`),
            500,
            edgeStatus
          );
          if (existingLock) {
            console.info(
              JSON.stringify({
                event: "ONYX_DISPATCH_LOCK_CONFLICT",
                key_hash: idempotencyKey,
                path: url.pathname
              })
            );
            return new Response(
              JSON.stringify({
                status: "processing",
                message: "Request already being processed."
              }),
              {
                status: 202,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json"
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId
                )
              }
            );
          }
          await kvWriteWithTimeout(
            env.ONYX_DISPATCH_LOCKS.put(`lock:${idempotencyKey}`, "locked", {
              expirationTtl: 180
            }),
            500,
            edgeStatus
          );
        }
      }
      if (request.method === "POST" || request.method === "PUT" || request.method === "DELETE") {
        rawBodyText = await request.clone().text();
        if (url.pathname !== "/api/v1/webhooks") {
          const sigError = await verifyAximSignature(request, env, rawBodyText);
          if (sigError) {
            return sigError;
          }
        }
        if (rawBodyText) {
          try {
            parsedBody = JSON.parse(rawBodyText);
            if (url.pathname.startsWith("/api/v1/action-hook") || url.pathname.includes("mutation") || url.pathname.includes("transaction")) {
              if (env.ONYX_STATE) {
                const hookSignature = request.headers.get("x-action-signature") || "unverified";
                const telemetryPayload = JSON.stringify({
                  path: url.pathname,
                  signature: hookSignature,
                  timestamp: (/* @__PURE__ */ new Date()).toISOString()
                });
                ctx.waitUntil(
                  kvWriteWithTimeout(
                    env.ONYX_STATE.put(
                      `action_hook:${Date.now()}_${Math.random().toString(36).substring(7)}`,
                      telemetryPayload,
                      { expirationTtl: 86400 }
                    ),
                    500,
                    edgeStatus
                  )
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
                    "Content-Type": "application/json"
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId
                )
              }
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
              "Content-Type": "application/json"
            },
            edgeStatus,
            cacheStatus,
            traceId
          )
        });
      }
      if (request.method === "GET" && url.pathname === "/health") {
        try {
          const supabaseUrl = env.CORE_INGEST_URL ? new URL(env.CORE_INGEST_URL).origin : "https://api.axim.us.com";
          const pingRes = await fetch(`${supabaseUrl}/rest/v1/`, {
            method: "GET"
          }).catch(() => null);
          const isOp = true;
          if (!isOp) {
            return new Response(
              JSON.stringify({
                status: "degraded",
                service: "onyx-mk3",
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              }),
              {
                status: 503,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json"
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId
                )
              }
            );
          }
          return new Response(
            JSON.stringify({
              status: "operational",
              service: "onyx-mk3",
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }),
            {
              status: 200,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        } catch (e) {
          return new Response(
            JSON.stringify({
              status: "degraded",
              service: "onyx-mk3",
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }),
            {
              status: 503,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
      } else if (request.method === "GET" && url.pathname === "/api/v1/rate-limit/metrics") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        if (!env.ONYX_DB) {
          return new Response(JSON.stringify({ error: "Database not configured" }), {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
        try {
          const { results } = await env.ONYX_DB.prepare(
            "SELECT endpoint, COUNT(*) as breach_count FROM RateLimitLogs GROUP BY endpoint"
          ).all();
          return new Response(JSON.stringify({ status: "success", metrics: results || [] }), {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        } catch (e) {
          console.error("Error fetching rate-limit metrics", e);
          return new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
      } else if (request.method === "POST" && url.pathname === "/api/v1/billing/fallback-blockchain") {
        const payload = parsedBody || {};
        if (!payload.tx_hash || !payload.wallet_address) {
          return new Response(
            JSON.stringify({ error: "Invalid blockchain settlement details" }),
            {
              status: 400,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
        const idempotencyKey = request.headers.get("Idempotency-Key") || payload.idempotency_key;
        if (idempotencyKey && env.ONYX_STATE) {
          const cachedResponse = await kvReadWithTimeout(
            env.ONYX_STATE.get(`idem:${idempotencyKey}`),
            500,
            edgeStatus
          );
          if (cachedResponse) {
            cacheStatus = "HIT";
            return new Response(cachedResponse, {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            });
          }
        }
        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing"
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
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
              traceId
            ),
            body: JSON.stringify({
              type: "blockchain_fallback",
              tx_hash: payload.tx_hash,
              wallet_address: payload.wallet_address,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            })
          }).catch((e) => console.error("Billing forward failed", e))
        );
        const responseBody = JSON.stringify({
          status: "success",
          message: "Blockchain fallback verification queued."
        });
        if (idempotencyKey && env.ONYX_STATE) {
          ctx.waitUntil(
            kvWriteWithTimeout(
              env.ONYX_STATE.put(`idem:${idempotencyKey}`, responseBody, {
                expirationTtl: 86400
              }),
              500,
              edgeStatus
            )
          );
        }
        return new Response(responseBody, {
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            },
            edgeStatus,
            cacheStatus,
            traceId
          )
        });
      } else if (request.method === "POST" && url.pathname === "/api/v1/session/heartbeat") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        try {
          const body = await request.clone().json();
          if (!body.session_id) {
            return new Response(
              JSON.stringify({ error: "Missing session_id" }),
              {
                status: 400,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json"
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId
                )
              }
            );
          }
          if (env.ONYX_DB) {
            const now = Math.floor(Date.now() / 1e3);
            await env.ONYX_DB.prepare(
              `INSERT INTO UserSessions (session_id, user_id, client_version, last_seen)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(session_id) DO UPDATE SET
                 user_id=excluded.user_id,
                 client_version=excluded.client_version,
                 last_seen=excluded.last_seen`
            ).bind(
              body.session_id,
              body.user_id || null,
              body.client_version || null,
              now
            ).run();
          }
          return new Response(
            JSON.stringify({ status: "success", session_id: body.session_id }),
            {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        } catch (e) {
          console.error("Error processing heartbeat", e);
          return new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
      } else if (request.method === "POST" && url.pathname === "/api/v1/email/send") {
        ctx.waitUntil(bootstrapDatabase(env));
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        if (!env.EMAILIT_API_KEY) {
          return new Response(
            JSON.stringify({ error: "EMAILIT_API_KEY is not configured" }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
        try {
          const { to, subject, html_body } = await request.clone().json();
          const emailitRes = await fetch("https://api.emailit.com/v1/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.EMAILIT_API_KEY}`,
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
            throw new Error(
              `EmailIt API failed with status ${emailitRes.status}: ${errText}`
            );
          }
          const email_id = crypto.randomUUID();
          if (env.ONYX_DB) {
            ctx.waitUntil(
              env.ONYX_DB.prepare(
                "INSERT INTO EmailLogs (id, to_email, subject, status, updated_at) VALUES (?, ?, ?, 'sent', ?)"
              ).bind(email_id, to, subject, Date.now()).run()
            );
          }
          return new Response(JSON.stringify({ success: true, email_id }), {
            status: 200,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e.message || "Failed to dispatch email" }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
      } else if (request.method === "POST" && url.pathname === "/api/v1/email/webhook") {
        try {
          ctx.waitUntil(bootstrapDatabase(env));
          const payload = await request.json();
          if (!payload.email_id || !payload.event_type) {
            return new Response(
              JSON.stringify({ error: "Missing email_id or event_type" }),
              {
                status: 400,
                headers: {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                }
              }
            );
          }
          if (env.ONYX_DB) {
            await env.ONYX_DB.prepare(
              "UPDATE EmailLogs SET status = ?, updated_at = ? WHERE id = ?"
            ).bind(payload.event_type, Date.now(), payload.email_id).run();
          }
          return new Response(JSON.stringify({ success: true }), {
            headers: {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            }
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            }
          });
        }
      } else if (request.method === "GET" && url.pathname.startsWith("/api/v1/email/status/")) {
        try {
          ctx.waitUntil(bootstrapDatabase(env));
          const authError = await checkAuth(request, env);
          if (authError) return authError;
          const email_id = url.pathname.split("/").pop();
          if (!email_id) {
            return new Response(JSON.stringify({ error: "Missing email_id" }), {
              status: 400,
              headers: {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              }
            });
          }
          let status = "unknown";
          if (env.ONYX_DB) {
            const row = await env.ONYX_DB.prepare(
              "SELECT status FROM EmailLogs WHERE id = ?"
            ).bind(email_id).first();
            if (row) {
              status = row.status;
            }
          }
          return new Response(JSON.stringify({ success: true, status }), {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
      } else if (request.method === "POST" && url.pathname === "/api/v1/chat") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        const { command, context } = await request.json();
        if (!command) {
          return new Response(JSON.stringify({ error: "Missing command" }), {
            status: 400,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
        const onyxSystemPrompt = `You are Onyx mk3, the advanced AI orchestrator for AXiM Core.
Analyze the following command and available system context. Execute the task efficiently.
Context: ${typeof context === "object" ? JSON.stringify(context) : context || "None"}`;
        const chatModel = env.CHAT_MODEL || "claude-3-5-sonnet-20241022";
        const fullPrompt = `System: ${onyxSystemPrompt}
User: ${command}`;
        const promptHash = await hashPrompt(fullPrompt);
        if (env.ONYX_PROMPT_CACHE) {
          const cachedResult = await kvReadWithTimeout(
            env.ONYX_PROMPT_CACHE.get(promptHash),
            500,
            edgeStatus
          );
          if (cachedResult) {
            cacheStatus = "HIT";
            return new Response(cachedResult, {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "text/event-stream"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            });
          }
        }
        const coreUrl = env.CORE_INGEST_URL ? new URL(env.CORE_INGEST_URL).origin : "https://api.axim.us.com";
        const optimizationHint = command.length > 200 || context && JSON.stringify(context).length > 1e3 ? "complex-reasoning" : "cost-efficient";
        const proxyBody = JSON.stringify({
          model: chatModel,
          max_tokens: 1024,
          system: onyxSystemPrompt,
          messages: [{ role: "user", content: command }],
          stream: true,
          optimization_hint: optimizationHint
        });
        const encoder = new TextEncoder();
        let signatureHex = "";
        if (env.AXIM_INTERNAL_KEY) {
          const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(env.AXIM_INTERNAL_KEY),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
          );
          const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(proxyBody)
          );
          const signatureArray = Array.from(new Uint8Array(signatureBuffer));
          signatureHex = signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        }
        let claudeResponse = null;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5e3);
          claudeResponse = await fetch(`${coreUrl}/v1/llm-proxy`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-axim-signature": `sha256=${signatureHex}`
            },
            body: proxyBody,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!claudeResponse.ok) {
            if (claudeResponse.status >= 500) {
              throw new Error(`Upstream API error ${claudeResponse.status}`);
            } else {
              const errorData = await claudeResponse.text();
              console.error("Anthropic API Error:", errorData);
              return new Response(
                JSON.stringify({ error: "Upstream API error" }),
                {
                  status: 502,
                  headers: addOnyxHeaders(
                    {
                      ...getCorsHeaders(request, env),
                      "Content-Type": "application/json"
                    },
                    edgeStatus,
                    cacheStatus,
                    traceId
                  )
                }
              );
            }
          }
        } catch (error) {
          console.error("AXiM Core ingest dropped or timed out:", error);
          if (env.ONYX_STATE) {
            const dlqKey = `dlq:ingest:${Date.now()}:${crypto.randomUUID()}`;
            ctx.waitUntil(env.ONYX_STATE.put(dlqKey, proxyBody));
          }
          return new Response(
            JSON.stringify({
              status: "QUEUED_EDGE_DLQ",
              message: "Payload buffered at edge for Core retry."
            }),
            {
              status: 202,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
        const { readable, writable } = new TransformStream();
        if (env.ONYX_PROMPT_CACHE) {
          const reader = claudeResponse.body.getReader();
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
                env.ONYX_PROMPT_CACHE.put(promptHash, fullResponseText, {
                  expirationTtl: 86400,
                  metadata: { timestamp: Date.now() }
                }),
                500,
                edgeStatus
              );
            })().catch((e) => {
              console.error("Stream cache saving failed:", e);
              writer.close().catch(() => {
              });
            })
          );
          return new Response(readable, {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "text/event-stream"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
        return new Response(claudeResponse.body, {
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "text/event-stream"
            },
            edgeStatus,
            cacheStatus,
            traceId
          )
        });
      } else if (request.method === "POST" && url.pathname === "/api/v1/telemetry") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        const payload = parsedBody;
        if (!payload.brandId || typeof payload.pageViews !== "number") {
          return new Response(
            JSON.stringify({ error: "Invalid telemetry payload" }),
            {
              status: 400,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing"
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
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
              traceId
            ),
            body: JSON.stringify({
              type: "telemetry",
              payload,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            })
          }).catch((e) => console.error("Telemetry forward failed", e))
        );
        return new Response(
          JSON.stringify({
            status: "success",
            message: "Telemetry ingested successfully."
          }),
          {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      } else if (request.method === "POST" && url.pathname === "/api/approve") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        const payload = parsedBody || {};
        if (!payload.task_id || !payload.signed_payload) {
          return new Response(
            JSON.stringify({ error: "Missing task_id or signed_payload" }),
            {
              status: 400,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
        const idempotencyKey = request.headers.get("Idempotency-Key") || payload.idempotency_key;
        if (idempotencyKey && env.ONYX_STATE) {
          const cachedResponse = await kvReadWithTimeout(
            env.ONYX_STATE.get(`idem:${idempotencyKey}`),
            500,
            edgeStatus
          );
          if (cachedResponse) {
            cacheStatus = "HIT";
            return new Response(cachedResponse, {
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            });
          }
        }
        if (env.ONYX_STATE) {
          try {
            await kvWriteWithTimeout(
              env.ONYX_STATE.put(
                `approval:${payload.task_id}`,
                JSON.stringify(payload)
              ),
              500,
              edgeStatus
            );
          } catch (e) {
            console.error("KV put error for approval:", e);
          }
        }
        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing"
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
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
              traceId
            ),
            body: JSON.stringify({ type: "approval_relay", payload })
          }).catch((e) => console.error("Approval relay failed", e))
        );
        const responseBody = JSON.stringify({
          status: "success",
          message: `Approval for task ${payload.task_id} relayed to Rust core.`
        });
        if (idempotencyKey && env.ONYX_STATE) {
          ctx.waitUntil(
            kvWriteWithTimeout(
              env.ONYX_STATE.put(`idem:${idempotencyKey}`, responseBody, {
                expirationTtl: 86400
              }),
              500,
              edgeStatus
            )
          );
        }
        return new Response(responseBody, {
          headers: addOnyxHeaders(
            {
              ...getCorsHeaders(request, env),
              "Content-Type": "application/json"
            },
            edgeStatus,
            cacheStatus,
            traceId
          )
        });
      } else if (request.method === "POST" && url.pathname === "/api/v1/playbook/trigger") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        const payload = parsedBody || {};
        if (!payload.severity || !payload.service || !payload.metric) {
          return new Response(
            JSON.stringify({
              error: "Missing severity, service, or metric in payload"
            }),
            {
              status: 400,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
          );
        }
        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing"
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
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
              traceId
            ),
            body: JSON.stringify({
              type: "playbook_trigger",
              alert: payload,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            })
          }).catch((e) => console.error("Playbook trigger forward failed", e))
        );
        return new Response(
          JSON.stringify({
            status: "success",
            message: "Playbook trigger processed and queued for immediate evaluation."
          }),
          {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      } else if (request.method === "POST" && url.pathname === "/api/v1/commands/log") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        try {
          const payload = parsedBody || {};
          const {
            id,
            user_id,
            command_type,
            status,
            execution_time_ms,
            details,
            created_at
          } = payload;
          if (!id || !user_id || !command_type || !status) {
            return new Response(
              JSON.stringify({ error: "Missing required fields" }),
              {
                status: 400,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json"
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId
                )
              }
            );
          }
          if (env.ONYX_DB) {
            const stmt = env.ONYX_DB.prepare(
              `INSERT INTO CommandAuditLogs (id, user_id, command_type, status, execution_time_ms, details, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              id,
              user_id,
              command_type,
              status,
              execution_time_ms || 0,
              details || "",
              created_at || Date.now()
            );
            ctx.waitUntil(
              stmt.run().catch(
                (e) => console.error("Failed to insert CommandAuditLog:", e)
              )
            );
          } else {
            console.warn("ONYX_DB is not configured");
          }
          return new Response(JSON.stringify({ status: "success" }), {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        } catch (e) {
          console.error("Error logging command", e);
          return new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
      } else if (request.method === "GET" && url.pathname.startsWith("/api/v1/commands/history/")) {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        const userId = url.pathname.split("/").pop();
        if (!userId) {
          return new Response(JSON.stringify({ error: "Missing user_id" }), {
            status: 400,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
        try {
          let logs = [];
          const TIMEOUT_SYMBOL2 = /* @__PURE__ */ Symbol("TIMEOUT");
          async function kvWriteWithTimeout2(promise, timeoutMs = 500, status) {
            try {
              const timeout = new Promise(
                (resolve) => setTimeout(() => resolve(TIMEOUT_SYMBOL2), timeoutMs)
              );
              const result = await Promise.race([promise, timeout]);
              if (result === TIMEOUT_SYMBOL2) {
                console.warn("KV write timed out");
                if (status) status.degraded = true;
                return null;
              }
              return result;
            } catch (e) {
              console.error("KV write error:", e);
              if (status) status.degraded = true;
              return null;
            }
          }
          __name(kvWriteWithTimeout2, "kvWriteWithTimeout");
          if (env.ONYX_DB) {
            const result = await env.ONYX_DB.prepare(
              `SELECT * FROM CommandAuditLogs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
            ).bind(userId).all();
            logs = result.results || [];
            const TIMEOUT_SYMBOL3 = /* @__PURE__ */ Symbol("TIMEOUT");
            async function kvWriteWithTimeout3(promise, timeoutMs = 500, status) {
              try {
                const timeout = new Promise(
                  (resolve) => setTimeout(() => resolve(TIMEOUT_SYMBOL3), timeoutMs)
                );
                const result2 = await Promise.race([promise, timeout]);
                if (result2 === TIMEOUT_SYMBOL3) {
                  console.warn("KV write timed out");
                  if (status) status.degraded = true;
                  return null;
                }
                return result2;
              } catch (e) {
                console.error("KV write error:", e);
                if (status) status.degraded = true;
                return null;
              }
            }
            __name(kvWriteWithTimeout3, "kvWriteWithTimeout");
          }
          return new Response(JSON.stringify({ status: "success", logs }), {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        } catch (e) {
          console.error("Error fetching command history", e);
          return new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
      } else if (url.pathname === "/api/approvals" && request.method === "GET") {
        const authError = await checkAuth(request, env);
        if (authError) return authError;
        const approvals = [];
        const TIMEOUT_SYMBOL2 = /* @__PURE__ */ Symbol("TIMEOUT");
        async function kvWriteWithTimeout2(promise, timeoutMs = 500, status) {
          try {
            const timeout = new Promise(
              (resolve) => setTimeout(() => resolve(TIMEOUT_SYMBOL2), timeoutMs)
            );
            const result = await Promise.race([promise, timeout]);
            if (result === TIMEOUT_SYMBOL2) {
              console.warn("KV write timed out");
              if (status) status.degraded = true;
              return null;
            }
            return result;
          } catch (e) {
            console.error("KV write error:", e);
            if (status) status.degraded = true;
            return null;
          }
        }
        __name(kvWriteWithTimeout2, "kvWriteWithTimeout");
        if (env.ONYX_STATE) {
          const listed = await kvReadWithTimeout(
            env.ONYX_STATE.list({ prefix: "approval:" }),
            500,
            edgeStatus
          );
          if (!listed)
            return new Response(
              JSON.stringify({ status: "success", approvals: [] }),
              {
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "application/json"
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId
                )
              }
            );
          for (const key of listed.keys) {
            const value = await kvReadWithTimeout(
              env.ONYX_STATE.get(key.name),
              500,
              edgeStatus
            );
            if (value) approvals.push(JSON.parse(value));
          }
        }
        return new Response(
          JSON.stringify({
            status: "success",
            approvals
          }),
          {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      } else if (request.method === "POST" && url.pathname === "/api/v1/webhooks") {
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
                traceId
              )
            });
          }
          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(env.GITHUB_WEBHOOK_SECRET),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"]
          );
          const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(rawBody)
          );
          const signatureArray = Array.from(new Uint8Array(signatureBuffer));
          const signatureHex = signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
          const expectedSignature = `sha256=${signatureHex}`;
          if (githubSignature !== expectedSignature) {
            return new Response("Invalid GitHub signature", {
              status: 401,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId
              )
            });
          }
        } else if (wpSignature) {
          if (!env.WP_WEBHOOK_SECRET) {
            return new Response("Webhook secret not configured", {
              status: 500,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId
              )
            });
          }
          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(env.WP_WEBHOOK_SECRET),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"]
          );
          const signatureBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(rawBody)
          );
          const signatureArray = Array.from(new Uint8Array(signatureBuffer));
          const signatureHex = signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");
          if (wpSignature !== signatureHex && wpSignature !== `sha256=${signatureHex}`) {
            return new Response("Invalid WP signature", {
              status: 401,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId
              )
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
                traceId
              )
            });
          }
          if (!equalSecrets(wpSecretParam, env.WP_WEBHOOK_SECRET)) {
            return new Response("Invalid WP secret", {
              status: 401,
              headers: addOnyxHeaders(
                getCorsHeaders(request, env),
                edgeStatus,
                cacheStatus,
                traceId
              )
            });
          }
        } else {
          return new Response("Missing signature", {
            status: 401,
            headers: addOnyxHeaders(
              getCorsHeaders(request, env),
              edgeStatus,
              cacheStatus,
              traceId
            )
          });
        }
        if (!env.CORE_INGEST_URL) {
          return new Response(
            JSON.stringify({
              error: "Configuration error: CORE_INGEST_URL is missing"
            }),
            {
              status: 500,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json"
                },
                edgeStatus,
                cacheStatus,
                traceId
              )
            }
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
              traceId
            ),
            body: JSON.stringify(payload)
          }).catch(
            (e) => console.error("Webhook forwarding failed after retries", e)
          )
        );
        return new Response(
          JSON.stringify({
            status: "success",
            message: "Webhook passed to Rust core."
          }),
          {
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json"
              },
              edgeStatus,
              cacheStatus,
              traceId
            )
          }
        );
      } else {
        return new Response("Not Found", {
          status: 404,
          headers: addOnyxHeaders(
            getCorsHeaders(request, env),
            edgeStatus,
            cacheStatus,
            traceId
          )
        });
      }
    } catch (error) {
      console.error("Worker Error:", error);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: addOnyxHeaders(
          {
            ...getCorsHeaders(request, env),
            "Content-Type": "application/json"
          },
          edgeStatus,
          cacheStatus,
          traceId
        )
      });
    }
  }
};
var index_default = {
  async fetch(request, env, ctx) {
    const response = await onyx_handler._fetch(request, env, ctx);
    if (response.status === 429) {
      if (env.ONYX_DB) {
        const ip = request.headers.get("cf-connecting-ip") || "unknown";
        const url = new URL(request.url);
        ctx.waitUntil(
          env.ONYX_DB.prepare(
            "INSERT INTO RateLimitLogs (id, ip_address, endpoint, user_id, blocked_at) VALUES (?, ?, ?, ?, ?)"
          ).bind(
            crypto.randomUUID(),
            ip,
            url.pathname,
            "anonymous",
            Math.floor(Date.now() / 1e3)
          ).run().catch((e) => console.error("Failed to log rate limit breach", e))
        );
      }
    }
    return response;
  },
  async scheduled(controller, env, ctx) {
    return onyx_handler.scheduled(controller, env, ctx);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
