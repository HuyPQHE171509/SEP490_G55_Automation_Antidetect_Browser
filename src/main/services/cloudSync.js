const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const extract = require('extract-zip');
const FormData = require('form-data');
const { appendLog } = require('../logging/logger');
const { getDataRoot } = require('../storage/paths');
const { loadSettings } = require('../storage/settings');

// Optional: get base url from settings or hardcode local backend
function getBackendUrl() {
  const settings = loadSettings();
  return settings.backendUrl || 'http://localhost:3000';
}

/**
 * Zips a profile's data files to a temporary file
 */
function zipProfileDir(profileId, destZipPath) {
  return new Promise((resolve, reject) => {
    const root = getDataRoot();
    const filesToZip = [
      { path: path.join(root, 'profiles', `${profileId}-storage.json`), name: `profiles/${profileId}-storage.json` },
      { path: path.join(root, 'session-tabs', `${profileId}.json`), name: `session-tabs/${profileId}.json` },
      { path: path.join(root, 'logs', `${profileId}.log`), name: `logs/${profileId}.log` }
    ];

    let hasAnyFile = false;
    for (const f of filesToZip) {
      if (fs.existsSync(f.path)) {
        hasAnyFile = true;
        break;
      }
    }

    if (!hasAnyFile) {
      return resolve(false); // nothing to zip
    }

    const output = fs.createWriteStream(destZipPath);
    const archive = archiver('zip', { zlib: { level: 5 } });

    output.on('close', () => resolve(true));
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    for (const f of filesToZip) {
      if (fs.existsSync(f.path)) {
        archive.file(f.path, { name: f.name });
      }
    }
    archive.finalize();
  });
}

/**
 * Push profile to cloud
 */
async function pushProfileData(profileId, token) {
  if (!token) return { success: false, error: 'Not authenticated' };
  
  const tmpZipPath = path.join(getDataRoot(), `tmp_push_${profileId}.zip`);
  
  try {
    const hasData = await zipProfileDir(profileId, tmpZipPath);
    if (!hasData) {
      appendLog(profileId, 'No profile data to push.');
      return { success: true };
    }

    const form = new FormData();
    form.append('profileFile', fs.createReadStream(tmpZipPath));

    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/cloud-profiles/${profileId}/push`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      // When using FormData with native fetch, do NOT set Content-Type manually.
      // fetch will set it automatically with the correct boundary.
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Push failed: ${response.status} ${errorText}`);
    }

    appendLog(profileId, 'Profile data pushed to cloud successfully.');
    return { success: true };
  } catch (err) {
    appendLog(profileId, `Failed to push profile: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    if (fs.existsSync(tmpZipPath)) {
      try { fs.unlinkSync(tmpZipPath); } catch {}
    }
  }
}

/**
 * Pull profile from cloud
 */
async function pullProfileData(profileId, token) {
  if (!token) return { success: false, error: 'Not authenticated' };
  
  const tmpZipPath = path.join(getDataRoot(), `tmp_pull_${profileId}.zip`);
  const dataRoot = getDataRoot();

  try {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/cloud-profiles/${profileId}/pull`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 404) {
      appendLog(profileId, 'No profile data found in cloud (new profile).');
      return { success: true };
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pull failed: ${response.status} ${errorText}`);
    }

    // Save to temp zip file
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(tmpZipPath, Buffer.from(buffer));

    // Extract zip directly to dataRoot (the zip already contains profiles/, session-tabs/, etc.)
    await extract(tmpZipPath, { dir: dataRoot });

    appendLog(profileId, 'Profile data pulled from cloud successfully.');
    return { success: true };
  } catch (err) {
    appendLog(profileId, `Failed to pull profile: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    if (fs.existsSync(tmpZipPath)) {
      try { fs.unlinkSync(tmpZipPath); } catch {}
    }
  }
}

module.exports = {
  pushProfileData,
  pullProfileData
};
