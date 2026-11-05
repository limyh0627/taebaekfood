-- 기준정보(품목·BOM·거래처·거래처별 단가)와 주문 작업 표시. orders.sql 뒤에 돈다.
-- 모두 소속 회사 직원만. 지우지 않고 '안 씀(archived)'으로 숨긴다 — 옛 주문·전표가 가리키고 있을 수 있다.

-- ---------- 품목 ----------
-- p: {id?, company_id, name, type, unit, display_unit?, density?, cost?, min_stock?, procure_type?, is_bulk?, phantom?, archived?}
create or replace function public.save_item(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_member(v_company);
  if coalesce(trim(p->>'name'), '') = '' then raise exception '품목 이름을 넣으세요.'; end if;
  if p->>'type' not in ('RAW','SUB','WIP','FINISHED','GOODS','SERVICE','PALLET','OTHER') then raise exception '품목 종류를 고르세요.'; end if;
  if exists (select 1 from erp.items where company_id = v_company and name = trim(p->>'name') and id is distinct from v_id and not archived) then
    raise exception '같은 이름의 품목이 이미 있습니다.';
  end if;
  if v_id is null then
    v_id := 'item-' || gen_random_uuid();
    insert into erp.items (id, company_id, name, type, unit, archived) values (v_id, v_company, trim(p->>'name'), p->>'type', nullif(p->>'unit', ''), false);
  elsif not exists (select 1 from erp.items where id = v_id and company_id = v_company) then
    raise exception '품목을 찾을 수 없습니다.';
  end if;
  update erp.items set
    name = trim(p->>'name'), type = p->>'type', unit = nullif(p->>'unit', ''),
    display_unit = nullif(p->>'display_unit', ''), density = (p->>'density')::numeric,
    cost = (p->>'cost')::numeric, min_stock = (p->>'min_stock')::numeric, procure_type = nullif(p->>'procure_type', ''),
    is_bulk = coalesce((p->>'is_bulk')::boolean, false), phantom = coalesce((p->>'phantom')::boolean, false),
    archived = coalesce((p->>'archived')::boolean, false),
    category = case when p ? 'category' then nullif(trim(p->>'category'), '') else category end,
    spec = case when p ? 'spec' then nullif(trim(p->>'spec'), '') else spec end,
    unpackable = case when p ? 'unpackable' then coalesce((p->>'unpackable')::boolean, false) else unpackable end
  where id = v_id;
  return v_id;
end $$;

-- BOM 통째로 바꾸기. lines: [{child_item_id, quantity}]
create or replace function public.set_item_bom(p_item text, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.items where id = p_item;
  if v_company is null then raise exception '품목을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  if exists (select 1 from jsonb_array_elements(p_lines) l
             where l->>'child_item_id' = p_item
                or not exists (select 1 from erp.items i where i.id = l->>'child_item_id' and i.company_id = v_company)
                or coalesce((l->>'quantity')::numeric, 0) <= 0) then
    raise exception '자기 자신이거나 없는 품목, 또는 수량이 0인 줄이 있습니다.';
  end if;
  delete from erp.item_boms where parent_item_id = p_item;
  insert into erp.item_boms (id, company_id, parent_item_id, child_item_id, quantity)
  select 'bom-' || gen_random_uuid(), v_company, p_item, l->>'child_item_id', (l->>'quantity')::numeric
  from jsonb_array_elements(p_lines) l;
end $$;

-- ---------- 거래처 ----------
-- 기존 앱 거래처 칸: 판매 채널(일반·택배·스마트스토어), 연락처, 지역, 메모, 기본 출고 방식, 배송지 여러 곳(맨 앞이 기본).
alter table erp.partners add column if not exists channel text;
alter table erp.partners add column if not exists phone text;
alter table erp.partners add column if not exists mobile text;
alter table erp.partners add column if not exists fax text;
alter table erp.partners add column if not exists region text;
alter table erp.partners add column if not exists note text;
alter table erp.partners add column if not exists default_ship_method text;
alter table erp.partners add column if not exists ship_tos jsonb not null default '[]';   -- [{id, name, archived?, default_ship_method?}]
alter table erp.orders add column if not exists ship_to_id text;

-- p: {id?, company_id, name, partner_type, channel?, biz_no, owner_name, email, address, phone, mobile, fax, region, note, default_ship_method?, ship_tos?, is_oem_factory?, archived?}
create or replace function public.save_partner(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_member(v_company);
  if coalesce(trim(p->>'name'), '') = '' then raise exception '거래처 이름을 넣으세요.'; end if;
  if coalesce(p->>'partner_type', '') not in ('매출처', '매입처', '매출+매입처', '금융기관') then raise exception '거래처 구분을 고르세요.'; end if;
  if coalesce(p->>'channel', '') not in ('', '일반', '택배', '스마트스토어') then raise exception '판매 채널은 일반·택배·스마트스토어입니다.'; end if;
  if coalesce(p->>'default_ship_method', '') not in ('', '배송', '화물', '수령', '택배') then raise exception '출고 방식은 배송·화물·수령·택배입니다.'; end if;
  if p ? 'ship_tos' and jsonb_typeof(p->'ship_tos') <> 'array' then raise exception '배송지 형식이 맞지 않습니다.'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'ship_tos', '[]')) x where coalesce(trim(x->>'name'), '') = '' or coalesce(x->>'id', '') = '') then
    raise exception '배송지마다 이름이 있어야 합니다.';
  end if;
  if v_id is null then
    v_id := 'partner-' || gen_random_uuid();
    insert into erp.partners (id, company_id, name) values (v_id, v_company, trim(p->>'name'));
  elsif not exists (select 1 from erp.partners where id = v_id and company_id = v_company) then
    raise exception '거래처를 찾을 수 없습니다.';
  end if;
  update erp.partners set name = trim(p->>'name'), partner_type = p->>'partner_type', biz_no = nullif(trim(p->>'biz_no'), ''),
         owner_name = nullif(trim(p->>'owner_name'), ''), email = nullif(trim(p->>'email'), ''), address = nullif(trim(p->>'address'), ''),
         archived = coalesce((p->>'archived')::boolean, false),
         channel = case when p ? 'channel' then nullif(p->>'channel', '') else channel end,
         phone = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else phone end,
         mobile = case when p ? 'mobile' then nullif(trim(p->>'mobile'), '') else mobile end,
         fax = case when p ? 'fax' then nullif(trim(p->>'fax'), '') else fax end,
         region = case when p ? 'region' then nullif(trim(p->>'region'), '') else region end,
         note = case when p ? 'note' then nullif(trim(p->>'note'), '') else note end,
         default_ship_method = case when p ? 'default_ship_method' then nullif(p->>'default_ship_method', '') else default_ship_method end,
         ship_tos = case when p ? 'ship_tos' then p->'ship_tos' else ship_tos end,
         is_oem_factory = case when p ? 'is_oem_factory' then coalesce((p->>'is_oem_factory')::boolean, false) else is_oem_factory end
  where id = v_id;
  return v_id;
