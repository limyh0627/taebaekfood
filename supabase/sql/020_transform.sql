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

create or replace function erp.to_bool(v jsonb) returns boolean language sql immutable as $$
  select case when jsonb_typeof(v) = 'boolean' then (v #>> '{}')::boolean end $$;

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
from raw.docs where (company_id is null or company_id not in ('taebaek', 'punghoe'))
  and collection in ('partners','partner_item','items','item_bom','item_formula','item_pack','item_purchase_unit',
                     'employees','orders','productionRecords','rawMaterialLedger','rawInventories');

-- ---------- 거래처 ----------
-- 옛 앱 type = 판매 채널(일반·택배·스마트스토어), partnerType = 매출처/매입처(없으면 매출처). 둘을 섞지 않는다.
insert into erp.partners (id, company_id, name, partner_type, biz_no, owner_name, email, address, is_oem_factory, archived,
                          channel, phone, mobile, fax, region, note, default_ship_method, ship_tos)
select id, company_id, coalesce(nullif(data->>'name', ''), '(이름 없음)'),
       case when data->>'partnerType' in ('매출처', '매입처', '매출+매입처', '금융기관') then data->>'partnerType' else '매출처' end,
       nullif(data->>'bizNo', ''), nullif(data->>'ownerName', ''),
       nullif(data->>'email', ''), nullif(concat_ws(' ', nullif(data->>'address', ''), nullif(data->>'addressDetail', '')), ''),
       coalesce((data->>'isOemFactory')::boolean, false), coalesce((data->>'archived')::boolean, false),
       case when data->>'type' in ('일반', '택배', '스마트스토어') then data->>'type' end,
       nullif(coalesce(data->>'phone', data->>'tel'), ''), nullif(data->>'mobile', ''), nullif(data->>'fax', ''), nullif(data->>'region', ''), nullif(data->>'note', ''),
       case when data->>'defaultShipMethod' in ('배송', '화물', '수령', '택배') then data->>'defaultShipMethod' end,
       coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', x->>'id', 'name', x->>'name', 'archived', erp.to_bool(x->'archived'),
                 'default_ship_method', x->>'defaultShipMethod')) order by o)
                 from jsonb_array_elements(case when jsonb_typeof(data->'shipTos') = 'array' then data->'shipTos' end) with ordinality t(x, o)
                 where coalesce(x->>'id', '') <> '' and coalesce(x->>'name', '') <> ''), '[]')
from src where collection = 'partners';

-- ---------- 품목 ----------
-- 기름 밀도(태백 앱 functions/src/shared/formula.ts DENSITY). 품목에 density가 적혀 있으면 그게 먼저.
create temp table density_map (name text primary key, density numeric);
insert into density_map values ('통깨참기름', 0.916), ('깨분참기름', 0.916), ('통들깨들기름', 0.924), ('수입들기름', 0.924), ('생들기름', 0.924);

insert into erp.items (id, company_id, name, type, legacy_type, unit, cost, min_stock, procure_type, is_bulk, phantom, archived, category, subtype, spec, unpackable)
select id, company_id, coalesce(nullif(data->>'name', ''), '(이름 없음)'),
       case
         when data->>'type' = 'raw' then 'RAW'
         when data->>'type' = 'wip' then 'WIP'
         -- 향미유·고춧가루는 사다 파는 상품(앱 isGoodsItem과 같은 판정)
         when data->>'type' in ('향미유', '고춧가루') or data->>'category' in ('향미유', '고춧가루') then 'GOODS'
         when data->>'type' in ('product', '완제품') then 'FINISHED'
         when data->>'type' = 'goods' then 'GOODS'
         when data->>'type' = 'service' then 'SERVICE'
         when data->>'type' in ('submaterial', 'label', 'cap', 'container', 'box', 'tape', '용기', '마개', '테이프', '박스', '라벨') then 'SUB'
         else 'OTHER'
       end,
       data->>'type', data->>'unit', erp.to_num(data->'cost'), erp.to_num(data->'minStock'),
       data->>'procureType', coalesce(data->>'subtype', '') = '벌크',
       coalesce((data->>'phantom')::boolean, false), coalesce((data->>'archived')::boolean, false),
       nullif(data->>'category', ''), nullif(data->>'subtype', ''), nullif(data->>'spec', ''), coalesce(erp.to_bool(data->'unpackable'), false)
