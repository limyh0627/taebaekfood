-- 시험 이전 3단계: raw.docs(Firestore 원본) → erp 표.
-- 참조가 깨진 줄은 넣지 않고 erp.import_rejects에 이유와 함께 남긴다.

-- ---------- 형 변환 도우미 (실패하면 null) ----------
create or replace function erp.to_date(v text) returns date language plpgsql immutable as $$
begin
  if v is null or v = '' then return null; end if;
  return left(v, 10)::date;
exception when others then return null;
end $$;

create or replace function erp.to_ts(v text) returns timestamptz language plpgsql immutable as $$
begin
  if v is null or v = '' then return null; end if;
  return v::timestamptz;
exception when others then return null;
end $$;

create or replace function erp.to_num(v jsonb) returns numeric language plpgsql immutable as $$
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  return nullif(trim(v #>> '{}'), '')::numeric;
exception when others then return null;
end $$;

-- ---------- 회사 ----------
insert into erp.companies (id, name) values ('taebaek', '태백푸드'), ('punghoe', '풍회유통');

-- 회사가 없거나 모르는 회사인 문서는 전부 거른다.
create temp view src as
select collection, id, company_id, data from raw.docs where company_id in ('taebaek', 'punghoe');

insert into erp.import_rejects
select collection, id, 'companyId 없음 또는 알 수 없는 회사: ' || coalesce(company_id, '(없음)')
from raw.docs where company_id is null or company_id not in ('taebaek', 'punghoe');

-- ---------- 거래처 ----------
insert into erp.partners (id, company_id, name, partner_type, biz_no, is_oem_factory, archived)
select id, company_id, coalesce(nullif(data->>'name', ''), '(이름 없음)'),
       coalesce(data->>'partnerType', data->>'type'), data->>'bizNo',
       coalesce((data->>'isOemFactory')::boolean, false), coalesce((data->>'archived')::boolean, false)
from src where collection = 'partners';

-- ---------- 품목 ----------
insert into erp.items (id, company_id, name, type, legacy_type, unit, cost, min_stock, procure_type, phantom, archived)
select id, company_id, coalesce(nullif(data->>'name', ''), '(이름 없음)'),
       case
         when data->>'type' = 'raw' then 'RAW'
         when data->>'type' = 'wip' then 'WIP'
         when data->>'type' in ('product', '완제품', '향미유', '고춧가루') then 'FINISHED'
         when data->>'type' = 'goods' then 'GOODS'
         when data->>'type' = 'service' then 'SERVICE'
         when data->>'type' in ('submaterial', 'label', 'cap', 'container', 'box', 'tape', '용기', '마개', '테이프', '박스', '라벨') then 'SUB'
         else 'OTHER'
       end,
       data->>'type', data->>'unit', erp.to_num(data->'cost'), erp.to_num(data->'minStock'),
       data->>'procureType', coalesce((data->>'phantom')::boolean, false), coalesce((data->>'archived')::boolean, false)
from src where collection = 'items';

-- ---------- BOM ----------
insert into erp.import_rejects
select 'item_bom', b.id, 'BOM이 없는 품목을 가리킴'
from src b
where b.collection = 'item_bom'
  and (not exists (select 1 from erp.items i where i.id = b.data->>'parent_id')
    or not exists (select 1 from erp.items i where i.id = b.data->>'child_id'));

insert into erp.item_boms (id, company_id, parent_item_id, child_item_id, quantity)
select b.id, b.company_id, b.data->>'parent_id', b.data->>'child_id', coalesce(erp.to_num(b.data->'quantity'), 0)
from src b
where b.collection = 'item_bom'
  and exists (select 1 from erp.items i where i.id = b.data->>'parent_id')
  and exists (select 1 from erp.items i where i.id = b.data->>'child_id');

-- ---------- 배합: 원료 이름 → 품목 ID ----------
-- 같은 회사의 원료·반제품 중 이름이 정확히 같은 품목 하나를 찾는다. 못 찾거나 여러 개면 비워 두고 child_name만 남긴다.
insert into erp.item_formulas (id, company_id, parent_key, child_item_id, child_name, ratio, yield_rate)
select f.id, f.company_id, f.data->>'parent_key',
       (select min(i.id) from erp.items i
         where i.company_id = f.company_id and i.name = f.data->>'child_name' and i.type in ('RAW', 'WIP')
         having count(*) = 1),
       coalesce(f.data->>'child_name', ''), coalesce(erp.to_num(f.data->'ratio'), 1), erp.to_num(f.data->'yield_rate')
from src f
where f.collection = 'item_formula' and f.data->>'parent_key' is not null;

-- ---------- 품목 단위 (박스 입수 + 매입 단위) ----------
insert into erp.item_units (id, company_id, item_id, kind, units_per_box)
select 'pack:' || p.id, p.company_id, p.data->>'item_id', 'box', erp.to_num(p.data->'units_per_box')
from src p
where p.collection = 'item_pack' and exists (select 1 from erp.items i where i.id = p.data->>'item_id');

insert into erp.item_units (id, company_id, item_id, kind, partner_id, purchase_unit, unit_kg, is_default)
select 'purchase:' || u.id, u.company_id, u.data->>'itemId', 'purchase',
       case when exists (select 1 from erp.partners p where p.id = u.data->>'partnerId') then u.data->>'partnerId' end,
       u.data->>'purchaseUnit', erp.to_num(u.data->'unitKg'), (u.data->>'isDefault')::boolean
from src u
where u.collection = 'item_purchase_unit' and exists (select 1 from erp.items i where i.id = u.data->>'itemId');

-- ---------- 거래처별 품목 ----------
insert into erp.import_rejects
select 'partner_item', x.id, '없는 거래처 또는 품목을 가리킴'
from src x
where x.collection = 'partner_item'
  and (not exists (select 1 from erp.partners p where p.id = x.data->>'partnerId')
    or not exists (select 1 from erp.items i where i.id = x.data->>'itemId'));

insert into erp.partner_items (id, company_id, partner_id, item_id, direction, price)
select x.id, x.company_id, x.data->>'partnerId', x.data->>'itemId',
       coalesce(x.data->>'Direction', x.data->>'direction'), erp.to_num(x.data->'price')
from src x
where x.collection = 'partner_item'
  and exists (select 1 from erp.partners p where p.id = x.data->>'partnerId')
  and exists (select 1 from erp.items i where i.id = x.data->>'itemId');

-- ---------- 직원 (비밀번호 해시는 애초에 내보내지 않음) ----------
insert into erp.employees (id, company_id, name, position, department, join_date, status, admin_access, auth_uid)
select id, company_id, data->>'name', data->>'position', data->>'department', erp.to_date(data->>'joinDate'),
       data->>'status', coalesce((data->>'adminAccess')::boolean, false), data->>'authUid'
from src where collection = 'employees';

-- ---------- 주문 + 줄 ----------
insert into erp.orders (id, company_id, partner_id, partner_name, status, source, ship_method, delivery_date, total_amount, created_at, delivered_at)
select o.id, o.company_id,
       case when exists (select 1 from erp.partners p where p.id = o.data->>'partnerId') then o.data->>'partnerId' end,
       o.data->>'partnerName', o.data->>'status', o.data->>'source', o.data->>'shipMethod',
       erp.to_date(o.data->>'deliveryDate'), erp.to_num(o.data->'totalAmount'),
       erp.to_ts(o.data->>'createdAt'), erp.to_ts(o.data->>'deliveredAt')
from src o where o.collection = 'orders';

insert into erp.order_lines (order_id, line_no, line_id, item_id, name, qty, price)
select o.id, l.ord::int, l.v->>'lineId',
       case when exists (select 1 from erp.items i where i.id = l.v->>'itemId') then l.v->>'itemId' end,
       l.v->>'name', erp.to_num(l.v->'quantity'), erp.to_num(l.v->'price')
from src o
cross join lateral jsonb_array_elements(case when jsonb_typeof(o.data->'items') = 'array' then o.data->'items' else '[]'::jsonb end)
  with ordinality as l(v, ord)
where o.collection = 'orders';

insert into erp.import_rejects
select 'orders', o.id || '#' || l.ord, '주문 줄이 없는 품목을 가리킴: ' || coalesce(l.v->>'itemId', '(없음)')
from src o
cross join lateral jsonb_array_elements(case when jsonb_typeof(o.data->'items') = 'array' then o.data->'items' else '[]'::jsonb end)
  with ordinality as l(v, ord)
where o.collection = 'orders' and not exists (select 1 from erp.items i where i.id = l.v->>'itemId');

-- ---------- 생산 실적 ----------
insert into erp.production_runs (id, company_id, order_id, line_id, item_id, qty, run_date, cost_total)
select r.id, r.company_id,
       case when exists (select 1 from erp.orders o where o.id = r.data->>'orderId') then r.data->>'orderId' end,
       r.data->>'lineId',
       case when exists (select 1 from erp.items i where i.id = r.data->>'itemId') then r.data->>'itemId' end,
       erp.to_num(r.data->'finishedQty'), erp.to_date(r.data->>'date'), erp.to_num(r.data->'cost')
from src r where r.collection = 'productionRecords';

-- ---------- 로트 (원료 재고 문서의 활성 로트) ----------
insert into erp.lots (id, company_id, item_id, received_at, qty_in, qty_left, supplier, lot_no, status)
select distinct on (l.v->>'id')
       l.v->>'id', r.company_id, r.data->>'rawItemId', erp.to_date(l.v->>'receivedDate'),
       erp.to_num(l.v->'kgIn'), erp.to_num(l.v->'kgRemaining'), l.v->>'supplierName', l.v->>'lotNo', l.v->>'status'
from src r
cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data->'activeLots') = 'array' then r.data->'activeLots' else '[]'::jsonb end) as l(v)
where r.collection = 'rawInventories' and l.v->>'id' is not null
  and exists (select 1 from erp.items i where i.id = r.data->>'rawItemId');