end $$;

-- 거래처-품목 단가 한 줄 넣기/고치기. direction: out(판매) / in(매입)
create or replace function public.set_partner_item(p_partner text, p_item text, p_direction text, p_price numeric,
  p_tax_type text default '과세', p_account_code text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text; v_id text;
begin
  select company_id into v_company from erp.partners where id = p_partner;
  if v_company is null then raise exception '거래처를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  if not exists (select 1 from erp.items where id = p_item and company_id = v_company) then raise exception '품목을 찾을 수 없습니다.'; end if;
  if p_direction not in ('in', 'out') then raise exception '판매 또는 매입을 고르세요.'; end if;
  if p_tax_type not in ('과세', '면세') then raise exception '과세 또는 면세를 고르세요.'; end if;
  select id into v_id from erp.partner_items where partner_id = p_partner and item_id = p_item and direction = p_direction limit 1;
  if v_id is null then
    v_id := 'pi-' || gen_random_uuid();
    insert into erp.partner_items (id, company_id, partner_id, item_id, direction) values (v_id, v_company, p_partner, p_item, p_direction);
  end if;
  update erp.partner_items set price = p_price, tax_type = p_tax_type, account_code = nullif(p_account_code, '') where id = v_id;
  return v_id;
end $$;

create or replace function public.remove_partner_item(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.partner_items where id = p_id;
  if v_company is null then raise exception '연결을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.partner_items where id = p_id;
end $$;

-- ---------- 주문 작업 표시 ----------
-- 현장에서 줄마다 '챙김' 표시, 주문 상태(접수·작업 중·보류) 바꾸기. 작업 완료는 생산(produce_for_order), 출고는 ship_order가 바꾼다.
alter table erp.order_lines add column if not exists checked_at timestamptz;
alter table erp.order_lines add column if not exists checked_by text;

create or replace function public.check_order_line(p_order_id text, p_line_no int, p_checked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare o erp.orders;
begin
  select * into o from erp.orders where id = p_order_id;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  update erp.order_lines set checked_at = case when p_checked then now() end, checked_by = case when p_checked then erp.actor_name() end
  where order_id = p_order_id and line_no = p_line_no;
  if p_checked and o.status = 'PENDING' then update erp.orders set status = 'PROCESSING' where id = o.id; end if;
end $$;

create or replace function public.set_order_status(p_order_id text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare o erp.orders;
begin
  select * into o from erp.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if p_status not in ('PENDING', 'PROCESSING', 'ON_HOLD') then raise exception '여기서는 접수·작업 중·보류만 바꿀 수 있습니다.'; end if;
  if o.shipped_at is not null then raise exception '출고된 주문입니다. 출고를 먼저 취소하세요.'; end if;
  update erp.orders set status = p_status where id = o.id;
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('status:' || gen_random_uuid(), o.company_id, o.id, 'status', jsonb_build_object('from', o.status, 'to', p_status), erp.actor_name(), now());
end $$;

revoke all on function public.save_item(jsonb), public.set_item_bom(text, jsonb), public.save_partner(jsonb),
  public.set_partner_item(text, text, text, numeric, text, text), public.remove_partner_item(text),
  public.check_order_line(text, int, boolean), public.set_order_status(text, text) from public, anon;
grant execute on function public.save_item(jsonb), public.set_item_bom(text, jsonb), public.save_partner(jsonb),
  public.set_partner_item(text, text, text, numeric, text, text), public.remove_partner_item(text),
  public.check_order_line(text, int, boolean), public.set_order_status(text, text) to authenticated;