from src where collection = 'items';

-- 벌크·원료를 L로 적어 둔 품목: 재고는 원래 kg으로 셌다(원료 원장 stockKg). 재고 단위는 kg, 화면용으로 L과 밀도를 남긴다.
update erp.items i set unit = 'kg', display_unit = 'L',
       density = coalesce(erp.to_num(s.data->'density'), (select d.density from density_map d where d.name = trim(split_part(i.name, '/', 1))))
from src s
where s.collection = 'items' and s.id = i.id and (i.is_bulk or i.type = 'RAW') and lower(coalesce(i.unit, '')) in ('l', 'ℓ', '리터');

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

insert into erp.partner_items (id, company_id, partner_id, item_id, direction, price, tax_type, account_code)
select x.id, x.company_id, x.data->>'partnerId', x.data->>'itemId',
       coalesce(x.data->>'Direction', x.data->>'direction'), erp.to_num(x.data->'price'),
       nullif(x.data->>'taxType', ''), nullif(coalesce(x.data->>'Account_Code', x.data->>'accountCode'), '')
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
insert into erp.orders (id, company_id, partner_id, partner_name, status, source, ship_method, delivery_date, total_amount, created_at, delivered_at,
                        card_no, note, shipped_at)
select o.id, o.company_id,
       case when exists (select 1 from erp.partners p where p.id = o.data->>'partnerId') then o.data->>'partnerId' end,
       o.data->>'partnerName', o.data->>'status', o.data->>'source', o.data->>'shipMethod',
       erp.to_date(o.data->>'deliveryDate'), erp.to_num(o.data->'totalAmount'),
       erp.to_ts(o.data->>'createdAt'), erp.to_ts(o.data->>'deliveredAt'),
       o.data->>'cardNo', nullif(o.data->>'note', ''), erp.to_ts(coalesce(o.data->>'shipmentConfirmedAt', o.data->>'deliveredAt'))
from src o where o.collection = 'orders';
update erp.orders x set ship_to_id = nullif(o.data->>'shipToId', ''), note_important = coalesce(erp.to_bool(o.data->'noteImportant'), false), invoice_stage = o.data->>'invoiceStage',
       accounting_excluded = coalesce(erp.to_bool(o.data->'accountingExcluded'), false), accounting_excluded_reason = o.data->>'accountingExcludedReason'
from src o where o.collection = 'orders' and o.id = x.id;

insert into erp.order_lines (order_id, line_no, line_id, item_id, name, qty, price, checked_at, checked_by, made_on, label_stage)
select o.id, l.ord::int, l.v->>'lineId',
       case when exists (select 1 from erp.items i where i.id = l.v->>'itemId') then l.v->>'itemId' end,
       -- 박스 줄은 boxQuantity(박스 수)가 임자다. 없으면 quantity가 그 품목 단위 수량(앱 stockUnits와 같은 규칙).
       l.v->>'name', coalesce(erp.to_num(l.v->'boxQuantity'), erp.to_num(l.v->'quantity')), erp.to_num(l.v->'price'),
       case when coalesce(erp.to_bool(l.v->'checked'), false) then coalesce(erp.to_ts(l.v->>'producedAt'), erp.to_ts(l.v->>'checkedAt'), erp.to_ts(o.data->>'createdAt'), now()) end,
       case when coalesce(erp.to_bool(l.v->'checked'), false) then l.v->>'checkedBy' end, erp.to_date(l.v->>'mfgDate'), l.v->>'labelType'
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
-- 앱의 잔량 규칙(src/shared/rawLedgerBalance.ts)을 따른다.
--  · 원자화 줄(balanceAfterKg 있음): 확정 잔량을 남긴 줄. qty = appliedDeltaKg, 재고 반영.
--  · 옛 줄(balanceAfterKg 없음): 실사 앵커(targetKg)로 잔량을 덮어쓰던 시절 기록이라 더해도 잔량이 안 나온다.
--    이력으로만 남기고(stock_effect false) 잔고 계산에서 뺀다.
--  · 원료마다 첫 원자화 줄 직전 잔량(= balanceAfterKg − appliedDeltaKg)을 '이관 기준' 한 줄로 넣는다.
--  · ledger-consume(임가공 생산 기록)은 쓴 양만 남기고 재고는 안 움직인다.
create temp view raw_ledger as
select g.*,
       erp.to_num(g.data->'balanceAfterKg') as bal_after,
       erp.to_num(g.data->'appliedDeltaKg') as applied,
       (erp.to_num(g.data->'balanceAfterKg') is not null) as atomic,
       row_number() over (partition by g.data->>'rawItemId'
         order by coalesce(erp.to_num(g.data->'sequence'), 0),
                  coalesce(g.data->>'recordedAt', g.data->>'createdAt', ''), g.id) as seq_no
