-- erp-core 저장소 supabase/stock.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 재고 움직임(입고·사용·폐기·실사)과 생산. orders.sql 뒤에 돈다(erp.post_stock 등을 쓴다).
--
-- 생산 규칙 (태백 앱 orderProductionPlanner의 accrueBom / buildFormula를 옮김):
--   완제품 N개 생산 = BOM 구성품을 N × 수량만큼 차감하고 완제품 +N.
--   · 구성품이 phantom(무재고 반제품, 예: 참기름특A)이면 그 이름의 배합(item_formulas)대로 원료로 편다.
--     배합 원료가 또 phantom이면 계속 편다. 비율 = ratio × 수율(yield_rate).
--   · 구성품이 원료·벌크(kg/L)·부자재면 그대로 차감.
--   · 구성품이 개수 단위 완제품/반제품(선물세트 속 병, 박스 속 낱개)이고 모자라면 모자란 만큼 먼저 만든다(재귀).
--   · 상품(GOODS)·완사입·임가공 품목은 만들지 않는다(사 오거나 외주가 만든다).

-- ---------- 단순 재고 움직임 ----------
-- kind: 입고 / 사용 / 폐기 / 조정. 수량은 양수로 받고 방향은 kind가 정한다(조정만 부호 그대로).
create or replace function public.move_stock(p_company text, p_item text, p_qty numeric, p_kind text,
  p_date date default null, p_partner text default null, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := 'mv:' || gen_random_uuid(); v_qty numeric;
begin
  perform erp.assert_member(p_company);
  if not exists (select 1 from erp.items where id = p_item and company_id = p_company) then raise exception '품목을 찾을 수 없습니다.'; end if;
  if p_partner is not null and not exists (select 1 from erp.partners where id = p_partner and company_id = p_company) then
    raise exception '거래처를 찾을 수 없습니다.';
  end if;
  if coalesce(p_qty, 0) = 0 then raise exception '수량이 0입니다.'; end if;
  v_qty := case p_kind when '입고' then abs(p_qty) when '사용' then -abs(p_qty) when '폐기' then -abs(p_qty)
                       when '조정' then p_qty else null end;
  if v_qty is null then raise exception '알 수 없는 움직임: %', p_kind; end if;
  perform erp.post_stock(v_id, p_company, p_item, v_qty, p_kind, 'manual', null, p_partner,
                         coalesce(p_date, current_date), nullif(p_note, ''));
  return v_id;
end $$;

-- 실사: 센 수량으로 맞춘다. 원장에는 차이만 한 줄(실사)로 남는다.
create or replace function public.stocktake(p_company text, p_item text, p_counted numeric,
  p_date date default null, p_note text default null) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_have numeric; v_diff numeric;
begin
  perform erp.assert_member(p_company);
  if not exists (select 1 from erp.items where id = p_item and company_id = p_company) then raise exception '품목을 찾을 수 없습니다.'; end if;
  if p_counted is null or p_counted < 0 then raise exception '센 수량이 올바르지 않습니다.'; end if;
  select qty into v_have from erp.stock_balances where item_id = p_item for update;
  v_diff := p_counted - coalesce(v_have, 0);
  if v_diff <> 0 then
    perform erp.post_stock('count:' || gen_random_uuid(), p_company, p_item, v_diff, '실사', 'stocktake', null, null,
                           coalesce(p_date, current_date), concat_ws(' ', nullif(p_note, ''), '(' || p_counted || '로 맞춤)'));
  end if;
  return v_diff;
end $$;

-- ---------- 생산 계획 (DB를 바꾸지 않고 _plan 임시 표에 쌓는다) ----------
create or replace function erp.plan_reset() returns void language plpgsql set search_path = '' as $$
begin
  create temp table if not exists _plan (seq serial, item_id text, qty numeric, role text, depth int) on commit drop;
  truncate _plan;
end $$;

-- 계획 중에 쓸 수 있는 잔고 = 지금 잔고 + 이번 계획에서 이미 더하고 뺀 몫
-- (임시 표를 읽으므로 plpgsql — sql 함수는 만들 때 표가 있어야 한다)
create or replace function erp.plan_have(p_item text) returns numeric language plpgsql stable set search_path = '' as $$
begin
  return coalesce((select qty from erp.stock_balances where item_id = p_item), 0)
       + coalesce((select sum(case when role = 'build' then qty else -qty end) from pg_temp._plan where item_id = p_item), 0);
end $$;

-- 배합으로 펴기: key(phantom 반제품 이름)의 배합 행대로 kg을 원료에 나눈다.
create or replace function erp.plan_formula(p_company text, p_key text, p_kg numeric, p_depth int) returns void
language plpgsql set search_path = '' as $$
declare f record; v_kg numeric; v_phantom boolean;
begin
  if p_depth > 6 then raise exception '배합이 너무 깊거나 돌고 있습니다: %', p_key; end if;
  if not exists (select 1 from erp.item_formulas where company_id = p_company and parent_key = p_key) then
    raise exception '배합이 없습니다: % (phantom 반제품은 배합이 있어야 원료로 펼 수 있습니다)', p_key;
  end if;
  for f in select * from erp.item_formulas where company_id = p_company and parent_key = p_key loop
    v_kg := p_kg * f.ratio * coalesce(nullif(f.yield_rate, 0), 1);
    if v_kg = 0 then continue; end if;
    select phantom into v_phantom from erp.items where id = f.child_item_id;
    if coalesce(v_phantom, false) and exists (select 1 from erp.item_formulas where company_id = p_company and parent_key = f.child_name) then
      perform erp.plan_formula(p_company, f.child_name, v_kg, p_depth + 1);
    elsif f.child_item_id is null then
      raise exception '배합 원료 "%"에 맞는 품목이 없습니다(배합 %). 품목 이름을 맞춰 주세요.', f.child_name, p_key;
    else
      insert into pg_temp._plan (item_id, qty, role, depth) values (f.child_item_id, round(v_kg, 3), 'use', p_depth);
    end if;
  end loop;
end $$;

-- BOM 한 단 펴기: p_item을 p_units개 만들 때 드는 것.
create or replace function erp.plan_build(p_company text, p_item text, p_units numeric, p_depth int) returns void
language plpgsql set search_path = '' as $$
declare b record; c erp.items; v_need numeric; v_short numeric;
begin
  if p_units <= 0 then return; end if;
  if p_depth > 4 then raise exception 'BOM이 너무 깊거나 돌고 있습니다: %', p_item; end if;
  if not exists (select 1 from erp.item_boms where parent_item_id = p_item) then
    raise exception '"%"에 BOM이 없어 생산할 수 없습니다.', (select name from erp.items where id = p_item);
  end if;
  insert into pg_temp._plan (item_id, qty, role, depth) values (p_item, p_units, 'build', p_depth);
  for b in select * from erp.item_boms where parent_item_id = p_item loop
    select * into c from erp.items where id = b.child_item_id;
    v_need := round(p_units * b.quantity, 3);
    if v_need <= 0 then continue; end if;
    if c.phantom then
      -- phantom 반제품: 재고가 없고 배합대로 원료로 편다. 이름의 '/' 앞부분이 배합 키(태백 baseRawName).
      perform erp.plan_formula(p_company, trim(split_part(c.name, '/', 1)), v_need, p_depth + 1);
    elsif c.type in ('FINISHED', 'WIP') and not c.is_bulk and coalesce(c.procure_type, '') not in ('완사입', '임가공') then
      v_short := round(v_need - greatest(erp.plan_have(c.id), 0), 3);
      if v_short > 0 then perform erp.plan_build(p_company, c.id, v_short, p_depth + 1); end if;
      insert into pg_temp._plan (item_id, qty, role, depth) values (c.id, v_need, 'use', p_depth);
    else
      insert into pg_temp._plan (item_id, qty, role, depth) values (c.id, v_need, 'use', p_depth);
    end if;
  end loop;
end $$;

-- 계획 결과를 화면용으로: 품목별 만들 양·쓸 양·지금 잔고·부족
create or replace function erp.plan_result() returns jsonb language plpgsql stable set search_path = '' as $$
begin
  return (select coalesce(jsonb_agg(x order by x->>'role', x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('item_id', p.item_id, 'name', i.name, 'unit', i.unit, 'display_unit', i.display_unit,
             'density', i.density, 'role', p.role,
             'qty', sum(p.qty), 'have', coalesce(b.qty, 0),
             'short', case when p.role = 'use' then greatest(sum(p.qty) - coalesce(b.qty, 0)
                        - coalesce((select sum(qty) from pg_temp._plan q where q.item_id = p.item_id and q.role = 'build'), 0), 0) else 0 end) x
    from pg_temp._plan p join erp.items i on i.id = p.item_id left join erp.stock_balances b on b.item_id = p.item_id
    group by p.item_id, i.name, i.unit, i.display_unit, i.density, p.role, b.qty
  ) t);
end $$;

-- 계획대로 원장에 쓴다. 품목·역할별로 한 줄씩.
create or replace function erp.plan_post(p_company text, p_run text, p_date date, p_order text) returns void
language plpgsql set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select item_id, role, sum(qty) qty from pg_temp._plan group by item_id, role order by role, item_id loop
    n := n + 1;
    perform erp.post_stock(p_run || ':' || n, p_company, r.item_id,
                           case when r.role = 'build' then r.qty else -r.qty end,
                           case when r.role = 'build' then '생산' else '생산 투입' end,
                           'production', p_run, null, p_date, case when p_order is not null then '주문 ' || p_order end);
  end loop;
end $$;

-- ---------- 생산 ----------
-- p_preview면 아무것도 안 바꾸고 계획만 돌려준다. 원료가 모자라도 생산은 막지 않는다(실물이 먼저일 수 있다) — 화면이 경고한다.
create or replace function public.produce(p_company text, p_item text, p_qty numeric, p_date date default null,
  p_preview boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_run text := 'prod-' || gen_random_uuid(); v_plan jsonb;
begin
  perform erp.assert_member(p_company);
  if not exists (select 1 from erp.items where id = p_item and company_id = p_company) then raise exception '품목을 찾을 수 없습니다.'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception '생산 수량이 0입니다.'; end if;
  if exists (select 1 from erp.items where id = p_item and (type not in ('FINISHED', 'WIP') or is_bulk or phantom
             or coalesce(procure_type, '') in ('완사입', '임가공'))) then
    raise exception '이 품목은 생산하는 품목이 아닙니다(원료·벌크·상품·완사입·임가공은 입고로 들어옵니다).';
  end if;
  perform erp.plan_reset();
  perform erp.plan_build(p_company, p_item, p_qty, 0);
  v_plan := erp.plan_result();
  if p_preview then return jsonb_build_object('preview', true, 'plan', v_plan); end if;

  insert into erp.production_runs (id, company_id, item_id, qty, run_date, note)
  values (v_run, p_company, p_item, p_qty, coalesce(p_date, current_date), nullif(p_note, ''));
  perform erp.plan_post(p_company, v_run, coalesce(p_date, current_date), null);
  return jsonb_build_object('run_id', v_run, 'plan', v_plan);
end $$;

-- 주문의 부족분만 생산: 줄마다 (주문 수량 − 쓸 수 있는 재고)만큼 만든다. 출고는 따로(ship_order).
create or replace function public.produce_for_order(p_order_id text, p_preview boolean default false, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o erp.orders; l record; v_short numeric; v_run text := 'prod-' || gen_random_uuid(); v_plan jsonb; v_lines jsonb := '[]';
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if o.shipped_at is not null then raise exception '이미 출고된 주문입니다.'; end if;
  perform erp.plan_reset();
  for l in select ol.item_id, sum(ol.qty) qty, i.name, i.type, i.is_bulk, i.procure_type
           from erp.order_lines ol join erp.items i on i.id = ol.item_id
           where ol.order_id = o.id group by ol.item_id, i.name, i.type, i.is_bulk, i.procure_type loop
    if l.type not in ('FINISHED', 'WIP') or l.is_bulk or coalesce(l.procure_type, '') in ('완사입', '임가공') then continue; end if;
    v_short := round(l.qty - greatest(erp.plan_have(l.item_id), 0), 3);
    if v_short > 0 then
      perform erp.plan_build(o.company_id, l.item_id, v_short, 0);
      v_lines := v_lines || jsonb_build_object('item_id', l.item_id, 'name', l.name, 'qty', v_short);
    end if;
  end loop;
  v_plan := erp.plan_result();
  if p_preview or jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('preview', true, 'produce', v_lines, 'plan', v_plan);
  end if;

  insert into erp.production_runs (id, company_id, order_id, item_id, qty, run_date, note)
  select v_run, o.company_id, o.id, null, null, coalesce(p_date, current_date), '주문 부족분 ' || jsonb_array_length(v_lines) || '품목';
  perform erp.plan_post(o.company_id, v_run, coalesce(p_date, current_date), o.id);
  update erp.orders set status = 'DISPATCHED' where id = o.id and status in ('PENDING', 'PROCESSING');
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('produce:' || gen_random_uuid(), o.company_id, o.id, 'produce', jsonb_build_object('run', v_run, 'lines', v_lines), erp.actor_name(), now());
  return jsonb_build_object('run_id', v_run, 'produce', v_lines, 'plan', v_plan);
end $$;

-- 생산 취소: 그 생산이 남긴 원장 줄마다 반대 줄을 더한다.
create or replace function public.cancel_production(p_run_id text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.production_runs; l record;
begin
  select * into r from erp.production_runs where id = p_run_id for update;
  if not found then raise exception '생산 기록을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(r.company_id);
  if r.canceled_at is not null then raise exception '이미 취소된 생산입니다.'; end if;
  if not exists (select 1 from erp.stock_ledger where source_type = 'production' and source_id = r.id) then
    raise exception '옛 앱의 생산 기록은 여기서 취소할 수 없습니다.';
  end if;
  for l in select * from erp.stock_ledger where source_type = 'production' and source_id = r.id and reversal_of is null loop
    perform erp.post_stock('unprod:' || l.id, l.company_id, l.item_id, -l.qty, '생산 취소', 'production', r.id, null,
                           current_date, p_reason, l.id);
  end loop;
  update erp.production_runs set canceled_at = now() where id = r.id;
end $$;

revoke all on function public.move_stock(text, text, numeric, text, date, text, text), public.stocktake(text, text, numeric, date, text),
  public.produce(text, text, numeric, date, boolean, text), public.produce_for_order(text, boolean, date),
  public.cancel_production(text, text) from public, anon;
grant execute on function public.move_stock(text, text, numeric, text, date, text, text), public.stocktake(text, text, numeric, date, text),
  public.produce(text, text, numeric, date, boolean, text), public.produce_for_order(text, boolean, date),
  public.cancel_production(text, text) to authenticated;
revoke all on function erp.plan_reset(), erp.plan_have(text), erp.plan_formula(text, text, numeric, int),
  erp.plan_build(text, text, numeric, int), erp.plan_result(), erp.plan_post(text, text, date, text) from public, anon, authenticated;
