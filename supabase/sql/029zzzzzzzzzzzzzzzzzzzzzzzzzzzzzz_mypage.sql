-- erp-core 저장소 supabase/mypage.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 마이페이지(2026-11-08): 내 급여 명세. 급여 표는 관리자만 읽으므로(RLS) 내 직원 카드 줄만 돌려주는 함수로 연다.
-- 표를 만들거나 자료를 바꾸지 않는다 — 몇 번을 다시 돌려도 된다(운영 DB에 함수만 다시 깔 때 써도 안전).
-- 급여 전표까지 낸 달(확정)만 보인다. 계산 중인 달은 관리자만.
create or replace function public.my_payslips(p_company text)
returns table (year_month text, pay_date date, base numeric, allowance numeric, overtime numeric,
               income_tax numeric, local_tax numeric, pension numeric, health numeric, employment numeric, other_deduct numeric, note text)
language plpgsql stable security definer set search_path = '' as $$
declare v_emp text;
begin
  perform erp.assert_member(p_company);
  v_emp := erp.my_employee(p_company);
  if v_emp is null then return; end if;
  return query
  select p.year_month, p.pay_date, l.base, l.allowance, l.overtime, l.income_tax, l.local_tax, l.pension, l.health, l.employment, l.other_deduct, l.note
  from erp.payroll_lines l join erp.payrolls p on p.id = l.payroll_id
  where p.company_id = p_company and l.employee_id = v_emp and p.voucher_id is not null
  order by p.year_month desc;
end $$;
revoke all on function public.my_payslips(text) from public, anon;
grant execute on function public.my_payslips(text) to authenticated;
