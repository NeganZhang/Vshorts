const { Router } = require('express');
const data = require('../data');
const { projectOwner } = require('../middleware/ownership');
const { generateSceneImage } = require('../services/imageGen');
const { splitScriptIntoScenes } = require('../services/claude');

const router = Router();

const SHOT_TYPES = ['Wide Shot', 'Medium Shot', 'Close-Up', 'Extreme CU', 'Over Shoulder', 'POV', 'Establishing', 'Low Angle', 'High Angle', 'Dutch Angle'];
const CAMERA_MOVES = ['Static', 'Pan Left', 'Pan Right', 'Tilt Up', 'Tilt Down', 'Dolly In', 'Dolly Out', 'Tracking', 'Crane', 'Handheld'];
const MAX_SCENES = 8;

router.use('/:projectId/scenes', projectOwner);

// ─── List scenes ───────────────────────────────
router.get('/:projectId/scenes', async (req, res, next) => {
  try { res.json(await data.scenes.list(req.params.projectId)); } catch (e) { next(e); }
});

// ─── Add scene ─────────────────────────────────
router.post('/:projectId/scenes', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const existing = await data.scenes.list(projectId);
    if (existing.length >= MAX_SCENES) return res.status(400).json({ error: `Maximum ${MAX_SCENES} scenes allowed` });

    const prompt = (req.body.prompt || '').slice(0, 1000);
    const shot_type = SHOT_TYPES.includes(req.body.shot_type) ? req.body.shot_type : 'Wide Shot';
    const camera_move = CAMERA_MOVES.includes(req.body.camera_move) ? req.body.camera_move : 'Static';
    const duration = (req.body.duration || '0-4s').slice(0, 20);
    const sort_order = typeof req.body.sort_order === 'number' ? req.body.sort_order : (await data.scenes.maxSortOrder(projectId)) + 1;

    const scene = await data.scenes.insert({ project_id: projectId, sort_order, prompt, shot_type, camera_move, duration });
    res.status(201).json(scene);
  } catch (e) { next(e); }
});

// ─── Update scene ──────────────────────────────
router.put('/:projectId/scenes/:sceneId', async (req, res, next) => {
  try {
    const { sceneId, projectId } = req.params;
    const scene = await data.scenes.get(sceneId);
    if (!scene || scene.project_id !== projectId) return res.status(404).json({ error: 'Scene not found' });

    const patch = {};
    if (req.body.prompt !== undefined) patch.prompt = String(req.body.prompt).slice(0, 1000);
    if (req.body.shot_type !== undefined && SHOT_TYPES.includes(req.body.shot_type)) patch.shot_type = req.body.shot_type;
    if (req.body.camera_move !== undefined && CAMERA_MOVES.includes(req.body.camera_move)) patch.camera_move = req.body.camera_move;
    if (req.body.duration !== undefined) patch.duration = String(req.body.duration).slice(0, 20);
    if (typeof req.body.sort_order === 'number') patch.sort_order = Math.max(0, Math.min(99, req.body.sort_order));

    const updated = Object.keys(patch).length ? await data.scenes.update(sceneId, patch) : scene;
    res.json(updated);
  } catch (e) { next(e); }
});

// ─── Delete scene ──────────────────────────────
router.delete('/:projectId/scenes/:sceneId', async (req, res, next) => {
  try {
    const removed = await data.scenes.remove(req.params.sceneId, req.params.projectId);
    if (!removed || removed.length === 0) return res.status(404).json({ error: 'Scene not found' });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

// ─── Generate image for one scene ──────────────
router.post('/:projectId/scenes/:sceneId/generate', async (req, res, next) => {
  try {
    const { sceneId, projectId } = req.params;
    const aspect = (req.body && req.body.aspect) || null;
    const referenceImage = (req.body && req.body.referenceImage) || null;
    const scene = await data.scenes.get(sceneId);
    if (!scene || scene.project_id !== projectId) return res.status(404).json({ error: 'Scene not found' });

    await data.scenes.setStatus(sceneId, 'generating');
    generateSceneImage(sceneId, scene, { aspect, referenceImage });
    res.json({ id: sceneId, status: 'generating' });
  } catch (e) { next(e); }
});

// ─── Generate all scenes ───────────────────────
router.post('/:projectId/scenes/generate-all', async (req, res, next) => {
  try {
    const aspect = (req.body && req.body.aspect) || null;
    const referenceImage = (req.body && req.body.referenceImage) || null;
    const scenes = await data.scenes.list(req.params.projectId);
    for (let i = 0; i < scenes.length; i++) {
      await data.scenes.setStatus(scenes[i].id, 'generating');
      setTimeout(() => generateSceneImage(scenes[i].id, scenes[i], { aspect, referenceImage }), i * 500);
    }
    res.json({ generating: scenes.length });
  } catch (e) { next(e); }
});

// ─── Auto-generate scenes from prompt ──────────
router.post('/:projectId/scenes/auto-generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const prompt = (req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (prompt.length > 2000) return res.status(400).json({ error: 'Prompt too long' });

    const numScenes = Math.min(MAX_SCENES, Math.max(2, parseInt(req.body.numScenes) || 4));
    const aspect = req.body.aspect || null;
    const referenceImage = req.body.referenceImage || null;

    // Prefer the LLM semantic split; fall back to a word-chunk split.
    let scenesData = null;
    try {
      const split = await splitScriptIntoScenes(prompt, numScenes);
      if (Array.isArray(split) && split.length === numScenes) scenesData = split;
    } catch (e) { console.warn('[auto-generate] splitter threw:', e.message); }

    if (!scenesData) {
      const words = prompt.split(/\s+/);
      const perScene = Math.ceil(words.length / numScenes);
      scenesData = [];
      for (let i = 0; i < numScenes; i++) {
        const chunk = words.slice(i * perScene, (i + 1) * perScene).join(' ');
        const startSec = i * Math.round(45 / numScenes);
        const endSec = (i + 1) * Math.round(45 / numScenes);
        scenesData.push({
          prompt: chunk || `Scene ${i + 1}`,
          shot_type: SHOT_TYPES[i % SHOT_TYPES.length],
          camera_move: CAMERA_MOVES[i % CAMERA_MOVES.length],
          duration: `${startSec}-${endSec}s`,
        });
      }
    }

    await data.scenes.deleteByProject(projectId);
    const rows = scenesData.map((s, i) => ({
      project_id: projectId, sort_order: i, prompt: s.prompt,
      shot_type: s.shot_type, camera_move: s.camera_move, duration: s.duration, status: 'generating',
    }));
    await data.scenes.insertMany(rows);

    const scenes = await data.scenes.list(projectId);
    scenes.forEach((scene, i) => setTimeout(() => generateSceneImage(scene.id, scene, { aspect, referenceImage }), i * 500));

    res.status(201).json(scenes);
  } catch (err) {
    console.error('[auto-generate] unexpected error:', err);
    res.status(500).json({ error: 'Auto-generate failed' });
  }
});

module.exports = router;
