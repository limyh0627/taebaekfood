-- erp-core 저장소 supabase/oemstock.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 임가공 정석 구조 (2026-11-09, 사장님 결정). oemflow.sql·more.sql 뒤에 돈다.
--
--  흐름: 임가공 발주(만들 제품·수량) → 원료 보내기(우리 창고 −, 공장 보관 +) → 가공입고(제품 +, 공장 보관에서 BOM만큼 −)
--        → 가공비 전표(가공비 540 외주가공비, 업체 부자재 505 부자재매입) → 덜 왔으면 더 받거나 잔량 마감.
--  공장 보관 재고(erp.oem_stock): 발주별이 아니라 공장별로 모인다 → 남은 원료는 다음 발주에 그대로 쓴다.
--   실제와 맞추기: 손실 확정(공장 보관 −) · 회수(공장 보관 −, 우리 창고 +).
--  업체 부자재: 계약 조건의 업체 부자재 줄에 '어떤 부자재인지(supplied_item_id)'를 적으면 그 공장 몫의 BOM 소모·보낼 양에서 뺀다.
--  낱개: 박스 품목(BOM에 완제품 낱개 한 가지 ×n)의 발주에 낱개로 받으면 낱개 품목으로 들어가고 발주 진행은 1/n 박스로 센다.

alter table erp.oem_terms add column if not exists supplied_item_id text references erp.items(id);
alter table erp.oem_receipts add column if not exists used jsonb;     -- [{item_id, name, unit, qty}] 공장 보관에서 뺀 것
alter table erp.oem_receipts add column if not exists po_add jsonb;   -- [{line_no, qty}] 발주 줄 진행에 더한 것(취소 때 뺀다)
alter table erp.purchase_orders add column if not exists closed_at timestamptz;
alter table erp.purchase_orders add column if not exists closed_note text;

