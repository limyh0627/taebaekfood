-- erp-core 저장소 supabase/home.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 오늘 화면 바로가기(기존 앱 dashboardLinks). 관리자가 고친다. ledger.sql 뒤에 돈다.
create or replace function public.save_dashboard_link(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := coalesce(nullif(p->>'id', ''), 'link-' || gen_random_uuid()); v_url text := trim(coalesce(p->>'url', ''));
begin
  perform erp.assert_admin(v_company);
  if v_url = '' then raise exception '주소를 넣으세요.'; end if;
  if v_url !~* '^https?://' then v_url := 'https://' || v_url; end if;
  insert into erp.dashboard_links (id, company_id, label, url, sort_order)
  values (v_id, v_company, nullif(trim(p->>'label'), ''), v_url,
          coalesce((p->>'sort_order')::int, (select coalesce(max(sort_order), 0) + 1 from erp.dashboard_links where company_id = v_company)))
  on conflict (id) do update set label = excluded.label, url = excluded.url, sort_order = excluded.sort_order
  where erp.dashboard_links.company_id = v_company;
  return v_id;
end $$;

create or replace function public.delete_dashboard_link(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.dashboard_links where id = p_id;
  if v_company is null then raise exception '바로가기를 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(v_company);
  delete from erp.dashboard_links where id = p_id;
end $$;

revoke all on function public.save_dashboard_link(jsonb), public.delete_dashboard_link(text) from public, anon;
grant execute on function public.save_dashboard_link(jsonb), public.delete_dashboard_link(text) to authenticated;
