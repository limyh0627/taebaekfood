-- erp-core 저장소 supabase/lots.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 원료 로트. orders.sql(erp.post_stock) 뒤에 돈다 — post_stock을 로트를 아는 판으로 바꿔 끼운다.
--
-- 로트를 따지는 품목: 원료(RAW)와 벌크(기름 같은 kg 반제품). 제품은 로트 없이 수량만 센다.
--   · 들어오면(입고·실사 +·생산 +) 새 로트: 번호 YYMMDD-NN, 공급처 = 거래처(없으면 종류)
--   · 나가면(사용·생산 투입·출고·폐기·실사 −) 오래된 로트부터(선입선출). 로트가 모자라면 남는 양은 로트 없이 나간다(재고는 원장이 정한다).
--   · 되돌리기(reversal_of 있는 줄)는 원래 줄이 건드린 로트를 그대로 되돌린다.
--   · 어느 줄이 어느 로트를 얼마나 썼는지 erp.lot_moves에 남는다(서류의 로트 표기·추적 근거).

create table if not exists erp.lot_moves (
  id         bigserial primary key,
  company_id text not null references erp.companies(id),
  ledger_id  text not null references erp.stock_ledger(id),
  lot_id     text not null references erp.lots(id),
  qty        numeric not null
);
create index if not exists lot_moves_ledger on erp.lot_moves (ledger_id);
create index if not exists lot_moves_lot on erp.lot_moves (lot_id);
alter table erp.lot_moves enable row level security;
revoke all on erp.lot_moves from anon, authenticated;
grant select on erp.lot_moves to authenticated;
drop policy if exists member_read on erp.lot_moves;
create policy member_read on erp.lot_moves for select to authenticated using (company_id = any (app.my_company_ids()));

create or replace function erp.lot_tracked(p_item text) returns boolean language sql stable set search_path = '' as $$
  select coalesce((select type = 'RAW' or is_bulk from erp.items where id = p_item and not phantom), false)
$$;

-- 이관 맞추기: 옛 활성 로트 합계가 지금 잔고와 다르면 차이만큼 '이관 조정' 로트를 둔다(잔고가 더 많을 때만).
-- 입고일을 비워 가장 오래된 것으로 친다(선입선출에서 먼저 나간다).
insert into erp.lots (id, company_id, item_id, received_at, qty_in, qty_left, supplier, lot_no, status)
select 'lot-migrate-' || b.item_id, b.company_id, b.item_id, null, b.qty - coalesce(l.left_sum, 0), b.qty - coalesce(l.left_sum, 0),
       '이관 조정', 'MIGRATE', 'active'
from erp.stock_balances b
left join (select item_id, sum(qty_left) left_sum from erp.lots where status = 'active' group by 1) l on l.item_id = b.item_id
where erp.lot_tracked(b.item_id) and b.qty - coalesce(l.left_sum, 0) > 0.0005
on conflict (id) do nothing;

