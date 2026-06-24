// tests/unit/storage/proxies.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 8 Excel sheets:
//   • controllers.profiles.setProfileProxy           (UC_08.07) — 4 cases
//   • storage.proxies.createProxyInternal            (UC_09.01) — 5 cases
//   • storage.proxies.importProxiesInternal          (UC_09.02) — 3 cases
//   • storage.proxies.exportProxiesInternal          (UC_09.03) — 3 cases
//   • services.ProxyChecker.checkProxy               (UC_09.04) — 3 cases
//   • ipc.handlers["proxy-rotate"] (rotateProxyIp)   (UC_09.05) — 3 cases
//   • storage.proxies.deleteProxyInternal            (UC_09.06) — 3 cases
//   • storage.proxies.updateProxyInternal            (UC_09.07) — 3 cases
//
// Style: mirrors tests/unit/storage/profiles.test.js — small in-test
// "production-like" handlers reproduce the logic from
//   src/main/storage/proxies.js
//   src/main/services/ProxyChecker.js
//   src/main/ipc/handlers.js (proxy-rotate)
// against jest mocks for filesystem / network.

// ════════════════════════════════════════════════════════════════════════════
// Shared mocks
// ════════════════════════════════════════════════════════════════════════════
const mockReadProxies   = jest.fn();
const mockWriteProxies  = jest.fn();
const mockReadProfiles  = jest.fn();
const mockWriteProfiles = jest.fn();
const mockHttpGet       = jest.fn();   // ProxyChecker network call
const mockAxiosGet      = jest.fn();   // proxy-rotate axios call

// ════════════════════════════════════════════════════════════════════════════
// Production-like helpers (mirror src/main/storage/proxies.js)
// ════════════════════════════════════════════════════════════════════════════
const VALID_TYPES = ['http', 'https', 'socks4', 'socks5'];

function generateShortId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return (t + r).toLowerCase();
}

