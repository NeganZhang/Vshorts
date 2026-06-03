const fs = require('fs');
const path = require('path');
const db = require('../db');
const { concatClips } = require('./ffmpegConcat');
const { renderWithHyperFrames } = require('./hyperframesRenderer');
const { removeSilence } = require('./silenceCutter');

const ROOT = path.resolve(__dirname, '..', '..');
const UPLOADS_ROOT = path.join(ROOT, 'uploads');

const updateStage = db.prepare(
  `UPDATE edit_jobs SET progress = ?, stage = ?, stage_msg = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);
const markDone = db.prepare(
  `UPDATE edit_jobs SET status = 'done', progress = 100, stage = 'done',
                        stage_msg = 'Ready to download', output_path = ?,
                        updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);
const markError = db.prepare(
  `UPDATE edit_jobs SET status = 'error', error_msg = ?, stage = 'error',
                        stage_msg = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);

function setProgress(jobId, pct, stage, msg) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  updateStage.run(clamped, stage, msg ? String(msg).slice(0, 500) : null, jobId);
}

async function processVideo(jobId, projectId, config) {
  const jobDir = path.join(UPLOADS_ROOT, 'edit-jobs', jobId);
  const sourceMp4 = path.join(jobDir, 'source.mp4');
  const cutSourceMp4 = path.join(jobDir, 'source-cut.mp4');
  const outputMp4 = path.join(jobDir, 'output.mp4');

  try {
    fs.mkdirSync(jobDir, { recursive: true });

    setProgress(jobId, 1, 'concat', 'Stitching uploaded clips');
    const clips = db
      .prepare('SELECT filepath FROM clips WHERE project_id = ? ORDER BY created_at')
      .all(projectId)
      .map(row => row.filepath)
      .filter(filePath => filePath && fs.existsSync(filePath));

    if (clips.length === 0) throw new Error('No clips on disk for this project');

    await concatClips(clips, sourceMp4, (pct, msg) => {
      setProgress(jobId, pct * 0.15, 'concat', msg || 'Stitching uploaded clips');
    });
    setProgress(jobId, 15, 'concat', 'Source video prepared');

    setProgress(jobId, 16, 'silence-cut', 'Detecting pauses');
    const cutReport = await removeSilence(sourceMp4, cutSourceMp4, {
      enabled: config?.autoCutPauses !== false,
      thresholdDb: config?.silenceThresholdDb,
      minSilence: config?.minSilenceSeconds,
      keepPadding: config?.silencePaddingSeconds,
    }, (pct, msg) => {
      setProgress(jobId, 16 + pct * 0.22, 'silence-cut', msg || 'Cutting pauses');
    });

    const renderSource = fs.existsSync(cutSourceMp4) ? cutSourceMp4 : sourceMp4;
    const removed = cutReport?.removedSeconds ? `, removed ${cutReport.removedSeconds.toFixed(1)}s` : '';
    setProgress(jobId, 38, 'silence-cut', `Pauses processed${removed}`);

    setProgress(jobId, 40, 'hyperframes', 'Building HyperFrames edit');
    await renderWithHyperFrames({
      sourceMp4: renderSource,
      outputMp4,
      jobDir,
      config: config || {},
      onProgress: (pct, msg) => {
        setProgress(jobId, 40 + pct * 0.58, 'hyperframes', msg || 'Rendering with HyperFrames');
      }
    });

    markDone.run(outputMp4, jobId);
  } catch (err) {
    console.error(`[edit-job ${jobId}]`, err);
    markError.run(String(err.message || err).slice(0, 500), 'Processing failed', jobId);
  }
}

module.exports = { processVideo };
