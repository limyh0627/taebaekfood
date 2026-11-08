-- erp-core 저장소 supabase/orderflow.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 주문 흐름을 기존 앱과 같게 (2026-11-05 결정: 기능·흐름은 기존 앱 그대로). comms.sql 뒤에 돈다.
--
--  기존 앱 흐름
--   1) 줄 체크 = 생산 처리. 만드는 품목은 그 자리에서 BOM대로 원료·부자재를 쓰고 완제품을 늘린다(일부는 있는 재고로 충당 가능).
--      사 오는 품목(상품·원료·완사입·임가공)은 이 주문 몫으로 잡아 둘 뿐 재고는 출고 때 빠진다.
--      체크를 풀면 그 줄의 생산을 되돌린다.
--   2) 상태는 사람이 고르지 않는다: 체크한 줄 0 = 대기중(PENDING), 일부 = 작업중(PROCESSING), 전부 = 작업완료(DISPATCHED). 보류(ON_HOLD)만 손으로.
--   3) 출고(SHIPPED)는 따로: 출고 방식(배송·화물·수령·택배)을 고르고, 완제품·상품 재고를 뺀다. 음수가 되면 막는다. 명세서는 안 만든다.
--   4) 거래명세서는 전표 → 매출전표에서 주문을 골라 따로 발행한다(여러 주문 한 장 가능). '발행 안 함' 표시도 있다.
--   5) 출고 취소 = 작업완료로 되돌림(명세서가 걸려 있으면 명세서를 먼저 취소).

alter table erp.order_lines add column if not exists made_on date;
alter table erp.order_lines add column if not exists label_stage text;
alter table erp.order_lines add column if not exists run_id text;
alter table erp.order_lines add column if not exists picked_at timestamptz;   -- 출고 준비 체크리스트(물건 챙김). 생산·재고와 무관
alter table erp.orders add column if not exists note_important boolean not null default false;
alter table erp.orders add column if not exists invoice_stage text;
alter table erp.orders add column if not exists accounting_excluded boolean not null default false;
alter table erp.orders add column if not exists accounting_excluded_reason text;
alter table erp.production_runs add column if not exists line_no int;

-- 계정 고르는 함수(purchasing.sql과 같은 내용 — 운영에 다시 적용할 때 여기서 바뀐다)
create or replace function erp.purchase_account(p_partner text, p_item text) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select account_code from erp.partner_items where partner_id = p_partner and item_id = p_item
       and coalesce(direction, 'in') = 'in' and account_code is not null limit 1),
    (select account_code from erp.items where id = p_item),
    (select case when type in ('SUB', 'PALLET') then '505' when type = 'GOODS' then '501' else '500' end from erp.items where id = p_item),
    '500')
$$;
-- 매출 계정: 거래처-품목 연결에 적힌 계정 > 상품(GOODS) 401 상품매출 > 그 밖 404 제품매출 (2026-11-09)
create or replace function erp.sales_account(p_partner text, p_item text) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select account_code from erp.partner_items where partner_id = p_partner and item_id = p_item
       and coalesce(direction, 'out') = 'out' and account_code is not null limit 1),
    (select case when type = 'GOODS' then '401' end from erp.items where id = p_item),
    '404')
$$;
revoke all on function erp.sales_account(text, text) from public, anon, authenticated;

-- 생산하는 품목인가(만드는 것) — 아니면 사 오는 것
create or replace function erp.is_produced(i erp.items) returns boolean language sql immutable as $$
  select i.type in ('FINISHED', 'WIP') and not i.is_bulk and not i.phantom and coalesce(i.procure_type, '') not in ('완사입', '임가공')
$$;

-- 이 주문 몫으로 잡힌 수량(체크했고 아직 안 나간 줄). 재고 화면의 '작업완료 예약분'.
create or replace view erp.item_reserved as
select l.item_id, o.company_id, sum(l.qty) as qty
from erp.order_lines l join erp.orders o on o.id = l.order_id
where l.checked_at is not null and l.item_id is not null and o.shipped_at is null
  and coalesce(o.status, '') not in ('SHIPPED', 'DELIVERED', 'CANCELED')
group by 1, 2;
alter view erp.item_reserved set (security_invoker = true);
grant select on erp.item_reserved to authenticated;

-- 상태 맞추기(보류·출고된 주문은 그대로)
create or replace function erp.sync_order_status(p_order text) returns text language plpgsql set search_path = '' as $$
declare o erp.orders; n int; c int; v text;
begin
  select * into o from erp.orders where id = p_order;
  if o.shipped_at is not null or o.status in ('SHIPPED', 'DELIVERED', 'ON_HOLD', 'CANCELED') then return o.status; end if;
  select count(*), count(checked_at) into n, c from erp.order_lines where order_id = p_order and item_id is not null;
  v := case when c = 0 then 'PENDING' when c < n then 'PROCESSING' else 'DISPATCHED' end;
  update erp.orders set status = v where id = p_order and status is distinct from v;
  return v;
