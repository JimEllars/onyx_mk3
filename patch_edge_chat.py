import re

with open("edge-bridge/src/index.ts", "r") as f:
    content = f.read()

search_block = """          if (!claudeResponse.ok) {
            if (claudeResponse.status >= 500) {
              throw new Error(`Upstream API error ${claudeResponse.status}`);
            } else {
              const errorData = await claudeResponse.text();"""

replace_block = """          if (!claudeResponse.ok || claudeResponse.headers.get("x-onyx-all-providers-down") === "true") {
            if (claudeResponse.status >= 500 || claudeResponse.headers.get("x-onyx-all-providers-down") === "true") {
              throw new Error(`Upstream API error ${claudeResponse.status} or providers down`);
            } else {
              const errorData = await claudeResponse.text();"""

content = content.replace(search_block, replace_block)

search_block_2 = """        } catch (error) {
          console.error("AXiM Core ingest dropped or timed out:", error);
          if (env.ONYX_STATE) {
            const dlqKey = `dlq:ingest:${Date.now()}:${crypto.randomUUID()}`;
            ctx.waitUntil(env.ONYX_STATE.put(dlqKey, proxyBody));
          }
          return new Response(
            JSON.stringify({
              status: "QUEUED_EDGE_DLQ",
              message: "Payload buffered at edge for Core retry.",
            }),"""

replace_block_2 = """        } catch (error) {
          console.error("AXiM Core ingest dropped, timed out, or providers down:", error);

          if (env.AI) {
            console.warn("Attempting Cloudflare Workers AI edge fallback...");
            try {
              const fallbackResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                messages: [{ role: 'user', content: `System: ${onyxSystemPrompt}\\nUser: ${command}` }]
              }) as { response: string };

              const responseText = fallbackResponse.response;

              // We need to format it like SSE or normal JSON depending on what's expected.
              // The original route handles streaming via TransformStream if successful.
              // Let's just return a JSON response with the fallback text or stream if easy.
              // The prompt says "and stream or return the response back to the client as an emergency fallback"
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

          if (env.ONYX_STATE) {
            const dlqKey = `dlq:ingest:${Date.now()}:${crypto.randomUUID()}`;
            ctx.waitUntil(env.ONYX_STATE.put(dlqKey, proxyBody));
          }
          return new Response(
            JSON.stringify({
              status: "QUEUED_EDGE_DLQ",
              message: "Payload buffered at edge for Core retry.",
            }),"""

content = content.replace(search_block_2, replace_block_2)

with open("edge-bridge/src/index.ts", "w") as f:
    f.write(content)
