-- erp-core 저장소 supabase/customers.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 스마트스토어 고객(2026-11-08): 구매자는 거래처가 아니라 고객으로 둔다. costing.sql 뒤에 돈다.
--  거래처는 '네이버 스마트스토어' 하나(정산·미수·수수료는 여기), 주문에는 고객(이름·연락처·배송지)을 붙인다.
--  옮기기(멱등): 판매 채널이 스마트스토어인 거래처 중 전표가 없는 곳 → 고객으로 만들고, 그 주문을 네이버 거래처로 옮긴 뒤 거래처는 '안 씀'.
--  (사장님: 지금까지 스마트스토어 주문은 전표를 따로 안 냈다. 전표가 있는 거래처는 건드리지 않는다.)

alter table erp.partners add column if not exists marketplace boolean not null default false;   -- 오픈마켓 정산처(네이버 등)
create table if not exists erp.customers (
  id                text primary key,
  company_id        text not null,
  name              text not null,
  phone             text,
  address           text,
  memo              text,
  legacy_partner_id text,          -- 거래처에서 옮겨 온 고객이면 그 거래처
  created_at        timestamptz not null default now()
);
create index if not exists customers_company on erp.customers (company_id, name);
alter table erp.orders add column if not exists customer_id text references erp.customers(id);
alter table erp.customers enable row level security;
drop policy if exists member_read on erp.customers;
create policy member_read on erp.customers for select to authenticated using (company_id = any (app.my_company_ids()));
grant select on erp.customers to authenticated;

do $$
declare co text; mp text;
begin
  for co in select distinct p.company_id from erp.partners p where p.channel = '스마트스토어' and not p.marketplace loop
    -- 네이버 거래처(없으면 만든다)
    select id into mp from erp.partners where company_id = co and marketplace limit 1;
    if mp is null then
      mp := co || '-naver-smartstore';
      insert into erp.partners (id, company_id, name, partner_type, channel, archived, marketplace)
      values (mp, co, '네이버 스마트스토어', '매출처', '스마트스토어', false, true) on conflict (id) do update set marketplace = true;
    end if;
    -- 전표 없는 스마트스토어 거래처 → 고객
    create temp table if not exists _mv (pid text primary key, cid text) on commit drop;
    truncate _mv;
    insert into _mv
    select p.id, 'cust-' || p.id from erp.partners p
    where p.company_id = co and p.channel = '스마트스토어' and not p.marketplace and p.id <> mp
      and not exists (select 1 from erp.vouchers v where v.partner_id = p.id and v.status = 'active');
    insert into erp.customers (id, company_id, name, phone, address, memo, legacy_partner_id)
    select m.cid, co, p.name, coalesce(nullif(p.mobile, ''), nullif(p.phone, '')), p.address, nullif(p.note, ''), p.id
    from _mv m join erp.partners p on p.id = m.pid
    on conflict (id) do nothing;
    -- 판매 단가: 네이버 거래처에 없는 품목만 옮긴다
    insert into erp.partner_items (id, company_id, partner_id, item_id, direction, price, tax_type, account_code)
    select distinct on (x.item_id) 'pi-' || mp || '-' || x.item_id, co, mp, x.item_id, 'out', x.price, x.tax_type, x.account_code
    from erp.partner_items x join _mv m on m.pid = x.partner_id
    where coalesce(x.direction, 'out') = 'out'
      and not exists (select 1 from erp.partner_items y where y.partner_id = mp and y.item_id = x.item_id and coalesce(y.direction, 'out') = 'out')
    order by x.item_id, x.price nulls last
    on conflict (id) do nothing;
    update erp.orders o set customer_id = m.cid, partner_id = mp, partner_name = '네이버 스마트스토어'
    from _mv m where o.partner_id = m.pid and o.voucher_id is null;
    update erp.partners p set archived = true, note = trim(coalesce(p.note, '') || ' (고객으로 옮김)')
    from _mv m where p.id = m.pid and not p.archived;
  end loop;
exception when others then raise warning '스마트스토어 고객 옮기기 건너뜀: %', sqlerrm;
end $$;

-- 고객 저장(새로·고치기). p: {id?, company_id, name, phone?, address?, memo?}
create or replace function public.save_customer(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_member(v_company);
  if trim(coalesce(p->>'name', '')) = '' then raise exception '고객 이름을 넣으세요.'; end if;
  if v_id is null then
    v_id := 'cust-' || gen_random_uuid();
    insert into erp.customers (id, company_id, name) values (v_id, v_company, trim(p->>'name'));
  elsif not exists (select 1 from erp.customers where id = v_id and company_id = v_company) then
    raise exception '고객을 찾을 수 없습니다.';
  end if;
  update erp.customers set name = trim(p->>'name'), phone = nullif(trim(coalesce(p->>'phone', '')), ''),
         address = nullif(trim(coalesce(p->>'address', '')), ''), memo = nullif(trim(coalesce(p->>'memo', '')), '')
  where id = v_id;
  return v_id;
end $$;

-- 주문에 고객 붙이기·떼기(주문 저장 뒤 부른다)
create or replace function public.set_order_customer(p_order_id text, p_customer_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare o erp.orders;
begin
  select * into o from erp.orders where id = p_order_id;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if p_customer_id is not null and not exists (select 1 from erp.customers where id = p_customer_id and company_id = o.company_id) then
    raise exception '고객을 찾을 수 없습니다.';
  end if;
  update erp.orders set customer_id = p_customer_id where id = p_order_id;
end $$;

revoke all on function public.save_customer(jsonb), public.set_order_customer(text, text) from public, anon;
grant execute on function public.save_customer(jsonb), public.set_order_customer(text, text) to authenticated;
