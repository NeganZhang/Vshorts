-- ═══════════════════════════════════════════════════════════
--  Migration: add nickname / birthday / sex / disclaimer fields
--  to the profiles table. Run this once in the Supabase
--  SQL Editor on top of the existing schema.
-- ═══════════════════════════════════════════════════════════

create type sex_type as enum ('male', 'female', 'other', 'prefer_not_to_say');

alter table profiles
  add column if not exists nickname              text,
  add column if not exists birthday              date,
  add column if not exists sex                   sex_type,
  add column if not exists disclaimer_accepted_at timestamptz;

create index if not exists idx_profiles_nickname on profiles(nickname);

-- ─── Replace signup trigger so it copies optional metadata
--     (nickname / birthday / sex / disclaimer_accepted_at) from
--     auth.users.raw_user_meta_data into the profiles row.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
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

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active');

  return new;
end;
$$;
