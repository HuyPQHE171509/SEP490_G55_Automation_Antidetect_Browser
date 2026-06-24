import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { getUserProfiles, saveUserProfile, deleteUserProfile } from './lib/cloud-profiles-storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, '../../uploads/profiles');

// Ensure directory
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Save as {uid}_{profileId}.zip
    const profileId = req.params.id;
    const uid = req.user.uid;
    cb(null, `${uid}_${profileId}.zip`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

export const uploadProfileDataMiddleware = upload.single('file');

/**
 * GET /api/cloud-profiles
 */
export async function getCloudProfiles(req, res) {
  try {
    const uid = req.user.uid;
    const profiles = await getUserProfiles(uid);
    return res.status(200).json({ success: true, profiles });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/cloud-profiles
 * Creates or updates a profile metadata
 */
export async function saveCloudProfile(req, res) {
  try {
    const uid = req.user.uid;
    const profileData = req.body;
    
    if (!profileData || !profileData.id) {
      return res.status(400).json({ error: 'Invalid profile data' });
    }
    
    const saved = await saveUserProfile(uid, profileData);
    return res.status(200).json({ success: true, profile: saved });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/cloud-profiles/:id/upload
 * Uploads the zipped profile data
 */
export async function uploadCloudProfileData(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Missing file (multipart field: file)' });
    }
    
    // The multer middleware already saved it to `${uid}_${profileId}.zip`
    return res.status(200).json({ success: true, message: 'Profile data uploaded successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/cloud-profiles/:id/download
 * Downloads the zipped profile data
 */
export async function downloadCloudProfileData(req, res) {
  try {
    const uid = req.user.uid;
    const profileId = req.params.id;
    const filePath = join(UPLOAD_DIR, `${uid}_${profileId}.zip`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Profile data not found in cloud storage.' });
    }
    
    return res.download(filePath, `${profileId}.zip`);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/cloud-profiles/:id
 */
export async function deleteCloudProfile(req, res) {
  try {
    const uid = req.user.uid;
    const profileId = req.params.id;
    
    await deleteUserProfile(uid, profileId);
    
    // Also delete the zip file if it exists
    const filePath = join(UPLOAD_DIR, `${uid}_${profileId}.zip`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
