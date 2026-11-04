-- erp-core 저장소 supabase/haccp.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- HACCP 점검표: 온도·작업장 위생(하루 2번)·주간/월간 위생·마감·개인위생(매일), 입고검사·세척소독(매달).
-- 태백 앱 haccp_* 컬렉션을 옮긴 erp.haccp_records 한 표에 type으로 나눠 담는다. more.sql 뒤에 돈다.
--
--  · 기록 하나 = (회사, type, date, 슬롯). date는 'YYYY-MM-DD' / 'YYYY-MM' / 'YYYY-Www'(앱 주차 계산).
--    슬롯: 작업장 위생은 점검 시각(08:30·15:00), 주간/월간 위생은 주기(weekly·monthly), 나머지는 ''.
--  · 직원은 오늘(이번 주·이번 달) 기록만 쓰고, 지난 기록은 관리자만 고친다. 확인·삭제·항목 편집은 관리자.
--  · 위생·주간/월간·마감 점검표의 rows는 항목 순서로만 맞는다 → 저장할 때 그때 항목을 meta.items에 같이 남긴다.

alter table erp.haccp_records add column if not exists meta jsonb;

create or replace function erp.haccp_slot(m jsonb) returns text language sql immutable as $$
  select coalesce(m->>'slot', m->>'checkTime', m->>'cycle', '')
$$;

-- 지금 쓸 수 있는 기간 키(한국 날짜 기준)
create or replace function erp.haccp_current_key(p_type text, p_slot text) returns text language plpgsql stable set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Seoul')::date; j date;
begin
  if p_type in ('incoming', 'cleaning') or (p_type = 'periodic_sanitation' and p_slot = 'monthly') then return to_char(d, 'YYYY-MM'); end if;
  if p_type = 'periodic_sanitation' then
    j := date_trunc('year', d)::date;
    return to_char(d, 'YYYY') || '-W' || lpad((floor(((d - j) + extract(dow from j)::int + 1) / 7.0)::int + 1)::text, 2, '0');
  end if;
  return to_char(d, 'YYYY-MM-DD');
end $$;

-- p: {id?, company_id, type, date, slot?, rows, notes?, meta?}
create or replace function public.save_haccp(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_company text := p->>'company_id'; v_type text := p->>'type'; v_date text := p->>'date';
  v_slot text := coalesce(p->>'slot', ''); v_admin boolean; r erp.haccp_records; v_id text;
begin
  perform erp.assert_member(v_company);
  v_admin := v_company = any (app.my_admin_company_ids());
  if v_type not in ('temp', 'sanitation', 'periodic_sanitation', 'closing_checklist', 'personal_hygiene', 'incoming', 'cleaning') then
    raise exception '알 수 없는 점검표입니다.';
  end if;
  if coalesce(v_date, '') !~ '^\d{4}-(\d{2}|W\d{2})(-\d{2})?$' then raise exception '날짜를 확인하세요.'; end if;
  if v_type = 'sanitation' and v_slot not in ('08:30', '15:00') then raise exception '점검 시각(오전·오후)을 고르세요.'; end if;
  if v_type = 'periodic_sanitation' and v_slot not in ('weekly', 'monthly') then raise exception '주간·월간을 고르세요.'; end if;
  if not v_admin and v_date <> erp.haccp_current_key(v_type, v_slot) then raise exception '지난 기록은 관리자만 고칠 수 있습니다.'; end if;

  if nullif(p->>'id', '') is not null then
    select * into r from erp.haccp_records where id = p->>'id' and company_id = v_company and type = v_type for update;
    if not found then raise exception '기록을 찾을 수 없습니다.'; end if;
  else
    select * into r from erp.haccp_records where company_id = v_company and type = v_type and date = v_date and erp.haccp_slot(meta) = v_slot
    order by created_at desc nulls last limit 1 for update;
  end if;
  if r.id is not null and r.confirmed_at is not null and not v_admin then raise exception '관리자가 확인한 기록은 관리자만 고칠 수 있습니다.'; end if;

  if r.id is null then
    v_id := 'haccp-' || v_type || '-' || gen_random_uuid();
    insert into erp.haccp_records (id, company_id, type, date, rows, notes, created_by, created_at, meta)
    values (v_id, v_company, v_type, v_date, coalesce(p->'rows', '[]'), nullif(p->>'notes', ''), erp.actor_name(), now(),
            coalesce(p->'meta', '{}') || jsonb_build_object('slot', v_slot, 'revisionCount', 0));
  else
    v_id := r.id;
    update erp.haccp_records set rows = coalesce(p->'rows', '[]'), notes = nullif(p->>'notes', ''),
           meta = coalesce(r.meta, '{}') || coalesce(p->'meta', '{}')
                  || jsonb_build_object('slot', v_slot, 'revisionCount', coalesce((r.meta->>'revisionCount')::int, 0) + 1,
                                        'updatedBy', erp.actor_name(), 'updatedAt', now())
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.confirm_haccp(p_id text, p_confirm boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.haccp_records where id = p_id;
  if v_company is null then raise exception '기록을 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(v_company);
  update erp.haccp_records set confirmed_by = case when p_confirm then erp.actor_name() end,
         confirmed_at = case when p_confirm then now() end where id = p_id;
end $$;

create or replace function public.delete_haccp(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.haccp_records where id = p_id;
  if v_company is null then raise exception '기록을 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(v_company);
  delete from erp.haccp_records where id = p_id;
end $$;

-- 항목(템플릿) 저장. 태백 앱은 태백=키 그대로, 다른 회사={회사}--{키}로 문서를 나눴다. 있는 문서를 고치고, 없으면 {회사}--{키}로 만든다.
-- key: sanitation | weekly_sanitation | monthly_sanitation | closing_checklist → {items:[{item, standard}]}
--      temp_zones → {zones:[{name, standard}]},  personal_hygiene → {cols:[…]}
create or replace function public.save_haccp_template(p_company text, p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id text;
begin
  perform erp.assert_admin(p_company);
  if p_key not in ('sanitation', 'weekly_sanitation', 'monthly_sanitation', 'closing_checklist', 'temp_zones', 'personal_hygiene') then
    raise exception '알 수 없는 항목 묶음입니다.';
  end if;
  select id into v_id from erp.haccp_templates where company_id = p_company and id in (p_key, p_company || '--' || p_key)
  order by id = p_key desc limit 1;
  if v_id is null then
    insert into erp.haccp_templates (id, company_id, data) values (p_company || '--' || p_key, p_company, p_data);
  else
    update erp.haccp_templates set data = coalesce(data, '{}') || p_data where id = v_id;
  end if;
end $$;

revoke all on function public.save_haccp(jsonb), public.confirm_haccp(text, boolean), public.delete_haccp(text),
  public.save_haccp_template(text, text, jsonb) from public, anon;
grant execute on function public.save_haccp(jsonb), public.confirm_haccp(text, boolean), public.delete_haccp(text),
  public.save_haccp_template(text, text, jsonb) to authenticated;
