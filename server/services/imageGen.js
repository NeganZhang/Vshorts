const fs = require('fs');
const path = require('path');
const db  = require('../db');

// ─── Config ──────────────────────────────────────
// Provider priority for image generation:
//   1. Doubao (Volcengine Ark)  — set DOUBAO_API_KEY
//   2. Gemini (Google)           — set GEMINI_API_KEY
//   3. Mock                      — neither set, UI still works
//
// Doubao is preferred for users in mainland China: no proxy needed,
// strong on Chinese subject matter, cheap pay-as-you-go.
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || '';
const DOUBAO_MODEL   = process.env.DOUBAO_MODEL   || 'doubao-seedream-3-0-t2i-250415';
const DOUBAO_URL     = process.env.DOUBAO_URL     || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const DOUBAO_SIZE    = process.env.DOUBAO_SIZE    || '720x1280';   // 9:16 vertical

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL   = process.env.GEMINI_MODEL   || 'gemini-2.5-flash-image';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── Proxy support ───────────────────────────────
// Node's global fetch (undici) ignores HTTP(S)_PROXY env vars by default.
// Only install the proxy dispatcher when we have NO Doubao key — Doubao's
// endpoint is in mainland China and proxies usually hurt, whereas Gemini
// (international) requires one from inside China.
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
              || process.env.HTTP_PROXY  || process.env.http_proxy || '';
if (proxyUrl && !DOUBAO_API_KEY && GEMINI_API_KEY) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.log('[imageGen] Using HTTPS proxy:', proxyUrl);
  } catch (e) {
    console.warn('[imageGen] proxy env set but undici unavailable:', e.message);
  }
}

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads', 'scenes');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME_EXT = {
  'image/png':  '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function extFromMime(mime) {
  return MIME_EXT[mime] || '.png';
}

function buildImagePrompt(scene) {
  const parts = [
    (scene.prompt || 'storyboard frame').trim(),
    scene.shot_type   ? `Shot type: ${scene.shot_type}.`   : '',
    scene.camera_move ? `Camera move: ${scene.camera_move}.` : '',
    'Cinematic short-video storyboard frame, 9:16 vertical aspect,',
    'dramatic lighting, high detail, no text overlays, no watermark.',
  ];
  return parts.filter(Boolean).join(' ');
}

// ─── Doubao (Volcengine Ark) image generation ───
async function callDoubao(prompt, sceneId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  let res;
  try {
    res = await fetch(DOUBAO_URL, {
      method: 'POST',
      headers: {
        'content-type':  'application/json',
        'authorization': `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model:           DOUBAO_MODEL,
        prompt,
        size:            DOUBAO_SIZE,
        response_format: 'b64_json',   // embed bytes so we don't rely on URL TTL
        watermark:       false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Doubao ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = await res.json();
  const item = data?.data?.[0];
  if (!item) throw new Error(`Doubao returned no image data: ${JSON.stringify(data).slice(0, 300)}`);

  let buffer, ext = '.png';
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    // fall-through: fetch the URL if Doubao returned a pre-signed link
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`Doubao image URL ${imgRes.status}`);
    const ab = await imgRes.arrayBuffer();
    buffer = Buffer.from(ab);
    const ct = imgRes.headers.get('content-type') || '';
    ext = extFromMime(ct);
  } else {
    throw new Error('Doubao response had neither b64_json nor url');
  }

  const fname = sceneId + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, fname), buffer);
  return `/uploads/scenes/${fname}`;
}

// ─── Gemini image generation (fallback) ──────────
async function callGemini(prompt, sceneId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  let res;
  try {
    res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p?.inlineData?.data);
  if (!imgPart) {
    const block = data?.promptFeedback?.blockReason;
    const finish = data?.candidates?.[0]?.finishReason;
    throw new Error(
      `Gemini returned no image (blockReason=${block || 'none'}, finishReason=${finish || 'none'})`
    );
  }

  const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
  const ext    = extFromMime(imgPart.inlineData.mimeType);
  const fname  = sceneId + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, fname), buffer);
  return `/uploads/scenes/${fname}`;
}

// ─── Startup log so users know which provider is active ──
if (DOUBAO_API_KEY) {
  console.log(`[imageGen] Provider: Doubao (${DOUBAO_MODEL}) — size ${DOUBAO_SIZE}`);
} else if (GEMINI_API_KEY) {
  console.log(`[imageGen] Provider: Gemini (${GEMINI_MODEL})`);
} else {
  console.log('[imageGen] Provider: mock (no DOUBAO_API_KEY or GEMINI_API_KEY set)');
}

/**
 * Generate an image for a storyboard scene.
 * Dispatches to the first configured provider (Doubao → Gemini → mock).
 */
async function generateSceneImage(sceneId, scene) {
  // Mock fallback when no provider is configured
  if (!DOUBAO_API_KEY && !GEMINI_API_KEY) {
    try {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
      db.prepare('UPDATE scenes SET status = ?, image_path = ? WHERE id = ?')
        .run('done', null, sceneId);
    } catch (err) {
      console.error('[imageGen] mock error:', err);
      db.prepare('UPDATE scenes SET status = ? WHERE id = ?').run('error', sceneId);
    }
    return;
  }

  try {
    const prompt = buildImagePrompt(scene || {});
    const url    = DOUBAO_API_KEY
      ? await callDoubao(prompt, sceneId)
      : await callGemini(prompt, sceneId);
    db.prepare('UPDATE scenes SET status = ?, image_path = ? WHERE id = ?')
      .run('done', url, sceneId);
  } catch (err) {
    const cause = err.cause ? ` (cause: ${err.cause.code || err.cause.message || err.cause})` : '';
    console.error('[imageGen]', err.message + cause);
    db.prepare('UPDATE scenes SET status = ?, image_path = ? WHERE id = ?')
      .run('error', null, sceneId);
  }
}

module.exports = { generateSceneImage };
