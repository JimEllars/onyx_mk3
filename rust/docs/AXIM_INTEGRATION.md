# AXiM Core Integration Architecture

## Overview

Onyx Mk3 integrates with AXiM Core as an intelligent edge worker, receiving commands via WebSocket duplex stream and executing tasks across the AXiM ecosystem.

## Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                       AXiM Core                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   UI Stream │  │ Gateway API  │  │ Vault Service│       │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘       │
└─────────┼─────────────────┼──────────────────┼──────────────┘
          │                 │                  │
          │ WebSocket       │ HTTPS            │ HTTPS
          │ (signed msgs)   │ (Bearer token)   │ (temporal creds)
          │                 │                  │
┌─────────▼─────────────────▼──────────────────▼──────────────┐
│                      Onyx Mk3 Worker                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Duplex Stream Handler (main.rs)                     │   │
│  │  - Receive signed commands                            │   │
│  │  - Verify HMAC-SHA256 signature                       │   │
│  │  - Route to execution engine                          │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                      │
│  ┌────────────────────▼─────────────────────────────────┐   │
│  │  Execution Engine (runtime)                          │   │
│  │  - Fetch credentials from vault                       │   │
│  │  - Invoke gateway for micro-app actions               │   │
│  │  - Spawn sub-agents via swarm orchestrator            │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                      │
│  ┌────────────────────▼─────────────────────────────────┐   │
│  │  AXiM Integration Layer (tools/axim_*)               │   │
│  │  - axim_vault: Credential management                  │   │
│  │  - axim_gateway: Universal micro-app dispatcher       │   │
│  │  - axim_stream: Bidirectional event streaming         │   │
│  │  - swarm_ops: Sub-agent lifecycle management          │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Duplex Stream Protocol

### Connection Establishment

1. Worker connects to: `wss://api.axim.us.com/v1/onyx/duplex`
2. Sends authentication header: `Authorization: Bearer <AXIM_ONYX_SECRET>`
3. AXiM Core validates and accepts connection
4. Both sides can now send messages bidirectionally

### Message Format

All messages are JSON with HMAC-SHA256 signature:

```json
{
  "signature": "hex-encoded-hmac-sha256",
  "payload": "{\"command\":\"execute\",\"task\":\"...\"}",
  "timestamp": 1234567890
}
```

### Signature Verification

Worker verifies every incoming message:

1. Fetch `CREATOR_OOB_SIGNING_KEY` from vault
2. Extract `payload` string from message
3. Compute HMAC-SHA256: `HMAC(key=signing_key, msg=payload)`
4. Compare with `signature` field (constant-time)
5. Reject if mismatch (log security event)

### Command Types

- `execute`: Run a task with given parameters
- `spawn_sub_agent`: Delegate work to new worker
- `interrupt`: Cancel running task
- `health_check`: Respond with status

## Credential Flow

### Static Credentials (Bootstrap)

- `AXIM_ONYX_SECRET`: WebSocket authentication (env var, set once)

### Dynamic Credentials (Vault)

All operational credentials fetched on-demand:

1. Worker calls `tools::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY")`
2. Vault authenticates using `AXIM_ONYX_SECRET`
3. Returns service key valid for 1 hour
4. Worker caches and auto-refreshes

### Temporal Credentials (Short-Lived)

For specific operations (e.g., spawning sub-agents):

1. Worker calls `tools::axim_vault::fetch_temporal_credential("satellite_job_queue")`
2. Vault generates token valid for 5 minutes
3. Worker uses immediately and discards
4. No caching (fetch fresh each time)

## Gateway Routing

Universal micro-app dispatcher at `POST /api/v1/gateway`:

```rust
let response = invoke_axim_micro_app(
    "wordpress",           // target micro-app
    "create_post",         // action
    json!({"title": "..."}), // payload
).await?;
```

Gateway handles:
- Routing to correct micro-app backend
- Rate limiting
- Retries and circuit breaking
- Response transformation

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `AXIM_CORE_URL` | Base URL for AXiM Core API | `https://api.axim.us.com` |
| `AXIM_ONYX_SECRET` | Worker authentication secret | `secret_xyz...` |
| `VITE_ONYX_WORKER_URL` | Public URL of the deployed Cloudflare Worker | `https://onyx-edge.axim.us.com` |
| `CHAT_ROUTING_MODE` | Enables proxy-mode validation for edge-backed routing | `proxy` |
| `AXIM_CORE_UI_STREAM_ENDPOINT` | UI event stream endpoint | `https://api.axim.us.com/v1/ui/stream` |
| `AXIM_CORE_SWARM_STATE_ENDPOINT` | Swarm telemetry endpoint | `https://api.axim.us.com/v1/swarm/state` |
| `AXIM_CORE_SSE_STREAM_ENDPOINT` | Server-Sent Events endpoint | `https://api.axim.us.com/v1/sse/stream` |
| `AXIM_VAULT_URL` | Vault service URL | `https://api.axim.us.com/v1/vault` |

