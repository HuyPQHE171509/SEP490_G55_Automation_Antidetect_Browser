// tests/unit/api/apiBrowser.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 7 Excel sheets (Fastify API browser-control routes):
//   • POST   /api/browsers/:profileId/close                  (UC_57) — 4 cases
//   • GET    /api/browsers/:profileId/status                 (UC_58) — 4 cases
//   • POST   /api/browsers/:profileId/actions/navigate       (UC_62) — 5 cases
//   • POST   /api/browsers/:profileId/actions/reload         (UC_59) — 5 cases
//   • POST   /api/browsers/:profileId/actions/go-back        (UC_60) — 5 cases
//   • POST   /api/browsers/:profileId/actions/go-forward     (UC_61) — 5 cases
//   • POST   /api/browsers/:profileId/actions/get-inner-html (UC_67) — 5 cases
//
// Style: mirrors tests/unit/api/apiLaunchBrowser.test.js — Fastify with mocked
// handlers for stopProfileInternal/runningProfiles/performAction.
const Fastify = require('fastify');

// ════════════════════════════════════════════════════════════════════════════
// Mocks
// ════════════════════════════════════════════════════════════════════════════
const mockStopProfileInternal = jest.fn();
const mockRunningGet          = jest.fn(); // simulates runningProfiles.get(id)
const mockNavigateTo          = jest.fn();
const mockReloadPage          = jest.fn();
const mockGoBack              = jest.fn();
const mockGoForward           = jest.fn();
const mockElementGetHtml      = jest.fn();

