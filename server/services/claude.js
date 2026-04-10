const db = require('../db');

/**
 * Generate a script from a prompt.
 * Currently uses a mock template — will be replaced with real Claude API in Phase 2.
 */
async function generateScript(scriptId, prompt) {
  try {
    // Simulate AI generation delay (1.5-3s)
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));

    const idea = prompt;
    const hook = idea.charAt(0).toUpperCase() + idea.slice(1);

    // Mock script output matching the existing format
    const content = `──────────────────────────────────
  VSHORT SCRIPT — AI GENERATED
──────────────────────────────────

TOPIC: ${hook}

━━━ HOOK (0-3s) ━━━
"Stop scrolling — this will
change how you think about
${idea.split(' ').slice(0, 3).join(' ')}."

━━━ SETUP (3-12s) ━━━
[VISUAL: Quick montage of the
topic — fast cuts, dynamic
zoom transitions]

NARRATOR (V/O):
"Most people get this wrong.
Here's what nobody tells you
about ${idea.split(' ').slice(0, 4).join(' ')}..."

━━━ BODY (12-40s) ━━━
[VISUAL: Step-by-step breakdown
with text overlays and kinetic
typography]

NARRATOR (V/O):
"First — forget everything you
think you know. The real secret
is simpler than you think."

POINT 1: The unexpected angle
POINT 2: The proof / evidence
POINT 3: The "aha" moment

━━━ CTA (40-50s) ━━━
[VISUAL: Clean outro card with
subscribe animation]

NARRATOR (V/O):
"Follow for more. Drop a comment
if this changed your mind."

──────────────────────────────────
  ESTIMATED VIRALITY: ${75 + Math.floor(Math.random() * 20)}%
  ENGAGEMENT SCORE:   ${(7 + Math.random() * 3).toFixed(1)}/10
──────────────────────────────────`;

    db.prepare('UPDATE scripts SET content = ?, status = ? WHERE id = ?')
      .run(content, 'done', scriptId);
  } catch (err) {
    console.error('Script generation error:', err);
    db.prepare('UPDATE scripts SET status = ?, content = ? WHERE id = ?')
      .run('error', err.message, scriptId);
  }
}

module.exports = { generateScript };