### Cloudflare Worker deployment surface

- The authoritative Worker config lives at `edge-bridge/wrangler.jsonc`, with a repo-root `wrangler.jsonc` mirror kept for Cloudflare's root-level deploy command.
- Local Worker secrets should be placed in `edge-bridge/.dev.vars` using `edge-bridge/.dev.vars.example` as the template.
- Production secrets must be loaded into Cloudflare with Wrangler, including:
  - `AXIM_ONYX_SECRET`
  - `ANTHROPIC_API_KEY`
  - `GITHUB_WEBHOOK_SECRET`
  - `WP_WEBHOOK_SECRET`
  - `AXIM_INTERNAL_KEY`
- WordPress senders that cannot add an `x-wp-webhook-signature` header may instead call `https://onyx-edge.axim.us.com/api/v1/webhooks?wp_secret=<WP_WEBHOOK_SECRET>` over HTTPS.

## Troubleshooting

### Signature Validation Failures

**Symptom:** Log shows `[SECURITY] ✗ Invalid HMAC signature detected!`

**Causes:**
1. Clock skew between AXiM Core and worker
2. Wrong signing key in vault
3. Message tampering or corruption

**Debug Steps:**
```bash
# Check vault has correct key
curl -H "Authorization: Bearer $AXIM_ONYX_SECRET" \
     https://api.axim.us.com/v1/vault/CREATOR_OOB_SIGNING_KEY

# Enable debug logging
RUST_LOG=debug cargo run -- serve headless

# Check signature manually
echo -n '{"command":"test"}' | \
  openssl dgst -sha256 -hmac "your_key_here" | \
  awk '{print $2}'
```

### WebSocket Connection Failures

**Symptom:** `[ERROR] Duplex stream failed: Connection refused`

**Causes:**
1. AXiM Core is down
2. Invalid `AXIM_ONYX_SECRET`
3. Network/firewall blocking WebSocket

**Debug Steps:**
```bash
# Test raw WebSocket connection
wscat -c wss://api.axim.us.com/v1/onyx/duplex \
      -H "Authorization: Bearer $AXIM_ONYX_SECRET"

# Check DNS resolution
nslookup api.axim.us.com

# Check network connectivity
curl -v https://api.axim.us.com/health
```

### Sub-Agent Spawning Failures

**Symptom:** `execute_spawn_sub_agent` returns error

**Causes:**
1. Temporal credential expired
2. Job queue full
3. Invalid parent job ID

**Debug Steps:**
```bash
# Check job queue status
curl -H "Authorization: Bearer $(fetch_temporal_credential satellite_job_queue)" \
     https://api.axim.us.com/v1/satellite_job_queue/status

# Enable verbose logging
RUST_LOG=swarm_ops=trace cargo run -- serve headless
```

## Adding New Micro-App Integration

1. **Define tool in `rust/crates/tools/src/`:**
   ```rust
   // new_app_ops.rs
   pub async fn execute_new_app_action(input: Input) -> Result<Output, String> {
       let service_key = crate::axim_vault::fetch_vault_secret("AXIM_SERVICE_KEY").await?;
       // ... implementation
   }
   ```

2. **Add to gateway routing if needed:**
   ```rust
   invoke_axim_micro_app("new_app", "action_name", payload).await?
   ```

3. **Register tool in runtime:**
   ```rust
   // In tools/src/lib.rs
   pub fn new_app_tool_definition() -> ToolDefinition { ... }
   ```

4. **Test end-to-end:**
   ```bash
   cargo test --test new_app_integration
   ```

## Monitoring

### Health Checks

- Duplex stream: Check `ACTIVE_CONNECTIONS` metric
- API calls: Check `onyx_http_requests_total{status="5xx"}`
- Vault: Check `onyx_vault_fetches_total{status="error"}`

### Alerts

Recommended alert rules:

```yaml
# Prometheus alert rules
- alert: OnyxDuplexStreamDown
  expr: onyx_active_connections == 0
  for: 1m
  annotations:
    summary: "Onyx worker has no active duplex connection"

- alert: OnyxHighErrorRate
  expr: rate(onyx_http_requests_total{status="5xx"}[5m]) > 0.1
  for: 5m
  annotations:
    summary: "Onyx API error rate > 10%"

- alert: OnyxVaultFailures
  expr: rate(onyx_vault_fetches_total{status="error"}[5m]) > 0.05
  for: 5m
  annotations:
    summary: "Onyx vault fetch failures detected"
```

## Security Best Practices

1. **Never log full credentials** - only log last 4 chars for debugging
2. **Use constant-time comparison** for signature verification
3. **Rotate credentials quarterly** via vault admin panel
4. **Monitor signature failures** - alert on >5/minute
5. **Validate all inputs** from duplex stream before execution

---

For more details, see:
- [Runtime Configuration](../crates/runtime/README.md)
- [Tool Development Guide](../crates/tools/README.md)
- [API Client Documentation](../crates/api/README.md)
