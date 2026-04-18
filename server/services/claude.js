const db = require('../db');

// ─── Config ──────────────────────────────────────
// Priority: KIMI_API_KEY → ANTHROPIC_API_KEY → mock.
// Set one of these in .env to enable real AI generation.
const KIMI_API_KEY      = process.env.KIMI_API_KEY      || '';
const KIMI_MODEL        = process.env.KIMI_MODEL        || 'moonshot-v1-8k';
const KIMI_URL          = process.env.KIMI_URL          || 'https://api.moonshot.cn/v1/chat/completions';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL   || 'claude-sonnet-4-6';
const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';

// ─── Language detection (very small helper) ──────
// Returns true if the prompt contains CJK characters, so we can ask
// the model to reply in the same language the user typed in.
function hasCJK(str) {
  return /[\u3400-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FFFF}]/u.test(str);
}

// ─── System prompt (bilingual) ───────────────────
const SYSTEM_PROMPT = `You are VSHORT, an expert short-form video scriptwriter
(TikTok / Reels / YouTube Shorts). Produce a tight, engaging 30–60 second
script based on the user's topic. Respond in the SAME language the user
wrote in (English → English, 中文 → 中文).

Use this exact ASCII-styled format so the front-end renders it nicely:

──────────────────────────────────
  VSHORT SCRIPT — AI GENERATED
──────────────────────────────────

TOPIC: <the user's topic>

━━━ HOOK (0-3s) ━━━
<1–2 sentences — a scroll-stopper>

━━━ SETUP (3-12s) ━━━
[VISUAL: <short visual cue>]

NARRATOR (V/O):
<2–3 sentences setting up the problem / angle>

━━━ BODY (12-40s) ━━━
[VISUAL: <short visual cue>]

NARRATOR (V/O):
<the core content, punchy and specific>

POINT 1: <...>
POINT 2: <...>
POINT 3: <...>

━━━ CTA (40-50s) ━━━
[VISUAL: <short visual cue>]

NARRATOR (V/O):
<call to action>

──────────────────────────────────
  ESTIMATED VIRALITY: <60-95>%
  ENGAGEMENT SCORE:   <7.0-9.9>/10
──────────────────────────────────

Keep it punchy, specific, and immediately useful. Do not add any extra
explanation outside the block above.`;

