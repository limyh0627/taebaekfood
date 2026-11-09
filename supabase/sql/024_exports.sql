-- erp-core 저장소 supabase/exports.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 서류용 내보내기. 서류 자동 작성을 끈 회사(태백)는 이걸 엑셀로 받아 바깥에서 원료수불부·생산판매기록부·생산작업기록부를 쓴다.
-- 모두 읽기 전용이고 RLS를 따른다(security invoker) — 소속 회사 줄만 나온다.
-- 품목 칸은 서류용 품목명(items.doc_name), 비어 있으면 품목 이름(2026-11-09).
alter table erp.items add column if not exists doc_name text;

-- 원장 줄 종류 → 수불부 칸. 옛 앱의 영어 종류도 같이 묶는다.
create or replace function erp.ledger_bucket(kind text) returns text language sql immutable as $$
  select case
    when kind in ('입고', 'receive', 'unpack', '입고 취소') then '입고'
    when kind in ('생산') then '생산'
    when kind in ('생산 투입', '사용', 'consume', 'consume-lot', 'auto', '생산 취소') then '사용'
    when kind in ('출고', '출고 취소') then '출고'
    when kind in ('폐기') then '폐기'
    else '조정' end
$$;

-- 1) 일별 재고 수불: 품목 × 날짜. 기초 = 시작일 전까지 원장 합. 임가공 사용(재고 안 움직인 기록)은 따로 칸.
create or replace function public.export_stock_daily(p_company text, p_from date, p_to date, p_types text[] default null)
returns table (날짜 date, 품목 text, 단위 text, 기초 numeric, 입고 numeric, 생산 numeric, 사용 numeric, 출고 numeric,
               폐기 numeric, 조정 numeric, 기말 numeric, 임가공_사용 numeric, "L_환산_기말" numeric)
language sql stable set search_path = '' as $$
  with items as (
    select i.* from erp.items i
    where i.company_id = p_company and (p_types is null or i.type = any (p_types))
  ), days as (
    select l.item_id, l.effective_date as d,
           sum(l.qty) filter (where l.stock_effect and erp.ledger_bucket(l.kind) = '입고') as rcv,
           sum(l.qty) filter (where l.stock_effect and erp.ledger_bucket(l.kind) = '생산') as prd,
           -sum(l.qty) filter (where l.stock_effect and erp.ledger_bucket(l.kind) = '사용') as used,
           -sum(l.qty) filter (where l.stock_effect and erp.ledger_bucket(l.kind) = '출고') as shp,
           -sum(l.qty) filter (where l.stock_effect and erp.ledger_bucket(l.kind) = '폐기') as wst,
           sum(l.qty) filter (where l.stock_effect and erp.ledger_bucket(l.kind) = '조정') as adj,
           sum(l.qty) filter (where l.stock_effect) as net,
           -sum(l.qty) filter (where not l.stock_effect and l.kind = 'ledger-consume') as oem
    from erp.stock_ledger l join items i on i.id = l.item_id
    where l.effective_date between p_from and p_to
    group by 1, 2
  ), opening as (
    select l.item_id, sum(l.qty) as q from erp.stock_ledger l join items i on i.id = l.item_id
    where l.stock_effect and l.effective_date < p_from group by 1
  )
  select d.d, coalesce(i.doc_name, i.name), i.unit,
         coalesce(o.q, 0) + coalesce(sum(d.net) over w, 0) - coalesce(d.net, 0),
         coalesce(d.rcv, 0), coalesce(d.prd, 0), coalesce(d.used, 0), coalesce(d.shp, 0), coalesce(d.wst, 0), coalesce(d.adj, 0),
         coalesce(o.q, 0) + coalesce(sum(d.net) over w, 0),
         coalesce(d.oem, 0),
         case when i.density > 0 and i.display_unit is not null then round((coalesce(o.q, 0) + coalesce(sum(d.net) over w, 0)) / i.density, 3) end
  from days d join items i on i.id = d.item_id left join opening o on o.item_id = d.item_id
  window w as (partition by d.item_id order by d.d rows between unbounded preceding and current row)
  order by i.name, d.d
$$;

