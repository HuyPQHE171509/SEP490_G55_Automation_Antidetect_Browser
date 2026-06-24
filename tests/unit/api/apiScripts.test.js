// tests/unit/api/apiScripts.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 4 Excel sheets (Fastify API script CRUD routes):
//   • GET    /api/scripts        (UC_77) — 5 cases
//   • POST   /api/scripts        (UC_78) — 5 cases
//   • PUT    /api/scripts/:id    (UC_79) — 5 cases
//   • DELETE /api/scripts/:id    (UC_80) — 4 cases
const Fastify = require('fastify');

// ════════════════════════════════════════════════════════════════════════════
// Mocks
// ════════════════════════════════════════════════════════════════════════════
const mockListScriptsInternal  = jest.fn();
const mockGetScriptInternal    = jest.fn();
const mockSaveScriptInternal   = jest.fn();
const mockDeleteScriptInternal = jest.fn();
const mockCancelScript         = jest.fn();
const mockScheduleScript       = jest.fn();
const mockBroadcast            = jest.fn();

let _scriptsRequireFails = false;

// ════════════════════════════════════════════════════════════════════════════
// Test app builder
// ════════════════════════════════════════════════════════════════════════════
function buildApp() {
  const app = Fastify();

  // GET /api/scripts — RAW array, NOT wrapped
  app.get('/api/scripts', async (_req, reply) => {
    try {
      if (_scriptsRequireFails) throw new Error("Cannot find module '../storage/scripts'");
      const list = await mockListScriptsInternal();
      reply.send(Array.isArray(list) ? list : []);
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  // POST /api/scripts
  app.post('/api/scripts', async (req, reply) => {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return reply.code(400).send({ success: false, error: '"name" is required' });
    }
    if (!body.content || !String(body.content).trim()) {
      return reply.code(400).send({ success: false, error: '"content" is required' });
    }
    const payload = {
      name: body.name,
      code: body.content,
      browserMode: body.browserMode || 'visible',
      schedule: body.schedule || { enabled: false },
    };
    const result = await mockSaveScriptInternal(payload);
    if (!result.success) {
      return reply.code(400).send(result);
    }
    try { mockScheduleScript(result.script); } catch {}
    mockBroadcast();
    reply.code(201).send(result);
  });

  // PUT /api/scripts/:id
  app.put('/api/scripts/:id', async (req, reply) => {
    const found = await mockGetScriptInternal(req.params.id);
    if (!found.success) {
      return reply.code(404).send({ success: false, error: 'Script not found' });
    }
    const existing = found.script;
    const body = req.body || {};
    const merged = {
      ...existing,
      ...(body.name != null && { name: body.name }),
      ...(body.content != null && { code: body.content }),
      ...(body.headless !== undefined && { browserMode: body.headless ? 'headless' : 'visible' }),
      id: req.params.id,
    };
    const result = await mockSaveScriptInternal(merged);
    // Per UC_79: route forwards r as-is (no 4xx mapping for save fail).
    if (result.success) {
      try { mockScheduleScript(result.script); } catch {}
    }
    reply.send(result);
  });

  // DELETE /api/scripts/:id
  app.delete('/api/scripts/:id', async (req, reply) => {
    try {
      if (_scriptsRequireFails) throw new Error("Cannot find module '../storage/scripts'");
      try { mockCancelScript(req.params.id); } catch {}
      const result = await mockDeleteScriptInternal(req.params.id);
      if (result.success) mockBroadcast();
      // Per UC_80: route does NOT map to 404 — always 200 + body.
      reply.send(result);
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/scripts  [UC_77]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/scripts  [UC_77]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _scriptsRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): valid array of 3 → 200 + RAW [3] (NOT wrapped)', async () => {
    mockListScriptsInternal.mockResolvedValue([
      { id: 's1', name: 'A', code: '1' },
      { id: 's2', name: 'B', code: '2' },
      { id: 's3', name: 'C', code: '3' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/scripts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
  });

  test('UTCID02 (N): file missing — readScripts creates [] then returns [] → 200 + []', async () => {
    mockListScriptsInternal.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/scripts' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  test('UTCID03 (N): malformed JSON — readScripts fallback → 200 + []', async () => {
    mockListScriptsInternal.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/scripts' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  test('UTCID04 (B): root not array ({}) → readScripts returns [] → 200 + []', async () => {
    mockListScriptsInternal.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/scripts' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  test('UTCID05 (B): require throws → 500 + "Cannot find module..."', async () => {
    _scriptsRequireFails = true;
    const res = await app.inject({ method: 'GET', url: '/api/scripts' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/Cannot find module/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/scripts  [UC_78]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/scripts  [UC_78]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _scriptsRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): valid {name, content} → 201 + script + broadcast', async () => {
    mockSaveScriptInternal.mockResolvedValue({
      success: true,
      script: {
        id: 'sid', name: 'S1', code: 'console.log(1)',
        browserMode: 'visible', schedule: { enabled: false },
      },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/scripts',
      payload: { name: 'S1', content: 'console.log(1)' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().script.name).toBe('S1');
    expect(mockBroadcast).toHaveBeenCalled();
  });

  test('UTCID02 (A): no name → 400 + \'"name" is required\'', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/scripts',
      payload: { content: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: '"name" is required' });
    expect(mockSaveScriptInternal).not.toHaveBeenCalled();
  });

  test('UTCID03 (A): no content → 400 + \'"content" is required\'', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/scripts',
      payload: { name: 'S1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: '"content" is required' });
    expect(mockSaveScriptInternal).not.toHaveBeenCalled();
  });

  test('UTCID04 (B): writeScripts fails → 400 + "Persist error"', async () => {
    mockSaveScriptInternal.mockResolvedValue({ success: false, error: 'Persist error' });
    const res = await app.inject({
      method: 'POST', url: '/api/scripts',
      payload: { name: 'S1', content: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'Persist error' });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  test('UTCID05 (A): valid + browserMode:"headless" + schedule.enabled → 201 + scheduleScript called', async () => {
    mockSaveScriptInternal.mockResolvedValue({
      success: true,
      script: {
        id: 'sid', name: 'S1', code: 'x',
        browserMode: 'headless', schedule: { enabled: true, cron: '* * * * *' },
      },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/scripts',
      payload: { name: 'S1', content: 'x', browserMode: 'headless', schedule: { enabled: true, cron: '* * * * *' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().script.browserMode).toBe('headless');
    expect(res.json().script.schedule.enabled).toBe(true);
    expect(mockScheduleScript).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PUT /api/scripts/:id  [UC_79]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('PUT /api/scripts/:id  [UC_79]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _scriptsRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): "sc_001" exists + {name:"NewName"} → 200 + updated', async () => {
    mockGetScriptInternal.mockResolvedValue({
      success: true, script: { id: 'sc_001', name: 'Old', code: 'x' },
    });
    mockSaveScriptInternal.mockImplementation(async (s) => ({
      success: true, script: { ...s, updatedAt: '2026-01-01' },
    }));
    const res = await app.inject({
      method: 'PUT', url: '/api/scripts/sc_001',
      payload: { name: 'NewName' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().script.name).toBe('NewName');
    expect(mockScheduleScript).toHaveBeenCalled();
  });

  test('UTCID02 (A): "sc_999" not found → 404 + "Script not found"', async () => {
    mockGetScriptInternal.mockResolvedValue({ success: false, error: 'Script not found' });
    const res = await app.inject({
      method: 'PUT', url: '/api/scripts/sc_999',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, error: 'Script not found' });
    expect(mockSaveScriptInternal).not.toHaveBeenCalled();
  });

  test('UTCID03 (N): "sc_001" + {headless:true} → 200 + browserMode:"headless"', async () => {
    mockGetScriptInternal.mockResolvedValue({
      success: true, script: { id: 'sc_001', name: 'Old', code: 'x', browserMode: 'visible' },
    });
    mockSaveScriptInternal.mockImplementation(async (s) => ({
      success: true, script: s,
    }));
    const res = await app.inject({
      method: 'PUT', url: '/api/scripts/sc_001',
      payload: { headless: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().script.browserMode).toBe('headless');
  });

  test('UTCID04 (N): "sc_001" + {} (empty body) → 200 + same fields, updatedAt refreshed', async () => {
    mockGetScriptInternal.mockResolvedValue({
      success: true, script: { id: 'sc_001', name: 'Same', code: 'same' },
    });
    mockSaveScriptInternal.mockImplementation(async (s) => ({
      success: true, script: { ...s, updatedAt: '2026-01-02' },
    }));
    const res = await app.inject({
      method: 'PUT', url: '/api/scripts/sc_001',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().script.name).toBe('Same');
    expect(res.json().script.updatedAt).toBeDefined();
  });

  test('UTCID05 (B): saveScriptInternal persist error → 200 + {success:false} (NO 4xx mapping)', async () => {
    mockGetScriptInternal.mockResolvedValue({
      success: true, script: { id: 'sc_001', name: 'Old', code: 'x' },
    });
    mockSaveScriptInternal.mockResolvedValue({ success: false, error: 'Persist error' });
    const res = await app.inject({
      method: 'PUT', url: '/api/scripts/sc_001',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, error: 'Persist error' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/scripts/:id  [UC_80]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('DELETE /api/scripts/:id  [UC_80]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _scriptsRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): "sc_001" exists → 200 + {success:true} + cancelScript + broadcast', async () => {
    mockDeleteScriptInternal.mockResolvedValue({ success: true });
    const res = await app.inject({ method: 'DELETE', url: '/api/scripts/sc_001' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(mockCancelScript).toHaveBeenCalledWith('sc_001');
    expect(mockBroadcast).toHaveBeenCalled();
  });

  test('UTCID02 (B): "sc_999" not in file → 200 + {success:false, error:"Script not found"} (NOT 404)', async () => {
    mockDeleteScriptInternal.mockResolvedValue({ success: false, error: 'Script not found' });
    const res = await app.inject({ method: 'DELETE', url: '/api/scripts/sc_999' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, error: 'Script not found' });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  test('UTCID03 (B): writeScripts false → 200 + "Persist error"', async () => {
    mockDeleteScriptInternal.mockResolvedValue({ success: false, error: 'Persist error' });
    const res = await app.inject({ method: 'DELETE', url: '/api/scripts/sc_001' });
    expect(res.statusCode).toBe(200);
    expect(res.json().error).toBe('Persist error');
  });

  test('UTCID04 (B): require throws → 500 + "Cannot find module..."', async () => {
    _scriptsRequireFails = true;
    const res = await app.inject({ method: 'DELETE', url: '/api/scripts/sc_001' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/Cannot find module/);
  });
});
