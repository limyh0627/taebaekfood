-- erp-core 저장소 supabase/workdoc.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 생산작업일지(편집) — 기존 앱 '생산작업일지'와 같게(2026-11-05). orderextra.sql 뒤에 돈다.
--  하루 한 장. 처음 열면 그날 생산 실적(제품·수량)과 거기 들어간 원료·로트로 줄을 채워 보여 주고,
--  사람이 제조번호·유통기한·작업자·비고를 고쳐 저장한다. 저장한 뒤엔 저장한 줄이 기준(생산을 더 하면 '실적에서 다시 채우기').

create table if not exists erp.work_documents (
  id            text primary key,           -- 회사:날짜
  company_id    text not null references erp.companies(id),
  doc_date      date not null,
  special_notes text,
  prepared_by   text,
  reviewed_by   text,
  approved_by   text,
  revision      int not null default 0,
  updated_at    timestamptz,
  updated_by    text,
  unique (company_id, doc_date)
);
create table if not exists erp.work_document_lines (
  id                text primary key,
  company_id        text not null references erp.companies(id),
  doc_id            text not null references erp.work_documents(id) on delete cascade,
  sort_order        int not null,
  manufactured_date date,
  item_id           text,
  item_name         text,
  spec              text,
  lot_no            text,      -- 제조번호
  expiry_date       date,
  qty               numeric,
  unit              text,
  raw_item_id       text,
  raw_name          text,
  raw_used_kg       numeric,
  raw_lot_no        text,
  worker            text,
  note              text,
  source_kind       text,      -- production | manual
  source_id         text
);
do $$ declare t text; begin
  foreach t in array array['work_documents', 'work_document_lines'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('drop policy if exists member_read on erp.%I', t);
    execute format('create policy member_read on erp.%I for select to authenticated using (company_id = any (app.my_company_ids()))', t);
    execute format('grant select on erp.%I to authenticated', t);
  end loop;
end $$;

-- 옛 앱 일지 옮기기(시험 이전 때만)
do $$ begin
  if to_regclass('raw.docs') is null then return; end if;
  insert into erp.work_documents (id, company_id, doc_date, special_notes, prepared_by, reviewed_by, approved_by, revision, updated_at, updated_by)
  select d.company_id || ':' || (d.data->>'documentDate'), d.company_id, (d.data->>'documentDate')::date, nullif(d.data->>'specialNotes', ''),
         nullif(d.data->>'preparedByName', ''), nullif(d.data->>'reviewedByName', ''), nullif(d.data->>'approvedByName', ''),
         coalesce((d.data->>'revision')::int, 0), erp.to_ts(d.data->>'updatedAt'), d.data->>'updatedBy'
  from raw.docs d where d.collection = 'productionWorkDocuments' and d.company_id in (select id from erp.companies) and d.data->>'documentDate' ~ '^\d{4}-\d{2}-\d{2}$'
  on conflict do nothing;
  insert into erp.work_document_lines (id, company_id, doc_id, sort_order, manufactured_date, item_id, item_name, spec, lot_no, expiry_date, qty, unit,
                                       raw_item_id, raw_name, raw_used_kg, raw_lot_no, worker, note, source_kind, source_id)
  select d.id, w.company_id, w.id, coalesce((d.data->>'sortOrder')::int, 0), erp.to_date(d.data->>'manufacturedDate'),
         (select i.id from erp.items i where i.id = d.data->>'itemId'), d.data->>'itemNameSnapshot', d.data->>'specSnapshot', nullif(d.data->>'manufacturingLotNo', ''),
         erp.to_date(d.data->>'expiryDate'), (d.data->>'productionQty')::numeric, d.data->>'productionUnit',
         (select i.id from erp.items i where i.id = d.data->>'rawItemId'), d.data->>'rawNameSnapshot', (d.data->>'rawUsedKg')::numeric, nullif(d.data->>'rawLotNoSnapshot', ''),
         nullif(d.data->>'workerNameSnapshot', ''), nullif(d.data->>'note', ''), coalesce(d.data->'source'->>'kind', 'manual'), d.data->'source'->>'sourceId'
  from raw.docs d join erp.work_documents w on w.id = d.company_id || ':' || (select x.data->>'documentDate' from raw.docs x where x.collection = 'productionWorkDocuments' and x.id = d.data->>'documentId')
  where d.collection = 'productionWorkDocumentLines'
  on conflict do nothing;
exception when others then raise notice '옛 생산작업일지 옮기기 건너뜀: %', sqlerrm;
end $$;

-- 그날 생산 실적에서 줄 만들기: 제품마다 한 줄, 원료(원료·벌크)를 여럿 썼으면 원료마다 한 줄씩(로트 함께)
create or replace function erp.work_lines_from_runs(p_company text, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'item_name', x->>'raw_name'), '[]') from (
    select jsonb_build_object('manufactured_date', r.run_date, 'item_id', r.item_id, 'item_name', i.name, 'spec', i.spec, 'qty', r.qty, 'unit', i.unit,
             'raw_item_id', m.item_id, 'raw_name', m.name, 'raw_used_kg', m.used, 'raw_lot_no', m.lots, 'source_kind', 'production', 'source_id', r.id) x
    from erp.production_runs r join erp.items i on i.id = r.item_id
    left join lateral (
      select l.item_id, ri.name, -sum(l.qty) used,
             (select string_agg(distinct t.lot_no, ', ') from erp.lot_moves lm join erp.lots t on t.id = lm.lot_id
              where lm.ledger_id = any (array_agg(l.id))) lots
      from erp.stock_ledger l join erp.items ri on ri.id = l.item_id
      where l.source_type = 'production' and l.source_id = r.id and l.qty < 0 and l.reversal_of is null and (ri.type in ('RAW', 'WIP') or ri.is_bulk)
      group by l.item_id, ri.name) m on true
    where r.company_id = p_company and r.run_date = p_date and r.canceled_at is null
  ) s $$;

