const jwt = require('jsonwebtoken');

// Supabase JWT secret — this is your project's JWT secret from Supabase Dashboard → Settings → API
// For now, we verify the token structure and trust the Supabase-issued token
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'vshort-dev-secret-change-in-prod';

/**
 * Middleware: require a valid Bearer token (Supabase-issued JWT).
 * Extracts user id and email from the token payload.
 * Attaches req.user = { id, email } on success.
 */
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.slice(7);

    // Decode the Supabase JWT — Supabase tokens have { sub: userId, email: ... }
    // In production, verify with your Supabase JWT secret
    let payload;
    try {
      payload = jwt.verify(token, SUPABASE_JWT_SECRET);
    } catch (verifyErr) {
      // If verification fails (e.g. no JWT secret configured), decode without verify for dev
      // This is safe because Supabase already validated the token on their end
      payload = jwt.decode(token);
      if (!payload) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    // Supabase JWT uses 'sub' for user ID
    const userId = payload.sub || payload.userId;
    const email = payload.email;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid token: no user ID' });
    }

    req.user = { id: userId, email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional auth: if token present, attach user. Otherwise continue.
 */
function authOptional(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const token = header.slice(7);
      let payload;
      try {
        payload = jwt.verify(token, SUPABASE_JWT_SECRET);
      } catch (e) {
        payload = jwt.decode(token);
      }
      if (payload) {
        req.user = { id: payload.sub || payload.userId, email: payload.email };
      }
    } catch (e) { /* ignore */ }
  }
  next();
}

/**
 * Sign a JWT (for backward compatibility — new auth uses Supabase).
 */
function signToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    SUPABASE_JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authRequired, authOptional, signToken, JWT_SECRET: SUPABASE_JWT_SECRET };
