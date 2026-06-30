const { Router } = require('express');
const data = require('../data');

const router = Router();

// ─── List user's projects ──────────────────────
router.get('/', async (req, res, next) => {
  try { res.json(await data.projects.list(req.user.id)); } catch (e) { next(e); }
});

// ─── Create project ────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name || 'Untitled Project').slice(0, 100);
    const project = await data.projects.create(req.user.id, name);
    res.status(201).json(project);
  } catch (e) { next(e); }
});

// ─── Get project with all data (verify ownership) ──
router.get('/:id', async (req, res, next) => {
  try {
    const project = await data.projects.getOwned(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const [scripts, scenes, clips, editJobs] = await Promise.all([
      data.scripts.listByProject(req.params.id),
      data.scenes.list(req.params.id),
      data.clips.list(req.params.id),
      data.jobs.list(req.params.id),
    ]);
    res.json({ ...project, scripts, scenes, clips, editJobs });
  } catch (e) { next(e); }
});

// ─── Update project ────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const project = await data.projects.getOwned(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const name = req.body.name ? req.body.name.slice(0, 100) : project.name;
    res.json(await data.projects.updateName(req.params.id, name));
  } catch (e) { next(e); }
});

// ─── Delete project (verify ownership) ─────────
router.delete('/:id', async (req, res, next) => {
  try {
    const removed = await data.projects.remove(req.params.id, req.user.id);
    if (!removed || removed.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
