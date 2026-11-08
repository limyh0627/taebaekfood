-- erp-core 저장소 supabase/oemflow.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 임가공 가공입고·가공비 (기존 앱과 같게, 2026-11-05). prodflow.sql 뒤에 돈다.
--
--  흐름: 임가공 발주 → 원료 보내기(send_oem, 재고 −, 입고대기) → 가공입고(완제품·벌크 재고 +, 송출·입고 차이 표시)
--        → 가공비 전표(매입, 계정 540)는 따로 발행(확인사항·발주 화면).
--  공장 조건: 거래처 × 품목마다 가공비·업체 부자재 단가(kg당·개당·박스당, 세금 포함, 과세/면세). 벌크는 품목 = 벌크 품목.
--  가공비 줄 = 품목별 (kg 또는 수량) × 단가. 조건이 없는 품목이 있으면 가공입고를 막는다(0원이면 0으로 넣는다).
--  중량: 규격·이름의 용량(1kg, 350ml, 1.8L, 1kg * 10)으로 어림한다. ml·L는 기름 밀도 0.916. 차이는 '추정, 손실 미확정'.

create table if not exists erp.oem_terms (
  id         text primary key,
  company_id text not null references erp.companies(id),
  partner_id text not null references erp.partners(id),
  item_id    text not null references erp.items(id),
  kind       text not null check (kind in ('processing', 'packaging')),
  unit       text not null check (unit in ('kg', 'piece', 'box')),
  price      numeric not null check (price >= 0),
  tax_exempt boolean not null default false,
  unique (partner_id, item_id, kind)
);
create table if not exists erp.oem_receipts (
  id          text primary key,
  company_id  text not null references erp.companies(id),
  po_id       text not null references erp.purchase_orders(id),
  received_on date not null,
  sent_kg     numeric,
  received_kg numeric,
  lines       jsonb not null,           -- [{item_id, name, qty, kg, bulk}]
  fee         jsonb not null,           -- [{name, qty, price, tax_exempt}]
  voucher_id  text references erp.vouchers(id),
  canceled_at timestamptz,
  created_by  text,
  created_at  timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['oem_terms', 'oem_receipts'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('revoke all on erp.%I from anon, authenticated', t);
    execute format('grant select on erp.%I to authenticated', t);
    execute format('drop policy if exists member_read on erp.%I', t);
    execute format('create policy member_read on erp.%I for select to authenticated using (company_id = any (app.my_company_ids()))', t);
  end loop;
end $$;

-- 품목 1단위의 kg (어림). 벌크·kg 품목은 1.
create or replace function erp.item_kg(p_item text) returns numeric language plpgsql stable set search_path = '' as $$
declare i erp.items; m text[]; v numeric; n numeric := 1; s text;
begin
  select * into i from erp.items where id = p_item;
  if i.id is null then return null; end if;
  if lower(coalesce(i.unit, '')) = 'kg' then return 1; end if;
  s := coalesce(nullif(i.spec, ''), i.name);
  m := regexp_match(s, '([0-9]+(?:\.[0-9]+)?)\s*(kg|g|ml|l|L|ℓ)', 'i');
  if m is null then return null; end if;
  v := m[1]::numeric * case lower(m[2]) when 'kg' then 1 when 'g' then 0.001 when 'ml' then 0.000916 else 0.916 end;
  m := regexp_match(s, '[*x×]\s*([0-9]+)');
  if m is not null then n := m[1]::numeric;
  else m := regexp_match(i.name, '\(([0-9]+)\)'); if m is not null and i.unit = '박스' then n := m[1]::numeric; end if;
  end if;
  return round(v * n, 3);
end $$;

create or replace function public.save_oem_term(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text;
begin
  perform erp.assert_member(v_company);
  if not exists (select 1 from erp.partners where id = p->>'partner_id' and company_id = v_company) then raise exception '임가공 공장을 고르세요.'; end if;
  if not exists (select 1 from erp.items where id = p->>'item_id' and company_id = v_company) then raise exception '품목을 고르세요.'; end if;
  if coalesce((p->>'price')::numeric, -1) < 0 then raise exception '단가를 넣으세요(없으면 0).'; end if;
  insert into erp.oem_terms (id, company_id, partner_id, item_id, kind, unit, price, tax_exempt)
  values ('oemt-' || gen_random_uuid(), v_company, p->>'partner_id', p->>'item_id', coalesce(p->>'kind', 'processing'), coalesce(p->>'unit', 'piece'),
          (p->>'price')::numeric, coalesce((p->>'tax_exempt')::boolean, false))
  on conflict (partner_id, item_id, kind) do update set unit = excluded.unit, price = excluded.price, tax_exempt = excluded.tax_exempt
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_oem_term(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.oem_terms where id = p_id;
  if v_company is null then raise exception '조건을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.oem_terms where id = p_id;
end $$;

-- 가공입고. p: {po_id, date, products: [{item_id, qty}], bulk: [{item_id, kg}], preview?: bool}
create or replace function public.oem_receive(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders; v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Seoul')::date);
        v_id text := 'oemr-' || gen_random_uuid(); v_lines jsonb := '[]'; v_fee jsonb := '[]'; v_missing text[] := '{}';
        v_sent numeric; v_recv numeric := 0; x record; t record; v_kg numeric; v_q numeric; n int := 0;
begin
  select * into po from erp.purchase_orders where id = p->>'po_id' for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if po.po_type <> 'oem' then raise exception '임가공 발주가 아닙니다.'; end if;
  if po.status = 'cancelled' then raise exception '취소된 발주입니다.'; end if;
  select coalesce(-sum(l.qty), 0) into v_sent from erp.stock_ledger l join erp.items i on i.id = l.item_id
  where l.source_type = 'oem' and l.source_id = po.id and l.reversal_of is null and lower(coalesce(i.unit, '')) = 'kg'
    and not exists (select 1 from erp.stock_ledger r where r.reversal_of = l.id);

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
    if not exists (select 1 from erp.oem_terms where partner_id = po.partner_id and item_id = x.id) then
      v_missing := v_missing || x.name;
    end if;
    for t in select * from erp.oem_terms where partner_id = po.partner_id and item_id = x.id order by kind desc loop
      v_q := case when t.unit = 'kg' then v_kg else x.q end;
      if t.price > 0 and v_q > 0 then
        v_fee := v_fee || jsonb_build_object('name', case when x.is_b then trim(regexp_replace(erp.base_name(x.name), '\s*벌크', '')) else x.name end || case when t.kind = 'processing' then case when x.is_b then ' 벌크 가공비' else ' 가공비' end else ' 업체 부자재' end,
                                             'qty', v_q, 'unit', case t.unit when 'kg' then 'kg' when 'box' then '박스' else '개' end,
                                             'price', t.price, 'tax_exempt', t.tax_exempt, 'item_id', x.id);
      end if;
    end loop;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception '돌아온 완제품이나 벌크를 넣으세요.'; end if;

  if coalesce((p->>'preview')::boolean, false) then
    return jsonb_build_object('sent_kg', v_sent, 'received_kg', v_recv, 'loss_kg', v_sent - v_recv, 'lines', v_lines, 'fee', v_fee,
      'fee_total', (select coalesce(sum((erp.line_amount((f->>'qty')::numeric, (f->>'price')::numeric, (f->>'tax_exempt')::boolean)).gross), 0) from jsonb_array_elements(v_fee) f),
      'missing', to_jsonb(v_missing));
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '공장 조건(가공비 단가)이 없는 품목이 있습니다: %. 구매 › 임가공의 공장 조건에서 넣으세요(없으면 0원).', array_to_string(v_missing, ', ');
  end if;
  for x in select e from jsonb_array_elements(v_lines) e loop
    n := n + 1;
    perform erp.post_stock(v_id || ':' || n, po.company_id, x.e->>'item_id', (x.e->>case when (x.e->>'bulk')::boolean then 'kg' else 'qty' end)::numeric,
                           '가공입고', 'oem_in', v_id, po.partner_id, v_date, po.po_no);
  end loop;
  insert into erp.oem_receipts (id, company_id, po_id, received_on, sent_kg, received_kg, lines, fee, created_by)
  values (v_id, po.company_id, po.id, v_date, v_sent, v_recv, v_lines, v_fee, erp.actor_name());
  update erp.purchase_orders set status = 'received', received_at = now() where id = po.id;
  return jsonb_build_object('id', v_id, 'sent_kg', v_sent, 'received_kg', v_recv, 'loss_kg', v_sent - v_recv, 'fee', v_fee);
end $$;

-- 가공비 전표(매입, 540). 확인사항이나 발주 화면에서.
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
  values (v_id, r.company_id, v_no, v_date, '매입', po.partner_id, po.partner_name, po.id,
          '외주가공비 (' || round(coalesce(r.sent_kg, 0), 1) || 'kg→' || round(coalesce(r.received_kg, 0), 1) || 'kg)', erp.actor_name(), now(), 'app');
  for f in select * from jsonb_array_elements(r.fee) loop
    n := n + 1;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, spec, qty, price, supply, tax, amount, account_code, tax_exempt, note)
    select v_id, n, 'item', f->>'item_id', f->>'name', f->>'unit', (f->>'qty')::numeric, (f->>'price')::numeric, a.supply, a.tax, a.gross, '540',
           (f->>'tax_exempt')::boolean, po.po_no
    from erp.line_amount((f->>'qty')::numeric, (f->>'price')::numeric, (f->>'tax_exempt')::boolean) a;
  end loop;
  update erp.vouchers v set supply = s.supply, tax = s.tax, amount = s.amount
  from (select sum(supply) supply, sum(tax) tax, sum(amount) amount from erp.voucher_lines where voucher_id = v_id) s where v.id = v_id;
  update erp.oem_receipts set voucher_id = v_id where id = r.id;
  update erp.purchase_orders set voucher_id = coalesce(voucher_id, v_id) where id = po.id;
  return jsonb_build_object('voucher_id', v_id, 'voucher_no', v_no);
end $$;

create or replace function public.cancel_oem_receive(p_receipt text) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.oem_receipts; l record;
begin
  select * into r from erp.oem_receipts where id = p_receipt for update;
  if not found then raise exception '가공입고 기록을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(r.company_id);
  if r.canceled_at is not null then raise exception '이미 취소했습니다.'; end if;
  if exists (select 1 from erp.vouchers where id = r.voucher_id and status = 'active') then raise exception '가공비 전표를 먼저 취소하세요.'; end if;
  for l in select * from erp.stock_ledger where source_type = 'oem_in' and source_id = r.id and reversal_of is null loop
    perform erp.post_stock('un' || l.id, l.company_id, l.item_id, -l.qty, '가공입고 취소', 'oem_in', r.id, l.partner_id,
                           (now() at time zone 'Asia/Seoul')::date, null, l.id);
  end loop;
  update erp.oem_receipts set canceled_at = now() where id = r.id;
  update erp.purchase_orders set status = 'invoiced'
  where id = r.po_id and not exists (select 1 from erp.oem_receipts where po_id = r.po_id and canceled_at is null);
end $$;

-- 가공비 전표를 안 낸 가공입고(확인사항)
create or replace view erp.oem_fee_pending as
select r.id, r.company_id, r.po_id, r.received_on, r.sent_kg, r.received_kg, r.fee, po.po_no, po.partner_id, coalesce(pt.name, po.partner_name) partner_name,
       (select sum((erp.line_amount((f->>'qty')::numeric, (f->>'price')::numeric, (f->>'tax_exempt')::boolean)).gross) from jsonb_array_elements(r.fee) f) amount
from erp.oem_receipts r join erp.purchase_orders po on po.id = r.po_id left join erp.partners pt on pt.id = po.partner_id
where r.canceled_at is null and jsonb_array_length(r.fee) > 0
  and not exists (select 1 from erp.vouchers v where v.id = r.voucher_id and v.status = 'active');
alter view erp.oem_fee_pending set (security_invoker = true);
grant select on erp.oem_fee_pending to authenticated;

revoke all on function public.save_oem_term(jsonb), public.delete_oem_term(text), public.oem_receive(jsonb), public.issue_oem_fee(text, date), public.cancel_oem_receive(text) from public, anon;
grant execute on function public.save_oem_term(jsonb), public.delete_oem_term(text), public.oem_receive(jsonb), public.issue_oem_fee(text, date), public.cancel_oem_receive(text) to authenticated;
revoke all on function erp.item_kg(text) from public, anon;
