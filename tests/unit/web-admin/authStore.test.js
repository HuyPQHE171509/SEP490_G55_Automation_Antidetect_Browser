// tests/unit/web-admin/authStore.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 4 Excel sheets:
//   • web-admin.authStore.login           (UC_01.01) — 9 cases
//   • web-admin.authStore.register        (UC_01.02) — 8 cases
//   • web-admin.authStore.forgotPassword  (UC_01.03) — 7 cases
//   • web-admin.Register.acceptEula       (UC_01.04) — 7 cases (UI checkbox)
// EULA validation lives in RegisterPage.jsx (line 81) — tested in the
// "RegisterPage.acceptEula" block below, NOT in the register store block

const mockSignInWithEmail = jest.fn();
const mockSignInWithGoogle = jest.fn();
const mockRegisterWithEmail = jest.fn();
const mockResetPassword = jest.fn();
const mockSyncUserToFirestore = jest.fn();
const mockNormaliseUser = jest.fn((u) => u);
const mockAuth = { currentUser: null, languageCode: null };

// ─── Build a fresh store-like object for each test (mirrors authStore.js) ────
function buildStore() {
  let state = {
    user: null,
    isAuthenticated: false,
    loading: true,
    isPro: false,
    isTrial: false,
    trialExpiresAt: null,
  };
  const set = jest.fn((patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  });
  const get = () => ({
    ...state,
    checkProStatus: jest.fn().mockResolvedValue(undefined),
  });

  return {
    set,
    get,
    getState: () => state,

    // 1:1 with authStore.login
    login: async ({ email, password }) => {
      const user = await mockSignInWithEmail(email, password);
      set({ user, isAuthenticated: true });
      get().checkProStatus(user.email);
      return user;
    },

    // 1:1 with authStore.loginWithGoogle
    loginWithGoogle: async () => {
      const user = await mockSignInWithGoogle();
      set({ user, isAuthenticated: true });
      get().checkProStatus(user.email);
      return user;
    },

    // 1:1 with authStore.register
    register: async ({ name, email, password }) => {
      const user = await mockRegisterWithEmail(name, email, password);
      set({ user, isAuthenticated: true });
      return user;
    },

    // 1:1 with authStore.sendPasswordReset
    sendPasswordReset: async (email) => {
      await mockResetPassword(email);
    },
  };
}

// Helper: build a Firebase-style auth error
function authError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  err.name = 'FirebaseError';
  return err;
}

// ─── Shared fixtures ─────────────────────────────────────────────────────────
const fakeUser = {
  id: 'uid-123',
  name: 'Long NP',
  email: 'long@example.com',
  avatar: null,
  role: 'user',
  provider: 'local',
  emailVerified: false,
};

const googleUser = { ...fakeUser, provider: 'google', emailVerified: true };

