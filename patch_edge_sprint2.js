const fs = require('fs');
let content = fs.readFileSync('edge-bridge/src/index.ts', 'utf8');

// We need to modify getCorsHeaders to use env.ALLOWED_ORIGIN
content = content.replace(
    /function getCorsHeaders\(request: Request\) \{[\s\S]*?\n\}/,
`function getCorsHeaders(request: Request, env?: Env) {
    const origin = request.headers.get("Origin") || "";
    let isAllowed = false;

    if (env && env.ALLOWED_ORIGIN) {
        if (origin === env.ALLOWED_ORIGIN) {
            isAllowed = true;
        }
    } else {
        const ALLOWED_ORIGINS = ["https://axim.us.com", "https://api.axim.us.com", "http://localhost:3141", "http://localhost:8787", "https://quickdemandletter.com", "https://ellars.us.com", "https://piratefederation.org"];
        isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".axim.us.com") || origin.endsWith(".workers.dev");
    }

    return {
        "Access-Control-Allow-Origin": isAllowed ? origin : (env && env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : "https://axim.us.com"),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Expose-Headers": "X-Onyx-Edge-Health, X-Onyx-Cache-Status",
    };
}`
);

// Add Env variable to type Env
content = content.replace(
    /export interface Env \{/,
    `export interface Env {\n\tALLOWED_ORIGIN?: string;\n\tONYX_CLIENT_SECRET?: string;`
);

// We need to replace all getCorsHeaders(request) with getCorsHeaders(request, env)
content = content.replace(/getCorsHeaders\(request\)/g, 'getCorsHeaders(request, env)');

fs.writeFileSync('edge-bridge/src/index.ts', content);
