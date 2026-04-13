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

		// Only allow POST requests for the API
		if (request.method !== "POST" || new URL(request.url).pathname !== "/api/v1/chat") {
			return new Response("Not Found", { status: 404, headers: corsHeaders });
		}

		// 2. Validate Authorization
		const authHeader = request.headers.get("Authorization");
		if (!authHeader || authHeader !== `Bearer ${env.AXIM_ONYX_SECRET}`) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { ...corsHeaders, "Content-Type": "application/json" }
			});
		}

		try {
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

		} catch (error) {
			console.error("Worker Error:", error);
			return new Response(JSON.stringify({ error: "Internal Server Error" }), {
				status: 500,
				headers: { ...corsHeaders, "Content-Type": "application/json" }
			});
		}
	},
};
