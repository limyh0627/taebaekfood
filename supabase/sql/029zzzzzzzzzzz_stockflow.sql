-- erp-core 저장소 supabase/stockflow.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 재고·발주 흐름을 기존 앱과 같게 (2026-11-05). orderflow.sql 뒤에 돈다.
--
--  기존 앱 발주 흐름
--   발주 예정(pending) ─ 발주확정 또는 매입전표 발행 ─▶ 입고대기(invoiced) ─ 입고확정 ─▶ 입고 완료(received, 일부면 partial)
--   · 매입전표(명세서)는 입고와 따로: 발주를 골라 발행하면 발주에 이어지고 입고대기로 넘어간다.
--   · 입고확정은 재고만 늘린다(원료는 로트가 생긴다). 명세서를 만들지 않는다.
--  개봉
--   · 박스: BOM에 완제품 낱개 한 가지가 2개 이상 들어 있는 품목. 박스 −n, 낱개 +n×개입.
--   · 캔: 사람이 '개봉 가능'으로 켠 품목. BOM의 벌크 한 가지를 kg으로 되돌린다(공캔·뚜껑은 버린다).

alter table erp.items add column if not exists category text;
alter table erp.items add column if not exists subtype text;
alter table erp.items add column if not exists spec text;
alter table erp.items add column if not exists unpackable boolean not null default false;
alter table erp.purchase_orders add column if not exists invoiced_at timestamptz;
alter table erp.purchase_receipts add column if not exists batch_id text;

