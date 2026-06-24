/**
 * Update-feed management — upload / list / delete các file feed của
 * electron-updater (latest.yml, installer .exe, .exe.blockmap).
 *
 * Storage:
 *   api/uploads/updates/<original filename>   — phục vụ nguyên tên cho electron-updater
 *
 * Endpoints (admin hoặc upload-token):
 *   GET    /api/admin/updates        liệt kê file feed hiện có
 *   POST   /api/admin/updates        multipart upload (field: files, nhiều file)
 *   DELETE /api/admin/updates/:file  xoá 1 file feed theo tên
 *
 * Lưu ý: tên file KHÔNG được đổi vì latest.yml tham chiếu installer theo đúng
 * tên — đổi tên sẽ làm electron-updater 404 khi tải.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { dirname, join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPDATES_DIR = join(__dirname, '../../uploads/updates');

const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500 MB
const ALLOWED_EXT = new Set(['.yml', '.exe', '.blockmap']);

function ensureDir() {
  if (!existsSync(UPDATES_DIR)) mkdirSync(UPDATES_DIR, { recursive: true });
}

/** basename hợp lệ, chặn traversal; giữ nguyên tên gốc (kể cả khoảng trắng). */
function safeName(name) {
  const raw = String(name || '');
  if (raw.includes('..') || raw.includes('\0')) return null;
  const base = basename(raw);
  if (!base) return null;
  const ext = extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return base;
}

// ── multer: lưu thẳng vào uploads/updates với tên gốc ────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir();
    cb(null, UPDATES_DIR);
  },
  filename: (_req, file, cb) => {
    const safe = safeName(file.originalname);
    if (!safe) return cb(new Error(`Unsupported file: ${file.originalname}`));
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`Unsupported file type: ${ext || 'unknown'}`));
    cb(null, true);
  },
});

// Cho phép upload nhiều file một lần (latest.yml + exe + blockmap).
export const uploadUpdatesMiddleware = upload.array('files', 10);

// ── Handlers ─────────────────────────────────────────────────────────────────

export function listUpdateFiles(_req, res) {
  ensureDir();
  let files = [];
  try {
    files = readdirSync(UPDATES_DIR)
      .filter((f) => ALLOWED_EXT.has(extname(f).toLowerCase()))
      .map((f) => {
        const st = statSync(join(UPDATES_DIR, f));
        return { name: f, size: st.size, modifiedAt: st.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  } catch (e) {
    console.warn('[updates] list error:', e?.message);
  }
  res.status(200).json({ files });
}

export function createUpdateFiles(req, res) {
  const uploaded = Array.isArray(req.files) ? req.files : [];
  if (uploaded.length === 0) {
    return res.status(400).json({ error: 'Missing files (multipart field: files)' });
  }
  const files = uploaded.map((f) => ({ name: f.filename, size: f.size }));
  console.log(
    `[updates] uploaded ${files.length} feed file(s): ${files.map((f) => f.name).join(', ')} by ${req.adminEmail || req.uploadTokenUser || 'unknown'}`,
  );
  res.status(201).json({ ok: true, files });
}

export function deleteUpdateFile(req, res) {
  const name = safeName(req.params.file);
  if (!name) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = join(UPDATES_DIR, name);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  try {
    unlinkSync(filePath);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Delete failed' });
  }
  res.status(200).json({ ok: true, name });
}
