-- erp-core 저장소 supabase/costing.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 원가 시점·월말 자동 기록(2026-11-08). jtemplates.sql 뒤에 돈다.
--  1) 매출 명세서 줄에 그 시점 품목 원가(unit_cost)를 박아 둔다 → 기간 손익의 추정 원가가 '지금 원가'가 아니라 '판 때 원가'가 된다.
--     옛 전표(이 트리거 전에 들어온 것)는 비어 있어 지금 원가로 센다.
--  2) 매달 말일 23:50(한국)에 기말재고를 저절로 기록한다(pg_cron). 손으로 기록한 달은 덮어쓰지 않는다.

alter table erp.voucher_lines add column if not exists unit_cost numeric;

create or replace function erp.stamp_sale_costs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare co text;
begin
  for co in select distinct v.company_id from new_rows n join erp.vouchers v on v.id = n.voucher_id
            where v.kind = '매출' and n.item_id is not null and n.unit_cost is null loop
    update erp.voucher_lines l set unit_cost = coalesce(c.computed, c.cost)
    from new_rows n, erp.vouchers v, erp.item_costs(co) c
    where l.voucher_id = n.voucher_id and l.line_no = n.line_no and v.id = l.voucher_id and v.company_id = co and v.kind = '매출'
      and c.item_id = l.item_id and l.unit_cost is null and coalesce(c.computed, c.cost) is not null;
  end loop;
  return null;
exception when others then return null;   -- 원가를 못 박아도 명세서 저장은 막지 않는다
end $$;
drop trigger if exists voucher_lines_stamp_cost on erp.voucher_lines;
create trigger voucher_lines_stamp_cost after insert on erp.voucher_lines
  referencing new table as new_rows for each statement execute function erp.stamp_sale_costs();
revoke all on function erp.stamp_sale_costs() from public, anon, authenticated;

-- 말일 자동 기록: 매일 23:50(한국)에 돌고, 내일이 1일이면 이달 기말재고를 남긴다
create or replace function erp.auto_inventory_snapshot() returns int
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Seoul')::date; ym text; co text; n int := 0;
begin
  if extract(day from today + 1) <> 1 then return 0; end if;
  ym := to_char(today, 'YYYY-MM');
  for co in select id from erp.companies loop
    continue when exists (select 1 from erp.inventory_snapshots where company_id = co and year_month = ym and source = 'manual');
    continue when not exists (select 1 from erp.stock_balances where company_id = co and qty > 0);
    perform erp.take_inventory_snapshot(co, ym, 'auto');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function erp.auto_inventory_snapshot() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('erp-month-end-inventory', '50 14 * * *', 'select erp.auto_inventory_snapshot()');   -- 14:50 UTC = 23:50 한국
exception when others then null;   -- pg_cron이 없는 곳(시험 DB 등)은 손으로 기록
end $$;
