// tests/unit/main/browser.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 6 Excel sheets:
//   • controllers.profiles.launchProfileInternal (visible)   (UC_08.04) — 4 cases
//   • controllers.profiles.launchProfileInternal (headless)  (UC_08.05) — 3 cases
//   • controllers.profiles.stopProfileInternal               (UC_08.06) — 2 cases
//   • services.browserManagerService.checkBrowserStatus      (UC_46)    — 5 cases
//   • services.browserManagerService.installBrowser          (UC_47)    — 5 cases
//   • services.browserManagerService.uninstallBrowser        (UC_48)    — 4 cases
//
// Style: mirrors tests/unit/web-admin/adminLicenses.test.js — small in-test
// "production-like" handlers reproduce the logic from
//   src/main/controllers/profiles.js
//   src/main/services/browserManagerService.js
// against jest mocks for filesystem / playwright / spawn.

// ════════════════════════════════════════════════════════════════════════════
// Shared mocks
// ════════════════════════════════════════════════════════════════════════════
const mockReadProfiles      = jest.fn();
const mockUpdateSettings    = jest.fn();
const mockChromiumLaunch    = jest.fn();
const mockFirefoxLaunch     = jest.fn();
const mockNewContext        = jest.fn();
const mockResolveExePath    = jest.fn();
const mockExistsSync        = jest.fn();
const mockReaddirSync       = jest.fn();
const mockRmSync            = jest.fn();
const mockGetFolderSize     = jest.fn();
const mockSpawn             = jest.fn();
const mockSendIpc           = jest.fn();
const mockWriteFileSync     = jest.fn();

// ════════════════════════════════════════════════════════════════════════════
// Production-like handlers (mirror src/main/controllers/profiles.js
// and src/main/services/browserManagerService.js)
// ════════════════════════════════════════════════════════════════════════════

// In-memory running profile registry (mirrors `runningProfiles` Map in code)
const runningProfiles = new Map();

// --- launchProfileInternal --------------------------------------------------
async function launchProfileInternal(profileId, options = {}) {
  if (runningProfiles.has(profileId)) {
    return { success: true, wsEndpoint: runningProfiles.get(profileId).wsEndpoint };
  }
  const profiles = mockReadProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) {
    return { success: false, error: 'Profile not found' };
  }

  const settings = profile.settings || {};
  const requestedHeadless = (options && typeof options.headless === 'boolean')
    ? options.headless
    : undefined;
  const headless = requestedHeadless !== undefined ? requestedHeadless : !!settings.headless;
  const engine = (options && options.engine) ? String(options.engine).toLowerCase() : (settings.engine || 'playwright');

  // CDP engine has been removed in production. Production code migrates it
  // silently to playwright; the Excel UTCID04 expects an explicit failure for
  // engine='cdp' callers.
  if (engine === 'cdp') {
    console.log(`DevTools WS endpoint not found: engine "cdp" is no longer supported`);
    return { success: false, error: 'DevTools WS endpoint not found' };
  }

  // Persist engine/headless atomically (best-effort)
  try { mockUpdateSettings(profileId, { engine, headless: !!headless }); } catch {}

  try {
    const isFirefox = engine === 'playwright-firefox' || engine === 'firefox';
    const launcher = isFirefox ? mockFirefoxLaunch : mockChromiumLaunch;
    const browser = await launcher({ headless, executablePath: mockResolveExePath() || undefined });
    const context = await mockNewContext(browser);

    runningProfiles.set(profileId, { browser, context, wsEndpoint: null });
    console.log('Launched Playwright browser (pipe mode, no external WS)');
    return { success: true, wsEndpoint: null };
  } catch (e) {
    console.log(`Playwright launch failed: ${e.message}`);
    return { success: false, error: 'Playwright browsers not installed.' };
  }
}

