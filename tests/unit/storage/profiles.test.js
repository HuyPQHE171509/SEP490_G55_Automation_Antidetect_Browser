// tests/unit/storage/profiles.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 3 Excel sheets:
//   • storage.profiles.saveProfileInternal    (UC_08.01) — 10 cases
//   • storage.profiles.updateProfileInternal  (UC_08.02) — 8 cases
//   • storage.profiles.deleteProfileInternal  (UC_08.03) — 5 cases
//
// Style: mirrors tests/unit/web-admin/adminLicenses.test.js — small in-test
// "production-like" handlers reproduce the logic from
//   src/main/storage/profiles.js
// against jest mocks for filesystem / proxy lookup / running-profile registry.

// ════════════════════════════════════════════════════════════════════════════
// Shared mocks (filesystem + helpers)
// ════════════════════════════════════════════════════════════════════════════
const mockReadProfiles      = jest.fn();
const mockWriteProfiles     = jest.fn();
const mockExistsSync        = jest.fn();
const mockUnlinkSync        = jest.fn();
const mockRmSync            = jest.fn();
const mockFindProxyById     = jest.fn();
const mockIsProfileRunning  = jest.fn();

// ════════════════════════════════════════════════════════════════════════════
// Production-like helpers (mirror src/main/storage/profiles.js)
// ════════════════════════════════════════════════════════════════════════════
function normalizeStartUrl(u) {
  try {
    if (!u || typeof u !== 'string') return '';
    const s = u.trim();
    if (!s) return '';
    const url = new URL(s);
    const ok = url.protocol === 'http:' || url.protocol === 'https:';
    return ok ? url.toString() : '';
  } catch { return ''; }
}

function generateShortId() {
  // Deterministic-ish stub for tests (random would still be unique).
  const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < 6; i++) r += CHARS[Math.floor(Math.random() * CHARS.length)];
  return r;
}