-- 2) 생산 실적: 날짜 × 품목. 새 앱 생산은 원장(생산 줄), 옛 앱 생산은 생산 기록에서.
create or replace function public.export_production(p_company text, p_from date, p_to date)
returns table (날짜 date, 품목 text, 수량 numeric, 단위 text, 근거 text)
language sql stable set search_path = '' as $$
  select l.effective_date, coalesce(i.doc_name, i.name), sum(l.qty), i.unit, '새 앱 생산'
  from erp.stock_ledger l join erp.items i on i.id = l.item_id
  where l.company_id = p_company and l.kind = '생산' and l.stock_effect and l.effective_date between p_from and p_to
    and not exists (select 1 from erp.stock_ledger x where x.reversal_of = l.id)
  group by 1, 2, 4
  union all
  select r.run_date, coalesce(i.doc_name, i.name), sum(r.qty), i.unit, '옛 앱 생산 기록'
  from erp.production_runs r join erp.items i on i.id = r.item_id
  where r.company_id = p_company and r.run_date between p_from and p_to and r.canceled_at is null
    and not exists (select 1 from erp.stock_ledger x where x.source_type = 'production' and x.source_id = r.id)
  group by 1, 2, 4
  order by 1, 2
$$;

-- 3) 생산 투입: 날짜 × 원료·부자재 (생산에 들어간 것). 원료수불부의 '사용'과 같은 근거.
create or replace function public.export_production_inputs(p_company text, p_from date, p_to date)
returns table (날짜 date, 품목 text, 투입량 numeric, 단위 text)
language sql stable set search_path = '' as $$
  select l.effective_date, coalesce(i.doc_name, i.name), -sum(l.qty), i.unit
  from erp.stock_ledger l join erp.items i on i.id = l.item_id
  where l.company_id = p_company and l.stock_effect and l.kind in ('생산 투입', 'consume', 'consume-lot', 'auto')
    and l.effective_date between p_from and p_to
  group by 1, 2, 4 order by 1, 2
$$;

-- 4) 판매·매입 명세서 줄 (생산판매기록부의 판매, 원료 입고 근거)
create or replace function public.export_voucher_lines(p_company text, p_from date, p_to date, p_kind text)
returns table (날짜 date, 전표번호 text, 거래처 text, 품목 text, 규격 text, 수량 numeric, 단가 numeric,
               공급가액 numeric, 세액 numeric, 합계 numeric, 면세 text, 계정 text)
language sql stable set search_path = '' as $$
  select v.date, v.voucher_no, coalesce(p.name, v.partner_name), coalesce(i.doc_name, l.name), l.spec, l.qty, l.price,
         l.supply, l.tax, l.amount, case when l.tax_exempt then '면세' else '' end, l.account_code
  from erp.vouchers v join erp.voucher_lines l on l.voucher_id = v.id left join erp.partners p on p.id = v.partner_id
  left join erp.items i on i.id = l.item_id
  where v.company_id = p_company and v.kind = p_kind and v.status = 'active' and v.date between p_from and p_to
  order by v.date, v.voucher_no, l.line_no
$$;

-- 5) 재고 원장 그대로 (모든 줄)
create or replace function public.export_ledger(p_company text, p_from date, p_to date)
returns table (날짜 date, 품목 text, 종류 text, 칸 text, 수량 numeric, 단위 text, 재고반영 text, 거래처 text, 근거 text, 메모 text)
language sql stable set search_path = '' as $$
  select l.effective_date, coalesce(i.doc_name, i.name), l.kind, erp.ledger_bucket(l.kind), l.qty, l.unit,
         case when l.stock_effect then '예' else '아니오(기록만)' end, p.name, l.source_type, l.note
  from erp.stock_ledger l join erp.items i on i.id = l.item_id left join erp.partners p on p.id = l.partner_id
  where l.company_id = p_company and l.effective_date between p_from and p_to
  order by l.effective_date, i.name, l.id
$$;

revoke all on function public.export_stock_daily(text, date, date, text[]), public.export_production(text, date, date),
  public.export_production_inputs(text, date, date), public.export_voucher_lines(text, date, date, text),
  public.export_ledger(text, date, date) from public, anon;
grant execute on function public.export_stock_daily(text, date, date, text[]), public.export_production(text, date, date),
  public.export_production_inputs(text, date, date), public.export_voucher_lines(text, date, date, text),
  public.export_ledger(text, date, date) to authenticated;
