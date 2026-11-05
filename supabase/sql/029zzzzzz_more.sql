-- erp-core 저장소 supabase/more.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 2·3순위 기능: 품목 합치기, 원가·손익, 거래처 정산서, 견적서, 정기 전표, 차입금, 임가공, 파렛트, 직원·휴가, 품질, 업무, 데이터 점검.
-- setup.sql 뒤에 돈다. 새 표는 만들지 않고(이관된 표를 쓴다) 열·뷰·함수만 더한다.

-- =====================================================================
-- 품목 합치기: drop을 keep으로. 품목을 가리키는 모든 열을 옮기고 재고를 더한 뒤 drop은 '안 씀'.
-- =====================================================================
create or replace function public.merge_items(p_keep text, p_drop text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k erp.items; d erp.items; r record; n int; moved jsonb := '{}';
begin
  select * into k from erp.items where id = p_keep for update;
  select * into d from erp.items where id = p_drop for update;
  if k.id is null or d.id is null then raise exception '품목을 찾을 수 없습니다.'; end if;
  if k.id = d.id then raise exception '같은 품목입니다.'; end if;
  if k.company_id <> d.company_id then raise exception '다른 회사 품목은 합칠 수 없습니다.'; end if;
  perform erp.assert_admin(k.company_id);
  if coalesce(k.unit, '') <> coalesce(d.unit, '') then
    raise exception '재고 단위가 다릅니다(% / %). 단위를 먼저 맞추세요.', coalesce(k.unit, '없음'), coalesce(d.unit, '없음');
  end if;

  -- 품목을 가리키는 외래키 열 전부 (stock_balances는 따로)
  for r in
    select cl.relname as tbl, a.attname as col
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'erp.items'::regclass and ns.nspname = 'erp' and cl.relname <> 'stock_balances'
  loop
    execute format('update erp.%I set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_drop;
    get diagnostics n = row_count;
    if n > 0 then moved := moved || jsonb_build_object(r.tbl || '.' || r.col, n); end if;
  end loop;
  -- BOM: 자기 자신을 가리키게 된 줄은 뺀다
  delete from erp.item_boms where parent_item_id = child_item_id;
  -- 배합(이름으로 묶임)
  update erp.item_formulas set child_name = k.name where company_id = k.company_id and child_name = d.name;
  update erp.item_formulas set parent_key = k.name where company_id = k.company_id and parent_key = d.name;
  -- 재고 잔고 더하기
  insert into erp.stock_balances (item_id, company_id, qty, unit)
  select p_keep, k.company_id, coalesce((select qty from erp.stock_balances where item_id = p_drop), 0), k.unit
  on conflict (item_id) do update set qty = erp.stock_balances.qty + excluded.qty, updated_at = now();
  delete from erp.stock_balances where item_id = p_drop;
  update erp.items set archived = true, name = left(d.name || ' (합침→' || k.name || ')', 200) where id = p_drop;
  return moved;
end $$;

-- =====================================================================
-- 원가: 원료는 마지막 매입 단가(공급가/수량), 제품은 BOM(배합 반제품은 배합 비율로 편다)
-- =====================================================================
create or replace function public.item_cost_estimate(p_company text)
returns table (item_id text, name text, type text, unit text, cost numeric, last_buy numeric, last_buy_date date, computed numeric, missing text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare pass int;
begin
  perform erp.assert_member(p_company);
  create temp table if not exists _cost (id text primary key, name text, type text, unit text, phantom boolean, cost numeric, last_buy numeric,
                                         last_date date, computed numeric, missing text) on commit drop;
  truncate _cost;
  insert into _cost
  select i.id, i.name, i.type, i.unit, i.phantom, i.cost, b.unit_cost, b.date, null, null
  from erp.items i
  left join lateral (
    select l.supply / nullif(l.qty, 0) as unit_cost, v.date
    from erp.voucher_lines l join erp.vouchers v on v.id = l.voucher_id
    where l.item_id = i.id and v.kind = '매입' and v.status = 'active' and v.return_of is null and coalesce(l.qty, 0) > 0
    order by v.date desc, v.id desc limit 1) b on true
  where i.company_id = p_company and not i.archived;

  -- 사서 쓰는 것: 마지막 매입가, 없으면 적힌 원가
  update _cost set computed = coalesce(last_buy, cost) where type in ('RAW', 'SUB', 'GOODS', 'PALLET', 'OTHER');
  -- BOM도 배합도 없는 제품·반제품은 적힌 원가
  update _cost c set computed = c.cost
  where c.type in ('FINISHED', 'WIP') and not exists (select 1 from erp.item_boms b where b.parent_item_id = c.id)
    and not (c.phantom and exists (select 1 from erp.item_formulas f where f.company_id = p_company and f.parent_key = c.name));

  for pass in 1..8 loop
    -- 배합 반제품(이름 키): Σ 원료 원가 × 비율 / 수율
    update _cost c set computed = f.v, missing = f.miss
    from (select c2.id, sum(ch.computed * fo.ratio / coalesce(nullif(fo.yield_rate, 0), 1)) as v,
                 string_agg(case when ch.computed is null then fo.child_name end, ', ') as miss
          from _cost c2
          join erp.item_formulas fo on fo.company_id = p_company and fo.parent_key = c2.name
          left join _cost ch on ch.name = fo.child_name
          where c2.phantom group by c2.id) f
    where c.id = f.id and (c.computed, c.missing) is distinct from (f.v, f.miss);
    -- BOM 품목: Σ 구성품 원가 × 수량
    update _cost c set computed = b.v, missing = b.miss
    from (select bo.parent_item_id as id, sum(ch.computed * bo.quantity) as v,
                 string_agg(case when ch.computed is null then ch.name end, ', ') as miss
          from erp.item_boms bo join _cost ch on ch.id = bo.child_item_id
          where bo.company_id = p_company group by bo.parent_item_id) b
    where c.id = b.id and c.type in ('FINISHED', 'WIP') and (c.computed, c.missing) is distinct from (b.v, b.miss);
  end loop;

  return query select c.id, c.name, c.type, c.unit, c.cost, round(c.last_buy, 2), c.last_date, round(c.computed, 2), c.missing
               from _cost c order by c.type, c.name;
end $$;

-- 계산한 원가를 품목에 적고 이력을 남긴다. p_items: [{item_id, cost}]
create or replace function public.apply_item_costs(p_company text, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform erp.assert_admin(p_company);
  insert into erp.item_cost_history (id, company_id, item_id, before_cost, after_cost, effective_date, actor, recorded_at)
  select 'cost-' || gen_random_uuid(), p_company, i.id, i.cost, (x->>'cost')::numeric, current_date, erp.actor_name(), now()
  from jsonb_array_elements(p_items) x join erp.items i on i.id = x->>'item_id' and i.company_id = p_company
  where i.cost is distinct from (x->>'cost')::numeric;
  get diagnostics n = row_count;
  update erp.items i set cost = (x->>'cost')::numeric
  from jsonb_array_elements(p_items) x where i.id = x->>'item_id' and i.company_id = p_company;
  return n;
end $$;

-- =====================================================================
-- 손익(관리용): 분개에서 계정별로 모으고, 매출원가는 팔린 수량 × 품목 원가로 어림한다.
-- =====================================================================
create or replace function public.profit_report(p_company text, p_from date, p_to date)
returns table (section text, account_code text, account_name text, amount numeric)
language plpgsql security definer set search_path = '' as $$
begin
  perform erp.assert_admin(p_company);
  return query
  with j as (
    select j.account_code, sum(j.debit) d, sum(j.credit) c from erp.journal_lines j
    where j.company_id = p_company and j.date between p_from and p_to group by 1
  ), a as (
    select j.account_code, coalesce(ac.name, j.account_code) as nm, j.d, j.c,
           case when j.account_code ~ '^4' then '매출'
                when j.account_code ~ '^8' then '판매비와관리비'
                when j.account_code ~ '^9([0-2][0-9]|30)$' then '영업외수익'  -- 901~930 영업외수익(930 잡이익), 931~ 영업외비용
                when j.account_code ~ '^9' then '영업외비용'
                when j.account_code ~ '^[5-7]' then '제조경비'
           end as sec
    from j left join erp.accounts ac on ac.company_id = p_company and ac.code = j.account_code
  )
  select a.sec, a.account_code, a.nm, case when a.sec in ('매출', '영업외수익') then a.c - a.d else a.d - a.c end
  from a where a.sec is not null and abs(a.c - a.d) >= 1
  union all
  select '매출원가(추정)', null, i.name, sum(l.qty * coalesce(i.cost, 0))
  from erp.voucher_lines l join erp.vouchers v on v.id = l.voucher_id join erp.items i on i.id = l.item_id
  where v.company_id = p_company and v.kind = '매출' and v.status = 'active' and v.date between p_from and p_to
  group by i.name having sum(l.qty * coalesce(i.cost, 0)) <> 0;
end $$;

-- =====================================================================
-- 거래처 정산서: 기간 전 잔액 + 기간 안 전표별 증감
-- =====================================================================
create or replace function public.partner_statement(p_company text, p_partner text, p_from date, p_to date)
returns table (date date, voucher_id text, voucher_no text, kind text, memo text, receivable numeric, payable numeric)
language plpgsql security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return query
  select null::date, null::text, null::text, '이월'::text, null::text,
         coalesce(sum(case when j.account_code = '108' then j.debit - j.credit end), 0),
         coalesce(sum(case when j.account_code in ('251', '253') then j.credit - j.debit end), 0)
  from erp.journal_lines j
  where j.company_id = p_company and j.partner_id = p_partner and j.account_code in ('108', '251', '253') and j.date < p_from
  union all
  select v.date, v.id, v.voucher_no, case when v.return_of is not null then v.kind || ' 반품' else v.kind end, v.memo,
         sum(case when j.account_code = '108' then j.debit - j.credit else 0 end),
         sum(case when j.account_code in ('251', '253') then j.credit - j.debit else 0 end)
  from erp.journal_lines j join erp.vouchers v on v.id = j.voucher_id
  where j.company_id = p_company and j.partner_id = p_partner and j.account_code in ('108', '251', '253') and j.date between p_from and p_to
  group by v.date, v.id, v.voucher_no, v.kind, v.return_of, v.memo
  order by 1 nulls first, 3;
end $$;

-- =====================================================================
-- 견적서: lines [{item_id?, name, spec?, qty, price, tax_exempt}] 단가는 세금 포함
-- =====================================================================
create or replace function public.save_quote(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', ''); v_date date := coalesce((p->>'date')::date, current_date);
        v_partner text := nullif(p->>'partner_id', ''); v_lines jsonb;
begin
  perform erp.assert_member(v_company);
  if v_partner is not null and not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then
    raise exception '거래처를 찾을 수 없습니다.';
  end if;
  if coalesce(v_partner, nullif(trim(p->>'partner_name'), '')) is null then raise exception '받는 곳을 넣으세요.'; end if;
  select jsonb_agg(jsonb_build_object('item_id', nullif(l->>'item_id', ''), 'name', coalesce(nullif(l->>'name', ''), i.name),
           'spec', nullif(l->>'spec', ''), 'qty', (l->>'qty')::numeric, 'price', (l->>'price')::numeric,
           'tax_exempt', coalesce((l->>'tax_exempt')::boolean, false),
           'supply', a.supply, 'tax', a.tax, 'amount', a.gross) order by ord)
  into v_lines
  from jsonb_array_elements(p->'lines') with ordinality x(l, ord)
  left join erp.items i on i.id = l->>'item_id' and i.company_id = v_company
  cross join lateral erp.line_amount((l->>'qty')::numeric, (l->>'price')::numeric, coalesce((l->>'tax_exempt')::boolean, false)) a
  where coalesce((l->>'qty')::numeric, 0) <> 0 and coalesce(nullif(l->>'name', ''), i.name) is not null;
  if v_lines is null then raise exception '품목을 넣으세요.'; end if;
  if v_id is null then
    v_id := 'quote-' || gen_random_uuid();
    insert into erp.quotations (id, company_id, quote_no, created_by) values (v_id, v_company, erp.next_no(v_company, v_date, 'Q-', 'quote'), erp.actor_name());
  elsif not exists (select 1 from erp.quotations where id = v_id and company_id = v_company) then
    raise exception '견적서를 찾을 수 없습니다.';
  end if;
  update erp.quotations set date = v_date, valid_until = (p->>'valid_until')::date, partner_id = v_partner,
         partner_name = coalesce((select name from erp.partners where id = v_partner), nullif(trim(p->>'partner_name'), '')),
         lines = v_lines,
         supply = (select sum((l->>'supply')::numeric) from jsonb_array_elements(v_lines) l),
         tax = (select sum((l->>'tax')::numeric) from jsonb_array_elements(v_lines) l),
         amount = (select sum((l->>'amount')::numeric) from jsonb_array_elements(v_lines) l)
  where id = v_id;
  return v_id;
end $$;

create or replace function public.delete_quote(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.quotations where id = p_id;
  if v_company is null then raise exception '견적서를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.quotations where id = p_id;
end $$;

-- =====================================================================
-- 정기 전표: 매달 같은 날 나가는 입금·출금(임차료·이자 등). 발행하면 record_cash로 전표를 만든다.
-- =====================================================================
alter table erp.vouchers add column if not exists template_id text references erp.voucher_templates(id);
alter table erp.voucher_templates add column if not exists cash_account_id text references erp.cash_accounts(id);

-- p: {id?, company_id, name, direction(입금|출금), account_code, partner_id?, loan_id?, cash_account_id?, amount, issue_day, auto_issue, active, note}
create or replace function public.save_template(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_admin(v_company);
  if coalesce(trim(p->>'name'), '') = '' then raise exception '이름을 넣으세요.'; end if;
  if p->>'direction' not in ('입금', '출금') then raise exception '입금 또는 출금을 고르세요.'; end if;
  if coalesce(p->>'account_code', '') = '' then raise exception '계정을 고르세요.'; end if;
  if coalesce((p->>'amount')::numeric, 0) <= 0 then raise exception '금액을 넣으세요.'; end if;
  if coalesce((p->>'issue_day')::int, 0) not between 1 and 31 then raise exception '발행일은 1~31일입니다.'; end if;
  if v_id is null then
    v_id := 'tpl-' || gen_random_uuid();
    insert into erp.voucher_templates (id, company_id, name, legacy_collection) values (v_id, v_company, trim(p->>'name'), 'app');
  elsif not exists (select 1 from erp.voucher_templates where id = v_id and company_id = v_company) then
    raise exception '양식을 찾을 수 없습니다.';
  end if;
  update erp.voucher_templates set name = trim(p->>'name'), kind = 'cash', direction = p->>'direction', mode = 'fixed',
         account_code = p->>'account_code', partner_id = nullif(p->>'partner_id', ''), loan_id = nullif(p->>'loan_id', ''),
         cash_account_id = nullif(p->>'cash_account_id', ''), amount = (p->>'amount')::numeric, issue_day = (p->>'issue_day')::int,
         auto_issue = coalesce((p->>'auto_issue')::boolean, true), active = coalesce((p->>'active')::boolean, true),
         note = nullif(p->>'note', '')
  where id = v_id;
  return v_id;
end $$;

-- 그 달 발행. 이미 발행했으면 막는다. p_month: 'YYYY-MM'
create or replace function public.issue_template(p_id text, p_month text, p_amount numeric default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t erp.voucher_templates; v_date date; v_last date; r jsonb;
begin
  select * into t from erp.voucher_templates where id = p_id for update;
  if not found then raise exception '양식을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(t.company_id);
  if t.direction not in ('입금', '출금') or t.account_code is null then raise exception '입금·출금 양식만 발행할 수 있습니다(옛 앱의 대체 양식은 전표 화면에서 직접 넣으세요).'; end if;
  v_last := ((p_month || '-01')::date + interval '1 month - 1 day')::date;
  v_date := least((p_month || '-01')::date + (coalesce(t.issue_day, 1) - 1), v_last);
  if exists (select 1 from erp.vouchers where template_id = t.id and status = 'active' and to_char(date, 'YYYY-MM') = p_month) then
    raise exception '% 은(는) 이미 발행했습니다.', p_month;
  end if;
  r := public.record_cash(jsonb_build_object('company_id', t.company_id, 'dir', t.direction, 'date', v_date, 'partner_id', t.partner_id,
         'cash_account_id', t.cash_account_id, 'amount', coalesce(p_amount, t.amount), 'account_code', t.account_code,
         'loan_id', t.loan_id, 'note', t.name));
  update erp.vouchers set template_id = t.id where id = r->>'voucher_id';
  return r;
end $$;

-- =====================================================================
-- 차입금 잔액: 기초 원금 + 그 차입금으로 묶인 전표의 차입금 계정 증감
-- =====================================================================
create or replace view erp.loan_balances as
select l.id as loan_id, l.company_id, l.name, l.account_code, coalesce(l.opening_principal, 0) as opening,
       coalesce(sum(j.credit - j.debit), 0) as moved,
       coalesce(l.opening_principal, 0) + coalesce(sum(j.credit - j.debit), 0) as balance
from erp.loan_contracts l
left join erp.vouchers v on v.loan_id = l.id and v.status = 'active'
left join erp.journal_lines j on j.voucher_id = v.id and j.account_code = l.account_code
group by l.id;
alter view erp.loan_balances set (security_invoker = true);
grant select on erp.loan_balances to authenticated;

-- =====================================================================
-- 임가공: 발주(po_type oem)에 원료를 보내면 재고에서 빠진다. 제품은 보통 입고(receive_purchase)로 받는다.
-- =====================================================================
create or replace function public.send_oem(p_po text, p_lines jsonb, p_date date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare po erp.purchase_orders; x jsonb; n int := 0; v_date date := coalesce(p_date, current_date);
begin
  select * into po from erp.purchase_orders where id = p_po for update;
  if not found then raise exception '발주를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(po.company_id);
  if po.po_type <> 'oem' then raise exception '임가공 발주가 아닙니다.'; end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    if coalesce((x->>'qty')::numeric, 0) <= 0 then continue; end if;
    if not exists (select 1 from erp.items where id = x->>'item_id' and company_id = po.company_id) then raise exception '품목을 찾을 수 없습니다.'; end if;
    n := n + 1;
    perform erp.post_stock('oem:' || po.id || ':' || gen_random_uuid(), po.company_id, x->>'item_id', -(x->>'qty')::numeric, '임가공 출고',
                           'oem', po.id, po.partner_id, v_date, po.po_no);
  end loop;
  if n = 0 then raise exception '보낼 수량을 넣으세요.'; end if;
  -- 원료를 보내면 발주확정(입고대기)으로 본다(기존 앱 송출 = 발주확정)
  update erp.purchase_orders set status = 'invoiced', invoiced_at = now() where id = po.id and status = 'pending';
  return n;
end $$;

create or replace function public.cancel_oem_send(p_ledger_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.stock_ledger;
begin
  select * into r from erp.stock_ledger where id = p_ledger_id;
  if not found or r.source_type <> 'oem' or r.kind <> '임가공 출고' then raise exception '임가공 출고 줄이 아닙니다.'; end if;
  perform erp.assert_member(r.company_id);
  if exists (select 1 from erp.stock_ledger where reversal_of = r.id) then raise exception '이미 취소했습니다.'; end if;
  perform erp.post_stock('unoem:' || r.id, r.company_id, r.item_id, -r.qty, '임가공 출고 취소', 'oem', r.source_id, r.partner_id, current_date, r.note, r.id);
end $$;

-- =====================================================================
-- 파렛트: 거래처에 준 것(지급)·돌려받은 것(회수). 거래처별 나가 있는 수 = −Σ 원장(이관 이력 포함)
-- =====================================================================
create or replace function public.pallet_move(p_company text, p_item text, p_partner text, p_qty numeric, p_dir text,
  p_date date default null, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := 'pallet:' || gen_random_uuid();
begin
  perform erp.assert_member(p_company);
  if not exists (select 1 from erp.items where id = p_item and company_id = p_company and type = 'PALLET') then raise exception '파렛트를 찾을 수 없습니다.'; end if;
  if not exists (select 1 from erp.partners where id = p_partner and company_id = p_company) then raise exception '거래처를 고르세요.'; end if;
  if p_dir not in ('지급', '회수') then raise exception '지급 또는 회수입니다.'; end if;
  if coalesce(p_qty, 0) <= 0 or p_qty <> trunc(p_qty) then raise exception '수량은 1 이상 정수입니다.'; end if;
  perform erp.post_stock(v_id, p_company, p_item, case when p_dir = '지급' then -p_qty else p_qty end, '파렛트 ' || p_dir,
                         'pallet', null, p_partner, coalesce(p_date, current_date), nullif(p_note, ''));
  return v_id;
end $$;

create or replace view erp.pallet_outstanding as
select l.company_id, l.item_id, l.partner_id, -sum(l.qty) as out_qty, max(l.effective_date) as last_date
from erp.stock_ledger l
where l.source_type = 'pallet' and l.partner_id is not null
group by 1, 2, 3;
alter view erp.pallet_outstanding set (security_invoker = true);
grant select on erp.pallet_outstanding to authenticated;

-- =====================================================================
-- 직원·휴가
-- =====================================================================
-- p: {id?, company_id, name, position, department, join_date, status(working|leave|resigned), phone, birth_date, health_cert_date, annual_days?}
create or replace function public.save_employee(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_admin(v_company);
  if coalesce(trim(p->>'name'), '') = '' then raise exception '이름을 넣으세요.'; end if;
  if coalesce(p->>'status', 'working') not in ('working', 'leave', 'resigned') then raise exception '재직 상태를 고르세요.'; end if;
  if v_id is null then
    v_id := 'emp-' || gen_random_uuid();
    insert into erp.employees (id, company_id, name) values (v_id, v_company, trim(p->>'name'));
  elsif not exists (select 1 from erp.employees where id = v_id and company_id = v_company) then
    raise exception '직원을 찾을 수 없습니다.';
  end if;
  update erp.employees set name = trim(p->>'name'), position = nullif(trim(p->>'position'), ''), department = nullif(trim(p->>'department'), ''),
         join_date = (p->>'join_date')::date, status = coalesce(p->>'status', 'working'), phone = nullif(trim(p->>'phone'), ''),
         birth_date = (p->>'birth_date')::date, health_cert_date = (p->>'health_cert_date')::date,
         annual_leave = case when nullif(p->>'annual_days', '') is null then annual_leave
                             else coalesce(annual_leave, '{}') || jsonb_build_object('total', (p->>'annual_days')::numeric) end
  where id = v_id;
  return v_id;
end $$;

-- 휴가 신청: 직원은 자기 것만(직원 카드가 계정에 연결돼 있어야), 관리자는 누구 것이든. 관리자가 넣으면 바로 승인.
-- p: {company_id, employee_id?, type(연차|반차|병가|경조|기타), start_date, end_date, days, reason}
create or replace function public.request_leave(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_emp text := nullif(p->>'employee_id', ''); v_admin boolean; v_id text := 'leave-' || gen_random_uuid();
begin
  perform erp.assert_member(v_company);
  v_admin := v_company = any (app.my_admin_company_ids());
  if v_emp is null or not v_admin then
    select id into v_emp from erp.employees where company_id = v_company and auth_uid = auth.uid()::text
      and (v_emp is null or id = v_emp);
    if v_emp is null then raise exception '내 계정에 직원 카드가 연결돼 있지 않습니다. 관리자에게 연결을 부탁하세요.'; end if;
  end if;
  if not exists (select 1 from erp.employees where id = v_emp and company_id = v_company) then raise exception '직원을 찾을 수 없습니다.'; end if;
  if (p->>'start_date') is null or (p->>'end_date')::date < (p->>'start_date')::date then raise exception '날짜를 확인하세요.'; end if;
  if coalesce((p->>'days')::numeric, 0) <= 0 then raise exception '쓰는 날 수를 넣으세요.'; end if;
  insert into erp.leave_requests (id, company_id, employee_id, employee_name, type, start_date, end_date, days_used, status, reason, requested_at)
  values (v_id, v_company, v_emp, (select name from erp.employees where id = v_emp), coalesce(nullif(p->>'type', ''), '연차'),
          (p->>'start_date')::date, (p->>'end_date')::date, (p->>'days')::numeric,
          case when v_admin then 'approved' else 'pending' end, nullif(p->>'reason', ''), current_date);
  return v_id;
end $$;

-- 승인·반려(관리자) / 취소(본인이 대기 중일 때 또는 관리자)
create or replace function public.set_leave_status(p_id text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.leave_requests; v_admin boolean;
begin
  select * into r from erp.leave_requests where id = p_id for update;
  if not found then raise exception '휴가 신청을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(r.company_id);
  v_admin := r.company_id = any (app.my_admin_company_ids());
  if p_status not in ('approved', 'rejected', 'canceled') then raise exception '승인·반려·취소만 됩니다.'; end if;
  if p_status in ('approved', 'rejected') and not v_admin then raise exception '승인·반려는 관리자만 합니다.'; end if;
  if p_status = 'canceled' and not v_admin and not (r.status = 'pending'
     and exists (select 1 from erp.employees e where e.id = r.employee_id and e.auth_uid = auth.uid()::text)) then
    raise exception '대기 중인 내 신청만 취소할 수 있습니다.';
  end if;
  update erp.leave_requests set status = p_status where id = p_id;
end $$;

-- =====================================================================
-- 품질: 벤조피렌 검사
-- =====================================================================
create or replace function public.save_quality_test(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_member(v_company);
  if coalesce(trim(p->>'product_name'), '') = '' then raise exception '제품을 넣으세요.'; end if;
  if v_id is null then
    v_id := 'bzp-' || gen_random_uuid();
    insert into erp.benzopyrene_tests (id, company_id) values (v_id, v_company);
  elsif not exists (select 1 from erp.benzopyrene_tests where id = v_id and company_id = v_company) then
    raise exception '검사 기록을 찾을 수 없습니다.';
  end if;
  update erp.benzopyrene_tests set product_name = trim(p->>'product_name'), test_item = nullif(p->>'test_item', ''),
         lot_no = nullif(p->>'lot_no', ''), received_date = (p->>'received_date')::date, completed_date = (p->>'completed_date')::date,
         criteria = nullif(p->>'criteria', ''), result = nullif(p->>'result', ''), judgment = nullif(p->>'judgment', '')
  where id = v_id;
  return v_id;
end $$;

create or replace function public.delete_quality_test(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.benzopyrene_tests where id = p_id;
  if v_company is null then raise exception '검사 기록을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.benzopyrene_tests where id = p_id;
end $$;

-- =====================================================================
-- 업무(프로젝트)
-- =====================================================================
alter table erp.work_projects add column if not exists due_date date;
create or replace function public.save_project(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_member(v_company);
  if coalesce(trim(p->>'title'), '') = '' then raise exception '제목을 넣으세요.'; end if;
  if coalesce(p->>'status', 'todo') not in ('todo', 'doing', 'done') then raise exception '상태를 고르세요.'; end if;
  if v_id is null then
    v_id := 'proj-' || gen_random_uuid();
    insert into erp.work_projects (id, company_id, created_at) values (v_id, v_company, now());
  elsif not exists (select 1 from erp.work_projects where id = v_id and company_id = v_company) then
    raise exception '업무를 찾을 수 없습니다.';
  end if;
  update erp.work_projects set title = trim(p->>'title'), description = nullif(p->>'description', ''), status = coalesce(p->>'status', 'todo'),
         owner_id = nullif(p->>'owner_id', ''), due_date = (p->>'due_date')::date
  where id = v_id;
  return v_id;
end $$;

create or replace function public.delete_project(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.work_projects where id = p_id;
  if v_company is null then raise exception '업무를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.work_projects where id = p_id;
end $$;

-- =====================================================================
-- 데이터 점검: 어긋난 곳 목록 (읽기만)
-- =====================================================================
create or replace function public.data_checks(p_company text)
returns table (kind text, ref text, detail text)
language plpgsql security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return query
  select '분개 안 되는 전표', s.voucher_id, coalesce(s.voucher_no, '') || ' ' || s.kind || ' ' || coalesce(s.date::text, '') || ': ' || s.reason
  from erp.journal_skipped s where s.company_id = p_company
  union all
  select '재고가 음수', i.id, i.name || ' ' || b.qty || coalesce(i.unit, '')
  from erp.stock_balances b join erp.items i on i.id = b.item_id where b.company_id = p_company and b.qty < -0.0005 and not i.archived
  union all
  select '잔고 ≠ 원장 합계', i.id, i.name || ': 잔고 ' || coalesce(b.qty, 0) || ', 원장 ' || coalesce(l.s, 0)
  from erp.items i left join erp.stock_balances b on b.item_id = i.id
  left join (select item_id, sum(qty) s from erp.stock_ledger where stock_effect group by 1) l on l.item_id = i.id
  where i.company_id = p_company and abs(coalesce(b.qty, 0) - coalesce(l.s, 0)) > 0.0005
  union all
  select '로트 합계 ≠ 잔고', i.id, i.name || ': 로트 ' || lt.s || ', 잔고 ' || coalesce(b.qty, 0)
  from erp.items i join (select item_id, sum(qty_left) s from erp.lots where status = 'active' group by 1) lt on lt.item_id = i.id
  left join erp.stock_balances b on b.item_id = i.id
  where i.company_id = p_company and coalesce(b.qty, 0) >= 0 and abs(lt.s - coalesce(b.qty, 0)) > 0.01
  union all
  select '출고했는데 명세서 없음', o.id, coalesce(o.card_no, o.id) || ' ' || coalesce(o.partner_name, '')
  from erp.orders o where o.company_id = p_company and o.shipped_at is not null and o.voucher_id is null
  union all
  select '배송일 지난 주문', o.id, coalesce(o.card_no, o.id) || ' ' || coalesce(o.partner_name, '') || ' ' || o.delivery_date
  from erp.orders o where o.company_id = p_company and o.shipped_at is null and o.status not in ('SHIPPED', 'DELIVERED', 'CANCELED')
    and o.delivery_date < current_date - 7
  union all
  select '거래처 없는 외상 전표', v.id, coalesce(v.voucher_no, '') || ' ' || v.kind || ' ' || coalesce(v.amount::text, '')
  from erp.vouchers v where v.company_id = p_company and v.status = 'active' and v.kind in ('매출', '매입') and v.partner_id is null
  union all
  select '원가 없는 제품', i.id, i.name
  from erp.items i where i.company_id = p_company and not i.archived and i.type in ('FINISHED', 'GOODS') and coalesce(i.cost, 0) = 0;
end $$;

revoke all on function public.merge_items(text, text), public.item_cost_estimate(text), public.apply_item_costs(text, jsonb),
  public.profit_report(text, date, date), public.partner_statement(text, text, date, date), public.save_quote(jsonb), public.delete_quote(text),
  public.save_template(jsonb), public.issue_template(text, text, numeric), public.send_oem(text, jsonb, date), public.cancel_oem_send(text),
  public.pallet_move(text, text, text, numeric, text, date, text), public.save_employee(jsonb), public.request_leave(jsonb),
  public.set_leave_status(text, text), public.save_quality_test(jsonb), public.delete_quality_test(text), public.save_project(jsonb),
  public.delete_project(text), public.data_checks(text) from public, anon;
grant execute on function public.merge_items(text, text), public.item_cost_estimate(text), public.apply_item_costs(text, jsonb),
  public.profit_report(text, date, date), public.partner_statement(text, text, date, date), public.save_quote(jsonb), public.delete_quote(text),
  public.save_template(jsonb), public.issue_template(text, text, numeric), public.send_oem(text, jsonb, date), public.cancel_oem_send(text),
  public.pallet_move(text, text, text, numeric, text, date, text), public.save_employee(jsonb), public.request_leave(jsonb),
  public.set_leave_status(text, text), public.save_quality_test(jsonb), public.delete_quality_test(text), public.save_project(jsonb),
  public.delete_project(text), public.data_checks(text) to authenticated;
