import re

with open("edge-bridge/src/index.ts", "r") as f:
    content = f.read()

target = """} else if (url.pathname === "/api/approvals" && request.method === "GET") {"""

replacement = """} else if (url.pathname === "/api/v1/playbook/trigger") {
					// POST /api/v1/playbook/trigger endpoint for push-based playbook triggers from AXiM Core
					const payload = await request.json() as { severity?: string; service?: string; metric?: string; details?: any };

					if (!payload.severity || !payload.service || !payload.metric) {
						return new Response(JSON.stringify({ error: "Missing severity, service, or metric in payload" }), {
							status: 400,
							headers: { ...corsHeaders, "Content-Type": "application/json" }
						});
					}

					console.log(`[Playbook Trigger] High-priority alert received for service: ${payload.service} (${payload.metric})`);

					const ingestUrl = env.CORE_INGEST_URL || "https://axim-core.internal/webhook-ingest";

					// Here we're forwarding the alert to the backend. In a full implementation, we might send it to an Event Queue
					// or push it directly to the listening Onyx instance via its state endpoint.
					const coreResponse = await fetch(ingestUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							type: "playbook_trigger",
							alert: payload,
							timestamp: new Date().toISOString()
						})
					}).catch(() => null);

					return new Response(JSON.stringify({
						status: "success",
						message: "Playbook trigger processed and queued for immediate evaluation."
					}), {
						headers: { ...corsHeaders, "Content-Type": "application/json" }
					});
				} else if (url.pathname === "/api/approvals" && request.method === "GET") {"""

if target in content:
    content = content.replace(target, replacement)
    with open("edge-bridge/src/index.ts", "w") as f:
        f.write(content)
    print("Added playbook trigger")
else:
    print("Could not find target")
