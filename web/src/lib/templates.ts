import type { Template } from './types';

// Built-in seed templates (Phase 1). Later these come from Supabase `templates`.
// Each defines what the end-user provides and the default render settings.
export const TEMPLATES: Template[] = [
  {
    slug: 'product',
    title: '产品展示 · Product',
    category: '电商 / 带货',
    accent: '#ff5c2b',
    description: '上传一张产品图,生成多镜头的种草短视频:开箱、卖点特写、使用场景。',
    referenceMode: 'both',
    defaults: { aspect: '9:16', sceneCount: 5, clipSeconds: 5, stylePrompt: 'clean commercial product showcase, soft studio lighting, premium feel' },
    inputs: [
      { key: 'image', label: '产品图', type: 'image', required: false },
      { key: 'name', label: '产品名称', type: 'text', placeholder: '例如:便携榨汁杯', required: true },
      { key: 'points', label: '卖点(2-3条)', type: 'textarea', placeholder: '一行一个卖点' },
    ],
  },
  {
    slug: 'clothing',
    title: '服装展示 · Clothing',
    category: '穿搭 / 服饰',
    accent: '#b400ff',
    description: '上传一件衣服的实拍图,生成模特上身、转身、街拍质感的展示短视频。',
    referenceMode: 'both',
    defaults: { aspect: '9:16', sceneCount: 5, clipSeconds: 5, stylePrompt: 'fashion lookbook, model wearing the garment, editorial street style, natural motion' },
    inputs: [
      { key: 'image', label: '服装图', type: 'image', required: false },
      { key: 'vibe', label: '风格 / 场景', type: 'text', placeholder: '例如:城市街拍、ins 简约风' },
    ],
  },
  {
    slug: 'brainrot',
    title: 'Brainrot',
    category: '梗 / 流量',
    accent: '#00d4ff',
    description: '给一个主题(比如「小猫救火」),AI 生成超流畅的脑洞短视频。',
    referenceMode: 'text',
    defaults: { aspect: '9:16', sceneCount: 6, clipSeconds: 5, stylePrompt: 'hyper-stylized internet brainrot, surreal, high-energy, meme aesthetic' },
    inputs: [
      { key: 'topic', label: '主题', type: 'text', placeholder: '例如:小猫救火', required: true },
      { key: 'vibe', label: '感觉(可选)', type: 'text', placeholder: '例如:搞笑、热血、阴间' },
    ],
  },
];

export function templateBySlug(slug: string): Template | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}

// Turn a template + the user's inputs into a single generation prompt the
// existing script/scene splitter can consume.
export function buildPrompt(t: Template, inputs: Record<string, string>): string {
  const lines: string[] = [`Make a ${t.defaults.sceneCount}-scene vertical short. Style: ${t.defaults.stylePrompt}.`];
  if (t.slug === 'product') {
    lines.push(`Product: ${inputs.name || 'the product'}.`);
    if (inputs.points) lines.push(`Selling points: ${inputs.points.replace(/\n/g, '; ')}.`);
  } else if (t.slug === 'clothing') {
    lines.push(`Showcase the garment. Vibe: ${inputs.vibe || 'clean modern lookbook'}.`);
  } else {
    lines.push(`Topic: ${inputs.topic || 'a wild idea'}. Vibe: ${inputs.vibe || 'high-energy and funny'}.`);
  }
  return lines.join(' ');
}
