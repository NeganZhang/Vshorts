const { Router } = require('express');
const { v4: uuid } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { projectOwner } = require('../middleware/ownership');

const router = Router();

// All clip routes require project ownership
router.use('/:projectId/clips', projectOwner);

// ─── Multer config ─────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // req.project is set by projectOwner middleware
    const dir = path.join(__dirname, '..', '..', 'uploads', 'clips', req.params.projectId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10); // limit extension length
    const safe = ext.replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `${uuid().slice(0, 8)}${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max per file
  fileFilter: (req, file, cb) => {
    if (/^video\//.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

// ─── Upload clips ──────────────────────────────
router.post('/:projectId/clips', upload.array('files', 5), (req, res) => {
  const { projectId } = req.params;

  // Check existing clips count (limit per project)
  const existing = db.prepare('SELECT COUNT(*) as c FROM clips WHERE project_id = ?').get(projectId).c;
  if (existing + (req.files || []).length > 20) {
    return res.status(400).json({ error: 'Maximum 20 clips per project' });
  }

  const clips = [];
  for (const file of (req.files || [])) {
    const id = uuid().slice(0, 16).replace(/-/g, '');
    db.prepare(`INSERT INTO clips (id, project_id, filename, filepath, filesize, mime_type)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, projectId, file.originalname.slice(0, 255), file.path, file.size, file.mimetype);

    clips.push(db.prepare('SELECT * FROM clips WHERE id = ?').get(id));
  }

  db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
  res.status(201).json(clips);
});

// ─── List clips ────────────────────────────────
router.get('/:projectId/clips', (req, res) => {
  const clips = db.prepare(
    'SELECT * FROM clips WHERE project_id = ? ORDER BY created_at'
  ).all(req.params.projectId);
  res.json(clips);
});

// ─── Delete clip ───────────────────────────────
router.delete('/:projectId/clips/:clipId', (req, res) => {
  const clip = db.prepare(
    'SELECT * FROM clips WHERE id = ? AND project_id = ?'
  ).get(req.params.clipId, req.params.projectId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  // Delete file from disk
  try { fs.unlinkSync(clip.filepath); } catch (e) { /* file might not exist */ }

  db.prepare('DELETE FROM clips WHERE id = ?').run(clip.id);
  res.json({ deleted: true });
});

module.exports = router;
