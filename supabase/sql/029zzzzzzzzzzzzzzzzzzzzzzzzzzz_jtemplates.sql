-- erp-core 저장소 supabase/jtemplates.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 전표 템플릿(2026-11-08). push.sql 뒤에 돈다.
--  일반전표(일반·대체)를 낼 때 줄(계정·차대변·금액·적요)·거래처·적요를 미리 채워 주는 저장본. 손으로 부를 때만 쓴다.
--  정기 전표(voucher_templates: 매달 날짜가 되면 챙기는 통장 입출금)와는 따로 둔다(사장님 결정 2026-11-08).

create table if not exists erp.journal_templates (
  id         text primary key,
  company_id text not null,
  name       text not null,
  kind       text not null default '비용' check (kind in ('비용', '대체')),
  partner_id text,
  memo       text,
  lines      jsonb not null default '[]',   -- [{account_code, side: 차변|대변, amount(빈칸 가능), note}]
  created_by text,
  updated_at timestamptz not null default now()
);
alter table erp.journal_templates enable row level security;
drop policy if exists member_read on erp.journal_templates;
create policy member_read on erp.journal_templates for select to authenticated using (company_id = any (app.my_company_ids()));
grant select on erp.journal_templates to authenticated;

-- 분류(2026-11-09): 템플릿 관리에서 묶어 보는 이름. 비어 있으면 이름으로 짐작해 채운다(한 번만, 사람이 고친 건 안 건드림).
alter table erp.journal_templates add column if not exists category text;
create or replace function erp.guess_template_category(p_name text) returns text language sql immutable set search_path = '' as $$
  select case
    when p_name ~ '(감가상각|충당)' then '결산'
    when p_name ~ '이자' then '이자'
    when p_name ~ '(대출|상환|할부|차입|카드론|카드대금)' then '대출·상환'
    when p_name ~ '(부가세|원천|소득세|주민세)' then '세금'
    when p_name ~ '(급여|상여|성과급|4대보험|퇴직|내일채움)' then '급여·인건비'
    when p_name ~ '(임대|리스|렌탈|대여료)' then '임차·리스'
    when p_name ~ '보험' then '보험'
    when p_name ~* '(전기|수도|통신|세스코|기장료|조정료|kpp)' then '관리비·공과금'
    when p_name ~ '(보증금|선수금|선급금|수금|지불|인출금|적금)' then '자금 이동'
    else '기타' end
$$;
update erp.journal_templates set category = erp.guess_template_category(name) where category is null;

-- 저장(새로 또는 고치기). 같은 회사에서 이름이 겹치면 막는다.
create or replace function public.save_journal_template(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', ''); v_name text := trim(coalesce(p->>'name', '')); v_bad text;
begin
  perform erp.assert_member(v_company);
  if v_name = '' then raise exception '템플릿 이름을 넣으세요.'; end if;
  if coalesce(p->>'kind', '비용') not in ('비용', '대체') then raise exception '일반·대체 중에서 고르세요.'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception '줄이 하나도 없습니다.'; end if;
  select string_agg(distinct coalesce(nullif(l->>'account_code', ''), '(빈칸)'), ', ') into v_bad from jsonb_array_elements(p->'lines') l
  where not exists (select 1 from erp.accounts a where a.company_id = v_company and a.code = l->>'account_code');
  if v_bad is not null then raise exception '없는 계정이 있습니다: %', v_bad; end if;
  if exists (select 1 from jsonb_array_elements(p->'lines') l where coalesce(l->>'side', '') not in ('차변', '대변')) then raise exception '차변·대변을 고르세요.'; end if;
  if exists (select 1 from erp.journal_templates where company_id = v_company and name = v_name and id is distinct from v_id) then
    raise exception '같은 이름의 템플릿이 있습니다.';
  end if;
  if nullif(p->>'partner_id', '') is not null and not exists (select 1 from erp.partners where id = p->>'partner_id' and company_id = v_company) then
    raise exception '거래처를 찾을 수 없습니다.';
  end if;
  if v_id is null then
    v_id := 'JT-' || gen_random_uuid();
    insert into erp.journal_templates (id, company_id, name, created_by) values (v_id, v_company, v_name, erp.my_name(v_company));
  elsif not exists (select 1 from erp.journal_templates where id = v_id and company_id = v_company) then
    raise exception '템플릿을 찾을 수 없습니다.';
  end if;
  update erp.journal_templates set name = v_name, kind = coalesce(p->>'kind', '비용'), partner_id = nullif(p->>'partner_id', ''),
         category = coalesce(nullif(trim(coalesce(p->>'category', '')), ''), erp.guess_template_category(v_name)),
         memo = nullif(trim(coalesce(p->>'memo', '')), ''), updated_at = now(),
         lines = (select jsonb_agg(jsonb_build_object('account_code', l->>'account_code', 'side', l->>'side',
                                                      'amount', case when coalesce(l->>'amount', '') ~ '^[0-9]+(\.[0-9]+)?$' and (l->>'amount')::numeric > 0 then (l->>'amount')::numeric end,
                                                      'note', nullif(trim(coalesce(l->>'note', '')), '')) order by ord)
                  from jsonb_array_elements(p->'lines') with ordinality x(l, ord))
  where id = v_id;
  return v_id;
end $$;

create or replace function public.delete_journal_template(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.journal_templates where id = p_id;
  if v_company is null then raise exception '템플릿을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.journal_templates where id = p_id;
end $$;

revoke all on function public.save_journal_template(jsonb), public.delete_journal_template(text) from public, anon;
grant execute on function public.save_journal_template(jsonb), public.delete_journal_template(text) to authenticated;