end $$;

-- 생산 처리 미리보기: 이 줄을 체크하면 무엇이 움직이나
create or replace function public.preview_order_line(p_order_id text, p_line_no int, p_produce numeric default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o erp.orders; l erp.order_lines; i erp.items; v_have numeric; v_res numeric; v_qty numeric;
begin
  select * into o from erp.orders where id = p_order_id;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  select * into l from erp.order_lines where order_id = o.id and line_no = p_line_no;
  select * into i from erp.items where id = l.item_id;
  if i.id is null then raise exception '품목이 연결되지 않은 줄입니다.'; end if;
  select coalesce(qty, 0) into v_have from erp.stock_balances where item_id = i.id;
  select coalesce(sum(x.qty), 0) into v_res from erp.order_lines x join erp.orders y on y.id = x.order_id
  where x.item_id = i.id and x.checked_at is not null and y.shipped_at is null and coalesce(y.status, '') not in ('SHIPPED', 'DELIVERED') and x.order_id <> o.id;
  v_qty := coalesce(p_produce, l.qty);
  if not erp.is_produced(i) or v_qty <= 0 then
    return jsonb_build_object('produced', erp.is_produced(i), 'qty', l.qty, 'unit', i.unit, 'have', coalesce(v_have, 0), 'reserved_other', v_res, 'plan', '[]'::jsonb);
  end if;
  perform erp.plan_reset();
  perform erp.plan_build(o.company_id, i.id, v_qty, 0);
  return jsonb_build_object('produced', true, 'qty', l.qty, 'unit', i.unit, 'have', coalesce(v_have, 0), 'reserved_other', v_res, 'plan', erp.plan_result());
end $$;

-- 줄 체크(생산 처리) / 체크 풀기(되돌림). p_produce: 새로 만들 수량(나머지는 있는 재고로). 비우면 주문 수량 전부 생산.
drop function if exists public.check_order_line(text, int, boolean);
create or replace function public.check_order_line(p_order_id text, p_line_no int, p_checked boolean,
  p_produce numeric default null, p_made_on date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o erp.orders; l erp.order_lines; i erp.items; v_run text; v_qty numeric; v_date date := coalesce(p_made_on, (now() at time zone 'Asia/Seoul')::date);
        r record; v_status text;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if o.status = 'CANCELED' then raise exception '삭제한 주문입니다.'; end if;
  if o.shipped_at is not null or o.status in ('SHIPPED', 'DELIVERED') then raise exception '출고된 주문입니다. 출고를 먼저 취소하세요.'; end if;
  select * into l from erp.order_lines where order_id = o.id and line_no = p_line_no for update;
  if not found then raise exception '주문 줄을 찾을 수 없습니다.'; end if;
  select * into i from erp.items where id = l.item_id;

  if p_checked then
    if l.checked_at is not null then raise exception '이미 생산 처리한 줄입니다.'; end if;
    if i.id is not null and erp.is_produced(i) then
      v_qty := coalesce(p_produce, l.qty);
      if v_qty < 0 or v_qty > l.qty then raise exception '새로 만들 수량은 0~주문 수량입니다.'; end if;
      if v_qty > 0 then
        v_run := 'prod-' || gen_random_uuid();
        perform erp.plan_reset();
        perform erp.plan_build(o.company_id, i.id, v_qty, 0);
        insert into erp.production_runs (id, company_id, order_id, item_id, qty, run_date, note, line_no)
        values (v_run, o.company_id, o.id, i.id, v_qty, v_date, '주문 생산 처리', l.line_no);
        perform erp.plan_post(o.company_id, v_run, v_date, coalesce(o.card_no, o.id));
      end if;
    end if;
    update erp.order_lines set checked_at = now(), checked_by = erp.actor_name(), made_on = coalesce(p_made_on, made_on, v_date), run_id = v_run   -- 제조일이 비면 그날로(소비기한 자동)
    where order_id = o.id and line_no = l.line_no;
  else
    if l.checked_at is null then return jsonb_build_object('status', o.status); end if;
    if l.run_id is not null and exists (select 1 from erp.order_lines x where x.run_id = l.run_id and x.checked_at is not null
                                          and not (x.order_id = o.id and x.line_no = l.line_no)) then
      null;  -- 나눈 주문과 같이 쓰는 생산: 다른 쪽이 아직 체크돼 있으면 생산은 그대로 두고 이 줄 체크만 푼다(마지막 줄을 풀 때 되돌린다)
    elsif l.run_id is not null then
      perform public.cancel_production(l.run_id, '체크 풀기 ' || coalesce(o.card_no, o.id));
    elsif i.id is not null and erp.is_produced(i) and not exists (select 1 from erp.production_runs where order_id = o.id and line_no = l.line_no) then
      raise exception '옛 앱에서 생산 처리한 줄이라 여기서 되돌릴 수 없습니다(재고는 재고 화면에서 실사로 맞추세요).';
    end if;
    update erp.order_lines set checked_at = null, checked_by = null, run_id = null where order_id = o.id and line_no = l.line_no;
  end if;

  v_status := erp.sync_order_status(o.id);
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('check:' || gen_random_uuid(), o.company_id, o.id, case when p_checked then 'check' else 'uncheck' end,
          jsonb_build_object('line', l.line_no, 'item', l.name, 'produced', v_qty, 'run', v_run, 'from', o.status, 'to', v_status), erp.actor_name(), now());
  return jsonb_build_object('status', v_status, 'from', o.status, 'run_id', v_run, 'produced', coalesce(v_qty, 0));
end $$;

-- 체크 풀기 전에 화면에 보여 줄 것: 재고가 어떻게 되는지.
--  mode: cancel(생산 취소: 만든 완제품이 빠지고 쓴 재료가 돌아옴) / keep(나눈 주문과 같이 쓰는 생산이라 그대로) /
--        plain(생산 없이 있는 재고로 잡은 줄: 잡아 둔 것만 풂) / legacy(옛 앱 생산이라 못 되돌림)
create or replace function public.uncheck_preview(p_order_id text, p_line_no int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o erp.orders; l erp.order_lines; i erp.items; r erp.production_runs; v_other text; v_moves jsonb;
begin
  select * into o from erp.orders where id = p_order_id;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  select * into l from erp.order_lines where order_id = o.id and line_no = p_line_no;
  if not found or l.checked_at is null then return jsonb_build_object('mode', 'none'); end if;
  select * into i from erp.items where id = l.item_id;
  if l.run_id is not null then
    select coalesce(oo.card_no, oo.id) into v_other from erp.order_lines x join erp.orders oo on oo.id = x.order_id
    where x.run_id = l.run_id and x.checked_at is not null and not (x.order_id = o.id and x.line_no = l.line_no) limit 1;
    select * into r from erp.production_runs where id = l.run_id;
    if v_other is not null then
      return jsonb_build_object('mode', 'keep', 'item', l.name, 'qty', l.qty, 'unit', i.unit, 'other', v_other);
    end if;
    -- 되돌릴 재고 움직임: 생산 원장 줄의 반대. 같은 품목은 합친다.
    select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'qty', m.qty, 'unit', m.unit) order by m.qty desc, m.name), '[]') into v_moves
    from (select it.name, -round(sum(sl.qty), 3) qty, max(it.unit) unit
          from erp.stock_ledger sl join erp.items it on it.id = sl.item_id
          where sl.source_type = 'production' and sl.source_id = l.run_id and sl.reversal_of is null
          group by it.id, it.name having round(sum(sl.qty), 3) <> 0) m;
    return jsonb_build_object('mode', 'cancel', 'item', l.name, 'qty', l.qty, 'unit', i.unit, 'produced', r.qty,
                              'from_stock', greatest(l.qty - coalesce(r.qty, 0), 0), 'moves', v_moves);
  end if;
  if i.id is not null and erp.is_produced(i) and not exists (select 1 from erp.production_runs where order_id = o.id and line_no = l.line_no) then
    return jsonb_build_object('mode', 'legacy', 'item', l.name, 'qty', l.qty, 'unit', i.unit);
  end if;
  return jsonb_build_object('mode', 'plain', 'item', l.name, 'qty', l.qty, 'unit', i.unit);
