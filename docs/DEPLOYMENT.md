# DEPLOYMENT
## Edge Bridge
- Serverless Cloudflare Worker located in `edge-bridge/`
- Written in TypeScript
- Requires Wrangler for local deployment
- **CRITICAL:** Do not write credentials to `.env` or `wrangler.toml`

## Rust Workspace
- Renamed from `rusty-claude-cli` to `onyx`
- Default model alias `axim-default` resolves to `claude-3-5-sonnet-20241022`
