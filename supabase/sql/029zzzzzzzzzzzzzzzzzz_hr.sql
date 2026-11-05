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

-- ---------- 휴가 변경·취소 요청(기존 앱 modifyRequest·cancel_pending) ----------
-- 승인된 휴가를 직원이 바꾸거나 물러 달라고 하면 change_request에 담는다. 기존 앱과 같게 취소 요청은 상태가 '취소 대기'(cancel_pending)가 되어
-- 연차 셈에서 빠지고, 반려하면 승인으로 돌아온다. 변경 요청은 승인 그대로 두고 modifyRequest만 기다린다.
-- change_request: {kind: modify|cancel, start_date, end_date, days, reason, requested_at}
alter table erp.leave_requests add column if not exists change_request jsonb;
alter table erp.leave_requests add column if not exists change_note text;   -- 마지막 결정 기록(승인·반려)
update erp.leave_requests set status = 'canceled' where status = 'cancelled';
update erp.leave_requests set change_request = jsonb_build_object('kind', 'cancel', 'requested_at', now())
where status = 'cancel_pending' and change_request is null;
do $$ begin
  if to_regclass('raw.docs') is null then return; end if;
  update erp.leave_requests l set change_request = jsonb_build_object('kind', 'modify', 'start_date', d.data->'modifyRequest'->>'startDate', 'end_date', d.data->'modifyRequest'->>'endDate',
         'days', (d.data->'modifyRequest'->>'daysUsed')::numeric, 'reason', d.data->'modifyRequest'->>'reason', 'requested_at', now())
  from raw.docs d where d.collection = 'leaveRequests' and d.id = l.id and d.data->'modifyRequest'->>'status' = 'pending' and l.status = 'approved' and l.change_request is null;
end $$;

-- p: {kind: modify|cancel, start_date?, end_date?, days?, reason?}. 본인 것만, 승인된 것만.
create or replace function public.request_leave_change(p_id text, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.leave_requests; v_kind text := p->>'kind';
begin
  select * into r from erp.leave_requests where id = p_id for update;
  if not found then raise exception '휴가 신청을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(r.company_id);
  if not exists (select 1 from erp.employees e where e.id = r.employee_id and e.id = erp.my_employee(r.company_id)) then raise exception '내 휴가만 바꿔 달라고 할 수 있습니다.'; end if;
  if r.status <> 'approved' then raise exception '승인된 휴가만 변경·취소를 요청합니다. 대기 중이면 그냥 취소하고 다시 신청하세요.'; end if;
  if r.change_request is not null then raise exception '이미 결정을 기다리는 요청이 있습니다.'; end if;
  if v_kind = 'cancel' then
    update erp.leave_requests set status = 'cancel_pending', change_request = jsonb_build_object('kind', 'cancel', 'reason', nullif(p->>'reason', ''), 'requested_at', now()) where id = p_id;
  elsif v_kind = 'modify' then
    if (p->>'start_date') is null or (p->>'end_date')::date < (p->>'start_date')::date then raise exception '날짜를 확인하세요.'; end if;
    if coalesce((p->>'days')::numeric, 0) <= 0 then raise exception '쓰는 날 수를 넣으세요.'; end if;
    update erp.leave_requests set change_request = jsonb_build_object('kind', 'modify', 'start_date', p->>'start_date', 'end_date', p->>'end_date',
           'days', (p->>'days')::numeric, 'reason', nullif(p->>'reason', ''), 'requested_at', now()) where id = p_id;
  else raise exception '변경인지 취소인지 고르세요.';
  end if;
end $$;

create or replace function public.decide_leave_change(p_id text, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.leave_requests; c jsonb;
begin
  select * into r from erp.leave_requests where id = p_id for update;
  if not found then raise exception '휴가 신청을 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(r.company_id);
  c := r.change_request;
  if c is null then raise exception '기다리는 변경·취소 요청이 없습니다.'; end if;
  if p_approve and c->>'kind' = 'cancel' then
    update erp.leave_requests set status = 'canceled', change_request = null, change_note = '취소 요청 승인 ' || current_date where id = p_id;
  elsif p_approve then
    update erp.leave_requests set start_date = (c->>'start_date')::date, end_date = (c->>'end_date')::date, days_used = (c->>'days')::numeric,
           reason = coalesce(c->>'reason', reason), change_request = null,
           change_note = '변경 승인 ' || current_date || ' (전: ' || r.start_date || '~' || r.end_date || ', ' || r.days_used || '일)' where id = p_id;
  else
    update erp.leave_requests set status = 'approved', change_request = null, change_note = case c->>'kind' when 'cancel' then '취소' else '변경' end || ' 요청 반려 ' || current_date where id = p_id;
  end if;
end $$;
revoke all on function public.request_leave_change(text, jsonb), public.decide_leave_change(text, boolean) from public, anon;
grant execute on function public.request_leave_change(text, jsonb), public.decide_leave_change(text, boolean) to authenticated;

revoke all on function public.set_leave_extra(text, numeric, numeric), public.company_vacation(jsonb) from public, anon;
grant execute on function public.set_leave_extra(text, numeric, numeric), public.company_vacation(jsonb) to authenticated;
