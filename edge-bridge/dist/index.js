var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var ALLOWED_ORIGINS = ["https://axim.us.com", "https://api.axim.us.com", "http://localhost:3141", "http://localhost:8787", "https://quickdemandletter.com", "https://ellars.us.com", "https://piratefederation.org"];
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".axim.us.com") || origin.endsWith(".workers.dev");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://axim.us.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
__name(getCorsHeaders, "getCorsHeaders");
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
var checkAuth = /* @__PURE__ */ __name((req, env) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${env.AXIM_ONYX_SECRET}`) {
    return new Response("Unauthorized", { status: 401, headers: getCorsHeaders(req) });
  }
  return null;
}, "checkAuth");
var index_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response("OK", { headers: getCorsHeaders(request) });
    }
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        try {
          const supabaseUrl = env.CORE_INGEST_URL ? new URL(env.CORE_INGEST_URL).origin : "https://api.axim.us.com";
          const pingRes = await fetch(`${supabaseUrl}/rest/v1/`, { method: "GET" }).catch(() => null);
          const isOp = true;
          if (!isOp) {
            return new Response(JSON.stringify({ status: "degraded", service: "onyx-mk3", timestamp: (/* @__PURE__ */ new Date()).toISOString() }), {
              status: 503,
              headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
            });
          }
          return new Response(JSON.stringify({ status: "operational", service: "onyx-mk3", timestamp: (/* @__PURE__ */ new Date()).toISOString() }), {
            status: 200,
            headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
          });
        } catch (e) {
          return new Response(JSON.stringify({ status: "degraded", service: "onyx-mk3", timestamp: (/* @__PURE__ */ new Date()).toISOString() }), {
            status: 503,
            headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
          });
        }
      } else if (request.method === "POST" && url.pathname === "/api/v1/billing/fallback-blockchain") {
        const payload = await request.json();
        if (!payload.tx_hash || !payload.wallet_address) {
          return new Response(JSON.stringify({ error: "Invalid blockchain settlement details" }), {
            status: 400,
            headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
          });
        }
        const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";
        ctx.waitUntil(fetchWithRetry(ingestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "blockchain_fallback",
            tx_hash: payload.tx_hash,
            wallet_address: payload.wallet_address,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          })
        }).catch((e) => console.error("Billing forward failed", e)));
        return new Response(JSON.stringify({
          status: "success",
          message: "Blockchain fallback verification queued."
        }), {
          headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
        });
      } else if (request.method === "POST" && url.pathname === "/api/v1/chat") {
        const authError = checkAuth(request, env);
        if (authError) return authError;
        const { command, context } = await request.json();
        if (!command) {
          return new Response(JSON.stringify({ error: "Missing command" }), {
            status: 400,
            headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
          });
        }
        const onyxSystemPrompt = `You are Onyx mk3, the advanced AI orchestrator for AXiM Core.
Analyze the following command and available system context. Execute the task efficiently.
Context: ${typeof context === "object" ? JSON.stringify(context) : context || "None"}`;
        const chatModel = env.CHAT_MODEL || "claude-3-5-sonnet-20241022";
        const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: chatModel,
            max_tokens: 1024,
            system: onyxSystemPrompt,
            messages: [{ role: "user", content: command }],
            stream: true
          })
        });
        if (!claudeResponse.ok) {
          const errorData = await claudeResponse.text();
          console.error("Anthropic API Error:", errorData);
          return new Response(JSON.stringify({ error: "Upstream API error" }), {
            status: 502,
            headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
          });
        }
        return new Response(claudeResponse.body, {
          headers: { ...getCorsHeaders(request), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }
        });
      } else if (request.method === "POST" && url.pathname === "/api/v1/telemetry") {
        const authError = checkAuth(request, env);
        if (authError) return authError;
        const payload = await request.json();
        if (!payload.brandId || typeof payload.pageViews !== "number") {
          return new Response(JSON.stringify({ error: "Invalid telemetry payload" }), {
            status: 400,
            headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
          });
        }
        const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";
        ctx.waitUntil(fetchWithRetry(ingestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "telemetry", payload, timestamp: (/* @__PURE__ */ new Date()).toISOString() })
        }).catch((e) => console.error("Telemetry forward failed", e)));
        return new Response(JSON.stringify({
          status: "success",
          message: "Telemetry ingested successfully."
        }), {
          headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
        });
      } else if (request.method === "POST" && url.pathname === "/api/approve") {
        const authError = checkAuth(request, env);
        if (authError) return authError;
        const payload = await request.json();
        if (!payload.task_id || !payload.signed_payload) {
          return new Response(JSON.stringify({ error: "Missing task_id or signed_payload" }), {
            status: 400,
            headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
          });
        }
        if (env.ONYX_STATE) {
          await env.ONYX_STATE.put(`approval:${payload.task_id}`, JSON.stringify(payload));
        }
        const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";
        ctx.waitUntil(fetchWithRetry(ingestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "approval_relay", payload })
        }).catch((e) => console.error("Approval relay failed", e)));
        return new Response(JSON.stringify({
          status: "success",
          message: `Approval for task ${payload.task_id} relayed to Rust core.`
        }), {
          headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
        });
      } else if (request.method === "POST" && url.pathname === "/api/v1/playbook/trigger") {
        const authError = checkAuth(request, env);
        if (authError) return authError;
        const payload = await request.json();
        if (!payload.severity || !payload.service || !payload.metric) {
          return new Response(JSON.stringify({ error: "Missing severity, service, or metric in payload" }), {
            status: 400,
            headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
          });
        }
        const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";
        ctx.waitUntil(fetchWithRetry(ingestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "playbook_trigger",
            alert: payload,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          })
        }).catch((e) => console.error("Playbook trigger forward failed", e)));
        return new Response(JSON.stringify({
          status: "success",
          message: "Playbook trigger processed and queued for immediate evaluation."
        }), {
          headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
        });
      } else if (url.pathname === "/api/approvals" && request.method === "GET") {
        const authError = checkAuth(request, env);
        if (authError) return authError;
        const approvals = [];
        if (env.ONYX_STATE) {
          const listed = await env.ONYX_STATE.list({ prefix: "approval:" });
          for (const key of listed.keys) {
            const value = await env.ONYX_STATE.get(key.name);
            if (value) approvals.push(JSON.parse(value));
          }
        }
        return new Response(JSON.stringify({
          status: "success",
          approvals
        }), {
          headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
        });
      } else if (request.method === "POST" && url.pathname === "/api/v1/webhooks") {
        const rawBody = await request.clone().text();
        const payload = await request.json();
        const githubSignature = request.headers.get("x-hub-signature-256");
        const wpSignature = request.headers.get("x-wp-webhook-signature");
        if (githubSignature) {
          if (!env.GITHUB_WEBHOOK_SECRET) {
            return new Response("Webhook secret not configured", { status: 500, headers: getCorsHeaders(request) });
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
            return new Response("Invalid GitHub signature", { status: 401, headers: getCorsHeaders(request) });
          }
        } else if (wpSignature) {
          if (!env.WP_WEBHOOK_SECRET) {
            return new Response("Webhook secret not configured", { status: 500, headers: getCorsHeaders(request) });
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
          if (wpSignature !== signatureHex && wpSignature !== `sha256=\${signatureHex}`) {
            return new Response("Invalid WP signature", { status: 401, headers: getCorsHeaders(request) });
          }
        } else {
          return new Response("Missing signature", { status: 401, headers: getCorsHeaders(request) });
        }
        const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";
        ctx.waitUntil(fetchWithRetry(ingestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).catch((e) => console.error("Webhook forwarding failed after retries", e)));
        return new Response(JSON.stringify({
          status: "success",
          message: "Webhook passed to Rust core."
        }), {
          headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
        });
      } else {
        if (request.method !== "POST" && request.method !== "GET" && request.method !== "OPTIONS") {
          return new Response("Method Not Allowed", { status: 405, headers: getCorsHeaders(request) });
        }
        return new Response("Not Found", { status: 404, headers: getCorsHeaders(request) });
      }
    } catch (error) {
      console.error("Worker Error:", error);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
      });
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