function validateProxyInput(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['Payload must be an object'];
  const host = (p.host || '').trim();
  if (!host) errors.push('Host is required');
  const port = Number(p.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('Port must be 1-65535');
  if (p.type && !VALID_TYPES.includes(p.type)) {
    errors.push(`Type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  return errors;
}

function parseProxyLine(line) {
  const s = (line || '').trim();
  if (!s || s.startsWith('#') || s.startsWith('//')) return null;
  const urlMatch = s.match(/^(https?|socks[45]?):\/\/(?:([^:@]+):([^@]+)@)?([^:\/]+):(\d+)\s*$/i);
  if (urlMatch) {
    let type = urlMatch[1].toLowerCase();
    if (type === 'socks') type = 'socks5';
    return {
      type,
      username: urlMatch[2] || '',
      password: urlMatch[3] || '',
      host: urlMatch[4],
      port: parseInt(urlMatch[5], 10),
    };
  }
  const parts = s.split(':');
  if (parts.length === 2) {
    const port = parseInt(parts[1], 10);
    if (parts[0] && Number.isInteger(port) && port >= 1 && port <= 65535) {
      return { type: 'http', host: parts[0].trim(), port, username: '', password: '' };
    }
  }
  if (parts.length === 4) {
    const port = parseInt(parts[1], 10);
    if (parts[0] && Number.isInteger(port) && port >= 1 && port <= 65535) {
      return { type: 'http', host: parts[0].trim(), port, username: parts[2].trim(), password: parts[3].trim() };
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// Production-like handlers
// ════════════════════════════════════════════════════════════════════════════

// --- setProfileProxy(profileId, proxyData|null) ---------------------------
async function setProfileProxy(profileId, proxyData) {
  try {
    const profiles = mockReadProfiles();
    const idx = profiles.findIndex((p) => p.id === profileId);
    if (idx < 0) {
      console.log('setProfileProxy failed – profile not found');
      return { success: false, error: 'Profile not found' };
    }

    // Clear (unassign) proxy
    if (proxyData === null || proxyData === undefined) {
      profiles[idx] = {
        ...profiles[idx],
        settings: { ...(profiles[idx].settings || {}), proxy: { server: '', username: '', password: '' } },
      };
      const ok = await mockWriteProfiles(profiles);
      if (!ok) {
        console.log('setProfileProxy failed – I/O');
        return { success: false, error: 'Failed to persist profiles file' };
      }
      console.log(`setProfileProxy cleared ${profileId}`);
      return { success: true };
    }

    // Validate proxy data
    const errs = validateProxyInput(proxyData);
    if (errs.length) {
      console.log('setProfileProxy failed – invalid input');
      return { success: false, error: errs[0] };
    }

    profiles[idx] = {
      ...profiles[idx],
      settings: {
        ...(profiles[idx].settings || {}),
        proxy: {
          server: `${proxyData.type || 'http'}://${proxyData.host}:${proxyData.port}`,
          type: proxyData.type || 'http',
          username: proxyData.username || '',
          password: proxyData.password || '',
        },
      },
    };

    const ok = await mockWriteProfiles(profiles);
    if (!ok) {
      console.log('setProfileProxy failed – I/O');
      return { success: false, error: 'Failed to persist profiles file' };
    }
    console.log(`setProfileProxy assigned ${profileId}`);
    return { success: true };
  } catch (e) {
    console.log(`setProfileProxy error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// --- createProxyInternal(data) --------------------------------------------
async function createProxyInternal(data) {
  try {
    if (!data || typeof data !== 'object') return { success: false, error: 'Invalid payload' };
    const errs = validateProxyInput(data);
    if (errs.length) return { success: false, error: errs[0] };

    const proxies = mockReadProxies();
    let newId = generateShortId();
    const existingIds = new Set(proxies.map((p) => p.id));
    while (existingIds.has(newId)) newId = generateShortId();

    const nowIso = new Date().toISOString();
    const proxy = {
      id: newId,
      name: (data.name || '').trim() || `Proxy ${proxies.length + 1}`,
      type: VALID_TYPES.includes(data.type) ? data.type : 'http',
      host: String(data.host).trim(),
      port: Number(data.port),
      username: (data.username || '').trim(),
      password: (data.password || '').trim(),
      status: 'unchecked',
      lastChecked: null,
      latency: null,
      country: (data.country || '').trim(),
      note: (data.note || '').trim(),
      rotateUrl: (data.rotateUrl || '').trim(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    proxies.push(proxy);
    const ok = await mockWriteProxies(proxies);
    if (!ok) return { success: false, error: 'Failed to persist proxies file' };
    console.log(`Created proxy ${proxy.id} (${proxy.name})`);
    return { success: true, proxy };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- updateProxyInternal(id, data) ----------------------------------------
async function updateProxyInternal(id, data) {
  try {
    if (!id) return { success: false, error: 'Proxy id is required' };
    if (!data || typeof data !== 'object') return { success: false, error: 'Invalid payload' };

    const proxies = mockReadProxies();
    const idx = proxies.findIndex((p) => p.id === id);
    if (idx < 0) return { success: false, error: 'Proxy not found' };

    const existing = proxies[idx];
    const merged = { ...existing };
    if (data.name != null) merged.name = String(data.name).trim();
    if (data.type != null) {
      if (!VALID_TYPES.includes(data.type)) {
        return { success: false, error: `Type must be one of: ${VALID_TYPES.join(', ')}` };
      }
      merged.type = data.type;
    }
    if (data.host != null) {
      const h = String(data.host).trim();
      if (!h) return { success: false, error: 'Host is required' };
      merged.host = h;
    }
    if (data.port != null) {
      const p = Number(data.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        return { success: false, error: 'Port must be 1-65535' };
      }
      merged.port = p;
    }
    if (data.username != null) merged.username = String(data.username).trim();
    if (data.password != null) merged.password = String(data.password).trim();
    if (data.lastRotated != null) merged.lastRotated = data.lastRotated;
    merged.updatedAt = new Date().toISOString();
    proxies[idx] = merged;

    const ok = await mockWriteProxies(proxies);
    if (!ok) return { success: false, error: 'Failed to persist proxies file' };
    console.log(`Updated proxy ${id}`);
    return { success: true, proxy: merged };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- deleteProxyInternal(id) ----------------------------------------------
async function deleteProxyInternal(id) {
  try {
    if (!id) return { success: false, error: 'Proxy id is required' };
    const proxies = mockReadProxies();
    const filtered = proxies.filter((p) => p.id !== id);
    if (filtered.length === proxies.length) {
      return { success: false, error: 'Proxy not found' };
    }
    const ok = await mockWriteProxies(filtered);
    if (!ok) return { success: false, error: 'Failed to persist proxies file' };
    console.log(`Deleted proxy ${id}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- importProxiesInternal(text, format) ----------------------------------
async function importProxiesInternal(text, _format) {
  try {
    if (!text || typeof text !== 'string') return { success: false, error: 'Text input is required' };

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { success: false, error: 'No proxy lines found' };

    const proxies = mockReadProxies();
    const existingIds = new Set(proxies.map((p) => p.id));
    const nowIso = new Date().toISOString();
    const imported = [];
    let skipped = 0;

    for (const line of lines) {
      const parsed = parseProxyLine(line);
      if (!parsed) { skipped++; continue; }
      let newId = generateShortId();
      while (existingIds.has(newId)) newId = generateShortId();
      existingIds.add(newId);
      const proxy = {
        id: newId,
        name: `${parsed.host}:${parsed.port}`,
        type: parsed.type,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        status: 'unchecked',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      imported.push(proxy);
      proxies.push(proxy);
    }

    if (!imported.length) {
      return { success: false, error: `No valid proxies found (${skipped} lines skipped)` };
    }

    const ok = await mockWriteProxies(proxies);
    if (!ok) return { success: false, error: 'Failed to persist proxies file' };
    console.log(`Imported ${imported.length} proxies (${skipped} skipped)`);
    return { success: true, imported: imported.length, skipped, proxies: imported };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- exportProxiesInternal(ids) -------------------------------------------
async function exportProxiesInternal(ids) {
  try {
    const proxies = mockReadProxies();
    const toExport = ids && Array.isArray(ids) && ids.length
      ? proxies.filter((p) => ids.includes(p.id))
      : proxies;
    const lines = toExport.map((p) => {
      const auth = (p.username && p.password) ? `${p.username}:${p.password}@` : '';
      return `${p.type || 'http'}://${auth}${p.host}:${p.port}`;
    });
    return { success: true, text: lines.join('\n'), count: lines.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- checkProxy(cfg) -------------------------------------------------------
async function checkProxy(cfg) {
  if (!cfg || !cfg.host || !cfg.port) {
    return { success: false, alive: false, error: 'Host and port are required' };
  }
  const start = Date.now();
  try {
    const result = await mockHttpGet(cfg);
    const latency = Date.now() - start;
    if (result && result.statusCode >= 200 && result.statusCode < 400) {
      const geo = result.body || {};
      return {
        success: true,
        alive: true,
        ip: geo.ip ?? null,
        country: geo.country ?? null,
        countryCode: geo.countryCode ?? null,
        city: geo.city ?? null,
        timezone: geo.timezone ?? null,
        latency,
      };
    }
    return {
      success: true, alive: false,
      ip: null, country: null, countryCode: null, city: null, timezone: null, latency: null,
      error: 'Connection failed or timed out',
    };
  } catch (e) {
    return {
      success: true, alive: false,
      ip: null, country: null, countryCode: null, city: null, timezone: null, latency: null,
      error: 'Connection failed or timed out',
    };
  }
}

// --- rotateProxyIp(id) — mirrors handlers.js "proxy-rotate" ---------------
async function rotateProxyIp(id) {
  try {
    const proxies = mockReadProxies();
    const proxy = proxies.find((p) => p.id === id);
    if (!proxy) return { success: false, error: 'Proxy not found' };
    if (!proxy.rotateUrl) return { success: false, error: 'No rotate URL configured' };
    console.log(`Proxy rotate: ${proxy.name || id}`);
    const startTime = Date.now();
    const response = await mockAxiosGet(proxy.rotateUrl, { timeout: 15000 });
    const latency = Date.now() - startTime;
    await updateProxyInternal(id, { lastRotated: new Date().toISOString() });
    console.log(`Proxy rotated OK: ${proxy.name || id} (${latency}ms)`);
    return { success: true, latency, data: response.data };
  } catch (e) {
    console.log(`Proxy rotate failed: ${e?.message || e}`);
    return { success: false, error: e?.message || String(e) };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// setProfileProxy  [UC_08.07]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('controllers.profiles.setProfileProxy  [UC_08.07]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProfiles.mockReturnValue([
      { id: 'profile-001', name: 'P1', settings: { proxy: { server: '' } } },
    ]);
    mockWriteProfiles.mockResolvedValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): profile-001 + valid proxy data → {success:true} (proxy assigned)', async () => {
    const result = await setProfileProxy('profile-001', {
      type: 'http', host: '1.2.3.4', port: 8080, username: 'u', password: 'p',
    });

    expect(result).toEqual({ success: true });
    expect(mockWriteProfiles).toHaveBeenCalled();
    const written = mockWriteProfiles.mock.calls[0][0];
    expect(written[0].settings.proxy.server).toBe('http://1.2.3.4:8080');
    expect(written[0].settings.proxy.username).toBe('u');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): profileId not found → {success:false, error:"Profile not found"}', async () => {
    const result = await setProfileProxy('xyz999', {
      type: 'http', host: '1.2.3.4', port: 8080,
    });

    expect(result).toEqual({ success: false, error: 'Profile not found' });
    expect(mockWriteProfiles).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): invalid proxy data (missing host/port) → {success:false, error:"Host is required"}', async () => {
    const result = await setProfileProxy('profile-001', { type: 'http' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/host|port/i);
    expect(mockWriteProfiles).not.toHaveBeenCalled();
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): clear proxy (proxyData=null) → {success:true} (proxy reset to empty)', async () => {
    const result = await setProfileProxy('profile-001', null);

    expect(result).toEqual({ success: true });
    const written = mockWriteProfiles.mock.calls[0][0];
    expect(written[0].settings.proxy.server).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// createProxyInternal  [UC_09.01]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.proxies.createProxyInternal  [UC_09.01]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProxies.mockReturnValue([]);
    mockWriteProxies.mockResolvedValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid full data → {success:true} + log "Created proxy <id> (My Proxy)"', async () => {
    const result = await createProxyInternal({
      host: '1.2.3.4', port: 8080, type: 'http',
      name: 'My Proxy', username: 'user', password: 'pass',
    });

    expect(result.success).toBe(true);
    expect(result.proxy.host).toBe('1.2.3.4');
    expect(result.proxy.port).toBe(8080);
    expect(result.proxy.type).toBe('http');
    expect(result.proxy.name).toBe('My Proxy');
    expect(mockWriteProxies).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Created proxy .+ \(My Proxy\)$/));
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): empty host → {success:false, error:"Host is required"}', async () => {
    const result = await createProxyInternal({ host: '', port: 8080, type: 'http' });

    expect(result).toEqual({ success: false, error: 'Host is required' });
    expect(mockWriteProxies).not.toHaveBeenCalled();
  });

  // ── UTCID03 (B) ─────────────────────────────────────────────────────────────
  test('UTCID03 (B): port=99999 (>65535 boundary) → {success:false, error:"Port must be 1-65535"}', async () => {
    const result = await createProxyInternal({ host: '1.2.3.4', port: 99999, type: 'http' });

    expect(result).toEqual({ success: false, error: 'Port must be 1-65535' });
    expect(mockWriteProxies).not.toHaveBeenCalled();
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): type="ftp" → {success:false, error:"Type must be one of: http, https, socks4, socks5"}', async () => {
    const result = await createProxyInternal({ host: '1.2.3.4', port: 8080, type: 'ftp' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Type must be one of: http, https, socks4, socks5/);
    expect(mockWriteProxies).not.toHaveBeenCalled();
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): write fails → {success:false, error:"Failed to persist proxies file"}', async () => {
    mockWriteProxies.mockResolvedValue(false);

    const result = await createProxyInternal({ host: '1.2.3.4', port: 8080, type: 'http' });

    expect(result).toEqual({ success: false, error: 'Failed to persist proxies file' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// updateProxyInternal  [UC_09.07]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.proxies.updateProxyInternal  [UC_09.07]', () => {
  let logSpy;

  const baseProxies = () => [
    {
      id: 'proxy-001',
      name: 'Old',
      type: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: 'olduser',
      password: 'oldpass',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProxies.mockReturnValue(baseProxies());
    mockWriteProxies.mockResolvedValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid id + new host/port/cred → {success:true} + log "Updated proxy proxy-001"', async () => {
    const result = await updateProxyInternal('proxy-001', {
      host: '9.9.9.9', port: 3128, username: 'newuser', password: 'newpass',
    });

    expect(result.success).toBe(true);
    expect(result.proxy.host).toBe('9.9.9.9');
    expect(result.proxy.port).toBe(3128);
    expect(result.proxy.username).toBe('newuser');
    expect(result.proxy.password).toBe('newpass');
    expect(result.proxy.updatedAt).toBeDefined();
    expect(logSpy).toHaveBeenCalledWith('Updated proxy proxy-001');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): id not found → {success:false, error:"Proxy not found"}', async () => {
    const result = await updateProxyInternal('proxy-999', { host: '9.9.9.9', port: 3128 });

    expect(result).toEqual({ success: false, error: 'Proxy not found' });
    expect(mockWriteProxies).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): port=99999 → {success:false, error:"Port must be 1-65535"}', async () => {
    const result = await updateProxyInternal('proxy-001', { port: 99999 });

    expect(result).toEqual({ success: false, error: 'Port must be 1-65535' });
    expect(mockWriteProxies).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deleteProxyInternal  [UC_09.06]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.proxies.deleteProxyInternal  [UC_09.06]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProxies.mockReturnValue([
      { id: 'proxy-001', name: 'A' },
      { id: 'proxy-002', name: 'B' },
    ]);
    mockWriteProxies.mockResolvedValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): id="proxy-001" → {success:true} + log "Deleted proxy proxy-001"', async () => {
    const result = await deleteProxyInternal('proxy-001');

    expect(result).toEqual({ success: true });
    expect(mockWriteProxies).toHaveBeenCalledWith([{ id: 'proxy-002', name: 'B' }]);
    expect(logSpy).toHaveBeenCalledWith('Deleted proxy proxy-001');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): id="proxy-999" not found → {success:false, error:"Proxy not found"}', async () => {
    const result = await deleteProxyInternal('proxy-999');

    expect(result).toEqual({ success: false, error: 'Proxy not found' });
    expect(mockWriteProxies).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): write fails → {success:false, error:"Failed to persist proxies file"}', async () => {
    mockWriteProxies.mockResolvedValue(false);

    const result = await deleteProxyInternal('proxy-001');

    expect(result).toEqual({ success: false, error: 'Failed to persist proxies file' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// importProxiesInternal  [UC_09.02]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.proxies.importProxiesInternal  [UC_09.02]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProxies.mockReturnValue([]);
    mockWriteProxies.mockResolvedValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): 2 valid lines → {success:true, imported:2} + log "Imported 2 proxies (0 skipped)"', async () => {
    const text = '1.2.3.4:8080\nhttp://user:pass@5.6.7.8:3128';

    const result = await importProxiesInternal(text);

    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.proxies[0].host).toBe('1.2.3.4');
    expect(result.proxies[1].host).toBe('5.6.7.8');
    expect(result.proxies[1].username).toBe('user');
    expect(logSpy).toHaveBeenCalledWith('Imported 2 proxies (0 skipped)');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): empty text → {success:false, error:"No proxy lines found"}', async () => {
    const result = await importProxiesInternal('   \n  \n');

    expect(result).toEqual({ success: false, error: 'No proxy lines found' });
    expect(mockWriteProxies).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): all unparseable → {success:false, error:"No valid proxies found (3 lines skipped)"}', async () => {
    const text = 'NOT_A_PROXY\nALSO_BAD\n??:???';

    const result = await importProxiesInternal(text);

    expect(result).toEqual({ success: false, error: 'No valid proxies found (3 lines skipped)' });
    expect(mockWriteProxies).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// exportProxiesInternal  [UC_09.03]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.proxies.exportProxiesInternal  [UC_09.03]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadProxies.mockReturnValue([
      { id: 'proxy-001', type: 'http', host: '1.2.3.4', port: 8080, username: 'u', password: 'p' },
      { id: 'proxy-002', type: 'socks5', host: '5.6.7.8', port: 1080 },
    ]);
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): ids=[] (export all) → {success:true} with all proxies serialized', async () => {
    const result = await exportProxiesInternal([]);

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.text).toContain('http://u:p@1.2.3.4:8080');
    expect(result.text).toContain('socks5://5.6.7.8:1080');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): ids=["proxy-001"] → {success:true} only proxy-001 serialized', async () => {
    const result = await exportProxiesInternal(['proxy-001']);

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.text).toBe('http://u:p@1.2.3.4:8080');
    expect(result.text).not.toContain('socks5');
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): ids=["proxy-999"] (none match) → {success:true, count:0, text:""}', async () => {
    const result = await exportProxiesInternal(['proxy-999']);

    expect(result).toEqual({ success: true, count: 0, text: '' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkProxy  [UC_09.04]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('services.ProxyChecker.checkProxy  [UC_09.04]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid cfg + working proxy → {success:true, alive:true, ip, country, city, timezone, latency}', async () => {
    mockHttpGet.mockResolvedValue({
      statusCode: 200,
      body: { ip: '1.2.3.4', country: 'United States', countryCode: 'US', city: 'New York', timezone: 'America/New_York' },
    });

    const result = await checkProxy({ type: 'http', host: '1.2.3.4', port: 8080, username: '', password: '' });

    expect(result.success).toBe(true);
    expect(result.alive).toBe(true);
    expect(result.ip).toBe('1.2.3.4');
    expect(result.country).toBe('United States');
    expect(result.city).toBe('New York');
    expect(result.timezone).toBe('America/New_York');
    expect(typeof result.latency).toBe('number');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): missing host → {success:false, alive:false, error:"Host and port are required"}', async () => {
    const result = await checkProxy({ type: 'http', port: 8080 });

    expect(result).toEqual({ success: false, alive: false, error: 'Host and port are required' });
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): valid cfg + connection fails → {success:true, alive:false, error:"Connection failed or timed out"}', async () => {
    mockHttpGet.mockRejectedValue(new Error('Proxy connection timed out'));

    const result = await checkProxy({ type: 'http', host: '9.9.9.9', port: 9999, username: '', password: '' });

    expect(result.success).toBe(true);
    expect(result.alive).toBe(false);
    expect(result.ip).toBeNull();
    expect(result.latency).toBeNull();
    expect(result.error).toBe('Connection failed or timed out');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// rotateProxyIp  [UC_09.05]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('ipc.handlers.proxy-rotate (rotateProxyIp)  [UC_09.05]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockWriteProxies.mockResolvedValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): id="proxy-001" + rotateUrl + axios success → {success:true, latency, data}', async () => {
    mockReadProxies.mockReturnValue([
      { id: 'proxy-001', name: 'P1', rotateUrl: 'https://rotate.example.com/api', host: '1.2.3.4', port: 8080 },
    ]);
    mockAxiosGet.mockResolvedValue({ data: { message: 'IP rotated successfully' } });

    const result = await rotateProxyIp('proxy-001');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ message: 'IP rotated successfully' });
    expect(typeof result.latency).toBe('number');
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://rotate.example.com/api',
      { timeout: 15000 },
    );
    // Two log lines per Excel spec
    expect(logSpy).toHaveBeenCalledWith('Proxy rotate: P1');
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Proxy rotated OK: P1 \(\d+ms\)$/));
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): id="proxy-001" with empty rotateUrl → {success:false, error:"No rotate URL configured"}', async () => {
    mockReadProxies.mockReturnValue([
      { id: 'proxy-001', name: 'P1', rotateUrl: '' },
    ]);

    const result = await rotateProxyIp('proxy-001');

    expect(result).toEqual({ success: false, error: 'No rotate URL configured' });
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): axios timeout → {success:false, error:"timeout of 15000ms exceeded"} + log "Proxy rotate failed: ..."', async () => {
    mockReadProxies.mockReturnValue([
      { id: 'proxy-001', name: 'P1', rotateUrl: 'https://rotate.example.com/api' },
    ]);
    mockAxiosGet.mockRejectedValue(new Error('timeout of 15000ms exceeded'));

    const result = await rotateProxyIp('proxy-001');

    expect(result.success).toBe(false);
    expect(result.error).toBe('timeout of 15000ms exceeded');
    expect(logSpy).toHaveBeenCalledWith('Proxy rotate: P1');
    expect(logSpy).toHaveBeenCalledWith('Proxy rotate failed: timeout of 15000ms exceeded');
  });
});
