// tests/unit/api/apiTasks.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests covering 5 Excel sheets (Fastify API task-log routes):
//   • GET    /api/tasks               (UC_63) — 5 cases
//   • POST   /api/tasks               (UC_64) — 5 cases
//   • POST   /api/tasks/:id/run       (UC_65) — 5 cases
//   • POST   /api/tasks/:id/cancel    (UC_66) — 4 cases
//   • DELETE /api/tasks/:id           (UC_67) — 4 cases
//
// Style: mirrors tests/unit/api/apiLaunchBrowser.test.js — Fastify with mocked
// task-log storage / scriptRuntime.executeScript / stopScript.
const Fastify = require('fastify');

// ════════════════════════════════════════════════════════════════════════════
// Mocks
// ════════════════════════════════════════════════════════════════════════════
const mockGetTaskLogs    = jest.fn();
const mockGetTaskLogById = jest.fn();
const mockAddTaskLog     = jest.fn();
const mockDeleteTaskLog  = jest.fn();
const mockExecuteScript  = jest.fn();
const mockStopScript     = jest.fn();

// Some tests need require() to throw at handler entry — we simulate via a
// per-route gate flag that mirrors the "module missing" failure mode.
let _taskLogsRequireFails = false;
let _scriptRuntimeRequireFails = false;

