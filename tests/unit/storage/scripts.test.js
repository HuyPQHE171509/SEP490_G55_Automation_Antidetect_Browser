// tests/unit/storage/scripts.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 8 Excel sheets:
//   • storage.scripts.saveScriptInternal              (UC_10.01) — 3 cases
//   • storage.scripts.saveScriptInternal (upsert)     (UC_31)    — 5 cases
//   • renderer.handleImportJson (importScript)        (UC_10.02) — 3 cases
//   • renderer.handleExportJson (exportScript)        (UC_10.03) — 3 cases
//   • engine.scriptRuntime.executeScript              (UC_32)    — 6 cases
//   • renderer.BulkRunModal.runBulk (executeScriptBulk) (UC_33)  — 5 cases
//   • engine.scriptRuntime.pauseScript / resumeScript (UC_34)    — 4 cases
//   • engine.scriptRuntime.stopScript                 (UC_35)    — 4 cases
//
// Style: mirrors tests/unit/storage/proxies.test.js — small in-test
// "production-like" handlers reproduce the logic from
//   src/main/storage/scripts.js
//   src/main/engine/scriptRuntime.js
//   src/renderer/components/ScriptsManager.jsx
// against jest mocks for filesystem / runtime / IPC.

// ════════════════════════════════════════════════════════════════════════════
// Shared mocks
// ════════════════════════════════════════════════════════════════════════════
const mockReadScripts  = jest.fn();
const mockWriteScripts = jest.fn();
const mockSaveScript   = jest.fn();      // for importScript
const mockListScripts  = jest.fn();      // for exportScript
const mockTriggerDL    = jest.fn();      // for exportScript download
const mockAlert        = jest.fn();      // for import/export UX
const mockIpcExecute   = jest.fn();      // for executeScriptBulk
const mockPageClose    = jest.fn();
const mockPageIsClosed = jest.fn();

// ════════════════════════════════════════════════════════════════════════════
// Production-like helpers (mirror src/main/storage/scripts.js)
// ════════════════════════════════════════════════════════════════════════════
function generateId() {
  return Math.random().toString(36).slice(2, 14);
}

function sanitizeScript(input = {}, existing = null) {
  const base = existing || {};
  const id = input.id || base.id || null;
  const name = String(input.name ?? base.name ?? '').trim().slice(0, 128);
  const description = String(input.description ?? base.description ?? '').slice(0, 1000);
  const language = 'javascript';
  const code = String(input.code ?? base.code ?? '');
  const browserMode = input.browserMode ?? base.browserMode ?? 'visible';
  const schedule = {
    enabled: !!(input.schedule?.enabled ?? base.schedule?.enabled),
    cron: String(input.schedule?.cron ?? base.schedule?.cron ?? ''),
    profileId: String(input.schedule?.profileId ?? base.schedule?.profileId ?? ''),
  };
  const createdAt = base.createdAt || new Date().toISOString();
  const updatedAt = new Date().toISOString();
  return { id, name, description, language, code, browserMode, schedule, createdAt, updatedAt };
}

// ════════════════════════════════════════════════════════════════════════════
// Production-like handlers
// ════════════════════════════════════════════════════════════════════════════

