// tests/unit/storage/tasks.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 5 Excel sheets:
//   • storage.taskLogs.getTaskLogs                    (UC_36) — 3 cases
//   • ipc.handlers["scripts-execute"] (runTask)       (UC_37) — 5 cases
//   • renderer.ScriptsManager rerunModal (rerunTask)  (UC_38) — 3 cases
//   • storage.taskLogs.deleteTaskLog                  (UC_39) — 4 cases
//   • storage.taskLogs.clearTaskLogs                  (UC_40) — 3 cases
//
// Style: mirrors tests/unit/storage/scripts.test.js — "production-like"
// handlers reproduce the logic from
//   src/main/storage/taskLogs.js
//   src/main/ipc/handlers.js (scripts-execute)
//   src/renderer/components/ScriptsManager.jsx (rerunModal)
// against jest mocks for filesystem / executor / launcher.

// ════════════════════════════════════════════════════════════════════════════
// Shared mocks
// ════════════════════════════════════════════════════════════════════════════
const mockReadTaskLogs   = jest.fn();
const mockWriteTaskLogs  = jest.fn();
const mockGetScript      = jest.fn();
const mockLaunchProfile  = jest.fn();
const mockExecuteScript  = jest.fn();
const mockAddTaskLog     = jest.fn();
const mockAuditLog       = jest.fn();
const mockGetScriptList  = jest.fn();
const mockSetRerunModal  = jest.fn();

// In-memory running-profile registry (mirrors runningProfiles Map)
const runningProfiles = new Map();

// ════════════════════════════════════════════════════════════════════════════
// Production-like handlers
// ════════════════════════════════════════════════════════════════════════════

// --- storage.taskLogs.getTaskLogs --------------------------------------------
async function getTaskLogs() {
  const list = mockReadTaskLogs(); // never throws — corrupt/missing → []
  // Reverse so newest first; attach summary
  return list.slice().reverse().map((t) => ({
    ...t,
    logCount: Array.isArray(t.logs) ? t.logs.length : 0,
    lastLog: Array.isArray(t.logs) && t.logs.length
      ? t.logs[t.logs.length - 1]
      : null,
  }));
}