-- p_lot: 나갈 때 이 로트부터 쓴다(사람이 로트를 고른 사용 기록). 모자라면 나머지는 선입선출.
drop function if exists erp.post_stock(text, text, text, numeric, text, text, text, text, date, text, text);
create or replace function erp.post_stock(p_id text, p_company text, p_item text, p_qty numeric, p_kind text,
  p_source_type text, p_source_id text, p_partner text, p_date date, p_note text, p_reversal_of text default null, p_lot text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_unit text; v_need numeric; v_take numeric; v_lot record; v_lot_id text; v_seq int; v_supplier text;
begin
  select unit into v_unit from erp.items where id = p_item;
  -- 비재고(SERVICE: 용역·장갑 같은 소모품)는 발주·입고 기록만 남기고 재고 수량은 안 바꾼다(2026-11-08)
  if exists (select 1 from erp.items where id = p_item and type = 'SERVICE') then
    insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, source_id, partner_id,
                                  reversal_of, effective_date, note)
    values (p_id, p_company, p_item, p_qty, false, v_unit, p_kind, p_source_type, p_source_id, p_partner, p_reversal_of, p_date, p_note);
    return;
  end if;
  insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, source_id, partner_id,
                                reversal_of, effective_date, note)
  values (p_id, p_company, p_item, p_qty, true, v_unit, p_kind, p_source_type, p_source_id, p_partner,
          p_reversal_of, p_date, p_note);
  insert into erp.stock_balances (item_id, company_id, qty, unit) values (p_item, p_company, p_qty, v_unit)
  on conflict (item_id) do update set qty = erp.stock_balances.qty + excluded.qty, updated_at = now();

  if not erp.lot_tracked(p_item) or p_qty = 0 then return; end if;

  if p_reversal_of is not null then
    -- 원래 줄이 건드린 로트를 반대로
    for v_lot in select lot_id, sum(qty) q from erp.lot_moves where ledger_id = p_reversal_of group by lot_id loop
      update erp.lots set qty_left = qty_left - v_lot.q,
             status = case when qty_left - v_lot.q > 0.0005 then 'active' else 'depleted' end
      where id = v_lot.lot_id;
      insert into erp.lot_moves (company_id, ledger_id, lot_id, qty) values (p_company, p_id, v_lot.lot_id, -v_lot.q);
    end loop;
    return;
  end if;

  if p_qty > 0 then
    select count(*) + 1 into v_seq from erp.lots where item_id = p_item and received_at = p_date and lot_no like to_char(p_date, 'YYMMDD') || '-%';
    v_supplier := coalesce((select name from erp.partners where id = p_partner), p_kind);
    v_lot_id := 'lot-' || gen_random_uuid();
    insert into erp.lots (id, company_id, item_id, received_at, qty_in, qty_left, supplier, lot_no, status)
    values (v_lot_id, p_company, p_item, p_date, p_qty, p_qty, v_supplier, to_char(p_date, 'YYMMDD') || '-' || lpad(v_seq::text, 2, '0'), 'active');
    insert into erp.lot_moves (company_id, ledger_id, lot_id, qty) values (p_company, p_id, v_lot_id, p_qty);
    return;
  end if;

  -- 나감: 오래된 로트부터
  v_need := -p_qty;
  for v_lot in select * from erp.lots where item_id = p_item and status = 'active' and qty_left > 0
               order by (id = p_lot) desc nulls last, received_at nulls first, lot_no, id for update loop
    exit when v_need <= 0.0005;
    v_take := least(v_lot.qty_left, v_need);
    update erp.lots set qty_left = qty_left - v_take,
           status = case when qty_left - v_take > 0.0005 then 'active' else 'depleted' end
    where id = v_lot.id;
    insert into erp.lot_moves (company_id, ledger_id, lot_id, qty) values (p_company, p_id, v_lot.id, -v_take);
    v_need := v_need - v_take;
  end loop;
end $$;

revoke all on function erp.post_stock(text, text, text, numeric, text, text, text, text, date, text, text, text), erp.lot_tracked(text)
  from public, anon, authenticated;

-- 로트 사용 내보내기(서류에 로트를 적을 때): 날짜 × 원료 × 로트별로 들고 난 양
create or replace function public.export_lot_moves(p_company text, p_from date, p_to date)
returns table (날짜 date, 품목 text, 로트 text, 입고일 date, 공급처 text, 종류 text, 수량 numeric, 단위 text, 근거 text)
language sql stable set search_path = '' as $$
  select l.effective_date, i.name, t.lot_no, t.received_at, t.supplier, l.kind, m.qty, i.unit, l.note
  from erp.lot_moves m join erp.stock_ledger l on l.id = m.ledger_id join erp.lots t on t.id = m.lot_id join erp.items i on i.id = t.item_id
  where m.company_id = p_company and l.effective_date between p_from and p_to
  order by l.effective_date, i.name, t.received_at, t.lot_no
$$;
revoke all on function public.export_lot_moves(text, date, date) from public, anon;
grant execute on function public.export_lot_moves(text, date, date) to authenticated;