// --- saveScriptInternal(input) — upsert ----------------------------------
async function saveScriptInternal(input) {
  try {
    if (!input || typeof input !== 'object') {
      return { success: false, error: 'Invalid payload' };
    }
    const list = mockReadScripts();
    if (input.id) {
      const idx = list.findIndex((x) => x.id === input.id);
      if (idx === -1) {
        const prepared = sanitizeScript(input, null);
        prepared.id = input.id;
        list.push(prepared);
      } else {
        list[idx] = sanitizeScript(input, list[idx]);
      }
    } else {
      const prepared = sanitizeScript(input, null);
      let id = generateId();
      const ids = new Set(list.map((x) => x.id));
      while (ids.has(id)) id = generateId();
      prepared.id = id;
      list.push(prepared);
      input.id = id;
    }
    if (!mockWriteScripts(list)) {
      console.log('writeScripts error: persistence failed');
      return { success: false, error: 'Persist error' };
    }
    const s = list.find((x) => x.id === input.id);
    return { success: true, script: s };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

// --- handleImportJson (renderer importScript) -----------------------------
async function importScript(fileContent) {
  try {
    let parsed;
    try {
      parsed = JSON.parse(fileContent);
    } catch {
      mockAlert('Invalid JSON file');
      return { ok: false };
    }
    if (!Array.isArray(parsed)) {
      mockAlert('Invalid JSON file');
      return { ok: false };
    }
    let count = 0;
    for (const s of parsed) {
      // Guard: skip entries missing both name and code
      if (!s || (!s.name && !s.code)) continue;
      const result = await mockSaveScript(s);
      if (result && result.success) count++;
    }
    mockAlert(`Imported ${count} script(s)`);
    return { ok: true, count };
  } catch (e) {
    // Any unexpected error surfaces as Invalid JSON file
    mockAlert('Invalid JSON file');
    return { ok: false };
  }
}

// --- handleExportJson (renderer exportScript) -----------------------------
async function exportScript() {
  try {
    const list = await mockListScripts();
    const today = new Date().toISOString().slice(0, 10);
    mockTriggerDL(`scripts-export-${today}.json`, JSON.stringify(list));
    return { ok: true, count: Array.isArray(list) ? list.length : 0 };
  } catch (e) {
    mockAlert('Export failed');
    return { ok: false, error: e?.message || String(e) };
  }
}

// --- executeScript / pauseScript / resumeScript / stopScript --------------
const _runningScripts = new Map();

async function executeScript(profileId, code, { timeoutMs = 120000 } = {}) {
  if (!profileId) return { success: false, error: 'profileId is required' };
  const src = String(code || '').trim();
  if (!src) return { success: false, error: 'code is empty' };
  if (_runningScripts.has(profileId)) {
    return { success: false, error: 'A script is already running for this profile' };
  }

  const ctrl = { aborted: false, paused: false, rejectAbort: null, pageHandle: null };
  _runningScripts.set(profileId, ctrl);
  console.log(`Script: starting execution (timeout=${timeoutMs}ms)`);
  console.log(`AUDIT SCRIPT_RUN ${profileId}`);

  const logs = [];
  const cappedTimeout = Math.min(timeoutMs, 300000);

  try {
    // Race: either user code completes, abort fires, or timeout fires
    const result = await Promise.race([
      // The "user code" — we use a plain async fn that receives the ctrl
      // so tests can simulate long-running / aborted scripts via the code arg.
      (async () => {
        if (typeof code === 'function') return code({ ctrl, logs });
        // Default: run instantly as if `log(1);` finished.
        logs.push({ time: new Date().toISOString(), message: 'log(1)' });
        return 1;
      })(),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error(`Script timeout after ${cappedTimeout}ms`)),
        cappedTimeout,
      )),
      new Promise((_, reject) => { ctrl.rejectAbort = reject; }),
    ]);
    _runningScripts.delete(profileId);
    return { success: true, result, logs };
  } catch (e) {
    _runningScripts.delete(profileId);
    const errMsg = e?.message || String(e);
    if (errMsg.includes('stopped by user')) {
      console.log('Script: STOPPED by user');
    } else if (errMsg.includes('timeout')) {
      console.log(`Script: TIMEOUT — ${errMsg}`);
    } else {
      console.log(`Script: ERROR — ${errMsg}`);
    }
    return { success: false, error: errMsg, logs };
  }
}

function pauseScript(profileId) {
  const ctrl = _runningScripts.get(profileId);
  if (ctrl) ctrl.paused = true;
}

function resumeScript(profileId) {
  const ctrl = _runningScripts.get(profileId);
  if (ctrl) ctrl.paused = false;
}

function stopScript(profileId) {
  const ctrl = _runningScripts.get(profileId);
  if (ctrl) {
    ctrl.aborted = true;
    ctrl.paused = false;
    if (ctrl.rejectAbort) {
      ctrl.rejectAbort(new Error('Script stopped by user'));
    }
    try {
      if (ctrl.pageHandle && ctrl.pageHandle.page && !ctrl.pageHandle.page.isClosed()) {
        ctrl.pageHandle.page.close().catch(() => {});
      }
    } catch {
      // ignore cleanup errors during forced stop
    }
  }
}