-- ---------- 실제 원장: 원료 원장 이력 ----------
-- 새 형식(appliedDeltaKg)이 있으면 그 값, 없으면 예전 형식(received − used).
-- ledger-consume(임가공 생산 기록)은 쓴 양을 남기되 재고는 움직이지 않는 줄(stock_effect false).
insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, source_id, reversal_of, effective_date, note)
select g.id, g.company_id, g.data->>'rawItemId',
       case when g.data->>'kind' = 'ledger-consume'
            then coalesce(erp.to_num(g.data->'reportedDeltaKg'), -erp.to_num(g.data->'kg'), 0)
            else coalesce(erp.to_num(g.data->'appliedDeltaKg'),
                          coalesce(erp.to_num(g.data->'received'), 0) - coalesce(erp.to_num(g.data->'used'), 0)) end,
       coalesce(g.data->>'kind', '') <> 'ledger-consume',
       'kg', coalesce(g.data->>'kind', g.data->>'type', 'legacy'),
       coalesce(g.data#>>'{source,type}', case when g.data->>'orderId' is not null then 'order' end),
       coalesce(g.data#>>'{source,id}', g.data->>'orderId'),
       g.data->>'reversalOf',
       erp.to_date(coalesce(g.data->>'effectiveAt', g.data->>'date')),
       g.data->>'note'
from src g
where g.collection = 'rawMaterialLedger' and exists (select 1 from erp.items i where i.id = g.data->>'rawItemId');

insert into erp.import_rejects
select 'rawMaterialLedger', g.id, '원장 줄의 원료 품목이 없음: ' || coalesce(g.data->>'rawItemId', g.data->>'material', '(없음)')
from src g
where g.collection = 'rawMaterialLedger' and not exists (select 1 from erp.items i where i.id = g.data->>'rawItemId');

-- ---------- 이관 시작 잔고 맞추기 ----------
-- 원료: 지금 원료 재고 문서(stockKg)와 원장 합계의 차이를 '이관 조정' 한 줄로 넣는다.
insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, effective_date, note)
select 'migrate-raw:' || (r.data->>'rawItemId'), r.company_id, r.data->>'rawItemId',
       coalesce(erp.to_num(r.data->'stockKg'), 0)
         - coalesce((select sum(s.qty) from erp.stock_ledger s where s.item_id = r.data->>'rawItemId' and s.stock_effect), 0),
       true, 'kg', '이관 조정', 'migration', current_date, '원료 재고 문서(stockKg)와 원장 합계의 차이'
from src r
where r.collection = 'rawInventories' and exists (select 1 from erp.items i where i.id = r.data->>'rawItemId');

-- 원료가 아닌 품목: 지금은 이력이 없으므로(items.stock 숫자만 있음) 현재 수량을 '기초' 한 줄로 넣는다.
insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, effective_date, note)
select 'opening:' || i.id, i.company_id, i.id, erp.to_num(s.data->'stock'), true, i.unit, '기초', 'migration', current_date, '이관 시점 items.stock'
from erp.items i
join src s on s.collection = 'items' and s.id = i.id
where i.type <> 'RAW'
  and not exists (select 1 from erp.stock_ledger l where l.item_id = i.id)
  and coalesce(erp.to_num(s.data->'stock'), 0) <> 0;

-- ---------- 잔고 = 재고를 움직이는 원장 줄의 합계 ----------
insert into erp.stock_balances (item_id, company_id, qty, unit)
select l.item_id, min(l.company_id), sum(l.qty), max(l.unit)
from erp.stock_ledger l where l.stock_effect
group by l.item_id;
