const fs = require('fs');

let content = fs.readFileSync('edge-bridge/src/index.ts', 'utf8');

// I will just read the file and use string replacement

const searchStr = `
			if (request.method === "POST" && url.pathname === "/api/v1/commands/dispatch") {
`;

const replaceStr = `
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

				if (!env.CORE_INGEST_URL) {
					return new Response(JSON.stringify({ error: "Configuration error: CORE_INGEST_URL is missing" }), {
						status: 500,
						headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
					});
				}

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
			} else if (request.method === "POST" && url.pathname === "/api/v1/commands/dispatch") {
`;

content = content.replace(searchStr, replaceStr);
fs.writeFileSync('edge-bridge/src/index.ts', content);
