const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');

const router = Router();

// ─── List user's projects ──────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.user.id);
  res.json(rows);
});

// ─── Create project ────────────────────────────
router.post('/', (req, res) => {
  const name = (req.body.name || 'Untitled Project').slice(0, 100);
  const id = uuid().slice(0, 16).replace(/-/g, '');

  db.prepare('INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)')
    .run(id, req.user.id, name);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json(project);
});

// ─── Get project with all data (verify ownership) ──
router.get('/:id', (req, res) => {
  const project = db.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!project) return res.status(404).json({ error: 'Project not found' });

  const scripts = db.prepare(
    'SELECT * FROM scripts WHERE project_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  const scenes = db.prepare(
    'SELECT * FROM scenes WHERE project_id = ? ORDER BY sort_order'
  ).all(req.params.id);
  const clips = db.prepare(
    'SELECT * FROM clips WHERE project_id = ? ORDER BY created_at'
  ).all(req.params.id);
  const editJobs = db.prepare(
    'SELECT * FROM edit_jobs WHERE project_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);

  res.json({ ...project, scripts, scenes, clips, editJobs });
});

// ─── Update project ────────────────────────────
router.put('/:id', (req, res) => {
  const project = db.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!project) return res.status(404).json({ error: 'Project not found' });

  const name = req.body.name ? req.body.name.slice(0, 100) : project.name;
  db.prepare("UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(name, req.params.id);

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// ─── Delete project (verify ownership) ─────────
router.delete('/:id', (req, res) => {
  const result = db.prepare(
    'DELETE FROM projects WHERE id = ? AND user_id = ?'
  ).run(req.params.id, req.user.id);

  if (result.changes === 0) return res.status(404).json({ error: 'Project not found' });
  res.json({ deleted: true });
});

module.exports = router;
