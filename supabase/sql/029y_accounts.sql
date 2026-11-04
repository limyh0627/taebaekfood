-- erp-core 저장소 supabase/accounts.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 직원 계정과 회사 소속. access.sql 뒤에 돈다.
--
-- 계정 만들기: 관리자 화면이 Supabase Auth에 직접 가입시킨다(따로 띄운 클라이언트로 signUp — 관리자 로그인은 그대로).
--   이메일이 없는 직원은 아이디로 만든다: 아이디 → '아이디@erp.local' (로그인 화면도 같은 규칙으로 바꾼다).
--   그래서 Supabase Auth 설정에서 'Confirm email'을 꺼야 한다(가짜 주소라 확인 메일을 못 받는다).
--   가입만으로는 아무것도 못 본다 — 관리자가 아래 함수로 회사에 붙여야 데이터가 보인다.

-- 내 회사의 계정 목록(관리자만)
create or replace function public.company_members(p_company text)
returns table (user_id uuid, login text, role text, employee_id text, employee_name text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_admin_company_ids())) then raise exception '관리자만 볼 수 있습니다.' using errcode = '42501'; end if;
  return query
  select m.user_id, replace(u.email, '@erp.local', ''), m.role, e.id, e.name, m.created_at, u.last_sign_in_at
  from app.memberships m join auth.users u on u.id = m.user_id
  left join erp.employees e on e.auth_uid = m.user_id::text and e.company_id = m.company_id
  where m.company_id = p_company
  order by m.role, u.email;
end $$;

-- 계정을 회사에 붙이거나 권한을 바꾼다. 직원 카드와도 잇는다(선택).
-- 계정 ↔ 직원 카드 연결은 erp.employees.auth_uid에 두지만, 시험 이전은 erp 스키마를 다시 만든다.
-- 연결을 app 스키마에도 남겨 두고, 이 파일이 돌 때마다 다시 붙인다(계정·소속처럼 이전에 안 지워지게).
create table if not exists app.member_employees (
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  text not null,
  employee_id text not null,
  primary key (user_id, company_id)
);
alter table app.member_employees enable row level security;
revoke all on app.member_employees from anon, authenticated;

-- 옛 앱의 Firebase uid는 여기 계정과 상관없다 → 지우고, 남겨 둔 연결로 다시 붙인다.
update erp.employees e set auth_uid = null
where e.auth_uid is not null and not exists (select 1 from auth.users u where u.id::text = e.auth_uid);
update erp.employees e set auth_uid = m.user_id::text
from app.member_employees m where m.employee_id = e.id and m.company_id = e.company_id;

create or replace function public.set_member(p_company text, p_user_id uuid, p_role text, p_employee_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_admin_company_ids())) then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  if p_role not in ('admin', 'staff') then raise exception '권한은 관리자 또는 직원입니다.'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception '계정을 찾을 수 없습니다.'; end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then raise exception '내 관리자 권한은 내가 뺄 수 없습니다.'; end if;
  insert into app.memberships (user_id, company_id, role) values (p_user_id, p_company, p_role)
  on conflict (user_id, company_id) do update set role = excluded.role;
  -- 직원 카드: null이면 그대로, ''이면 연결 끊기, 값이면 그 카드로.
  if p_employee_id is not null then
    update erp.employees set auth_uid = null where company_id = p_company and auth_uid = p_user_id::text and id <> p_employee_id;
    delete from app.member_employees where user_id = p_user_id and company_id = p_company;
    if p_employee_id <> '' then
      update erp.employees set auth_uid = p_user_id::text where id = p_employee_id and company_id = p_company;
      insert into app.member_employees (user_id, company_id, employee_id) values (p_user_id, p_company, p_employee_id);
    end if;
  end if;
end $$;

-- 회사에서 뺀다(계정 자체는 남는다 — 다시 붙이면 그대로 쓴다).
create or replace function public.remove_member(p_company text, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_admin_company_ids())) then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception '나를 뺄 수는 없습니다.'; end if;
  delete from app.memberships where user_id = p_user_id and company_id = p_company;
  delete from app.member_employees where user_id = p_user_id and company_id = p_company;
  update erp.employees set auth_uid = null where company_id = p_company and auth_uid = p_user_id::text;
end $$;

-- 아이디로 이미 있는 계정 찾기(관리자가 다른 회사 계정을 이 회사에도 붙일 때)
create or replace function public.find_account(p_login text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where (select count(*) from app.memberships m where m.user_id = auth.uid() and m.role = 'admin') > 0
    and lower(u.email) = lower(case when p_login like '%@%' then p_login else p_login || '@erp.local' end)
$$;

-- 비밀번호 새로 정하기: 관리자가 자기 회사 직원 아이디(@erp.local)의 비밀번호를 바꿔 준다(이메일이 없어 메일로 재설정할 수 없으니까).
-- 진짜 이메일 계정은 본인이 바꾸게 둔다. pgcrypto는 Supabase에서 extensions 스키마에 있다.
create or replace function public.reset_member_password(p_company text, p_user_id uuid, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_admin_company_ids())) then raise exception '관리자만 할 수 있습니다.' using errcode = '42501'; end if;
  if not exists (select 1 from app.memberships where user_id = p_user_id and company_id = p_company) then raise exception '이 회사 계정이 아닙니다.'; end if;
  if not exists (select 1 from auth.users where id = p_user_id and email like '%@erp.local') then
    raise exception '이메일로 가입한 계정은 본인이 로그인해서 바꿔야 합니다.';
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception '비밀번호는 6자 이상입니다.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user_id;
end $$;
revoke all on function public.reset_member_password(text, uuid, text) from public, anon;
grant execute on function public.reset_member_password(text, uuid, text) to authenticated;

revoke all on function public.company_members(text), public.set_member(text, uuid, text, text),
  public.remove_member(text, uuid), public.find_account(text) from public, anon;
grant execute on function public.company_members(text), public.set_member(text, uuid, text, text),
  public.remove_member(text, uuid), public.find_account(text) to authenticated;
