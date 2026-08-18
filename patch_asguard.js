const fs = require('fs');

const path = 'edge-bridge/src/index.ts';
let code = fs.readFileSync(path, 'utf8');

// Function for Asguard rate limit logic
const asguardRateLimitCode = `
async function enforceAsguardRateLimit(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!env.ONYX_STATE || !env.ONYX_DB) return null;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const path = url.pathname;

  // Create a 10s window key
  const windowMs = 10000;
  const currentWindow = Math.floor(Date.now() / windowMs);
  const rateLimitKey = \`rate_limit:\${ip}:\${path}:\${currentWindow}\`;

  try {
    const currentCountStr = await env.ONYX_STATE.get(rateLimitKey);
    const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
    const limit = 10; // Allow 10 mutating requests per 10s per IP for these endpoints

    if (currentCount >= limit) {
      // Log to D1 (fire and forget using ctx.waitUntil if we had ctx, but here we'll just return the response
      // The worker's main fetch function has ctx.waitUntil to handle logging if status === 429).
      return new Response(JSON.stringify({ error: "Asguard Rate Limit Exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "10" }
      });
    }

    // Increment count
    await env.ONYX_STATE.put(rateLimitKey, (currentCount + 1).toString(), { expirationTtl: 60 });
    return null;
  } catch (err) {
    console.error("Asguard rate limit error", err);
    return null; // fail open if KV errors
  }
}
`;

// Insert the rate limit function
code = code.replace(
  'async function checkAuth(request: Request, env: Env): Promise<Response | null> {',
  asguardRateLimitCode + '\nasync function checkAuth(request: Request, env: Env): Promise<Response | null> {'
);

// Endpoints: /v1/commands/dispatch, /api/approve, /api/v1/playbook/trigger
// Need to add this to the request processing logic in _fetch
const asguardEnforcementCode = `
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
`;

// Find where URL is parsed in _fetch
const fetchStartIdx = code.indexOf('const url = new URL(request.url);');
if (fetchStartIdx !== -1) {
  const insertIdx = code.indexOf('\n', fetchStartIdx) + 1;
  code = code.slice(0, insertIdx) + asguardEnforcementCode + code.slice(insertIdx);
}

fs.writeFileSync(path, code);
