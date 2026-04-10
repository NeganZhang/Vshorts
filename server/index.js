require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { authRequired } = require('./middleware/auth');

// Initialize DB (creates tables on first run)
require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Global rate limit ─────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ─── CORS ──────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
}));

// ─── Stripe Webhook (MUST be before express.json()) ──
app.use('/api/webhooks/stripe', require('./routes/webhook'));

// ─── Body parser ───────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ─── Static files ──────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Public API Routes (no auth) ───────────────
app.use('/api/auth', require('./routes/auth'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Protected API Routes (auth required) ──────
const { router: billingRouter } = require('./routes/billing');
app.use('/api/billing', billingRouter);

app.use('/api/projects', authRequired, require('./routes/projects'));
app.use('/api/projects', authRequired, require('./routes/scripts'));
app.use('/api/projects', authRequired, require('./routes/scenes'));
app.use('/api/projects', authRequired, require('./routes/clips'));
app.use('/api/projects', authRequired, require('./routes/editJobs'));

// ─── SPA fallback ──────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Error handler ─────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`VSHORT server running on http://localhost:${PORT}`);
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('  Stripe: not configured (add STRIPE_SECRET_KEY to .env)');
  } else {
    console.log('  Stripe: configured');
  }
});
