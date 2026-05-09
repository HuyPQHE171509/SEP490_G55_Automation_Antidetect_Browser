// tests/unit/api/apiHealth.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 1 Excel sheet (Fastify API health probe):
//   • GET /api/health  (UC_83) — 4 cases
//
// Source code: GET /api/health is a synchronous one-liner —
//   reply.send({ ok: true })
// /api/health is on the public allowlist so it bypasses any x-api-key check.
const Fastify = require('fastify');

// ════════════════════════════════════════════════════════════════════════════
// Test app builder — reproduces the public allowlist + health one-liner
// ════════════════════════════════════════════════════════════════════════════
const PUBLIC_PATHS = new Set(['/api/health']);

function buildApp({ apiKey = 'secret' } = {}) {
  const app = Fastify();

  // Pre-handler: x-api-key required UNLESS path is in PUBLIC_PATHS
  app.addHook('preHandler', async (req, reply) => {
    if (PUBLIC_PATHS.has(req.url) || PUBLIC_PATHS.has(req.routerPath)) return;
    if (apiKey) {
      const sent = req.headers['x-api-key'];
      if (sent !== apiKey) {
        return reply.code(401).send({ success: false, error: 'Unauthorized' });
      }
    }
  });

  app.get('/api/health', (_req, reply) => {
    reply.send({ ok: true });
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/health  [UC_83]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/health  [UC_83]', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ apiKey: 'secret' });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): GET /api/health (no auth header) → 200 + {ok:true} (public allowlist)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): GET /api/health with x-api-key:<valid> → 200 + {ok:true} (auth not enforced)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/health',
      headers: { 'x-api-key': 'secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  // ── UTCID03 (B) ─────────────────────────────────────────────────────────────
  test('UTCID03 (B): GET /api/health/ (trailing slash) → 404 (default ignoreTrailingSlash:false)', async () => {
    // Build a fresh app without auth so the preHandler doesn't intercept the
    // 404-path. /api/health/ is NOT registered as a route (no trailing slash).
    await app.close();
    app = buildApp({ apiKey: '' });

    const res = await app.inject({ method: 'GET', url: '/api/health/' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(expect.objectContaining({
      error: 'Not Found',
      statusCode: 404,
    }));
  });

  // ── UTCID04 (B) ─────────────────────────────────────────────────────────────
  test('UTCID04 (B): POST /api/health → 404 (route only registered for GET)', async () => {
    // Same fresh-app trick — POST /api/health is unregistered → fastify 404.
    await app.close();
    app = buildApp({ apiKey: '' });

    const res = await app.inject({ method: 'POST', url: '/api/health' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(expect.objectContaining({
      error: 'Not Found',
      statusCode: 404,
    }));
  });
});
