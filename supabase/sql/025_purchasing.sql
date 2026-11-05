-- erp-core 저장소 supabase/purchasing.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 발주 · 입고 · 매입 명세서. orders.sql 뒤에 돈다(erp.next_no, erp.post_stock, erp.line_amount를 쓴다).
--
-- 발주 저장: 단가·과세를 안 주면 거래처-품목 연결(매입, direction 'in')에서 가져온다.
-- 입고: 받은 만큼 재고 +, 매입 명세서(줄별 공급가액·세액)를 만든다. 일부만 받아도 된다(남은 수량은 다음 입고).
-- 매입 계정: 거래처-품목 연결에 적힌 계정 > 품목 종류(원료·반제품 500 원료매입, 부자재·파렛트 505 부자재매입, 그 밖 500).

create or replace function erp.purchase_account(p_partner text, p_item text) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select account_code from erp.partner_items where partner_id = p_partner and item_id = p_item
       and coalesce(direction, 'in') = 'in' and account_code is not null limit 1),
    (select case when type in ('SUB', 'PALLET') then '505' else '500' end from erp.items where id = p_item),
    '500')
$$;

-- p: {id?, company_id, partner_id, date, note, lines: [{item_id, qty, price?, tax_exempt?}]}
create or replace function public.save_purchase_order(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company text := p->>'company_id';
  v_id text := nullif(p->>'id', '');
  v_partner text := nullif(p->>'partner_id', '');
  v_date date := coalesce((p->>'date')::date, current_date);
  v_po erp.purchase_orders;
begin
  perform erp.assert_member(v_company);
  if v_partner is null or not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then
    raise exception '거래처를 고르세요.';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception '품목이 하나도 없습니다.'; end if;
  if exists (select 1 from jsonb_array_elements(p->'lines') l
             where not exists (select 1 from erp.items i where i.id = l->>'item_id' and i.company_id = v_company)
                or coalesce((l->>'qty')::numeric, 0) <= 0) then
    raise exception '없는 품목이거나 수량이 0 이하인 줄이 있습니다.';
  end if;

  if v_id is null then
    v_id := 'po-' || gen_random_uuid();
    insert into erp.purchase_orders (id, company_id, po_no, po_type, partner_id, partner_name, status, note, created_at)
    values (v_id, v_company, erp.next_no(v_company, v_date, 'PO-', 'po'),
            case when p->>'po_type' = 'oem' then 'oem' else 'normal' end, v_partner,
            (select name from erp.partners where id = v_partner), 'pending', nullif(p->>'note', ''), now());
  else
    select * into v_po from erp.purchase_orders where id = v_id for update;
    if not found or v_po.company_id <> v_company then raise exception '발주를 찾을 수 없습니다.'; end if;
    if exists (select 1 from erp.purchase_order_lines where po_id = v_id and received_qty <> 0) then
      raise exception '입고가 시작된 발주는 고칠 수 없습니다.';
    end if;
    update erp.purchase_orders set partner_id = v_partner, partner_name = (select name from erp.partners where id = v_partner),
           note = nullif(p->>'note', '') where id = v_id;
    delete from erp.purchase_order_lines where po_id = v_id;
  end if;

  insert into erp.purchase_order_lines (po_id, line_no, item_id, name, qty, unit, price, tax_exempt)
  select v_id, l.ord::int, i.id, i.name, (l.v->>'qty')::numeric, i.unit,
         coalesce((l.v->>'price')::numeric, pi.price, 0),
         coalesce((l.v->>'tax_exempt')::boolean, pi.tax_type = '면세', false)
  from jsonb_array_elements(p->'lines') with ordinality l(v, ord)
  join erp.items i on i.id = l.v->>'item_id'
  left join lateral (select price, tax_type from erp.partner_items x
                     where x.partner_id = v_partner and x.item_id = i.id and coalesce(x.direction, 'in') = 'in'
                     order by x.price is null, x.id limit 1) pi on true;
  return v_id;
end $$;

-- 입고. p_lines: [{line_no, qty}] — 안 주면 남은 수량 전부. 명세서 날짜 = 입고일.
create or replace function public.receive_purchase(p_po_id text, p_lines jsonb default null, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  po erp.purchase_orders;
  v_date date := coalesce(p_date, current_date);
  v_voucher text := 'v-' || gen_random_uuid();
  v_no text;
  r record;
  n int := 0;
begin
  select * into po from erp.purchase_orders where id = p_po_id for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);

  create temp table if not exists _rcv (line_no int, qty numeric) on commit drop;
  truncate _rcv;
  if p_lines is null then
    insert into _rcv select line_no, qty - received_qty from erp.purchase_order_lines where po_id = po.id and qty > received_qty;
  else
    insert into _rcv select (l->>'line_no')::int, (l->>'qty')::numeric from jsonb_array_elements(p_lines) l
    where coalesce((l->>'qty')::numeric, 0) <> 0;
  end if;
  if not exists (select 1 from _rcv) then raise exception '받을 수량이 없습니다.'; end if;
  if exists (select 1 from _rcv g left join erp.purchase_order_lines l on l.po_id = po.id and l.line_no = g.line_no
             where l.po_id is null or l.item_id is null or g.qty < 0 or l.received_qty + g.qty > l.qty * 1.5) then
    raise exception '발주에 없는 줄이거나, 받는 수량이 음수이거나 발주량을 크게 넘습니다.';
  end if;

  v_no := erp.next_no(po.company_id, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, po_id, created_by, created_at, legacy_collection)
  values (v_voucher, po.company_id, v_no, v_date, '매입', po.partner_id, po.partner_name, po.id, erp.actor_name(), now(), 'app');

  for r in select l.*, x.qty as got from _rcv x join erp.purchase_order_lines l on l.po_id = po.id and l.line_no = x.line_no order by l.line_no loop
    n := n + 1;
    perform erp.post_stock('rcv:' || v_voucher || ':' || r.line_no, po.company_id, r.item_id, r.got, '입고', 'purchase',
                           v_voucher, po.partner_id, v_date, po.po_no);
    insert into erp.purchase_receipts (id, company_id, po_id, line_no, qty, voucher_id, ledger_id, received_on)
    values ('rcpt-' || gen_random_uuid(), po.company_id, po.id, r.line_no, r.got, v_voucher, 'rcv:' || v_voucher || ':' || r.line_no, v_date);
    update erp.purchase_order_lines set received_qty = received_qty + r.got where po_id = po.id and line_no = r.line_no;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, qty, price, supply, tax, amount, account_code, tax_exempt)
    select v_voucher, n, 'item', r.item_id, r.name, r.got, r.price, a.supply, a.tax, a.gross,
           erp.purchase_account(po.partner_id, r.item_id), coalesce(r.tax_exempt, false)
    from erp.line_amount(r.got, r.price, r.tax_exempt) a;
  end loop;

  update erp.vouchers v set supply = s.supply, tax = s.tax, amount = s.amount
  from (select sum(supply) supply, sum(tax) tax, sum(amount) amount from erp.voucher_lines where voucher_id = v_voucher) s
  where v.id = v_voucher;
  update erp.purchase_orders set
    status = case when exists (select 1 from erp.purchase_order_lines where po_id = po.id and received_qty < qty) then 'partial' else 'received' end,
    received_at = now(), voucher_id = v_voucher
  where id = po.id;
  return jsonb_build_object('voucher_id', v_voucher, 'voucher_no', v_no, 'lines', n);
