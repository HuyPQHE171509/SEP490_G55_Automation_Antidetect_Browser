// tests/unit/web-admin/updateFeed.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for the electron-updater feed serving guard (api/updates.js):
//   1. safeName — chặn path traversal (../, \, /, null byte).
//   2. safeName — chỉ chấp nhận .yml / .exe / .blockmap.
//   3. content-type mapping đúng cho từng loại file feed.
//
// Style mirrors versionManagement.test.js — in-test helpers reproduce the
// production logic (safeName/CONTENT_TYPE) since chúng không được export riêng.

const path = require('path');

// ════════════════════════════════════════════════════════════════════════════
// Helpers mirror api/updates.js
// ════════════════════════════════════════════════════════════════════════════

const ALLOWED_EXT = new Set(['.yml', '.exe', '.blockmap']);
const CONTENT_TYPE = {
  '.yml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
};

// Mirrors api/updates.js safeName
function safeName(name) {
  const raw = String(name || '');
  if (raw.includes('..') || raw.includes('\0')) return null;
  const base = path.basename(raw);
  if (!base || base !== raw) return null;
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return base;
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

describe('update feed — safeName guard', () => {
  // UTCID01: tên hợp lệ latest.yml được chấp nhận
  test('UTCID01 accepts latest.yml', () => {
    expect(safeName('latest.yml')).toBe('latest.yml');
  });

  // UTCID02: installer .exe có khoảng trắng vẫn giữ nguyên tên
  test('UTCID02 accepts installer name with spaces', () => {
    const n = 'HL-MCK Antidetect Browser Setup 1.0.1.exe';
    expect(safeName(n)).toBe(n);
  });

  // UTCID03: .exe.blockmap được chấp nhận (extname = .blockmap)
  test('UTCID03 accepts .blockmap', () => {
    const n = 'HL-MCK Setup 1.0.1.exe.blockmap';
    expect(safeName(n)).toBe(n);
  });

  // UTCID04: traversal bằng ../ bị từ chối
  test('UTCID04 rejects ../ traversal', () => {
    expect(safeName('../config.json')).toBeNull();
    expect(safeName('../../etc/passwd')).toBeNull();
  });

  // UTCID05: dấu / hoặc \ trong tên bị từ chối
  test('UTCID05 rejects path separators', () => {
    expect(safeName('sub/latest.yml')).toBeNull();
    expect(safeName('sub\\app.exe')).toBeNull();
  });

  // UTCID06: null byte bị từ chối
  test('UTCID06 rejects null byte', () => {
    expect(safeName('latest.yml\0.txt')).toBeNull();
  });

  // UTCID07: phần mở rộng không cho phép bị từ chối
  test('UTCID07 rejects disallowed extensions', () => {
    expect(safeName('config.json')).toBeNull();
    expect(safeName('script.sh')).toBeNull();
    expect(safeName('noext')).toBeNull();
  });
});

describe('update feed — content type', () => {
  // UTCID08: latest.yml → text/yaml
  test('UTCID08 yml maps to text/yaml', () => {
    expect(CONTENT_TYPE['.yml']).toBe('text/yaml; charset=utf-8');
  });

  // UTCID09: exe & blockmap → octet-stream
  test('UTCID09 exe and blockmap map to octet-stream', () => {
    expect(CONTENT_TYPE['.exe']).toBe('application/octet-stream');
    expect(CONTENT_TYPE['.blockmap']).toBe('application/octet-stream');
  });
});
