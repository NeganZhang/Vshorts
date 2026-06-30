// Conversational agent endpoint. Runs a Claude tool-use loop server-side and
// drives the pipeline by calling THIS worker's own REST API as a client
// (forwarding the caller's auth token), so it keeps working unchanged after the
// data layer moves to Supabase. Falls back to a useful mock when no key is set.
const { Router } = require('express');
const { proxiedFetch } = require('../httpProxy');
const router = Router();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SELF = `http://localhost:${process.env.PORT || 3000}`;

const SYSTEM = `You are VShort's assistant — a one-stop AI short-video maker AND a prompt copilot.
Verticals: product showcase, clothing, brainrot. Be concise and friendly; reply in the user's
language (Chinese or English).

You can:
- Turn an idea into a finished vertical short: create_storyboard → get_status → render_video.
  Confirm briefly before render_video (it costs credits).
- Help REFINE the user's generation prompt: propose a tighter, more vivid version.
- Use existing templates: list_templates to see them, run_template to run one with the user's inputs.
- Assemble a reusable TEMPLATE from a good prompt: write a prompt_template using {{placeholders}}
  for the parts the end-user fills in, then call publish_template. ALWAYS show the user the draft
  (title + the prompt + which inputs they'll fill) and get a clear "yes" before publishing.
  Published prompts are HIDDEN from other users (creator protection) — say so.

After create_storyboard or run_template, tell the user the images are generating and they can
watch / adjust them in the workspace.`;

const TOOLS = [
  {
    name: 'create_storyboard',
    description: 'Create a storyboard (a set of scenes) from an idea. Starts async image generation.',
    input_schema: {
      type: 'object',
      properties: {
        idea: { type: 'string', description: 'The full video idea / brief.' },
        scene_count: { type: 'integer', description: '3-8, default 5' },
        aspect: { type: 'string', enum: ['9:16', '16:9', '1:1'], description: 'default 9:16' },
      },
      required: ['idea'],
    },
  },
  { name: 'get_status', description: 'Check how many scene images are ready for the current project.', input_schema: { type: 'object', properties: {} } },
  { name: 'render_video', description: 'Stitch the ready scenes into the final video. Returns a job id.', input_schema: { type: 'object', properties: {} } },
  { name: 'list_templates', description: 'List available templates (official, public, and the user\'s own), with their input keys.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'run_template',
    description: 'Run an existing template by id with the user-provided inputs. Starts image generation.',
    input_schema: {
      type: 'object',
      properties: {
        template_id: { type: 'string' },
        inputs: { type: 'object', description: 'values for the template placeholders, keyed by input key' },
        scene_count: { type: 'integer' },
        aspect: { type: 'string', enum: ['9:16', '16:9', '1:1'] },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'publish_template',
    description: 'Publish a reusable template. ONLY after the user confirms. The prompt_template is stored hidden from other users.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        category: { type: 'string' },
        description: { type: 'string' },
        reference_mode: { type: 'string', enum: ['text', 'image', 'both'] },
        prompt_template: { type: 'string', description: 'the generation prompt; use {{placeholders}} for the parts end-users fill in' },
        style_prompt: { type: 'string', description: 'optional global style appended to every scene' },
      },
      required: ['title', 'prompt_template'],
    },
  },
];

