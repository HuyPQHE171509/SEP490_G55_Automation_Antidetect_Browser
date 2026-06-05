/**
 * Public update-feed endpoint for electron-updater (no auth).
 *
 * electron-updater (generic provider) tải tuần tự:
 *   GET /api/updates/latest.yml                 metadata bản mới nhất
 *   GET /api/updates/<Installer>.exe            installer (hỗ trợ Range cho delta)
 *   GET /api/updates/<Installer>.exe.blockmap   bản đồ block để tải delta
 *
 * QUAN TRỌNG: dùng res.sendFile để Express tự xử lý HTTP Range (206 Partial
 * Content). Differential download của electron-updater fetch từng block bằng
 * Range request — nếu server không hỗ trợ Range thì delta sẽ fallback full.
 */
import { existsSync, statSync } from 'fs';
import { dirname, join, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPDATES_DIR = join(__dirname, '../uploads/updates');

const ALLOWED_EXT = new Set(['.yml', '.exe', '.blockmap']);

const CONTENT_TYPE = {
  '.yml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
};

/** Chỉ cho phép basename hợp lệ, chặn path traversal. */
function safeName(name) {
  const raw = String(name || '');
  // Chặn các chuỗi traversal trước khi lấy basename.
  if (raw.includes('..') || raw.includes('\0')) return null;
  const base = basename(raw);
  if (!base || base !== raw) return null; // có dấu / hoặc \ → từ chối
  const ext = extname(base).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return base;
}

export function serveUpdateFile(req, res) {
  const name = safeName(req.params.file);
  if (!name) return res.status(400).json({ error: 'Invalid file name' });

  const filePath = join(UPDATES_DIR, name);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return res.status(404).json({ error: 'Not found' });
  }

  const ext = extname(name).toLowerCase();
  res.setHeader('Content-Type', CONTENT_TYPE[ext] || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  // latest.yml phải luôn tươi để client thấy version mới ngay.
  res.setHeader('Cache-Control', ext === '.yml' ? 'no-cache' : 'public, max-age=86400');

  // sendFile tự xử lý Range / 206 / Content-Length / ETag.
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(err.status || 500).end();
    }
  });
}
