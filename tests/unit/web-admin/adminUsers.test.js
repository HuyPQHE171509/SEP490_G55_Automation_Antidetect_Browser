// tests/unit/web-admin/adminUsers.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 2 Excel sheets:
//   • web-admin.api.admin.users.searchUser  (UC_04.01) — 8 cases
//   • web-admin.api.admin.users.listUsers   (UC_04.02) — 8 cases
//
// Style: mirrors tests/unit/web-admin/adminLicenses.test.js — small in-test
// "handlers" reproducing production logic from
//   src/web-admin/backend/api/admin/users.js
//   src/web-admin/frontend/src/pages/Users/index.jsx (search filter)
// against jest mocks.

// ════════════════════════════════════════════════════════════════════════════
// Shared mocks
// ════════════════════════════════════════════════════════════════════════════
const mockGetAllOrders = jest.fn();
const mockListUsersFirebase = jest.fn(); // mocks getAuth().listUsers(1000)

// Helper: build an Express-like res
function buildRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    ended: false,
  };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((b) => { res.body = b; res.ended = true; return res; });
  res.end = jest.fn(() => { res.ended = true; return res; });
  return res;
}

// ════════════════════════════════════════════════════════════════════════════
// Production-like handlers
// ════════════════════════════════════════════════════════════════════════════

// --- listUsers (GET /api/admin/users) ----------------------------------------
async function listUsersHandler(req, res, env = {}) {
  // Method check (UTCID06 wrong method)
  if (req.method !== 'GET') {
    console.log('listUsers failed – method not allowed');
    return res.status(405).end();
  }

  // Bearer token check (UTCID05) — production handles via requireAdmin middleware,
  // here we mirror with a simple req.adminEmail guard
  if (!req.adminEmail) {
    console.log('listUsers failed – 401');
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const orders = await mockGetAllOrders();

    const proEmails = new Set(
      orders
        .filter(o => o.status === 'paid' || o.status === 'trial')
        .flatMap(o => [o.email, o.userEmail].filter(Boolean).map(e => e.toLowerCase()))
    );
    const trialEmails = new Set(
      orders
        .filter(o => o.status === 'trial')
        .flatMap(o => [o.email, o.userEmail].filter(Boolean).map(e => e.toLowerCase()))
    );

    if (!env.FIREBASE_SERVICE_ACCOUNT) {
      // Orders fallback (UTCID04)
      const usersFromOrders = orders.map(o => ({
        uid: null,
        email: o.userEmail || o.email,
        displayName: null,
        lastSignIn: null,
        createdAt: o.createdAt,
        isPro: proEmails.has((o.userEmail || o.email)?.toLowerCase()),
        isTrial: trialEmails.has((o.userEmail || o.email)?.toLowerCase()),
        provider: 'unknown',
      }));
      console.log('listUsers success (fallback)');
      return res.status(200).json({ users: usersFromOrders, source: 'orders-fallback' });
    }

    // Firebase Admin path
    const listResult = await mockListUsersFirebase(1000);
    const users = listResult.users.map(u => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName || null,
      lastSignIn: u.metadata?.lastSignInTime,
      createdAt: u.metadata?.creationTime,
      emailVerified: u.emailVerified,
      isPro: proEmails.has(u.email?.toLowerCase()),
      isTrial: trialEmails.has(u.email?.toLowerCase()),
      provider: u.providerData?.[0]?.providerId || 'password',
    }));

    users.sort((a, b) => {
      if (a.isPro !== b.isPro) return a.isPro ? -1 : 1;
      return new Date(b.lastSignIn || 0) - new Date(a.lastSignIn || 0);
    });

    if (users.length === 0) {
      console.log('listUsers success (empty)');
    } else if (users.some(u => u.isPro || u.isTrial)) {
      console.log('listUsers success (enriched)');
    } else {
      console.log('listUsers success');
    }
    return res.status(200).json({ users, source: 'firebase-admin' });
  } catch (err) {
    return res.status(500).json({ error: 'Server error.' });
  }
}

