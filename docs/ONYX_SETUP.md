# Onyx installation and activation

Onyx has two runtime surfaces:

- `rust/` builds the local `onyx` CLI.
- `edge-bridge/` deploys the Cloudflare Worker. Its `wrangler.jsonc` is the only Worker configuration. Do not deploy from the repository root with Wrangler.

## Local CLI

1. Install the stable Rust toolchain with Cargo.
2. Copy `.env.example` to a local `.env` or export its values in your shell.
3. Configure one model provider credential (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, or `DASHSCOPE_API_KEY`), or authenticate with `onyx login`.
4. Build and start Onyx:

   ```bash
   cd rust
   cargo build --workspace
   cargo run -p onyx -- --help
   cargo run -p onyx -- doctor
   ```

When `CHAT_ROUTING_MODE=proxy`, `AXIM_ONYX_SECRET` and `AXIM_SERVICE_KEY` must be configured. `AXIM_CORE_URL` and `VITE_ONYX_WORKER_URL` identify the Core and edge endpoints.

## Cloudflare Worker

Install Node.js 24 or later, then run the reproducible local build from the repository root:

```bash
npm run build
npm run deploy:dry-run
```

Before the first production deployment, authenticate Wrangler and ensure the resources referenced by `edge-bridge/wrangler.jsonc` exist in the target Cloudflare account: four KV namespaces, the `onyx-db` D1 database, the Hyperdrive configuration, Workers AI, Analytics Engine dataset, static assets, cron triggers, and the `onyx-edge.axim.us.com` custom domain.

Set the following Worker runtime secrets in the `edge-bridge` directory. Secrets are not read from `.env` by a deployed Worker:

```bash
npx wrangler secret put AXIM_ONYX_SECRET
npx wrangler secret put AXIM_SERVICE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GITHUB_WEBHOOK_SECRET
npx wrangler secret put WP_WEBHOOK_SECRET
npx wrangler secret put AXIM_INTERNAL_KEY
npx wrangler secret put CRON_SECRET_KEY
```

Add `EMAILIT_API_KEY` and `ONYX_CLIENT_SECRET` only when their corresponding integrations are enabled. Keep `CORE_INGEST_URL` and `ALLOWED_ORIGIN` as non-secret Worker variables in `edge-bridge/wrangler.jsonc`.

For CI deployment, configure repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token must be authorized for the Worker and every configured binding. Then deploy with:

```bash
npm run deploy
```

After deployment, invoke the CLI `doctor` command and the Worker health endpoint used by your environment to confirm credentials, Core connectivity, and bindings are available.
