const db = require('../db');

/**
 * Process video clips into a final edited video.
 * Currently a mock — will be replaced with FFmpeg pipeline in Phase 3.
 */
async function processVideo(jobId, projectId, config) {
  try {
    // Simulate processing with progress updates
    for (let pct = 0; pct <= 100; pct += 10) {
      await new Promise(r => setTimeout(r, 500));
      db.prepare('UPDATE edit_jobs SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(pct, jobId);
    }

    // Mock: mark as done without actual output
    db.prepare('UPDATE edit_jobs SET status = ?, progress = 100, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('done', jobId);
  } catch (err) {
    console.error('Video processing error:', err);
    db.prepare('UPDATE edit_jobs SET status = ?, error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('error', err.message, jobId);
  }
}

module.exports = { processVideo };
