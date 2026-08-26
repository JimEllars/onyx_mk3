const fs = require('fs');

const path = 'edge-bridge/src/index.ts';
let code = fs.readFileSync(path, 'utf8');

// Insert Zod import
if (!code.includes('import { z }')) {
  code = code.replace(
    /export interface Env \{/,
    `import { z } from "zod";\n\nexport interface Env {`
  );
}

// Add the intake endpoint handler
const intakeEndpoint = `
    } else if (request.method === "POST" && url.pathname === "/api/v1/intake") {
      try {
        const payload = parsedBody || {};
        const schema = z.object({
          customer_name: z.string().min(1, "Name is required").max(100).refine((val) => !/<[^>]*>?/gm.test(val), { message: "Invalid characters in name" }),
          customer_email: z.string().email("Invalid email address"),
        });
        const result = schema.safeParse(payload);
        if (!result.success) {
          return new Response(
            JSON.stringify({ error: "Validation failed", details: result.error.errors }),
            {
              status: 400,
              headers: addOnyxHeaders(
                {
                  ...getCorsHeaders(request, env),
                  "Content-Type": "application/json",
                },
                edgeStatus,
                cacheStatus,
                traceId,
              ),
            },
          );
        }

        // Dispatch to core
        if (!env.CORE_INGEST_URL) {
          return new Response(JSON.stringify({ error: "Configuration error: CORE_INGEST_URL is missing" }), {
            status: 500,
            headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId)
          });
        }

        const bodyStr = JSON.stringify(result.data);
        return await dispatchToCore(
          env.CORE_INGEST_URL,
          {
            method: "POST",
            headers: addOnyxHeaders({ "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId),
            body: bodyStr,
          },
          env,
          ctx,
          bodyStr,
          "Public intake passed to Rust core.",
          request,
          edgeStatus,
          cacheStatus,
          traceId,
        );
      } catch (e: any) {
        return new Response(JSON.stringify({ error: "Bad Request" }), {
          status: 400,
          headers: addOnyxHeaders({ ...getCorsHeaders(request, env), "Content-Type": "application/json" }, edgeStatus, cacheStatus, traceId),
        });
      }
`;

code = code.replace(
  /\} else if \(request\.method === "POST" && url\.pathname === "\/api\/v1\/chat"\)/,
  `${intakeEndpoint}      } else if (request.method === "POST" && url.pathname === "/api/v1/chat")`
);

fs.writeFileSync(path, code);