create table if not exists erp.oem_stock (
  id             text primary key,
  company_id     text not null references erp.companies(id),
  partner_id     text not null references erp.partners(id),
  item_id        text not null references erp.items(id),
  qty            numeric not null,          -- + 공장에 들어감, − 공장에서 나감
  kind           text not null,             -- 보냄·보냄 취소·사용·사용 취소·손실·회수·정리 취소·이관 사용
  po_id          text references erp.purchase_orders(id),
  source_id      text,                      -- stock_ledger id(보냄) · oem_receipts id(사용) · 정리 묶음 id
  effective_date date not null,
  note           text,
  reversal_of    text,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index if not exists oem_stock_partner on erp.oem_stock (partner_id, item_id);
alter table erp.oem_stock enable row level security;
revoke all on erp.oem_stock from anon, authenticated;
grant select on erp.oem_stock to authenticated;
drop policy if exists member_read on erp.oem_stock;
create policy member_read on erp.oem_stock for select to authenticated using (company_id = any (app.my_company_ids()));

create or replace view erp.oem_stock_balances as
select s.company_id, s.partner_id, s.item_id, round(sum(s.qty), 3) qty, max(s.effective_date) last_move
from erp.oem_stock s group by s.company_id, s.partner_id, s.item_id;
alter view erp.oem_stock_balances set (security_invoker = true);
grant select on erp.oem_stock_balances to authenticated;

-- 처음 한 번: 지금까지 보낸 원료를 공장 보관으로 옮겨 담는다. 이미 가공입고한 발주는 보낸 것을 다 쓴 것으로 본다.
do $$ begin
  if not exists (select 1 from erp.oem_stock) then
    insert into erp.oem_stock (id, company_id, partner_id, item_id, qty, kind, po_id, source_id, effective_date, note, reversal_of)
    select 'mig:' || l.id, l.company_id, po.partner_id, l.item_id, -l.qty,
           case when l.reversal_of is null then '보냄' else '보냄 취소' end, po.id, l.id, coalesce(l.effective_date, po.created_at::date), po.po_no,
           case when l.reversal_of is not null then 'mig:' || l.reversal_of end
    from erp.stock_ledger l join erp.purchase_orders po on po.id = l.source_id
    where l.source_type = 'oem' and po.partner_id is not null
    on conflict (id) do nothing;
    insert into erp.oem_stock (id, company_id, partner_id, item_id, qty, kind, po_id, source_id, effective_date, note)
    select 'mig-use:' || s.po_id || ':' || s.item_id, s.company_id, s.partner_id, s.item_id, -sum(s.qty), '이관 사용', s.po_id, null,
           max(s.effective_date), '가공입고한 옛 발주: 보낸 원료를 다 쓴 것으로'
    from erp.oem_stock s
    where exists (select 1 from erp.oem_receipts r where r.po_id = s.po_id and r.canceled_at is null)
       or exists (select 1 from erp.purchase_orders p where p.id = s.po_id and p.status = 'received')
    group by s.company_id, s.partner_id, s.po_id, s.item_id
    having abs(sum(s.qty)) > 0.0005
    on conflict (id) do nothing;
  end if;
end $$;

-- 이 공장이 대는 부자재(우리가 안 보냄)
create or replace function erp.oem_supplied(p_partner text) returns setof text language sql stable set search_path = '' as $$
  select supplied_item_id from erp.oem_terms where partner_id = p_partner and kind = 'packaging' and supplied_item_id is not null
$$;

-- BOM을 끝까지 편다: p_item p_qty개(벌크는 kg)를 만들 때 공장이 쓰는 것(우리가 보내는 원료·부자재). 결과는 pg_temp._oemuse.
-- 완제품·반제품(벌크 아님)·phantom은 BOM이 있으면 더 편다. 원료·벌크·부자재는 그대로 쓴다. 공장이 대는 부자재는 뺀다.
create or replace function erp.oem_explode(p_partner text, p_item text, p_qty numeric, p_depth int default 0) returns void
language plpgsql set search_path = '' as $$
declare b record; c erp.items; v_need numeric;
begin
  if p_qty = 0 then return; end if;
  if p_depth > 5 then raise exception 'BOM이 너무 깊거나 돌고 있습니다: %', (select name from erp.items where id = p_item); end if;
  for b in select * from erp.item_boms where parent_item_id = p_item loop
    select * into c from erp.items where id = b.child_item_id;
    if c.id is null or c.id in (select erp.oem_supplied(p_partner)) then continue; end if;
    v_need := p_qty * b.quantity;
    if exists (select 1 from erp.item_boms where parent_item_id = c.id)
       and (c.phantom or (c.type in ('FINISHED', 'WIP') and not coalesce(c.is_bulk, false))) then
      perform erp.oem_explode(p_partner, c.id, v_need, p_depth + 1);
    else
      insert into pg_temp._oemuse (item_id, qty) values (c.id, v_need);
    end if;
  end loop;
end $$;

-- 박스 품목이면 그 낱개 품목과 박스당 개수(erp.box_component, stockflow.sql)
create or replace function erp.oem_box_of(p_line_item text, p_item text) returns numeric language sql stable set search_path = '' as $$
  select b.per from erp.box_component(p_line_item) b where b.child_id = p_item
$$;

-- ---------- 원료 보내기 ----------
create or replace function public.send_oem(p_po text, p_lines jsonb, p_date date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders; x jsonb; n int := 0; v_date date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date); v_id text;
begin
  select * into po from erp.purchase_orders where id = p_po for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if po.po_type <> 'oem' then raise exception '임가공 발주가 아닙니다.'; end if;
  if po.status in ('cancelled', 'received') then raise exception '끝났거나 취소된 발주입니다.'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    if coalesce((x->>'qty')::numeric, 0) <= 0 then continue; end if;
    if not exists (select 1 from erp.items where id = x->>'item_id' and company_id = po.company_id) then raise exception '품목을 찾을 수 없습니다.'; end if;
    n := n + 1;
    v_id := 'oem:' || po.id || ':' || gen_random_uuid();
    perform erp.post_stock(v_id, po.company_id, x->>'item_id', -(x->>'qty')::numeric, '임가공 출고', 'oem', po.id, po.partner_id, v_date, po.po_no);
    insert into erp.oem_stock (id, company_id, partner_id, item_id, qty, kind, po_id, source_id, effective_date, note, created_by)
    values (v_id, po.company_id, po.partner_id, x->>'item_id', (x->>'qty')::numeric, '보냄', po.id, v_id, v_date, po.po_no, erp.actor_name());
  end loop;
  if n = 0 then raise exception '보낼 수량을 넣으세요.'; end if;
  update erp.purchase_orders set status = 'invoiced', invoiced_at = now() where id = po.id and status = 'pending';
  return n;
end $$;

create or replace function public.cancel_oem_send(p_ledger_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.stock_ledger; s erp.oem_stock; v_bal numeric;
begin
  select * into r from erp.stock_ledger where id = p_ledger_id;
  if not found or r.source_type <> 'oem' or r.kind <> '임가공 출고' then raise exception '임가공 출고 줄이 아닙니다.'; end if;
  perform erp.assert_member(r.company_id);
  if exists (select 1 from erp.stock_ledger where reversal_of = r.id) then raise exception '이미 취소했습니다.'; end if;
  select * into s from erp.oem_stock where id in (r.id, 'mig:' || r.id) and reversal_of is null limit 1;
  if s.id is not null then
    select coalesce(sum(qty), 0) into v_bal from erp.oem_stock where partner_id = s.partner_id and item_id = s.item_id;
    if v_bal < s.qty - 0.0005 then
      raise exception '공장에 남은 양(%)보다 많아 되돌릴 수 없습니다. 이미 가공에 쓴 원료입니다. 남은 것은 임가공 › 공장 재고 정리에서 회수하세요.', round(v_bal, 3);
    end if;
  end if;
  perform erp.post_stock('unoem:' || r.id, r.company_id, r.item_id, -r.qty, '임가공 출고 취소', 'oem', r.source_id, r.partner_id,
                         (now() at time zone 'Asia/Seoul')::date, r.note, r.id);
  if s.id is not null then
    insert into erp.oem_stock (id, company_id, partner_id, item_id, qty, kind, po_id, source_id, effective_date, note, reversal_of, created_by)
    values ('un' || s.id, s.company_id, s.partner_id, s.item_id, -s.qty, '보냄 취소', s.po_id, 'unoem:' || r.id,
            (now() at time zone 'Asia/Seoul')::date, s.note, s.id, erp.actor_name());
  end if;
end $$;

-- 보낼 원료 계산: 발주에서 아직 안 받은 몫 × BOM − 공장에 남은 것. 업체가 대는 부자재는 빠진다.
create or replace function public.oem_need(p_po text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders; l record; v_nobom text[] := '{}';
begin
  select * into po from erp.purchase_orders where id = p_po;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  create temp table if not exists _oemuse (item_id text, qty numeric) on commit drop;
  truncate _oemuse;
  for l in select * from erp.purchase_order_lines where po_id = po.id and item_id is not null and qty > received_qty loop
    if not exists (select 1 from erp.item_boms where parent_item_id = l.item_id) then v_nobom := v_nobom || l.name; continue; end if;
    perform erp.oem_explode(po.partner_id, l.item_id, l.qty - l.received_qty);
  end loop;
  return jsonb_build_object('no_bom', to_jsonb(v_nobom), 'lines', coalesce((
    select jsonb_agg(jsonb_build_object('item_id', u.item_id, 'name', i.name, 'unit', i.unit, 'need', round(u.qty, 3),
             'at_factory', round(coalesce(f.qty, 0), 3), 'have', round(coalesce(sb.qty, 0), 3),
             'send', greatest(round(u.qty - greatest(coalesce(f.qty, 0), 0), 3), 0)) order by i.type, i.name)
    from (select item_id, sum(qty) qty from _oemuse group by item_id) u
    join erp.items i on i.id = u.item_id
    left join erp.oem_stock_balances f on f.partner_id = po.partner_id and f.item_id = u.item_id
    left join erp.stock_balances sb on sb.item_id = u.item_id), '[]'::jsonb));
end $$;

-- ---------- 가공입고 ----------
-- p: {po_id, date, products: [{item_id, qty}], bulk: [{item_id, kg}], used?: [{item_id, qty}], preview?: bool}
--  products에 박스 품목의 낱개를 넣으면 낱개 품목으로 받고, 발주 진행은 박스 1/n로 센다.
--  used를 주면 그대로 공장 보관에서 뺀다(화면에서 BOM 계산을 고친 것). 안 주면 BOM으로 센다.
create or replace function public.oem_receive(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders; v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Seoul')::date);
        v_id text := 'oemr-' || gen_random_uuid(); v_lines jsonb := '[]'; v_fee jsonb := '[]'; v_missing text[] := '{}'; v_nobom text[] := '{}';
        v_add jsonb := '[]'; v_used jsonb; v_extra text[] := '{}';
        v_used_kg numeric := 0; v_recv numeric := 0; x record; t record; v_kg numeric; v_q numeric; n int := 0;
        v_line erp.purchase_order_lines; v_per numeric; v_term_item text; v_factor numeric;
begin
  select * into po from erp.purchase_orders where id = p->>'po_id' for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if po.po_type <> 'oem' then raise exception '임가공 발주가 아닙니다.'; end if;
  if po.status = 'cancelled' then raise exception '취소된 발주입니다.'; end if;
  if po.status = 'received' then raise exception '끝난(다 받았거나 잔량 마감한) 발주입니다. 더 받으려면 발주에서 마감을 푸세요.'; end if;
  create temp table if not exists _oemuse (item_id text, qty numeric) on commit drop;
  truncate _oemuse;

  for x in select i.*, (e->>'qty')::numeric q, false is_b from jsonb_array_elements(coalesce(p->'products', '[]')) e join erp.items i on i.id = e->>'item_id'
           where coalesce((e->>'qty')::numeric, 0) > 0
           union all
           select i.*, (e->>'kg')::numeric, true from jsonb_array_elements(coalesce(p->'bulk', '[]')) e join erp.items i on i.id = e->>'item_id'
           where coalesce((e->>'kg')::numeric, 0) > 0 loop
    if x.company_id <> po.company_id then raise exception '다른 회사 품목입니다.'; end if;
    if x.is_b and not erp.lot_tracked(x.id) then raise exception '벌크로 받는 품목은 원료·벌크 품목이어야 합니다: %', x.name; end if;
    v_kg := case when x.is_b then x.q else round(x.q * coalesce(erp.item_kg(x.id), 0), 3) end;
    v_recv := v_recv + v_kg;
    v_lines := v_lines || jsonb_build_object('item_id', x.id, 'name', x.name, 'qty', x.q, 'kg', v_kg, 'unit', x.unit, 'bulk', x.is_b);
    -- 발주 줄 진행: 같은 품목 줄 → 아니면 이 품목을 낱개로 품은 박스 줄(1/n)
    v_line := null; v_per := null;
    select * into v_line from erp.purchase_order_lines where po_id = po.id and item_id = x.id order by (qty > received_qty) desc, line_no limit 1;
    if v_line.po_id is null then
      select l.* into v_line from erp.purchase_order_lines l
      where l.po_id = po.id and erp.oem_box_of(l.item_id, x.id) is not null order by l.line_no limit 1;
      if v_line.po_id is not null then v_per := erp.oem_box_of(v_line.item_id, x.id); end if;
    end if;
    if v_line.po_id is not null then
      v_add := v_add || jsonb_build_object('line_no', v_line.line_no, 'qty', round(x.q / coalesce(v_per, 1), 4));
    else
      v_extra := v_extra || x.name;
    end if;
    -- 공장 보관에서 뺄 것(BOM)
    if not exists (select 1 from erp.item_boms where parent_item_id = x.id) then v_nobom := v_nobom || x.name;
    else perform erp.oem_explode(po.partner_id, x.id, x.q); end if;
    -- 가공비: 이 품목 계약 조건 → 없으면 박스 줄의 조건을 낱개로 나눠서
    v_term_item := x.id; v_factor := 1;
    if not exists (select 1 from erp.oem_terms where partner_id = po.partner_id and item_id = x.id) and v_per is not null
       and exists (select 1 from erp.oem_terms where partner_id = po.partner_id and item_id = v_line.item_id) then
      v_term_item := v_line.item_id; v_factor := 1 / v_per;
    end if;
    if not exists (select 1 from erp.oem_terms where partner_id = po.partner_id and item_id = v_term_item) then
      v_missing := v_missing || x.name;
    end if;
    for t in select * from erp.oem_terms where partner_id = po.partner_id and item_id = v_term_item order by kind desc loop
      v_q := case when t.unit = 'kg' then v_kg else x.q * v_factor end;
      if t.price > 0 and v_q > 0 then
        v_fee := v_fee || jsonb_build_object(
          'name', case when x.is_b then trim(regexp_replace(erp.base_name(x.name), '\s*벌크', '')) else x.name end
                  || case when t.kind = 'processing' then case when x.is_b then ' 벌크 가공비' else ' 가공비' end else ' 업체 부자재' end,
          'qty', round(v_q, 4), 'unit', case t.unit when 'kg' then 'kg' when 'box' then '박스' else '개' end,
          'price', t.price, 'tax_exempt', t.tax_exempt, 'item_id', x.id, 'kind', t.kind,
          'account', case when t.kind = 'packaging' then '505' else '540' end);
      end if;
    end loop;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception '돌아온 완제품이나 벌크를 넣으세요.'; end if;

  -- 쓴 원료: 화면에서 고친 것이 있으면 그것, 없으면 BOM 계산
  if jsonb_typeof(p->'used') = 'array' then
    truncate _oemuse;
    insert into _oemuse select e->>'item_id', (e->>'qty')::numeric from jsonb_array_elements(p->'used') e
    where coalesce(e->>'item_id', '') <> '' and coalesce((e->>'qty')::numeric, 0) <> 0;
    v_nobom := '{}';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', u.item_id, 'name', i.name, 'unit', i.unit, 'qty', round(u.qty, 3),
           'at_factory', round(coalesce(f.qty, 0), 3), 'short', greatest(round(u.qty - coalesce(f.qty, 0), 3), 0)) order by i.type, i.name), '[]'::jsonb),
         coalesce(sum(case when lower(coalesce(i.unit, '')) = 'kg' then u.qty else u.qty * coalesce(erp.item_kg(i.id), 0) end), 0)
    into v_used, v_used_kg
  from (select item_id, sum(qty) qty from _oemuse group by item_id) u
  join erp.items i on i.id = u.item_id
  left join erp.oem_stock_balances f on f.partner_id = po.partner_id and f.item_id = u.item_id;

  if coalesce((p->>'preview')::boolean, false) then
    return jsonb_build_object('sent_kg', round(v_used_kg, 3), 'received_kg', v_recv, 'loss_kg', round(v_used_kg - v_recv, 3), 'lines', v_lines, 'fee', v_fee,
      'fee_total', (select coalesce(sum((erp.line_amount((f->>'qty')::numeric, (f->>'price')::numeric, (f->>'tax_exempt')::boolean)).gross), 0) from jsonb_array_elements(v_fee) f),
      'missing', to_jsonb(v_missing), 'no_bom', to_jsonb(v_nobom), 'extra', to_jsonb(v_extra), 'used', v_used,
      'progress', (select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'name', l.name, 'unit', l.unit, 'qty', l.qty, 'before', l.received_qty,
                     'now', coalesce(a.q, 0), 'after', l.received_qty + coalesce(a.q, 0)) order by l.line_no), '[]'::jsonb)
                   from erp.purchase_order_lines l
                   left join (select (e->>'line_no')::int ln, sum((e->>'qty')::numeric) q from jsonb_array_elements(v_add) e group by 1) a on a.ln = l.line_no
                   where l.po_id = po.id));
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '계약 조건(가공비 단가)이 없는 품목이 있습니다: %. 구매 › 임가공의 계약 조건에서 넣으세요(없으면 0원).', array_to_string(v_missing, ', ');
  end if;
  for x in select e from jsonb_array_elements(v_lines) e loop
    n := n + 1;
    perform erp.post_stock(v_id || ':' || n, po.company_id, x.e->>'item_id', (x.e->>case when (x.e->>'bulk')::boolean then 'kg' else 'qty' end)::numeric,
                           '가공입고', 'oem_in', v_id, po.partner_id, v_date, po.po_no);
  end loop;
  n := 0;
  for x in select e from jsonb_array_elements(v_used) e loop
    n := n + 1;
    insert into erp.oem_stock (id, company_id, partner_id, item_id, qty, kind, po_id, source_id, effective_date, note, created_by)
    values (v_id || ':u' || n, po.company_id, po.partner_id, x.e->>'item_id', -(x.e->>'qty')::numeric, '사용', po.id, v_id, v_date, po.po_no, erp.actor_name());
  end loop;
  for x in select (e->>'line_no')::int ln, sum((e->>'qty')::numeric) q from jsonb_array_elements(v_add) e group by 1 loop
    update erp.purchase_order_lines set received_qty = received_qty + x.q where po_id = po.id and line_no = x.ln;
  end loop;
  insert into erp.oem_receipts (id, company_id, po_id, received_on, sent_kg, received_kg, lines, fee, used, po_add, created_by)
  values (v_id, po.company_id, po.id, v_date, round(v_used_kg, 3), v_recv, v_lines, v_fee, v_used, v_add, erp.actor_name());
  update erp.purchase_orders set received_at = now(),
    status = case when exists (select 1 from erp.purchase_order_lines where po_id = po.id and item_id is not null and received_qty < qty - 0.0005) then 'partial' else 'received' end
  where id = po.id;
  return jsonb_build_object('id', v_id, 'sent_kg', v_used_kg, 'received_kg', v_recv, 'fee', v_fee);