function apiCall(authHeader, method, path, body) {
  return fetch(`${SELF}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const t = await r.text();
    const d = t ? JSON.parse(t) : null;
    if (!r.ok) throw new Error((d && d.error) || `HTTP ${r.status}`);
    return d;
  });
}

// Execute a tool; `state` carries projectId across calls within one request.
async function runTool(name, input, state, authHeader) {
  if (name === 'create_storyboard') {
    if (!state.projectId) {
      const proj = await apiCall(authHeader, 'POST', '/projects', { name: (input.idea || 'VShort').slice(0, 40) });
      state.projectId = proj.id;
    }
    const aspect = input.aspect || '9:16';
    const numScenes = Math.max(3, Math.min(8, input.scene_count || 5));
    const scenes = await apiCall(authHeader, 'POST', `/projects/${state.projectId}/scenes/auto-generate`, { prompt: input.idea, numScenes, aspect });
    return { project_id: state.projectId, scenes_created: Array.isArray(scenes) ? scenes.length : numScenes, note: 'images generating asynchronously' };
  }
  if (name === 'get_status') {
    if (!state.projectId) return { error: 'no project yet' };
    const scenes = await apiCall(authHeader, 'GET', `/projects/${state.projectId}/scenes`);
    const done = scenes.filter((s) => s.status === 'done' && s.image_path).length;
    return { total: scenes.length, ready: done, generating: scenes.length - done };
  }
  if (name === 'render_video') {
    if (!state.projectId) return { error: 'no project yet' };
    const job = await apiCall(authHeader, 'POST', `/projects/${state.projectId}/edit-jobs`, { config: { exportFormat: 'tiktok' } });
    return { job_id: job.id || job.jobId, status: job.status || 'processing', error: job.error };
  }
  if (name === 'list_templates') {
    const list = await apiCall(authHeader, 'GET', '/templates');
    return (list || []).map((t) => ({ id: t.id, title: t.title, category: t.category, reference_mode: t.reference_mode, inputs: (t.input_schema || []).map((i) => i.key) }));
  }
  if (name === 'run_template') {
    const r = await apiCall(authHeader, 'POST', `/templates/${input.template_id}/run`, {
      inputs: input.inputs || {}, numScenes: input.scene_count, aspect: input.aspect,
    });
    state.projectId = r.projectId;
    return { project_id: r.projectId, scenes_created: Array.isArray(r.scenes) ? r.scenes.length : undefined, note: 'images generating asynchronously' };
  }
  if (name === 'publish_template') {
    const keys = [...new Set([...(input.prompt_template || '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
    const input_schema = keys.map((k) => ({ key: k, label: k, type: 'text', required: true }));
    const t = await apiCall(authHeader, 'POST', '/templates', {
      title: input.title, category: input.category, description: input.description,
      reference_mode: input.reference_mode || 'text',
      defaults: { aspect: '9:16', sceneCount: 5, clipSeconds: 5, stylePrompt: input.style_prompt || '' },
      input_schema, prompt_template: input.prompt_template, is_public: true,
    });
    return { published: true, template_id: t.id, title: t.title, user_inputs: keys };
  }
  return { error: `unknown tool ${name}` };
}

async function anthropic(messages) {
  const res = await proxiedFetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

router.post('/', async (req, res) => {
  const { message, projectId, history } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  const authHeader = req.headers.authorization;
  const state = { projectId: projectId || null };

  // ── Mock fallback: no key → still do something useful (build a storyboard).
  if (!ANTHROPIC_API_KEY) {
    try {
      const r = await runTool('create_storyboard', { idea: message, scene_count: 5, aspect: '9:16' }, state, authHeader);
      return res.json({
        reply: `(本地模式)我按你的描述生成了 ${r.scenes_created} 个分镜,正在出图——去「工作台」就能看到。接入 ANTHROPIC_API_KEY 后我就能自动对话、确认并帮你直接渲染。`,
        projectId: state.projectId,
      });
    } catch (e) {
      return res.json({ reply: `(本地模式)暂时没能创建分镜:${e.message}。可以先到「工作台」手动生成。`, projectId: state.projectId });
    }
  }

  // ── Real tool-use loop.
  try {
    const messages = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-8)) {
        if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string') {
          messages.push({ role: h.role, content: h.text });
        }
      }
    }
    messages.push({ role: 'user', content: message });

    for (let i = 0; i < 5; i++) {
      const resp = await anthropic(messages);
      messages.push({ role: 'assistant', content: resp.content });
      if (resp.stop_reason !== 'tool_use') {
        const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return res.json({ reply: text || '好的。', projectId: state.projectId });
      }
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try { result = await runTool(block.name, block.input || {}, state, authHeader); }
        catch (e) { result = { error: e.message || String(e) }; }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return res.json({ reply: '我已经处理了几步,但还没收尾——再说一句让我继续?', projectId: state.projectId });
  } catch (err) {
    console.error('[agent]', err);
    return res.status(500).json({ error: err.message || 'agent failed' });
  }
});

module.exports = router;