// --- searchUser (frontend filter applied to listUsers result) ----------------
// Returns { users: [...] }. Mirrors Users/index.jsx filter logic.
async function searchUserHandler(req, res, env = {}) {
  if (!req.adminEmail) {
    console.log('searchUser failed – 401');
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  // First call listUsers internally to get the data set, then filter
  const inner = buildRes();
  await listUsersHandler({ method: 'GET', adminEmail: req.adminEmail }, inner, env);

  if (inner.statusCode !== 200) {
    return res.status(inner.statusCode).json(inner.body);
  }

  const all = inner.body.users || [];
  const q = (req.query?.q ?? '').toString();

  // Empty query → return all (UTCID07)
  if (!q.trim()) {
    console.log('searchUser success');
    return res.status(200).json({ users: all, source: inner.body.source });
  }

  const needle = q.toLowerCase();
  const filtered = all.filter(u =>
    (u.email || '').toLowerCase().includes(needle) ||
    (u.displayName || '').toLowerCase().includes(needle)
  );

  if (filtered.length === 0) {
    console.log('searchUser success (empty)');
  } else if (inner.body.source === 'orders-fallback') {
    console.log('searchUser success (orders-fallback)');
  } else {
    console.log('searchUser success');
  }
  return res.status(200).json({ users: filtered, source: inner.body.source });
}

// ════════════════════════════════════════════════════════════════════════════
// Shared fixtures
// ════════════════════════════════════════════════════════════════════════════
const ordersFixture = [
  { _orderCode: 'OC1', email: 'long@example.com', userEmail: 'long@example.com', status: 'paid',  createdAt: '2026-01-10T00:00:00Z' },
  { _orderCode: 'OC2', email: 'tri@example.com',  userEmail: 'tri@example.com',  status: 'trial', createdAt: '2026-02-11T00:00:00Z' },
  { _orderCode: 'OC3', email: 'guest@hl.com',     userEmail: null,                status: 'pending', createdAt: '2026-03-12T00:00:00Z' },
];

const firebaseUsers = {
  users: [
    { uid: 'u1', email: 'long@example.com', displayName: 'Long NP',  emailVerified: true,
      metadata: { lastSignInTime: '2026-04-01T10:00:00Z', creationTime: '2026-01-01T00:00:00Z' },
      providerData: [{ providerId: 'password' }] },
    { uid: 'u2', email: 'tri@example.com',  displayName: 'Tri Tran', emailVerified: true,
      metadata: { lastSignInTime: '2026-04-02T10:00:00Z', creationTime: '2026-02-01T00:00:00Z' },
      providerData: [{ providerId: 'google.com' }] },
    { uid: 'u3', email: 'casual@hl.com',    displayName: 'Casual',   emailVerified: false,
      metadata: { lastSignInTime: '2026-04-03T10:00:00Z', creationTime: '2026-03-01T00:00:00Z' },
      providerData: [{ providerId: 'password' }] },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// listUsers  [UC_04.02]  — 8 cases
// ════════════════════════════════════════════════════════════════════════════
describe('api.admin.users.listUsers  [UC_04.02]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockGetAllOrders.mockResolvedValue(ordersFixture);
    mockListUsersFirebase.mockResolvedValue(firebaseUsers);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): Firebase SDK present → returns up to 1000 users (200)', async () => {
    const req = { method: 'GET', adminEmail: 'admin@hl.com' };
    const res = buildRes();

    await listUsersHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('firebase-admin');
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users).toHaveLength(3);
    expect(mockListUsersFirebase).toHaveBeenCalledWith(1000);
    expect(logSpy).toHaveBeenCalledWith('listUsers success (enriched)');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): Users enriched with isPro from paid orders, log "listUsers success (enriched)"', async () => {
    const req = { method: 'GET', adminEmail: 'admin@hl.com' };
    const res = buildRes();

    await listUsersHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    const longUser = res.body.users.find(u => u.email === 'long@example.com');
    expect(longUser.isPro).toBe(true);
    expect(longUser.isTrial).toBe(false);
    // Pro/trial users sorted before non-pro casual user
    const lastUser = res.body.users[res.body.users.length - 1];
    expect(lastUser.email).toBe('casual@hl.com');
    expect(lastUser.isPro).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('listUsers success (enriched)');
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): Users enriched with isTrial from trial orders, log "listUsers success (enriched)"', async () => {
    const req = { method: 'GET', adminEmail: 'admin@hl.com' };
    const res = buildRes();

    await listUsersHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    const triUser = res.body.users.find(u => u.email === 'tri@example.com');
    expect(triUser.isTrial).toBe(true);
    expect(triUser.isPro).toBe(true); // trial counts as pro per orders fixture
    expect(logSpy).toHaveBeenCalledWith('listUsers success (enriched)');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): Firebase SDK missing → orders-fallback, log "listUsers success (fallback)"', async () => {
    const req = { method: 'GET', adminEmail: 'admin@hl.com' };
    const res = buildRes();

    await listUsersHandler(req, res, {}); // FIREBASE_SERVICE_ACCOUNT undefined

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('orders-fallback');
    expect(mockListUsersFirebase).not.toHaveBeenCalled();
    expect(res.body.users.length).toBe(ordersFixture.length);
    expect(logSpy).toHaveBeenCalledWith('listUsers success (fallback)');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): Bearer token invalid → 401, log "listUsers failed – 401"', async () => {
    const req = { method: 'GET', adminEmail: null }; // requireAdmin failed
    const res = buildRes();

    await listUsersHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
    expect(mockGetAllOrders).not.toHaveBeenCalled();
    expect(mockListUsersFirebase).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('listUsers failed – 401');
  });

  // ── UTCID06 (A) ─────────────────────────────────────────────────────────────
  test('UTCID06 (A): Wrong HTTP method (POST) → 405, log "listUsers failed – method not allowed"', async () => {
    const req = { method: 'POST', adminEmail: 'admin@hl.com' };
    const res = buildRes();

    await listUsersHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(405);
    expect(res.ended).toBe(true);
    expect(mockGetAllOrders).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('listUsers failed – method not allowed');
  });

  // ── UTCID07 (B) ─────────────────────────────────────────────────────────────
  test('UTCID07 (B): 0 users in Firebase → empty array (200), log "listUsers success (empty)"', async () => {
    mockListUsersFirebase.mockResolvedValue({ users: [] });
    const req = { method: 'GET', adminEmail: 'admin@hl.com' };
    const res = buildRes();

    await listUsersHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    expect(res.body.users).toEqual([]);
    expect(res.body.source).toBe('firebase-admin');
    expect(logSpy).toHaveBeenCalledWith('listUsers success (empty)');
  });

  // ── UTCID08 (B) ─────────────────────────────────────────────────────────────
  test('UTCID08 (B): Firebase listUsers returns exactly 1000 cap → all 1000 returned', async () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({
      uid: `u${i}`,
      email: `user${i}@example.com`,
      displayName: `User ${i}`,
      emailVerified: true,
      metadata: { lastSignInTime: '2026-04-01T10:00:00Z', creationTime: '2026-01-01T00:00:00Z' },
      providerData: [{ providerId: 'password' }],
    }));
    mockListUsersFirebase.mockResolvedValue({ users: big });
    mockGetAllOrders.mockResolvedValue([]); // no orders → no enrichment

    const req = { method: 'GET', adminEmail: 'admin@hl.com' };
    const res = buildRes();

    await listUsersHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    expect(res.body.users).toHaveLength(1000);
    expect(mockListUsersFirebase).toHaveBeenCalledWith(1000);
    expect(logSpy).toHaveBeenCalledWith('listUsers success');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// searchUser  [UC_04.01]  — 8 cases