end $$;

create or replace function public.cancel_oem_receive(p_receipt text) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.oem_receipts; l record; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into r from erp.oem_receipts where id = p_receipt for update;
  if not found then raise exception '가공입고 기록을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(r.company_id);
  if r.canceled_at is not null then raise exception '이미 취소했습니다.'; end if;
  if exists (select 1 from erp.vouchers where id = r.voucher_id and status = 'active') then raise exception '가공비 전표를 먼저 취소하세요.'; end if;
  perform 1 from erp.purchase_orders where id = r.po_id for update;
  for l in select * from erp.stock_ledger where source_type = 'oem_in' and source_id = r.id and reversal_of is null loop
    perform erp.post_stock('un' || l.id, l.company_id, l.item_id, -l.qty, '가공입고 취소', 'oem_in', r.id, l.partner_id, v_today, null, l.id);
  end loop;
  insert into erp.oem_stock (id, company_id, partner_id, item_id, qty, kind, po_id, source_id, effective_date, note, reversal_of, created_by)
  select 'un' || s.id, s.company_id, s.partner_id, s.item_id, -s.qty, '사용 취소', s.po_id, r.id, v_today, s.note, s.id, erp.actor_name()
  from erp.oem_stock s where s.source_id = r.id and s.kind = '사용';
  for l in select (e->>'line_no')::int ln, sum((e->>'qty')::numeric) q from jsonb_array_elements(coalesce(r.po_add, '[]')) e group by 1 loop
    update erp.purchase_order_lines set received_qty = received_qty - l.q where po_id = r.po_id and line_no = l.ln;
  end loop;
  update erp.oem_receipts set canceled_at = now() where id = r.id;
  update erp.purchase_orders p set closed_at = null, closed_note = null,
    status = case when not exists (select 1 from erp.oem_receipts where po_id = p.id and canceled_at is null) then 'invoiced'
                  when exists (select 1 from erp.purchase_order_lines where po_id = p.id and item_id is not null and received_qty < qty - 0.0005) then 'partial'
                  else 'received' end
  where p.id = r.po_id;
