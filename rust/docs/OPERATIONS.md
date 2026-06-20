# Onyx Mk3 Operations

## Live Telemetry Instrumentation

Onyx Mk3 exposes live Prometheus telemetry counters to trace internal execution latency, external API requests, and secure credential handling.

The following hooks have been actively instrumented into the application logic:
1. **`HTTP_REQUEST_DURATION` and `HTTP_REQUESTS_TOTAL`**: Hooked inside the core HTTP client dispatcher (`api/src/http_client.rs`). Tracks the duration and success/error status of all outbound external HTTP calls initiated by Onyx.
2. **`LLM_API_CALLS`**: Hooked inside the provider routing logic in `api/src/client.rs`. Records usage across different AI providers (e.g., Anthropic, OpenAI, Gemini) and specific models.
3. **`VAULT_FETCHES_TOTAL`**: Hooked inside `tools/src/axim_vault.rs` to audit every computational decryption or generation of sensitive credentials from the AXiM Vault.

These metrics enable real-time dashboarding for AXiM ecosystem fleet operators.

## Prometheus Automated Scraping

The live telemetry metrics are automatically exposed on a background HTTP listener when the Onyx Mk3 app runs.
Automated fleet monitoring tools like Prometheus can scrape these metrics from: `http://127.0.0.1:9090/metrics`
