-- erp-core 저장소 supabase/checklist.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 확인사항(관리자 승인함) — 기존 앱 '관리자 확인사항'과 같게(2026-11-05). oemflow.sql 뒤에 돈다.
--  탭: 입고·발주(발주 예정, 입고됐는데 매입전표 안 낸 발주, 가공비 전표, 출고했는데 명세서 안 낸 주문)
--      재고(재고 조정 요청, 발주 필요 = 최소수량 미만) · 연차 신청 · 포털 가입
--  재고 조정 요청(adjustment_requests): quantity_change는 승인하면 요청 수량으로 실사 맞춤. 그 밖(발주 필요·멘션 등)은 확인 처리만.

create or replace function public.decide_adjustment(p_id text, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.adjustment_requests;
begin
  select * into r from erp.adjustment_requests where id = p_id for update;
  if not found then raise exception '요청을 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(r.company_id);
  if r.status <> 'pending' then raise exception '이미 처리한 요청입니다.'; end if;
  if p_approve and r.type = 'quantity_change' then
    if r.item_id is null or r.qty_after is null then raise exception '품목이나 요청 수량이 없어 맞출 수 없습니다. 반려하고 재고 화면에서 실사하세요.'; end if;
    perform public.stocktake(r.company_id, r.item_id, r.qty_after, null, coalesce('조정 요청 승인: ' || nullif(r.reason, ''), '조정 요청 승인'));
  end if;
  update erp.adjustment_requests set status = case when p_approve then 'processed' else 'rejected' end, processed_at = now() where id = r.id;
end $$;

-- 직원 재고 조정 요청(기존 앱 직원 앱과 같음): 센 수량과 까닭을 남기면 관리자 확인사항에 뜬다
create or replace function public.request_adjustment(p_company text, p_item text, p_counted numeric, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := 'ADJ-' || gen_random_uuid(); v_have numeric;
begin
  perform erp.assert_member(p_company);
  if not exists (select 1 from erp.items where id = p_item and company_id = p_company) then raise exception '품목을 찾을 수 없습니다.'; end if;
  if p_counted is null or p_counted < 0 then raise exception '센 수량을 넣으세요.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '왜 다른지 적어 주세요(파손·누락 등).'; end if;
  if exists (select 1 from erp.adjustment_requests where item_id = p_item and type = 'quantity_change' and status = 'pending') then
    raise exception '이 품목은 이미 승인을 기다리는 조정 요청이 있습니다.';
  end if;
  select coalesce(qty, 0) into v_have from erp.stock_balances where item_id = p_item;
  insert into erp.adjustment_requests (id, company_id, item_id, type, status, reason, qty_before, qty_after, requested_at)
  values (v_id, p_company, p_item, 'quantity_change', 'pending', left(trim(p_reason), 300) || ' (' || coalesce((select name from public.company_people(p_company) where user_id = auth.uid()), erp.actor_name(), '') || ')', coalesce(v_have, 0), p_counted, now());
  return v_id;
end $$;
revoke all on function public.request_adjustment(text, text, numeric, text) from public, anon;
grant execute on function public.request_adjustment(text, text, numeric, text) to authenticated;

-- 전표 수정 요청(기존 앱 pendingStatementEdits): 직원이 명세서의 틀린 곳을 적어 올리면 관리자가 확인사항에서 보고
-- 전표 화면에서 취소·다시 발행한 뒤 '확인' 처리한다(새 ERP는 발행된 전표를 고치지 않고 취소 후 다시 낸다).
alter table erp.adjustment_requests add column if not exists voucher_id text;
create or replace function public.request_voucher_edit(p_voucher text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare v erp.vouchers; v_id text := 'VEDIT-' || gen_random_uuid();
begin
  select * into v from erp.vouchers where id = p_voucher;
  if not found then raise exception '전표를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v.company_id);
  if v.status <> 'active' then raise exception '취소된 전표입니다.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '무엇을 어떻게 고쳐야 하는지 적어 주세요.'; end if;
  if exists (select 1 from erp.adjustment_requests where voucher_id = p_voucher and status = 'pending') then raise exception '이 전표는 이미 수정 요청이 올라가 있습니다.'; end if;
  insert into erp.adjustment_requests (id, company_id, type, status, reason, voucher_id, requested_at)
  values (v_id, v.company_id, 'voucher_edit', 'pending',
          coalesce(v.voucher_no, '') || ' ' || coalesce(v.partner_name, '') || ': ' || left(trim(p_reason), 300)
            || ' (' || coalesce((select name from public.company_people(v.company_id) where user_id = auth.uid()), erp.actor_name(), '') || ')', p_voucher, now());
  return v_id;
end $$;
revoke all on function public.request_voucher_edit(text, text) from public, anon;
grant execute on function public.request_voucher_edit(text, text) to authenticated;

-- 새 ERP에서 출고했는데 거래명세서를 안 낸 주문(옛 앱 주문은 뺀다)
create or replace view erp.unbilled_orders as
select o.id, o.company_id, o.card_no, o.delivery_date, o.partner_id, coalesce(p.name, o.partner_name) partner_name, o.total_amount
from erp.orders o left join erp.partners p on p.id = o.partner_id
where o.shipped_at is not null and o.voucher_id is null and not o.accounting_excluded
  and exists (select 1 from erp.stock_ledger l where l.source_type = 'order' and l.source_id = o.id);
alter view erp.unbilled_orders set (security_invoker = true);
grant select on erp.unbilled_orders to authenticated;

-- 메뉴 뱃지·탭 숫자
create or replace function public.checklist_counts(p_company text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return jsonb_build_object(
    'po_pending', (select count(*) from erp.purchase_orders where company_id = p_company and status = 'pending'),
    'po_no_voucher', (select count(*) from erp.purchase_orders po where company_id = p_company and po_type <> 'oem' and status in ('partial', 'received')
                      and not exists (select 1 from erp.vouchers v where v.id = po.voucher_id and v.status = 'active')
                      and exists (select 1 from erp.purchase_receipts r where r.po_id = po.id and r.batch_id is not null and r.canceled_at is null)),
    'oem_fee', (select count(*) from erp.oem_fee_pending where company_id = p_company),
    'order_no_voucher', (select count(*) from erp.unbilled_orders where company_id = p_company),
    'adjust', (select count(*) from erp.adjustment_requests where company_id = p_company and status = 'pending'),
    'unclassified', (select count(*) from erp.unclassified_cash where company_id = p_company),
    'low_stock', (select count(*) from erp.items i left join erp.stock_balances b on b.item_id = i.id
                  where i.company_id = p_company and not i.archived and i.type <> 'FINISHED' and coalesce(i.min_stock, 0) > 0 and coalesce(b.qty, 0) < i.min_stock),
    'leave', (select count(*) from erp.leave_requests where company_id = p_company and (status = 'pending' or (status = 'approved' and change_request is not null))),
    'signup', case when p_company = any (app.my_admin_company_ids()) then (select count(*) from app.partner_users u where u.status = 'pending' and (u.company_id = p_company or u.company_id is null)) else 0 end);
end $$;

revoke all on function public.decide_adjustment(text, boolean), public.checklist_counts(text) from public, anon;
grant execute on function public.decide_adjustment(text, boolean), public.checklist_counts(text) to authenticated;
