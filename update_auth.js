const fs = require('fs');
let content = fs.readFileSync('edge-bridge/src/index.ts', 'utf8');

// Insert CORS preflight handling in fetch method
const preflightCode = `
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: addOnyxHeaders(getCorsHeaders(request, env), { degraded: false }, "MISS")
			});
		}
`;

content = content.replace(
    /const response = await this\._fetch\(request, env, ctx\);/,
    preflightCode + '\n\t\t\t\tconst response = await this._fetch(request, env, ctx);'
);

// Add the auth handshake specifically for /api/v1/onyx/summon
const authCode = `
			if (request.method === "POST" && url.pathname === "/api/v1/onyx/summon") {
				const authHeader = request.headers.get("Authorization");
				const expectedToken = env.ONYX_CLIENT_SECRET;

				if (!expectedToken || authHeader !== \`Bearer \${expectedToken}\`) {
					console.warn(\`[Unauthorized Access Attempt] Origin: \${request.headers.get("Origin") || "Unknown"}, IP: \${request.headers.get("cf-connecting-ip") || "Unknown"}\`);
					return new Response(JSON.stringify({ error: "Unauthorized Access" }), {
						status: 401,
						headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
					});
				}

				// The request is authenticated. Proceed with handling the summon payload.
                // For now, we will just proxy it or return success based on what's needed.
                // Assuming it works exactly like the Rust backend expects it, or we forward it to CORE_INGEST_URL.
                if (!env.CORE_INGEST_URL) {
					return new Response(JSON.stringify({ error: "Configuration error: CORE_INGEST_URL is missing" }), {
						status: 500,
						headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
					});
				}

                // Forward to Rust core via AXiM Core proxy
                const ingestUrl = new URL("/api/v1/onyx/summon", env.CORE_INGEST_URL).toString();
				const proxiedResponse = await fetchWithRetry(ingestUrl, {
					method: "POST",
					headers: {
                        ...addOnyxHeaders({ "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId),
                        "Authorization": \`Bearer \${env.AXIM_ONYX_SECRET}\`
                    },
					body: JSON.stringify(parsedBody || {})
				}).catch(e => {
                    console.error("Summon relay failed", e);
                    return null;
                });

                if (!proxiedResponse) {
                    return new Response(JSON.stringify({ error: "Failed to reach backend core" }), {
						status: 502,
						headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
					});
                }

                // Return SSE stream back to client
                request.signal.addEventListener("abort", () => {
                    proxiedResponse.body?.cancel();
                });

                return new Response(proxiedResponse.body, {
                    headers: addOnyxHeaders({
                        ...getCorsHeaders(request, env),
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive"
                    }, edgeStatus, cacheStatus, traceId)
                });
			} else `;

content = content.replace(
    /if \(request\.method === "POST" && url\.pathname === "\/api\/v1\/commands\/dispatch"\) \{/,
    authCode + `if (request.method === "POST" && url.pathname === "/api/v1/commands/dispatch") {`
);

fs.writeFileSync('edge-bridge/src/index.ts', content);
