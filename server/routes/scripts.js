const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const data = require('../data');
const { projectOwner } = require('../middleware/ownership');
const { generateScript } = require('../services/claude');

const router = Router();

const genLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many generation requests, slow down' },
});

router.use('/:projectId/scripts', projectOwner);

// ─── Start script generation ───────────────────
router.post('/:projectId/scripts', genLimiter, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const prompt = (req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (prompt.length > 2000) return res.status(400).json({ error: 'Prompt too long (max 2000 chars)' });

    const script = await data.scripts.insert(projectId, prompt);
    await data.projects.touch(projectId);

    generateScript(script.id, prompt); // async; client polls

    res.status(201).json({ id: script.id, status: 'generating' });
  } catch (e) { next(e); }
});

// ─── Get script (for polling) ──────────────────
router.get('/:projectId/scripts/:scriptId', async (req, res, next) => {
  try {
    const script = await data.scripts.get(req.params.scriptId, req.params.projectId);
    if (!script) return res.status(404).json({ error: 'Script not found' });
    res.json(script);
  } catch (e) { next(e); }
});

// ─── List scripts ──────────────────────────────
router.get('/:projectId/scripts', async (req, res, next) => {
  try { res.json(await data.scripts.listByProject(req.params.projectId)); } catch (e) { next(e); }
});

module.exports = router;