end $$;

-- 가공비 전표: 줄마다 계정(가공비 540 외주가공비, 업체 부자재 505 부자재매입). 옛 기록은 이름으로 가린다.
create or replace function public.issue_oem_fee(p_receipt text, p_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r erp.oem_receipts; po erp.purchase_orders; v_id text := 'v-' || gen_random_uuid(); v_no text; n int := 0; f jsonb;
        v_date date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date);
begin
  select * into r from erp.oem_receipts where id = p_receipt for update;
  if not found then raise exception '가공입고 기록을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(r.company_id);
  if r.canceled_at is not null then raise exception '취소된 가공입고입니다.'; end if;
  if exists (select 1 from erp.vouchers where id = r.voucher_id and status = 'active') then raise exception '이미 가공비 전표를 냈습니다.'; end if;
  if jsonb_array_length(r.fee) = 0 then raise exception '가공비가 0원이라 전표가 필요 없습니다.'; end if;
  select * into po from erp.purchase_orders where id = r.po_id;
  v_no := erp.next_no(r.company_id, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, po_id, memo, created_by, created_at, legacy_collection)
  values (v_id, r.company_id, v_no, v_date, '매입', po.partner_id, po.partner_name, po.id, '외주가공비 ' || coalesce(po.po_no, ''), erp.actor_name(), now(), 'app');
  for f in select * from jsonb_array_elements(r.fee) loop
    n := n + 1;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, spec, qty, price, supply, tax, amount, account_code, tax_exempt, note)
    select v_id, n, 'item', f->>'item_id', f->>'name', f->>'unit', (f->>'qty')::numeric, (f->>'price')::numeric, a.supply, a.tax, a.gross,
           coalesce(f->>'account', case when f->>'name' like '% 업체 부자재' then '505' else '540' end),
           (f->>'tax_exempt')::boolean, po.po_no
    from erp.line_amount((f->>'qty')::numeric, (f->>'price')::numeric, (f->>'tax_exempt')::boolean) a;
  end loop;
  update erp.vouchers v set supply = s.supply, tax = s.tax, amount = s.amount
  from (select sum(supply) supply, sum(tax) tax, sum(amount) amount from erp.voucher_lines where voucher_id = v_id) s where v.id = v_id;
  update erp.oem_receipts set voucher_id = v_id where id = r.id;
  update erp.purchase_orders set voucher_id = coalesce(voucher_id, v_id) where id = po.id;
  return jsonb_build_object('voucher_id', v_id, 'voucher_no', v_no);
