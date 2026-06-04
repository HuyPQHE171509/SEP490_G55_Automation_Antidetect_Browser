// tests/unit/web-admin/versionManagement.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Tests for the version / auto-update flow hardening:
//   1. UpdateService — SHA256 verification before running the installer.
//   2. UpdateService — installer-type guard (only .exe/.msi).
//   3. admin/releases — syncAppVersion only bumps config when newer.
//
// Style mirrors tests/unit/web-admin/checkoutEmailBinding.test.js — small
// in-test helpers reproduce production logic against real crypto/fs temp files.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ════════════════════════════════════════════════════════════════════════════
// Helpers that mirror production logic
// ════════════════════════════════════════════════════════════════════════════

// Mirrors UpdateService.sha256OfFile
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Mirrors the verify branch inside UpdateService.downloadAndInstall: returns
// true when the checksum matches (or when release has no sha256), throws on
// mismatch.
async function verifyChecksum(destPath, release) {
  if (!release.sha256) return true;
  const actual = await sha256OfFile(destPath);
  if (actual.toLowerCase() !== String(release.sha256).toLowerCase()) {
    throw new Error(`Checksum mismatch: expected ${release.sha256}, got ${actual}`);
  }
  return true;
}

// Mirrors the installer-type guard in UpdateService.downloadAndInstall.
function assertInstallerSupported(destPath) {
  const ext = path.extname(destPath).toLowerCase();
  if (ext !== '.exe' && ext !== '.msi') {
    throw new Error(`Unsupported installer type: ${ext || 'unknown'} (expected .exe/.msi)`);
  }
  return true;
}

// Mirrors admin/releases.parseSemver + syncAppVersion.
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '0.0.0'));
  return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : [0, 0, 0];
}

function syncAppVersion(config, version) {
  const [nMaj, nMin, nPat] = parseSemver(version);
  const [cMaj, cMin, cPat] = parseSemver(config.appVersion || '0.0.0');
  const isNewer =
    nMaj > cMaj ||
    (nMaj === cMaj && nMin > cMin) ||
    (nMaj === cMaj && nMin === cMin && nPat > cPat);
  if (isNewer) {
    return { ...config, appVersion: version };
  }
  return config;
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

describe('UpdateService — SHA256 verification', () => {
  let tmpDir;
  let filePath;
  let realSha;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hlmck-upd-'));
    filePath = path.join(tmpDir, 'installer.exe');
    fs.writeFileSync(filePath, 'fake installer bytes');
    realSha = crypto.createHash('sha256').update('fake installer bytes').digest('hex');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('UTCID01 — matching checksum passes', async () => {
    await expect(verifyChecksum(filePath, { sha256: realSha })).resolves.toBe(true);
  });

  test('UTCID02 — checksum is case-insensitive', async () => {
    await expect(
      verifyChecksum(filePath, { sha256: realSha.toUpperCase() }),
    ).resolves.toBe(true);
  });

  test('UTCID03 — mismatching checksum throws', async () => {
    await expect(
      verifyChecksum(filePath, { sha256: 'deadbeef' }),
    ).rejects.toThrow(/Checksum mismatch/);
  });

  test('UTCID04 — tampered file is rejected', async () => {
    fs.writeFileSync(filePath, 'tampered bytes'); // changes the hash
    await expect(
      verifyChecksum(filePath, { sha256: realSha }),
    ).rejects.toThrow(/Checksum mismatch/);
  });

  test('UTCID05 — release without sha256 skips verification', async () => {
    await expect(verifyChecksum(filePath, {})).resolves.toBe(true);
  });
});

describe('UpdateService — installer type guard', () => {
  test('UTCID06 — .exe is accepted', () => {
    expect(assertInstallerSupported('C:/tmp/Setup-1.2.3.exe')).toBe(true);
  });

  test('UTCID07 — .msi is accepted', () => {
    expect(assertInstallerSupported('C:/tmp/Setup-1.2.3.msi')).toBe(true);
  });

  test('UTCID08 — .zip is rejected', () => {
    expect(() => assertInstallerSupported('C:/tmp/Portable-1.2.3.zip')).toThrow(
      /Unsupported installer type/,
    );
  });

  test('UTCID09 — extensionless path is rejected', () => {
    expect(() => assertInstallerSupported('C:/tmp/installer')).toThrow(
      /Unsupported installer type/,
    );
  });
});

describe('admin/releases — syncAppVersion', () => {
  test('UTCID10 — newer version bumps appVersion', () => {
    const out = syncAppVersion({ appVersion: '1.0.0' }, '1.2.0');
    expect(out.appVersion).toBe('1.2.0');
  });

  test('UTCID11 — older version does NOT downgrade', () => {
    const out = syncAppVersion({ appVersion: '2.0.0' }, '1.9.9');
    expect(out.appVersion).toBe('2.0.0');
  });

  test('UTCID12 — equal version is a no-op', () => {
    const out = syncAppVersion({ appVersion: '1.5.0' }, '1.5.0');
    expect(out.appVersion).toBe('1.5.0');
  });

  test('UTCID13 — missing appVersion is treated as 0.0.0 and gets set', () => {
    const out = syncAppVersion({}, '1.0.0');
    expect(out.appVersion).toBe('1.0.0');
  });

  test('UTCID14 — patch-level bump is detected', () => {
    const out = syncAppVersion({ appVersion: '1.0.0' }, '1.0.1');
    expect(out.appVersion).toBe('1.0.1');
  });

  test('UTCID15 — other config keys are preserved', () => {
    const out = syncAppVersion(
      { appVersion: '1.0.0', proPriceVnd: 299000, maintenanceMode: false },
      '1.1.0',
    );
    expect(out).toEqual({
      appVersion: '1.1.0',
      proPriceVnd: 299000,
      maintenanceMode: false,
    });
  });
});