-- {doc, lines, saved, fresh}: 저장본이 있으면 그것, 없으면 실적에서 만든 줄. fresh는 언제나 실적에서 만든 줄.
create or replace function public.work_document(p_company text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d erp.work_documents; v_fresh jsonb;
begin
  perform erp.assert_member(p_company);
  v_fresh := erp.work_lines_from_runs(p_company, p_date);
  select * into d from erp.work_documents where company_id = p_company and doc_date = p_date;
  if d.id is null then return jsonb_build_object('saved', false, 'doc', null, 'lines', v_fresh, 'fresh', v_fresh); end if;
  return jsonb_build_object('saved', true, 'doc', to_jsonb(d), 'fresh', v_fresh, 'lines', coalesce((
    select jsonb_agg(to_jsonb(l) - 'company_id' - 'doc_id' order by l.sort_order) from erp.work_document_lines l where l.doc_id = d.id), '[]'));
end $$;

-- p: {company_id, date, revision, special_notes, prepared_by, reviewed_by, approved_by, lines:[...]}
create or replace function public.save_work_document(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_date date := (p->>'date')::date; v_id text; d erp.work_documents; x jsonb; n int := 0;
begin
  perform erp.assert_member(v_company);
  if v_date is null then raise exception '날짜를 고르세요.'; end if;
  v_id := v_company || ':' || v_date;
  select * into d from erp.work_documents where id = v_id for update;
  if d.id is not null and d.revision <> coalesce((p->>'revision')::int, -1) then raise exception '다른 사람이 먼저 고쳤습니다. 다시 열어서 고치세요.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]')) > 200 then raise exception '줄은 200개까지입니다.'; end if;
  insert into erp.work_documents (id, company_id, doc_date) values (v_id, v_company, v_date) on conflict (id) do nothing;
  update erp.work_documents set special_notes = nullif(p->>'special_notes', ''), prepared_by = nullif(p->>'prepared_by', ''), reviewed_by = nullif(p->>'reviewed_by', ''),
         approved_by = nullif(p->>'approved_by', ''), revision = revision + 1, updated_at = now(), updated_by = erp.actor_name() where id = v_id;
  delete from erp.work_document_lines where doc_id = v_id;
  for x in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    continue when coalesce(trim(x->>'item_name'), '') = '' and coalesce(trim(x->>'raw_name'), '') = '';
    n := n + 1;
    insert into erp.work_document_lines (id, company_id, doc_id, sort_order, manufactured_date, item_id, item_name, spec, lot_no, expiry_date, qty, unit,
                                         raw_item_id, raw_name, raw_used_kg, raw_lot_no, worker, note, source_kind, source_id)
    values ('wdl-' || gen_random_uuid(), v_company, v_id, n, nullif(x->>'manufactured_date', '')::date,
            (select i.id from erp.items i where i.id = x->>'item_id' and i.company_id = v_company), nullif(trim(x->>'item_name'), ''), nullif(x->>'spec', ''),
            nullif(trim(x->>'lot_no'), ''), nullif(x->>'expiry_date', '')::date, nullif(x->>'qty', '')::numeric, nullif(x->>'unit', ''),
            (select i.id from erp.items i where i.id = x->>'raw_item_id' and i.company_id = v_company), nullif(trim(x->>'raw_name'), ''), nullif(x->>'raw_used_kg', '')::numeric,
            nullif(trim(x->>'raw_lot_no'), ''), nullif(trim(x->>'worker'), ''), nullif(trim(x->>'note'), ''), coalesce(nullif(x->>'source_kind', ''), 'manual'), nullif(x->>'source_id', ''));
  end loop;
  return n;
end $$;

revoke all on function public.work_document(text, date), public.save_work_document(jsonb) from public, anon;
grant execute on function public.work_document(text, date), public.save_work_document(jsonb) to authenticated;
revoke all on function erp.work_lines_from_runs(text, date) from public, anon, authenticated;