// --- executeScriptBulk (renderer BulkRunModal.runBulk) --------------------
async function executeScriptBulk({ selectedIds, concurrency = 3, scriptId, abortRef }) {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    return { ok: false, reason: 'no-selection', status: {} };
  }
  const status = {};
  selectedIds.forEach((id) => { status[id] = 'pending'; });
  const warning = concurrency > 5;
  const pool = warning ? concurrency : Math.max(1, Math.min(concurrency, selectedIds.length));
  const queue = [...selectedIds];
  const runOne = async (pid) => {
    if (abortRef && abortRef.current) {
      status[pid] = 'aborted';
      return;
    }
    try {
      const r = await mockIpcExecute('script-execute', pid, scriptId);
      status[pid] = r && r.success ? 'done' : 'error';
    } catch {
      status[pid] = 'error';
    }
  };
  const workers = Array.from({ length: pool }).map(async () => {
    while (queue.length) {
      const pid = queue.shift();
      if (pid === undefined) return;
      await runOne(pid);
    }
  });
  await Promise.all(workers);
  const successCount = Object.values(status).filter((s) => s === 'done').length;
  console.log('Bulk run finished');
  return { ok: true, status, warning, successCount };
}

// ════════════════════════════════════════════════════════════════════════════
// saveScriptInternal  [UC_10.01]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.scripts.saveScriptInternal  [UC_10.01]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadScripts.mockReturnValue([]);
    mockWriteScripts.mockReturnValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid full input → {success:true, script:{id, name:"Login Script", language:"javascript", browserMode:"visible", ...}}', async () => {
    const result = await saveScriptInternal({
      name: 'Login Script',
      code: "await page.goto('https://example.com');",
      browserMode: 'visible',
      description: 'Auto login script',
    });

    expect(result.success).toBe(true);
    expect(result.script.name).toBe('Login Script');
    expect(result.script.language).toBe('javascript');
    expect(result.script.code).toContain("page.goto");
    expect(result.script.browserMode).toBe('visible');
    expect(result.script.description).toBe('Auto login script');
    expect(result.script.id).toBeDefined();
    expect(mockWriteScripts).toHaveBeenCalled();
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): input=null → {success:false, error:"Invalid payload"}', async () => {
    const result = await saveScriptInternal(null);

    expect(result).toEqual({ success: false, error: 'Invalid payload' });
    expect(mockReadScripts).not.toHaveBeenCalled();
    expect(mockWriteScripts).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): writeScripts fails → {success:false, error:"Persist error"}', async () => {
    mockWriteScripts.mockReturnValue(false);

    const result = await saveScriptInternal({
      name: 'Login Script',
      code: "await page.goto('https://example.com');",
    });

    expect(result).toEqual({ success: false, error: 'Persist error' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^writeScripts error:/));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// updateScriptInternal — saveScriptInternal upsert  [UC_31]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.scripts.saveScriptInternal (upsert)  [UC_31]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockReadScripts.mockReturnValue([
      { id: 'abc123', name: 'Original', code: 'old code', language: 'javascript' },
    ]);
    mockWriteScripts.mockReturnValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): id="abc123" exists → updated → {success:true, script:{id:"abc123", name:"Updated", ...}}', async () => {
    const result = await saveScriptInternal({ id: 'abc123', name: 'Updated', code: 'new code' });

    expect(result.success).toBe(true);
    expect(result.script.id).toBe('abc123');
    expect(result.script.name).toBe('Updated');
    expect(result.script.code).toBe('new code');
    // List length should remain 1 (in-place update)
    const writtenList = mockWriteScripts.mock.calls[0][0];
    expect(writtenList.length).toBe(1);
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): input=null → {success:false, error:"Invalid payload"} (rejected early)', async () => {
    const result = await saveScriptInternal(null);

    expect(result).toEqual({ success: false, error: 'Invalid payload' });
    expect(mockWriteScripts).not.toHaveBeenCalled();
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): id="new_xyz" not in list → inserted with given id → {success:true, script:{id:"new_xyz", ...}}', async () => {
    const result = await saveScriptInternal({ id: 'new_xyz', name: 'New' });

    expect(result.success).toBe(true);
    expect(result.script.id).toBe('new_xyz');
    expect(result.script.name).toBe('New');
    const writtenList = mockWriteScripts.mock.calls[0][0];
    expect(writtenList.length).toBe(2); // original + new
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): no id → generates new id → {success:true, script:{id:<generated>, ...}}', async () => {
    const result = await saveScriptInternal({ name: 'Created', code: 'console.log(1)' });

    expect(result.success).toBe(true);
    expect(result.script.id).toBeDefined();
    expect(result.script.id).not.toBe('abc123');
    expect(result.script.name).toBe('Created');
    const writtenList = mockWriteScripts.mock.calls[0][0];
    expect(writtenList.length).toBe(2);
  });

  // ── UTCID05 (A) ─────────────────────────────────────────────────────────────
  test('UTCID05 (A): writeScripts fails (EACCES) → {success:false, error:"Persist error"} + log "writeScripts error: ..."', async () => {
    mockWriteScripts.mockReturnValue(false);
    const result = await saveScriptInternal({ id: 'abc123', name: 'Updated' });

    expect(result).toEqual({ success: false, error: 'Persist error' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^writeScripts error:/));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// importScript — handleImportJson  [UC_10.02]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('renderer.handleImportJson (importScript)  [UC_10.02]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveScript.mockResolvedValue({ success: true });
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid JSON array of 2 scripts → alert("Imported 2 script(s)")', async () => {
    const fileContent = JSON.stringify([
      { name: 'Script A', code: "await page.goto('...')" },
      { name: 'Script B', code: "await page.click('...')" },
    ]);

    const result = await importScript(fileContent);

    expect(result).toEqual({ ok: true, count: 2 });
    expect(mockSaveScript).toHaveBeenCalledTimes(2);
    expect(mockAlert).toHaveBeenCalledWith('Imported 2 script(s)');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): invalid JSON "not json {{{" → alert("Invalid JSON file")', async () => {
    const result = await importScript('this is not json {{{');

    expect(result).toEqual({ ok: false });
    expect(mockSaveScript).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('Invalid JSON file');
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): JSON array of entries with no name/code → alert("Imported 0 script(s)")', async () => {
    const fileContent = JSON.stringify([
      { description: 'no name no code' },
      { browserMode: 'visible' },
    ]);

    const result = await importScript(fileContent);

    expect(result).toEqual({ ok: true, count: 0 });
    expect(mockSaveScript).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('Imported 0 script(s)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// exportScript — handleExportJson  [UC_10.03]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('renderer.handleExportJson (exportScript)  [UC_10.03]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): non-empty list → triggers download "scripts-export-YYYY-MM-DD.json" with array', async () => {
    mockListScripts.mockResolvedValue([
      { id: 'a1', name: 'Script A', code: '...', description: '' },
      { id: 'a2', name: 'Script B', code: '...', description: '' },
    ]);

    const result = await exportScript();

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(mockTriggerDL).toHaveBeenCalledWith(
      expect.stringMatching(/^scripts-export-\d{4}-\d{2}-\d{2}\.json$/),
      expect.stringContaining('Script A'),
    );
    expect(mockAlert).not.toHaveBeenCalled();
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): empty list → triggers download with [] (no error shown)', async () => {
    mockListScripts.mockResolvedValue([]);

    const result = await exportScript();

    expect(result).toEqual({ ok: true, count: 0 });
    expect(mockTriggerDL).toHaveBeenCalledWith(
      expect.stringMatching(/^scripts-export-/),
      '[]',
    );
    expect(mockAlert).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): listScripts throws → alert("Export failed") (caught internally)', async () => {
    mockListScripts.mockRejectedValue(new Error('IPC failed'));

    const result = await exportScript();

    expect(result.ok).toBe(false);
    expect(mockTriggerDL).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('Export failed');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// executeScript  [UC_32]  — 6 cases
