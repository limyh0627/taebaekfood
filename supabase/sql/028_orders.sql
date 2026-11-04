-- erp-core 저장소 supabase/orders.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 주문 저장 · 출고 확정 · 출고 취소. 쓰기는 이 함수들로만 한다(표에 직접 쓰는 권한은 주지 않는다).
-- 한 함수 = 한 트랜잭션: 재고 원장·잔고·매출 전표·주문 상태가 같이 바뀌거나 같이 안 바뀐다.
-- erp 스키마를 새로 만들면(시험 이전) 다시 돌린다. 시험 이전 워크플로가 자동으로 돈다.

-- ---------- 공통 ----------
-- JS Math.round와 같은 반올림(.5는 위로). Postgres round()는 음수 .5를 아래로 보내 반품에서 1원 갈린다.
create or replace function erp.js_round(x numeric) returns numeric language sql immutable as $$ select floor(x + 0.5) $$;

-- 세금 포함 단가 → 합계·공급가액·세액. src/domain/lineAmount.ts와 같은 규칙.
create or replace function erp.line_amount(qty numeric, price numeric, exempt boolean,
  out gross numeric, out supply numeric, out tax numeric) language sql immutable as $$
  select g, case when coalesce(exempt, false) then g else erp.js_round(g / 1.1) end,
            case when coalesce(exempt, false) then 0 else g - erp.js_round(g / 1.1) end
  from (select erp.js_round(coalesce(qty, 0) * coalesce(price, 0)) as g) x
$$;

create or replace function erp.assert_member(p_company text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (p_company = any (app.my_company_ids())) then
    raise exception '이 회사의 데이터를 바꿀 권한이 없습니다.' using errcode = '42501';
  end if;
end $$;

create or replace function erp.actor_name() returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select email from auth.users where id = auth.uid()), '알 수 없음')
$$;

-- 날짜별 일련번호: 접두어 + YYMMDD-NNN. 같은 회사·같은 날짜는 잠가서 번호가 겹치지 않게 한다.
create or replace function erp.next_no(p_company text, p_date date, p_prefix text, p_kind text) returns text
language plpgsql security definer set search_path = '' as $$
declare head text := p_prefix || to_char(p_date, 'YYMMDD') || '-'; n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_kind || ':' || p_company || ':' || head));
  if p_kind = 'voucher' then
    select coalesce(max(substr(voucher_no, length(head) + 1)::int), 0) into n from erp.vouchers
    where company_id = p_company and voucher_no like head || '%' and substr(voucher_no, length(head) + 1) ~ '^[0-9]+$';
  else
    select coalesce(max(substr(card_no, length(head) + 1)::int), 0) into n from erp.orders
    where company_id = p_company and card_no like head || '%' and substr(card_no, length(head) + 1) ~ '^[0-9]+$';
  end if;
  return head || lpad((n + 1)::text, 3, '0');
end $$;

-- 재고 한 줄: 원장에 더하고 잔고를 맞춘다. 잔고는 언제나 원장(stock_effect) 합계다.
create or replace function erp.post_stock(p_id text, p_company text, p_item text, p_qty numeric, p_kind text,
  p_source_type text, p_source_id text, p_partner text, p_date date, p_note text, p_reversal_of text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_unit text;
begin
  select unit into v_unit from erp.items where id = p_item;
  insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, source_id, partner_id,
                                reversal_of, effective_date, note)
  values (p_id, p_company, p_item, p_qty, true, v_unit, p_kind, p_source_type, p_source_id, p_partner,
          p_reversal_of, p_date, p_note);
  insert into erp.stock_balances (item_id, company_id, qty, unit) values (p_item, p_company, p_qty, v_unit)
  on conflict (item_id) do update set qty = erp.stock_balances.qty + excluded.qty, updated_at = now();
end $$;

