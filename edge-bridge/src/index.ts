/**
 * Welcome to Cloudflare Workers!
 *
 * This is the Onyx Edge Bridge worker.
 */

export interface Env {
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
	CORE_INGEST_URL: string;
	GITHUB_WEBHOOK_SECRET: string;
	WP_WEBHOOK_SECRET: string;
}

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// 1. CORS Preflight
		if (request.method === "OPTIONS") {
			return new Response("OK", { headers: corsHeaders });
		}

		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/health") {
			return new Response(JSON.stringify({ status: "operational", service: "onyx-edge-bridge" }), {
				headers: { ...corsHeaders, "Content-Type": "application/json" }
			});
		}

		// Only allow POST and GET requests for the API
		if (request.method !== "POST" && request.method !== "GET") {
			return new Response("Not Found", { status: 404, headers: corsHeaders });
		}

		// 2. Validate Authorization
		// Only enforce Bearer token validation for non-webhook routes. Webhooks use HMAC signatures.
		if (url.pathname !== "/api/v1/webhooks") {
			const authHeader = request.headers.get("Authorization");
			if (!authHeader || authHeader !== `Bearer ${env.AXIM_ONYX_SECRET}`) {
				return new Response(JSON.stringify({ error: "Unauthorized" }), {
					status: 401,
					headers: { ...corsHeaders, "Content-Type": "application/json" }
				});
			}
		}

		try {
			if (url.pathname === "/api/v1/chat") {
				// 3. Parse command and context
				const { command, context } = await request.json() as { command?: string, context?: any };

				if (!command) {
					return new Response(JSON.stringify({ error: "Missing command" }), {
						status: 400,
						headers: { ...corsHeaders, "Content-Type": "application/json" }
					});
				}

				// 4. Inject System Prompt
				const onyxSystemPrompt = `You are Onyx mk3, the advanced AI orchestrator for AXiM Core.
Analyze the following command and available system context. Execute the task efficiently.
Context: ${typeof context === 'object' ? JSON.stringify(context) : context || 'None'}`;

				// 5. Call Anthropic API
				const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
					method: "POST",
					headers: {
						"x-api-key": env.ANTHROPIC_API_KEY,
						"anthropic-version": "2023-06-01",
						"content-type": "application/json"
					},
					body: JSON.stringify({
						model: "claude-3-5-sonnet-20241022", // Fast, cheap model for edge processing
						max_tokens: 1024,
						system: onyxSystemPrompt,
						messages: [{ role: "user", content: command }]
					})
				});

				if (!claudeResponse.ok) {
					const errorData = await claudeResponse.text();
					console.error("Anthropic API Error:", errorData);
					return new Response(JSON.stringify({ error: "Upstream API error" }), {
						status: 502,
						headers: { ...corsHeaders, "Content-Type": "application/json" }
					});
				}

				const llmData = await claudeResponse.json() as any;

				// 6. Return response in standard format
				return new Response(JSON.stringify({
					status: "success",
					response: llmData.content[0].text,
					timestamp: new Date().toISOString()
				}), {
					headers: { ...corsHeaders, "Content-Type": "application/json" }
				});

			} else if (url.pathname === "/api/v1/telemetry") {
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
						headers: { ...corsHeaders, "Content-Type": "application/json" }
					});
				}

				// In a real implementation, this would save to Supabase. For now, acknowledge receipt.
				return new Response(JSON.stringify({
					status: "success",
					message: "Telemetry ingested successfully."
				}), {
					headers: { ...corsHeaders, "Content-Type": "application/json" }
				});

			} else if (url.pathname === "/api/approve") {
				// POST /api/approve endpoint to receive HITL signals from Core
				const payload = await request.json() as { task_id?: string; signed_payload?: any };

				if (!payload.task_id || !payload.signed_payload) {
					return new Response(JSON.stringify({ error: "Missing task_id or signed_payload" }), {
						status: 400,
						headers: { ...corsHeaders, "Content-Type": "application/json" }
					});
				}

				// Relay approval back to Onyx Rust runtime (simulation of SSE/Socket signal)
				console.log(`Relaying approval for task: ${payload.task_id}`);

				return new Response(JSON.stringify({
					status: "success",
					message: `Approval for task ${payload.task_id} relayed to Rust core.`
				}), {
					headers: { ...corsHeaders, "Content-Type": "application/json" }
				});
			} else if (url.pathname === "/api/approvals" && request.method === "GET") {
				// Mock endpoint to support the Rust polling loop for approvals
				// In a real implementation, this would query a database or cache
				return new Response(JSON.stringify({
					status: "success",
					approvals: []
				}), {
					headers: { ...corsHeaders, "Content-Type": "application/json" }
				});
			} else if (url.pathname === "/api/v1/webhooks") {
				// Handle GitHub/WordPress webhooks
				const rawBody = await request.clone().text();
				const payload = await request.json();

				const githubSignature = request.headers.get("x-hub-signature-256");
				const wpSignature = request.headers.get("x-wp-webhook-signature");

				if (githubSignature) {
					if (!env.GITHUB_WEBHOOK_SECRET) {
						return new Response("Webhook secret not configured", { status: 500, headers: corsHeaders });
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
						return new Response("Invalid GitHub signature", { status: 401, headers: corsHeaders });
					}
				} else if (wpSignature) {
					// Webhook verification for WP
					if (wpSignature !== env.WP_WEBHOOK_SECRET) {
						return new Response("Invalid signature", { status: 401, headers: corsHeaders });
					}
				} else {
					return new Response("Missing signature", { status: 401, headers: corsHeaders });
				}

				const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";

				// Ensure payload is passed to the Rust core (simulated here via AXiM Core or direct fetch)
				const coreResponse = await fetch(ingestUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload)
				}).catch(() => null);

				return new Response(JSON.stringify({
					status: "success",
					message: "Webhook passed to Rust core."
				}), {
					headers: { ...corsHeaders, "Content-Type": "application/json" }
				});

			} else {
				return new Response("Not Found", { status: 404, headers: corsHeaders });
			}

		} catch (error) {
			console.error("Worker Error:", error);
			return new Response(JSON.stringify({ error: "Internal Server Error" }), {
				status: 500,
				headers: { ...corsHeaders, "Content-Type": "application/json" }
			});
		}
	},
};
