-- ═══════════════════════════════════════════════════════════
--  VSHORT v2 migration — bake locked prompt_template into the official templates
--  Run in Supabase SQL Editor after 0003. (Already applied to the live DB via
--  the service role; this file keeps it reproducible for fresh environments.)
-- ═══════════════════════════════════════════════════════════

update templates set
  input_schema = '[{"key":"image","label":"服装图","type":"image","required":true},{"key":"vibe","label":"风格 / 场景","type":"text","placeholder":"例如:城市街拍、ins 简约风"}]',
  prompt_template = 'A premium vertical fashion lookbook showcasing ONE single garment — the exact garment shown in the reference image — worn by the SAME consistent model in every scene. The garment must look identical across all scenes: same color, cut, fabric, pattern, and details; only the pose, camera angle, and framing change between scenes. Setting and mood: {{vibe}}.

Produce a sequence of distinct shots, one per scene, in this order, each a clean fashion-editorial frame with soft natural lighting, shallow depth of field, photorealistic skin and fabric, vertical 9:16 composition:
1) Full-body front shot — the model stands facing the camera, the complete outfit visible from head to toe, confident relaxed posture.
2) Three-quarter turn — the model rotates about 45 degrees, revealing the silhouette and the side seams of the garment.
3) Back view — the model is seen from behind, highlighting the back design, drape, and fit.
4) Walking shot — the model walks slowly toward the camera, the garment moving naturally with the body.
5) Detail close-up — a tight shot on the fabric texture, stitching, buttons, collar, or hemline of the garment.
6) Lifestyle pose — the model relaxed and candid within the {{vibe}} environment, natural editorial feel.

Hard consistency rules for every scene: keep the SAME model (identical face, hairstyle, body type and skin tone), the SAME garment from the reference image, and a cohesive color palette. High detail, realistic, no on-screen text, no captions, no watermark, no brand logos.'
where slug = 'clothing' and is_official;

update templates set
  input_schema = '[{"key":"image","label":"产品图","type":"image","required":true},{"key":"name","label":"产品名称","type":"text","required":true},{"key":"points","label":"卖点(2-3条)","type":"textarea","placeholder":"一行一个卖点"}]',
  prompt_template = 'A clean commercial product showcase for the product shown in the reference image, named "{{name}}". The product must look identical in every scene (same shape, color, label, and details); only the angle, framing, and context change. Key selling points to emphasize across the scenes: {{points}}.

Produce distinct shots, one per scene, vertical 9:16, premium e-commerce look with soft studio lighting, crisp focus, and a tasteful background:
1) Hero shot — the product centered on a clean surface, beautifully lit, the star of the frame.
2) Detail close-up — a tight macro shot showing texture, material, and craftsmanship.
3) Feature highlight — a shot that visually communicates one key selling point.
4) In-use lifestyle — the product used naturally in a realistic everyday setting.
5) Packaging beauty shot — the product with its packaging or a polished final glamour frame.

Consistency rules for every scene: the SAME product from the reference image, consistent lighting and color grade, photorealistic, high detail, no on-screen text, no watermark, no unrelated brand logos.'
where slug = 'product' and is_official;

update templates set
  prompt_template = 'A hyper-stylized, surreal internet brainrot short about: {{topic}}. Vibe: {{vibe}}. Fast-paced, absurd, meme aesthetic, exaggerated and high-energy.

Produce a sequence of wild, distinct scenes that tell a chaotic mini-story around {{topic}}, one beat per scene, vertical 9:16, vivid saturated colors, dynamic compositions, surreal and over-the-top. Keep a consistent main character and art style across all scenes so it reads as one coherent story. No on-screen text, no watermark.'
where slug = 'brainrot' and is_official;
