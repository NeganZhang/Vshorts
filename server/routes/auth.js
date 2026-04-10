const { Router } = require('express');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { signToken, authRequired } = require('../middleware/auth');

const router = Router();

// ─── Rate limiting ─────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authLimiter);

// ─── Validation helpers ────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  if (!email || !email.trim()) return 'Email is required';
  if (!EMAIL_RE.test(email.trim())) return 'Invalid email format';
  if (email.trim().length > 255) return 'Email too long';
  return null;
}

function validatePassword(password) {
  if (!password) return 'Password is required';
  if (password.length < 6) return 'Password must be at least 6 characters';
  if (password.length > 128) return 'Password too long';
  return null;
}

// ─── Register ──────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr });

    const passErr = validatePassword(password);
    if (passErr) return res.status(400).json({ error: passErr });

    const cleanEmail = email.trim().toLowerCase();

    // Check duplicate
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const hash = await bcrypt.hash(password, 12);

    // Create user
    const id = uuid().slice(0, 16).replace(/-/g, '');
    db.prepare('INSERT INTO users (id, email, password) VALUES (?, ?, ?)')
      .run(id, cleanEmail, hash);

    const user = { id, email: cleanEmail };
    const token = signToken(user);

    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── Login ─────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Get current user ──────────────────────────
router.get('/me', authRequired, (req, res) => {
  const user = db.prepare(
    'SELECT u.id, u.email, u.created_at, s.plan, s.status as sub_status, s.current_period_end FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = ?'
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

module.exports = router;
