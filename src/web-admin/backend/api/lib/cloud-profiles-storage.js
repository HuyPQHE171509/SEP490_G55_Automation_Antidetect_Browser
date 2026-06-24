import fs from 'fs/promises';
import path from 'path';

// Local storage fallback for profiles
const DATA_DIR = path.resolve('.data');
const PROFILES_FILE = path.join(DATA_DIR, 'cloud-profiles.json');

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {}
}

async function readProfiles() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(PROFILES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

async function writeProfiles(profiles) {
  await ensureDataDir();
  await fs.writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf-8');
}

export async function getUserProfiles(uid) {
  const all = await readProfiles();
  return all.filter(p => p.ownerId === uid);
}

export async function saveUserProfile(uid, profileData) {
  const all = await readProfiles();
  const idx = all.findIndex(p => p.id === profileData.id && p.ownerId === uid);
  
  const now = new Date().toISOString();
  
  if (idx !== -1) {
    all[idx] = { ...all[idx], ...profileData, ownerId: uid, updatedAt: now };
  } else {
    all.push({ ...profileData, ownerId: uid, createdAt: now, updatedAt: now });
  }
  
  await writeProfiles(all);
  return all.find(p => p.id === profileData.id);
}

export async function deleteUserProfile(uid, profileId) {
  const all = await readProfiles();
  const filtered = all.filter(p => !(p.id === profileId && p.ownerId === uid));
  await writeProfiles(filtered);
}
