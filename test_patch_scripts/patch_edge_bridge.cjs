const fs = require('fs');

const targetFile = 'edge-bridge/src/index.ts';
let content = fs.readFileSync(targetFile, 'utf8');

// 1. Update payload size check
content = content.replace(
  /if \(contentLength > 1024 \* 1024\) \{[^}]+\}[^}]+\}/,
  `if (contentLength > 2048000) {
        return new Response(
          JSON.stringify({ error: "Payload too large. Maximum size is 2MB." }),
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
      }`
);

// 2. Update getCorsHeaders
content = content.replace(
  /function getCorsHeaders\(request: Request, env\?: Env\) \{/,
  `function getCorsHeaders(request: Request, env?: Env) {
  const origin = request.headers.get("Origin") || "";
  let isAllowed = false;

  const ALLOWED_ORIGINS = [
    "http://localhost",
    env?.ALLOWED_ORIGIN,
  ].filter(Boolean);

  if (origin && (origin.startsWith("http://localhost") || origin === env?.ALLOWED_ORIGIN)) {
    isAllowed = true;
  }

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : (env?.ALLOWED_ORIGIN || "http://localhost"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function old_getCorsHeaders(request: Request, env?: Env) {`
);

fs.writeFileSync(targetFile, content);
