const fs = require('fs');
const path = require('path');
const data = require('../data');
const { proxiedFetch } = require('../httpProxy');

// ─── Config ──────────────────────────────────────
// Provider priority for image generation:
//   1. Doubao (Volcengine Ark)  — set DOUBAO_API_KEY
//   2. Gemini (Google)           — set GEMINI_API_KEY
//   3. Mock                      — neither set, UI still works
//
// Doubao is preferred for users in mainland China: no proxy needed,
// strong on Chinese subject matter, cheap pay-as-you-go.
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || '';
const DOUBAO_MODEL   = process.env.DOUBAO_MODEL   || 'doubao-seedream-5-0-260128';
const DOUBAO_URL     = process.env.DOUBAO_URL     || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
// Seedream 5.0 supports preset sizes: "1K" / "2K" / "4K".
// Older Seedream 3.0/4.0 used pixel sizes like "720x1280". We accept either.
const DOUBAO_SIZE    = process.env.DOUBAO_SIZE    || '2K';
const DOUBAO_WATERMARK = String(process.env.DOUBAO_WATERMARK || 'false').toLowerCase() === 'true';

// Map a UI aspect ratio chip to a Seedream-supported size.
// Seedream 5.0 requires >= 3,686,400 pixels (≈ 1920²), so every preset
// below is sized to exceed that minimum comfortably.
const ASPECT_SIZE = {
  '9:16': '1620x2880',   // 4.67M px, portrait shorts
  '16:9': '2880x1620',   // 4.67M px, cinematic widescreen
  '1:1':  '2048x2048',   // 4.19M px, square
};
function sizeForAspect(aspect) {
  return aspect && ASPECT_SIZE[aspect] ? ASPECT_SIZE[aspect] : DOUBAO_SIZE;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL   = process.env.GEMINI_MODEL   || 'gemini-2.5-flash-image';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// International (Gemini) calls route through httpProxy (proxiedFetch); domestic
// (Doubao/Ark) use the built-in fetch (direct). No global dispatcher mutation.

const MIME_EXT = {
  'image/png':  '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function extFromMime(mime) {
  return MIME_EXT[mime] || '.png';
}

function mimeFromExt(ext) {
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] || 'image/png';
}

function buildImagePrompt(scene, aspect) {
  const aspectHint = aspect === '9:16' ? '9:16 vertical aspect (portrait)'
                   : aspect === '16:9' ? '16:9 horizontal aspect (landscape, cinematic widescreen)'
                   : aspect === '1:1'  ? '1:1 square aspect'
                   : '9:16 vertical aspect';
  const parts = [
    (scene.prompt || 'storyboard frame').trim(),
    scene.shot_type   ? `Shot type: ${scene.shot_type}.`   : '',
    scene.camera_move ? `Camera move: ${scene.camera_move}.` : '',
    `Cinematic short-video storyboard frame, ${aspectHint},`,
    'dramatic lighting, high detail, no text overlays, no watermark.',
  ];
  return parts.filter(Boolean).join(' ');
}

// ─── Doubao Seedream image generation ────────────
async function callDoubao(prompt, sceneId, opts = {}) {
  const size = opts.size || DOUBAO_SIZE;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

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
        size,
        // Image-to-image: pass a reference photo (e.g. the user's garment/product)
        // so Seedream preserves it across the generated scenes.
        ...(opts.referenceImage ? { image: [opts.referenceImage] } : {}),
        sequential_image_generation: 'disabled',  // single image (Seedream 5.0)
        response_format: 'url',                   // pre-signed URL — we re-download
        stream:          false,
        watermark:       DOUBAO_WATERMARK,
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

  const resp = await res.json();
  const item = resp?.data?.[0];
  if (!item) throw new Error(`Doubao returned no image data: ${JSON.stringify(resp).slice(0, 300)}`);

  let buffer, ext = '.png';
  if (item.url) {
    // Volcengine returns a pre-signed URL that expires in ~24h — download
    // immediately and persist to local disk so we own the asset.
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`Doubao image URL ${imgRes.status}`);
    const ab = await imgRes.arrayBuffer();
    buffer = Buffer.from(ab);
    const ct = imgRes.headers.get('content-type') || '';
    ext = extFromMime(ct);
  } else if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else {
    throw new Error('Doubao response had neither url nor b64_json');
  }

  return data.uploadAsset('scenes', sceneId + ext, buffer, mimeFromExt(ext));
}

// ─── Gemini image generation (fallback) ──────────
async function callGemini(prompt, sceneId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  let res;
  try {
    res = await proxiedFetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
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

  const resp = await res.json();
  const parts = resp?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p?.inlineData?.data);
  if (!imgPart) {
    const block = resp?.promptFeedback?.blockReason;
    const finish = resp?.candidates?.[0]?.finishReason;
    throw new Error(
      `Gemini returned no image (blockReason=${block || 'none'}, finishReason=${finish || 'none'})`
    );
  }

  const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
  const ext    = extFromMime(imgPart.inlineData.mimeType);
  return data.uploadAsset('scenes', sceneId + ext, buffer, mimeFromExt(ext));
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
 *
 * opts:
 *   aspect  '9:16' | '16:9' | '1:1'  — maps to a Seedream-supported pixel size
 */
async function generateSceneImage(sceneId, scene, opts = {}) {
  const size = sizeForAspect(opts.aspect);

  // Mock fallback when no provider is configured
  if (!DOUBAO_API_KEY && !GEMINI_API_KEY) {
    try {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
      await data.scenes.setImage(sceneId, 'done', null);
    } catch (err) {
      console.error('[imageGen] mock error:', err);
      await data.scenes.setStatus(sceneId, 'error');
    }
    return;
  }

  try {
    const prompt = buildImagePrompt(scene || {}, opts.aspect);
    const url    = DOUBAO_API_KEY
      ? await callDoubao(prompt, sceneId, { size, referenceImage: opts.referenceImage })
      : await callGemini(prompt, sceneId);
    await data.scenes.setImage(sceneId, 'done', url);
  } catch (err) {
    const cause = err.cause ? ` (cause: ${err.cause.code || err.cause.message || err.cause})` : '';
    console.error('[imageGen]', err.message + cause);
    await data.scenes.setImage(sceneId, 'error', null);
  }
}

module.exports = { generateSceneImage };
