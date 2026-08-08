import re

with open("edge-bridge/src/index.ts", "r") as f:
    content = f.read()

search_block = """      ctx.waitUntil(
        fetchWithRetry(ingestUrl, {
          method: "POST",
          headers: addOnyxHeaders(
            { "Content-Type": "application/json" },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
          body: JSON.stringify({
            type: "onyx_summon",
            payload,
            timestamp: new Date().toISOString(),
          }),
        }).catch((e) => console.error("Onyx summon forward failed", e)),
      );

      return new Response(
        JSON.stringify({
          status: "success",
          message: "Summon payload queued successfully.",
        }),"""

replace_block = """      try {
        const summonRes = await fetchWithRetry(ingestUrl, {
          method: "POST",
          headers: addOnyxHeaders(
            { "Content-Type": "application/json" },
            edgeStatus,
            cacheStatus,
            traceId,
          ),
          body: JSON.stringify({
            type: "onyx_summon",
            payload,
            timestamp: new Date().toISOString(),
          }),
        }, 3);

        if (!summonRes.ok || summonRes.headers.get("x-onyx-all-providers-down") === "true") {
           throw new Error("Providers down or 503");
        }
      } catch (e) {
        console.error("Onyx summon forward failed, attempting Workers AI fallback", e);
        if (env.AI) {
            try {
              const fallbackResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                messages: [{ role: 'user', content: payload.message || 'Hello' }]
              }) as { response: string };

              const responseText = fallbackResponse.response;

              const ssePayload = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: responseText } })}\\n\\ndata: [DONE]\\n\\n`;
              return new Response(ssePayload, {
                status: 200,
                headers: addOnyxHeaders(
                  {
                    ...getCorsHeaders(request, env),
                    "Content-Type": "text/event-stream",
                    "X-Onyx-Fallback": "workers-ai"
                  },
                  edgeStatus,
                  cacheStatus,
                  traceId,
                )
              });
            } catch (aiError) {
              console.error("Workers AI fallback failed:", aiError);
            }
        }
      }

      return new Response(
        JSON.stringify({
          status: "success",
          message: "Summon payload queued successfully.",
        }),"""

content = content.replace(search_block, replace_block)

with open("edge-bridge/src/index.ts", "w") as f:
    f.write(content)