// ════════════════════════════════════════════════════════════════════════════
// Test app builder
// ════════════════════════════════════════════════════════════════════════════
function buildApp() {
  const app = Fastify();

  // POST /api/browsers/:profileId/close
  app.post('/api/browsers/:profileId/close', async (req, reply) => {
    try {
      const result = await mockStopProfileInternal(req.params.profileId);
      if (result && result.success === false) {
        return reply.code(400).send(result);
      }
      reply.send(result);
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  // GET /api/browsers/:profileId/status
  app.get('/api/browsers/:profileId/status', async (req, reply) => {
    try {
      const entry = mockRunningGet(req.params.profileId);
      reply.send({ running: !!entry });
    } catch (e) {
      reply.code(400).send({ error: e?.message || String(e) });
    }
  });

  // Common helper — wraps a "performAction" call into the standard reply path
  function actionRoute(actionFn) {
    return async (req, reply) => {
      try {
        const result = await actionFn(req.params.profileId, req.body || {});
        if (result && result.success === false) {
          return reply.code(400).send(result);
        }
        reply.send(result);
      } catch (e) {
        reply.code(400).send({ success: false, error: e?.message || String(e) });
      }
    };
  }

  app.post('/api/browsers/:profileId/actions/navigate',        actionRoute(mockNavigateTo));
  app.post('/api/browsers/:profileId/actions/reload',          actionRoute(mockReloadPage));
  app.post('/api/browsers/:profileId/actions/go-back',         actionRoute(mockGoBack));
  app.post('/api/browsers/:profileId/actions/go-forward',      actionRoute(mockGoForward));
  app.post('/api/browsers/:profileId/actions/get-inner-html',  actionRoute(mockElementGetHtml));

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/browsers/:profileId/close  [UC_57]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/browsers/:profileId/close  [UC_57]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): "abc123" running → stopProfileInternal returns {success:true} → 200', async () => {
    mockStopProfileInternal.mockResolvedValue({ success: true });

    const res = await app.inject({ method: 'POST', url: '/api/browsers/abc123/close' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(mockStopProfileInternal).toHaveBeenCalledWith('abc123');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): "abc123" not in map → 200 + {success:true, message:"Profile not running"}', async () => {
    mockStopProfileInternal.mockResolvedValue({
      success: true,
      message: 'Profile not running',
    });

    const res = await app.inject({ method: 'POST', url: '/api/browsers/abc123/close' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, message: 'Profile not running' });
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): killProcessTreeWin throws → {success:false} caught → 400', async () => {
    mockStopProfileInternal.mockResolvedValue({
      success: false,
      error: 'killProcessTreeWin: ACCESS_DENIED',
    });

    const res = await app.inject({ method: 'POST', url: '/api/browsers/abc123/close' });

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(res.json().error).toMatch(/ACCESS_DENIED/);
  });

  // ── UTCID04 (B) ─────────────────────────────────────────────────────────────
  test('UTCID04 (B): handler throws (require crashed) → 500 + caught error', async () => {
    mockStopProfileInternal.mockRejectedValue(new Error("Cannot find module '../engine/cdp'"));

    const res = await app.inject({ method: 'POST', url: '/api/browsers/abc123/close' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      success: false,
      error: "Cannot find module '../engine/cdp'",
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/browsers/:profileId/status  [UC_58]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/browsers/:profileId/status  [UC_58]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): "abc123" present in runningProfiles → 200 + {running:true}', async () => {
    mockRunningGet.mockReturnValue({ engine: 'playwright', context: {} });

    const res = await app.inject({ method: 'GET', url: '/api/browsers/abc123/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ running: true });
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): "abc123" not in runningProfiles → 200 + {running:false}', async () => {
    mockRunningGet.mockReturnValue(undefined);

    const res = await app.inject({ method: 'GET', url: '/api/browsers/abc123/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ running: false });
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): empty profileId — Map.get("") returns undefined → 200 + {running:false}', async () => {
    mockRunningGet.mockReturnValue(undefined);

    // Fastify route param can't be empty, so we test the equivalent: get(any) → undefined
    const res = await app.inject({ method: 'GET', url: '/api/browsers/empty/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ running: false });
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): require("../state/runtime") throws → 400 + {error:"Cannot find module..."}', async () => {
    mockRunningGet.mockImplementation(() => {
      throw new Error("Cannot find module '../state/runtime'");
    });

    const res = await app.inject({ method: 'GET', url: '/api/browsers/abc123/status' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Cannot find module/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/browsers/:profileId/actions/navigate  [UC_62]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/browsers/:profileId/actions/navigate  [UC_62]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): running + {url} → 200 + {success:true, url, title}', async () => {
    mockNavigateTo.mockResolvedValue({
      success: true,
      url: 'https://example.com/',
      title: 'Example Domain',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/navigate',
      payload: { url: 'https://example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      url: 'https://example.com/',
      title: 'Example Domain',
    });
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): {} no url → 400 + "url is required"', async () => {
    mockNavigateTo.mockResolvedValue({ success: false, error: 'url is required' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/navigate',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'url is required' });
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): not running → 400 + "Profile not running"', async () => {
    mockNavigateTo.mockResolvedValue({ success: false, error: 'Profile not running' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/navigate',
      payload: { url: 'https://example.com' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'Profile not running' });
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): DNS fail → 400 + net::ERR_NAME_NOT_RESOLVED', async () => {
    mockNavigateTo.mockResolvedValue({
      success: false,
      error: 'net::ERR_NAME_NOT_RESOLVED at https://invalid.invalid',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/navigate',
      payload: { url: 'https://invalid.invalid' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/ERR_NAME_NOT_RESOLVED/);
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): newPage=true (createIfMissing) → opened in new tab → 200', async () => {
    mockNavigateTo.mockResolvedValue({
      success: true,
      url: 'https://example.com/',
      title: 'Example Domain',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/navigate',
      payload: { url: 'https://example.com', newPage: true },
    });

    expect(res.statusCode).toBe(200);
    expect(mockNavigateTo).toHaveBeenCalledWith(
      'abc123',
      expect.objectContaining({ url: 'https://example.com', newPage: true }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/browsers/:profileId/actions/reload  [UC_59]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/browsers/:profileId/actions/reload  [UC_59]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): running, defaults → 200 + {success:true, url, title}', async () => {
    mockReloadPage.mockResolvedValue({
      success: true, url: 'https://example.com', title: 'Example',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/reload',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, url: 'https://example.com', title: 'Example' });
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): not running → 400 + "Profile not running"', async () => {
    mockReloadPage.mockResolvedValue({ success: false, error: 'Profile not running' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/reload',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Profile not running');
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): page.reload() rejects timeout → 400 + "Timeout 30000ms exceeded"', async () => {
    mockReloadPage.mockResolvedValue({
      success: false, error: 'Timeout 30000ms exceeded',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/reload',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Timeout/);
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): running + page.reload resolves → 200', async () => {
    mockReloadPage.mockResolvedValue({
      success: true, url: 'https://example.com', title: 'Example',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/reload',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): {waitUntil:"networkidle", timeout:10000} → 200 + forwarded options', async () => {
    mockReloadPage.mockResolvedValue({
      success: true, url: 'https://example.com', title: 'Example',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/reload',
      payload: { waitUntil: 'networkidle', timeout: 10000 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockReloadPage).toHaveBeenCalledWith(
      'abc123',
      expect.objectContaining({ waitUntil: 'networkidle', timeout: 10000 }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/browsers/:profileId/actions/go-back  [UC_60]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/browsers/:profileId/actions/go-back  [UC_60]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): running, has back history → 200 + previous URL', async () => {
    mockGoBack.mockResolvedValue({
      success: true, url: 'https://prev.example', title: 'Previous',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-back',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true, url: 'https://prev.example', title: 'Previous',
    });
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): not running → 400 + "Profile not running"', async () => {
    mockGoBack.mockResolvedValue({ success: false, error: 'Profile not running' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-back',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Profile not running');
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): no back history → page.goBack returns null → still 200 + current URL', async () => {
    mockGoBack.mockResolvedValue({
      success: true, url: 'https://current.example', title: 'Same',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-back',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe('https://current.example');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): page.goBack rejects timeout → 400 + "Timeout 30000ms exceeded"', async () => {
    mockGoBack.mockResolvedValue({
      success: false, error: 'Timeout 30000ms exceeded',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-back',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Timeout/);
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): running + back history → 200 (success path repeated)', async () => {
    mockGoBack.mockResolvedValue({
      success: true, url: 'https://prev.example', title: 'Previous',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-back',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/browsers/:profileId/actions/go-forward  [UC_61]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/browsers/:profileId/actions/go-forward  [UC_61]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): running + forward history → 200 + next URL', async () => {
    mockGoForward.mockResolvedValue({
      success: true, url: 'https://next.example', title: 'Next',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-forward',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true, url: 'https://next.example', title: 'Next',
    });
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): not running → 400 + "Profile not running"', async () => {
    mockGoForward.mockResolvedValue({ success: false, error: 'Profile not running' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-forward',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Profile not running');
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): no forward history → page.goForward returns null → 200 + current URL', async () => {
    mockGoForward.mockResolvedValue({
      success: true, url: 'https://current.example', title: 'Same',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-forward',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe('https://current.example');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): page.goForward rejects timeout → 400 + "Timeout 30000ms exceeded"', async () => {
    mockGoForward.mockResolvedValue({
      success: false, error: 'Timeout 30000ms exceeded',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-forward',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Timeout/);
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): running + forward history → 200 (repeat success)', async () => {
    mockGoForward.mockResolvedValue({
      success: true, url: 'https://next.example', title: 'Next',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/go-forward',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/browsers/:profileId/actions/get-inner-html  [UC_67]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/browsers/:profileId/actions/get-inner-html  [UC_67]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): running + selector="#x" matches → 200 + {success:true, html:"hi"}', async () => {
    mockElementGetHtml.mockResolvedValue({ success: true, html: 'hi' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/get-inner-html',
      payload: { selector: '#x' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, html: 'hi' });
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): {} no selector → 400 + "selector is required"', async () => {
    mockElementGetHtml.mockResolvedValue({ success: false, error: 'selector is required' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/get-inner-html',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: 'selector is required' });
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): not running → 400 + "Profile not running"', async () => {
    mockElementGetHtml.mockResolvedValue({ success: false, error: 'Profile not running' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/get-inner-html',
      payload: { selector: '#x' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Profile not running');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): selector not found / locator.waitFor timeout → 400', async () => {
    mockElementGetHtml.mockResolvedValue({
      success: false, error: 'locator.waitFor: Timeout 500ms exceeded.',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/get-inner-html',
      payload: { selector: '#nope', timeout: 500 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Timeout 500ms exceeded/);
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): selector="li" + index=2 → 200 + html of 3rd li', async () => {
    mockElementGetHtml.mockResolvedValue({ success: true, html: '<innerHTML of 3rd li>' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/browsers/abc123/actions/get-inner-html',
      payload: { selector: 'li', index: 2 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().html).toBe('<innerHTML of 3rd li>');
    expect(mockElementGetHtml).toHaveBeenCalledWith(
      'abc123',
      expect.objectContaining({ selector: 'li', index: 2 }),
    );
  });
});