-- ---------- 주문 저장 ----------
-- p: {id?, company_id, partner_id, delivery_date, ship_method, note, lines: [{item_id, qty, price?, tax_exempt?}]}
-- 단가·과세를 안 주면 거래처-품목 연결(판매)에서 가져온다. 출고된 주문은 못 고친다.
create or replace function public.save_order(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company text := p->>'company_id';
  v_id text := nullif(p->>'id', '');
  v_partner text := nullif(p->>'partner_id', '');
  v_order erp.orders;
  v_total numeric;
  v_date date := coalesce((p->>'delivery_date')::date, current_date);
begin
  perform erp.assert_member(v_company);
  if v_partner is not null and not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then
    raise exception '거래처를 찾을 수 없습니다.';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception '품목이 하나도 없습니다.';
  end if;
  if exists (select 1 from jsonb_array_elements(p->'lines') l
             where not exists (select 1 from erp.items i where i.id = l->>'item_id' and i.company_id = v_company)
                or coalesce((l->>'qty')::numeric, 0) = 0) then
    raise exception '없는 품목이거나 수량이 0인 줄이 있습니다.';
  end if;

  if v_id is null then
    v_id := 'ORD-' || gen_random_uuid();
    insert into erp.orders (id, company_id, partner_id, partner_name, status, source, ship_method, delivery_date,
                            created_at, card_no, note)
    values (v_id, v_company, v_partner, (select name from erp.partners where id = v_partner), 'PENDING', 'erp-core',
            nullif(p->>'ship_method', ''), v_date, now(), erp.next_no(v_company, v_date, 'ORD-', 'order'), nullif(p->>'note', ''));
  else
    select * into v_order from erp.orders where id = v_id for update;
    if not found or v_order.company_id <> v_company then raise exception '주문을 찾을 수 없습니다.'; end if;
    if v_order.shipped_at is not null or v_order.status in ('SHIPPED', 'DELIVERED') then
      raise exception '출고된 주문은 고칠 수 없습니다. 출고를 먼저 취소하세요.';
    end if;
    update erp.orders set partner_id = v_partner, partner_name = (select name from erp.partners where id = v_partner),
           ship_method = nullif(p->>'ship_method', ''), delivery_date = v_date, note = nullif(p->>'note', '')
    where id = v_id;
    delete from erp.order_lines where order_id = v_id;
  end if;

  insert into erp.order_lines (order_id, line_no, item_id, name, qty, price, tax_exempt)
  select v_id, l.ord::int, i.id, i.name, (l.v->>'qty')::numeric,
         coalesce((l.v->>'price')::numeric, pi.price, 0),
         coalesce((l.v->>'tax_exempt')::boolean, pi.tax_type = '면세', false)
  from jsonb_array_elements(p->'lines') with ordinality l(v, ord)
  join erp.items i on i.id = l.v->>'item_id'
  left join lateral (select price, tax_type from erp.partner_items x
                     where x.partner_id = v_partner and x.item_id = i.id and coalesce(x.direction, 'out') = 'out'
                     order by x.price is null, x.id limit 1) pi on true;

  select sum((erp.line_amount(qty, price, tax_exempt)).gross) into v_total from erp.order_lines where order_id = v_id;
  update erp.orders set total_amount = v_total where id = v_id;

  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('save:' || gen_random_uuid(), v_company, v_id, case when v_order.id is null then 'create' else 'edit' end,
          jsonb_build_object('lines', p->'lines', 'total', v_total), erp.actor_name(), now());
  return v_id;
end $$;

-- ---------- 출고 확정 ----------
-- 재고가 모자라면 아무것도 바꾸지 않고 {ok:false, shortages:[…]}를 돌려준다. allow_short면 그대로 출고(잔고 음수).
-- 성공하면: 품목별 출고 원장 줄 + 잔고 차감 + 매출 전표(줄별 공급가액·세액) + 주문 상태 SHIPPED.
create or replace function public.ship_order(p_order_id text, p_allow_short boolean default false, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o erp.orders;
  v_date date;
  v_short jsonb;
  v_voucher text := 'v-' || gen_random_uuid();
  v_no text;
  r record;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if o.shipped_at is not null or o.status in ('SHIPPED', 'DELIVERED') then raise exception '이미 출고된 주문입니다.'; end if;
  if not exists (select 1 from erp.order_lines where order_id = o.id) then raise exception '품목이 없는 주문입니다.'; end if;
  v_date := coalesce(p_date, current_date);

  -- 품목별 필요 수량 vs 잔고 (잔고 줄을 잠가 동시 출고가 같은 재고를 두 번 쓰지 않게 한다)
  perform 1 from erp.stock_balances b
  where b.item_id in (select item_id from erp.order_lines where order_id = o.id and item_id is not null) for update;
  select jsonb_agg(jsonb_build_object('item_id', n.item_id, 'name', i.name, 'need', n.need, 'have', coalesce(b.qty, 0), 'unit', i.unit))
  into v_short
  from (select item_id, sum(qty) as need from erp.order_lines where order_id = o.id and item_id is not null group by item_id) n
  join erp.items i on i.id = n.item_id
  left join erp.stock_balances b on b.item_id = n.item_id
  where coalesce(b.qty, 0) < n.need;
  if v_short is not null and not p_allow_short then
    return jsonb_build_object('ok', false, 'shortages', v_short);
  end if;

  for r in select * from erp.order_lines where order_id = o.id and item_id is not null order by line_no loop
    perform erp.post_stock('ship:' || o.id || ':' || r.line_no || ':' || left(gen_random_uuid()::text, 8),
                           o.company_id, r.item_id, -r.qty, '출고', 'order', o.id, o.partner_id, v_date, null);
  end loop;

  v_no := erp.next_no(o.company_id, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, order_id,
                            created_by, created_at, legacy_collection)
  values (v_voucher, o.company_id, v_no, v_date, '매출', o.partner_id, o.partner_name, o.id, erp.actor_name(), now(), 'app');

  insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, qty, price, supply, tax, amount, account_code, tax_exempt)
  select v_voucher, l.line_no, 'item', l.item_id, l.name, l.qty, l.price, a.supply, a.tax, a.gross,
         coalesce((select x.account_code from erp.partner_items x
                   where x.partner_id = o.partner_id and x.item_id = l.item_id and x.account_code is not null limit 1), '404'),
         coalesce(l.tax_exempt, false)
  from erp.order_lines l cross join lateral erp.line_amount(l.qty, l.price, l.tax_exempt) a
  where l.order_id = o.id;

  update erp.vouchers v set supply = s.supply, tax = s.tax, amount = s.amount
  from (select sum(supply) supply, sum(tax) tax, sum(amount) amount from erp.voucher_lines where voucher_id = v_voucher) s
  where v.id = v_voucher;

  update erp.orders set status = 'SHIPPED', shipped_at = now(), voucher_id = v_voucher where id = o.id;

  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('ship:' || gen_random_uuid(), o.company_id, o.id, 'ship',
          jsonb_build_object('voucher', v_no, 'shortages', v_short), erp.actor_name(), now());

  return jsonb_build_object('ok', true, 'voucher_id', v_voucher, 'voucher_no', v_no, 'shortages', coalesce(v_short, '[]'::jsonb));
end $$;

-- ---------- 출고 취소 ----------
-- 원장 줄은 지우지 않고 반대 줄을 더한다. 매출 전표는 취소 표시. 주문은 다시 고칠 수 있는 상태로.
create or replace function public.cancel_shipment(p_order_id text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o erp.orders; r record; v_n int := 0;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if o.shipped_at is null then raise exception '출고되지 않은 주문입니다.'; end if;

  for r in select l.* from erp.stock_ledger l
           where l.source_type = 'order' and l.source_id = o.id and l.kind = '출고' and l.stock_effect
             and not exists (select 1 from erp.stock_ledger x where x.reversal_of = l.id) loop
    v_n := v_n + 1;
    perform erp.post_stock('unship:' || r.id, r.company_id, r.item_id, -r.qty, '출고 취소', 'order', o.id,
                           r.partner_id, current_date, p_reason, r.id);
  end loop;

  update erp.vouchers set status = 'canceled' where id = o.voucher_id and legacy_collection = 'app';
  update erp.orders set status = 'PENDING', shipped_at = null, voucher_id = null where id = o.id;

  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('unship:' || gen_random_uuid(), o.company_id, o.id, 'unship',
          jsonb_build_object('reason', p_reason, 'reversed_lines', v_n, 'voucher', o.voucher_id), erp.actor_name(), now());
end $$;

-- ---------- 권한 ----------
revoke all on function public.save_order(jsonb), public.ship_order(text, boolean, date), public.cancel_shipment(text, text) from public, anon;
grant execute on function public.save_order(jsonb), public.ship_order(text, boolean, date), public.cancel_shipment(text, text) to authenticated;
revoke all on function erp.post_stock(text, text, text, numeric, text, text, text, text, date, text, text),
                       erp.next_no(text, date, text, text), erp.assert_member(text), erp.actor_name() from public, anon, authenticated;
