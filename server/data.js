// Supabase data + storage layer (Phase 0). Centralizes every DB query and
// asset upload so the routes/services just call async helpers. Service-role
// client → bypasses RLS (the worker is trusted); FKs still apply.
require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) console.warn('[data] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — Supabase calls will fail');

const supabase = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const BUCKETS = ['scenes', 'scene-clips', 'renders'];

async function ensureBuckets() {
  try {
    const { data } = await supabase.storage.listBuckets();
    const have = new Set((data || []).map((b) => b.id));
    for (const id of BUCKETS) {
      if (!have.has(id)) await supabase.storage.createBucket(id, { public: true });
    }
  } catch (e) {
    console.warn('[data] ensureBuckets:', e.message);
  }
}

// Upload a Buffer or a local file path; returns the public URL.
async function uploadAsset(bucket, key, bodyOrPath, contentType) {
  const body = Buffer.isBuffer(bodyOrPath) ? bodyOrPath : fs.readFileSync(bodyOrPath);
  const { error } = await supabase.storage.from(bucket).upload(key, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${bucket}/${key}: ${error.message}`);
  return supabase.storage.from(bucket).getPublicUrl(key).data.publicUrl;
}

// Tiny helper: throw on error, else return data.
function ok(res) { if (res.error) throw new Error(res.error.message); return res.data; }

// ─── Projects ──────────────────────────────────────────────
const projects = {
  list: (userId) => supabase.from('projects').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).then(ok),
  create: (userId, name) => supabase.from('projects').insert({ user_id: userId, name }).select().single().then(ok),
  getOwned: (id, userId) => supabase.from('projects').select('*').eq('id', id).eq('user_id', userId).maybeSingle().then(ok),
  updateName: (id, name) => supabase.from('projects').update({ name }).eq('id', id).select().single().then(ok),
  remove: (id, userId) => supabase.from('projects').delete().eq('id', id).eq('user_id', userId).select('id').then(ok),
  touch: (id) => supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id).then(ok),
};

// ─── Scripts ───────────────────────────────────────────────
const scripts = {
  insert: (projectId, prompt) => supabase.from('scripts').insert({ project_id: projectId, prompt, status: 'generating' }).select().single().then(ok),
  setDone: (id, content) => supabase.from('scripts').update({ content, status: 'done' }).eq('id', id).then(ok),
  setError: (id, content) => supabase.from('scripts').update({ content, status: 'error' }).eq('id', id).then(ok),
  get: (id, projectId) => supabase.from('scripts').select('*').eq('id', id).eq('project_id', projectId).maybeSingle().then(ok),
  listByProject: (projectId) => supabase.from('scripts').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).then(ok),
};

// ─── Scenes ────────────────────────────────────────────────
const scenes = {
  list: (projectId) => supabase.from('scenes').select('*').eq('project_id', projectId).order('sort_order').then(ok),
  get: (id) => supabase.from('scenes').select('*').eq('id', id).maybeSingle().then(ok),
  insert: (row) => supabase.from('scenes').insert(row).select().single().then(ok),
  insertMany: (rows) => supabase.from('scenes').insert(rows).select().then(ok),
  update: (id, patch) => supabase.from('scenes').update(patch).eq('id', id).select().single().then(ok),
  deleteByProject: (projectId) => supabase.from('scenes').delete().eq('project_id', projectId).then(ok),
  remove: (id, projectId) => supabase.from('scenes').delete().eq('id', id).eq('project_id', projectId).select('id').then(ok),
  maxSortOrder: async (projectId) => {
    const rows = await supabase.from('scenes').select('sort_order').eq('project_id', projectId).order('sort_order', { ascending: false }).limit(1).then(ok);
    return rows && rows.length ? rows[0].sort_order : -1;
  },
  setStatus: (id, status) => supabase.from('scenes').update({ status }).eq('id', id).then(ok),
  setImage: (id, status, image_path) => supabase.from('scenes').update({ status, image_path }).eq('id', id).then(ok),
  setClip: (id, clip_path, clip_status) => supabase.from('scenes').update({ clip_path, clip_status }).eq('id', id).then(ok),
  setClipStatus: (id, clip_status) => supabase.from('scenes').update({ clip_status }).eq('id', id).then(ok),
  countWithImage: (projectId) =>
    supabase.from('scenes').select('id', { count: 'exact', head: true }).eq('project_id', projectId).not('image_path', 'is', null).eq('status', 'done')
      .then((r) => { if (r.error) throw new Error(r.error.message); return r.count || 0; }),
  doneWithImage: (projectId) => supabase.from('scenes').select('*').eq('project_id', projectId).eq('status', 'done').not('image_path', 'is', null).order('sort_order').then(ok),
};

// ─── Clips (user uploads — legacy, kept for compatibility) ──
const clips = {
  count: (projectId) => supabase.from('clips').select('id', { count: 'exact', head: true }).eq('project_id', projectId).then((r) => { if (r.error) throw new Error(r.error.message); return r.count || 0; }),
  insert: (row) => supabase.from('clips').insert(row).select().single().then(ok),
  list: (projectId) => supabase.from('clips').select('*').eq('project_id', projectId).order('created_at').then(ok),
  get: (id, projectId) => supabase.from('clips').select('*').eq('id', id).eq('project_id', projectId).maybeSingle().then(ok),
  remove: (id) => supabase.from('clips').delete().eq('id', id).then(ok),
};

// ─── Edit / render jobs ────────────────────────────────────
const jobs = {
  insert: (projectId, config) => supabase.from('edit_jobs').insert({ project_id: projectId, config, status: 'processing', progress: 0 }).select().single().then(ok),
  get: (id, projectId) => supabase.from('edit_jobs').select('*').eq('id', id).eq('project_id', projectId).maybeSingle().then(ok),
  list: (projectId) => supabase.from('edit_jobs').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).then(ok),
  active: (projectId) => supabase.from('edit_jobs').select('id').eq('project_id', projectId).eq('status', 'processing').maybeSingle().then(ok),
  setStage: (id, progress, stage, stage_msg) => supabase.from('edit_jobs').update({ progress, stage, stage_msg, updated_at: new Date().toISOString() }).eq('id', id).then(ok),
  markDone: (id, output_path) => supabase.from('edit_jobs').update({ status: 'done', progress: 100, stage: 'done', stage_msg: 'Ready to download', output_path, updated_at: new Date().toISOString() }).eq('id', id).then(ok),
  markError: (id, error_msg, stage_msg) => supabase.from('edit_jobs').update({ status: 'error', stage: 'error', error_msg, stage_msg, updated_at: new Date().toISOString() }).eq('id', id).then(ok),
};

// ─── Templates ─────────────────────────────────────────────
const templates = {
  // Official + public templates, plus the caller's own (private) ones.
  listVisible: (userId) => {
    const filter = userId
      ? `is_official.eq.true,is_public.eq.true,created_by.eq.${userId}`
      : 'is_official.eq.true,is_public.eq.true';
    return supabase.from('templates').select('*').or(filter).order('created_at').then(ok);
  },
  getBySlug: (slug) => supabase.from('templates').select('*').eq('slug', slug).maybeSingle().then(ok),
  get: (id) => supabase.from('templates').select('*').eq('id', id).maybeSingle().then(ok),
  create: (userId, t) => supabase.from('templates').insert({ ...t, created_by: userId }).select().single().then(ok),
};

// ─── Billing (profiles carry stripe_customer_id; subscriptions table) ──
const billing = {
  getProfile: (userId) => supabase.from('profiles').select('*').eq('id', userId).maybeSingle().then(ok),
  setStripeCustomer: (userId, cid) => supabase.from('profiles').update({ stripe_customer_id: cid }).eq('id', userId).then(ok),
  profileByCustomer: (cid) => supabase.from('profiles').select('id').eq('stripe_customer_id', cid).maybeSingle().then(ok),
  getSubscription: (userId) => supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle().then(ok),
  upsertSubscription: (row) => supabase.from('subscriptions').upsert(row, { onConflict: 'user_id' }).then(ok),
  updateSubscription: (userId, patch) => supabase.from('subscriptions').update(patch).eq('user_id', userId).then(ok),
  countProjects: (userId) => supabase.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', userId).then((r) => { if (r.error) throw new Error(r.error.message); return r.count || 0; }),
  scriptsSince: async (userId, sinceISO) => {
    const projs = await supabase.from('projects').select('id').eq('user_id', userId).then(ok);
    const ids = (projs || []).map((p) => p.id);
    if (!ids.length) return 0;
    const r = await supabase.from('scripts').select('id', { count: 'exact', head: true }).in('project_id', ids).gte('created_at', sinceISO);
    if (r.error) throw new Error(r.error.message);
    return r.count || 0;
  },
};

module.exports = { supabase, ensureBuckets, uploadAsset, projects, scripts, scenes, clips, jobs, templates, billing };
