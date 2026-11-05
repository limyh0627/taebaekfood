-- erp-core 저장소 supabase/prodflow.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 생산 관리 (기존 앱 '생산 관리'와 같게, 2026-11-05). stockflow.sql 뒤에 돈다.
--
--  · 원료 입고 기록 / 원료 사용 기록: 원료·벌크(로트 관리 품목)를 kg으로. 사용은 로트를 고를 수 있다(안 고르면 오래된 것부터).
--  · 착유: 깨를 쓰면 수율만큼 기름(벌크)이 저절로 입고된다.
--      수율 = 배합표(item_formulas)에서 부모가 벌크 품목 이름(‘/’ 앞)이고 자식이 이 원료인 줄의 yield_rate(없으면 ratio).
--      배합표에 없으면 기존 앱 기본값: 참깨→통깨참기름 0.48, 깨분→깨분참기름 0.45, 들깨→통들깨들기름 0.37, 검정깨→볶음검정참깨 0.95.
--      착유량 = 사용량 × 수율, 소수 셋째 자리 반올림(기존 앱 rawPressYieldKg).
--  · 원료 입출고 기록: 날짜별 전일재고·입고·사용·정정·잔량. 정정 = 실사·조정·취소.
--  · 로트 이력: 그 로트가 들고 난 줄, 생산에 쓰였으면 어느 주문·거래처로 갔는지(역추적).

create or replace function erp.base_name(p text) returns text language sql immutable as $$ select trim(split_part(coalesce(p, ''), '/', 1)) $$;

-- 착유 규칙: 원료 → (기름 품목, 수율)
create or replace function erp.press_rule(p_raw text, out product_id text, out rate numeric)
language plpgsql stable set search_path = '' as $$
declare r erp.items; v_key text; v_prod text;
begin
  select * into r from erp.items where id = p_raw;
  if r.id is null or r.type <> 'RAW' then return; end if;
  v_key := erp.base_name(r.name);
  select b.id, coalesce(nullif(f.yield_rate, 0), nullif(f.ratio, 0), 1) into product_id, rate
  from erp.item_formulas f
  join erp.items b on b.company_id = r.company_id and b.is_bulk and not b.phantom and not b.archived and erp.base_name(b.name) = f.parent_key
  where f.company_id = r.company_id and (f.child_item_id = r.id or f.child_name = v_key)
  order by (f.child_item_id = r.id) desc, b.name limit 1;
  if product_id is not null then return; end if;
  select d.p, d.rate into v_prod, rate
  from (values ('참깨', '통깨참기름', 0.48), ('깨분', '깨분참기름', 0.45), ('들깨', '통들깨들기름', 0.37), ('검정깨', '볶음검정참깨', 0.95)) d(raw, p, rate)
  where d.raw = v_key;
  if v_prod is null then rate := null; return; end if;
  select id into product_id from erp.items
  where company_id = r.company_id and erp.base_name(name) = v_prod and not phantom and not archived and erp.lot_tracked(id)
  order by is_bulk desc, name limit 1;
  if product_id is null then rate := null; end if;
end $$;

