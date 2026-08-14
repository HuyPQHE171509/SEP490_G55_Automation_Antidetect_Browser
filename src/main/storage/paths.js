const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let __dataRoot = null;

function getUserDataFallback() {
  if (app && typeof app.getPath === 'function') {
    try { return app.getPath('userData'); } catch {}
  }
  return path.join(process.cwd(), '.app_data');
}

function getDataRoot() {
  if (__dataRoot) return __dataRoot;
  try {
    const isDev = process.env.NODE_ENV === 'development' || !app?.isPackaged;
    const userData = getUserDataFallback();
    const exeDir = (app && typeof app.getPath === 'function') ? path.dirname(app.getPath('exe')) : process.cwd();
    // In dev: dùng userData/dev-data để tránh trigger electronmon reload.
    // In prod/exe: ưu tiên portable 'data' cùng cấp với file exe, nếu không có quyền ghi (vd trong Program Files) thì tự động chuyển về userData/data.
    const base = isDev
      ? path.join(userData, 'dev-data')
      : path.join(exeDir, 'data');
    fs.mkdirSync(base, { recursive: true });
    
    // Kiểm tra quyền ghi thực tế
    const testFile = path.join(base, '.write_check');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);

    __dataRoot = base;
    return __dataRoot;
  } catch (e) {
    try {
      const fb = path.join(getUserDataFallback(), 'data');
      fs.mkdirSync(fb, { recursive: true });
      __dataRoot = fb;
      return __dataRoot;
    } catch { }
  }
  __dataRoot = getUserDataFallback();
  return __dataRoot;
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch { }
}

function storageStatePath(profileId) {
  const dir = path.join(getDataRoot(), 'profiles');
  ensureDir(dir);
  return path.join(dir, `${profileId}-storage.json`);
}

function logPath(profileId) {
  const dir = path.join(getDataRoot(), 'logs');
  ensureDir(dir);
  return path.join(dir, `${profileId}.log`);
}

function auditLogPath() {
  const dir = path.join(getDataRoot(), 'logs');
  ensureDir(dir);
  return path.join(dir, 'system_audit.log');
}


function profilesFilePath() {
  return path.join(getDataRoot(), 'profiles.json');
}

function settingsFilePath() {
  return path.join(getDataRoot(), 'settings.json');
}

function presetsFilePath() {
  return path.join(getDataRoot(), 'presets.json');
}

function scriptsFilePath() {
  return path.join(getDataRoot(), 'scripts.json');
}

function proxiesFilePath() {
  return path.join(getDataRoot(), 'proxies.json');
}

function initializeDataFiles() {
  // migrate legacy files from userData to data root (one-time)
  try {
    const legacyProfiles = path.join(app.getPath('userData'), 'profiles.json');
    const legacySettings = path.join(app.getPath('userData'), 'settings.json');
    const newProfiles = profilesFilePath();
    const newSettings = settingsFilePath();
    if (!fs.existsSync(newProfiles) && fs.existsSync(legacyProfiles)) {
      try { fs.copyFileSync(legacyProfiles, newProfiles); } catch { }
    }
    if (!fs.existsSync(newSettings) && fs.existsSync(legacySettings)) {
      try { fs.copyFileSync(legacySettings, newSettings); } catch { }
    }
    if (!fs.existsSync(newProfiles)) {
      try { fs.mkdirSync(path.dirname(newProfiles), { recursive: true }); } catch { }
      fs.writeFileSync(newProfiles, JSON.stringify([]));
    }
    const newProxies = proxiesFilePath();
    if (!fs.existsSync(newProxies)) {
      try { fs.mkdirSync(path.dirname(newProxies), { recursive: true }); } catch { }
      fs.writeFileSync(newProxies, JSON.stringify([]));
    }
    return { profilesPath: newProfiles };
  } catch (e) {
    const p = profilesFilePath();
    if (!fs.existsSync(p)) {
      try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch { }
      fs.writeFileSync(p, JSON.stringify([]));
    }
    return { profilesPath: p };
  }
}

function getDownloadsDir() {
  const dir = path.join(getDataRoot(), 'downloads');
  ensureDir(dir);
  return dir;
}

function getScreenshotsDir() {
  const dir = path.join(getDataRoot(), 'screenshots');
  ensureDir(dir);
  return dir;
}

function getExportsDir() {
  const dir = path.join(getDataRoot(), 'exports');
  ensureDir(dir);
  return dir;
}

module.exports = {
  getDataRoot,
  ensureDir,
  storageStatePath,
  logPath,
  auditLogPath,
  profilesFilePath,
  settingsFilePath,
  presetsFilePath,
  scriptsFilePath,
  proxiesFilePath,
  getDownloadsDir,
  getScreenshotsDir,
  getExportsDir,
  initializeDataFiles,
};
