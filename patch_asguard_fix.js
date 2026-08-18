const fs = require('fs');
const path = 'edge-bridge/src/index.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace the previous incorrect checkAuth match (since it matched a different checkAuth definition apparently or didn't exist where I thought)
code = code.replace(
  'async function checkAuth(req: Request, env: Env): Promise<Response | null> {',
  `
async function enforceAsguardRateLimit(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!env.ONYX_STATE || !env.ONYX_DB) return null;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const p = url.pathname;

  // Create a 10s window key
  const windowMs = 10000;
  const currentWindow = Math.floor(Date.now() / windowMs);
  const rateLimitKey = \`rate_limit:\${ip}:\${p}:\${currentWindow}\`;

  try {
    const currentCountStr = await env.ONYX_STATE.get(rateLimitKey);
    const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
    const limit = 10; // Allow 10 mutating requests per 10s per IP for these endpoints

    if (currentCount >= limit) {
      return new Response(JSON.stringify({ error: "Asguard Rate Limit Exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "10" }
      });
    }

    await env.ONYX_STATE.put(rateLimitKey, (currentCount + 1).toString(), { expirationTtl: 60 });
    return null;
  } catch (err) {
    console.error("Asguard rate limit error", err);
    return null; // fail open if KV errors
  }
}

async function checkAuth(req: Request, env: Env): Promise<Response | null> {`
);

fs.writeFileSync(path, code);
