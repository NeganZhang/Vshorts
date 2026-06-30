// Bake the locked prompt_template (and tightened inputs) into the 3 official
// templates. Applied via the service-role key so it takes effect immediately.
// Mirrors supabase/migrations/0004_seed_template_prompts.sql.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLOTHING = `A premium vertical fashion lookbook showcasing ONE single garment — the exact garment shown in the reference image — worn by the SAME consistent model in every scene. The garment must look identical across all scenes: same color, cut, fabric, pattern, and details; only the pose, camera angle, and framing change between scenes. Setting and mood: {{vibe}}.

Produce a sequence of distinct shots, one per scene, in this order, each a clean fashion-editorial frame with soft natural lighting, shallow depth of field, photorealistic skin and fabric, vertical 9:16 composition:
1) Full-body front shot — the model stands facing the camera, the complete outfit visible from head to toe, confident relaxed posture.
2) Three-quarter turn — the model rotates about 45 degrees, revealing the silhouette and the side seams of the garment.
3) Back view — the model is seen from behind, highlighting the back design, drape, and fit.
4) Walking shot — the model walks slowly toward the camera, the garment moving naturally with the body.
5) Detail close-up — a tight shot on the fabric texture, stitching, buttons, collar, or hemline of the garment.
6) Lifestyle pose — the model relaxed and candid within the {{vibe}} environment, natural editorial feel.

Hard consistency rules for every scene: keep the SAME model (identical face, hairstyle, body type and skin tone), the SAME garment from the reference image, and a cohesive color palette. High detail, realistic, no on-screen text, no captions, no watermark, no brand logos.`;

const PRODUCT = `A clean commercial product showcase for the product shown in the reference image, named "{{name}}". The product must look identical in every scene (same shape, color, label, and details); only the angle, framing, and context change. Key selling points to emphasize across the scenes: {{points}}.

Produce distinct shots, one per scene, vertical 9:16, premium e-commerce look with soft studio lighting, crisp focus, and a tasteful background:
1) Hero shot — the product centered on a clean surface, beautifully lit, the star of the frame.
2) Detail close-up — a tight macro shot showing texture, material, and craftsmanship.
3) Feature highlight — a shot that visually communicates one key selling point.
4) In-use lifestyle — the product used naturally in a realistic everyday setting.
5) Packaging beauty shot — the product with its packaging or a polished final glamour frame.

Consistency rules for every scene: the SAME product from the reference image, consistent lighting and color grade, photorealistic, high detail, no on-screen text, no watermark, no unrelated brand logos.`;

const BRAINROT = `A hyper-stylized, surreal internet brainrot short about: {{topic}}. Vibe: {{vibe}}. Fast-paced, absurd, meme aesthetic, exaggerated and high-energy.

Produce a sequence of wild, distinct scenes that tell a chaotic mini-story around {{topic}}, one beat per scene, vertical 9:16, vivid saturated colors, dynamic compositions, surreal and over-the-top. Keep a consistent main character and art style across all scenes so it reads as one coherent story. No on-screen text, no watermark.`;

const updates = [
  {
    slug: 'clothing', prompt_template: CLOTHING,
    defaults: { aspect: '9:16', sceneCount: 5, clipSeconds: 5, stylePrompt: 'fashion lookbook, model wearing the garment, editorial street style, natural motion' },
    input_schema: [
      { key: 'image', label: '服装图', type: 'image', required: true },
      { key: 'vibe', label: '风格 / 场景', type: 'text', placeholder: '例如:城市街拍、ins 简约风' },
    ],
  },
  {
    slug: 'product', prompt_template: PRODUCT,
    input_schema: [
      { key: 'image', label: '产品图', type: 'image', required: true },
      { key: 'name', label: '产品名称', type: 'text', required: true },
      { key: 'points', label: '卖点(2-3条)', type: 'textarea', placeholder: '一行一个卖点' },
    ],
  },
  { slug: 'brainrot', prompt_template: BRAINROT },
];

(async () => {
  for (const u of updates) {
    const patch = { prompt_template: u.prompt_template };
    if (u.input_schema) patch.input_schema = u.input_schema;
    if (u.defaults) patch.defaults = u.defaults;
    const { error } = await admin.from('templates').update(patch).eq('slug', u.slug).eq('is_official', true);
    console.log(u.slug, error ? `ERR ${error.message}` : 'updated');
  }
  // Verify clothing now has a prompt
  const { data } = await admin.from('templates').select('slug,prompt_template').eq('slug', 'clothing').maybeSingle();
  console.log('clothing prompt length:', (data && data.prompt_template || '').length);
})().catch((e) => console.log('FATAL', e.message));
