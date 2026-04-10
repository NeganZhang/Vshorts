const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'vshort-dev-secret-change-in-prod';

/**
 * Middleware: require a valid JWT Bearer token.
 * Attaches req.user = { id, email } on success.
 */
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.userId, email: payload.email };
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
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      req.user = { id: payload.userId, email: payload.email };
    } catch (e) { /* ignore invalid token */ }
  }
  next();
}

/**
 * Sign a JWT for a user.
 */
function signToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authRequired, authOptional, signToken, JWT_SECRET };
