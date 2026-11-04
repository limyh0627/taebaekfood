-- 시험 이전 4단계: 옮긴 결과 대조. 결과는 Actions 요약에 표로 찍힌다.

\echo '## 1. 원본 대비 옮긴 수'
select x.collection as "Firestore 컬렉션", x.raw as "원본 문서", x.moved as "옮긴 줄"
from (
  select 'partners' as collection, (select count(*) from raw.docs where collection = 'partners') as raw, (select count(*) from erp.partners) as moved
  union all select 'items', (select count(*) from raw.docs where collection = 'items'), (select count(*) from erp.items)
  union all select 'item_bom', (select count(*) from raw.docs where collection = 'item_bom'), (select count(*) from erp.item_boms)
  union all select 'item_formula', (select count(*) from raw.docs where collection = 'item_formula'), (select count(*) from erp.item_formulas)
  union all select 'item_pack + item_purchase_unit', (select count(*) from raw.docs where collection in ('item_pack', 'item_purchase_unit')), (select count(*) from erp.item_units)
  union all select 'partner_item', (select count(*) from raw.docs where collection = 'partner_item'), (select count(*) from erp.partner_items)
  union all select 'employees', (select count(*) from raw.docs where collection = 'employees'), (select count(*) from erp.employees)
  union all select 'orders', (select count(*) from raw.docs where collection = 'orders'), (select count(*) from erp.orders)
  union all select 'orders 줄', null, (select count(*) from erp.order_lines)
  union all select 'productionRecords', (select count(*) from raw.docs where collection = 'productionRecords'), (select count(*) from erp.production_runs)
  union all select 'rawMaterialLedger', (select count(*) from raw.docs where collection = 'rawMaterialLedger'), (select count(*) from erp.stock_ledger where source_type is distinct from 'migration')
  union all select 'rawInventories 활성 로트', null, (select count(*) from erp.lots)
) x;

\echo '## 2. 못 옮긴 줄 (이유별)'
select collection as "컬렉션", regexp_replace(reason, ':.*$', '') as "이유", count(*) as "건수"
from erp.import_rejects group by 1, 2 order by 3 desc;

\echo '## 3. 배합 원료 이름 → 품목 ID 연결'
select count(*) filter (where child_item_id is not null) as "연결됨",
       count(*) filter (where child_item_id is null) as "못 찾음"
from erp.item_formulas;

\echo '## 3-1. 못 찾은 배합 원료 이름 (상위 20)'
select company_id as "회사", child_name as "원료 이름", count(*) as "배합 줄 수"
from erp.item_formulas where child_item_id is null group by 1, 2 order by 3 desc limit 20;

\echo '## 4. 원료: 원장 이력 합계와 지금 재고 문서의 차이 (이관 조정 줄, 큰 순 20)'
select i.company_id as "회사", i.name as "원료", round(l.qty, 3) as "차이(kg)"
from erp.stock_ledger l join erp.items i on i.id = l.item_id
where l.id like 'migrate-raw:%' and abs(l.qty) >= 0.001
order by abs(l.qty) desc limit 20;

\echo '## 4-1. 원료 차이 요약'
select count(*) filter (where abs(qty) < 0.001) as "원장과 일치",
       count(*) filter (where abs(qty) >= 0.001) as "차이 있음",
       round(sum(abs(qty)), 1) as "차이 합계(kg)"
from erp.stock_ledger where id like 'migrate-raw:%';

\echo '## 5. 회사별 품목·잔고'
select c.id as "회사",
       (select count(*) from erp.items i where i.company_id = c.id) as "품목",
       (select count(*) from erp.stock_balances b where b.company_id = c.id) as "잔고 있는 품목",
       (select count(*) from erp.stock_balances b where b.company_id = c.id and b.qty < 0) as "음수 잔고"
from erp.companies c;

\echo '## 6. DB 크기'
select pg_size_pretty(pg_database_size(current_database())) as "전체 DB",
       pg_size_pretty(pg_total_relation_size('raw.docs')) as "raw(원본 복사)",
       pg_size_pretty((select sum(pg_total_relation_size(format('erp.%I', tablename))) from pg_tables where schemaname = 'erp')::bigint) as "erp(새 표)";

\echo '## 7. 원자화 줄 사슬 끊김: 앞 줄 잔량 + 이번 변화 ≠ 이번 잔량 (원료별)'
with a as (
  select data->>'rawItemId' as item_id, id,
         (data->>'balanceAfterKg')::numeric as bal, coalesce((data->>'appliedDeltaKg')::numeric, 0) as applied,
         lag((data->>'balanceAfterKg')::numeric) over (partition by data->>'rawItemId'
           order by coalesce((data->>'sequence')::numeric, 0), coalesce(data->>'recordedAt', data->>'createdAt', ''), id) as prev
  from raw.docs where collection = 'rawMaterialLedger' and jsonb_typeof(data->'balanceAfterKg') = 'number'
)
select i.name as "원료", count(*) as "끊긴 곳", round(sum(a.bal - a.prev - a.applied), 1) as "끊긴 양 합계(kg)"
from a join erp.items i on i.id = a.item_id
where a.prev is not null and abs(a.bal - a.prev - a.applied) >= 0.001
group by 1 order by abs(sum(a.bal - a.prev - a.applied)) desc limit 20;

\echo '## 7-1. 원료별 이관 기준(옛 기록 마지막 잔량)과 남은 차이'
select i.name as "원료",
       round(b.qty, 1) as "이관 기준(kg)",
       round(r.qty, 3) as "남은 차이(kg)"
from erp.stock_ledger r
join erp.items i on i.id = r.item_id
left join erp.stock_ledger b on b.id = 'migrate-base:' || r.item_id
where r.id like 'migrate-raw:%'
order by abs(r.qty) desc limit 20;

\echo '## 7-2. 첫 원자화 줄보다 늦게 들어온 옛 줄 (잔고에서 빠졌을 수 있음)'
with first_atomic as (
  select data->>'rawItemId' as item_id, min(coalesce(data->>'recordedAt', data->>'createdAt')) as t
  from raw.docs where collection = 'rawMaterialLedger' and jsonb_typeof(data->'balanceAfterKg') = 'number' group by 1
)
select i.name as "원료", coalesce(d.data->>'kind', d.data->>'type', '(없음)') as "줄 종류", count(*) as "건수",
       round(sum(coalesce((d.data->>'received')::numeric, 0) - coalesce((d.data->>'used')::numeric, 0)), 1) as "입고−사용(kg)"
from raw.docs d join first_atomic f on f.item_id = d.data->>'rawItemId'
join erp.items i on i.id = f.item_id
where d.collection = 'rawMaterialLedger' and d.data->'balanceAfterKg' is null
  and coalesce(d.data->>'recordedAt', d.data->>'createdAt') > f.t
group by 1, 2 order by 1, 2;
