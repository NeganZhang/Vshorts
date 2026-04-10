const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { projectOwner } = require('../middleware/ownership');
const { processVideo } = require('../services/videoProcessor');

const router = Router();

// All edit job routes require project ownership
router.use('/:projectId/edit-jobs', projectOwner);

// ─── Valid config fields ───────────────────────
const VALID_ENHANCE = ['autocut', 'color', 'zoom', 'stabilize', 'denoise'];
const VALID_CAPTION_STYLES = ['impact', 'glow', 'minimal', 'viral'];
const VALID_EXPORT_FORMATS = ['tiktok', 'youtube', 'landscape', 'square'];

function validateConfig(config) {
  if (!config || typeof config !== 'object') return {};

  const clean = {};

  // Enhance toggles
  if (config.enhance && typeof config.enhance === 'object') {
    clean.enhance = {};
    for (const key of VALID_ENHANCE) {
      clean.enhance[key] = !!config.enhance[key];
    }
  }

  // Caption style
  if (VALID_CAPTION_STYLES.includes(config.captionStyle)) {
    clean.captionStyle = config.captionStyle;
  }

  // Music track (string, max 100 chars)
  if (typeof config.music === 'string') {
    clean.music = config.music.slice(0, 100);
  }

  // Export format
  if (VALID_EXPORT_FORMATS.includes(config.exportFormat)) {
    clean.exportFormat = config.exportFormat;
  }

  return clean;
}

// ─── Start edit job ────────────────────────────
router.post('/:projectId/edit-jobs', (req, res) => {
  const { projectId } = req.params;

  // Check clips exist
  const clipCount = db.prepare('SELECT COUNT(*) as c FROM clips WHERE project_id = ?').get(projectId).c;
  if (clipCount === 0) {
    return res.status(400).json({ error: 'No clips uploaded — upload at least one clip first' });
  }

  // Check no active job
  const activeJob = db.prepare(
    "SELECT id FROM edit_jobs WHERE project_id = ? AND status = 'processing'"
  ).get(projectId);
  if (activeJob) {
    return res.status(409).json({ error: 'A job is already processing', jobId: activeJob.id });
  }

  const config = validateConfig(req.body.config);
  const id = uuid().slice(0, 16).replace(/-/g, '');

  db.prepare(`INSERT INTO edit_jobs (id, project_id, config, status)
    VALUES (?, ?, ?, ?)`)
    .run(id, projectId, JSON.stringify(config), 'processing');

  processVideo(id, projectId, config);

  res.status(201).json({ id, status: 'processing', progress: 0 });
});

// ─── Get job status ────────────────────────────
router.get('/:projectId/edit-jobs/:jobId', (req, res) => {
  const job = db.prepare(
    'SELECT * FROM edit_jobs WHERE id = ? AND project_id = ?'
  ).get(req.params.jobId, req.params.projectId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  job.config = JSON.parse(job.config || '{}');
  res.json(job);
});

// ─── List jobs ─────────────────────────────────
router.get('/:projectId/edit-jobs', (req, res) => {
  const jobs = db.prepare(
    'SELECT * FROM edit_jobs WHERE project_id = ? ORDER BY created_at DESC'
  ).all(req.params.projectId);

  jobs.forEach(j => { j.config = JSON.parse(j.config || '{}'); });
  res.json(jobs);
});

// ─── Download rendered video ───────────────────
router.get('/:projectId/edit-jobs/:jobId/download', (req, res) => {
  const job = db.prepare(
    'SELECT * FROM edit_jobs WHERE id = ? AND project_id = ?'
  ).get(req.params.jobId, req.params.projectId);

  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'done' || !job.output_path) {
    return res.status(400).json({ error: 'Video not ready' });
  }

  res.download(job.output_path, `vshort-export-${job.id.slice(0, 6)}.mp4`);
});

module.exports = router;
