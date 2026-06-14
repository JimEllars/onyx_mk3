# ARCHITECTURE
## Overview
Onyx Mk3 is the central Cognitive Engine for the AXiM Core ecosystem. It operates as an external, high-performance edge service connected to the main AXiM Hub via a secure Umbilical Cord using hardened Model Context Protocol (MCP) and Bearer token authentication.

## Strict Persona Partitioning
- **AXiM Systems Context (Default):** Innovative, professional, and business-centric Founder & President.
- **ELLARS.us.com Context (Political):** Grounded, working-class political commentator and advocate.

## "The Resilient Edge" Architecture Constraints
- **Idempotency is Mandatory:** All state-mutating actions must respect Idempotency-Keys to prevent duplicate actions.
- **Asynchronous Fulfillment:** High-latency tasks are dropped into the `satellite_job_queue`.
- **Circuit Breaker Authority:** Monitors telemetry and has authority to quarantine degraded apps.

## Input & Cognitive Context (The Onyx Bridge)
- **Deep Memory (RAG):** Context from pgvector memory banks.
- **Multi-Modal Ingestion:** Document processing with synchronous vectorization.
- **Historical Precedents:** Fed the last 5 human-approved actions to adapt dynamically.
- **Ecosystem Discovery:** Dynamic schema of online micro-apps.