from src g
where g.collection = 'rawMaterialLedger';

insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, source_id, reversal_of, effective_date, note, created_by)
select g.id, g.company_id, g.data->>'rawItemId',
       case when g.data->>'kind' = 'ledger-consume'
            then coalesce(erp.to_num(g.data->'reportedDeltaKg'), -erp.to_num(g.data->'kg'), 0)
            when g.atomic then coalesce(g.applied, 0)
            when g.data->'targetKg' is not null then 0
            else coalesce(erp.to_num(g.data->'received'), 0) - coalesce(erp.to_num(g.data->'used'), 0) end,
       g.atomic and coalesce(g.data->>'kind', '') <> 'ledger-consume',
       'kg', coalesce(g.data->>'kind', g.data->>'type', 'legacy'),
       coalesce(g.data#>>'{source,type}', case when g.data->>'orderId' is not null then 'order' end),
       coalesce(g.data#>>'{source,id}', g.data->>'orderId'),
       g.data->>'reversalOf',
       erp.to_date(coalesce(g.data->>'effectiveAt', g.data->>'date')),
       case when not g.atomic and g.data->'targetKg' is not null
            then concat_ws(' ', g.data->>'note', '(옛 실사: ' || (g.data->>'targetKg') || 'kg로 맞춤)')
            else g.data->>'note' end,
       nullif(g.data->>'addedBy', '')
from raw_ledger g
where exists (select 1 from erp.items i where i.id = g.data->>'rawItemId');

insert into erp.import_rejects
select 'rawMaterialLedger', g.id, '원장 줄의 원료 품목이 없음: ' || coalesce(g.data->>'rawItemId', g.data->>'material', '(없음)')
from src g
where g.collection = 'rawMaterialLedger' and not exists (select 1 from erp.items i where i.id = g.data->>'rawItemId');

-- 이관 기준: 원료마다 첫 원자화 줄 직전 잔량.
insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, effective_date, note)
select distinct on (g.data->>'rawItemId')
       'migrate-base:' || (g.data->>'rawItemId'), g.company_id, g.data->>'rawItemId',
       g.bal_after - coalesce(g.applied, 0), true, 'kg', '이관 기준', 'migration',
       erp.to_date(coalesce(g.data->>'effectiveAt', g.data->>'date')),
       '첫 원자화 줄 직전 잔량(옛 기록 시절의 마지막 잔량)'
from raw_ledger g
where g.atomic and exists (select 1 from erp.items i where i.id = g.data->>'rawItemId')
order by g.data->>'rawItemId', g.seq_no;

-- 원자화 줄이 하나도 없는 원료: 옛 기록뿐이라 지금 재고 문서(stockKg)를 이관 기준으로 쓴다.
insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, effective_date, note)
select 'migrate-base:' || (r.data->>'rawItemId'), r.company_id, r.data->>'rawItemId',
       coalesce(erp.to_num(r.data->'stockKg'), 0), true, 'kg', '이관 기준', 'migration', current_date,
       '원자화 기록이 없는 원료: 지금 재고 문서(stockKg)'
from src r
where r.collection = 'rawInventories' and exists (select 1 from erp.items i where i.id = r.data->>'rawItemId')
  and not exists (select 1 from erp.stock_ledger l where l.id = 'migrate-base:' || (r.data->>'rawItemId'));

-- ---------- 이관 시작 잔고 맞추기 ----------
-- 원료: 지금 원료 재고 문서(stockKg)와 원장 합계의 남은 차이를 '이관 조정' 한 줄로 넣는다. 0이어야 정상.
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