end $$;

-- ---------- 잔량 마감(일반·임가공 발주 공통) ----------
create or replace function public.close_purchase_order(p_po_id text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders;
begin
  select * into po from erp.purchase_orders where id = p_po_id for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if po.status not in ('invoiced', 'partial') then raise exception '입고 대기·일부 입고인 발주만 마감합니다.'; end if;
  if not exists (select 1 from erp.purchase_order_lines where po_id = po.id and received_qty > 0) then
    raise exception '하나도 안 받은 발주는 마감 대신 발주 취소를 하세요.';
  end if;
  update erp.purchase_orders set status = 'received', closed_at = now(), closed_note = nullif(trim(coalesce(p_note, '')), '') where id = po.id;
end $$;

create or replace function public.reopen_purchase_order(p_po_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders;
begin
  select * into po from erp.purchase_orders where id = p_po_id for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if po.closed_at is null then raise exception '마감한 발주가 아닙니다.'; end if;
  update erp.purchase_orders set status = 'partial', closed_at = null, closed_note = null where id = po.id;
end $$;

-- ---------- 공장 재고 정리 ----------
-- p: {company_id, partner_id, date, note, lines: [{item_id, kind: '손실'|'회수', qty}]}
--  손실: 공장 보관 −(실제가 장부보다 많으면 음수로 넣어 늘린다). 회수: 공장 보관 −, 우리 창고 +.
create or replace function public.oem_adjust(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_partner text := p->>'partner_id'; v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Seoul')::date);
        v_batch text := 'oemadj-' || gen_random_uuid(); x jsonb; n int := 0; v_id text; v_q numeric;
begin
  perform erp.assert_member(v_company);
  if not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then raise exception '공장을 찾을 수 없습니다.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    v_q := coalesce((x->>'qty')::numeric, 0);
    if v_q = 0 then continue; end if;
    if x->>'kind' not in ('손실', '회수') then raise exception '정리는 손실·회수입니다.'; end if;
    if x->>'kind' = '회수' and v_q < 0 then raise exception '회수 수량은 0보다 커야 합니다.'; end if;
    if not exists (select 1 from erp.items where id = x->>'item_id' and company_id = v_company) then raise exception '품목을 찾을 수 없습니다.'; end if;
    n := n + 1; v_id := v_batch || ':' || n;
    insert into erp.oem_stock (id, company_id, partner_id, item_id, qty, kind, source_id, effective_date, note, created_by)
    values (v_id, v_company, v_partner, x->>'item_id', -v_q, x->>'kind', v_batch, v_date, nullif(trim(coalesce(p->>'note', '')), ''), erp.actor_name());
    if x->>'kind' = '회수' then
      perform erp.post_stock(v_id, v_company, x->>'item_id', v_q, '임가공 회수', 'oem_back', v_batch, v_partner, v_date, nullif(trim(coalesce(p->>'note', '')), ''));
    end if;
  end loop;
  if n = 0 then raise exception '정리할 수량을 넣으세요.'; end if;
  return n;
end $$;

create or replace function public.cancel_oem_adjust(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare s erp.oem_stock; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into s from erp.oem_stock where id = p_id;
  if not found or s.kind not in ('손실', '회수') then raise exception '손실·회수 줄만 취소합니다.'; end if;
  perform erp.assert_member(s.company_id);
  if exists (select 1 from erp.oem_stock where reversal_of = s.id) then raise exception '이미 취소했습니다.'; end if;
  insert into erp.oem_stock (id, company_id, partner_id, item_id, qty, kind, source_id, effective_date, note, reversal_of, created_by)
  values ('un' || s.id, s.company_id, s.partner_id, s.item_id, -s.qty, '정리 취소', s.source_id, v_today, s.note, s.id, erp.actor_name());
  if s.kind = '회수' then
    perform erp.post_stock('un' || s.id, s.company_id, s.item_id, s.qty, '임가공 회수 취소', 'oem_back', s.source_id, s.partner_id, v_today, null, s.id);
  end if;
end $$;

-- 계약 조건 저장: 업체 부자재 줄은 어떤 부자재인지(supplied_item_id) 고를 수 있다.
create or replace function public.set_oem_term_supplied(p_id text, p_item text) returns void
language plpgsql security definer set search_path = '' as $$
declare t erp.oem_terms;
begin
  select * into t from erp.oem_terms where id = p_id;
  if not found then raise exception '계약 조건을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(t.company_id);
  if t.kind <> 'packaging' then raise exception '업체 부자재 줄에만 부자재를 고릅니다.'; end if;
  if p_item is not null and not exists (select 1 from erp.items where id = p_item and company_id = t.company_id) then raise exception '품목을 찾을 수 없습니다.'; end if;
  update erp.oem_terms set supplied_item_id = nullif(p_item, '') where id = t.id;
end $$;

revoke all on function public.send_oem(text, jsonb, date), public.cancel_oem_send(text), public.oem_need(text), public.oem_receive(jsonb),
  public.cancel_oem_receive(text), public.issue_oem_fee(text, date), public.close_purchase_order(text, text), public.reopen_purchase_order(text),
  public.oem_adjust(jsonb), public.cancel_oem_adjust(text), public.set_oem_term_supplied(text, text) from public, anon;
grant execute on function public.send_oem(text, jsonb, date), public.cancel_oem_send(text), public.oem_need(text), public.oem_receive(jsonb),
  public.cancel_oem_receive(text), public.issue_oem_fee(text, date), public.close_purchase_order(text, text), public.reopen_purchase_order(text),
  public.oem_adjust(jsonb), public.cancel_oem_adjust(text), public.set_oem_term_supplied(text, text) to authenticated;
revoke all on function erp.oem_supplied(text), erp.oem_explode(text, text, numeric, int), erp.oem_box_of(text, text) from public, anon, authenticated;
