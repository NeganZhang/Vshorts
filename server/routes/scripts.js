const { Router } = require('express');
const { v4: uuid } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { projectOwner } = require('../middleware/ownership');
const { generateScript } = require('../services/claude');

const router = Router();

// Rate limit script generation
const genLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,               // 10 requests per minute
  message: { error: 'Too many generation requests, slow down' },
});

// All script routes require project ownership
router.use('/:projectId/scripts', projectOwner);

// ─── Start script generation ───────────────────
router.post('/:projectId/scripts', genLimiter, (req, res) => {
  const { projectId } = req.params;
  const prompt = (req.body.prompt || '').trim();

  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
  if (prompt.length > 2000) return res.status(400).json({ error: 'Prompt too long (max 2000 chars)' });

  const id = uuid().slice(0, 16).replace(/-/g, '');
  db.prepare('INSERT INTO scripts (id, project_id, prompt, status) VALUES (?, ?, ?, ?)')
    .run(id, projectId, prompt, 'generating');

  db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);

  // Generate async (don't await — let client poll)
  generateScript(id, prompt);

  res.status(201).json({ id, status: 'generating' });
});

// ─── Get script (for polling) ──────────────────
router.get('/:projectId/scripts/:scriptId', (req, res) => {
  const script = db.prepare(
    'SELECT * FROM scripts WHERE id = ? AND project_id = ?'
  ).get(req.params.scriptId, req.params.projectId);

  if (!script) return res.status(404).json({ error: 'Script not found' });
  res.json(script);
});

// ─── List scripts ──────────────────────────────
router.get('/:projectId/scripts', (req, res) => {
  const scripts = db.prepare(
    'SELECT * FROM scripts WHERE project_id = ? ORDER BY created_at DESC'
  ).all(req.params.projectId);
  res.json(scripts);
});

module.exports = router;