-- ---------- 발주 ----------
create or replace function public.confirm_purchase_order(p_po_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders;
begin
  select * into po from erp.purchase_orders where id = p_po_id for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if po.status <> 'pending' then raise exception '발주 예정인 것만 발주확정할 수 있습니다.'; end if;
  update erp.purchase_orders set status = 'invoiced', invoiced_at = now() where id = po.id;
end $$;

create or replace function public.cancel_purchase_order(p_po_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders;
begin
  select * into po from erp.purchase_orders where id = p_po_id for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if exists (select 1 from erp.purchase_order_lines where po_id = po.id and received_qty <> 0) then raise exception '입고된 발주는 취소할 수 없습니다. 입고를 먼저 취소하세요.'; end if;
  if exists (select 1 from erp.vouchers where id = po.voucher_id and status = 'active') then raise exception '매입전표가 이어진 발주입니다. 전표를 먼저 취소하세요.'; end if;
  if po.po_type = 'oem' and exists (select 1 from erp.stock_ledger where source_type = 'oem' and source_id = po.id and reversal_of is null
                                    and not exists (select 1 from erp.stock_ledger x where x.reversal_of = stock_ledger.id)) then
    raise exception '원료를 보낸 임가공 발주입니다. 보낸 원료를 먼저 되돌리세요.';
  end if;
  update erp.purchase_orders set status = 'cancelled' where id = po.id;
end $$;

-- 입고확정: 재고만. p_lines: [{line_no, qty}] — 안 주면 남은 수량 전부.
drop function if exists public.receive_purchase(text, jsonb, date);
create or replace function public.receive_purchase(p_po_id text, p_lines jsonb default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders; v_date date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date);
        v_batch text := 'rcv-' || gen_random_uuid(); r record; n int := 0;
begin
  select * into po from erp.purchase_orders where id = p_po_id for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if po.status = 'pending' then raise exception '발주 예정입니다. 발주확정이나 매입전표 발행으로 입고대기에 올린 뒤 입고확정하세요.'; end if;
  if po.status not in ('invoiced', 'partial') then raise exception '입고대기인 발주만 입고확정할 수 있습니다.'; end if;
  if po.po_type = 'oem' then raise exception '임가공 발주는 가공입고로 받습니다.'; end if;

  create temp table if not exists _rcv (line_no int, qty numeric) on commit drop;
  truncate _rcv;
  if p_lines is null then
    insert into _rcv select line_no, qty - received_qty from erp.purchase_order_lines where po_id = po.id and qty > received_qty;
  else
    insert into _rcv select (l->>'line_no')::int, (l->>'qty')::numeric from jsonb_array_elements(p_lines) l where coalesce((l->>'qty')::numeric, 0) <> 0;
  end if;
  if not exists (select 1 from _rcv) then raise exception '받을 수량이 없습니다.'; end if;
  if exists (select 1 from _rcv g left join erp.purchase_order_lines l on l.po_id = po.id and l.line_no = g.line_no
             where l.po_id is null or l.item_id is null or g.qty < 0 or l.received_qty + g.qty > l.qty * 1.5) then
    raise exception '발주에 없는 줄이거나, 받는 수량이 음수이거나 발주량을 크게 넘습니다.';
  end if;
  for r in select l.*, x.qty got from _rcv x join erp.purchase_order_lines l on l.po_id = po.id and l.line_no = x.line_no order by l.line_no loop
    n := n + 1;
    perform erp.post_stock(v_batch || ':' || r.line_no, po.company_id, r.item_id, r.got, '입고', 'purchase', v_batch, po.partner_id, v_date, po.po_no);
    insert into erp.purchase_receipts (id, company_id, po_id, line_no, qty, ledger_id, received_on, batch_id)
    values ('rcpt-' || gen_random_uuid(), po.company_id, po.id, r.line_no, r.got, v_batch || ':' || r.line_no, v_date, v_batch);
    update erp.purchase_order_lines set received_qty = received_qty + r.got where po_id = po.id and line_no = r.line_no;
  end loop;
  update erp.purchase_orders set received_at = now(),
    status = case when exists (select 1 from erp.purchase_order_lines where po_id = po.id and received_qty < qty) then 'partial' else 'received' end
  where id = po.id;
  return jsonb_build_object('batch_id', v_batch, 'lines', n);
end $$;

-- 입고 취소: 그 입고 한 번(batch)을 되돌린다. 매입전표는 건드리지 않는다.
drop function if exists public.cancel_receipt(text);
create or replace function public.cancel_receipt(p_batch_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_po text; v_company text; n int := 0;
begin
  select po_id, company_id into v_po, v_company from erp.purchase_receipts where batch_id = p_batch_id limit 1;
  if v_po is null then raise exception '새 앱에서 한 입고만 취소할 수 있습니다.'; end if;
  perform erp.assert_member(v_company);
  perform 1 from erp.purchase_orders where id = v_po for update;
  for r in select * from erp.purchase_receipts where batch_id = p_batch_id and canceled_at is null loop
    n := n + 1;
    perform erp.post_stock('unrcv:' || r.ledger_id, r.company_id, (select item_id from erp.stock_ledger where id = r.ledger_id), -r.qty,
                           '입고 취소', 'purchase', p_batch_id, (select partner_id from erp.purchase_orders where id = r.po_id),
                           (now() at time zone 'Asia/Seoul')::date, null, r.ledger_id);
    update erp.purchase_order_lines set received_qty = received_qty - r.qty where po_id = r.po_id and line_no = r.line_no;
    update erp.purchase_receipts set canceled_at = now() where id = r.id;
  end loop;
  if n = 0 then raise exception '이미 취소된 입고입니다.'; end if;
  update erp.purchase_orders p set
    status = case when not exists (select 1 from erp.purchase_order_lines where po_id = p.id and received_qty <> 0) then 'invoiced' else 'partial' end
  where p.id = v_po;
end $$;

-- 매입전표 발행: 거래처의 발주를 골라 한 장. 발주 예정은 입고대기로 넘어간다.
-- p: {company_id, partner_id, date, po_ids: [], extra: [{name, qty, price, tax_exempt, item_id?, account_code?}], memo}
create or replace function public.create_purchase_voucher(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_partner text := p->>'partner_id'; v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Seoul')::date);
        v_id text := 'v-' || gen_random_uuid(); v_no text; v_pos text[]; n int := 0; r record;
begin
  perform erp.assert_member(v_company);
  if not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then raise exception '거래처를 고르세요.'; end if;
  select coalesce(array_agg(x), '{}') into v_pos from jsonb_array_elements_text(coalesce(p->'po_ids', '[]')) x;
  if cardinality(v_pos) = 0 and coalesce(jsonb_array_length(p->'extra'), 0) = 0 then raise exception '발주나 품목을 고르세요.'; end if;
  if exists (select 1 from erp.purchase_orders o where o.id = any (v_pos)
             and (o.company_id <> v_company or o.partner_id is distinct from v_partner or o.status = 'cancelled'
                  or exists (select 1 from erp.vouchers v where v.id = o.voucher_id and v.status = 'active'))) then
    raise exception '다른 거래처 발주이거나, 취소됐거나, 이미 매입전표가 이어진 발주가 있습니다.';
  end if;
  v_no := erp.next_no(v_company, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, po_id, memo, created_by, created_at, legacy_collection)
  values (v_id, v_company, v_no, v_date, '매입', v_partner, (select name from erp.partners where id = v_partner),
          case when cardinality(v_pos) = 1 then v_pos[1] end, nullif(p->>'memo', ''), erp.actor_name(), now(), 'app');
  -- 여러 발주를 합치면 같은 품목·단가·과세(·임가공 여부)는 한 줄로 수량을 더한다(사장님 2026-11-08). 비고에 발주 번호들.
  for r in select x.item_id, x.name, sum(x.qty) as qty, x.unit_price, x.exempt, x.oem, string_agg(distinct x.po_no, ', ') as po_no
           from (select l.item_id, l.name, l.qty, o.po_no, o.created_at, l.line_no, o.po_type = 'oem' as oem,
                        coalesce(l.price, pi.price, 0) as unit_price, coalesce(l.tax_exempt, pi.tax_type = '면세', false) as exempt
                 from erp.purchase_order_lines l join erp.purchase_orders o on o.id = l.po_id
                 left join lateral (select price, tax_type from erp.partner_items x where x.partner_id = v_partner and x.item_id = l.item_id
                                    and coalesce(x.direction, 'in') = 'in' order by x.price is null, x.id limit 1) pi on true
                 where l.po_id = any (v_pos)) x
           group by x.item_id, x.name, x.unit_price, x.exempt, x.oem
           having sum(x.qty) <> 0
           order by min(x.created_at), min(x.line_no) loop
    n := n + 1;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, qty, price, supply, tax, amount, account_code, tax_exempt, note)
    select v_id, n, 'item', r.item_id, r.name, r.qty, r.unit_price, a.supply, a.tax, a.gross,
           case when r.oem then '540' else erp.purchase_account(v_partner, r.item_id) end,
           r.exempt, r.po_no
    from erp.line_amount(r.qty, r.unit_price, r.exempt) a;
  end loop;
  for r in select x from jsonb_array_elements(coalesce(p->'extra', '[]')) x where coalesce((x->>'qty')::numeric, 0) <> 0 loop
    n := n + 1;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, qty, price, supply, tax, amount, account_code, tax_exempt)
    select v_id, n, 'item', nullif(r.x->>'item_id', ''), r.x->>'name', (r.x->>'qty')::numeric, (r.x->>'price')::numeric, a.supply, a.tax, a.gross,
           coalesce(nullif(r.x->>'account_code', ''), erp.purchase_account(v_partner, nullif(r.x->>'item_id', ''))), coalesce((r.x->>'tax_exempt')::boolean, false)
    from erp.line_amount((r.x->>'qty')::numeric, (r.x->>'price')::numeric, coalesce((r.x->>'tax_exempt')::boolean, false)) a;
  end loop;
  update erp.vouchers v set supply = s.supply, tax = s.tax, amount = s.amount
  from (select sum(supply) supply, sum(tax) tax, sum(amount) amount from erp.voucher_lines where voucher_id = v_id) s where v.id = v_id;
  update erp.purchase_orders set voucher_id = v_id,
         status = case when status = 'pending' then 'invoiced' else status end,
         invoiced_at = case when status = 'pending' then now() else invoiced_at end
  where id = any (v_pos);
  return jsonb_build_object('voucher_id', v_id, 'voucher_no', v_no, 'lines', n);
end $$;

create or replace function public.cancel_purchase_voucher(p_voucher_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v erp.vouchers;
begin
  select * into v from erp.vouchers where id = p_voucher_id for update;
  if not found or v.kind <> '매입' or v.return_of is not null then raise exception '매입전표가 아닙니다.'; end if;
  perform erp.assert_member(v.company_id);
  if v.legacy_collection <> 'app' then raise exception '옛 앱의 전표는 여기서 취소할 수 없습니다.'; end if;
  if v.status <> 'active' then raise exception '이미 취소된 전표입니다.'; end if;
  if exists (select 1 from erp.tax_invoice_vouchers tv join erp.tax_invoices t on t.id = tv.invoice_id where tv.voucher_id = v.id and t.status <> '취소') then
    raise exception '세금계산서에 묶인 전표입니다. 세금계산서를 먼저 취소하세요.';
  end if;
  update erp.vouchers set status = 'canceled' where id = v.id;
  update erp.purchase_orders set voucher_id = null where voucher_id = v.id;
end $$;

-- ---------- 개봉 ----------
-- 박스의 낱개 구성: BOM에 완제품이 한 가지만, 2개 이상 (기존 앱 unpackStockComponent)
create or replace function erp.box_component(p_item text, out child_id text, out per numeric)
language sql stable set search_path = '' as $$
  select max(b.child_item_id), max(b.quantity)
  from erp.item_boms b join erp.items c on c.id = b.child_item_id
  where b.parent_item_id = p_item and c.type = 'FINISHED'
  having count(*) = 1 and max(b.quantity) > 1
$$;

-- 캔의 벌크 구성: BOM의 벌크가 한 가지
create or replace function erp.can_component(p_item text, out child_id text, out per numeric)
language sql stable set search_path = '' as $$
  select max(b.child_item_id), max(b.quantity)
  from erp.item_boms b join erp.items c on c.id = b.child_item_id join erp.items i on i.id = b.parent_item_id
  where b.parent_item_id = p_item and i.unpackable and c.is_bulk
  having count(*) = 1 and max(b.quantity) > 0
$$;

-- 개봉 가능한 품목과 나오는 것(화면용)
create or replace view erp.unpack_targets as
select i.id item_id, i.company_id, 'box' as kind, b.child_id, b.per, c.name child_name, c.unit child_unit
from erp.items i cross join lateral erp.box_component(i.id) b join erp.items c on c.id = b.child_id
where b.child_id is not null
union all
select i.id, i.company_id, 'can', b.child_id, b.per, c.name, c.unit
from erp.items i cross join lateral erp.can_component(i.id) b join erp.items c on c.id = b.child_id
where i.unpackable and b.child_id is not null;
alter view erp.unpack_targets set (security_invoker = true);
grant select on erp.unpack_targets to authenticated;

create or replace function public.unpack_item(p_item text, p_count int, p_date date default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i erp.items; t record; v_id text := 'unpack-' || gen_random_uuid(); v_have numeric; v_out numeric;
        v_date date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date);
begin
  select * into i from erp.items where id = p_item;
  if not found then raise exception '품목을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(i.company_id);
  if coalesce(p_count, 0) < 1 then raise exception '몇 개를 깔지 넣으세요.'; end if;
  select * into t from erp.unpack_targets where item_id = p_item limit 1;
  if t.child_id is null then raise exception '개봉할 수 있는 품목이 아닙니다(박스는 BOM에 낱개 한 가지, 캔은 개봉 가능 표시와 벌크 한 가지가 있어야 합니다).'; end if;
  select coalesce(qty, 0) into v_have from erp.stock_balances where item_id = p_item for update;
  if coalesce(v_have, 0) < p_count then raise exception '재고가 % 밖에 없습니다.', coalesce(v_have, 0); end if;
  v_out := round(t.per * p_count, 3);
  perform erp.post_stock(v_id || ':1', i.company_id, p_item, -p_count, '개봉', 'unpack', v_id, null, v_date, p_note);
  perform erp.post_stock(v_id || ':2', i.company_id, t.child_id, v_out, '개봉', 'unpack', v_id, null, v_date,
                         concat_ws(' ', i.name || ' ' || p_count || '개 개봉', nullif(p_note, '')));
  return jsonb_build_object('id', v_id, 'kind', t.kind, 'child', t.child_name, 'qty', v_out, 'unit', t.child_unit);
end $$;

create or replace function public.cancel_unpack(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select * from erp.stock_ledger l where source_type = 'unpack' and source_id = p_id and reversal_of is null
           and not exists (select 1 from erp.stock_ledger x where x.reversal_of = l.id) loop
    perform erp.assert_member(r.company_id);
    n := n + 1;
    perform erp.post_stock('un' || r.id, r.company_id, r.item_id, -r.qty, '개봉 취소', 'unpack', p_id, null,
                           (now() at time zone 'Asia/Seoul')::date, null, r.id);
  end loop;
  if n = 0 then raise exception '되돌릴 개봉이 없습니다.'; end if;
end $$;

revoke all on function public.confirm_purchase_order(text), public.cancel_purchase_order(text), public.receive_purchase(text, jsonb, date),
  public.cancel_receipt(text), public.create_purchase_voucher(jsonb), public.cancel_purchase_voucher(text),
  public.unpack_item(text, int, date, text), public.cancel_unpack(text) from public, anon;
grant execute on function public.confirm_purchase_order(text), public.cancel_purchase_order(text), public.receive_purchase(text, jsonb, date),
  public.cancel_receipt(text), public.create_purchase_voucher(jsonb), public.cancel_purchase_voucher(text),
  public.unpack_item(text, int, date, text), public.cancel_unpack(text) to authenticated;
revoke all on function erp.box_component(text), erp.can_component(text) from public, anon;
