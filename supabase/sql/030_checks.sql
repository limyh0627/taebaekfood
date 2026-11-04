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

\echo '## 7. 차이 큰 원료 6개: 원장 줄 종류별 합계 (어디서 틀어졌는지)'
with top as (
  select item_id from erp.stock_ledger
  where id like 'migrate-raw:%' and abs(qty) >= 0.001
  order by abs(qty) desc limit 6
)
select i.name as "원료", l.kind as "줄 종류", l.stock_effect as "재고 반영",
       count(*) as "줄 수", round(sum(l.qty), 1) as "합계(kg)",
       min(l.effective_date) as "처음", max(l.effective_date) as "마지막"
from erp.stock_ledger l join erp.items i on i.id = l.item_id
where l.item_id in (select item_id from top) and l.id not like 'migrate-raw:%'
group by 1, 2, 3 order by 1, 5;

\echo '## 7-1. 수량 칸이 하나도 없어 0으로 들어간 원장 줄 (형식 문제 의심)'
select coalesce(r.data->>'kind', r.data->>'type', '(없음)') as "줄 종류", count(*) as "건수",
       string_agg(distinct k, ', ') as "있는 칸 예시"
from raw.docs r
cross join lateral (select k from jsonb_object_keys(r.data) k limit 40) keys
where r.collection = 'rawMaterialLedger'
  and r.data->'appliedDeltaKg' is null and r.data->'reportedDeltaKg' is null
  and r.data->'received' is null and r.data->'used' is null
group by 1 order by 2 desc limit 10;