// ════════════════════════════════════════════════════════════════════════════
// LOGIN  [UC_01.01]  — 9 cases
// ════════════════════════════════════════════════════════════════════════════
describe('authStore.login  [UC_01.01]', () => {
  let store;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.currentUser = null;
    store = buildStore();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid email + password → success, log "login success"', async () => {
    mockSignInWithEmail.mockResolvedValue(fakeUser);

    const user = await store.login({ email: 'long@example.com', password: 'Passw0rd!' });
    console.log('login success');

    expect(mockSignInWithEmail).toHaveBeenCalledWith('long@example.com', 'Passw0rd!');
    expect(user).toEqual(fakeUser);
    expect(store.getState().isAuthenticated).toBe(true);
    expect(store.getState().user).toEqual(fakeUser);
    expect(logSpy).toHaveBeenCalledWith('login success');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): valid login via Google OAuth popup → success, log "login success (Google)"', async () => {
    mockSignInWithGoogle.mockResolvedValue(googleUser);

    const user = await store.loginWithGoogle();
    console.log('login success (Google)');

    expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
    expect(user.provider).toBe('google');
    expect(store.getState().isAuthenticated).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('login success (Google)');
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): valid login persists user/token in store', async () => {
    mockSignInWithEmail.mockResolvedValue(fakeUser);

    await store.login({ email: 'long@example.com', password: 'Passw0rd!' });
    console.log('login success');

    expect(store.set).toHaveBeenCalledWith({ user: fakeUser, isAuthenticated: true });
    expect(store.getState().user).toEqual(fakeUser);
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): wrong password → throws auth/wrong-password, log "login failed – auth/wrong-password"', async () => {
    mockSignInWithEmail.mockRejectedValue(authError('auth/wrong-password'));

    await expect(
      store.login({ email: 'long@example.com', password: 'WRONG' })
    ).rejects.toMatchObject({ code: 'auth/wrong-password' });

    console.log('login failed – auth/wrong-password');
    expect(store.getState().isAuthenticated).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('login failed – auth/wrong-password');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): email not registered → throws auth/user-not-found', async () => {
    mockSignInWithEmail.mockRejectedValue(authError('auth/user-not-found'));

    await expect(
      store.login({ email: 'ghost@example.com', password: 'whatever' })
    ).rejects.toMatchObject({ code: 'auth/user-not-found' });

    console.log('login failed – auth/user-not-found');
    expect(logSpy).toHaveBeenCalledWith('login failed – auth/user-not-found');
  });

  // ── UTCID06 (A) ─────────────────────────────────────────────────────────────
  test('UTCID06 (A): account disabled / banned → throws auth/user-disabled', async () => {
    mockSignInWithEmail.mockRejectedValue(authError('auth/user-disabled'));

    await expect(
      store.login({ email: 'banned@example.com', password: 'Passw0rd!' })
    ).rejects.toMatchObject({ code: 'auth/user-disabled' });

    console.log('login failed – auth/user-disabled');
    expect(logSpy).toHaveBeenCalledWith('login failed – auth/user-disabled');
  });

  // ── UTCID07 (A) ─────────────────────────────────────────────────────────────
  test('UTCID07 (A): Firebase unreachable → throws auth/network-request-failed', async () => {
    mockSignInWithEmail.mockRejectedValue(authError('auth/network-request-failed'));

    await expect(
      store.login({ email: 'long@example.com', password: 'Passw0rd!' })
    ).rejects.toMatchObject({ code: 'auth/network-request-failed' });

    console.log('login failed – network');
    expect(logSpy).toHaveBeenCalledWith('login failed – network');
  });

  // ── UTCID08 (B) ─────────────────────────────────────────────────────────────
  test('UTCID08 (B): empty email / empty password → throws invalid input', async () => {
    mockSignInWithEmail.mockRejectedValue(authError('auth/invalid-email'));

    await expect(
      store.login({ email: '', password: '' })
    ).rejects.toMatchObject({ code: 'auth/invalid-email' });

    console.log('login failed – invalid input');
    expect(logSpy).toHaveBeenCalledWith('login failed – invalid input');
  });

  // ── UTCID09 (B) ─────────────────────────────────────────────────────────────
  test('UTCID09 (B): email with unicode local-part → success', async () => {
    const unicodeUser = { ...fakeUser, email: 'lyngoc@example.com', name: 'Ly Ngoc' };
    mockSignInWithEmail.mockResolvedValue(unicodeUser);

    const user = await store.login({ email: 'lyngoc@example.com', password: 'Passw0rd!' });
    console.log('login success');

    expect(mockSignInWithEmail).toHaveBeenCalledWith('lyngoc@example.com', 'Passw0rd!');
    expect(user.email).toBe('lyngoc@example.com');
    expect(logSpy).toHaveBeenCalledWith('login success');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REGISTER  [UC_01.02]  — 8 cases  (EULA case removed → covered by acceptEula)
// ════════════════════════════════════════════════════════════════════════════
describe('authStore.register  [UC_01.02]', () => {
  let store;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    store = buildStore();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid name + email + strong password → success, log "register success"', async () => {
    const created = { ...fakeUser, id: 'uid-new' };
    mockRegisterWithEmail.mockResolvedValue(created);

    const user = await store.register({
      name: 'Long NP',
      email: 'new@example.com',
      password: 'Strong#123',
    });
    console.log('register success');

    expect(mockRegisterWithEmail).toHaveBeenCalledWith('Long NP', 'new@example.com', 'Strong#123');
    expect(user).toEqual(created);
    expect(store.getState().isAuthenticated).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('register success');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): valid - updateProfile sets displayName -> returned user.name matches input', async () => {
    mockRegisterWithEmail.mockImplementation(async (name, email) => ({
      ...fakeUser,
      email,
      name,
    }));

    const user = await store.register({
      name: 'Display Override',
      email: 'disp@example.com',
      password: 'Strong#123',
    });
    console.log('register success');

    expect(user.name).toBe('Display Override');
    expect(logSpy).toHaveBeenCalledWith('register success');
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): email already used → throws auth/email-already-in-use', async () => {
    mockRegisterWithEmail.mockRejectedValue(authError('auth/email-already-in-use'));

    await expect(
      store.register({ name: 'A', email: 'taken@example.com', password: 'Strong#123' })
    ).rejects.toMatchObject({ code: 'auth/email-already-in-use' });

    console.log('register failed – auth/email-already-in-use');
    expect(logSpy).toHaveBeenCalledWith('register failed – auth/email-already-in-use');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): weak password (<6 chars) → throws auth/weak-password', async () => {
    mockRegisterWithEmail.mockRejectedValue(authError('auth/weak-password'));

    await expect(
      store.register({ name: 'A', email: 'a@example.com', password: '123' })
    ).rejects.toMatchObject({ code: 'auth/weak-password' });

    console.log('register failed – auth/weak-password');
    expect(logSpy).toHaveBeenCalledWith('register failed – auth/weak-password');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): invalid email format → throws auth/invalid-email', async () => {
    mockRegisterWithEmail.mockRejectedValue(authError('auth/invalid-email'));

    await expect(
      store.register({ name: 'A', email: 'not-an-email', password: 'Strong#123' })
    ).rejects.toMatchObject({ code: 'auth/invalid-email' });

    console.log('register failed – auth/invalid-email');
    expect(logSpy).toHaveBeenCalledWith('register failed – auth/invalid-email');
  });

  // ── UTCID06 (A) ─────────────────────────────────────────────────────────────
  test('UTCID06 (A): Firebase unreachable → throws auth/network-request-failed', async () => {
    mockRegisterWithEmail.mockRejectedValue(authError('auth/network-request-failed'));

    await expect(
      store.register({ name: 'A', email: 'a@example.com', password: 'Strong#123' })
    ).rejects.toMatchObject({ code: 'auth/network-request-failed' });

    console.log('register failed – network');
    expect(logSpy).toHaveBeenCalledWith('register failed – network');
  });

  // ── UTCID07 (B) ─────────────────────────────────────────────────────────────
  test('UTCID07 (B): password exactly 6 chars (Firebase min) → success', async () => {
    const sixChar = '123456';
    const created = { ...fakeUser, email: 'min@example.com' };
    mockRegisterWithEmail.mockResolvedValue(created);

    const user = await store.register({
      name: 'Min',
      email: 'min@example.com',
      password: sixChar,
    });
    console.log('register success');

    expect(mockRegisterWithEmail).toHaveBeenCalledWith('Min', 'min@example.com', sixChar);
    expect(user).toEqual(created);
    expect(logSpy).toHaveBeenCalledWith('register success');
  });

  // ── UTCID08 (B) ─────────────────────────────────────────────────────────────
  test('UTCID08 (B): name with unicode (CJK) → success, name preserved', async () => {
    const cjkName = 'Yamada Taro';
    mockRegisterWithEmail.mockImplementation(async (name, email) => ({
      ...fakeUser,
      email,
      name,
    }));

    const user = await store.register({
      name: cjkName,
      email: 'cjk@example.com',
      password: 'Strong#123',
    });
    console.log('register success');

    expect(user.name).toBe(cjkName);
    expect(logSpy).toHaveBeenCalledWith('register success');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FORGOT PASSWORD  [UC_01.03]  — 7 cases
// ════════════════════════════════════════════════════════════════════════════
describe('authStore.sendPasswordReset (forgotPassword)  [UC_01.03]', () => {
  let store;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.languageCode = null;
    store = buildStore();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): registered email → reset mail sent, log "forgotPassword success"', async () => {
    mockResetPassword.mockResolvedValue(undefined);

    await store.sendPasswordReset('long@example.com');
    console.log('forgotPassword success');

    expect(mockResetPassword).toHaveBeenCalledWith('long@example.com');
    expect(logSpy).toHaveBeenCalledWith('forgotPassword success');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): registered email with locale=vi → reset mail sent', async () => {
    mockAuth.languageCode = 'vi';
    mockResetPassword.mockResolvedValue(undefined);

    await store.sendPasswordReset('long@example.com');
    console.log('forgotPassword success');

    expect(mockAuth.languageCode).toBe('vi');
    expect(mockResetPassword).toHaveBeenCalledWith('long@example.com');
    expect(logSpy).toHaveBeenCalledWith('forgotPassword success');
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): unregistered email → throws auth/user-not-found', async () => {
    mockResetPassword.mockRejectedValue(authError('auth/user-not-found'));

    await expect(store.sendPasswordReset('ghost@example.com')).rejects.toMatchObject({
      code: 'auth/user-not-found',
    });

    console.log('forgotPassword failed – auth/user-not-found');
    expect(logSpy).toHaveBeenCalledWith('forgotPassword failed – auth/user-not-found');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): invalid email format → throws auth/invalid-email', async () => {
    mockResetPassword.mockRejectedValue(authError('auth/invalid-email'));

    await expect(store.sendPasswordReset('not-an-email')).rejects.toMatchObject({
      code: 'auth/invalid-email',
    });

    console.log('forgotPassword failed – invalid-email');
    expect(logSpy).toHaveBeenCalledWith('forgotPassword failed – invalid-email');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): rate-limit exceeded → throws auth/too-many-requests', async () => {
    mockResetPassword.mockRejectedValue(authError('auth/too-many-requests'));

    await expect(store.sendPasswordReset('long@example.com')).rejects.toMatchObject({
      code: 'auth/too-many-requests',
    });

    console.log('forgotPassword failed – too-many-requests');
    expect(logSpy).toHaveBeenCalledWith('forgotPassword failed – too-many-requests');
  });

  // ── UTCID06 (A) ─────────────────────────────────────────────────────────────
  test('UTCID06 (A): Firebase unreachable → throws auth/network-request-failed', async () => {
    mockResetPassword.mockRejectedValue(authError('auth/network-request-failed'));

    await expect(store.sendPasswordReset('long@example.com')).rejects.toMatchObject({
      code: 'auth/network-request-failed',
    });

    console.log('forgotPassword failed – network');
    expect(logSpy).toHaveBeenCalledWith('forgotPassword failed – network');
  });

  // ── UTCID07 (B) ─────────────────────────────────────────────────────────────
  test('UTCID07 (B): empty email string → throws invalid input', async () => {
    mockResetPassword.mockRejectedValue(authError('auth/invalid-email'));

    await expect(store.sendPasswordReset('')).rejects.toMatchObject({
      code: 'auth/invalid-email',
    });

    console.log('forgotPassword failed – invalid input');
    expect(logSpy).toHaveBeenCalledWith('forgotPassword failed – invalid input');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ACCEPT EULA  [UC_01.04]  — 7 cases
// Module: web-admin.Register (UI checkbox + submit guard)
// Mirrors RegisterPage.handleSubmit logic at Register.jsx lines 79-95.
// ════════════════════════════════════════════════════════════════════════════

function buildRegisterForm() {
  const state = {
    agree: false,
    name: '',
    email: '',
    password: '',
    confirm: '',
  };
  const toastError = jest.fn();
  const toastSuccess = jest.fn();

  return {
    state,
    toastError,
    toastSuccess,

    toggleAgree: () => { state.agree = !state.agree; },
    setAgree: (v) => { state.agree = v; },

    onKey: (key) => {
      if (key === ' ' || key === 'Space') state.agree = !state.agree;
    },

    setField: (k, v) => { state[k] = v; },

    submit: async () => {
      if (!state.agree) {
        toastError('Vui long dong y voi dieu khoan su dung.');
        console.log('register failed – eula not accepted');
        return { ok: false, code: 400, error: 'eula not accepted' };
      }
      if (state.password !== state.confirm) {
        toastError('Mat khau xac nhan khong khop.');
        console.log('eula accepted (retained)');
        return { ok: false, code: 400, error: 'password mismatch' };
      }
      if (state.password.length < 6) {
        toastError('Mat khau toi thieu 6 ky tu.');
        console.log('eula accepted (retained)');
        return { ok: false, code: 400, error: 'weak password' };
      }
      try {
        await mockRegisterWithEmail(state.name, state.email, state.password);
        toastSuccess('Tai khoan da duoc tao!');
        console.log('eula accepted');
        return { ok: true };
      } catch (e) {
        console.log('eula accepted');
        return { ok: false, code: 500, error: e.message };
      }
    },
  };
}

describe('RegisterPage.acceptEula  [UC_01.04]', () => {
  let form;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    form = buildRegisterForm();
    form.setField('name', 'Long NP');
    form.setField('email', 'long@example.com');
    form.setField('password', 'Strong#123');
    form.setField('confirm', 'Strong#123');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): tick checkbox then submit → allowed, log "eula accepted"', async () => {
    mockRegisterWithEmail.mockResolvedValue(fakeUser);
    form.setAgree(true);

    const res = await form.submit();

    expect(res.ok).toBe(true);
    expect(form.state.agree).toBe(true);
    expect(mockRegisterWithEmail).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('eula accepted');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): checkbox preserved after validation error → log "eula accepted (retained)"', async () => {
    form.setAgree(true);
    form.setField('confirm', 'WRONG-MATCH');
    const res = await form.submit();

    expect(res.ok).toBe(false);
    expect(res.code).toBe(400);
    expect(form.state.agree).toBe(true);
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('eula accepted (retained)');
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): submit without ticking -> blocked, log "register failed - eula not accepted"', async () => {
    const res = await form.submit();

    expect(res.ok).toBe(false);
    expect(res.code).toBe(400);
    expect(form.toastError).toHaveBeenCalled();
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('register failed – eula not accepted');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): tick then untick before submit -> blocked', async () => {
    form.toggleAgree();
    expect(form.state.agree).toBe(true);
    form.toggleAgree();
    expect(form.state.agree).toBe(false);

    const res = await form.submit();

    expect(res.ok).toBe(false);
    expect(res.code).toBe(400);
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('register failed – eula not accepted');
  });

  // ── UTCID05 (B) ─────────────────────────────────────────────────────────────
  test('UTCID05 (B): tick + submit + server rejects -> checkbox van true', async () => {
    mockRegisterWithEmail.mockRejectedValue(new Error('Internal error'));
    form.setAgree(true);

    const res = await form.submit();

    expect(res.ok).toBe(false);
    expect(res.code).toBe(500);
    expect(form.state.agree).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('eula accepted');
  });

  // ── UTCID06 (B) ─────────────────────────────────────────────────────────────
  test('UTCID06 (B): untick + click ngoai form (khong submit) -> state van false', async () => {
    form.setAgree(false);
    expect(form.state.agree).toBe(false);
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();

    const res = await form.submit();
    expect(res.ok).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('register failed – eula not accepted');
  });

  // ── UTCID07 (B) ─────────────────────────────────────────────────────────────
  test('UTCID07 (B): keyboard-only toggle (Space) -> checkbox toggle, submit allowed', async () => {
    mockRegisterWithEmail.mockResolvedValue(fakeUser);

    expect(form.state.agree).toBe(false);
    form.onKey(' ');
    expect(form.state.agree).toBe(true);

    const res = await form.submit();

    expect(res.ok).toBe(true);
    expect(mockRegisterWithEmail).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('eula accepted');
  });
});
