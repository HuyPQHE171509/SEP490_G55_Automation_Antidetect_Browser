// tests/unit/web-admin/checkoutEmailBinding.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for the "email mismatch → Pro lost" fix.
//
// Bug: the checkout receipt email could differ from the logged-in account
// email. create-payment stored the order under the receipt email, but
// /api/user-status queries by the ACCOUNT email → no match → Pro not detected.
//
// Fix: create-payment now also stores `userEmail = accountEmail` so the order
// is always discoverable by the account email, and findActiveOrderByEmail
// matches on userEmail OR email.
//
// Style mirrors tests/unit/web-admin/adminLicenses.test.js — small in-test
// handlers reproduce production logic against jest mocks.

// ════════════════════════════════════════════════════════════════════════════
// Shared mocks / fakes
// ════════════════════════════════════════════════════════════════════════════

// In-memory order store keyed by orderCode.
let store;
const mockSaveOrder = jest.fn((orderCode, data) => {
  store[String(orderCode)] = { ...data };
  return Promise.resolve();
});
const mockUpdateOrder = jest.fn((orderCode, updates) => {
  store[String(orderCode)] = { ...(store[String(orderCode)] || {}), ...updates };
  return Promise.resolve();
});

// Mirrors storage.findActiveOrderByEmail JSON-scan branch: match userEmail OR
// checkout email, status paid OR trial.
function findActiveOrderByEmail(email) {
  const normalised = String(email || '').toLowerCase().trim();
  if (!normalised) return null;
  for (const [orderCode, order] of Object.entries(store)) {
    const matchUser = order.userEmail?.toLowerCase() === normalised;
    const matchCheckout = order.email?.toLowerCase() === normalised;
    const active = order.status === 'paid' || order.status === 'trial';
    if ((matchUser || matchCheckout) && active) {
      return { orderCode, order };
    }
  }
  return null;
}

// ── create-payment handler (mirrors src/web-admin/backend/api/create-payment.js)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createPaymentHandler(req, res) {
  const { email, accountEmail, tier = 'pro' } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  const PRICES = { pro: 30000 };
  const amount = PRICES[tier];
  if (!amount) return res.status(400).json({ error: 'Invalid tier' });

  const orderCode = req._orderCode || Date.now();
  // The fix: bind the order to the logged-in account email (fallback: receipt).
  const boundAccountEmail = (accountEmail || email).toLowerCase().trim();
  await mockSaveOrder(orderCode, {
    email,
    userEmail: boundAccountEmail,
    tier,
    amount,
    status: 'pending',
  });
  return res.status(200).json({ checkoutUrl: 'https://pay.payos.vn/web/abc', orderCode });
}

// ── user-status handler (mirrors src/web-admin/backend/api/user-status.js) ----
async function userStatusHandler(req, res) {
  const { email } = req.query || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const entry = await findActiveOrderByEmail(email);
  if (entry) {
    const isTrial = entry.order.status === 'trial';
    return res.status(200).json({ isPro: true, isTrial, status: entry.order.status });
  }
  return res.status(200).json({ isPro: false, isTrial: false, status: null });
}

// Helper: build a mock Express res object.
function buildRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.end = jest.fn(() => res);
  return res;
}

// Helper: simulate PayOS confirming payment for an order.
function markPaid(orderCode) {
  return mockUpdateOrder(orderCode, { status: 'paid' });
}

beforeEach(() => {
  store = {};
  jest.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

describe('checkout email binding (create-payment → user-status)', () => {
  test('UTCID01 — receipt email == account email: Pro detected after payment', async () => {
    const account = 'long@example.com';
    let res = buildRes();
    await createPaymentHandler(
      { body: { email: account, accountEmail: account, tier: 'pro' }, _orderCode: 'OC1' },
      res,
    );
    expect(res.statusCode).toBe(200);

    await markPaid('OC1');

    res = buildRes();
    await userStatusHandler({ query: { email: account } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ isPro: true, isTrial: false, status: 'paid' });
  });

  test('UTCID02 — receipt email DIFFERS from account email: Pro still detected by account email (the fix)', async () => {
    const account = 'long@example.com';
    const receipt = 'someone-else@gmail.com';
    let res = buildRes();
    await createPaymentHandler(
      { body: { email: receipt, accountEmail: account, tier: 'pro' }, _orderCode: 'OC2' },
      res,
    );
    expect(res.statusCode).toBe(200);
    // Order is bound to the account email regardless of the receipt email.
    expect(store.OC2.userEmail).toBe(account);
    expect(store.OC2.email).toBe(receipt);

    await markPaid('OC2');

    // Querying by ACCOUNT email must find the order.
    res = buildRes();
    await userStatusHandler({ query: { email: account } }, res);
    expect(res.body).toEqual({ isPro: true, isTrial: false, status: 'paid' });
  });

  test('UTCID03 — account email is case-insensitive on lookup', async () => {
    let res = buildRes();
    await createPaymentHandler(
      { body: { email: 'User@Example.com', accountEmail: 'User@Example.com', tier: 'pro' }, _orderCode: 'OC3' },
      res,
    );
    await markPaid('OC3');

    res = buildRes();
    await userStatusHandler({ query: { email: 'user@example.com' } }, res);
    expect(res.body.isPro).toBe(true);
  });

  test('UTCID04 — order still pending: Pro NOT granted yet', async () => {
    const account = 'pending@example.com';
    let res = buildRes();
    await createPaymentHandler(
      { body: { email: account, accountEmail: account, tier: 'pro' }, _orderCode: 'OC4' },
      res,
    );
    // No markPaid → status stays 'pending'.
    res = buildRes();
    await userStatusHandler({ query: { email: account } }, res);
    expect(res.body).toEqual({ isPro: false, isTrial: false, status: null });
  });

  test('UTCID05 — unrelated email gets no Pro', async () => {
    let res = buildRes();
    await createPaymentHandler(
      { body: { email: 'buyer@example.com', accountEmail: 'buyer@example.com', tier: 'pro' }, _orderCode: 'OC5' },
      res,
    );
    await markPaid('OC5');

    res = buildRes();
    await userStatusHandler({ query: { email: 'stranger@example.com' } }, res);
    expect(res.body).toEqual({ isPro: false, isTrial: false, status: null });
  });

  test('UTCID06 — accountEmail missing: falls back to receipt email binding', async () => {
    const receipt = 'fallback@example.com';
    let res = buildRes();
    await createPaymentHandler(
      { body: { email: receipt, tier: 'pro' }, _orderCode: 'OC6' }, // no accountEmail
      res,
    );
    expect(store.OC6.userEmail).toBe(receipt);

    await markPaid('OC6');
    res = buildRes();
    await userStatusHandler({ query: { email: receipt } }, res);
    expect(res.body.isPro).toBe(true);
  });

  test('UTCID07 — invalid receipt email is rejected', async () => {
    const res = buildRes();
    await createPaymentHandler(
      { body: { email: 'not-an-email', accountEmail: 'x@y.com', tier: 'pro' }, _orderCode: 'OC7' },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(mockSaveOrder).not.toHaveBeenCalled();
  });
});
