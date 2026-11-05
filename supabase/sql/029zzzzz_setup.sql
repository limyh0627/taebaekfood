-- erp-core 저장소 supabase/setup.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 회사 정보·매입 단위·기초잔액(거래처·통장·차입금). masterdata.sql 뒤에 돈다.

-- ---------- 회사 정보 ----------
-- 태백 앱 settings/{회사} 문서와 같은 자리(id = 회사 코드). 거래명세서 '공급자' 칸에 찍힌다.
create or replace function public.save_company_info(p_company text, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_clean jsonb;
begin
  perform erp.assert_admin(p_company);
  select coalesce(jsonb_object_agg(key, to_jsonb(trim(value))), '{}') into v_clean
  from jsonb_each_text(p)
  where key in ('name', 'ceoName', 'bizNo', 'bizType', 'bizItem', 'address', 'phone', 'fax', 'email', 'bankAccount');
  if coalesce(v_clean->>'name', '') = '' then raise exception '상호를 넣으세요.'; end if;
  if coalesce(v_clean->>'bizNo', '') !~ '^\d{3}-?\d{2}-?\d{5}$' then raise exception '사업자등록번호는 숫자 10자리입니다.'; end if;
  insert into erp.settings (id, company_id, data) values (p_company, p_company, v_clean)
  on conflict (id) do update set data = coalesce(erp.settings.data, '{}') || excluded.data;
end $$;

-- ---------- 매입 단위 ----------
-- 예: 참깨 1포대 = 40kg. 거래처를 비우면 모든 매입처 공통. 발주에서 포대로 넣으면 kg으로 바꿔 저장한다.
-- p: {id?, item_id, partner_id?, purchase_unit, unit_kg, is_default?}
create or replace function public.save_purchase_unit(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text; v_id text := nullif(p->>'id', ''); v_partner text := nullif(p->>'partner_id', '');
begin
  select company_id into v_company from erp.items where id = p->>'item_id';
  if v_company is null then raise exception '품목을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  if coalesce(trim(p->>'purchase_unit'), '') = '' then raise exception '단위 이름을 넣으세요(예: 포대).'; end if;
  if coalesce((p->>'unit_kg')::numeric, 0) <= 0 then raise exception '한 단위가 재고 단위로 얼마인지 넣으세요.'; end if;
  if v_partner is not null and not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then
    raise exception '거래처를 찾을 수 없습니다.';
  end if;
  if v_id is null then
    v_id := 'unit-' || gen_random_uuid();
    insert into erp.item_units (id, company_id, item_id, kind) values (v_id, v_company, p->>'item_id', 'purchase');
  elsif not exists (select 1 from erp.item_units where id = v_id and item_id = p->>'item_id' and kind = 'purchase') then
    raise exception '매입 단위를 찾을 수 없습니다.';
  end if;
  if coalesce((p->>'is_default')::boolean, false) then
    update erp.item_units set is_default = false
    where item_id = p->>'item_id' and kind = 'purchase' and partner_id is not distinct from v_partner and id <> v_id;
  end if;
  update erp.item_units set partner_id = v_partner, purchase_unit = trim(p->>'purchase_unit'),
         unit_kg = (p->>'unit_kg')::numeric, is_default = coalesce((p->>'is_default')::boolean, false)
  where id = v_id;
  return v_id;
end $$;

create or replace function public.remove_purchase_unit(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.item_units where id = p_id and kind = 'purchase';
  if v_company is null then raise exception '매입 단위를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.item_units where id = p_id;
end $$;

-- ---------- 기초잔액 ----------
-- 태백 앱처럼 기초 전표 한 장으로 남긴다: 상대 계정은 375 이월이익잉여금. 같은 대상은 같은 id라 다시 넣으면 고쳐진다.
-- 금액 0이면 그 기초 전표를 취소한다.
create or replace function erp.put_opening(p_id text, p_company text, p_date date, p_partner text, p_no text, p_memo text,
  p_amount numeric, p_debit_code text, p_debit_name text, p_credit_code text, p_credit_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_amount is null or p_amount < 0 or p_amount <> trunc(p_amount) then raise exception '금액은 0 이상 원 단위입니다.'; end if;
  if p_amount = 0 then
    update erp.vouchers set status = 'canceled' where id = p_id and company_id = p_company;
    return;
  end if;
  if p_date is null then raise exception '기초일을 넣으세요.'; end if;
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, supply, tax, amount, memo,
                            created_by, created_at, legacy_collection)
  values (p_id, p_company, p_no, p_date, '기초', p_partner, (select name from erp.partners where id = p_partner),
          p_amount, 0, p_amount, p_memo, erp.actor_name(), now(), 'app')
  on conflict (id) do update set date = excluded.date, supply = excluded.supply, tax = 0, amount = excluded.amount,
          status = 'active', memo = excluded.memo, partner_id = excluded.partner_id, partner_name = excluded.partner_name;
  delete from erp.voucher_lines where voucher_id = p_id;
  insert into erp.voucher_lines (voucher_id, line_no, line_kind, name, qty, price, supply, tax, amount, account_code, side, tax_exempt)
  values (p_id, 1, 'account', p_debit_name, 1, p_amount, p_amount, 0, p_amount, p_debit_code, '차변', true),
         (p_id, 2, 'account', p_credit_name, 1, p_amount, p_amount, 0, p_amount, p_credit_code, '대변', true);
end $$;
revoke all on function erp.put_opening(text, text, date, text, text, text, numeric, text, text, text, text) from public, anon, authenticated;

-- 거래처 기초: 108 받을 돈 / 251 줄 돈
create or replace function public.set_partner_opening(p_company text, p_partner text, p_code text, p_amount numeric, p_date date)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id text;
begin
  perform erp.assert_admin(p_company);
  if not exists (select 1 from erp.partners where id = p_partner and company_id = p_company) then raise exception '거래처를 찾을 수 없습니다.'; end if;
  if p_code not in ('108', '251') then raise exception '받을 돈(108) 또는 줄 돈(251)을 고르세요.'; end if;
  v_id := 'opening-partner-' || p_company || '-' || p_date || '-' || p_partner || '-' || p_code;
  if p_code = '108' then
    perform erp.put_opening(v_id, p_company, p_date, p_partner, '기초-' || replace(p_date::text, '-', '') || '-' || p_partner || '-108',
                            '기초 미수금', p_amount, '108', '기초 미수금(이월)', '375', '기초 이월이익잉여금');
  else
    perform erp.put_opening(v_id, p_company, p_date, p_partner, '기초-' || replace(p_date::text, '-', '') || '-' || p_partner || '-251',
                            '기초 미지급금', p_amount, '375', '기초 이월이익잉여금', '251', '기초 미지급금(이월)');
  end if;
  return v_id;
end $$;

-- 통장: 만들기·고치기 + 기초 잔액 전표(현금 102 / 예금 103). 카드는 기초 전표 없음.
-- p: {id?, company_id, name, type(통장|현금|카드), opening_balance, opening_date, active?}
create or replace function public.save_cash_account(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', ''); v_bal numeric := coalesce((p->>'opening_balance')::numeric, 0);
        v_type text := coalesce(nullif(p->>'type', ''), '통장'); v_date date := (p->>'opening_date')::date;
begin
  perform erp.assert_admin(v_company);
  if coalesce(trim(p->>'name'), '') = '' then raise exception '통장 이름을 넣으세요.'; end if;
  if v_type not in ('통장', '현금', '카드') then raise exception '통장·현금·카드 중에서 고르세요.'; end if;
  if v_bal <> 0 and v_date is null then raise exception '기초 잔액이 있으면 기초일을 넣으세요.'; end if;
  if v_id is null then
    v_id := 'cash-' || gen_random_uuid();
    insert into erp.cash_accounts (id, company_id, name) values (v_id, v_company, trim(p->>'name'));
  elsif not exists (select 1 from erp.cash_accounts where id = v_id and company_id = v_company) then
    raise exception '통장을 찾을 수 없습니다.';
  end if;
  update erp.cash_accounts set name = trim(p->>'name'), type = v_type, opening_balance = v_bal, opening_date = v_date,
         active = coalesce((p->>'active')::boolean, true)
  where id = v_id;
  perform erp.put_opening('opening-cash-' || v_company || '-' || v_id, v_company, v_date, null, '기초계좌-' || v_id, '기초 잔액',
                          case when v_type = '카드' then 0 else v_bal end,
                          case when v_type = '현금' then '102' else '103' end, trim(p->>'name'), '375', '기초 이월이익잉여금');
  return v_id;
end $$;

-- 차입금: 만들기·고치기 + 기초 원금 전표 (차) 375 (대) 260 단기 / 293 장기
-- p: {id?, company_id, name, lender_name, partner_id?, account_code, opening_date, opening_principal, maturity_date?}
create or replace function public.save_loan(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', ''); v_amt numeric := coalesce((p->>'opening_principal')::numeric, 0);
        v_partner text := nullif(p->>'partner_id', '');
begin
  perform erp.assert_admin(v_company);
  if coalesce(trim(p->>'name'), '') = '' then raise exception '대출 이름을 넣으세요.'; end if;
  if p->>'account_code' not in ('260', '293') then raise exception '단기(260) 또는 장기(293) 차입금을 고르세요.'; end if;
  if v_partner is not null and not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then
    raise exception '거래처를 찾을 수 없습니다.';
  end if;
  if v_id is null then
    v_id := 'loan-' || gen_random_uuid();
    insert into erp.loan_contracts (id, company_id, name) values (v_id, v_company, trim(p->>'name'));
  elsif not exists (select 1 from erp.loan_contracts where id = v_id and company_id = v_company) then
    raise exception '대출을 찾을 수 없습니다.';
  end if;
  update erp.loan_contracts set name = trim(p->>'name'), lender_name = nullif(trim(p->>'lender_name'), ''), partner_id = v_partner,
         account_code = p->>'account_code', opening_date = (p->>'opening_date')::date, opening_principal = v_amt,
         maturity_date = (p->>'maturity_date')::date
  where id = v_id;
  perform erp.put_opening('opening-loan-' || v_company || '-' || v_id, v_company, (p->>'opening_date')::date, v_partner,
                          '기초대출-' || v_id, '기초 차입금', v_amt, '375', '기초 이월이익잉여금', p->>'account_code', trim(p->>'name'));
  return v_id;
end $$;

revoke all on function public.save_company_info(text, jsonb), public.save_purchase_unit(jsonb), public.remove_purchase_unit(text),
  public.set_partner_opening(text, text, text, numeric, date), public.save_cash_account(jsonb), public.save_loan(jsonb) from public, anon;
grant execute on function public.save_company_info(text, jsonb), public.save_purchase_unit(jsonb), public.remove_purchase_unit(text),
  public.set_partner_opening(text, text, text, numeric, date), public.save_cash_account(jsonb), public.save_loan(jsonb) to authenticated;

-- 품목별 기초 재고 금액(기존 앱 재무제표 > 기초 설정과 같음): 품목마다 기초 전표 한 장(146 상품·제품 재고 / 375 이월이익잉여금).
-- 옛 앱 전표와 같은 id라 다시 넣으면 고쳐지고, 금액 0이면 취소된다. 재고 수량은 바꾸지 않는다(수량은 재고 화면 실사).
create or replace function public.set_inventory_opening(p_company text, p_item text, p_date date, p_qty numeric, p_value numeric) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := 'opening-inventory-' || p_company || '-' || p_item; i erp.items;
begin
  perform erp.assert_admin(p_company);
  select * into i from erp.items where id = p_item and company_id = p_company;
  if i.id is null then raise exception '품목을 찾을 수 없습니다.'; end if;
  if coalesce(p_value, 0) > 0 and coalesce(p_qty, 0) <= 0 then raise exception '기초 수량을 넣으세요.'; end if;
  perform erp.put_opening(v_id, p_company, p_date, null, '기초재고-' || p_item,
                          i.name || ' ' || coalesce(p_qty, 0) || coalesce(i.unit, '') || ' 기초 재고', coalesce(p_value, 0), '146', i.name, '375', '기초 이월이익잉여금');
  if coalesce(p_value, 0) > 0 then
    update erp.voucher_lines set qty = p_qty, price = round(p_value / p_qty, 2), spec = i.spec where voucher_id = v_id and line_no = 1;
  end if;
  return v_id;
end $$;
revoke all on function public.set_inventory_opening(text, text, date, numeric, numeric) from public, anon;
grant execute on function public.set_inventory_opening(text, text, date, numeric, numeric) to authenticated;
