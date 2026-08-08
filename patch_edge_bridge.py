import re

with open("edge-bridge/src/index.ts", "r") as f:
    content = f.read()

# We need to add env.AI logic for the fallback in /api/v1/chat and /api/v1/onyx/summon
# Let's find where dispatchToCore is used for chat/summon

import sys

# Find the definition of dispatchToCore and modify it or add a fallback where dispatchToCore is called.
# Since the prompt says "update the proxy handler for chat/summon requests", we will look for url.pathname === "/api/v1/chat" || url.pathname === "/api/v1/onyx/summon"
# and catch 503 from dispatchToCore or the Rust API.

with open("edge-bridge/src/index.ts", "r") as f:
    lines = f.readlines()

new_lines = []
in_chat = False
for i, line in enumerate(lines):
    new_lines.append(line)
    if 'url.pathname === "/api/v1/chat"' in line or 'url.pathname === "/api/v1/onyx/summon"' in line:
        pass

    if 'return await dispatchToCore(' in line and 'body: JSON.stringify(payload),' in lines[i-1]:
        # This is the dispatch call inside chat/summon
        pass

# Let's do a more robust string replacement

search_block = """        return await dispatchToCore(
          targetUrl,
          {
            method: "POST",
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: JSON.stringify(payload),
          },
          env,
          ctx,
          JSON.stringify(payload),
          "Chat payload forwarded.",
          request,
          edgeStatus,
          cacheStatus,
          traceId,
        );"""

replace_block = """        const response = await dispatchToCore(
          targetUrl,
          {
            method: "POST",
            headers: addOnyxHeaders(
              {
                ...getCorsHeaders(request, env),
                "Content-Type": "application/json",
              },
              edgeStatus,
              cacheStatus,
              traceId,
            ),
            body: JSON.stringify(payload),
          },
          env,
          ctx,
          JSON.stringify(payload),
          "Chat payload forwarded.",
          request,
          edgeStatus,
          cacheStatus,
          traceId,
        );

        if (response.status === 503 || response.headers.get("x-onyx-all-providers-down") === "true") {
          console.warn("All LLM providers down or 503. Using Workers AI fallback.");
          if (env.AI) {
            try {
               const fallbackResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                 messages: [{ role: 'user', content: payload.message || payload.prompt || 'Hello' }]
               });

               let responseText = fallbackResponse.response;
               return new Response(JSON.stringify({ status: "success", data: { parts: [{ type: "text", text: responseText }] } }), {
                 status: 200,
                 headers: addOnyxHeaders(
                    {
                      ...getCorsHeaders(request, env),
                      "Content-Type": "application/json",
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

        return response;"""

if search_block in content:
    content = content.replace(search_block, replace_block)
else:
    print("Search block not found. Trying flexible replacement.")
    # Maybe formatting is different?
    pass

with open("edge-bridge/src/index.ts", "w") as f:
    f.write(content)
