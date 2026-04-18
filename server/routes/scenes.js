const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { projectOwner } = require('../middleware/ownership');
const { generateSceneImage } = require('../services/imageGen');
const { splitScriptIntoScenes } = require('../services/claude');

const router = Router();

// ─── Validation constants ──────────────────────
const SHOT_TYPES = ['Wide Shot', 'Medium Shot', 'Close-Up', 'Extreme CU', 'Over Shoulder', 'POV', 'Establishing', 'Low Angle', 'High Angle', 'Dutch Angle'];
const CAMERA_MOVES = ['Static', 'Pan Left', 'Pan Right', 'Tilt Up', 'Tilt Down', 'Dolly In', 'Dolly Out', 'Tracking', 'Crane', 'Handheld'];
const MAX_SCENES = 8;

// All scene routes require project ownership
router.use('/:projectId/scenes', projectOwner);

// ─── List scenes ───────────────────────────────
router.get('/:projectId/scenes', (req, res) => {
  const scenes = db.prepare(
    'SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order'
  ).all(req.params.projectId);
  res.json(scenes);
});

// ─── Add scene ─────────────────────────────────
router.post('/:projectId/scenes', (req, res) => {
  const { projectId } = req.params;

  // Check max scenes limit
  const count = db.prepare('SELECT COUNT(*) as c FROM scenes WHERE project_id = ?').get(projectId).c;
  if (count >= MAX_SCENES) {
    return res.status(400).json({ error: `Maximum ${MAX_SCENES} scenes allowed` });
  }

  const prompt = (req.body.prompt || '').slice(0, 1000);
  const shot_type = SHOT_TYPES.includes(req.body.shot_type) ? req.body.shot_type : 'Wide Shot';
  const camera_move = CAMERA_MOVES.includes(req.body.camera_move) ? req.body.camera_move : 'Static';
  const duration = (req.body.duration || '0-4s').slice(0, 20);

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as m FROM scenes WHERE project_id = ?'
  ).get(projectId).m;

  const sort_order = typeof req.body.sort_order === 'number' ? req.body.sort_order : maxOrder + 1;
  const id = uuid().slice(0, 16).replace(/-/g, '');

  db.prepare(`INSERT INTO scenes (id, project_id, sort_order, prompt, shot_type, camera_move, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, sort_order, prompt, shot_type, camera_move, duration);

  const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id);
  res.status(201).json(scene);
});

// ─── Update scene ──────────────────────────────
router.put('/:projectId/scenes/:sceneId', (req, res) => {
  const { sceneId, projectId } = req.params;
  const scene = db.prepare(
    'SELECT * FROM scenes WHERE id = ? AND project_id = ?'
  ).get(sceneId, projectId);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });

  // Whitelist allowed fields and validate
  const updates = [];
  const values = [];

  if (req.body.prompt !== undefined) {
    updates.push('prompt = ?');
    values.push(String(req.body.prompt).slice(0, 1000));
  }
  if (req.body.shot_type !== undefined && SHOT_TYPES.includes(req.body.shot_type)) {
    updates.push('shot_type = ?');
    values.push(req.body.shot_type);
  }
  if (req.body.camera_move !== undefined && CAMERA_MOVES.includes(req.body.camera_move)) {
    updates.push('camera_move = ?');
    values.push(req.body.camera_move);
  }
  if (req.body.duration !== undefined) {
    updates.push('duration = ?');
    values.push(String(req.body.duration).slice(0, 20));
  }
  if (typeof req.body.sort_order === 'number') {
    updates.push('sort_order = ?');
    values.push(Math.max(0, Math.min(99, req.body.sort_order)));
  }

  if (updates.length > 0) {
    values.push(sceneId);
    db.prepare(`UPDATE scenes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId);
  res.json(updated);
});

// ─── Delete scene ──────────────────────────────
router.delete('/:projectId/scenes/:sceneId', (req, res) => {
  const result = db.prepare(
    'DELETE FROM scenes WHERE id = ? AND project_id = ?'
  ).run(req.params.sceneId, req.params.projectId);
  if (result.changes === 0) return res.status(404).json({ error: 'Scene not found' });
  res.json({ deleted: true });
});

// ─── Generate image for one scene ──────────────
router.post('/:projectId/scenes/:sceneId/generate', (req, res) => {
  const { sceneId, projectId } = req.params;
  const scene = db.prepare(
    'SELECT * FROM scenes WHERE id = ? AND project_id = ?'
  ).get(sceneId, projectId);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });

  db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating', sceneId);
  generateSceneImage(sceneId, scene);

  res.json({ id: sceneId, status: 'generating' });
});

// ─── Generate all scenes ───────────────────────
router.post('/:projectId/scenes/generate-all', (req, res) => {
  const scenes = db.prepare(
    'SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order'
  ).all(req.params.projectId);

  scenes.forEach((scene, i) => {
    db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating', scene.id);
    setTimeout(() => generateSceneImage(scene.id, scene), i * 500);
  });

  res.json({ generating: scenes.length });
});

// ─── Auto-generate scenes from prompt ──────────
router.post('/:projectId/scenes/auto-generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const prompt = (req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (prompt.length > 2000) return res.status(400).json({ error: 'Prompt too long' });

    const numScenes = Math.min(MAX_SCENES, Math.max(2, parseInt(req.body.numScenes) || 4));

    // ─── Build scene plan ─────────────────────────
    // Prefer Kimi's semantic split; fall back to the original
    // whitespace word-chunk if Kimi is unavailable or its output
    // can't be validated.
    let scenesData = null;
    try {
      const split = await splitScriptIntoScenes(prompt, numScenes);
      if (Array.isArray(split) && split.length === numScenes) {
        scenesData = split;
      }
    } catch (e) {
      console.warn('[auto-generate] splitter threw:', e.message);
    }

    if (!scenesData) {
      // Fallback: naive whitespace word-chunk (original logic)
      const words = prompt.split(/\s+/);
      const perScene = Math.ceil(words.length / numScenes);
      scenesData = [];
      for (let i = 0; i < numScenes; i++) {
        const chunk = words.slice(i * perScene, (i + 1) * perScene).join(' ');
        const startSec = i * Math.round(45 / numScenes);
        const endSec = (i + 1) * Math.round(45 / numScenes);
        scenesData.push({
          prompt: chunk || `Scene ${i + 1}`,
          shot_type:   SHOT_TYPES[i % SHOT_TYPES.length],
          camera_move: CAMERA_MOVES[i % CAMERA_MOVES.length],
          duration:    `${startSec}-${endSec}s`,
        });
      }
    }

    // ─── Clear existing + insert new scenes ───────
    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(projectId);

    const createdIds = [];
    for (let i = 0; i < scenesData.length; i++) {
      const s = scenesData[i];
      const id = uuid().slice(0, 16).replace(/-/g, '');
      db.prepare(`INSERT INTO scenes (id, project_id, sort_order, prompt, shot_type, camera_move, duration)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, projectId, i, s.prompt, s.shot_type, s.camera_move, s.duration);
      createdIds.push(id);
    }

    // Trigger image generation (staggered, same as before)
    createdIds.forEach((id, i) => {
      const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id);
      db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('generating', id);
      setTimeout(() => generateSceneImage(id, scene), i * 500);
    });

    const scenes = db.prepare(
      'SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order'
    ).all(projectId);
    res.status(201).json(scenes);
  } catch (err) {
    console.error('[auto-generate] unexpected error:', err);
    res.status(500).json({ error: 'Auto-generate failed' });
  }
});

module.exports = router;
