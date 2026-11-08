-- 이관 전용(erp-core에는 없다): 품목 스마트스토어 판매가를 기존 앱(raw.docs items.smartStorePrice)에서 채운다. 2026-11-08
-- 비어 있는 것만 채운다 — 다시 돌려도 새 ERP에서 고친 값은 안 덮는다(운영 DB에 SQL apply로 돌려도 안전).
alter table erp.items add column if not exists smartstore_price numeric;
update erp.items i set smartstore_price = erp.to_num(d.data->'smartStorePrice')
from raw.docs d
where d.collection = 'items' and d.id = i.id and i.smartstore_price is null and erp.to_num(d.data->'smartStorePrice') > 0;
