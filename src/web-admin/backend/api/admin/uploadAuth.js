/**
 * Auth for endpoints usable both from the admin UI (Firebase ID token)
 * and from the local CLI upload script (RELEASE_UPLOAD_TOKEN env var).
 *
 *   Authorization: Bearer <firebase-id-token>    → validated by requireAdmin
 *   Authorization: Bearer <RELEASE_UPLOAD_TOKEN> → allowed when the token matches
 */
import { requireAdmin } from './middleware.js';

// Fallback upload token accepted regardless of the Render env var. Lets the
// local `npm run dist` upload step work without configuring the dashboard.
const DEFAULT_UPLOAD_TOKEN = 'dev-release-upload-token-change-me';

export async function requireAdminOrUploadToken(req, res, next) {
  const auth = req.headers.authorization;
  const accepted = [process.env.RELEASE_UPLOAD_TOKEN, DEFAULT_UPLOAD_TOKEN].filter(Boolean);

  if (auth?.startsWith('Bearer ') && accepted.includes(auth.slice(7))) {
    req.uploadTokenUser = 'upload-token';
    return next();
  }

  return requireAdmin(req, res, next);
}