-- 화면용: 원료별 착유 규칙
create or replace function public.press_rules(p_company text)
returns table (raw_id text, product_id text, product_name text, rate numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return query select i.id, x.product_id, p.name, x.rate
  from erp.items i cross join lateral erp.press_rule(i.id) x join erp.items p on p.id = x.product_id
  where i.company_id = p_company and i.type = 'RAW' and not i.archived;
end $$;

-- 원료 입고·사용 기록. p: {company_id, item_id, kind: '입고'|'사용', qty(kg), lot_id?, partner_id?, date?, note?, press?: bool(기본 true)}
create or replace function public.record_raw(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_item text := p->>'item_id'; v_kind text := p->>'kind';
        v_qty numeric := round((p->>'qty')::numeric, 3); v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Seoul')::date);
        v_id text := 'raw-' || gen_random_uuid(); v_lot text := nullif(p->>'lot_id', ''); v_note text := nullif(trim(p->>'note'), '');
        i erp.items; pr record; v_out numeric;
begin
  perform erp.assert_member(v_company);
  select * into i from erp.items where id = v_item and company_id = v_company;
  if i.id is null or not erp.lot_tracked(i.id) then raise exception '원료나 벌크 품목만 기록할 수 있습니다.'; end if;
  if coalesce(v_qty, 0) <= 0 then raise exception '수량을 넣으세요.'; end if;
  if v_kind = '입고' then
    perform erp.post_stock(v_id || ':1', v_company, i.id, v_qty, '입고', 'raw', v_id, nullif(p->>'partner_id', ''), v_date, v_note);
    return jsonb_build_object('id', v_id);
  elsif v_kind <> '사용' then raise exception '입고나 사용만 기록합니다.';
  end if;
  if v_lot is not null and not exists (select 1 from erp.lots where id = v_lot and item_id = i.id and status = 'active') then
    raise exception '고른 로트를 찾을 수 없습니다.';
  end if;
  perform erp.post_stock(v_id || ':1', v_company, i.id, -v_qty, '사용', 'raw', v_id, null, v_date, v_note, null, v_lot);
  if coalesce((p->>'press')::boolean, true) then
    select * into pr from erp.press_rule(i.id);
    if pr.product_id is not null then
      v_out := round(v_qty * pr.rate, 3);
      if v_out > 0 then
        perform erp.post_stock(v_id || ':2', v_company, pr.product_id, v_out, '착유', 'raw', v_id, null, v_date,
                               erp.base_name(i.name) || ' ' || v_qty || 'kg 착유 (수율 ' || round(pr.rate * 100, 1) || '%)');
        return jsonb_build_object('id', v_id, 'pressed', v_out, 'product', (select name from erp.items where id = pr.product_id), 'rate', pr.rate);
      end if;
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- 원료 기록 취소. 착유로 들어온 기름을 이미 썼으면 막는다.
create or replace function public.cancel_raw(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if exists (select 1 from erp.lot_moves m join erp.lots t on t.id = m.lot_id join erp.stock_ledger l on l.id = m.ledger_id
             where l.source_type = 'raw' and l.source_id = p_id and l.qty > 0 and t.qty_left < t.qty_in - 0.0005) then
    raise exception '이 기록으로 들어온 로트를 이미 썼습니다. 쓴 기록을 먼저 취소하거나 실사로 맞추세요.';
  end if;
  for r in select * from erp.stock_ledger l where source_type = 'raw' and source_id = p_id and reversal_of is null
           and not exists (select 1 from erp.stock_ledger x where x.reversal_of = l.id) order by id desc loop
    perform erp.assert_member(r.company_id);
    n := n + 1;
    perform erp.post_stock('un' || r.id, r.company_id, r.item_id, -r.qty, r.kind || ' 취소', 'raw', p_id, r.partner_id,
                           (now() at time zone 'Asia/Seoul')::date, null, r.id);
  end loop;
  if n = 0 then raise exception '취소할 기록이 없습니다.'; end if;
end $$;

-- 원료 입출고 기록: 날짜별. 전일재고는 p_from 전까지 전부 더한 값.
create or replace function public.raw_daily(p_company text, p_item text, p_from date, p_to date)
returns table (day date, opening numeric, inbound numeric, used numeric, corrected numeric, closing numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return query
  with g as (
    select l.effective_date d,
           sum(case when not c.fix and l.qty > 0 then l.qty else 0 end) i,
           sum(case when not c.fix and l.qty < 0 then -l.qty else 0 end) u,
           sum(case when c.fix then l.qty else 0 end) f, sum(l.qty) net
    from erp.stock_ledger l
    cross join lateral (select l.kind in ('실사', '조정') or l.reversal_of is not null or l.kind like '%취소' as fix) c
    where l.company_id = p_company and l.item_id = p_item and l.stock_effect and l.effective_date between p_from and p_to
    group by 1),
  o as (select coalesce(sum(qty), 0) q from erp.stock_ledger
        where company_id = p_company and item_id = p_item and stock_effect and (effective_date < p_from or effective_date is null))
  select g.d, o.q + coalesce(sum(g.net) over (order by g.d rows between unbounded preceding and 1 preceding), 0),
         g.i, g.u, g.f, o.q + sum(g.net) over (order by g.d)
  from g cross join o order by g.d desc;
end $$;

-- 로트 이력(역추적): 그 로트가 들고 난 줄 + 생산에 쓰였으면 그 생산의 주문·거래처
create or replace function public.lot_trace(p_lot text)
returns table (at date, kind text, qty numeric, note text, source_type text, source_id text, order_card text, partner text, made text)
language plpgsql stable security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.lots where id = p_lot;
  if v_company is null then raise exception '로트를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  return query
  select l.effective_date, l.kind, m.qty, l.note, l.source_type, l.source_id, o.card_no, coalesce(pt.name, o.partner_name, pl.name),
         (select string_agg(it.name || ' ' || round(x.qty, 3)::text, ', ') from erp.stock_ledger x join erp.items it on it.id = x.item_id
          where x.source_type = 'production' and x.source_id = l.source_id and x.kind = '생산' and l.source_type = 'production')
  from erp.lot_moves m join erp.stock_ledger l on l.id = m.ledger_id
  left join erp.production_runs r on l.source_type = 'production' and r.id = l.source_id
  left join erp.orders o on o.id = r.order_id
  left join erp.partners pt on pt.id = o.partner_id
  left join erp.partners pl on pl.id = l.partner_id
  where m.lot_id = p_lot
  order by l.effective_date, m.id;
end $$;

revoke all on function public.press_rules(text), public.record_raw(jsonb), public.cancel_raw(text), public.raw_daily(text, text, date, date), public.lot_trace(text) from public, anon;
grant execute on function public.press_rules(text), public.record_raw(jsonb), public.cancel_raw(text), public.raw_daily(text, text, date, date), public.lot_trace(text) to authenticated;
revoke all on function erp.press_rule(text) from public, anon;
