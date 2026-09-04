-- 多家长邀请码：在已有项目 SQL Editor 中执行本文件
-- （若是新项目，也可合并进 supabase-schema.sql 再整库重建）

alter table public.families
  add column if not exists invite_code text;

create unique index if not exists families_invite_code_uidx
  on public.families (invite_code)
  where invite_code is not null;

comment on column public.families.invite_code is '其他家长加入本家庭时使用的邀请码';

-- 生成 8 位易读邀请码（去掉易混字符）
create or replace function public.gen_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..8 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.ensure_family_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid;
  v_code text;
  v_try int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select family_id into v_family_id
  from public.family_members
  where user_id = v_uid
  limit 1;

  if v_family_id is null then
    raise exception 'no family';
  end if;

  select invite_code into v_code from public.families where id = v_family_id;
  if v_code is not null and length(v_code) > 0 then
    return v_code;
  end if;

  loop
    v_code := public.gen_invite_code();
    begin
      update public.families set invite_code = v_code, updated_at = now()
      where id = v_family_id and (invite_code is null or invite_code = '');
      if found then
        return v_code;
      end if;
      select invite_code into v_code from public.families where id = v_family_id;
      if v_code is not null then
        return v_code;
      end if;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 20 then
        raise exception 'invite code generation failed';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.ensure_family_invite_code() from public;
grant execute on function public.ensure_family_invite_code() to authenticated;

-- 用邀请码加入已有家庭（当前用户尚无家庭，或仅有空壳时可加入）
create or replace function public.join_family_by_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(p_code));
  v_family_id uuid;
  v_child_id uuid;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_code is null or length(v_code) < 4 then
    raise exception 'invalid invite code';
  end if;

  select id into v_family_id
  from public.families
  where invite_code = v_code
  limit 1;

  if v_family_id is null then
    raise exception 'invite code not found';
  end if;

  select family_id into v_existing
  from public.family_members
  where user_id = v_uid
  limit 1;

  if v_existing is not null and v_existing <> v_family_id then
    -- 若已在别的家庭，不允许直接跳槽（避免误操作）
    raise exception 'already in another family';
  end if;

  insert into public.family_members (family_id, user_id, role)
  values (v_family_id, v_uid, 'member')
  on conflict (family_id, user_id) do nothing;

  select c.id into v_child_id
  from public.children c
  where c.family_id = v_family_id
  order by c.sort_order, c.created_at
  limit 1;

  return jsonb_build_object(
    'family_id', v_family_id,
    'child_id', v_child_id,
    'joined', true
  );
end;
$$;

revoke all on function public.join_family_by_invite(text) from public;
grant execute on function public.join_family_by_invite(text) to authenticated;

-- 给已有家庭补邀请码
do $$
declare
  r record;
  code text;
  tries int;
begin
  for r in select id from public.families where invite_code is null or invite_code = '' loop
    tries := 0;
    loop
      code := public.gen_invite_code();
      begin
        update public.families set invite_code = code where id = r.id;
        exit;
      exception when unique_violation then
        tries := tries + 1;
        if tries > 20 then
          raise exception 'backfill invite failed for %', r.id;
        end if;
      end;
    end loop;
  end loop;
end $$;