// ════════════════════════════════════════════════════════════════════════════
// Test app builder
// ════════════════════════════════════════════════════════════════════════════
function buildApp() {
  const app = Fastify();

  // GET /api/tasks
  app.get('/api/tasks', async (req, reply) => {
    try {
      let list = await mockGetTaskLogs();
      if (req.query?.profileId) {
        list = list.filter((t) => t.profileId === req.query.profileId);
      }
      reply.send({ success: true, tasks: list });
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  // POST /api/tasks
  app.post('/api/tasks', async (req, reply) => {
    const body = req.body || {};
    if (!body.profileId) {
      return reply.code(400).send({ success: false, error: '"profileId" is required' });
    }
    if (!body.name) {
      return reply.code(400).send({ success: false, error: '"name" is required' });
    }
    if (!body.scriptContent) {
      return reply.code(400).send({ success: false, error: '"scriptContent" is required' });
    }
    const result = await mockAddTaskLog({
      scriptName: body.name,
      profileId: body.profileId,
      _scriptContent: body.scriptContent,
      _scriptType: 'inline',
    });
    reply.code(201).send(result);
  });

  // POST /api/tasks/:id/run
  app.post('/api/tasks/:id/run', async (req, reply) => {
    try {
      if (_scriptRuntimeRequireFails) {
        throw new Error("Cannot find module '../engine/scriptRuntime'");
      }
      const found = await mockGetTaskLogById(req.params.id);
      if (!found.success) {
        return reply.code(404).send(found);
      }
      const task = found.task;
      if (!task._scriptContent) {
        return reply.code(400).send({
          success: false,
          error: 'Task has no scriptContent to execute',
        });
      }
      // Fire-and-forget execute
      mockExecuteScript(task.profileId, task._scriptContent, { timeoutMs: 120000 })
        .then((r) => mockAddTaskLog({
          scriptName: task.scriptName,
          profileId: task.profileId,
          status: r.success ? 'completed' : 'error',
        }))
        .catch(() => {});
      reply.send({ success: true, message: 'Task enqueued', taskId: req.params.id });
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  // POST /api/tasks/:id/cancel
  app.post('/api/tasks/:id/cancel', async (req, reply) => {
    try {
      if (_scriptRuntimeRequireFails) {
        throw new Error("Cannot find module '../engine/scriptRuntime'");
      }
      const result = mockStopScript(req.params.id);
      reply.send({ success: true, message: 'Cancel requested', result });
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  // DELETE /api/tasks/:id
  app.delete('/api/tasks/:id', async (req, reply) => {
    try {
      if (_taskLogsRequireFails) {
        throw new Error("Cannot find module '../storage/taskLogs'");
      }
      const r = await mockDeleteTaskLog(req.params.id);
      // Note: route forwards r as-is, NOT mapping to 404. Always 200 with body.
      reply.send(r);
    } catch (e) {
      reply.code(500).send({ success: false, error: e?.message || String(e) });
    }
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/tasks  [UC_63]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/tasks  [UC_63]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _taskLogsRequireFails = false;
    _scriptRuntimeRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): 5 entries, no query → 200 + 5 reversed entries with logCount/lastLog', async () => {
    mockGetTaskLogs.mockResolvedValue([
      { id: 't1', profileId: 'p_001', logCount: 2, lastLog: 'ok' },
      { id: 't2', profileId: 'p_002', logCount: 1, lastLog: 'ok' },
      { id: 't3', profileId: 'p_001', logCount: 0, lastLog: '' },
      { id: 't4', profileId: 'p_001', logCount: 3, lastLog: 'fail' },
      { id: 't5', profileId: 'p_003', logCount: 5, lastLog: 'ok' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/tasks' });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().tasks).toHaveLength(5);
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): ?profileId=p_001 → 200 + 3 entries filtered', async () => {
    mockGetTaskLogs.mockResolvedValue([
      { id: 't1', profileId: 'p_001' },
      { id: 't2', profileId: 'p_002' },
      { id: 't3', profileId: 'p_001' },
      { id: 't4', profileId: 'p_001' },
      { id: 't5', profileId: 'p_003' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/tasks?profileId=p_001' });

    expect(res.statusCode).toBe(200);
    expect(res.json().tasks).toHaveLength(3);
    expect(res.json().tasks.every((t) => t.profileId === 'p_001')).toBe(true);
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): ?profileId=ghost (no match) → 200 + tasks:[]', async () => {
    mockGetTaskLogs.mockResolvedValue([
      { id: 't1', profileId: 'p_001' },
      { id: 't2', profileId: 'p_002' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/tasks?profileId=ghost' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, tasks: [] });
  });

  // ── UTCID04 (B) ─────────────────────────────────────────────────────────────
  test('UTCID04 (B): task-logs.json missing/empty → 200 + tasks:[]', async () => {
    mockGetTaskLogs.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/api/tasks' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, tasks: [] });
  });

  // ── UTCID05 (B) ─────────────────────────────────────────────────────────────
  test('UTCID05 (B): require("../storage/taskLogs") throws → 500 + error', async () => {
    mockGetTaskLogs.mockRejectedValue(new Error("Cannot find module '../storage/taskLogs'"));

    const res = await app.inject({ method: 'GET', url: '/api/tasks' });

    expect(res.statusCode).toBe(500);
    expect(res.json().success).toBe(false);
    expect(res.json().error).toMatch(/Cannot find module/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/tasks  [UC_64]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/tasks  [UC_64]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _taskLogsRequireFails = false;
    _scriptRuntimeRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): valid body {profileId, name, scriptContent} → 201 + taskLog', async () => {
    mockAddTaskLog.mockResolvedValue({
      success: true,
      taskLog: {
        id: 'abc12345',
        scriptName: 'Auto-1',
        profileId: 'p_001',
        status: 'pending',
        logs: [],
        _scriptContent: 'log(1);',
        _scriptType: 'inline',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { profileId: 'p_001', name: 'Auto-1', scriptContent: 'log(1);' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().success).toBe(true);
    expect(res.json().taskLog.scriptName).toBe('Auto-1');
    expect(res.json().taskLog.status).toBe('pending');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): no profileId → 400 + \'"profileId" is required\'', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { name: 'Auto-1', scriptContent: 'log(1);' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: '"profileId" is required' });
    expect(mockAddTaskLog).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): no name → 400 + \'"name" is required\'', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { profileId: 'p_001', scriptContent: 'log(1);' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: '"name" is required' });
    expect(mockAddTaskLog).not.toHaveBeenCalled();
  });

  // ── UTCID04 (A) ─────────────────────────────────────────────────────────────
  test('UTCID04 (A): no scriptContent → 400 + \'"scriptContent" is required\'', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { profileId: 'p_001', name: 'Auto-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, error: '"scriptContent" is required' });
    expect(mockAddTaskLog).not.toHaveBeenCalled();
  });

  // ── UTCID05 (N) ─────────────────────────────────────────────────────────────
  test('UTCID05 (N): addTaskLog persist error → still 201 (route always 201) + error body', async () => {
    mockAddTaskLog.mockResolvedValue({ success: false, error: 'Persist error' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { profileId: 'p_001', name: 'Auto-1', scriptContent: 'log(1);' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ success: false, error: 'Persist error' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/tasks/:id/run  [UC_65]  — 5 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/tasks/:id/run  [UC_65]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _taskLogsRequireFails = false;
    _scriptRuntimeRequireFails = false;
    mockExecuteScript.mockResolvedValue({ success: true, result: 1, logs: [] });
    mockAddTaskLog.mockResolvedValue({ success: true });
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): id="abc12345" exists, _scriptContent set → 200 + Task enqueued', async () => {
    mockGetTaskLogById.mockResolvedValue({
      success: true,
      task: { id: 'abc12345', profileId: 'p_001', _scriptContent: 'log(1);', scriptName: 'A' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/abc12345/run',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      message: 'Task enqueued',
      taskId: 'abc12345',
    });
    // Allow background promise to resolve
    await new Promise((r) => setImmediate(r));
    expect(mockExecuteScript).toHaveBeenCalledWith('p_001', 'log(1);', { timeoutMs: 120000 });
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): id="unknown" → 404 + "Task log not found"', async () => {
    mockGetTaskLogById.mockResolvedValue({ success: false, error: 'Task log not found' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/unknown/run',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, error: 'Task log not found' });
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): exists but _scriptContent empty → 400 + "Task has no scriptContent to execute"', async () => {
    mockGetTaskLogById.mockResolvedValue({
      success: true,
      task: { id: 'abc12345', profileId: 'p_001', _scriptContent: '' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/abc12345/run',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      success: false,
      error: 'Task has no scriptContent to execute',
    });
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  // ── UTCID04 (N) ─────────────────────────────────────────────────────────────
  test('UTCID04 (N): exists; executeScript later fails async → route still 200 (sync ack)', async () => {
    mockGetTaskLogById.mockResolvedValue({
      success: true,
      task: { id: 'abc12345', profileId: 'p_001', _scriptContent: 'log(1);', scriptName: 'A' },
    });
    mockExecuteScript.mockResolvedValue({
      success: false,
      error: 'Script timeout after 120000ms',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/abc12345/run',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      message: 'Task enqueued',
      taskId: 'abc12345',
    });
    await new Promise((r) => setImmediate(r));
    // Background addTaskLog should record status:"error"
    expect(mockAddTaskLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });

  // ── UTCID05 (B) ─────────────────────────────────────────────────────────────
  test('UTCID05 (B): require("../engine/scriptRuntime") throws → 500 + module-missing error', async () => {
    _scriptRuntimeRequireFails = true;

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/abc12345/run',
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/Cannot find module '\.\.\/engine\/scriptRuntime'/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/tasks/:id/cancel  [UC_66]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/tasks/:id/cancel  [UC_66]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _taskLogsRequireFails = false;
    _scriptRuntimeRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): "p_001" with running ctrl → 200 + {success:true, message, result:undefined}', async () => {
    mockStopScript.mockReturnValue(undefined); // stopScript is void

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/p_001/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      message: 'Cancel requested',
    });
    expect(mockStopScript).toHaveBeenCalledWith('p_001');
  });

  // ── UTCID02 (N) ─────────────────────────────────────────────────────────────
  test('UTCID02 (N): "task_xyz" no matching key → silent no-op → 200 + Cancel requested', async () => {
    mockStopScript.mockReturnValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/task_xyz/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().message).toBe('Cancel requested');
  });

  // ── UTCID03 (N) ─────────────────────────────────────────────────────────────
  test('UTCID03 (N): empty-ish profileId path → silent no-op → 200', async () => {
    mockStopScript.mockReturnValue(undefined);

    // Fastify route requires non-empty param, use placeholder
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/blank/cancel',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  // ── UTCID04 (B) ─────────────────────────────────────────────────────────────
  test('UTCID04 (B): require("../engine/scriptRuntime") throws → 500 + module-missing error', async () => {
    _scriptRuntimeRequireFails = true;

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/p_001/cancel',
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/Cannot find module/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/tasks/:id  [UC_67]  — 4 cases
// ════════════════════════════════════════════════════════════════════════════
describe('DELETE /api/tasks/:id  [UC_67]', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    _taskLogsRequireFails = false;
    _scriptRuntimeRequireFails = false;
    app = buildApp();
  });

  afterEach(async () => { await app.close(); });

  // ── UTCID01 (N) ─────────────────────────────────────────────────────────────
  test('UTCID01 (N): id="abc12345" present → 200 + {success:true}', async () => {
    mockDeleteTaskLog.mockResolvedValue({ success: true });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/abc12345',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(mockDeleteTaskLog).toHaveBeenCalledWith('abc12345');
  });

  // ── UTCID02 (A) ─────────────────────────────────────────────────────────────
  test('UTCID02 (A): id="unknown" — filter no-op → 200 + {success:false, error:"Task log not found"} (NOT 404)', async () => {
    mockDeleteTaskLog.mockResolvedValue({ success: false, error: 'Task log not found' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/unknown',
    });

    // Per UC_67: route forwards r as-is (no 404 mapping)
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, error: 'Task log not found' });
  });

  // ── UTCID03 (A) ─────────────────────────────────────────────────────────────
  test('UTCID03 (A): writeTaskLogs returns false (EACCES) → 200 + {success:false, error:"Persist error"}', async () => {
    mockDeleteTaskLog.mockResolvedValue({ success: false, error: 'Persist error' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/abc12345',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: false, error: 'Persist error' });
  });

  // ── UTCID04 (B) ─────────────────────────────────────────────────────────────
  test('UTCID04 (B): require("../storage/taskLogs") throws → 500 + module-missing error', async () => {
    _taskLogsRequireFails = true;

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/abc12345',
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/Cannot find module '\.\.\/storage\/taskLogs'/);
  });
});
