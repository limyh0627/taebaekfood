-- erp-core 저장소 supabase/access.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 앱 접근 권한: 로그인한 사용자는 자기가 속한 회사의 줄만 읽는다.
-- erp 스키마를 새로 만든 뒤(시험 이전 직후) 매번 다시 돌린다. app 스키마(소속)는 이전에 지워지지 않는다.
-- 쓰기는 아직 열지 않는다. 쓰기는 검증을 한곳에 모으려고 함수(RPC)로만 열 예정.

create schema if not exists app;

create table if not exists app.memberships (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id text not null,
  role       text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
alter table app.memberships enable row level security;
revoke all on app.memberships from anon, authenticated;

-- 정책에서 쓰는 함수. security definer라 사용자가 memberships 표를 직접 못 읽어도 된다.
create or replace function app.my_company_ids() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(company_id), '{}') from app.memberships where user_id = auth.uid()
$$;
create or replace function app.my_admin_company_ids() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(company_id), '{}') from app.memberships where user_id = auth.uid() and role = 'admin'
$$;
revoke all on function app.my_company_ids(), app.my_admin_company_ids() from public;
grant usage on schema app to authenticated;
grant execute on function app.my_company_ids(), app.my_admin_company_ids() to authenticated;

-- 화면이 부르는 함수: 내가 속한 회사 목록.
create or replace function public.my_companies()
returns table (company_id text, company_name text, role text)
language sql stable security definer set search_path = '' as $$
  select m.company_id, coalesce(c.name, m.company_id), m.role
  from app.memberships m left join erp.companies c on c.id = m.company_id
  where m.user_id = auth.uid()
  order by 2
$$;
revoke all on function public.my_companies() from public, anon;
grant execute on function public.my_companies() to authenticated;

-- ---------- erp: 읽기 권한과 정책 ----------
grant usage on schema erp to authenticated;
grant select on all tables in schema erp to authenticated;
revoke select on erp.import_rejects from authenticated;

do $$
declare t text;
begin
  -- company_id가 있는 표: 소속 회사만. 급여는 관리자만.
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'erp' and c.column_name = 'company_id'
      and c.table_name not in ('payrolls', 'import_rejects')
  loop
    execute format('drop policy if exists member_read on erp.%I', t);
    execute format('create policy member_read on erp.%I for select to authenticated using (company_id = any (app.my_company_ids()))', t);
  end loop;
end $$;

drop policy if exists admin_read on erp.payrolls;
create policy admin_read on erp.payrolls for select to authenticated
  using (company_id = any (app.my_admin_company_ids()));

-- company_id 없는 줄 표: 부모 문서를 따라간다.
drop policy if exists member_read on erp.order_lines;
create policy member_read on erp.order_lines for select to authenticated
  using (exists (select 1 from erp.orders o where o.id = order_id and o.company_id = any (app.my_company_ids())));
drop policy if exists member_read on erp.voucher_lines;
create policy member_read on erp.voucher_lines for select to authenticated
  using (exists (select 1 from erp.vouchers v where v.id = voucher_id and v.company_id = any (app.my_company_ids())));
drop policy if exists member_read on erp.purchase_order_lines;
create policy member_read on erp.purchase_order_lines for select to authenticated
  using (exists (select 1 from erp.purchase_orders p where p.id = po_id and p.company_id = any (app.my_company_ids())));
drop policy if exists member_read on erp.balance_snapshot_lines;
create policy member_read on erp.balance_snapshot_lines for select to authenticated
  using (exists (select 1 from erp.balance_snapshots b where b.id = snapshot_id and b.company_id = any (app.my_company_ids())));
drop policy if exists admin_read on erp.payroll_lines;
create policy admin_read on erp.payroll_lines for select to authenticated
  using (exists (select 1 from erp.payrolls p where p.id = payroll_id and p.company_id = any (app.my_admin_company_ids())));
