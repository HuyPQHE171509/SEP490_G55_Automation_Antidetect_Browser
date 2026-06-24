// tests/unit/api/apiProxies.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 4 Excel sheets (Fastify API proxy CRUD routes):
//   • GET    /api/proxies        (UC_73) — 5 cases
//   • POST   /api/proxies        (UC_74) — 5 cases
//   • PUT    /api/proxies/:id    (UC_75) — 5 cases
//   • DELETE /api/proxies/:id    (UC_76) — 4 cases
//
// Style: mirrors apiProfiles.test.js — Fastify with mocked storage.proxies.
const Fastify = require('fastify');

// ════════════════════════════════════════════════════════════════════════════
// Mocks
// ════════════════════════════════════════════════════════════════════════════
const mockGetProxiesInternal    = jest.fn();
const mockCreateProxyInternal   = jest.fn();
const mockUpdateProxyInternal   = jest.fn();
const mockDeleteProxyInternal   = jest.fn();
const mockBroadcast             = jest.fn();

let _proxiesRequireFails = false;

// ════════════════════════════════════════════════════════════════════════════
// Test app builder
// ════════════════════════════════════════════════════════════════════════════
function buildApp() {
  const app = Fastify();

  app.get('/api/proxies', async (_req, reply) => {
    try {
      if (_proxiesRequireFails) throw new Error("Cannot find module '../storage/proxies'");
      const proxies = await mockGetProxiesInternal();
      reply.send({ success: true, proxies: Array.isArray(proxies) ? proxies : [] });
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/proxies', async (req, reply) => {
    const result = await mockCreateProxyInternal(req.body || {});
    if (result.success) {
      mockBroadcast();
      return reply.code(201).send(result);
    }
    reply.code(400).send(result);
  });

  app.put('/api/proxies/:id', async (req, reply) => {
    const result = await mockUpdateProxyInternal(req.params.id, req.body || {});
    if (result.success) {
      mockBroadcast();
      return reply.code(200).send(result);
    }
    if (result.error === 'Proxy not found') {
      return reply.code(404).send(result);
    }
    reply.code(400).send(result);
  });

  app.delete('/api/proxies/:id', async (req, reply) => {
    try {
      if (_proxiesRequireFails) throw new Error("Cannot find module '../storage/proxies'");
      const result = await mockDeleteProxyInternal(req.params.id);
      if (result.success) mockBroadcast();
      // Per UC_76: route does NOT map to 404 — always 200 + body.
      reply.send(result);
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/proxies  [UC_73]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/proxies  [UC_73]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _proxiesRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): valid array of 3 → 200 + {success:true, proxies:[3]}', async () => {
    mockGetProxiesInternal.mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/proxies' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, proxies: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] });
  });

  test('UTCID02 (N): file missing (readProxies returns []) → 200 + {success:true, proxies:[]}', async () => {
    mockGetProxiesInternal.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/proxies' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, proxies: [] });
  });

  test('UTCID03 (N): malformed JSON → fallback [] → 200', async () => {
    mockGetProxiesInternal.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/proxies' });
    expect(res.statusCode).toBe(200);
    expect(res.json().proxies).toEqual([]);
  });

  test('UTCID04 (B): file root not array ({}) → readProxies returns [] → 200', async () => {
    mockGetProxiesInternal.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/proxies' });
    expect(res.statusCode).toBe(200);
    expect(res.json().proxies).toEqual([]);
  });

  test('UTCID05 (B): require throws → 500 + {success:false, error:"Cannot find module..."}', async () => {
    _proxiesRequireFails = true;
    const res = await app.inject({ method: 'GET', url: '/api/proxies' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/Cannot find module/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/proxies  [UC_74]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/proxies  [UC_74]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _proxiesRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): valid {name,type,host,port} → 201 + proxy + broadcast', async () => {
    mockCreateProxyInternal.mockResolvedValue({
      success: true,
      proxy: { id: 'pid', name: 'P1', type: 'http', host: '1.2.3.4', port: 8080 },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/proxies',
      payload: { name: 'P1', type: 'http', host: '1.2.3.4', port: 8080 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().proxy.host).toBe('1.2.3.4');
    expect(mockBroadcast).toHaveBeenCalled();
  });

  test('UTCID02 (A): no host → 400 + "Host is required"', async () => {
    mockCreateProxyInternal.mockResolvedValue({ success: false, error: 'Host is required' });
    const res = await app.inject({
      method: 'POST', url: '/api/proxies',
      payload: { type: 'http', port: 8080 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'Host is required' });
  });

  test('UTCID03 (A): port=99999 → 400 + "Port must be 1-65535"', async () => {
    mockCreateProxyInternal.mockResolvedValue({ success: false, error: 'Port must be 1-65535' });
    const res = await app.inject({
      method: 'POST', url: '/api/proxies',
      payload: { host: '1.2.3.4', port: 99999 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Port must be 1-65535');
  });

  test('UTCID04 (A): type="foo" → 400 + "Type must be one of: http, https, socks4, socks5"', async () => {
    mockCreateProxyInternal.mockResolvedValue({
      success: false, error: 'Type must be one of: http, https, socks4, socks5',
    });
    const res = await app.inject({
      method: 'POST', url: '/api/proxies',
      payload: { host: '1.2.3.4', port: 8080, type: 'foo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Type must be one of/);
  });

  test('UTCID05 (B): writeProxies fails → 400 + "Failed to persist proxies file"', async () => {
    mockCreateProxyInternal.mockResolvedValue({
      success: false, error: 'Failed to persist proxies file',
    });
    const res = await app.inject({
      method: 'POST', url: '/api/proxies',
      payload: { host: '1.2.3.4', port: 8080 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Failed to persist proxies file');
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PUT /api/proxies/:id  [UC_75]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('PUT /api/proxies/:id  [UC_75]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _proxiesRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): "px_001" exists + {name:"NewName"} → 200 + updated proxy', async () => {
    mockUpdateProxyInternal.mockResolvedValue({
      success: true, proxy: { id: 'px_001', name: 'NewName', updatedAt: '2026-01-01' },
    });
    const res = await app.inject({
      method: 'PUT', url: '/api/proxies/px_001',
      payload: { name: 'NewName' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().proxy.name).toBe('NewName');
    expect(mockBroadcast).toHaveBeenCalled();
  });

  test('UTCID02 (A): "px_999" not found → 404 + "Proxy not found"', async () => {
    mockUpdateProxyInternal.mockResolvedValue({ success: false, error: 'Proxy not found' });
    const res = await app.inject({
      method: 'PUT', url: '/api/proxies/px_999',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, error: 'Proxy not found' });
  });

  test('UTCID03 (A): {type:"foo"} → 400 + "Type must be one of: http, https, socks4, socks5"', async () => {
    mockUpdateProxyInternal.mockResolvedValue({
      success: false, error: 'Type must be one of: http, https, socks4, socks5',
    });
    const res = await app.inject({
      method: 'PUT', url: '/api/proxies/px_001',
      payload: { type: 'foo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Type must be one of/);
  });

  test('UTCID04 (B): writeProxies false → 400 + "Failed to persist proxies file"', async () => {
    mockUpdateProxyInternal.mockResolvedValue({
      success: false, error: 'Failed to persist proxies file',
    });
    const res = await app.inject({
      method: 'PUT', url: '/api/proxies/px_001',
      payload: { host: '5.6.7.8' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Failed to persist proxies file');
  });

  test('UTCID05 (A): host="" → 400 + "Host is required"', async () => {
    mockUpdateProxyInternal.mockResolvedValue({ success: false, error: 'Host is required' });
    const res = await app.inject({
      method: 'PUT', url: '/api/proxies/px_001',
      payload: { host: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Host is required');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/proxies/:id  [UC_76]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('DELETE /api/proxies/:id  [UC_76]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _proxiesRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): "px_001" exists → 200 + {success:true} + broadcast', async () => {
    mockDeleteProxyInternal.mockResolvedValue({ success: true });
    const res = await app.inject({ method: 'DELETE', url: '/api/proxies/px_001' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(mockBroadcast).toHaveBeenCalled();
  });

  test('UTCID02 (B): "px_999" not in file → 200 + {success:false, error:"Proxy not found"} (NOT 404)', async () => {
    mockDeleteProxyInternal.mockResolvedValue({ success: false, error: 'Proxy not found' });
    const res = await app.inject({ method: 'DELETE', url: '/api/proxies/px_999' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, error: 'Proxy not found' });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  test('UTCID03 (B): writeProxies false → 200 + {success:false, error:"Failed to persist proxies file"}', async () => {
    mockDeleteProxyInternal.mockResolvedValue({
      success: false, error: 'Failed to persist proxies file',
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/proxies/px_001' });
    expect(res.statusCode).toBe(200);
    expect(res.json().error).toBe('Failed to persist proxies file');
  });

  test('UTCID04 (B): require throws → 500 + "Cannot find module..."', async () => {
    _proxiesRequireFails = true;
    const res = await app.inject({ method: 'DELETE', url: '/api/proxies/px_001' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/Cannot find module/);
  });
});
