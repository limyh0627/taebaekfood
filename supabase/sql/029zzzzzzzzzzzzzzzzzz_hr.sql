-- erp-core 저장소 supabase/hr.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 인사: 연차 보너스·이월, 회사 단체 휴가(기존 앱 HRManager와 같게, 2026-11-05). delivery.sql 뒤에 돈다.
alter table erp.leave_requests add column if not exists deducts_leave boolean;   -- 비면 유형으로(경조사·기타는 미차감)

-- 보너스·이월 일수(관리자). employees.annual_leave {carryOverLeave, bonusLeave}
create or replace function public.set_leave_extra(p_employee text, p_bonus numeric, p_carry numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.employees where id = p_employee;
  if v_company is null then raise exception '직원을 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(v_company);
  update erp.employees set annual_leave = coalesce(annual_leave, '{}') || jsonb_build_object('bonusLeave', coalesce(p_bonus, 0), 'carryOverLeave', coalesce(p_carry, 0))
  where id = p_employee;
end $$;

-- 회사 단체 휴가: 고른 직원마다 승인된 '휴가' 신청. deducts=false면 연차에서 안 뺀다. p: {company_id, employee_ids[], start_date, end_date, days, deducts, reason}
create or replace function public.company_vacation(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; n int;
begin
  perform erp.assert_admin(v_company);
  if (p->>'start_date') is null or (p->>'end_date')::date < (p->>'start_date')::date then raise exception '날짜를 확인하세요.'; end if;
  insert into erp.leave_requests (id, company_id, employee_id, employee_name, type, start_date, end_date, days_used, status, reason, requested_at, deducts_leave)
  select 'leave-' || gen_random_uuid(), v_company, e.id, e.name, '휴가', (p->>'start_date')::date, (p->>'end_date')::date, coalesce((p->>'days')::numeric, 0),
         'approved', coalesce(nullif(p->>'reason', ''), case when coalesce((p->>'deducts')::boolean, true) then '회사 단체 휴가' else '회사 단체 휴가 (연차 미차감)' end),
         current_date, coalesce((p->>'deducts')::boolean, true)
  from erp.employees e
  where e.company_id = v_company and e.id in (select jsonb_array_elements_text(coalesce(p->'employee_ids', '[]')));
  get diagnostics n = row_count;
  if n = 0 then raise exception '직원을 고르세요.'; end if;
  return n;
end $$;

revoke all on function public.set_leave_extra(text, numeric, numeric), public.company_vacation(jsonb) from public, anon;
grant execute on function public.set_leave_extra(text, numeric, numeric), public.company_vacation(jsonb) to authenticated;
