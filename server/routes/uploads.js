const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const data = require('../data');

const router = Router();

// Project-independent reference-image upload (garment/product photo for
// image-to-image). Template runs create their project server-side, so the
// reference can't be tied to a project up front.
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (/^image\//.test(file.mimetype) ? cb(null, true) : cb(new Error('Only image files are allowed'))),
});

router.post('/', memUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = (path.extname(req.file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '')) || '.png';
    const url = await data.uploadAsset('scenes', `refs/${req.user.id}-${Date.now()}${ext}`, req.file.buffer, req.file.mimetype);
    res.status(201).json({ url });
  } catch (e) { next(e); }
});

module.exports = router;