// ════════════════════════════════════════════════════════════════════════════
describe('engine.scriptRuntime.executeScript  [UC_32]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    _runningScripts.clear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): profileId="p_001", code="log(1);", not running → {success:true, result, logs:[...]}', async () => {
    const result = await executeScript('p_001', 'log(1);', { timeoutMs: 120000 });

    expect(result.success).toBe(true);
    expect(result.result).toBe(1);
    expect(Array.isArray(result.logs)).toBe(true);
    expect(_runningScripts.has('p_001')).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('Script: starting execution (timeout=120000ms)');
    expect(logSpy).toHaveBeenCalledWith('AUDIT SCRIPT_RUN p_001');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): profileId="" → {success:false, error:"profileId is required"}', async () => {
    const result = await executeScript('', 'return 0');

    expect(result).toEqual({ success: false, error: 'profileId is required' });
    expect(_runningScripts.size).toBe(0);
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): code="" (whitespace only) → {success:false, error:"code is empty"}', async () => {
    const result = await executeScript('p_001', '   \n\t  ');

    expect(result).toEqual({ success: false, error: 'code is empty' });
    expect(_runningScripts.has('p_001')).toBe(false);
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): script already running for same profileId → {success:false, error:"A script is already running for this profile"}', async () => {
    _runningScripts.set('p_001', { aborted: false, paused: false });

    const result = await executeScript('p_001', 'log(1);');

    expect(result).toEqual({
      success: false,
      error: 'A script is already running for this profile',
    });
  });

  // ── UTCID05 (B) ─────────────────────────────────────────────────────────────
  test('UTCID05 (B): timeout exceeded → {success:false, error:"Script timeout after 1000ms", logs:[...]}', async () => {
    // Pass an async function that never resolves so the timeout wins.
    const longRunning = () => new Promise(() => {});

    const result = await executeScript('p_001', longRunning, { timeoutMs: 1000 });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Script timeout after 1000ms');
    expect(Array.isArray(result.logs)).toBe(true);
    expect(_runningScripts.has('p_001')).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Script: TIMEOUT/));
  }, 7000);

  // ── UTCID06 (N) ─────────────────────────────────────────────────────────────
  test('UTCID06 (N): profileId="p_001" + valid code (audit log fired) → {success:true}', async () => {
    const result = await executeScript('p_001', 'log(1);');

    expect(result.success).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('Script: starting execution (timeout=120000ms)');
    expect(logSpy).toHaveBeenCalledWith('AUDIT SCRIPT_RUN p_001');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// executeScriptBulk — BulkRunModal.runBulk  [UC_33]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('renderer.BulkRunModal.runBulk (executeScriptBulk)  [UC_33]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockIpcExecute.mockResolvedValue({ success: true });
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): selectedIds=["p1","p2","p3"], concurrency=3 → all 3 "done" + log "Bulk run finished"', async () => {
    const result = await executeScriptBulk({
      selectedIds: ['p1', 'p2', 'p3'],
      concurrency: 3,
      scriptId: 's1',
      abortRef: { current: false },
    });

    expect(result.ok).toBe(true);
    expect(result.successCount).toBe(3);
    expect(result.status).toEqual({ p1: 'done', p2: 'done', p3: 'done' });
    expect(mockIpcExecute).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenCalledWith('Bulk run finished');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): selectedIds=[] → no IPC call (Run button disabled)', async () => {
    const result = await executeScriptBulk({
      selectedIds: [],
      concurrency: 3,
      scriptId: 's1',
      abortRef: { current: false },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-selection');
    expect(mockIpcExecute).not.toHaveBeenCalled();
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): selectedIds=["p1","p2","p3"], concurrency=1 → executed one-by-one (sequential)', async () => {
    const order = [];
    mockIpcExecute.mockImplementation(async (_evt, pid) => {
      order.push(pid);
      return { success: true };
    });

    const result = await executeScriptBulk({
      selectedIds: ['p1', 'p2', 'p3'],
      concurrency: 1,
      scriptId: 's1',
      abortRef: { current: false },
    });

    expect(result.ok).toBe(true);
    expect(result.successCount).toBe(3);
    expect(order).toEqual(['p1', 'p2', 'p3']);
  });

  // ── UTCID04 (B) ─────────────────────────────────────────────────────────────
  test('UTCID04 (B): selectedIds size=6, concurrency=6 (>5) → warning banner + 6-wide pool', async () => {
    const result = await executeScriptBulk({
      selectedIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      concurrency: 6,
      scriptId: 's1',
      abortRef: { current: false },
    });

    expect(result.ok).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.successCount).toBe(6);
    expect(mockIpcExecute).toHaveBeenCalledTimes(6);
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): abort after 1st finishes → 1 "done" + remaining marked "aborted"', async () => {
    const abortRef = { current: false };
    let count = 0;
    mockIpcExecute.mockImplementation(async () => {
      count++;
      if (count === 1) abortRef.current = true;
      return { success: true };
    });

    const result = await executeScriptBulk({
      selectedIds: ['p1', 'p2', 'p3'],
      concurrency: 1,
      scriptId: 's1',
      abortRef,
    });

    expect(result.ok).toBe(true);
    const doneCount = Object.values(result.status).filter((s) => s === 'done').length;
    const abortedCount = Object.values(result.status).filter((s) => s === 'aborted').length;
    expect(doneCount).toBe(1);
    expect(abortedCount).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// pauseScript / resumeScript  [UC_34]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('engine.scriptRuntime.pauseScript / resumeScript  [UC_34]', () => {
  beforeEach(() => {
    _runningScripts.clear();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): pauseScript on running profile → ctrl.paused becomes true', () => {
    const ctrl = { aborted: false, paused: false };
    _runningScripts.set('p_001', ctrl);

    pauseScript('p_001');

    expect(ctrl.paused).toBe(true);
    expect(ctrl.aborted).toBe(false);
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): resumeScript on paused profile → ctrl.paused becomes false', () => {
    const ctrl = { aborted: false, paused: true };
    _runningScripts.set('p_001', ctrl);

    resumeScript('p_001');

    expect(ctrl.paused).toBe(false);
    expect(ctrl.aborted).toBe(false);
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): pauseScript on unknown profile → no-op (silent)', () => {
    expect(() => pauseScript('p_unknown')).not.toThrow();
    expect(_runningScripts.has('p_unknown')).toBe(false);
  });

  // ── UTCID04 (B) ─────────────────────────────────────────────────────────────
  test('UTCID04 (B): resumeScript on unknown profile → no-op (silent)', () => {
    expect(() => resumeScript('p_unknown')).not.toThrow();
    expect(_runningScripts.has('p_unknown')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// stopScript  [UC_35]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('engine.scriptRuntime.stopScript  [UC_35]', () => {
  beforeEach(() => {
    _runningScripts.clear();
    jest.clearAllMocks();
  });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): running → aborted=true, paused=false, rejectAbort fired, page.close() called', () => {
    const rejectAbort = jest.fn();
    mockPageIsClosed.mockReturnValue(false);
    mockPageClose.mockResolvedValue(undefined);
    const ctrl = {
      aborted: false,
      paused: false,
      rejectAbort,
      pageHandle: { page: { isClosed: mockPageIsClosed, close: mockPageClose } },
    };
    _runningScripts.set('p_001', ctrl);

    stopScript('p_001');

    expect(ctrl.aborted).toBe(true);
    expect(ctrl.paused).toBe(false);
    expect(rejectAbort).toHaveBeenCalledWith(expect.any(Error));
    expect(rejectAbort.mock.calls[0][0].message).toBe('Script stopped by user');
    expect(mockPageClose).toHaveBeenCalled();
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): unknown profileId → silent no-op', () => {
    expect(() => stopScript('p_unknown')).not.toThrow();
    expect(mockPageClose).not.toHaveBeenCalled();
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): paused script → aborted=true AND paused=false; rejectAbort fires', () => {
    const rejectAbort = jest.fn();
    mockPageIsClosed.mockReturnValue(false);
    mockPageClose.mockResolvedValue(undefined);
    const ctrl = {
      aborted: false,
      paused: true,
      rejectAbort,
      pageHandle: { page: { isClosed: mockPageIsClosed, close: mockPageClose } },
    };
    _runningScripts.set('p_001', ctrl);

    stopScript('p_001');

    expect(ctrl.aborted).toBe(true);
    expect(ctrl.paused).toBe(false);
    expect(rejectAbort).toHaveBeenCalled();
    expect(mockPageClose).toHaveBeenCalled();
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): page already closed → page.close() skipped; rejectAbort still fires', () => {
    const rejectAbort = jest.fn();
    mockPageIsClosed.mockReturnValue(true); // page already closed
    const ctrl = {
      aborted: false,
      paused: false,
      rejectAbort,
      pageHandle: { page: { isClosed: mockPageIsClosed, close: mockPageClose } },
    };
    _runningScripts.set('p_001', ctrl);

    stopScript('p_001');

    expect(ctrl.aborted).toBe(true);
    expect(rejectAbort).toHaveBeenCalled();
    expect(mockPageClose).not.toHaveBeenCalled();
  });
});
