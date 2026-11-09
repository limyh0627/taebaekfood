-- erp-core 저장소 supabase/contracts.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 매입계약(2026-11-09): 구매 › 매입계약. 일반(원료·부자재 사 오는 조건) / OEM(임가공 맡기는 조건).
--  계약 한 건 = 거래처 + 기간·결제 조건·로스율·메모 + 품목 줄(단가 또는 가공비, 업체가 대는 부자재, 품목 로스율, 메모).
--  저장하면 실제로 셈에 쓰는 곳에도 넣는다: 일반 → 거래처별 매입 단가(partner_items in, 발주에 들어감),
--  OEM → 임가공 계약 조건(oem_terms: 가공비·업체 부자재, 가공입고 가공비 셈)과 거래처 '임가공 공장' 표시.
--  oemflow.sql·oemstock.sql·masterdata.sql 뒤에 돈다.
create table if not exists erp.purchase_contracts (
  id            text primary key,
  company_id    text not null references erp.companies(id),
  partner_id    text not null references erp.partners(id),
  kind          text not null check (kind in ('일반', 'OEM')),
  title         text,
  start_date    date,
  end_date      date,
  payment_terms text,
  loss_rate     numeric,          -- 계약 로스율(%) — 품목 줄에 따로 없으면 이것
  note          text,
  status        text not null default 'active' check (status in ('active', 'ended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  updated_by    text
);
create table if not exists erp.purchase_contract_items (
  id               text primary key,
  contract_id      text not null references erp.purchase_contracts(id) on delete cascade,
  company_id       text not null references erp.companies(id),
  line_no          int not null default 0,
  item_id          text not null references erp.items(id),
  price            numeric,       -- 일반: 매입 단가 / OEM: 가공비 단가 (세금 포함)
  unit             text not null default 'piece' check (unit in ('kg', 'piece', 'box')),
  tax_exempt       boolean not null default false,
  supplied_item_id text references erp.items(id),   -- OEM: 업체가 대는 부자재(우리 재고에서 안 빠짐)
  supplied_price   numeric,       -- OEM: 그 부자재 값(우리에게 청구, 개당)
  loss_rate        numeric,       -- 품목 로스율(%)
  note             text
);
do $$ declare t text; begin
  foreach t in array array['purchase_contracts', 'purchase_contract_items'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('revoke all on erp.%I from anon', t);
    execute format('grant select on erp.%I to authenticated', t);
    execute format('drop policy if exists member_read on erp.%I', t);
    execute format('create policy member_read on erp.%I for select to authenticated using (company_id = any (app.my_company_ids()))', t);
  end loop;
end $$;

-- 저장(새로 만들기·고치기). p: {id?, company_id, partner_id, kind, title, start_date, end_date, payment_terms, loss_rate, note, status, items:[{item_id, price, unit, tax_exempt, supplied_item_id, supplied_price, loss_rate, note}]}
create or replace function public.save_purchase_contract(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', ''); c erp.purchase_contracts; x jsonb; n int := 0; v_price numeric; v_sp numeric;
begin
  perform erp.assert_member(v_company);
  if not exists (select 1 from erp.partners where id = p->>'partner_id' and company_id = v_company) then raise exception '거래처를 고르세요.'; end if;
  if coalesce(p->>'kind', '') not in ('일반', 'OEM') then raise exception '일반 또는 OEM을 고르세요.'; end if;
  if v_id is not null then
    select * into c from erp.purchase_contracts where id = v_id and company_id = v_company for update;
    if not found then raise exception '계약을 찾을 수 없습니다.'; end if;
  else
    v_id := 'pc-' || gen_random_uuid();
    insert into erp.purchase_contracts (id, company_id, partner_id, kind) values (v_id, v_company, p->>'partner_id', p->>'kind');
  end if;
  update erp.purchase_contracts set partner_id = p->>'partner_id', kind = p->>'kind', title = nullif(trim(p->>'title'), ''),
    start_date = nullif(p->>'start_date', '')::date, end_date = nullif(p->>'end_date', '')::date,
    payment_terms = nullif(trim(p->>'payment_terms'), ''), loss_rate = nullif(p->>'loss_rate', '')::numeric, note = nullif(trim(p->>'note'), ''),
    status = coalesce(nullif(p->>'status', ''), 'active'), updated_at = now(), updated_by = erp.actor_name()
  where id = v_id;
  delete from erp.purchase_contract_items where contract_id = v_id;
  for x in select e from jsonb_array_elements(coalesce(p->'items', '[]')) e where coalesce(e->>'item_id', '') <> '' loop
    n := n + 1;
    if not exists (select 1 from erp.items where id = x->>'item_id' and company_id = v_company) then raise exception '품목을 찾을 수 없습니다.'; end if;
    v_price := nullif(x->>'price', '')::numeric; v_sp := nullif(x->>'supplied_price', '')::numeric;
    insert into erp.purchase_contract_items (id, contract_id, company_id, line_no, item_id, price, unit, tax_exempt, supplied_item_id, supplied_price, loss_rate, note)
    values ('pci-' || gen_random_uuid(), v_id, v_company, n, x->>'item_id', v_price, coalesce(nullif(x->>'unit', ''), 'piece'),
            coalesce((x->>'tax_exempt')::boolean, false), nullif(x->>'supplied_item_id', ''), v_sp, nullif(x->>'loss_rate', '')::numeric, nullif(trim(x->>'note'), ''));
    -- 쓰는 곳에 넣기(진행 중 계약만)
    if coalesce(nullif(p->>'status', ''), 'active') = 'active' then
      if p->>'kind' = '일반' and v_price is not null then
        perform public.set_partner_item(p->>'partner_id', x->>'item_id', 'in', v_price, case when coalesce((x->>'tax_exempt')::boolean, false) then '면세' else '과세' end, null);
      elsif p->>'kind' = 'OEM' then
        if v_price is not null then
          insert into erp.oem_terms (id, company_id, partner_id, item_id, kind, unit, price, tax_exempt)
          values ('oemt-' || gen_random_uuid(), v_company, p->>'partner_id', x->>'item_id', 'processing', coalesce(nullif(x->>'unit', ''), 'piece'), v_price, coalesce((x->>'tax_exempt')::boolean, false))
          on conflict (partner_id, item_id, kind) do update set unit = excluded.unit, price = excluded.price, tax_exempt = excluded.tax_exempt;
        end if;
        if nullif(x->>'supplied_item_id', '') is not null or v_sp is not null then
          insert into erp.oem_terms (id, company_id, partner_id, item_id, kind, unit, price, tax_exempt, supplied_item_id)
          values ('oemt-' || gen_random_uuid(), v_company, p->>'partner_id', x->>'item_id', 'packaging', 'piece', coalesce(v_sp, 0), coalesce((x->>'tax_exempt')::boolean, false), nullif(x->>'supplied_item_id', ''))
          on conflict (partner_id, item_id, kind) do update set price = excluded.price, tax_exempt = excluded.tax_exempt, supplied_item_id = excluded.supplied_item_id;
        end if;
      end if;
    end if;
  end loop;
  if p->>'kind' = 'OEM' then update erp.partners set is_oem_factory = true where id = p->>'partner_id' and not coalesce(is_oem_factory, false); end if;
  return v_id;
end $$;

create or replace function public.delete_purchase_contract(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.purchase_contracts where id = p_id;
  if v_company is null then raise exception '계약을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.purchase_contracts where id = p_id;   -- 단가·가공비 조건(거래처 단가·oem_terms)은 그대로 둔다
end $$;

revoke all on function public.save_purchase_contract(jsonb), public.delete_purchase_contract(text) from public, anon;
grant execute on function public.save_purchase_contract(jsonb), public.delete_purchase_contract(text) to authenticated;
