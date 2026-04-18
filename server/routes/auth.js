const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { authRequired } = require('../middleware/auth');

const router = Router();

// ─── Supabase Admin Client (service_role key — server only) ──
const supabaseUrl = process.env.SUPABASE_URL || 'https://seolaotjqmyrtujehbfo.supabase.co';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseAdmin = null;
if (serviceKey) {
  supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

// ─── Rate limiting ─────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authLimiter);

// ─── Validation ────────────────────────────────
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

const SEX_VALUES = ['male', 'female', 'other', 'prefer_not_to_say'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeNickname(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > 40) return s.slice(0, 40);
  return s;
}

function sanitizeBirthday(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!DATE_RE.test(s)) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // basic sanity: must be before today and after 1900
  const year = d.getUTCFullYear();
  if (year < 1900 || d > new Date()) return null;
  return s;
}

function sanitizeSex(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return SEX_VALUES.includes(s) ? s : null;
}

// ─── Register (via Supabase Admin — no email, auto-confirmed) ──
router.post('/register', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase not configured — add SUPABASE_SERVICE_ROLE_KEY to .env' });
  }

  try {
    const { email, password, nickname, birthday, sex, disclaimerAccepted } = req.body;

    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr });

    const passErr = validatePassword(password);
    if (passErr) return res.status(400).json({ error: passErr });

    if (!disclaimerAccepted) {
      return res.status(400).json({ error: 'You must accept the disclaimer to sign up' });
    }

    const cleanEmail   = email.trim().toLowerCase();
    const cleanNick    = sanitizeNickname(nickname);
    const cleanBirth   = sanitizeBirthday(birthday);
    const cleanSex     = sanitizeSex(sex);
    const acceptedAt   = new Date().toISOString();

    // Create user via Admin API — auto-confirmed, no email sent.
    // Profile fields are passed as user_metadata so the handle_new_user()
    // DB trigger can copy them into public.profiles atomically.
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        nickname: cleanNick || undefined,
        birthday: cleanBirth || undefined,
        sex:      cleanSex  || undefined,
        disclaimer_accepted_at: acceptedAt,
      },
    });

    if (error) {
      if (error.message.includes('already been registered')) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      return res.status(400).json({ error: error.message });
    }

    // Now sign them in to get a session token
    const { data: signInData, error: signInErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: cleanEmail,
    });

    // Generate a session by signing in with password
    // Use a separate anon client for this
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: session, error: sessErr } = await anonClient.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (sessErr) {
      console.error('Sign-in after register error:', sessErr);
      return res.status(500).json({ error: 'Account created but login failed. Try logging in manually.' });
    }

    // Upsert profile row as a safety net — works even when the DB
    // trigger isn't (re)installed yet on existing Supabase projects.
    try {
      await supabaseAdmin.from('profiles').upsert({
        id:                     session.user.id,
        email:                  cleanEmail,
        nickname:               cleanNick,
        birthday:               cleanBirth,
        sex:                    cleanSex,
        disclaimer_accepted_at: acceptedAt,
      }, { onConflict: 'id' });
    } catch (e) {
      console.warn('Profile upsert after signup failed:', e.message);
    }

    res.status(201).json({
      user: { id: session.user.id, email: session.user.email },
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
      expires_in: session.session.expires_in,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── Login (via Supabase — returns session tokens) ──
router.post('/login', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
    const anonClient = createClient(supabaseUrl, anonKey);

    const { data, error } = await anonClient.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({
      user: { id: data.user.id, email: data.user.email },
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Get current user (auth + profile) ─────────
router.get('/me', authRequired, async (req, res) => {
  if (!supabaseAdmin) {
    return res.json({ id: req.user.id, email: req.user.email });
  }

  const [{ data: userData }, { data: profile }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(req.user.id),
    supabaseAdmin.from('profiles').select('*').eq('id', req.user.id).maybeSingle(),
  ]);

  const authUser = userData?.user;
  res.json({
    id:                     req.user.id,
    email:                  authUser?.email || req.user.email,
    created_at:             authUser?.created_at,
    nickname:               profile?.nickname || null,
    birthday:               profile?.birthday || null,
    sex:                    profile?.sex || null,
    disclaimer_accepted_at: profile?.disclaimer_accepted_at || null,
  });
});

// ─── Update profile (nickname / birthday / sex) ─
router.patch('/profile', authRequired, async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  const { nickname, birthday, sex } = req.body || {};
  const update = {};

  if (nickname !== undefined) update.nickname = sanitizeNickname(nickname);
  if (birthday !== undefined) update.birthday = birthday === null || birthday === '' ? null : sanitizeBirthday(birthday);
  if (sex      !== undefined) update.sex      = sex      === null || sex      === '' ? null : sanitizeSex(sex);

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  // Reject explicitly-invalid values (was provided but didn't sanitize)
  if (birthday !== undefined && birthday !== null && birthday !== '' && update.birthday === null) {
    return res.status(400).json({ error: 'Invalid birthday (use YYYY-MM-DD, between 1900 and today)' });
  }
  if (sex !== undefined && sex !== null && sex !== '' && update.sex === null) {
    return res.status(400).json({ error: 'Invalid sex value' });
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', req.user.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }

  res.json({
    id:       req.user.id,
    nickname: data?.nickname || null,
    birthday: data?.birthday || null,
    sex:      data?.sex || null,
  });
});

module.exports = router;
