const db = require('../db');

/**
 * Generate an image for a storyboard scene.
 * Currently a mock — will be replaced with Nanobanana (Gemini) API in Phase 2.
 */
async function generateSceneImage(sceneId, scene) {
  try {
    // Simulate image generation delay (1.5-3s)
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));

    // Mock: no actual image generated, just mark as done
    // In Phase 2, this will call the Gemini API and save the image
    db.prepare('UPDATE scenes SET status = ?, image_path = ? WHERE id = ?')
      .run('done', null, sceneId);
  } catch (err) {
    console.error('Image generation error:', err);
    db.prepare('UPDATE scenes SET status = ? WHERE id = ?')
      .run('error', sceneId);
  }
}

module.exports = { generateSceneImage };
