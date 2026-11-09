-- 이관 전용(erp-core에는 없다): 품목 서류용 품목명을 기존 앱(raw.docs items.품목)에서 채운다. 2026-11-09
-- 비어 있는 것만 채운다 — 다시 돌려도 새 ERP에서 고친 값은 안 덮는다(운영 DB에 SQL apply로 돌려도 안전).
alter table erp.items add column if not exists doc_name text;
update erp.items i set doc_name = nullif(trim(d.data->>'품목'), '')
from raw.docs d
where d.collection = 'items' and d.id = i.id and i.doc_name is null and nullif(trim(d.data->>'품목'), '') is not null;
do $$ declare n int; m int; begin
  select count(*) into n from erp.items where doc_name is not null;
  select count(*) into m from raw.docs where collection = 'items' and nullif(trim(data->>'품목'), '') is not null;
  raise notice '서류용 품목명: 채워진 품목 %개 / 기존 앱에 적힌 품목 %개', n, m;
end $$;