end $$;

-- 입고 취소: 그 입고(매입 명세서 한 장)의 재고를 되돌리고 명세서를 취소한다.
drop function if exists public.cancel_receipt(text);  -- stockflow.sql이 이름을 바꿔 다시 만든다. 두 번째 이전부터 이름 충돌
create or replace function public.cancel_receipt(p_voucher_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v erp.vouchers; r record;
begin
  select * into v from erp.vouchers where id = p_voucher_id for update;
  if not found then raise exception '명세서를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v.company_id);
  if v.legacy_collection <> 'app' or v.kind <> '매입' or v.po_id is null then raise exception '새 앱에서 입고한 매입 명세서만 취소할 수 있습니다.'; end if;
  if v.status = 'canceled' then raise exception '이미 취소된 입고입니다.'; end if;
  for r in select * from erp.purchase_receipts where voucher_id = v.id and canceled_at is null loop
    perform erp.post_stock('unrcv:' || r.ledger_id, r.company_id,
                           (select item_id from erp.stock_ledger where id = r.ledger_id), -r.qty, '입고 취소', 'purchase', v.id,
                           v.partner_id, current_date, null, r.ledger_id);
    update erp.purchase_order_lines set received_qty = received_qty - r.qty where po_id = r.po_id and line_no = r.line_no;
    update erp.purchase_receipts set canceled_at = now() where id = r.id;
  end loop;
  update erp.vouchers set status = 'canceled' where id = v.id;
  update erp.purchase_orders p set
    status = case when not exists (select 1 from erp.purchase_order_lines where po_id = p.id and received_qty <> 0) then 'pending' else 'partial' end,
    voucher_id = (select id from erp.vouchers where po_id = p.id and status = 'active' order by created_at desc limit 1)
  where p.id = v.po_id;
end $$;

revoke all on function public.save_purchase_order(jsonb), public.receive_purchase(text, jsonb, date), public.cancel_receipt(text) from public, anon;
grant execute on function public.save_purchase_order(jsonb), public.receive_purchase(text, jsonb, date), public.cancel_receipt(text) to authenticated;
revoke all on function erp.purchase_account(text, text) from public, anon, authenticated;
