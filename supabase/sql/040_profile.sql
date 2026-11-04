-- 나머지 컬렉션 변환을 짜기 위한 모양 조사. 컬렉션별 문서 수, 최상위 칸과 채워진 비율, 가장 긴 문서 1건(앞 800자).
\pset format unaligned
\pset tuples_only on
with totals as (
  select collection, count(*) as n, string_agg(distinct coalesce(company_id, '-'), ',') as companies
  from raw.docs group by collection
), keys as (
  select d.collection, k, count(*) as c
  from raw.docs d, jsonb_object_keys(d.data) k group by 1, 2
), fields as (
  select k.collection, string_agg(k.k || '(' || round(100.0 * k.c / t.n) || '%)', ', ' order by k.c desc, k.k) as list
  from keys k join totals t using (collection) group by 1
), sample as (
  select distinct on (collection) collection, data
  from raw.docs order by collection, length(data::text) desc
)
select format(E'\n=== %s (%s건, 회사: %s)\n칸: %s\n예시: %s', t.collection, t.n, t.companies, f.list, left(s.data::text, 800))
from totals t join fields f using (collection) join sample s using (collection)
order by t.collection;
