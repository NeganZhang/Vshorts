const { Router } = require('express');
const data = require('../data');
const { authRequired, authOptional } = require('../middleware/auth');
const { generateSceneImage } = require('../services/imageGen');
const { buildScenesData } = require('../services/sceneSplit');

const router = Router();

// Strip the secret prompt before sending a template to the client. The
// prompt_template is what makes a template valuable — it never leaves the server.
function publicView(t) {
  const { prompt_template, ...rest } = t;
  return { ...rest, has_prompt: !!prompt_template };
}

// Fill a stored prompt template's {{placeholders}} with the user's inputs, then
// append the style directive. This runs server-side only.
function fillTemplate(tpl, inputs, defaults) {
  let out = (tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (inputs[k] != null ? String(inputs[k]) : ''));
  if (defaults && defaults.stylePrompt && !/\bstyle\b/i.test(out)) out += ` Style: ${defaults.stylePrompt}.`;
  return out.trim().slice(0, 2000);
}

// ─── GET /api/templates — gallery (official + public + own); prompt hidden ──
router.get('/', authOptional, async (req, res, next) => {
  try {
    const list = await data.templates.listVisible(req.user && req.user.id);
    res.json(list.map(publicView));
  } catch (e) { next(e); }
});

// ─── POST /api/templates — publish a template (prompt stored, locked) ───────
router.post('/', authRequired, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title || !b.prompt_template) return res.status(400).json({ error: 'title and prompt_template are required' });
    const base = String(b.slug || b.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'template';
    const t = await data.templates.create(req.user.id, {
      slug: `${base}-${Date.now().toString(36)}`,
      title: String(b.title).slice(0, 80),
      category: b.category ? String(b.category).slice(0, 40) : null,
      accent: typeof b.accent === 'string' ? b.accent.slice(0, 9) : '#ff5c2b',
      description: b.description ? String(b.description).slice(0, 300) : null,
      reference_mode: ['text', 'image', 'both'].includes(b.reference_mode) ? b.reference_mode : 'text',
      defaults: b.defaults && typeof b.defaults === 'object' ? b.defaults : {},
      input_schema: Array.isArray(b.input_schema) ? b.input_schema.slice(0, 8) : [],
      prompt_template: String(b.prompt_template).slice(0, 4000),
      is_public: !!b.is_public,
      is_official: false,
    });
    res.status(201).json(publicView(t));
  } catch (e) { next(e); }
});

// ─── POST /api/templates/:id/run — server-side run (prompt never sent out) ──
router.post('/:id/run', authRequired, async (req, res, next) => {
  try {
    const tpl = await data.templates.get(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    if (!(tpl.is_official || tpl.is_public || tpl.created_by === req.user.id)) {
      return res.status(403).json({ error: 'Not allowed to run this template' });
    }

    const b = req.body || {};
    const inputs = (b.inputs && typeof b.inputs === 'object') ? b.inputs : {};
    const referenceImage = b.referenceImage || null;
    const d = tpl.defaults || {};
    const aspect = b.aspect || d.aspect || '9:16';
    const numScenes = Math.min(8, Math.max(2, parseInt(b.numScenes || d.sceneCount, 10) || 5));

    const prompt = fillTemplate(tpl.prompt_template, inputs, d);
    if (!prompt) return res.status(400).json({ error: 'Template produced an empty prompt' });

    const proj = await data.projects.create(req.user.id, tpl.title);
    const scenesData = await buildScenesData(prompt, numScenes, { hasReference: !!referenceImage });
    await data.scenes.deleteByProject(proj.id);
    await data.scenes.insertMany(scenesData.map((s, i) => ({
      project_id: proj.id, sort_order: i, prompt: s.prompt,
      shot_type: s.shot_type, camera_move: s.camera_move, duration: s.duration, status: 'generating',
    })));
    const scenes = await data.scenes.list(proj.id);
    scenes.forEach((scene, i) => setTimeout(() => generateSceneImage(scene.id, scene, { aspect, referenceImage }), i * 500));

    res.status(201).json({ projectId: proj.id, scenes });
  } catch (e) { next(e); }
});

module.exports = router;
