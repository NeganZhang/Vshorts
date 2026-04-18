-- ═══════════════════════════════════════════════════════════
--  VSHORT — Supabase Schema
--  Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────
create type subscription_plan   as enum ('free', 'pro', 'unlimited');
create type subscription_status as enum ('active', 'canceled', 'past_due');
create type job_status          as enum ('pending', 'generating', 'processing', 'done', 'error');
create type sex_type             as enum ('male', 'female', 'other', 'prefer_not_to_say');

-- ═══════════════════════════════════════════════════════════
--  1. PROFILES  (extends auth.users)
-- ═══════════════════════════════════════════════════════════
create table profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  email                    text not null,
  nickname                 text,
  birthday                 date,
  sex                      sex_type,
  disclaimer_accepted_at   timestamptz,
  stripe_customer_id       text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index idx_profiles_stripe on profiles(stripe_customer_id);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ═══════════════════════════════════════════════════════════
--  2. SUBSCRIPTIONS
-- ═══════════════════════════════════════════════════════════
create table subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references profiles(id) on delete cascade,
  stripe_sub_id         text unique,
  plan                  subscription_plan not null default 'free',
  status                subscription_status not null default 'active',
  current_period_end    timestamptz,
  cancel_at_period_end  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_subs_user   on subscriptions(user_id);
create index idx_subs_stripe on subscriptions(stripe_sub_id);

alter table subscriptions enable row level security;

create policy "Users can view own subscription"
  on subscriptions for select
  using (auth.uid() = user_id);

-- service_role can manage subscriptions (for Stripe webhook)
-- No insert/update policy for anon — handled server-side via service_role key

-- ═══════════════════════════════════════════════════════════
--  3. PROJECTS
-- ═══════════════════════════════════════════════════════════
create table projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null default 'Untitled Project',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_projects_user on projects(user_id, updated_at desc);

alter table projects enable row level security;

create policy "Users can view own projects"
  on projects for select
  using (auth.uid() = user_id);

create policy "Users can create own projects"
  on projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update own projects"
  on projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own projects"
  on projects for delete
  using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
--  4. SCRIPTS
-- ═══════════════════════════════════════════════════════════
create table scripts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  prompt      text not null,
  content     text,
  status      job_status not null default 'pending',
  created_at  timestamptz not null default now()
);

create index idx_scripts_project on scripts(project_id);

alter table scripts enable row level security;

create policy "Users can view own scripts"
  on scripts for select
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can create scripts in own projects"
  on scripts for insert
  with check (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can update own scripts"
  on scripts for update
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can delete own scripts"
  on scripts for delete
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════
--  5. SCENES
-- ═══════════════════════════════════════════════════════════
create table scenes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  sort_order  integer not null default 0,
  prompt      text not null default '',
  shot_type   text not null default 'Wide Shot',
  camera_move text not null default 'Static',
  duration    text not null default '0-4s',
  image_path  text,
  status      job_status not null default 'pending',
  created_at  timestamptz not null default now()
);

create index idx_scenes_project on scenes(project_id, sort_order);

alter table scenes enable row level security;

create policy "Users can view own scenes"
  on scenes for select
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can create scenes in own projects"
  on scenes for insert
  with check (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can update own scenes"
  on scenes for update
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can delete own scenes"
  on scenes for delete
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════
--  6. CLIPS
-- ═══════════════════════════════════════════════════════════
create table clips (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  filename      text not null,
  storage_path  text,
  filesize      bigint,
  duration_ms   integer,
  mime_type     text,
  created_at    timestamptz not null default now()
);

create index idx_clips_project on clips(project_id);

alter table clips enable row level security;

create policy "Users can view own clips"
  on clips for select
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can create clips in own projects"
  on clips for insert
  with check (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can delete own clips"
  on clips for delete
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════
--  7. EDIT JOBS
-- ═══════════════════════════════════════════════════════════
create table edit_jobs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  config      jsonb not null default '{}',
  status      job_status not null default 'pending',
  progress    integer not null default 0,
  output_path text,
  error_msg   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_editjobs_project on edit_jobs(project_id);

alter table edit_jobs enable row level security;

create policy "Users can view own edit jobs"
  on edit_jobs for select
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can create edit jobs in own projects"
  on edit_jobs for insert
  with check (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "Users can update own edit jobs"
  on edit_jobs for update
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════
--  TRIGGER: Auto-create profile + subscription on signup
-- ═══════════════════════════════════════════════════════════
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  -- Create profile, pulling optional fields out of the signup metadata
  insert into public.profiles (id, email, nickname, birthday, sex, disclaimer_accepted_at)
  values (
    new.id,
    new.email,
    nullif(meta->>'nickname', ''),
    case when meta->>'birthday' ~ '^\d{4}-\d{2}-\d{2}$'
         then (meta->>'birthday')::date else null end,
    case when meta->>'sex' in ('male','female','other','prefer_not_to_say')
         then (meta->>'sex')::public.sex_type else null end,
    case when meta->>'disclaimer_accepted_at' is not null
         then (meta->>'disclaimer_accepted_at')::timestamptz else null end
  );

  -- Create free subscription
  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ═══════════════════════════════════════════════════════════
--  FUNCTION: Auto-update updated_at timestamp
-- ═══════════════════════════════════════════════════════════
create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on profiles
  for each row execute function update_updated_at();
create trigger set_updated_at before update on subscriptions
  for each row execute function update_updated_at();
create trigger set_updated_at before update on projects
  for each row execute function update_updated_at();
create trigger set_updated_at before update on edit_jobs
  for each row execute function update_updated_at();
