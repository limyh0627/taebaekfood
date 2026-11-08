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

-- 승인 전(대기) 내 휴가 고치기(2026-11-08). 종류·날짜·일수·사유. 승인된 것은 request_leave_change(변경 요청)로.
create or replace function public.update_my_leave(p_id text, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.leave_requests;
begin
  select * into r from erp.leave_requests where id = p_id for update;
  if not found then raise exception '휴가 신청을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(r.company_id);
  if r.employee_id is distinct from erp.my_employee(r.company_id) then raise exception '내 휴가만 고칠 수 있습니다.'; end if;
  if r.status <> 'pending' then raise exception '승인 전(대기) 신청만 고칠 수 있습니다. 승인된 휴가는 변경 요청을 하세요.'; end if;
  if (p->>'start_date') is null or (p->>'end_date')::date < (p->>'start_date')::date then raise exception '날짜를 확인하세요.'; end if;
  if coalesce((p->>'days')::numeric, 0) <= 0 then raise exception '쓰는 날 수를 넣으세요.'; end if;
  update erp.leave_requests set type = coalesce(nullif(p->>'type', ''), type), start_date = (p->>'start_date')::date, end_date = (p->>'end_date')::date,
         days_used = (p->>'days')::numeric, reason = nullif(trim(coalesce(p->>'reason', '')), '')
  where id = p_id;
end $$;
revoke all on function public.update_my_leave(text, jsonb) from public, anon;
grant execute on function public.update_my_leave(text, jsonb) to authenticated;
