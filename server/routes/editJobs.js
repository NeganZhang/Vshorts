const { Router } = require('express');
const data = require('../data');
const { projectOwner } = require('../middleware/ownership');
const { processVideo } = require('../services/videoProcessor');

const router = Router();

router.use('/:projectId/edit-jobs', projectOwner);

// ─── Valid config fields (image-to-video render) ───────────────────────
const VALID_EXPORT_FORMATS = ['tiktok', 'youtube', 'landscape', 'square'];
const VALID_RESOLUTIONS = ['480p', '720p', '1080p', '2K'];

function validateConfig(config) {
  if (!config || typeof config !== 'object') return {};
  const clean = {};
  if (typeof config.music === 'string') clean.music = config.music.slice(0, 100);
  if (VALID_EXPORT_FORMATS.includes(config.exportFormat)) clean.exportFormat = config.exportFormat;
  if (VALID_RESOLUTIONS.includes(config.resolution)) clean.resolution = config.resolution;
  if (Array.isArray(config.scenes)) {
    clean.scenes = config.scenes
      .filter((s) => s && typeof s.sceneId === 'string')
      .slice(0, 20)
      .map((s) => ({
        sceneId: s.sceneId,
        motionPrompt: typeof s.motionPrompt === 'string' ? s.motionPrompt.slice(0, 500) : undefined,
        durationSeconds: Number.isFinite(s.durationSeconds) ? s.durationSeconds : undefined,
      }));
  }
  return clean;
}

// ─── Start render job ──────────────────────────
router.post('/:projectId/edit-jobs', async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const sceneCount = await data.scenes.countWithImage(projectId);
    if (sceneCount === 0) return res.status(400).json({ error: 'Generate storyboard images first — no scenes with images to render' });

    const active = await data.jobs.active(projectId);
    if (active) return res.status(409).json({ error: 'A job is already processing', jobId: active.id });

    const config = validateConfig(req.body.config);
    const job = await data.jobs.insert(projectId, config);

    processVideo(job.id, projectId, config); // async

    res.status(201).json({ id: job.id, status: 'processing', progress: 0 });
  } catch (e) { next(e); }
});

// ─── Get job status ────────────────────────────
router.get('/:projectId/edit-jobs/:jobId', async (req, res, next) => {
  try {
    const job = await data.jobs.get(req.params.jobId, req.params.projectId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (e) { next(e); }
});

// ─── List jobs ─────────────────────────────────
router.get('/:projectId/edit-jobs', async (req, res, next) => {
  try { res.json(await data.jobs.list(req.params.projectId)); } catch (e) { next(e); }
});

// ─── Download rendered video (redirect to Storage URL) ──
router.get('/:projectId/edit-jobs/:jobId/download', async (req, res, next) => {
  try {
    const job = await data.jobs.get(req.params.jobId, req.params.projectId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'done' || !job.output_path) return res.status(400).json({ error: 'Video not ready' });
    // output_path is a public Storage URL now.
    res.redirect(job.output_path);
  } catch (e) { next(e); }
});

module.exports = router;
