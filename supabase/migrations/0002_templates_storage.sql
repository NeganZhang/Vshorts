-- ═══════════════════════════════════════════════════════════
--  VSHORT v2 migration — templates, scene clip cols, storage
--  Run AFTER schema.sql, in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════

-- ── 1. scenes: per-scene generated clip cache (mirrors the SQLite pivot cols)
alter table scenes add column if not exists clip_path   text;
alter table scenes add column if not exists clip_status text not null default 'none';

-- ── 1b. edit_jobs: render pipeline progress columns (SQLite had these; the
--       original Supabase schema.sql did not). Required by the render worker.
alter table edit_jobs add column if not exists stage     text;
alter table edit_jobs add column if not exists stage_msg text;

-- ── 2. templates (shareable workflows; phase 1 = official seeds only)
create table if not exists templates (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,
  title          text not null,
  category       text,
  accent         text default '#ff5c2b',
  description    text,
  reference_mode text not null default 'text' check (reference_mode in ('text','image','both')),
  defaults       jsonb not null default '{}'::jsonb,   -- {aspect, sceneCount, clipSeconds, stylePrompt}
  input_schema   jsonb not null default '[]'::jsonb,   -- [{key,label,type,placeholder,required}]
  prompt_template text,
  is_official    boolean not null default false,
  is_public      boolean not null default false,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_templates_visibility on templates(is_official, is_public);

alter table templates enable row level security;

-- Anyone (even anon) can read official/public templates; owners read their own.
create policy "read official/public/own templates"
  on templates for select
  using (is_official or is_public or auth.uid() = created_by);

-- Owners manage their own (phase 2 community upload).
create policy "insert own templates"
  on templates for insert with check (auth.uid() = created_by);
create policy "update own templates"
  on templates for update using (auth.uid() = created_by) with check (auth.uid() = created_by);
create policy "delete own templates"
  on templates for delete using (auth.uid() = created_by);

create trigger set_updated_at before update on templates
  for each row execute function update_updated_at();

-- ── 3. Storage buckets for generated assets (worker writes via service role)
insert into storage.buckets (id, name, public) values
  ('scenes', 'scenes', true),
  ('scene-clips', 'scene-clips', true),
  ('renders', 'renders', true)
on conflict (id) do nothing;

-- Public read for the three asset buckets (writes happen via service role,
-- which bypasses RLS, so no insert policy is needed for the worker).
create policy "public read assets"
  on storage.objects for select
  using (bucket_id in ('scenes','scene-clips','renders'));

-- ── 4. Seed the 3 official templates (idempotent on slug)
insert into templates (slug, title, category, accent, description, reference_mode, defaults, input_schema, is_official)
values
('product', '产品展示 · Product', '电商 / 带货', '#ff5c2b',
 '上传一张产品图,生成多镜头的种草短视频:开箱、卖点特写、使用场景。', 'both',
 '{"aspect":"9:16","sceneCount":5,"clipSeconds":5,"stylePrompt":"clean commercial product showcase, soft studio lighting, premium feel"}',
 '[{"key":"image","label":"产品图","type":"image","required":false},{"key":"name","label":"产品名称","type":"text","required":true},{"key":"points","label":"卖点(2-3条)","type":"textarea"}]',
 true),
('clothing', '服装展示 · Clothing', '穿搭 / 服饰', '#b400ff',
 '上传一件衣服的实拍图,生成模特上身、转身、街拍质感的展示短视频。', 'both',
 '{"aspect":"9:16","sceneCount":5,"clipSeconds":5,"stylePrompt":"fashion lookbook, model wearing the garment, editorial street style, natural motion"}',
 '[{"key":"image","label":"服装图","type":"image","required":false},{"key":"vibe","label":"风格 / 场景","type":"text"}]',
 true),
('brainrot', 'Brainrot', '梗 / 流量', '#00d4ff',
 '给一个主题(比如「小猫救火」),AI 生成超流畅的脑洞短视频。', 'text',
 '{"aspect":"9:16","sceneCount":6,"clipSeconds":5,"stylePrompt":"hyper-stylized internet brainrot, surreal, high-energy, meme aesthetic"}',
 '[{"key":"topic","label":"主题","type":"text","required":true},{"key":"vibe","label":"感觉(可选)","type":"text"}]',
 true)
on conflict (slug) do nothing;
