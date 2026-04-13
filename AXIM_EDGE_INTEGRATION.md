# Master Integration Plan: AXiM Core + Onyx mk3 Edge Bridge

## The Goal
Create a serverless 'Edge Bridge' that allows AXiM Core to communicate with Onyx's intelligence. This provides a highly performant, serverless, and cost-effective way to expose Onyx's core LLM routing logic as a lightweight TypeScript Edge function via Cloudflare Workers.

## The Architecture
We will create a new subdirectory containing a Cloudflare Worker project. This worker will receive commands, inject Onyx's system prompts, and route them to the appropriate LLM (starting with Anthropic/Claude).

## The API Contract
The worker will expose a `POST /api/v1/chat` endpoint. It expects a JSON payload containing:
```json
{
  "command": "user command string",
  "context": "context string or object"
}
```

## Security
All requests must include an `Authorization: Bearer <token>` header, matching a secret we will store in the worker's environment variables (`AXIM_ONYX_SECRET`).
