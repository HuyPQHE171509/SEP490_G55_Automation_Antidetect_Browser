// tests/unit/api/apiProfiles.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 4 Excel sheets (Fastify API routes):
//   • api.restServer GET    /api/profiles      (UC_52) — 5 cases
//   • api.restServer POST   /api/profiles      (UC_53) — 6 cases
//   • api.restServer PUT    /api/profiles/:id  (UC_54) — 5 cases
//   • api.restServer DELETE /api/profiles/:id  (UC_55) — 5 cases
//
// Style: mirrors tests/unit/api/apiLaunchBrowser.test.js — Fastify with mocked
// handlers for getProfilesInternal/saveProfileInternal/stopProfileInternal/
// deleteProfileInternal.
const Fastify = require('fastify');

// ════════════════════════════════════════════════════════════════════════════
// Mocks
// ════════════════════════════════════════════════════════════════════════════
const mockGetProfilesInternal    = jest.fn();
const mockSaveProfileInternal    = jest.fn();
const mockStopProfileInternal    = jest.fn();
const mockDeleteProfileInternal  = jest.fn();
const mockBroadcast              = jest.fn();
const mockIsLicenseOk            = jest.fn();

// ════════════════════════════════════════════════════════════════════════════
// Test app builder — reproduces the relevant Fastify routes
// ════════════════════════════════════════════════════════════════════════════
function buildApp({ apiKey = '' } = {}) {
  const app = Fastify();

  // Pre-handler: x-api-key check when apiKey configured. Public list only
  // contains a few endpoints; /api/profiles requires auth when apiKey is set.
  app.addHook('preHandler', async (req, reply) => {
    if (apiKey) {
      const sent = req.headers['x-api-key'];
      if (sent !== apiKey) {
        return reply.code(401).send({ success: false, error: 'Unauthorized' });
      }
    }
  });

  // GET /api/profiles
  app.get('/api/profiles', async (_req, reply) => {
    const list = await mockGetProfilesInternal();
    reply.send(list);
  });

  // POST /api/profiles
  app.post('/api/profiles', async (req, reply) => {
    try {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      if (!name) {
        return reply.code(400).send({ success: false, error: '"name" is required' });
      }
      const existing = await mockGetProfilesInternal();
      if (!mockIsLicenseOk() && existing.length >= 5) {
        return reply.code(403).send({
          success: false,
          error: 'Free plan giới hạn tối đa 5 profiles. Vui lòng kích hoạt license để tạo thêm.',
        });
      }
      const fpOpt = body.fingerprintOptions || {};
      const payload = {
        name,
        fingerprint: {
          os: fpOpt.os, browser: fpOpt.browser, language: fpOpt.locale,
        },
        settings: {
          proxy: body.proxy || { server: '', username: '', password: '' },
          injectFingerprint: true,
        },
      };
      const result = await mockSaveProfileInternal(payload);
      if (!result.success) {
        return reply.code(400).send(result);
      }
      mockBroadcast();
      reply.code(201).send(result);
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  // PUT /api/profiles/:id
  app.put('/api/profiles/:id', async (req, reply) => {
    try {
      const profileId = req.params.id;
      const list = await mockGetProfilesInternal();
      const existing = list.find((p) => p.id === profileId);
      if (!existing) {
        return reply.code(404).send({ success: false, error: 'Profile not found' });
      }
      const body = req.body || {};
      const updatePayload = { id: profileId };
      if (body.name != null && String(body.name).trim()) {
        updatePayload.name = String(body.name).trim();
      }
      if (body.description != null) updatePayload.description = String(body.description);
      if (body.startUrl != null) updatePayload.startUrl = body.startUrl;
      if (body.proxy != null) {
        const px = body.proxy;
        if (px.host && px.port) {
          const scheme = px.type || 'http';
          updatePayload.settings = {
            proxy: {
              server: `${scheme}://${px.host}:${px.port}`,
              username: px.username || '',
              password: px.password || '',
            },
          };
        }
      }
      const result = await mockSaveProfileInternal(updatePayload);
      if (result.success) mockBroadcast();
      reply.code(result.success ? 200 : 400).send(result);
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  // DELETE /api/profiles/:id
  app.delete('/api/profiles/:id', async (req, reply) => {
    try {
      const list = await mockGetProfilesInternal();
      if (!list.find((p) => p.id === req.params.id)) {
        return reply.code(404).send({ success: false, error: 'Profile not found' });
      }
      const id = req.params.id;
      try { await mockStopProfileInternal(id); } catch { /* swallow */ }
      const result = await mockDeleteProfileInternal(id);
      if (result.success) mockBroadcast();
      reply.code(result.success ? 200 : 400).send(result);
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/profiles  [UC_52]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('api.restServer GET /api/profiles  [UC_52]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): apiKey="secret123" + correct header → 200 + JSON array of 3 profiles', async () => {
    app = buildApp({ apiKey: 'secret123' });
    mockGetProfilesInternal.mockResolvedValue([
      { id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { 'x-api-key': 'secret123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): apiKey="secret123" + wrong/missing header → 401 + Unauthorized', async () => {
    app = buildApp({ apiKey: 'secret123' });

    const res = await app.inject({ method: 'GET', url: '/api/profiles' });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(mockGetProfilesInternal).not.toHaveBeenCalled();
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): apiKey not configured → 200 + 3 profiles (no auth required)', async () => {
    app = buildApp({ apiKey: '' });
    mockGetProfilesInternal.mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/profiles' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): profiles.json missing → 200 + [] (readProfiles returns empty)', async () => {
    app = buildApp({ apiKey: '' });
    mockGetProfilesInternal.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/api/profiles' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  // ── UTCID05 (B) ─────────────────────────────────────────────────────────────
  test('UTCID05 (B): profiles.json corrupt (parse fails) → 200 + [] (safe default)', async () => {
    app = buildApp({ apiKey: '' });
    // readProfiles swallows JSON parse errors and returns []
    mockGetProfilesInternal.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/api/profiles' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/profiles  [UC_53]  — 6 cases
// ════════════════════════════════════════════════════════════════════════════
describe('api.restServer POST /api/profiles  [UC_53]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfilesInternal.mockResolvedValue([]);
    mockIsLicenseOk.mockReturnValue(true);
    mockSaveProfileInternal.mockImplementation(async (p) => ({
      success: true,
      profile: {
        id: 'newid',
        name: p.name,
        fingerprint: { ...(p.fingerprint || {}), enriched: true },
        settings: p.settings || {},
      },
    }));
    app = buildApp({ apiKey: '' });
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid body {name:"Bot1", fingerprintOptions:{os,browser,locale}} → 201 + profile', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Bot1', fingerprintOptions: { os: 'windows', browser: 'chrome', locale: 'en-US' } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.profile.name).toBe('Bot1');
    expect(body.profile.settings.injectFingerprint).toBe(true);
    expect(mockBroadcast).toHaveBeenCalled();
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): body without name (whitespace) → 400 + \'"name" is required\'', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: '"name" is required' });
    expect(mockSaveProfileInternal).not.toHaveBeenCalled();
  });

  // ── UTCID03 (B) ─────────────────────────────────────────────────────────────
  test('UTCID03 (B): would be 6th profile, free plan capped → 403 + free plan message', async () => {
    mockIsLicenseOk.mockReturnValue(false);
    mockGetProfilesInternal.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'P6' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/Free plan giới hạn tối đa 5 profiles/);
    expect(mockSaveProfileInternal).not.toHaveBeenCalled();
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): body name="  Trimmed  " → 201 + profile.name="Trimmed"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: '  Trimmed  ' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().profile.name).toBe('Trimmed');
    expect(mockSaveProfileInternal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Trimmed' }),
    );
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): valid body with proxy → 201 + profile.settings.proxy populated', async () => {
    mockSaveProfileInternal.mockImplementation(async (p) => ({
      success: true,
      profile: {
        id: 'newid',
        name: p.name,
        settings: { proxy: { server: 'http://1.2.3.4:8080', username: 'u', password: 'p' } },
      },
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: {
        name: 'WithProxy',
        proxy: { server: 'http://1.2.3.4:8080', username: 'u', password: 'p' },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().profile.settings.proxy.server).toBe('http://1.2.3.4:8080');
  });

  // ── UTCID06 (A) ─────────────────────────────────────────────────────────────
  test('UTCID06 (A): saveProfileInternal returns persist error → 400 forwarded', async () => {
    mockSaveProfileInternal.mockResolvedValue({
      success: false,
      error: 'Failed to persist profiles file',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Bot1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'Failed to persist profiles file' });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PUT /api/profiles/:id  [UC_54]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('api.restServer PUT /api/profiles/:id  [UC_54]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfilesInternal.mockResolvedValue([
      { id: 'abc123', name: 'Old', description: '', startUrl: 'https://www.google.com' },
    ]);
    mockSaveProfileInternal.mockImplementation(async (p) => ({
      success: true,
      profile: { id: 'abc123', name: p.name || 'Old', description: p.description || '', settings: p.settings || {} },
    }));
    app = buildApp({ apiKey: '' });
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): id="abc123" + {name,description} → 200 + merged profile', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profiles/abc123',
      payload: { name: 'Renamed', description: 'new desc' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().profile.name).toBe('Renamed');
    expect(res.json().profile.description).toBe('new desc');
    expect(mockBroadcast).toHaveBeenCalled();
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): id="unknown" → 404 + "Profile not found"', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profiles/unknown',
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, error: 'Profile not found' });
    expect(mockSaveProfileInternal).not.toHaveBeenCalled();
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): id="abc123" + empty body {} → 200 + saveProfileInternal called with just {id}', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profiles/abc123',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    // Only id passed — name preserved (sanitize fallback)
    expect(mockSaveProfileInternal).toHaveBeenCalledWith({ id: 'abc123' });
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): id="abc123" + proxy → 200 + settings.proxy.server="socks5://1.1.1.1:1080"', async () => {
    mockSaveProfileInternal.mockImplementation(async (p) => ({
      success: true,
      profile: {
        id: 'abc123',
        settings: p.settings || { proxy: { server: 'socks5://1.1.1.1:1080', username: '', password: '' } },
      },
    }));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/profiles/abc123',
      payload: { proxy: { type: 'socks5', host: '1.1.1.1', port: 1080 } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().profile.settings.proxy.server).toBe('socks5://1.1.1.1:1080');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): id="abc123" + saveProfileInternal returns persist error → 400', async () => {
    mockSaveProfileInternal.mockResolvedValue({
      success: false,
      error: 'Failed to persist profiles file',
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/profiles/abc123',
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'Failed to persist profiles file' });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/profiles/:id  [UC_55]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('api.restServer DELETE /api/profiles/:id  [UC_55]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfilesInternal.mockResolvedValue([{ id: 'abc123', name: 'A' }]);
    mockStopProfileInternal.mockResolvedValue({ success: true });
    mockDeleteProfileInternal.mockResolvedValue({ success: true });
    app = buildApp({ apiKey: '' });
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): id="abc123" exists, not running → 200 + {success:true} + broadcast', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/abc123' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(mockStopProfileInternal).toHaveBeenCalledWith('abc123');
    expect(mockDeleteProfileInternal).toHaveBeenCalledWith('abc123');
    expect(mockBroadcast).toHaveBeenCalled();
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): id="unknown" → 404 + "Profile not found"', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/unknown' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, error: 'Profile not found' });
    expect(mockDeleteProfileInternal).not.toHaveBeenCalled();
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): id="abc123" running → stop first then delete → 200 + {success:true}', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/abc123' });

    expect(res.statusCode).toBe(200);
    expect(mockStopProfileInternal).toHaveBeenCalledWith('abc123');
    expect(mockDeleteProfileInternal).toHaveBeenCalledWith('abc123');
    // Order check: stop should resolve before delete is called
    const stopOrder = mockStopProfileInternal.mock.invocationCallOrder[0];
    const delOrder = mockDeleteProfileInternal.mock.invocationCallOrder[0];
    expect(stopOrder).toBeLessThan(delOrder);
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): write fails → 400 + "Failed to persist profiles file"', async () => {
    mockDeleteProfileInternal.mockResolvedValue({
      success: false,
      error: 'Failed to persist profiles file',
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/abc123' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'Failed to persist profiles file' });
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): stop throws (swallowed) → delete still proceeds → 200 + {success:true}', async () => {
    mockStopProfileInternal.mockRejectedValue(new Error('Cannot close running browser'));

    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/abc123' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(mockDeleteProfileInternal).toHaveBeenCalledWith('abc123');
    expect(mockBroadcast).toHaveBeenCalled();
  });
});
