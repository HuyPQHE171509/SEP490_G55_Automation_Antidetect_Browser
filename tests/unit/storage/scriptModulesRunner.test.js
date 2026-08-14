const path = require('path');
const fs = require('fs');

describe('Script Modules and Screenshot Execution', () => {
  const { performAction, getActionNames } = require('../../../src/main/engine/actions');
  const { listModules, installModule, uninstallModule } = require('../../../src/main/storage/scriptModules');
  const { executeScript } = require('../../../src/main/engine/scriptRuntime');

  test('Module list returns array without errors', () => {
    const modules = listModules();
    expect(Array.isArray(modules)).toBe(true);
  });

  test('Module name validation prevents unsafe package names', async () => {
    const res = await installModule('rm -rf /; malicious');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/invalid package name/i);
  });

  test('ACTION_MAP supports screenshot and capture aliases', () => {
    const actions = getActionNames();
    expect(actions).toContain('capture.screen');
    expect(actions).toContain('capture.element');
    expect(actions).toContain('screenshot');
    expect(actions).toContain('captureScreen');
  });

  test('executeScript exposes fs, path, crypto, URL, and Buffer in sandbox', async () => {
    const code = `
      const p = require('path');
      const f = require('fs');
      const c = require('crypto');
      const buf = Buffer.from('test-buffer');
      const url = new URL('https://example.com/test');
      log('Path resolved:', p.basename('/test/photo.png'));
      log('Hash:', c.createHash('sha256').update('data').digest('hex'));
      log('URL host:', url.host);
      return { ok: true, len: buf.length };
    `;

    const res = await executeScript('test_profile_mod', code);
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ ok: true, len: 11 });
    expect(res.logs.some(l => l.message.includes('photo.png'))).toBe(true);
    expect(res.logs.some(l => l.message.includes('example.com'))).toBe(true);
  });
});