// ════════════════════════════════════════════════════════════════════════════
describe('api.admin.users.searchUser  [UC_04.01]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockGetAllOrders.mockResolvedValue(ordersFixture);
    mockListUsersFirebase.mockResolvedValue(firebaseUsers);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): Exact email match → return matching user, log "searchUser success"', async () => {
    const req = { adminEmail: 'admin@hl.com', query: { q: 'long@example.com' } };
    const res = buildRes();

    await searchUserHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].email).toBe('long@example.com');
    expect(logSpy).toHaveBeenCalledWith('searchUser success');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): Substring match (prefix) → returns users whose local-part starts with query', async () => {
    const req = { adminEmail: 'admin@hl.com', query: { q: 'lon' } };
    const res = buildRes();

    await searchUserHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    expect(res.body.users.map(u => u.email)).toEqual(['long@example.com']);
    expect(logSpy).toHaveBeenCalledWith('searchUser success');
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): Substring match (domain) → returns all users on that domain', async () => {
    const req = { adminEmail: 'admin@hl.com', query: { q: 'example.com' } };
    const res = buildRes();

    await searchUserHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    const emails = res.body.users.map(u => u.email).sort();
    expect(emails).toEqual(['long@example.com', 'tri@example.com']);
    expect(logSpy).toHaveBeenCalledWith('searchUser success');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): No match → empty array (200), log "searchUser success (empty)"', async () => {
    const req = { adminEmail: 'admin@hl.com', query: { q: 'nonexistent-zzz' } };
    const res = buildRes();

    await searchUserHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    expect(res.body.users).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('searchUser success (empty)');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): Bearer token missing/invalid → 401, log "searchUser failed – 401"', async () => {
    const req = { adminEmail: null, query: { q: 'long' } };
    const res = buildRes();

    await searchUserHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
    expect(mockGetAllOrders).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('searchUser failed – 401');
  });

  // ── UTCID06 (A) ─────────────────────────────────────────────────────────────
  test('UTCID06 (A): Firebase admin SDK missing → fallback (orders-fallback), log "searchUser success (orders-fallback)"', async () => {
    const req = { adminEmail: 'admin@hl.com', query: { q: 'long' } };
    const res = buildRes();

    await searchUserHandler(req, res, {}); // no FIREBASE_SERVICE_ACCOUNT

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('orders-fallback');
    expect(res.body.users.map(u => u.email)).toContain('long@example.com');
    expect(mockListUsersFirebase).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('searchUser success (orders-fallback)');
  });

  // ── UTCID07 (B) ─────────────────────────────────────────────────────────────
  test('UTCID07 (B): Empty query → return all users, log "searchUser success"', async () => {
    const req = { adminEmail: 'admin@hl.com', query: { q: '' } };
    const res = buildRes();

    await searchUserHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    expect(res.body.users).toHaveLength(firebaseUsers.users.length);
    expect(logSpy).toHaveBeenCalledWith('searchUser success');
  });

  // ── UTCID08 (B) ─────────────────────────────────────────────────────────────
  test('UTCID08 (B): Query with special chars %_@ → treated as literal substring (no SQL-injection / wildcard expansion)', async () => {
    const req = { adminEmail: 'admin@hl.com', query: { q: '%_@' } };
    const res = buildRes();

    await searchUserHandler(req, res, { FIREBASE_SERVICE_ACCOUNT: '{}' });

    expect(res.statusCode).toBe(200);
    // None of the seeded emails contain "%_@"
    expect(res.body.users).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('searchUser success (empty)');
  });
});