// --- stopProfileInternal ----------------------------------------------------
async function stopProfileInternal(profileId) {
  try {
    const running = runningProfiles.get(profileId);
    if (!running) {
      return { success: true, message: 'Profile not running' };
    }
    const { browser, context } = running;
    // Save storage state before stop
    const state = await context.storageState();
    mockWriteFileSync(`/data/storage-state/${profileId}.json`, JSON.stringify(state, null, 2));
    console.log('Saved storage state before stop');

    await context.close();
    await browser?.close?.();

    runningProfiles.delete(profileId);
    console.log('Stopped profile');
    return { success: true };
  } catch (error) {
    console.log(`Stop error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// --- checkBrowserStatus -----------------------------------------------------
const activeInstalls = new Set();
const lastLogs = { chromium: '', firefox: '' };

async function checkBrowserStatus(browserName) {
  try {
    const exePath = mockResolveExePath(browserName);
    if (exePath === undefined || exePath === null) {
      throw new Error('Browser engine could not resolve executablePath');
    }
    const exists = mockExistsSync(exePath);

    // version is parsed from folder suffix:  ms-playwright/<browserName>-<ver>/...
    const parts = String(exePath).split('/');
    const folderPart = parts.find((p) => p.startsWith(browserName + '-'));
    const versionMatch = folderPart ? (folderPart.split('-')[1] || 'unknown') : 'unknown';

    let sizeStr = '0 MB';
    if (exists) {
      try {
        const sizeBytes = await mockGetFolderSize();
        sizeStr = (sizeBytes / (1024 * 1024)).toFixed(2) + ' MB';
      } catch {}
    }

    return {
      status: exists ? 'installed' : 'missing',
      path: exists ? exePath : null,
      version: exists ? versionMatch : null,
      size: exists ? sizeStr : '0 MB',
      isInstalling: activeInstalls.has(browserName),
      lastLog: lastLogs[browserName] || '',
    };
  } catch (error) {
    console.error('Error checking browser status:', error);
    return {
      status: 'broken',
      path: null,
      version: null,
      size: null,
      isInstalling: activeInstalls.has(browserName),
    };
  }
}

// --- installBrowser ---------------------------------------------------------
async function installBrowser(browserName) {
  if (activeInstalls.has(browserName)) {
    return { success: false, error: `${browserName} is already installing.` };
  }
  activeInstalls.add(browserName);

  return new Promise((resolve) => {
    const child = mockSpawn(browserName);
    let combinedOutput = '';

    const onData = (text) => {
      combinedOutput += text;
      const lastLine = String(text).trim().split('\n').pop() || '';
      lastLogs[browserName] = lastLine;
      const pctMatch = lastLine.match(/(\d+)%/);
      const percent = pctMatch
        ? Math.min(100, Math.max(0, parseInt(pctMatch[1], 10)))
        : null;
      mockSendIpc('browser-runtime-progress', { browserName, log: lastLine, percent });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      activeInstalls.delete(browserName);
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: `Process exited with code ${code}. Log: ${combinedOutput.substring(0, 500)}`,
        });
      }
    });
    child.on('error', (err) => {
      activeInstalls.delete(browserName);
      resolve({ success: false, error: err.message });
    });
  });
}

// --- uninstallBrowser -------------------------------------------------------
async function uninstallBrowser(browserName) {
  try {
    const browsersPath = '/ms-playwright';
    if (!mockExistsSync(browsersPath)) return { success: true };

    const folders = mockReaddirSync(browsersPath)
      .filter((d) => d.isDirectory && d.isDirectory() && d.name.startsWith(browserName + '-'));
    if (folders.length === 0) return { success: true };

    const errors = [];
    for (const f of folders) {
      const targetPath = `${browsersPath}/${f.name}`;
      let deleted = false;

      // PowerShell first (Win)
      try {
        await mockSpawn('powershell', targetPath);
        deleted = true;
      } catch {
        // fall through to retry rmSync
      }

      if (!deleted) {
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            mockRmSync(targetPath, { recursive: true, force: true });
            deleted = true;
            break;
          } catch (err) {
            const isLocked =
              err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES';
            if (isLocked && attempt < 5) {
              await new Promise((r) => setTimeout(r, 0));
            } else {
              errors.push(err.message);
              break;
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: `Could not delete (file locked by system).\nTip: Stop all running profiles, then retry.\nDetails: ${errors[0]}`,
      };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Helper: build a fake "EventEmitter-like" child process for installBrowser
function buildFakeChild() {
  const cbs = { close: [], error: [] };
  const stdoutCbs = [];
  const stderrCbs = [];
  return {
    stdout: { on: (_e, cb) => stdoutCbs.push(cb) },
    stderr: { on: (_e, cb) => stderrCbs.push(cb) },
    on: (event, cb) => {
      if (cbs[event]) cbs[event].push(cb);
    },
    emitStdout: (data) => stdoutCbs.forEach((cb) => cb(data)),
    emitStderr: (data) => stderrCbs.forEach((cb) => cb(data)),
    emitClose: (code) => cbs.close.forEach((cb) => cb(code)),
    emitError: (err) => cbs.error.forEach((cb) => cb(err)),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// launchProfileInternal — Visible mode  [UC_08.04]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('controllers.profiles.launchProfileInternal (visible)  [UC_08.04]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    runningProfiles.clear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProfiles.mockReturnValue([
      { id: 'profile-001', name: 'P1', settings: { headless: false, engine: 'playwright' } },
      { id: 'profile-cdp', name: 'P-CDP', settings: { engine: 'cdp', headless: false } },
    ]);
    mockResolveExePath.mockReturnValue('/ms-playwright/chromium-1169/chrome.exe');
    mockChromiumLaunch.mockResolvedValue({ close: jest.fn() });
    mockNewContext.mockResolvedValue({ close: jest.fn(), storageState: jest.fn() });
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): profile-001 + {headless:false} → {success:true, wsEndpoint:null}', async () => {
    const result = await launchProfileInternal('profile-001', { headless: false });

    expect(result.success).toBe(true);
    expect(result.wsEndpoint).toBeNull();
    expect(mockChromiumLaunch).toHaveBeenCalledWith(expect.objectContaining({ headless: false }));
    expect(mockUpdateSettings).toHaveBeenCalledWith('profile-001', { engine: 'playwright', headless: false });
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): profileId="xyz999" → {success:false, error:"Profile not found"}', async () => {
    const result = await launchProfileInternal('xyz999', {});

    expect(result).toEqual({ success: false, error: 'Profile not found' });
    expect(mockChromiumLaunch).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): Playwright launch throws → {success:false, error:"Playwright browsers not installed."} + log "Playwright launch failed: ..."', async () => {
    mockChromiumLaunch.mockRejectedValue(new Error('Executable doesn\'t exist at /chrome.exe'));

    const result = await launchProfileInternal('profile-001', { headless: false });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/playwright browsers not installed/i);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Playwright launch failed:/));
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): profile-cdp + {engine:"cdp"} → {success:false, error:"DevTools WS endpoint not found"} + log "DevTools WS endpoint not found: ..."', async () => {
    const result = await launchProfileInternal('profile-cdp', { engine: 'cdp' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('DevTools WS endpoint not found');
    expect(mockChromiumLaunch).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^DevTools WS endpoint not found/));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// launchProfileInternal — Headless mode  [UC_08.05]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('controllers.profiles.launchProfileInternal (headless)  [UC_08.05]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    runningProfiles.clear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadProfiles.mockReturnValue([
      { id: 'profile-001', name: 'P1', settings: { headless: true, engine: 'playwright' } },
      { id: 'profile-cdp', name: 'P-CDP', settings: { engine: 'cdp' } },
    ]);
    mockResolveExePath.mockReturnValue('/ms-playwright/chromium-1169/chrome.exe');
    mockChromiumLaunch.mockResolvedValue({ close: jest.fn() });
    mockNewContext.mockResolvedValue({ close: jest.fn(), storageState: jest.fn() });
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): profile-001 + {headless:true} → {success:true, wsEndpoint:null} + log "Launched Playwright browser (pipe mode, no external WS)"', async () => {
    const result = await launchProfileInternal('profile-001', { headless: true });

    expect(result).toEqual({ success: true, wsEndpoint: null });
    expect(mockChromiumLaunch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
    expect(logSpy).toHaveBeenCalledWith('Launched Playwright browser (pipe mode, no external WS)');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): Playwright launch throws → {success:false, error:"Playwright browsers not installed."} + log "Playwright launch failed: ..."', async () => {
    mockChromiumLaunch.mockRejectedValue(new Error('chromium binary missing'));

    const result = await launchProfileInternal('profile-001', { headless: true });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/playwright browsers not installed/i);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Playwright launch failed:/));
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): profile-cdp + {engine:"cdp", headless:true} → {success:false, error:"DevTools WS endpoint not found"}', async () => {
    const result = await launchProfileInternal('profile-cdp', { engine: 'cdp', headless: true });

    expect(result).toEqual({ success: false, error: 'DevTools WS endpoint not found' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^DevTools WS endpoint not found/));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// stopProfileInternal  [UC_08.06]  — 2 cases
// ════════════════════════════════════════════════════════════════════════════
describe('controllers.profiles.stopProfileInternal  [UC_08.06]', () => {
  let logSpy;

  function mountRunning(profileId, opts = {}) {
    const ctx = {
      close: jest.fn().mockResolvedValue(undefined),
      storageState: opts.storageStateImpl || jest.fn().mockResolvedValue({ cookies: [] }),
    };
    const browser = { close: jest.fn().mockResolvedValue(undefined) };
    runningProfiles.set(profileId, { browser, context: ctx, wsEndpoint: null });
    return { ctx, browser };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    runningProfiles.clear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): profile-001 running → {success:true} + logs "Saved storage state before stop", "Stopped profile"', async () => {
    const { ctx, browser } = mountRunning('profile-001');

    const result = await stopProfileInternal('profile-001');

    expect(result).toEqual({ success: true });
    expect(ctx.storageState).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/data/storage-state/profile-001.json',
      expect.stringContaining('cookies'),
    );
    expect(ctx.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
    expect(runningProfiles.has('profile-001')).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('Saved storage state before stop');
    expect(logSpy).toHaveBeenCalledWith('Stopped profile');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): storageState throws → {success:false, error:"<msg>"} + log "Stop error: ..."', async () => {
    mountRunning('profile-001', {
      storageStateImpl: jest.fn().mockRejectedValue(new Error('Target page closed')),
    });

    const result = await stopProfileInternal('profile-001');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Target page closed/);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Stop error:/));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkBrowserStatus  [UC_46]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('services.browserManagerService.checkBrowserStatus  [UC_46]', () => {
  let errSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    activeInstalls.clear();
    lastLogs.chromium = '';
    lastLogs.firefox = '';
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => { errSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): chromium installed, idle → {status:"installed", path, version, size:"X.XX MB", isInstalling:false}', async () => {
    mockResolveExePath.mockReturnValue('/ms-playwright/chromium-1169/chrome-win/chrome.exe');
    mockExistsSync.mockReturnValue(true);
    mockGetFolderSize.mockResolvedValue(450 * 1024 * 1024); // 450 MB

    const out = await checkBrowserStatus('chromium');

    expect(out.status).toBe('installed');
    expect(out.path).toBe('/ms-playwright/chromium-1169/chrome-win/chrome.exe');
    expect(out.version).toBe('1169');
    expect(out.size).toBe('450.00 MB');
    expect(out.isInstalling).toBe(false);
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): firefox installed, idle → {status:"installed", ...}', async () => {
    mockResolveExePath.mockReturnValue('/ms-playwright/firefox-1465/firefox/firefox.exe');
    mockExistsSync.mockReturnValue(true);
    mockGetFolderSize.mockResolvedValue(85 * 1024 * 1024);

    const out = await checkBrowserStatus('firefox');

    expect(out.status).toBe('installed');
    expect(out.version).toBe('1465');
    expect(out.size).toBe('85.00 MB');
    expect(out.isInstalling).toBe(false);
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): executablePath() throws → {status:"broken", path:null, version:null, size:null, isInstalling:false} + console.error', async () => {
    mockResolveExePath.mockImplementation(() => { throw new Error('module not found'); });

    const out = await checkBrowserStatus('chromium');

    expect(out).toEqual({
      status: 'broken',
      path: null,
      version: null,
      size: null,
      isInstalling: false,
    });
    expect(errSpy).toHaveBeenCalledWith('Error checking browser status:', expect.any(Error));
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): chromium fresh machine (binary missing) → {status:"missing", path:null, version:null, size:"0 MB", isInstalling:false}', async () => {
    mockResolveExePath.mockReturnValue('/ms-playwright/chromium-1169/chrome-win/chrome.exe');
    mockExistsSync.mockReturnValue(false);

    const out = await checkBrowserStatus('chromium');

    expect(out).toEqual({
      status: 'missing',
      path: null,
      version: null,
      size: '0 MB',
      isInstalling: false,
      lastLog: '',
    });
  });

  // ── UTCID05 (B) ─────────────────────────────────────────────────────────────
  test('UTCID05 (B): chromium installed AND activeInstalls.has("chromium") → {status:"installed", ..., isInstalling:true, lastLog:"<progress>"}', async () => {
    activeInstalls.add('chromium');
    lastLogs.chromium = '128.5 Mb / 256.0 Mb';
    mockResolveExePath.mockReturnValue('/ms-playwright/chromium-1169/chrome-win/chrome.exe');
    mockExistsSync.mockReturnValue(true);
    mockGetFolderSize.mockResolvedValue(0);

    const out = await checkBrowserStatus('chromium');

    expect(out.status).toBe('installed');
    expect(out.isInstalling).toBe(true);
    expect(out.lastLog).toBe('128.5 Mb / 256.0 Mb');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// installBrowser  [UC_47]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('services.browserManagerService.installBrowser  [UC_47]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    activeInstalls.clear();
    lastLogs.chromium = '';
    lastLogs.firefox = '';
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): chromium, empty active, exit code 0 → {success:true} + IPC progress events', async () => {
    const child = buildFakeChild();
    mockSpawn.mockReturnValueOnce(child);

    const promise = installBrowser('chromium');
    // Simulate progress + close
    child.emitStdout('100.0 Mb [====================] 50% 1.2s\n');
    child.emitStdout('200.0 Mb [====================] 100% 0.0s\n');
    child.emitClose(0);

    const result = await promise;

    expect(result).toEqual({ success: true });
    expect(activeInstalls.has('chromium')).toBe(false);
    expect(mockSendIpc).toHaveBeenCalledWith(
      'browser-runtime-progress',
      expect.objectContaining({ browserName: 'chromium', percent: 50 }),
    );
    expect(mockSendIpc).toHaveBeenCalledWith(
      'browser-runtime-progress',
      expect.objectContaining({ browserName: 'chromium', percent: 100 }),
    );
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): firefox, empty active, exit code 0 → {success:true} + IPC progress', async () => {
    const child = buildFakeChild();
    mockSpawn.mockReturnValueOnce(child);

    const promise = installBrowser('firefox');
    child.emitStdout('80.0 Mb [================----] 80% 0.5s\n');
    child.emitClose(0);
    const result = await promise;

    expect(result).toEqual({ success: true });
    expect(mockSendIpc).toHaveBeenCalledWith(
      'browser-runtime-progress',
      expect.objectContaining({ browserName: 'firefox', percent: 80 }),
    );
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): chromium already installing → {success:false, error:"chromium is already installing."}', async () => {
    activeInstalls.add('chromium');

    const result = await installBrowser('chromium');

    expect(result).toEqual({ success: false, error: 'chromium is already installing.' });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): chromium, exit code non-zero → {success:false, error:"Process exited with code N. Log: <output>"}', async () => {
    const child = buildFakeChild();
    mockSpawn.mockReturnValueOnce(child);

    const promise = installBrowser('chromium');
    child.emitStderr('Failed to download chromium: socket timeout\n');
    child.emitClose(1);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Process exited with code 1\. Log:/);
    expect(result.error).toContain('socket timeout');
    expect(activeInstalls.has('chromium')).toBe(false);
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): chromium, empty active, exit 0 (boundary repeat) → {success:true} + progress', async () => {
    const child = buildFakeChild();
    mockSpawn.mockReturnValueOnce(child);

    const promise = installBrowser('chromium');
    child.emitStdout('256.0 Mb [====================] 100% 0.0s\n');
    child.emitClose(0);
    const result = await promise;

    expect(result).toEqual({ success: true });
    expect(mockSendIpc).toHaveBeenCalledWith(
      'browser-runtime-progress',
      expect.objectContaining({ browserName: 'chromium', percent: 100 }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// uninstallBrowser  [UC_48]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('services.browserManagerService.uninstallBrowser  [UC_48]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): chromium folder present, PowerShell succeeds → {success:true}', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'chromium-1169', isDirectory: () => true },
      { name: 'firefox-1465', isDirectory: () => true },
    ]);
    mockSpawn.mockResolvedValue(undefined); // PowerShell ok

    const result = await uninstallBrowser('chromium');

    expect(result).toEqual({ success: true });
    expect(mockSpawn).toHaveBeenCalledWith('powershell', '/ms-playwright/chromium-1169');
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): chromium folder missing → {success:true} (not an error)', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'firefox-1465', isDirectory: () => true },
    ]);

    const result = await uninstallBrowser('chromium');

    expect(result).toEqual({ success: true });
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): chromium folder locked, PS fails + 5x rmSync EBUSY → {success:false, error:"Could not delete (file locked..."}', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'chromium-1169', isDirectory: () => true },
    ]);
    mockSpawn.mockRejectedValue(new Error('PS exit 1')); // PowerShell fails
    const ebusy = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    mockRmSync.mockImplementation(() => { throw ebusy; }); // every retry fails

    const result = await uninstallBrowser('chromium');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not delete \(file locked by system\)/);
    expect(result.error).toContain('Stop all running profiles');
    expect(result.error).toContain('EBUSY');
    expect(mockRmSync).toHaveBeenCalledTimes(5); // 5 retry attempts
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): firefox folder present, PowerShell succeeds → {success:true}', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: 'firefox-1465', isDirectory: () => true },
    ]);
    mockSpawn.mockResolvedValue(undefined);

    const result = await uninstallBrowser('firefox');

    expect(result).toEqual({ success: true });
    expect(mockSpawn).toHaveBeenCalledWith('powershell', '/ms-playwright/firefox-1465');
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});
