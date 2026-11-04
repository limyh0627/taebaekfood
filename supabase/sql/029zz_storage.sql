-- erp-core 저장소 supabase/storage.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 서류함 파일: Supabase Storage 'files' 버킷(비공개). accounts.sql 뒤에 돈다.
-- 경로 규칙: {회사}/... — 첫 폴더가 회사라서, 소속 회사 폴더만 읽고 올릴 수 있게 막는다.
--   옛 파일(Firebase에서 복사): {회사}/legacy/{파일 id}
--   새로 올린 파일:            {회사}/up/{uuid}/{파일 이름}

insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;

drop policy if exists "files: member read" on storage.objects;
create policy "files: member read" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = any (app.my_company_ids()));
drop policy if exists "files: member upload" on storage.objects;
create policy "files: member upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = any (app.my_company_ids())
              and (storage.foldername(name))[2] = 'up');

-- 올린 파일을 서류함 목록에 넣는다.
create or replace function public.add_file(p_company text, p_category text, p_name text, p_type text, p_size bigint,
  p_path text, p_note text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := 'file-' || gen_random_uuid();
begin
  perform erp.assert_member(p_company);
  if p_path not like p_company || '/up/%' then raise exception '파일 경로가 이 회사 폴더가 아닙니다.'; end if;
  if p_category is not null and not exists (select 1 from erp.file_categories where id = p_category and company_id = p_company) then
    raise exception '분류를 찾을 수 없습니다.';
  end if;
  insert into erp.files (id, company_id, category_id, file_name, content_type, size, storage_path, note, uploaded_by, uploaded_at)
  values (v_id, p_company, p_category, p_name, p_type, p_size, p_path, nullif(p_note, ''), erp.actor_name(), now());
  return v_id;
end $$;

-- 목록에서 뺀다(파일 자체는 남긴다 — 실수로 지워도 되살릴 수 있게).
create or replace function public.hide_file(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare f erp.files;
begin
  select * into f from erp.files where id = p_id;
  if not found then raise exception '파일을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(f.company_id);
  delete from erp.files where id = p_id;
end $$;

revoke all on function public.add_file(text, text, text, text, bigint, text, text), public.hide_file(text) from public, anon;
grant execute on function public.add_file(text, text, text, text, bigint, text, text), public.hide_file(text) to authenticated;