end $$;
revoke all on function public.uncheck_preview(text, int) from public, anon;
grant execute on function public.uncheck_preview(text, int) to authenticated;

-- 제조일·라벨 단계 (줄)
create or replace function public.set_order_line_meta(p_order_id text, p_line_no int, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.orders where id = p_order_id;
  if v_company is null then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  if p ? 'label_stage' and coalesce(p->>'label_stage', '') not in ('', '대기', '날인', '부착') then raise exception '라벨은 대기·날인·부착입니다.'; end if;
  update erp.order_lines set
    made_on = case when p ? 'made_on' then (p->>'made_on')::date else made_on end,
    label_stage = case when p ? 'label_stage' then nullif(p->>'label_stage', '') else label_stage end,
    picked_at = case when p ? 'picked' then (case when (p->>'picked')::boolean then now() end) else picked_at end
  where order_id = p_order_id and line_no = p_line_no;
end $$;

-- 옛 '부족분만 생산'은 줄 체크로 바뀌었다
drop function if exists public.produce_for_order(text, boolean, date);

-- 상태는 손으로 고르지 않는다: 보류만 걸고 풀 수 있다(풀면 체크 수로 다시 맞춤)
create or replace function public.set_order_status(p_order_id text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('ON_HOLD', 'PENDING') then raise exception '상태는 체크한 줄 수로 자동입니다. 여기서는 보류만 걸고 풀 수 있습니다.'; end if;
  perform public.set_order_meta(p_order_id, jsonb_build_object('hold', p_status = 'ON_HOLD'));
end $$;

-- 주문 표시들: 출고 방식·송장 단계·중요 비고·명세서 발행 안 함·보류
create or replace function public.set_order_meta(p_order_id text, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare o erp.orders;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if p ? 'ship_method' and coalesce(p->>'ship_method', '') not in ('', '배송', '화물', '수령', '택배') then raise exception '출고 방식은 배송·화물·수령·택배입니다.'; end if;
  if p ? 'invoice_stage' and coalesce(p->>'invoice_stage', '') not in ('', 'printed', 'attached') then raise exception '송장 단계를 확인하세요.'; end if;
  if p ? 'delivery_slot' and coalesce(p->>'delivery_slot', '') not in ('', '오전', '오후') then raise exception '오전·오후만 됩니다.'; end if;
  if (p->>'accounting_excluded')::boolean and coalesce(trim(p->>'accounting_excluded_reason'), '') = '' then raise exception '발행 안 하는 이유를 적으세요.'; end if;
  if (p->>'accounting_excluded')::boolean and exists (select 1 from erp.vouchers where id = o.voucher_id and status = 'active') then
    raise exception '이미 명세서가 발행된 주문입니다.';
  end if;
  update erp.orders set
    ship_method = case when p ? 'ship_method' then nullif(p->>'ship_method', '') else ship_method end,
    invoice_stage = case when p ? 'invoice_stage' then nullif(p->>'invoice_stage', '') else invoice_stage end,
    note = case when p ? 'note' then nullif(p->>'note', '') else note end,
    note_important = case when p ? 'note_important' then coalesce((p->>'note_important')::boolean, false) else note_important end,
    accounting_excluded = case when p ? 'accounting_excluded' then coalesce((p->>'accounting_excluded')::boolean, false) else accounting_excluded end,
    accounting_excluded_reason = case when p ? 'accounting_excluded' then nullif(p->>'accounting_excluded_reason', '') else accounting_excluded_reason end,
    delivery_date = case when p ? 'delivery_date' then (p->>'delivery_date')::date else delivery_date end,
    delivery_slot = case when p ? 'delivery_slot' then nullif(p->>'delivery_slot', '') else delivery_slot end
  where id = o.id;
  if p ? 'hold' then
    if o.shipped_at is not null then raise exception '출고된 주문은 보류할 수 없습니다.'; end if;
    update erp.orders set status = case when (p->>'hold')::boolean then 'ON_HOLD' else 'PENDING' end where id = o.id;
    if not (p->>'hold')::boolean then perform erp.sync_order_status(o.id); end if;
  end if;
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('meta:' || gen_random_uuid(), o.company_id, o.id, 'meta', p, erp.actor_name(), now());
end $$;

-- 출고: 모든 줄이 생산 처리돼 있어야 한다(작업완료). 재고가 음수가 되면 막는다. 명세서는 만들지 않는다.
drop function if exists public.ship_order(text, boolean, date);
create or replace function public.ship_order(p_order_id text, p_ship_method text default null, p_date date default null, p_preview boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o erp.orders; v_date date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date); v_lines jsonb; r record;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if o.status = 'CANCELED' then raise exception '삭제한 주문입니다.'; end if;
  if o.shipped_at is not null or o.status in ('SHIPPED', 'DELIVERED') then raise exception '이미 출고된 주문입니다.'; end if;
  if o.status = 'ON_HOLD' then raise exception '보류 중인 주문입니다. 보류를 먼저 푸세요.'; end if;
  if to_jsonb(o)->>'purpose' = 'stock' then raise exception '재고 만들기 주문은 출고하지 않습니다(생산으로 끝).'; end if;
  if exists (select 1 from erp.order_lines where order_id = o.id and item_id is not null and checked_at is null) then
    raise exception '생산 처리 안 한 줄이 있습니다. 모든 줄을 체크(작업완료)한 뒤 출고하세요.';
  end if;
  perform 1 from erp.stock_balances where item_id in (select item_id from erp.order_lines where order_id = o.id) for update;
  select jsonb_agg(jsonb_build_object('item_id', n.item_id, 'name', i.name, 'unit', i.unit, 'out', n.q, 'have', coalesce(b.qty, 0), 'left', coalesce(b.qty, 0) - n.q) order by i.name)
  into v_lines
  from (select item_id, sum(qty) q from erp.order_lines where order_id = o.id and item_id is not null group by 1) n
  join erp.items i on i.id = n.item_id left join erp.stock_balances b on b.item_id = n.item_id;
  if p_preview then return jsonb_build_object('preview', true, 'lines', coalesce(v_lines, '[]')); end if;
  if exists (select 1 from jsonb_array_elements(coalesce(v_lines, '[]')) x where (x->>'left')::numeric < -0.0005) then
    return jsonb_build_object('ok', false, 'lines', v_lines, 'message', '재고가 모자라 출고할 수 없습니다. 재고를 먼저 맞추세요.');
  end if;
  for r in select * from erp.order_lines where order_id = o.id and item_id is not null order by line_no loop
    perform erp.post_stock('ship:' || o.id || ':' || r.line_no || ':' || left(gen_random_uuid()::text, 8),
                           o.company_id, r.item_id, -r.qty, '출고', 'order', o.id, o.partner_id, v_date, null);
  end loop;
  update erp.orders set status = 'SHIPPED', shipped_at = now(), ship_method = coalesce(nullif(p_ship_method, ''), ship_method) where id = o.id;
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('ship:' || gen_random_uuid(), o.company_id, o.id, 'ship', jsonb_build_object('ship_method', p_ship_method, 'lines', v_lines), erp.actor_name(), now());
  return jsonb_build_object('ok', true, 'lines', v_lines);
end $$;

-- 출고 취소 → 작업완료
create or replace function public.cancel_shipment(p_order_id text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o erp.orders; r record;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if o.shipped_at is null and o.status not in ('SHIPPED', 'DELIVERED') then raise exception '출고되지 않은 주문입니다.'; end if;
  if exists (select 1 from erp.vouchers where id = o.voucher_id and status = 'active') then
    raise exception '거래명세서가 발행된 주문입니다. 전표 화면에서 명세서를 먼저 취소하세요.';
  end if;
  if not exists (select 1 from erp.stock_ledger where source_type = 'order' and source_id = o.id and kind = '출고' and stock_effect) then
    raise exception '옛 앱에서 출고한 주문은 여기서 취소할 수 없습니다.';
  end if;
  for r in select l.* from erp.stock_ledger l
           where l.source_type = 'order' and l.source_id = o.id and l.kind = '출고' and l.stock_effect
             and not exists (select 1 from erp.stock_ledger x where x.reversal_of = l.id) loop
    perform erp.post_stock('unship:' || r.id, r.company_id, r.item_id, -r.qty, '출고 취소', 'order', o.id, r.partner_id,
                           (now() at time zone 'Asia/Seoul')::date, p_reason, r.id);
  end loop;
  update erp.orders set status = 'DISPATCHED', shipped_at = null where id = o.id;
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('unship:' || gen_random_uuid(), o.company_id, o.id, 'unship', jsonb_build_object('reason', p_reason), erp.actor_name(), now());
end $$;

-- ---------- 매출전표(거래명세서): 주문을 골라 발행 ----------
-- p: {company_id, partner_id, date, order_ids: [], extra: [{name, qty, price, tax_exempt, account_code?}], memo}
create or replace function public.create_sales_voucher(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_partner text := p->>'partner_id'; v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Seoul')::date);
        v_id text := 'v-' || gen_random_uuid(); v_no text; v_orders text[]; n int := 0; r record;
begin
  perform erp.assert_member(v_company);
  if not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then raise exception '거래처를 고르세요.'; end if;
  select coalesce(array_agg(x), '{}') into v_orders from jsonb_array_elements_text(coalesce(p->'order_ids', '[]')) x;
  if cardinality(v_orders) = 0 and coalesce(jsonb_array_length(p->'extra'), 0) = 0 and coalesce(jsonb_array_length(case when jsonb_typeof(p->'lines') = 'array' then p->'lines' end), 0) = 0 then raise exception '주문이나 품목을 고르세요.'; end if;
  if exists (select 1 from erp.orders o where o.id = any (v_orders)
             and (o.company_id <> v_company or o.partner_id is distinct from v_partner or o.accounting_excluded
                  or exists (select 1 from erp.vouchers v where v.id = o.voucher_id and v.status = 'active'))) then
    raise exception '다른 거래처 주문이거나, 이미 명세서가 발행됐거나, 발행 안 함으로 표시된 주문이 있습니다.';
  end if;
  v_no := erp.next_no(v_company, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, order_id, memo, created_by, created_at, legacy_collection)
  values (v_id, v_company, v_no, v_date, '매출', v_partner, (select name from erp.partners where id = v_partner),
          case when cardinality(v_orders) = 1 then v_orders[1] end, nullif(p->>'memo', ''), erp.actor_name(), now(), 'app');
  if jsonb_typeof(p->'lines') = 'array' then
    -- 화면에서 고친 줄 그대로(기존 앱 전표 작성: 불러온 주문 줄도 여기서 고친다 — 원본 주문은 안 바뀜). 2026-11-08
    for r in select x from jsonb_array_elements(p->'lines') x where coalesce(nullif(x->>'qty', '')::numeric, 0) <> 0 and coalesce(trim(x->>'name'), '') <> '' loop
      n := n + 1;
      insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, spec, qty, price, supply, tax, amount, account_code, tax_exempt, note)
      select v_id, n, 'item', nullif(r.x->>'item_id', ''), trim(r.x->>'name'), nullif(trim(coalesce(r.x->>'spec', '')), ''), (r.x->>'qty')::numeric,
             coalesce(nullif(r.x->>'price', '')::numeric, 0), a.supply, a.tax, a.gross,
             coalesce(nullif(r.x->>'account_code', ''), erp.sales_account(v_partner, nullif(r.x->>'item_id', ''))), coalesce((r.x->>'tax_exempt')::boolean, false), nullif(trim(coalesce(r.x->>'note', '')), '')
      from erp.line_amount((r.x->>'qty')::numeric, coalesce(nullif(r.x->>'price', '')::numeric, 0), coalesce((r.x->>'tax_exempt')::boolean, false)) a;
    end loop;
  else
  -- 여러 주문을 합치면 같은 품목·단가·과세는 한 줄로 수량을 더한다(사장님 2026-11-08). 비고(note)에 주문 번호들을 남긴다.
  for r in select l.item_id, l.name, sum(l.qty) as qty, l.price, l.tax_exempt, string_agg(distinct o.card_no, ', ') as card_no
           from erp.order_lines l join erp.orders o on o.id = l.order_id
           where l.order_id = any (v_orders)
           group by l.item_id, l.name, l.price, l.tax_exempt
           having sum(l.qty) <> 0
           order by min(o.delivery_date), min(o.card_no), min(l.line_no) loop
    n := n + 1;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, qty, price, supply, tax, amount, account_code, tax_exempt, note)
    select v_id, n, 'item', r.item_id, r.name, r.qty, r.price, a.supply, a.tax, a.gross,
           erp.sales_account(v_partner, r.item_id),
           coalesce(r.tax_exempt, false), r.card_no
    from erp.line_amount(r.qty, r.price, r.tax_exempt) a;
  end loop;
  for r in select x from jsonb_array_elements(coalesce(p->'extra', '[]')) x where coalesce((x->>'qty')::numeric, 0) <> 0 loop
    n := n + 1;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, qty, price, supply, tax, amount, account_code, tax_exempt)
    select v_id, n, 'item', nullif(r.x->>'item_id', ''), r.x->>'name', (r.x->>'qty')::numeric, (r.x->>'price')::numeric, a.supply, a.tax, a.gross,
           coalesce(nullif(r.x->>'account_code', ''), erp.sales_account(v_partner, nullif(r.x->>'item_id', ''))), coalesce((r.x->>'tax_exempt')::boolean, false)
    from erp.line_amount((r.x->>'qty')::numeric, (r.x->>'price')::numeric, coalesce((r.x->>'tax_exempt')::boolean, false)) a;
  end loop;
  end if;
  update erp.vouchers v set supply = s.supply, tax = s.tax, amount = s.amount
  from (select sum(supply) supply, sum(tax) tax, sum(amount) amount from erp.voucher_lines where voucher_id = v_id) s where v.id = v_id;
  update erp.orders set voucher_id = v_id where id = any (v_orders);
  return jsonb_build_object('voucher_id', v_id, 'voucher_no', v_no, 'lines', n);
end $$;

-- 매출전표 취소: 주문 연결을 풀어 다시 발행할 수 있게
create or replace function public.cancel_sales_voucher(p_voucher_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v erp.vouchers;
begin
  select * into v from erp.vouchers where id = p_voucher_id for update;
  if not found or v.kind <> '매출' or v.return_of is not null then raise exception '매출 명세서가 아닙니다.'; end if;
  perform erp.assert_member(v.company_id);
  if v.legacy_collection <> 'app' then raise exception '옛 앱의 명세서는 여기서 취소할 수 없습니다.'; end if;
  if v.status <> 'active' then raise exception '이미 취소된 명세서입니다.'; end if;
  if exists (select 1 from erp.tax_invoice_vouchers tv join erp.tax_invoices t on t.id = tv.invoice_id where tv.voucher_id = v.id and t.status <> '취소') then
    raise exception '세금계산서에 묶인 명세서입니다. 세금계산서를 먼저 취소하세요.';
  end if;
  update erp.vouchers set status = 'canceled' where id = v.id;
  update erp.orders set voucher_id = null where voucher_id = v.id;
end $$;

-- ---------- 주문 분할(기존 앱 '분할') ----------
-- 줄의 수량 일부(또는 전부)를 새 주문으로 뗀다. 같은 거래처·출고 방식, 배송일은 새로 고를 수 있다.
-- 생산 처리(체크)한 줄은 떼지 않는다(생산 근거가 줄에 묶여 있다) — 체크를 풀고 떼거나 그대로 둔다.
-- p: {lines: [{line_no, qty}], delivery_date?}
create or replace function public.split_order(p_order_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o erp.orders; v_new text := 'ord-' || gen_random_uuid(); v_date date; r record; n int := 0; v_no text;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if o.status = 'CANCELED' then raise exception '삭제한 주문입니다.'; end if;
  if o.shipped_at is not null or o.status in ('SHIPPED', 'DELIVERED') then raise exception '출고된 주문은 나눌 수 없습니다.'; end if;
  v_date := coalesce((p->>'delivery_date')::date, o.delivery_date);
  create temp table if not exists _split (line_no int, qty numeric) on commit drop;
  truncate _split;
  insert into _split select (x->>'line_no')::int, (x->>'qty')::numeric from jsonb_array_elements(coalesce(p->'lines', '[]')) x where coalesce((x->>'qty')::numeric, 0) > 0;
  if not exists (select 1 from _split) then raise exception '뗄 줄과 수량을 고르세요.'; end if;
  if exists (select 1 from _split s left join erp.order_lines l on l.order_id = o.id and l.line_no = s.line_no
             where l.order_id is null or s.qty > l.qty) then raise exception '주문에 없는 줄이거나 수량보다 많이 뗍니다.'; end if;
  if not exists (select 1 from erp.order_lines l left join _split s on s.line_no = l.line_no where l.order_id = o.id and l.qty - coalesce(s.qty, 0) > 0) then
    raise exception '전부 떼면 원래 주문이 빕니다. 배송일만 바꾸려면 배송일을 고치세요.';
  end if;
  v_no := erp.next_no(o.company_id, v_date, 'ORD-', 'order');
  insert into erp.orders (id, company_id, partner_id, partner_name, status, source, ship_method, delivery_date, created_at, card_no, note, delivery_slot)
  values (v_new, o.company_id, o.partner_id, o.partner_name, 'PENDING', o.source, o.ship_method, v_date, now(), v_no,
          nullif(concat_ws(' ', coalesce(o.card_no, '원 주문') || '에서 나눔', nullif(o.note, '')), ''), o.delivery_slot);
  for r in select l.*, s.qty moved from _split s join erp.order_lines l on l.order_id = o.id and l.line_no = s.line_no order by l.line_no loop
    n := n + 1;
    -- 체크(완료)한 줄은 줄 전체가 완료라, 떼어 간 몫도 완료로 간다(기존 앱: 완료 수량은 새 주문 수량을 넘을 수 없고 남는 완료가 원주문을 넘을 수 없다).
    -- 생산을 다시 만들지 않고 같은 생산(run_id)을 같이 가리킨다.
    insert into erp.order_lines (order_id, line_no, item_id, name, qty, price, tax_exempt, made_on, label_stage, checked_at, checked_by, run_id)
    values (v_new, n, r.item_id, r.name, r.moved, r.price, r.tax_exempt, r.made_on, r.label_stage, r.checked_at, r.checked_by, r.run_id);
    if r.qty - r.moved > 0 then update erp.order_lines set qty = qty - r.moved where order_id = o.id and line_no = r.line_no;
    else delete from erp.order_lines where order_id = o.id and line_no = r.line_no; end if;
  end loop;
  update erp.orders x set total_amount = (select sum((erp.line_amount(qty, price, tax_exempt)).gross) from erp.order_lines where order_id = x.id) where x.id in (o.id, v_new);
  perform erp.sync_order_status(o.id);
  perform erp.sync_order_status(v_new);
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('split:' || gen_random_uuid(), o.company_id, o.id, 'split', jsonb_build_object('to', v_no, 'lines', p->'lines', 'delivery_date', v_date), erp.actor_name(), now()),
         ('split:' || gen_random_uuid(), o.company_id, v_new, 'split', jsonb_build_object('from', o.card_no), erp.actor_name(), now());
  return jsonb_build_object('order_id', v_new, 'card_no', v_no);
end $$;
-- 주문 삭제(기존 앱 '주문 삭제'): 출고 전만. 생산 처리한 줄은 생산을 되돌리고(나눈 주문과 같이 쓰는 생산은 남김), 주문은 '취소'로 남겨 기록을 지킨다.
create or replace function public.delete_order(p_order_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare o erp.orders; l record;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found or o.status = 'CANCELED' then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if o.shipped_at is not null or o.status in ('SHIPPED', 'DELIVERED') then raise exception '출고된 주문은 지울 수 없습니다. 출고를 먼저 취소하세요.'; end if;
  if o.voucher_id is not null then raise exception '매출 전표가 있는 주문입니다. 전표를 먼저 취소하세요.'; end if;
  for l in select * from erp.order_lines where order_id = o.id and checked_at is not null and run_id is not null loop
    if not exists (select 1 from erp.order_lines x where x.run_id = l.run_id and x.checked_at is not null and x.order_id <> o.id) then
      perform public.cancel_production(l.run_id, '주문 삭제 ' || coalesce(o.card_no, o.id));
    end if;
  end loop;
  update erp.order_lines set checked_at = null, checked_by = null, run_id = null where order_id = o.id;
  update erp.orders set status = 'CANCELED' where id = o.id;
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('status:' || gen_random_uuid(), o.company_id, o.id, 'status', jsonb_build_object('from', o.status, 'to', 'CANCELED', 'deleted', true), erp.actor_name(), now());
end $$;
revoke all on function public.delete_order(text) from public, anon;
grant execute on function public.delete_order(text) to authenticated;

revoke all on function public.split_order(text, jsonb) from public, anon;
grant execute on function public.split_order(text, jsonb) to authenticated;

revoke all on function public.preview_order_line(text, int, numeric), public.check_order_line(text, int, boolean, numeric, date),
  public.set_order_line_meta(text, int, jsonb), public.set_order_meta(text, jsonb), public.ship_order(text, text, date, boolean),
  public.cancel_shipment(text, text), public.create_sales_voucher(jsonb), public.cancel_sales_voucher(text) from public, anon;
grant execute on function public.preview_order_line(text, int, numeric), public.check_order_line(text, int, boolean, numeric, date),
  public.set_order_line_meta(text, int, jsonb), public.set_order_meta(text, jsonb), public.ship_order(text, text, date, boolean),
  public.cancel_shipment(text, text), public.create_sales_voucher(jsonb), public.cancel_sales_voucher(text) to authenticated;
revoke all on function erp.sync_order_status(text), erp.is_produced(erp.items) from public, anon, authenticated;

-- ---------- 명세서 바로 고치기(2026-11-09, '수정 요청' 대신) ----------
-- 매출·매입 명세서의 날짜·적요·줄(품목·규격·수량·단가·과세·계정·비고)을 그 자리에서 바꾼다. 거래처는 그대로.
-- 세금계산서에 묶였거나 취소된 명세서는 못 고친다. 이어진 주문·발주는 안 바뀐다(작성 때와 같음). 수금·지불 연결은 그대로 둔다.
create or replace function public.update_item_voucher(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v erp.vouchers; n int := 0; r record;
begin
  select * into v from erp.vouchers where id = p->>'voucher_id' for update;
  if not found or v.kind not in ('매출', '매입') then raise exception '매출·매입 명세서만 고칠 수 있습니다.'; end if;
  perform erp.assert_member(v.company_id);
  if v.status <> 'active' then raise exception '취소된 명세서입니다.'; end if;
  if exists (select 1 from erp.tax_invoice_vouchers tv join erp.tax_invoices t on t.id = tv.invoice_id where tv.voucher_id = v.id and t.status <> '취소') then
    raise exception '세금계산서에 묶인 명세서입니다. 세금계산서를 먼저 취소하세요.';
  end if;
  if exists (select 1 from erp.vouchers where return_of = v.id and status = 'active') then
    raise exception '반품이 걸린 명세서입니다. 반품을 먼저 취소하세요.';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or not exists (select 1 from jsonb_array_elements(p->'lines') x
       where coalesce(trim(x->>'name'), '') <> '' and coalesce(nullif(x->>'qty', '')::numeric, 0) <> 0) then
    raise exception '품목 줄이 하나도 없습니다.';
  end if;
  delete from erp.voucher_lines where voucher_id = v.id;
  for r in select x from jsonb_array_elements(p->'lines') x where coalesce(nullif(x->>'qty', '')::numeric, 0) <> 0 and coalesce(trim(x->>'name'), '') <> '' loop
    n := n + 1;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, spec, qty, price, supply, tax, amount, account_code, tax_exempt, note)
    select v.id, n, 'item', nullif(r.x->>'item_id', ''), trim(r.x->>'name'), nullif(trim(coalesce(r.x->>'spec', '')), ''), (r.x->>'qty')::numeric,
           coalesce(nullif(r.x->>'price', '')::numeric, 0), a.supply, a.tax, a.gross,
           coalesce(nullif(r.x->>'account_code', ''),
                    case when v.kind = '매출' then erp.sales_account(v.partner_id, nullif(r.x->>'item_id', '')) else erp.purchase_account(v.partner_id, nullif(r.x->>'item_id', '')) end),
           coalesce((r.x->>'tax_exempt')::boolean, false), nullif(trim(coalesce(r.x->>'note', '')), '')
    from erp.line_amount((r.x->>'qty')::numeric, coalesce(nullif(r.x->>'price', '')::numeric, 0), coalesce((r.x->>'tax_exempt')::boolean, false)) a;
  end loop;
  update erp.vouchers t set supply = s.supply, tax = s.tax, amount = s.amount,
         date = coalesce(nullif(p->>'date', '')::date, t.date),
         memo = case when p ? 'memo' then nullif(trim(coalesce(p->>'memo', '')), '') else t.memo end
  from (select sum(supply) supply, sum(tax) tax, sum(amount) amount from erp.voucher_lines where voucher_id = v.id) s
  where t.id = v.id;
end $$;
revoke all on function public.update_item_voucher(jsonb) from public, anon;
grant execute on function public.update_item_voucher(jsonb) to authenticated;
