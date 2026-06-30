// Shared scene-splitting logic used by both manual auto-generate (scenes route)
// and server-side template runs (templates route). Prefers the LLM semantic
// split; falls back to a naive word-chunk split.
const { splitScriptIntoScenes } = require('./claude');

const SHOT_TYPES = ['Wide Shot', 'Medium Shot', 'Close-Up', 'Extreme CU', 'Over Shoulder', 'POV', 'Establishing', 'Low Angle', 'High Angle', 'Dutch Angle'];
const CAMERA_MOVES = ['Static', 'Pan Left', 'Pan Right', 'Tilt Up', 'Tilt Down', 'Dolly In', 'Dolly Out', 'Tracking', 'Crane', 'Handheld'];

async function buildScenesData(prompt, numScenes) {
  let scenesData = null;
  try {
    const split = await splitScriptIntoScenes(prompt, numScenes);
    if (Array.isArray(split) && split.length === numScenes) scenesData = split;
  } catch (e) { console.warn('[sceneSplit] splitter threw:', e.message); }

  if (!scenesData) {
    const words = prompt.split(/\s+/);
    const perScene = Math.ceil(words.length / numScenes);
    scenesData = [];
    for (let i = 0; i < numScenes; i++) {
      const chunk = words.slice(i * perScene, (i + 1) * perScene).join(' ');
      const startSec = i * Math.round(45 / numScenes);
      const endSec = (i + 1) * Math.round(45 / numScenes);
      scenesData.push({
        prompt: chunk || `Scene ${i + 1}`,
        shot_type: SHOT_TYPES[i % SHOT_TYPES.length],
        camera_move: CAMERA_MOVES[i % CAMERA_MOVES.length],
        duration: `${startSec}-${endSec}s`,
      });
    }
  }
  return scenesData;
}

module.exports = { buildScenesData, SHOT_TYPES, CAMERA_MOVES };