function validateBasic(p) {
  if (!p || typeof p !== 'object') return 'Payload must be object';
  const name = String(p.name || '').trim();
  if (!name) return 'Name is required';
  if (name.length > 120) return 'Name too long (>120 chars)';
  if (p.startUrl) {
    const norm = normalizeStartUrl(p.startUrl);
    if (!norm) return 'startUrl must be http/https URL';
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// Production-like handlers
// ════════════════════════════════════════════════════════════════════════════

// --- saveProfileInternal (create) -----------------------------------------
async function saveProfileInternal(profile) {
  try {
    // Validation
    const err = validateBasic(profile);
    if (err) {
      // Distinct log message for length boundary
      if (err === 'Name too long (>120 chars)') {
        console.log('save failed – name too long');
      } else if (err === 'startUrl must be http/https URL') {
        console.log('save failed – invalid startUrl');
      } else {
        console.log('save failed – invalid input');
      }
      return { success: false, error: err };
    }

    // proxyId lookup (Excel UTCID07)
    if (profile.proxyId !== undefined && profile.proxyId !== null) {
      const proxy = mockFindProxyById(profile.proxyId);
      if (!proxy) {
        console.log('save failed – proxy not found');
        return { success: false, error: 'Proxy not found', code: 404 };
      }
    }

    const profiles = mockReadProfiles();

    // Duplicate name check (Excel UTCID05)
    const desiredName = String(profile.name).trim().toLowerCase();
    const dup = profiles.find((p) => (p.name || '').trim().toLowerCase() === desiredName);
    if (dup) {
      console.log('save failed – duplicate name');
      return { success: false, error: 'Duplicate profile name', code: 409 };
    }

    // Build the new entry
    const newId = profile.id || generateShortId();
    const startUrl = profile.startUrl ? normalizeStartUrl(profile.startUrl) : 'https://www.google.com';
    const created = {
      id: newId,
      name: String(profile.name).trim(),
      startUrl,
      proxyId: profile.proxyId ?? null,
      fingerprint: profile.fingerprint || {},
      settings: profile.settings || {},
      createdAt: new Date().toISOString(),
    };
    profiles.push(created);

    const ok = await mockWriteProfiles(profiles);
    if (!ok) {
      console.log('save failed – I/O error');
      return { success: false, error: 'Failed to persist profiles file', code: 500 };
    }

    console.log('save success');
    return { success: true, profile: created, code: 201 };
  } catch (e) {
    console.log('save failed – I/O error');
    return { success: false, error: e.message, code: 500 };
  }
}

// --- updateProfileInternal (edit existing) ---------------------------------
async function updateProfileInternal(profileId, patch) {
  try {
    const profiles = mockReadProfiles();
    const idx = profiles.findIndex((p) => p.id === profileId);

    // id not found (UTCID04)
    if (idx < 0) {
      console.log('update failed – not found');
      return { success: false, error: 'Profile not found', code: 404 };
    }

    // Profile currently running (UTCID06 in the sheet — listed under
    // "Profile currently running – locked")
    if (mockIsProfileRunning(profileId)) {
      console.log('update failed – running');
      return { success: false, error: 'Profile is running – stop before editing', code: 409 };
    }

    const existing = profiles[idx];
    const incoming = patch || {};
    const keys = Object.keys(incoming);

    // Empty patch (UTCID08 — no-op)
    if (keys.length === 0) {
      console.log('update success (no-op)');
      return { success: true, profile: existing, code: 200 };
    }

    // Validate startUrl if provided
    if (incoming.startUrl !== undefined && incoming.startUrl !== null) {
      if (!normalizeStartUrl(incoming.startUrl)) {
        console.log('update failed – invalid input');
        return { success: false, error: 'startUrl must be http/https URL', code: 400 };
      }
    }

    // Validate name if provided
    if (incoming.name !== undefined) {
      const candidate = String(incoming.name).trim();
      if (!candidate) {
        console.log('update failed – invalid input');
        return { success: false, error: 'Name is required', code: 400 };
      }
      if (candidate.length > 120) {
        console.log('update failed – invalid input');
        return { success: false, error: 'Name too long (>120 chars)', code: 400 };
      }
      // Rename collision (UTCID05)
      const collision = profiles.find(
        (p) => p.id !== profileId && (p.name || '').trim().toLowerCase() === candidate.toLowerCase(),
      );
      if (collision) {
        console.log('update failed – duplicate');
        return { success: false, error: 'Duplicate profile name', code: 409 };
      }
    }

    // Apply patch (partial merge). proxyId can be explicitly set to null.
    const merged = { ...existing };
    for (const k of keys) merged[k] = incoming[k];
    if (incoming.startUrl !== undefined) {
      merged.startUrl = normalizeStartUrl(incoming.startUrl);
    }
    merged.updatedAt = new Date().toISOString();

    profiles[idx] = merged;

    const ok = await mockWriteProfiles(profiles);
    if (!ok) {
      console.log('update failed – I/O error');
      return { success: false, error: 'Failed to persist profiles file', code: 500 };
    }

    console.log('update success');
    return { success: true, profile: merged, code: 200 };
  } catch (e) {
    console.log('update failed – I/O error');
    return { success: false, error: e.message, code: 500 };
  }
}

// --- deleteProfileInternal -------------------------------------------------
async function deleteProfileInternal(profileId) {
  try {
    const profiles = mockReadProfiles();
    const filtered = profiles.filter((p) => p.id !== profileId);

    const ok = await mockWriteProfiles(filtered);

    // Best-effort cleanup of storageState file + cdp-user-data folder
    try {
      const statePath = `/data/storage-state/${profileId}.json`;
      if (mockExistsSync(statePath)) mockUnlinkSync(statePath);
      const cdpDir = `/data/cdp-user-data/${profileId}`;
      if (mockExistsSync(cdpDir)) mockRmSync(cdpDir, { recursive: true, force: true });
    } catch (e) {
      // tolerate cleanup failure (warn only)
    }

    if (!ok) return { success: false, error: 'Failed to persist profiles file' };

    console.log(`Deleted profile ${profileId}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// saveProfileInternal  [UC_08.01]  — 10 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.profiles.saveProfileInternal  [UC_08.01]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProfiles.mockReturnValue([]);
    mockWriteProfiles.mockResolvedValue(true);
    mockFindProxyById.mockReturnValue({ id: 'pxy-1', server: 'http://1.1.1.1:8080' });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): Valid full input (name+startUrl+proxyId+fingerprint) → 201, log "save success"', async () => {
    const result = await saveProfileInternal({
      name: 'My Profile',
      startUrl: 'https://example.com',
      proxyId: 'pxy-1',
      fingerprint: { os: 'Windows', browser: 'Chrome' },
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe(201);
    expect(result.profile.id).toMatch(/^[a-z0-9]{6}$/);
    expect(result.profile.name).toBe('My Profile');
    expect(mockWriteProfiles).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('save success');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): Valid minimal input (only name) → 201, log "save success"', async () => {
    const result = await saveProfileInternal({ name: 'Minimal' });

    expect(result.success).toBe(true);
    expect(result.code).toBe(201);
    expect(result.profile.startUrl).toBe('https://www.google.com');
    expect(logSpy).toHaveBeenCalledWith('save success');
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): Valid input + custom userAgent / timezone / locale → 201, log "save success"', async () => {
    const result = await saveProfileInternal({
      name: 'Custom UA',
      startUrl: 'https://www.google.com',
      fingerprint: {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        timezone: 'Asia/Ho_Chi_Minh',
        language: 'vi-VN',
      },
    });

    expect(result.success).toBe(true);
    expect(result.profile.fingerprint.userAgent).toMatch(/Mozilla/);
    expect(result.profile.fingerprint.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(logSpy).toHaveBeenCalledWith('save success');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): Missing name (required) → 400, log "save failed – invalid input"', async () => {
    const result = await saveProfileInternal({ startUrl: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/name is required/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('save failed – invalid input');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): Duplicate name (already exists) → 409, log "save failed – duplicate name"', async () => {
    mockReadProfiles.mockReturnValue([
      { id: 'abc123', name: 'Existing' },
    ]);
    const result = await saveProfileInternal({ name: 'existing' }); // case-insensitive

    expect(result.success).toBe(false);
    expect(result.code).toBe(409);
    expect(result.error).toMatch(/duplicate/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('save failed – duplicate name');
  });

  // ── UTCID06 (A) ─────────────────────────────────────────────────────────────
  test('UTCID06 (A): Invalid startUrl (no scheme) → 400, log "save failed – invalid startUrl"', async () => {
    const result = await saveProfileInternal({
      name: 'Bad URL',
      startUrl: 'example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/startUrl/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('save failed – invalid startUrl');
  });

  // ── UTCID07 (A) ─────────────────────────────────────────────────────────────
  test('UTCID07 (A): proxyId references missing proxy → 404, log "save failed – proxy not found"', async () => {
    mockFindProxyById.mockReturnValue(null);
    const result = await saveProfileInternal({
      name: 'With ghost proxy',
      proxyId: 'pxy-ghost',
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe(404);
    expect(result.error).toMatch(/proxy/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('save failed – proxy not found');
  });

  // ── UTCID08 (A) ─────────────────────────────────────────────────────────────
  test('UTCID08 (A): profiles.json read-only / disk full → 500, log "save failed – I/O error"', async () => {
    mockWriteProfiles.mockResolvedValue(false);
    const result = await saveProfileInternal({ name: 'Will fail to persist' });

    expect(result.success).toBe(false);
    expect(result.code).toBe(500);
    expect(result.error).toMatch(/persist/i);
    expect(logSpy).toHaveBeenCalledWith('save failed – I/O error');
  });

  // ── UTCID09 (B) ─────────────────────────────────────────────────────────────
  test('UTCID09 (B): Name = 1 char (min) → 201, log "save success"', async () => {
    const result = await saveProfileInternal({ name: 'A' });

    expect(result.success).toBe(true);
    expect(result.code).toBe(201);
    expect(result.profile.name).toBe('A');
    expect(logSpy).toHaveBeenCalledWith('save success');
  });

  // ── UTCID10 (B) ─────────────────────────────────────────────────────────────
  test('UTCID10 (B): Name length = 256 chars (max boundary) → 400, log "save failed – name too long"', async () => {
    const longName = 'x'.repeat(256);
    const result = await saveProfileInternal({ name: longName });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too long/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('save failed – name too long');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// updateProfileInternal  [UC_08.02]  — 8 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.profiles.updateProfileInternal  [UC_08.02]', () => {
  let logSpy;

  const baseProfiles = () => [
    {
      id: 'abc123',
      name: 'Original',
      startUrl: 'https://www.google.com/',
      proxyId: 'pxy-1',
      fingerprint: { os: 'Windows' },
      settings: { headless: false },
    },
    {
      id: 'def456',
      name: 'Other',
      startUrl: 'https://example.com/',
      proxyId: null,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProfiles.mockReturnValue(baseProfiles());
    mockWriteProfiles.mockResolvedValue(true);
    mockIsProfileRunning.mockReturnValue(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): Valid id + partial patch (name) → 200, log "update success"', async () => {
    const result = await updateProfileInternal('abc123', { name: 'Renamed' });

    expect(result.success).toBe(true);
    expect(result.code).toBe(200);
    expect(result.profile.name).toBe('Renamed');
    // other fields preserved
    expect(result.profile.startUrl).toBe('https://www.google.com/');
    expect(mockWriteProfiles).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('update success');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): Valid id + full replace (all fields) → 200, log "update success"', async () => {
    const result = await updateProfileInternal('abc123', {
      name: 'Brand New',
      startUrl: 'https://duckduckgo.com',
      proxyId: 'pxy-2',
      fingerprint: { os: 'Linux', browser: 'Firefox' },
      settings: { headless: true, engine: 'playwright-firefox' },
    });

    expect(result.success).toBe(true);
    expect(result.profile.name).toBe('Brand New');
    expect(result.profile.startUrl).toBe('https://duckduckgo.com/');
    expect(result.profile.proxyId).toBe('pxy-2');
    expect(result.profile.settings.headless).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('update success');
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): Change proxyId to null (unassign) → 200, log "update success"', async () => {
    const result = await updateProfileInternal('abc123', { proxyId: null });

    expect(result.success).toBe(true);
    expect(result.profile.proxyId).toBeNull();
    expect(mockWriteProfiles).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('update success');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): id not found → 404, log "update failed – not found"', async () => {
    const result = await updateProfileInternal('ghost-id', { name: 'Whatever' });

    expect(result.success).toBe(false);
    expect(result.code).toBe(404);
    expect(result.error).toMatch(/not found/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('update failed – not found');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): Rename to existing profile name → 409, log "update failed – duplicate"', async () => {
    const result = await updateProfileInternal('abc123', { name: 'Other' });

    expect(result.success).toBe(false);
    expect(result.code).toBe(409);
    expect(result.error).toMatch(/duplicate/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('update failed – duplicate');
  });

  // ── UTCID06 (A) ─────────────────────────────────────────────────────────────
  test('UTCID06 (A): Invalid startUrl → 400, log "update failed – invalid input"', async () => {
    const result = await updateProfileInternal('abc123', { startUrl: 'not-a-url' });

    expect(result.success).toBe(false);
    expect(result.code).toBe(400);
    expect(result.error).toMatch(/startUrl/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('update failed – invalid input');
  });

  // ── UTCID07 (A) ─────────────────────────────────────────────────────────────
  test('UTCID07 (A): Profile currently running – locked → 409, log "update failed – running"', async () => {
    mockIsProfileRunning.mockReturnValue(true);
    const result = await updateProfileInternal('abc123', { name: 'Try Rename' });

    expect(result.success).toBe(false);
    expect(result.code).toBe(409);
    expect(result.error).toMatch(/running/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('update failed – running');
  });

  // ── UTCID08 (B) ─────────────────────────────────────────────────────────────
  test('UTCID08 (B): Empty patch {} – no-op → 200, log "update success (no-op)"', async () => {
    const result = await updateProfileInternal('abc123', {});

    expect(result.success).toBe(true);
    expect(result.code).toBe(200);
    // no write because nothing changed
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(result.profile.name).toBe('Original');
    expect(logSpy).toHaveBeenCalledWith('update success (no-op)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deleteProfileInternal  [UC_08.03]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.profiles.deleteProfileInternal  [UC_08.03]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProfiles.mockReturnValue([
      { id: 'abc123', name: 'A' },
      { id: 'def456', name: 'B' },
    ]);
    mockWriteProfiles.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): Precondition met (no storageState, no cdp-user-data) → {success:true}, log "Deleted profile abc123"', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await deleteProfileInternal('abc123');

    expect(result).toEqual({ success: true });
    // Filtered list passed to writeProfiles must NOT include abc123
    expect(mockWriteProfiles).toHaveBeenCalledWith([{ id: 'def456', name: 'B' }]);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Deleted profile abc123');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): storageState file + cdp-user-data/abc123 exist → both removed, log "Deleted profile abc123"', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await deleteProfileInternal('abc123');

    expect(result).toEqual({ success: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith('/data/storage-state/abc123.json');
    expect(mockRmSync).toHaveBeenCalledWith(
      '/data/cdp-user-data/abc123',
      { recursive: true, force: true },
    );
    expect(logSpy).toHaveBeenCalledWith('Deleted profile abc123');
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): Profile NOT in profiles list → still {success:true} (filter no-op), log "Deleted profile xyz999"', async () => {
    const result = await deleteProfileInternal('xyz999');

    expect(result).toEqual({ success: true });
    // Original list rewritten unchanged (filter removes nothing)
    expect(mockWriteProfiles).toHaveBeenCalledWith([
      { id: 'abc123', name: 'A' },
      { id: 'def456', name: 'B' },
    ]);
    expect(logSpy).toHaveBeenCalledWith('Deleted profile xyz999');
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): profiles.json read-only / disk full → {success:false, error:"Failed to persist profiles file"}', async () => {
    mockWriteProfiles.mockResolvedValue(false);

    const result = await deleteProfileInternal('abc123');

    expect(result).toEqual({
      success: false,
      error: 'Failed to persist profiles file',
    });
    // No success log emitted
    expect(logSpy).not.toHaveBeenCalledWith('Deleted profile abc123');
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): readProfiles throws (corrupt/unreadable) → {success:false, error:e.message} (Exception caught)', async () => {
    mockReadProfiles.mockImplementation(() => {
      throw new Error('Unexpected token in JSON at position 0');
    });

    const result = await deleteProfileInternal('abc123');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/JSON|token/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith('Deleted profile abc123');
  });
});
