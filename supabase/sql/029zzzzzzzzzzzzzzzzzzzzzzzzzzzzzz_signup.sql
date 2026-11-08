-- erp-core 저장소 supabase/signup.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 직원 계정 신청 (2026-11-09). access.sql·accounts.sql·comms.sql·more.sql 뒤에 돈다.
--  로그인 화면 '계정 만들기': 이름·전화번호·생년월일·아이디·비밀번호·회사 → Supabase 가입(메타데이터 kind=staff) → staff_signup_register로 신청 남김.
--  관리자: 계정 › 가입 신청에서 직원 카드를 고르거나(없으면 새로 만들고) 승인 → 회사 소속(직원)·직원 카드 연결·이메일 확인 처리.
--  신청은 app 스키마에 남는다(이관해도 안 지워짐).
create table if not exists app.staff_signups (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  company_id  text not null,
  login       text not null,
  name        text not null,
  phone       text,
  birth_date  date,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  text
);
alter table app.staff_signups enable row level security;
revoke all on app.staff_signups from anon, authenticated;
alter table app.staff_signups add column if not exists birth_date date;

-- 가입 화면에서 고르는 회사(이름만)
create or replace function public.signup_companies() returns table (id text, name text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name from erp.companies c where exists (select 1 from app.memberships m where m.company_id = c.id and m.role = 'admin') order by c.name
$$;

-- 아이디를 쓸 수 있나(가입 전에 미리 확인)
create or replace function public.staff_login_available(p_login text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from auth.users where lower(email) = lower(case when p_login like '%@%' then trim(p_login) else trim(p_login) || '@erp.local' end))
$$;

-- 가입 직후 신청 남기기: 방금(30분 안) kind=staff로 가입한 그 아이디만. 이미 회사 소속이거나 신청이 있으면 아무것도 안 한다.
create or replace function public.staff_signup_register(p_login text, p_company text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u auth.users; v_name text; a record;
begin
  select * into u from auth.users
  where lower(email) = lower(case when p_login like '%@%' then trim(p_login) else trim(p_login) || '@erp.local' end)
    and created_at > now() - interval '30 minutes' and raw_user_meta_data->>'kind' = 'staff';
  if u.id is null then raise exception '방금 만든 계정을 찾지 못했습니다. 다시 해 보세요.'; end if;
  if not exists (select 1 from erp.companies where id = p_company) then raise exception '회사를 고르세요.'; end if;
  if exists (select 1 from app.memberships where user_id = u.id) or exists (select 1 from app.staff_signups where user_id = u.id) then return false; end if;
  v_name := nullif(trim(coalesce(u.raw_user_meta_data->>'name', '')), '');
  if v_name is null then raise exception '이름을 넣으세요.'; end if;
  insert into app.staff_signups (user_id, company_id, login, name, phone, birth_date)
  values (u.id, p_company, lower(trim(p_login)), v_name, nullif(trim(coalesce(u.raw_user_meta_data->>'phone', '')), ''),
          case when u.raw_user_meta_data->>'birth_date' ~ '^\d{4}-\d{2}-\d{2}$' then (u.raw_user_meta_data->>'birth_date')::date end);
  -- 그 회사 관리자에게만 알림
  for a in select user_id from app.memberships where company_id = p_company and role = 'admin' loop
    perform erp.notify(p_company, 'signup', '계정 신청', v_name || ' (' || lower(trim(p_login)) || ') 님이 계정을 신청했습니다. 계정 화면에서 승인하세요.', u.id::text, a.user_id::text);
  end loop;
  return true;
end $$;

drop function if exists public.staff_signups(text);
create or replace function public.staff_signups(p_company text)
returns table (user_id uuid, login text, name text, phone text, birth_date date, status text, created_at timestamptz, decided_at timestamptz, decided_by text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_admin_company_ids())) then raise exception '관리자만 볼 수 있습니다.' using errcode = '42501'; end if;
  return query select s.user_id, s.login, s.name, s.phone, s.birth_date, s.status, s.created_at, s.decided_at, s.decided_by
               from app.staff_signups s where s.company_id = p_company order by s.status <> 'pending', s.created_at desc;
end $$;

-- 승인·거절. 승인: p_employee_id(있는 직원 카드) 또는 p_new_employee=true(이름·전화로 새 카드) → 회사 소속 + 카드 연결 + 이메일 확인 처리.
create or replace function public.decide_staff_signup(p_company text, p_user_id uuid, p_status text, p_role text default 'staff',
                                                      p_employee_id text default null, p_new_employee boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare s app.staff_signups; v_emp text := nullif(p_employee_id, '');
begin
  if not (p_company = any (app.my_admin_company_ids())) then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  select * into s from app.staff_signups where user_id = p_user_id and company_id = p_company for update;
  if not found then raise exception '신청을 찾을 수 없습니다.'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then raise exception '승인·거절만 합니다.'; end if;
  if p_status = 'approved' then
    if s.status = 'approved' then raise exception '이미 승인했습니다.'; end if;
    if p_new_employee then
      v_emp := public.save_employee(jsonb_build_object('company_id', p_company, 'name', s.name, 'phone', s.phone, 'birth_date', s.birth_date, 'status', 'working'));
    elsif v_emp is not null then
      -- 있는 카드에 비어 있는 전화·생년월일만 채운다
      update erp.employees set phone = coalesce(phone, s.phone), birth_date = coalesce(birth_date, s.birth_date) where id = v_emp and company_id = p_company;
    end if;
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = s.user_id;
    perform public.set_member(p_company, s.user_id, coalesce(nullif(p_role, ''), 'staff'), coalesce(v_emp, ''));
  elsif s.status = 'approved' then
    raise exception '승인한 계정은 계정 목록에서 빼세요.';
  end if;
  update app.staff_signups set status = p_status, decided_at = case when p_status = 'pending' then null else now() end,
         decided_by = case when p_status = 'pending' then null else erp.actor_name() end
  where user_id = s.user_id;
end $$;

-- 로그인했지만 아직 소속이 없는 사람: 내 신청 상태
create or replace function public.my_signup_status() returns text
language sql stable security definer set search_path = '' as $$
  select status from app.staff_signups where user_id = auth.uid()
$$;

revoke all on function public.signup_companies(), public.staff_login_available(text), public.staff_signup_register(text, text) from public;
grant execute on function public.signup_companies(), public.staff_login_available(text), public.staff_signup_register(text, text) to anon, authenticated;
revoke all on function public.staff_signups(text), public.decide_staff_signup(text, uuid, text, text, text, boolean), public.my_signup_status() from public, anon;
grant execute on function public.staff_signups(text), public.decide_staff_signup(text, uuid, text, text, text, boolean), public.my_signup_status() to authenticated;
