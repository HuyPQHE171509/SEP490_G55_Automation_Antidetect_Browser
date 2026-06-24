// tests/unit/api/apiFingerprint.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 2 Excel sheets (Fastify API fingerprint routes):
//   • POST /api/fingerprint/generate              (UC_81) — 5 cases
//   • POST /api/fingerprints/:profileId/generate  (UC_82) — 5 cases
const Fastify = require('fastify');

// ════════════════════════════════════════════════════════════════════════════
// Mocks
// ════════════════════════════════════════════════════════════════════════════
const mockGenerateFingerprint   = jest.fn();
const mockGetProfilesInternal   = jest.fn();
const mockSaveProfileInternal   = jest.fn();
const mockBroadcast             = jest.fn();

let _fpRequireFails = false;

// ════════════════════════════════════════════════════════════════════════════
// Test app builder
// ════════════════════════════════════════════════════════════════════════════
const OS_MAP      = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
const BROWSER_MAP = { chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge' };

function formatFingerprintResponse(generated) {
  // Flatten common fields onto the response (mirrors restServer formatter)
  const fp = generated.fingerprint || {};
  return {
    success: true,
    userAgent: fp.userAgent,
    platform: fp.platform,
    screen: fp.screen,
    fingerprint: fp,
    settings: generated.settings || {},
    _meta: generated._meta || {},
  };
}

function buildApp() {
  const app = Fastify();

  // POST /api/fingerprint/generate — random, no save
  app.post('/api/fingerprint/generate', async (req, reply) => {
    try {
      if (_fpRequireFails) throw new Error("Cannot find module '../engine/fingerprintGenerator'");
      const opts = req.body || {};
      const seed = Number(opts.seed) || undefined;
      const generated = mockGenerateFingerprint({
        os: opts.os, language: opts.language, timezone: opts.timezone, seed,
      });
      reply.send({
        success: true,
        fingerprint: generated.fingerprint,
        settings: generated.settings,
        _meta: { seed: generated._meta?.seed ?? seed },
      });
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  // POST /api/fingerprints/:profileId/generate — generate AND save
  app.post('/api/fingerprints/:profileId/generate', async (req, reply) => {
    try {
      if (_fpRequireFails) throw new Error("Cannot find module '../engine/fingerprintGenerator'");
      const profiles = await mockGetProfilesInternal();
      const profile = profiles.find((p) => p.id === req.params.profileId);
      if (!profile) {
        return reply.code(404).send({ success: false, error: 'Profile not found' });
      }
      const body = req.body || {};
      const opts = {
        os: body.os ? OS_MAP[String(body.os).toLowerCase()] : undefined,
        browser: body.browser ? BROWSER_MAP[String(body.browser).toLowerCase()] : undefined,
        language: body.language,
        timezone: body.timezone,
      };
      const generated = mockGenerateFingerprint(opts);
      const saveResult = await mockSaveProfileInternal({
        id: profile.id,
        fingerprint: generated.fingerprint,
        settings: { ...profile.settings, ...(generated.settings || {}) },
      });
      // Per UC_82: route always sends 200 with formatted FP, even if save fails.
      if (saveResult.success) mockBroadcast();
      reply.send(formatFingerprintResponse(generated));
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/fingerprint/generate  [UC_81]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/fingerprint/generate  [UC_81]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _fpRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): {} no opts → 200 + {success:true, fingerprint, settings, _meta:{seed}}', async () => {
    mockGenerateFingerprint.mockReturnValue({
      fingerprint: { userAgent: 'Mozilla...', platform: 'Win32', screen: '1920x1080' },
      settings: { language: 'en-US' },
      _meta: { seed: 42 },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprint/generate', payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().fingerprint.userAgent).toBe('Mozilla...');
    expect(res.json()._meta.seed).toBe(42);
  });

  test('UTCID02 (N): {os:"Windows", language:"en-US"} → 200 + matching fingerprint', async () => {
    mockGenerateFingerprint.mockReturnValue({
      fingerprint: { os: 'Windows', userAgent: 'Mozilla Win', platform: 'Win32' },
      settings: { language: 'en-US' },
      _meta: { seed: 1 },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprint/generate',
      payload: { os: 'Windows', language: 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fingerprint.os).toBe('Windows');
    expect(mockGenerateFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ os: 'Windows', language: 'en-US' }),
    );
  });

  test('UTCID03 (N): {seed:12345} → 200 + deterministic output (same seed forwarded)', async () => {
    mockGenerateFingerprint.mockReturnValue({
      fingerprint: { userAgent: 'Det' },
      settings: {},
      _meta: { seed: 12345 },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprint/generate',
      payload: { seed: 12345 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()._meta.seed).toBe(12345);
    expect(mockGenerateFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ seed: 12345 }),
    );
  });

  test('UTCID04 (N): {os:"InvalidOS"} → fallback to first OS_CONFIGS entry → 200', async () => {
    mockGenerateFingerprint.mockReturnValue({
      fingerprint: { os: 'Windows', userAgent: 'Fallback Win' }, // generator picks osItems[0]
      settings: {},
      _meta: {},
    });
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprint/generate',
      payload: { os: 'InvalidOS' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fingerprint.os).toBe('Windows');
  });

  test('UTCID05 (B): require throws → 500 + "Cannot find module..."', async () => {
    _fpRequireFails = true;
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprint/generate', payload: {},
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/Cannot find module/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/fingerprints/:profileId/generate  [UC_82]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/fingerprints/:profileId/generate  [UC_82]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _fpRequireFails = false;
    mockGetProfilesInternal.mockResolvedValue([
      { id: 'p_001', name: 'P1', settings: {} },
    ]);
    mockSaveProfileInternal.mockResolvedValue({ success: true });
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  test('UTCID01 (N): "p_001" + {os:"windows", browser:"chrome"} → 200 + flattened fp + save called with mapped opts', async () => {
    mockGenerateFingerprint.mockReturnValue({
      fingerprint: {
        os: 'Windows', browser: 'Chrome',
        userAgent: 'Mozilla Win Chrome', platform: 'Win32', screen: '1920x1080',
      },
      settings: {},
      _meta: {},
    });
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprints/p_001/generate',
      payload: { os: 'windows', browser: 'chrome' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userAgent).toBe('Mozilla Win Chrome');
    expect(res.json().platform).toBe('Win32');
    expect(mockGenerateFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ os: 'Windows', browser: 'Chrome' }),
    );
    expect(mockSaveProfileInternal).toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalled();
  });

  test('UTCID02 (A): "p_999" not in profiles → 404 + "Profile not found"', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprints/p_999/generate',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, error: 'Profile not found' });
    expect(mockGenerateFingerprint).not.toHaveBeenCalled();
  });

  test('UTCID03 (N): "p_001" + {} (random) → 200 + flattened fp', async () => {
    mockGenerateFingerprint.mockReturnValue({
      fingerprint: { os: 'Windows', userAgent: 'Random Win' },
      settings: {},
      _meta: {},
    });
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprints/p_001/generate',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userAgent).toBe('Random Win');
  });

  test('UTCID04 (B): saveProfileInternal returns success:false → still 200 + flattened fp (quirk)', async () => {
    mockSaveProfileInternal.mockResolvedValue({
      success: false, error: 'Failed to persist profiles file',
    });
    mockGenerateFingerprint.mockReturnValue({
      fingerprint: { os: 'Linux', userAgent: 'Mozilla Linux' },
      settings: {},
      _meta: {},
    });
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprints/p_001/generate',
      payload: { os: 'linux' },
    });
    // Per UC_82: route still sends 200 even though profile not actually saved.
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().fingerprint.os).toBe('Linux');
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  test('UTCID05 (N): {os:"linux", browser:"firefox", language:"fr-FR"} → 200 + Linux/Firefox/fr-FR mapped opts', async () => {
    mockGenerateFingerprint.mockReturnValue({
      fingerprint: {
        os: 'Linux', browser: 'Firefox',
        userAgent: 'Firefox Linux', language: 'fr-FR',
      },
      settings: { language: 'fr-FR' },
      _meta: {},
    });
    const res = await app.inject({
      method: 'POST', url: '/api/fingerprints/p_001/generate',
      payload: { os: 'linux', browser: 'firefox', language: 'fr-FR' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fingerprint.os).toBe('Linux');
    expect(res.json().fingerprint.browser).toBe('Firefox');
    expect(res.json().fingerprint.language).toBe('fr-FR');
    expect(mockGenerateFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({ os: 'Linux', browser: 'Firefox', language: 'fr-FR' }),
    );
  });
});
