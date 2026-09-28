import { describe, it, expect, beforeAll } from 'vitest';
import worker from '../src/index';

describe('Security Edge Bridge Tests', () => {
  it('rejects /api/v1/onyx/emergency-direct without auth', async () => {
    const req = new Request('http://localhost/api/v1/onyx/emergency-direct', { method: 'POST', body: JSON.stringify({ email: "jrellars@gmail.com" }) });
    const res = await worker.fetch(req, {} as any, {} as any);
    expect(res.status).toBe(401);
  });

  it('rejects /api/v1/mcp/execute without auth', async () => {
    const req = new Request('http://localhost/api/v1/mcp/execute', { method: 'POST', body: JSON.stringify({ action_id: "123", decision: "approve" }) });
    const res = await worker.fetch(req, {} as any, {} as any);
    expect(res.status).toBe(401);
  });
});
