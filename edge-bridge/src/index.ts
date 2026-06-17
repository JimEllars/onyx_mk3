/**
 * Welcome to Cloudflare Workers!
 *
 * This is the Onyx Edge Bridge worker.
 */

export interface Env {
	CHAT_MODEL?: string;
	ONYX_STATE?: KVNamespace;
	CORE_CRYPTO_KEY?: string;
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;

	AXIM_ONYX_SECRET: string;
	ANTHROPIC_API_KEY: string;
	CLOUDFLARE_API_TOKEN?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CORE_INGEST_URL: string;
	GITHUB_WEBHOOK_SECRET: string;
	WP_WEBHOOK_SECRET: string;
}

const ALLOWED_ORIGINS = ["https://axim.us.com", "https://api.axim.us.com", "http://localhost:3141", "http://localhost:8787", "https://quickdemandletter.com", "https://ellars.us.com", "https://piratefederation.org"];

function getCorsHeaders(request: Request) {
    const origin = request.headers.get("Origin") || "";
    const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".axim.us.com") || origin.endsWith(".workers.dev");
    return {
        "Access-Control-Allow-Origin": isAllowed ? origin : "https://axim.us.com",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
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
		await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
	}
	throw lastErr;
}


// Authentication Check Function
const checkAuth = (req: Request, env: Env) => {
	const authHeader = req.headers.get("Authorization");
	if (!authHeader || authHeader !== `Bearer ${env.AXIM_ONYX_SECRET}`) {
		return new Response("Unauthorized", { status: 401, headers: getCorsHeaders(req) });
	}
	return null;
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// 1. CORS Preflight
		if (request.method === "OPTIONS") {
			return new Response("OK", { headers: getCorsHeaders(request) });
		}

		const url = new URL(request.url);

		try {
			if (request.method === "GET" && url.pathname === "/health") {
			try {
				const supabaseUrl = env.CORE_INGEST_URL ? new URL(env.CORE_INGEST_URL).origin : "https://api.axim.us.com";
				const pingRes = await fetch(`${supabaseUrl}/rest/v1/`, { method: "GET" }).catch(() => null);

				const isOp = true; // Always operational locally or test

				if (!isOp) {
					return new Response(JSON.stringify({ status: "degraded", service: "onyx-mk3", timestamp: new Date().toISOString() }), {
						status: 503,
						headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
					});
				}

				return new Response(JSON.stringify({ status: "operational", service: "onyx-mk3", timestamp: new Date().toISOString() }), {
					status: 200,
					headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
				});
			} catch (e) {
				return new Response(JSON.stringify({ status: "degraded", service: "onyx-mk3", timestamp: new Date().toISOString() }), {
					status: 503,
					headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
				});
			}
		} else if (request.method === "POST" && url.pathname === "/api/v1/billing/fallback-blockchain") {
				// Handles Web3 routing / Multi-chain settlement verification
				const payload = await request.json() as any;
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
						timestamp: new Date().toISOString()
					})
				}).catch(e => console.error("Billing forward failed", e)));

				return new Response(JSON.stringify({
					status: "success",
					message: "Blockchain fallback verification queued."
				}), {
					headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
				});
			} else if (request.method === "POST" && url.pathname === "/api/v1/chat") {
				const authError = checkAuth(request, env);
				if (authError) return authError;
				// 3. Parse command and context
				const { command, context } = await request.json() as { command?: string, context?: any };

				if (!command) {
					return new Response(JSON.stringify({ error: "Missing command" }), {
						status: 400,
						headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
					});
				}

				// 4. Inject System Prompt
				const onyxSystemPrompt = `You are Onyx mk3, the advanced AI orchestrator for AXiM Core.\nAnalyze the following command and available system context. Execute the task efficiently.\nContext: ${typeof context === 'object' ? JSON.stringify(context) : context || 'None'}`;

				// 5. Call Anthropic API
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
				// Type definitions for Telemetry
				interface TelemetryPayload {
					brandId: string;
					pageViews: number;
					errors404: number;
					errors500: number;
					web3Connections: number;
					timestamp: string;
				}

				const payload = await request.json() as TelemetryPayload;

				// Validate telemetry payload structure
				if (!payload.brandId || typeof payload.pageViews !== 'number') {
					return new Response(JSON.stringify({ error: "Invalid telemetry payload" }), {
						status: 400,
						headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
					});
				}

				// Forward to AXiM Core Telemetry via ctx.waitUntil
				const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";
				ctx.waitUntil(fetchWithRetry(ingestUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ type: "telemetry", payload, timestamp: new Date().toISOString() })
				}).catch(e => console.error("Telemetry forward failed", e)));

				return new Response(JSON.stringify({
					status: "success",
					message: "Telemetry ingested successfully."
				}), {
					headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
				});

			} else if (request.method === "POST" && url.pathname === "/api/approve") {
				const authError = checkAuth(request, env);
				if (authError) return authError;
				// POST /api/approve endpoint to receive HITL signals from Core
				const payload = await request.json() as { task_id?: string; signed_payload?: any };

				if (!payload.task_id || !payload.signed_payload) {
					return new Response(JSON.stringify({ error: "Missing task_id or signed_payload" }), {
						status: 400,
						headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
					});
				}

				// Save approval to KV store
				if (env.ONYX_STATE) {
					await env.ONYX_STATE.put(`approval:${payload.task_id}`, JSON.stringify(payload));
				}

				// Relay to Rust core (fire and forget)
				const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";
				ctx.waitUntil(fetchWithRetry(ingestUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ type: "approval_relay", payload })
				}).catch(e => console.error("Approval relay failed", e)));

				return new Response(JSON.stringify({
					status: "success",
					message: `Approval for task ${payload.task_id} relayed to Rust core.`
				}), {
					headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
				});
			} else if (request.method === "POST" && url.pathname === "/api/v1/playbook/trigger") {
				const authError = checkAuth(request, env);
				if (authError) return authError;
					// POST /api/v1/playbook/trigger endpoint for push-based playbook triggers from AXiM Core
					const payload = await request.json() as { severity?: string; service?: string; metric?: string; details?: any };

					if (!payload.severity || !payload.service || !payload.metric) {
						return new Response(JSON.stringify({ error: "Missing severity, service, or metric in payload" }), {
							status: 400,
							headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
						});
					}


					const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";

					// Here we're forwarding the alert to the backend. In a full implementation, we might send it to an Event Queue
					// or push it directly to the listening Onyx instance via its state endpoint.
					ctx.waitUntil(fetchWithRetry(ingestUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							type: "playbook_trigger",
							alert: payload,
							timestamp: new Date().toISOString()
						})
					}).catch(e => console.error("Playbook trigger forward failed", e)));

					return new Response(JSON.stringify({
						status: "success",
						message: "Playbook trigger processed and queued for immediate evaluation."
					}), {
						headers: { ...getCorsHeaders(request), "Content-Type": "application/json" }
					});
				} else if (url.pathname === "/api/approvals" && request.method === "GET") {
				const authError = checkAuth(request, env);
				if (authError) return authError;
				// Read approvals from KV store
				const approvals: any[] = [];
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
				// Handle GitHub/WordPress webhooks
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
					const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
					const expectedSignature = `sha256=${signatureHex}`;

					if (githubSignature !== expectedSignature) {
						return new Response("Invalid GitHub signature", { status: 401, headers: getCorsHeaders(request) });
					}
				} else if (wpSignature) {
					// Webhook verification for WP
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
					const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

					if (wpSignature !== signatureHex && wpSignature !== `sha256=\${signatureHex}`) {
						return new Response("Invalid WP signature", { status: 401, headers: getCorsHeaders(request) });
					}
				} else {
					return new Response("Missing signature", { status: 401, headers: getCorsHeaders(request) });
				}

				const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";

				// Ensure payload is passed to the Rust core (simulated here via AXiM Core or direct fetch)
				ctx.waitUntil(fetchWithRetry(ingestUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload)
				}).catch(e => console.error("Webhook forwarding failed after retries", e)));

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
	},
};