// --- storage.taskLogs.deleteTaskLog ------------------------------------------
async function deleteTaskLog(id) {
  try {
    if (!id) {
      return { success: false, error: 'Task log not found' };
    }
    const list = mockReadTaskLogs();
    const filtered = list.filter((t) => t.id !== id);
    if (filtered.length === list.length) {
      return { success: false, error: 'Task log not found' };
    }
    const ok = await mockWriteTaskLogs(filtered);
    if (!ok) {
      console.log('writeTaskLogs error: persistence failed');
      return { success: false, error: 'Persist error' };
    }
    console.log(`Task log deleted: ${id}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

// --- storage.taskLogs.clearTaskLogs ------------------------------------------
async function clearTaskLogs() {
  try {
    const ok = await mockWriteTaskLogs([]);
    if (!ok) {
      console.log('writeTaskLogs error: persistence failed');
      return { success: false, error: 'Persist error' };
    }
    console.log('All task logs cleared');
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

// --- ipc.handlers["scripts-execute"] (runTask) -------------------------------
const RESTRICTED_DOMAINS = ['paypal.com', 'banking.com', 'gov.vn'];
const SENSITIVE_PATTERNS = [
  /while\s*\(\s*true\s*\)/i,
  /for\s*\(\s*;\s*;\s*\)/i,
];

function ethicalLint(code) {
  const src = String(code || '');
  for (const dom of RESTRICTED_DOMAINS) {
    if (src.includes(dom)) {
      return `EthicalViolationError: Restricted domain "${dom}" — strictly prohibited.`;
    }
  }
  for (const pat of SENSITIVE_PATTERNS) {
    if (pat.test(src)) {
      return 'EthicalViolationError: Detected sensitive patterns (DDoS-style infinite loop).';
    }
  }
  return null;
}

async function runTask({ scriptId, profileId }) {
  // Step 1: lookup script
  const found = await mockGetScript(scriptId);
  if (!found.success) {
    return { success: false, error: `Script not found: ${scriptId}` };
  }
  const script = found.script;

  // Step 2: ethical lint on code
  const violation = ethicalLint(script.code);
  if (violation) {
    mockAuditLog('VIOLATION_BLOCKED', violation, profileId);
    console.log(violation);
    return { success: false, error: violation };
  }

  // Step 3: auto-launch profile if not already running
  if (!runningProfiles.has(profileId)) {
    const launchRes = await mockLaunchProfile(profileId);
    if (!launchRes.success) {
      return { success: false, error: launchRes.error || 'Launch failed' };
    }
    runningProfiles.set(profileId, { launched: true });
  }

  // Step 4: execute script
  const result = await mockExecuteScript(profileId, script.code);

  // Step 5: persist task log
  await mockAddTaskLog({
    scriptId,
    profileId,
    status: result.success ? 'completed' : 'error',
    logs: result.logs || [],
  });

  return result;
}

// --- renderer.ScriptsManager rerunModal (rerunTask) --------------------------
async function rerunTask(taskLog) {
  // taskLog is the row clicked in TaskLogs table; we look up the original
  // script and open the modal (or show "deleted" message if missing).
  const scripts = await mockGetScriptList();
  const original = scripts.find((s) => s.id === taskLog.scriptId);
  if (!original) {
    mockSetRerunModal({ open: true, script: null });
    // No "Re-run opened" log when script is gone (Excel UTCID02 omits log)
    return { open: true, script: null };
  }
  mockSetRerunModal({ open: true, script: original });
  console.log(`Re-run opened for task ${taskLog.id}`);
  return { open: true, script: original };
}

// ════════════════════════════════════════════════════════════════════════════
// getTaskLogs  [UC_36]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.taskLogs.getTaskLogs  [UC_36]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): 3 valid entries → returns 3 reversed (newest first) with logCount/lastLog', async () => {
    mockReadTaskLogs.mockReturnValue([
      { id: 't1', scriptName: 'A', status: 'completed', logs: [{ msg: 'hi' }] },
      { id: 't2', scriptName: 'B', status: 'error', logs: [] },
      { id: 't3', scriptName: 'C', status: 'completed', logs: [{ msg: 'a' }, { msg: 'b' }] },
    ]);

    const result = await getTaskLogs();

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('t3');
    expect(result[0].logCount).toBe(2);
    expect(result[0].lastLog).toEqual({ msg: 'b' });
    expect(result[1].id).toBe('t2');
    expect(result[1].logCount).toBe(0);
    expect(result[1].lastLog).toBeNull();
    expect(result[2].id).toBe('t1');
  });

  // ── UTCID02 (B) ─────────────────────────────────────────────────────────────
  test('UTCID02 (B): file missing — readTaskLogs returns [] → returns []', async () => {
    mockReadTaskLogs.mockReturnValue([]);

    const result = await getTaskLogs();

    expect(result).toEqual([]);
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): corrupt JSON — readTaskLogs catches and returns [] → returns []', async () => {
    // readTaskLogs swallows JSON.parse errors and returns []
    mockReadTaskLogs.mockReturnValue([]);

    const result = await getTaskLogs();

    expect(result).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// runTask  [UC_37]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('ipc.handlers["scripts-execute"] (runTask)  [UC_37]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    runningProfiles.clear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid script + profile already running → executeScript runs → completed taskLog persisted', async () => {
    mockGetScript.mockResolvedValue({
      success: true, script: { id: 's1', code: 'log(1)' },
    });
    mockExecuteScript.mockResolvedValue({ success: true, result: 1, logs: [{ msg: 'log(1)' }] });
    runningProfiles.set('p_001', { launched: true });

    const result = await runTask({ scriptId: 's1', profileId: 'p_001' });

    expect(result.success).toBe(true);
    expect(result.result).toBe(1);
    // Already running → launch NOT called
    expect(mockLaunchProfile).not.toHaveBeenCalled();
    expect(mockAddTaskLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', scriptId: 's1' }),
    );
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): scriptId="s_unknown" → {success:false, error:"Script not found: s_unknown"}', async () => {
    mockGetScript.mockResolvedValue({ success: false, error: 'Script not found' });

    const result = await runTask({ scriptId: 's_unknown', profileId: 'p_001' });

    expect(result).toEqual({ success: false, error: 'Script not found: s_unknown' });
    expect(mockExecuteScript).not.toHaveBeenCalled();
    expect(mockLaunchProfile).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): code references "paypal.com" → EthicalViolationError + audit log', async () => {
    mockGetScript.mockResolvedValue({
      success: true,
      script: { id: 's2', code: 'fetch("https://paypal.com/api/login")' },
    });

    const result = await runTask({ scriptId: 's2', profileId: 'p_001' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^EthicalViolationError: Restricted domain/);
    expect(mockAuditLog).toHaveBeenCalledWith(
      'VIOLATION_BLOCKED',
      expect.stringMatching(/Restricted domain/),
      'p_001',
    );
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): code "fetch(..)" inside while(true){} → EthicalViolationError (sensitive pattern)', async () => {
    mockGetScript.mockResolvedValue({
      success: true,
      script: { id: 's3', code: 'while(true){ fetch("/x") }' },
    });

    const result = await runTask({ scriptId: 's3', profileId: 'p_001' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/EthicalViolationError.*sensitive patterns/i);
    expect(mockAuditLog).toHaveBeenCalledWith(
      'VIOLATION_BLOCKED',
      expect.stringMatching(/sensitive patterns/),
      'p_001',
    );
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): profile not running → launchProfileInternal called → script run → taskLog completed', async () => {
    mockGetScript.mockResolvedValue({
      success: true, script: { id: 's1', code: 'log(1)' },
    });
    mockLaunchProfile.mockResolvedValue({ success: true });
    mockExecuteScript.mockResolvedValue({ success: true, result: 1, logs: [] });

    const result = await runTask({ scriptId: 's1', profileId: 'p_002' });

    expect(result.success).toBe(true);
    expect(mockLaunchProfile).toHaveBeenCalledWith('p_002');
    expect(mockExecuteScript).toHaveBeenCalledWith('p_002', 'log(1)');
    expect(mockAddTaskLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// rerunTask  [UC_38]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('renderer.ScriptsManager rerunModal (rerunTask)  [UC_38]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): completed run of s1, scripts.json contains s1 → modal opens with s1 + log', async () => {
    mockGetScriptList.mockResolvedValue([{ id: 's1', name: 'Login Script', code: 'x' }]);
    const taskLog = { id: 'tlog_001', scriptId: 's1', status: 'completed' };

    const result = await rerunTask(taskLog);

    expect(result).toEqual({ open: true, script: { id: 's1', name: 'Login Script', code: 'x' } });
    expect(mockSetRerunModal).toHaveBeenCalledWith({
      open: true,
      script: { id: 's1', name: 'Login Script', code: 'x' },
    });
    expect(logSpy).toHaveBeenCalledWith('Re-run opened for task tlog_001');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): errored run of deleted script → modal shows {script:null} (Script was deleted)', async () => {
    mockGetScriptList.mockResolvedValue([]); // s1 no longer exists
    const taskLog = { id: 'tlog_002', scriptId: 's1', status: 'error' };

    const result = await rerunTask(taskLog);

    expect(result).toEqual({ open: true, script: null });
    expect(mockSetRerunModal).toHaveBeenCalledWith({ open: true, script: null });
    // Per Excel UTCID02: no "Re-run opened" log when script is gone
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringMatching(/^Re-run opened/));
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): stopped run of s2, scripts.json contains s2 → modal opens with s2 + log', async () => {
    mockGetScriptList.mockResolvedValue([{ id: 's2', name: 'Other', code: 'y' }]);
    const taskLog = { id: 'tlog_003', scriptId: 's2', status: 'stopped' };

    const result = await rerunTask(taskLog);

    expect(result.script.id).toBe('s2');
    expect(mockSetRerunModal).toHaveBeenCalledWith({
      open: true,
      script: { id: 's2', name: 'Other', code: 'y' },
    });
    expect(logSpy).toHaveBeenCalledWith('Re-run opened for task tlog_003');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deleteTaskLog  [UC_39]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.taskLogs.deleteTaskLog  [UC_39]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockWriteTaskLogs.mockResolvedValue(true);
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): id="abcd12" exists in 5-entry list → {success:true} + log "Task log deleted: abcd12"', async () => {
    mockReadTaskLogs.mockReturnValue([
      { id: 'a' }, { id: 'b' }, { id: 'abcd12' }, { id: 'd' }, { id: 'e' },
    ]);

    const result = await deleteTaskLog('abcd12');

    expect(result).toEqual({ success: true });
    expect(mockWriteTaskLogs).toHaveBeenCalledWith([
      { id: 'a' }, { id: 'b' }, { id: 'd' }, { id: 'e' },
    ]);
    expect(logSpy).toHaveBeenCalledWith('Task log deleted: abcd12');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): id="nonexistent" not in list → {success:false, error:"Task log not found"}', async () => {
    mockReadTaskLogs.mockReturnValue([{ id: 'a' }, { id: 'b' }]);

    const result = await deleteTaskLog('nonexistent');

    expect(result).toEqual({ success: false, error: 'Task log not found' });
    expect(mockWriteTaskLogs).not.toHaveBeenCalled();
  });

  // ── UTCID03 (B) ─────────────────────────────────────────────────────────────
  test('UTCID03 (B): id="" (empty string) → {success:false, error:"Task log not found"}', async () => {
    const result = await deleteTaskLog('');

    expect(result).toEqual({ success: false, error: 'Task log not found' });
    expect(mockReadTaskLogs).not.toHaveBeenCalled();
    expect(mockWriteTaskLogs).not.toHaveBeenCalled();
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): writeTaskLogs fails (EACCES) → {success:false, error:"Persist error"} + log "writeTaskLogs error"', async () => {
    mockReadTaskLogs.mockReturnValue([{ id: 'abcd12' }, { id: 'b' }]);
    mockWriteTaskLogs.mockResolvedValue(false);

    const result = await deleteTaskLog('abcd12');

    expect(result).toEqual({ success: false, error: 'Persist error' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^writeTaskLogs error:/));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringMatching(/^Task log deleted:/));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// clearTaskLogs  [UC_40]  — 3 cases
// ════════════════════════════════════════════════════════════════════════════
describe('storage.taskLogs.clearTaskLogs  [UC_40]', () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => { logSpy.mockRestore(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): 5 entries → write [] → {success:true} + log "All task logs cleared"', async () => {
    mockWriteTaskLogs.mockResolvedValue(true);

    const result = await clearTaskLogs();

    expect(result).toEqual({ success: true });
    expect(mockWriteTaskLogs).toHaveBeenCalledWith([]);
    expect(logSpy).toHaveBeenCalledWith('All task logs cleared');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): already empty [] → write [] → {success:true} (idempotent)', async () => {
    mockWriteTaskLogs.mockResolvedValue(true);

    const result = await clearTaskLogs();

    expect(result).toEqual({ success: true });
    expect(mockWriteTaskLogs).toHaveBeenCalledWith([]);
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): write denied (EACCES) → {success:false, error:"Persist error"} + log "writeTaskLogs error"', async () => {
    mockWriteTaskLogs.mockResolvedValue(false);

    const result = await clearTaskLogs();

    expect(result).toEqual({ success: false, error: 'Persist error' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^writeTaskLogs error:/));
    expect(logSpy).not.toHaveBeenCalledWith('All task logs cleared');
  });
});
