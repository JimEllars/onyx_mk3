# API Contract

## Edge Bridge Endpoints

### `/api/v1/onyx/emergency-direct`
* **Method**: `POST`
* **Authentication**: `Authorization: Bearer <ONYX_EMERGENCY_SECRET>` or `HMAC`
* **Description**: Out-of-band Emergency Direct Line.
* **Payload**: JSON containing `email` or `parameters.email`. Only `jrellars@gmail.com` and `james.ellars@axim.us.com` are permitted.

### `/api/v1/mcp/execute`
* **Method**: `POST`
* **Authentication**: `Authorization: Bearer <AXIM_ONYX_SECRET>` or `Cookie: axim_session=...`
* **Description**: Human-in-the-loop action approval endpoint.
* **Payload**: JSON containing `action_id`, `decision`, and `operator_notes`.

### Headers
* **Trace Propagation**: `x-onyx-trace-id`, `cf-ray`.
* **Telemetry Payload**: Reporting to `public.telemetry_events`.
