-- 库洛米打卡 · Supabase Schema
-- 在 Supabase Dashboard → SQL Editor 中整段执行
-- 执行前请确认：Authentication → Providers → Email → 关闭 "Confirm email"

-- ---------------------------------------------------------------------------
-- 扩展
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- families：家庭
-- ---------------------------------------------------------------------------
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我家',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.families is '家庭单位；多个家长、多个孩子归属于此';

-- ---------------------------------------------------------------------------
-- family_members：家长归属
-- ---------------------------------------------------------------------------
create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'member')),
  display_name text,
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

create index if not exists family_members_user_id_idx
  on public.family_members (user_id);

create index if not exists family_members_family_id_idx
  on public.family_members (family_id);

comment on table public.family_members is '家长账号与家庭的多对多；第一版通常一人一家';

-- ---------------------------------------------------------------------------
-- children：孩子（预留多个）
-- ---------------------------------------------------------------------------
create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null default '宝贝',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists children_family_id_idx
  on public.children (family_id);

comment on table public.children is '孩子档案；业务打卡数据在 child_state';

-- ---------------------------------------------------------------------------
-- child_state：每个孩子的完整业务状态（对应前端 state JSON）
-- ---------------------------------------------------------------------------
create table if not exists public.child_state (
  child_id uuid primary key references public.children (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create index if not exists child_state_family_id_idx
  on public.child_state (family_id);

create index if not exists child_state_updated_at_idx
  on public.child_state (updated_at desc);

comment on table public.child_state is '整份打卡 state；冲突以 updated_at 较大者为准';

-- ---------------------------------------------------------------------------
-- parent_pins：家长操作密码（敏感操作二次验证，非登录密码）
-- ---------------------------------------------------------------------------
create table if not exists public.parent_pins (
  family_id uuid primary key references public.families (id) on delete cascade,
  salt text not null,
  pin_hash text not null,
  fail_count int not null default 0,
  lock_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.parent_pins is '4–6 位家长操作密码的盐与哈希；登录密码在 Auth';

-- ---------------------------------------------------------------------------
-- audit_logs：操作审计
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  child_id uuid references public.children (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_label text not null default 'parent',
  action_type text not null,
  detail text,
  delta int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_family_created_idx
  on public.audit_logs (family_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 辅助：当前用户所属家庭
-- ---------------------------------------------------------------------------
create or replace function public.user_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id
  from public.family_members
  where user_id = auth.uid();
$$;

revoke all on function public.user_family_ids() from public;
grant execute on function public.user_family_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- 注册后初始化：创建家庭 + 成员 + 默认孩子 + 空 state
-- 由前端在 signUp 成功后调用；也可改为 Auth Hook
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_family(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid;
  v_child_id uuid;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select family_id into v_existing
  from public.family_members
  where user_id = v_uid
  limit 1;

  if v_existing is not null then
    select c.id into v_child_id
    from public.children c
    where c.family_id = v_existing
    order by c.sort_order, c.created_at
    limit 1;

    return jsonb_build_object(
      'family_id', v_existing,
      'child_id', v_child_id,
      'created', false
    );
  end if;

  insert into public.families (name)
  values (coalesce(nullif(trim(p_display_name), ''), '我家'))
  returning id into v_family_id;

  insert into public.family_members (family_id, user_id, role, display_name)
  values (v_family_id, v_uid, 'owner', p_display_name);

  insert into public.children (family_id, name, sort_order)
  values (v_family_id, '宝贝', 0)
  returning id into v_child_id;

  insert into public.child_state (child_id, family_id, state_json, updated_by)
  values (v_child_id, v_family_id, '{}'::jsonb, v_uid);

  return jsonb_build_object(
    'family_id', v_family_id,
    'child_id', v_child_id,
    'created', true
  );
end;
$$;

revoke all on function public.bootstrap_family(text) from public;
grant execute on function public.bootstrap_family(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 邀请家长加入家庭（由已有成员调用）
-- 被邀请人须已注册；传入对方 user_id 或由应用层先查账号再调
-- ---------------------------------------------------------------------------
create or replace function public.add_family_member(p_family_id uuid, p_member_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.family_members
    where family_id = p_family_id and user_id = auth.uid()
  ) then
    raise exception 'not a family member';
  end if;

  insert into public.family_members (family_id, user_id, role)
  values (p_family_id, p_member_user_id, 'member')
  on conflict (family_id, user_id) do nothing;
end;
$$;

revoke all on function public.add_family_member(uuid, uuid) from public;
grant execute on function public.add_family_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.children enable row level security;
alter table public.child_state enable row level security;
alter table public.parent_pins enable row level security;
alter table public.audit_logs enable row level security;

-- families
drop policy if exists families_select on public.families;
create policy families_select on public.families
  for select to authenticated
  using (id in (select public.user_family_ids()));

drop policy if exists families_update on public.families;
create policy families_update on public.families
  for update to authenticated
  using (id in (select public.user_family_ids()));

-- family_members
drop policy if exists family_members_select on public.family_members;
create policy family_members_select on public.family_members
  for select to authenticated
  using (family_id in (select public.user_family_ids()) or user_id = auth.uid());

drop policy if exists family_members_insert on public.family_members;
create policy family_members_insert on public.family_members
  for insert to authenticated
  with check (user_id = auth.uid() or family_id in (select public.user_family_ids()));

-- children
drop policy if exists children_select on public.children;
create policy children_select on public.children
  for select to authenticated
  using (family_id in (select public.user_family_ids()));

drop policy if exists children_insert on public.children;
create policy children_insert on public.children
  for insert to authenticated
  with check (family_id in (select public.user_family_ids()));

drop policy if exists children_update on public.children;
create policy children_update on public.children
  for update to authenticated
  using (family_id in (select public.user_family_ids()));

drop policy if exists children_delete on public.children;
create policy children_delete on public.children
  for delete to authenticated
  using (family_id in (select public.user_family_ids()));

-- child_state
drop policy if exists child_state_select on public.child_state;
create policy child_state_select on public.child_state
  for select to authenticated
  using (family_id in (select public.user_family_ids()));

drop policy if exists child_state_insert on public.child_state;
create policy child_state_insert on public.child_state
  for insert to authenticated
  with check (family_id in (select public.user_family_ids()));

drop policy if exists child_state_update on public.child_state;
create policy child_state_update on public.child_state
  for update to authenticated
  using (family_id in (select public.user_family_ids()));

-- parent_pins
drop policy if exists parent_pins_select on public.parent_pins;
create policy parent_pins_select on public.parent_pins
  for select to authenticated
  using (family_id in (select public.user_family_ids()));

drop policy if exists parent_pins_upsert on public.parent_pins;
create policy parent_pins_insert on public.parent_pins
  for insert to authenticated
  with check (family_id in (select public.user_family_ids()));

drop policy if exists parent_pins_update on public.parent_pins;
create policy parent_pins_update on public.parent_pins
  for update to authenticated
  using (family_id in (select public.user_family_ids()));

-- audit_logs
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (family_id in (select public.user_family_ids()));

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (family_id in (select public.user_family_ids()));

-- ---------------------------------------------------------------------------
-- Realtime（可选）：Dashboard → Database → Replication 勾选 child_state
-- 或执行（需 supabase_realtime publication 已存在）：
-- alter publication supabase_realtime add table public.child_state;
-- ---------------------------------------------------------------------------
