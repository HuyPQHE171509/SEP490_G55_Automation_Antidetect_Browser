import { verifyFirebaseToken } from './lib/firebaseAdmin.js';

/**
 * requireUser middleware
 * Validates the Authorization: Bearer <token> header.
 * Sets req.user = { uid, email } if valid.
 */
export async function requireUser(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token.' });
  }
  const token = auth.slice(7);

  try {
    const decoded = await verifyFirebaseToken(token);
    if (!decoded || !decoded.uid) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    
    req.user = decoded; // { uid, email }
    return next();
  } catch (err) {
    console.error('[requireUser]', err.message);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