// ─── Kimi (Moonshot AI) — OpenAI-compatible chat/completions ──
async function callKimiAPI(prompt) {
  const res = await fetch(KIMI_URL, {
    method: 'POST',
    headers: {
      'content-type':  'application/json',
      'authorization': `Bearer ${KIMI_API_KEY}`,
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      temperature: 0.6,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Kimi API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error('Empty response from Kimi');
  return text;
}

// ─── Real Claude API call ────────────────────────
async function callClaudeAPI(prompt) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type':       'application/json',
      'x-api-key':          ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
    },
    body: JSON.stringify({
      model:      ANTHROPIC_MODEL,
      max_tokens: 1200,
      system:     SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  if (!text) throw new Error('Empty response from Claude');
  return text;
}

// ─── Mock (used when ANTHROPIC_API_KEY is absent) ──
function buildMockScript(prompt) {
  const cjk  = hasCJK(prompt);
  const idea = prompt;
  const hook = idea.charAt(0).toUpperCase() + idea.slice(1);

  if (cjk) {
    return `──────────────────────────────────
  VSHORT 脚本 — AI 生成（示例）
──────────────────────────────────

主题：${hook}

━━━ 钩子 (0-3s) ━━━
"别划走 —— 这会改变你对
「${idea.slice(0, 10)}」的看法。"

━━━ 铺垫 (3-12s) ━━━
[画面：主题快剪，镜头推拉]

旁白 (V/O)：
"大多数人都弄错了。
关于「${idea.slice(0, 12)}」，
有一个没人告诉你的真相……"

━━━ 主体 (12-40s) ━━━
[画面：逐步拆解，带字幕动效]

旁白 (V/O)：
"先忘掉你以为的一切。
其实真相比你想的简单。"

要点 1：出乎意料的切入角度
要点 2：证据 / 实锤
要点 3：顿悟时刻

━━━ CTA (40-50s) ━━━
[画面：简洁收尾，订阅动画]

旁白 (V/O)：
"关注一波，评论区告诉我
你的看法。"

──────────────────────────────────
  预估爆款指数：${75 + Math.floor(Math.random() * 20)}%
  互动分：       ${(7 + Math.random() * 3).toFixed(1)}/10
──────────────────────────────────
  （提示：当前为本地 mock，配置 ANTHROPIC_API_KEY 后将接入真实 Claude）`;
  }

  return `──────────────────────────────────
  VSHORT SCRIPT — AI GENERATED (MOCK)
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
──────────────────────────────────
  (hint: set ANTHROPIC_API_KEY in .env to use the real Claude model)`;
}

/**
 * Generate a script from a prompt.
 * Uses Anthropic's Claude API when ANTHROPIC_API_KEY is set; otherwise
 * returns a formatted mock so the UI stays functional.
 */
async function generateScript(scriptId, prompt) {
  try {
    let content;
    if (KIMI_API_KEY) {
      content = await callKimiAPI(prompt);
    } else if (ANTHROPIC_API_KEY) {
      content = await callClaudeAPI(prompt);
    } else {
      // Keep the old "feels like it's thinking" delay for mock mode
      await new Promise(r => setTimeout(r, 1200 + Math.random() * 1200));
      content = buildMockScript(prompt);
    }

    db.prepare('UPDATE scripts SET content = ?, status = ? WHERE id = ?')
      .run(content, 'done', scriptId);
  } catch (err) {
    console.error('Script generation error:', err);
    db.prepare('UPDATE scripts SET status = ?, content = ? WHERE id = ?')
      .run('error', err.message || 'Generation failed', scriptId);
  }
}

// ─── Storyboard splitter ─────────────────────────
// Enums duplicated from server/routes/scenes.js so the prompt can
// enumerate the allowed values verbatim. Keep these in sync if
// the routes add new shot types / camera moves.
const SPLIT_SHOT_TYPES = [
  'Wide Shot', 'Medium Shot', 'Close-Up', 'Extreme CU',
  'Over Shoulder', 'POV', 'Establishing', 'Low Angle',
  'High Angle', 'Dutch Angle',
];
const SPLIT_CAMERA_MOVES = [
  'Static', 'Pan Left', 'Pan Right', 'Tilt Up', 'Tilt Down',
  'Dolly In', 'Dolly Out', 'Tracking', 'Crane', 'Handheld',
];
const DURATION_RE = /^\d+-\d+s$/;

function buildSplitterPrompt(numScenes, cjk) {
  const header = cjk
    ? `你是 VSHORT，一名短视频分镜师。把用户提供的剧本切分成正好 ${numScenes} 个画面。
必须严格输出 JSON（不要任何解释、不要代码块围栏）：
{"scenes":[{"prompt":"...","shot_type":"...","camera_move":"...","duration":"Xs-Ys"}, ...]}`
    : `You are VSHORT, a short-form video storyboard artist. Split the user's script
into EXACTLY ${numScenes} shots.
Output ONLY valid JSON (no markdown fences, no prose), in this shape:
{"scenes":[{"prompt":"...","shot_type":"...","camera_move":"...","duration":"Xs-Ys"}, ...]}`;

  const rules = cjk
    ? `规则：
- "scenes" 长度必须 = ${numScenes}，按剧情顺序排列。
- "prompt" 必须是单个具体可拍摄的视觉描述（无对白、无字幕），≤ 200 字。
- "shot_type" 必须是以下之一：${SPLIT_SHOT_TYPES.join(', ')}
- "camera_move" 必须是以下之一：${SPLIT_CAMERA_MOVES.join(', ')}
- "duration" 格式 "Xs-Ys"，全部相加约等于 30-60 秒。
- 只输出 JSON。`
    : `Rules:
- "scenes" length MUST equal ${numScenes}, in narrative order.
- "prompt" MUST be one concrete, shootable visual description (no dialogue, no captions), ≤ 200 chars.
- "shot_type" MUST be one of: ${SPLIT_SHOT_TYPES.join(', ')}
- "camera_move" MUST be one of: ${SPLIT_CAMERA_MOVES.join(', ')}
- "duration" format "Xs-Ys"; durations should sum to roughly 30-60 seconds total.
- Output JSON ONLY.`;

  return `${header}\n\n${rules}`;
}

// ─── Kimi JSON-mode call (shares config with callKimiAPI) ──
async function callKimiJSON(systemPrompt, userPrompt) {
  const res = await fetch(KIMI_URL, {
    method: 'POST',
    headers: {
      'content-type':  'application/json',
      'authorization': `Bearer ${KIMI_API_KEY}`,
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Kimi API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error('Empty response from Kimi');
  return text;
}

/**
 * Split a script into a storyboard of exactly `numScenes` scenes using Kimi.
 * Returns Array<{prompt, shot_type, camera_move, duration}> on success, or
 * null when KIMI_API_KEY is absent / the call fails / the output can't be
 * parsed — caller should fall back to a naive split.
 */
async function splitScriptIntoScenes(script, numScenes) {
  if (!KIMI_API_KEY) return null;
  if (!script || !numScenes || numScenes < 1) return null;

  const n    = Math.max(1, Math.min(20, numScenes | 0));
  const cjk  = hasCJK(script);
  const sys  = buildSplitterPrompt(n, cjk);

  let raw;
  try {
    raw = await callKimiJSON(sys, script);
  } catch (e) {
    console.warn('[splitter] Kimi call failed:', e.message);
    return null;
  }

  // Defensive JSON parse — accept both bare JSON and JSON wrapped in prose.
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (_) {} }
  }
  if (!obj || !Array.isArray(obj.scenes)) {
    console.warn('[splitter] Could not parse JSON from Kimi output');
    return null;
  }

  // Normalize to exactly n entries, coerce and validate fields.
  const step = Math.max(1, Math.round(45 / n));
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = obj.scenes[i] || {};
    const prompt = String(src.prompt || src.description || `Scene ${i + 1}`).slice(0, 1000);
    const shot   = SPLIT_SHOT_TYPES.includes(src.shot_type)
      ? src.shot_type
      : SPLIT_SHOT_TYPES[i % SPLIT_SHOT_TYPES.length];
    const cam    = SPLIT_CAMERA_MOVES.includes(src.camera_move)
      ? src.camera_move
      : SPLIT_CAMERA_MOVES[i % SPLIT_CAMERA_MOVES.length];
    const dur    = typeof src.duration === 'string' && DURATION_RE.test(src.duration.trim())
      ? src.duration.trim()
      : `${i * step}-${(i + 1) * step}s`;

    out.push({ prompt, shot_type: shot, camera_move: cam, duration: dur });
  }
  return out;
}

module.exports = { generateScript, splitScriptIntoScenes };
