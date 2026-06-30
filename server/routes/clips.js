const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const data = require('../data');
const { projectOwner } = require('../middleware/ownership');

const router = Router();

router.use('/:projectId/clips', projectOwner);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'clips', req.params.projectId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (/^video\//.test(file.mimetype) ? cb(null, true) : cb(new Error('Only video files are allowed'))),
});

router.post('/:projectId/clips', upload.array('files', 5), async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const existing = await data.clips.count(projectId);
    if (existing + (req.files || []).length > 20) return res.status(400).json({ error: 'Maximum 20 clips per project' });

    const clips = [];
    for (const file of (req.files || [])) {
      const clip = await data.clips.insert({
        project_id: projectId, filename: file.originalname.slice(0, 255),
        filepath: file.path, filesize: file.size, mime_type: file.mimetype,
      });
      clips.push(clip);
    }
    await data.projects.touch(projectId);
    res.status(201).json(clips);
  } catch (e) { next(e); }
});

router.get('/:projectId/clips', async (req, res, next) => {
  try { res.json(await data.clips.list(req.params.projectId)); } catch (e) { next(e); }
});

router.delete('/:projectId/clips/:clipId', async (req, res, next) => {
  try {
    const clip = await data.clips.get(req.params.clipId, req.params.projectId);
    if (!clip) return res.status(404).json({ error: 'Clip not found' });
    try { fs.unlinkSync(clip.filepath); } catch (_) { /* ignore */ }
    await data.clips.remove(clip.id);
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

module.exports = router;
