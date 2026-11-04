-- erp-core 저장소 supabase/tax_payroll.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 세금계산서(발행 관리)와 급여대장. accounting.sql·orders.sql 뒤에 돈다.
--
-- 세금계산서: 이 ERP는 전자 발행 자체를 하지 않는다(홈택스·발행 대행사 몫). 여기서는
--   ① 한 달 치 명세서를 거래처별로 묶어 발행할 것을 만들고(월합계, 과세=세금계산서 / 면세=계산서 따로 — 태백 앱 planTaxIssue와 같은 갈래)
--   ② 홈택스에 올릴 목록을 내보내고 ③ 발행했으면 승인번호를 적어 '발행'으로 바꾼다.
-- 급여: 대장을 저장하고, 지급하면 출금 전표 한 장: (차) 802 급여 = 지급계 / (대) 257 예수금 = 공제계, 통장에서는 실지급액이 나간다.
--   (태백 앱 cashJournal의 급여 지급 분개와 같다.) 급여는 관리자만 본다.

create table if not exists erp.tax_invoices (
  id          text primary key,
  company_id  text not null references erp.companies(id),
  direction   text not null check (direction in ('매출', '매입')),
  kind        text not null check (kind in ('세금계산서', '계산서')),
  partner_id  text references erp.partners(id),
  write_date  date not null,
  supply      numeric not null,
  tax         numeric not null,
  amount      numeric not null,
  item_summary text,
  status      text not null default '발행대기' check (status in ('발행대기', '발행', '취소')),
  approval_no text,
  issued_at   timestamptz,
  created_by  text,
  created_at  timestamptz not null default now()
);
create table if not exists erp.tax_invoice_vouchers (
  invoice_id text not null references erp.tax_invoices(id) on delete cascade,
  voucher_id text not null references erp.vouchers(id),
  supply     numeric not null,
  tax        numeric not null,
  primary key (invoice_id, voucher_id)
);
alter table erp.tax_invoices enable row level security;
alter table erp.tax_invoice_vouchers enable row level security;
revoke all on erp.tax_invoices, erp.tax_invoice_vouchers from anon, authenticated;
grant select on erp.tax_invoices, erp.tax_invoice_vouchers to authenticated;
drop policy if exists member_read on erp.tax_invoices;
create policy member_read on erp.tax_invoices for select to authenticated using (company_id = any (app.my_company_ids()));
drop policy if exists member_read on erp.tax_invoice_vouchers;
create policy member_read on erp.tax_invoice_vouchers for select to authenticated
  using (exists (select 1 from erp.tax_invoices t where t.id = invoice_id and t.company_id = any (app.my_company_ids())));

-- 한 달 치 묶기. 이미 (취소 안 된) 계산서에 묶인 명세서 줄 갈래는 다시 안 묶는다. 만든 건수를 돌려준다.
create or replace function public.build_tax_invoices(p_company text, p_month text, p_direction text default '매출') returns int
language plpgsql security definer set search_path = '' as $$
declare v_from date; v_to date; n int := 0; g record; v_id text;
begin
  perform erp.assert_member(p_company);
  if p_direction not in ('매출', '매입') then raise exception '매출 또는 매입만 됩니다.'; end if;
  v_from := (p_month || '-01')::date;
  v_to := (v_from + interval '1 month - 1 day')::date;
  for g in
    select v.partner_id, case when coalesce(l.tax_exempt, false) then '계산서' else '세금계산서' end as kind,
           array_agg(distinct v.id) as vids, sum(l.supply) as supply, sum(l.tax) as tax,
           (array_agg(l.name order by l.amount desc))[1] as top_item, count(distinct l.name) as names
    from erp.vouchers v join erp.voucher_lines l on l.voucher_id = v.id
    where v.company_id = p_company and v.kind = p_direction and v.status = 'active' and v.partner_id is not null
      and v.date between v_from and v_to
      and not exists (select 1 from erp.tax_invoice_vouchers tv join erp.tax_invoices t on t.id = tv.invoice_id
                      where tv.voucher_id = v.id and t.status <> '취소'
                        and t.kind = case when coalesce(l.tax_exempt, false) then '계산서' else '세금계산서' end)
    group by 1, 2
    having sum(l.supply) <> 0
  loop
    v_id := 'ti-' || gen_random_uuid();
    insert into erp.tax_invoices (id, company_id, direction, kind, partner_id, write_date, supply, tax, amount, item_summary, created_by)
    values (v_id, p_company, p_direction, g.kind, g.partner_id, v_to, g.supply, g.tax, g.supply + g.tax,
            g.top_item || case when g.names > 1 then ' 외 ' || (g.names - 1) || '건' else '' end, erp.actor_name());
    insert into erp.tax_invoice_vouchers (invoice_id, voucher_id, supply, tax)
    select v_id, l.voucher_id, sum(l.supply), sum(l.tax) from erp.voucher_lines l
    where l.voucher_id = any (g.vids) and (coalesce(l.tax_exempt, false) = (g.kind = '계산서'))
    group by l.voucher_id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.set_tax_invoice_status(p_id text, p_status text, p_approval_no text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t erp.tax_invoices;
begin
  select * into t from erp.tax_invoices where id = p_id for update;
  if not found then raise exception '계산서를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(t.company_id);
  if p_status not in ('발행', '취소', '발행대기') then raise exception '상태가 올바르지 않습니다.'; end if;
  update erp.tax_invoices set status = p_status, approval_no = coalesce(nullif(p_approval_no, ''), approval_no),
         issued_at = case when p_status = '발행' then now() else issued_at end
  where id = p_id;
end $$;

-- 홈택스 일괄 발행에 옮겨 적을 목록(공급자 = 우리 회사, 공급받는자 = 거래처).
create or replace function public.export_tax_invoices(p_company text, p_month text, p_direction text default '매출')
returns table (작성일자 date, 종류 text, 상태 text, 거래처 text, 사업자번호 text, 대표자 text, 이메일 text, 주소 text,
               품목 text, 공급가액 numeric, 세액 numeric, 합계 numeric, 명세서수 bigint, 승인번호 text)
language sql stable set search_path = '' as $$
  select t.write_date, t.kind, t.status, p.name, p.biz_no, p.owner_name, p.email, p.address,
         t.item_summary, t.supply, t.tax, t.amount, (select count(*) from erp.tax_invoice_vouchers x where x.invoice_id = t.id), t.approval_no
  from erp.tax_invoices t left join erp.partners p on p.id = t.partner_id
  where t.company_id = p_company and t.direction = p_direction and to_char(t.write_date, 'YYYY-MM') = p_month and t.status <> '취소'
  order by t.kind, p.name
$$;

-- ---------- 급여 ----------
create or replace function erp.assert_admin(p_company text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (p_company = any (app.my_admin_company_ids())) then
    raise exception '관리자만 할 수 있는 일입니다.' using errcode = '42501';
  end if;
end $$;

-- p: {company_id, year_month, pay_date, note, lines: [{employee_id, employee_name, base, allowance, overtime,
--      income_tax, local_tax, pension, health, employment, other_deduct, note}]}
-- 한 회사 한 달에 대장 하나. 지급(전표)한 대장은 지급을 취소해야 고칠 수 있다.
create or replace function public.save_payroll(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_ym text := p->>'year_month'; v_id text; v_old erp.payrolls;
begin
  perform erp.assert_admin(v_company);
  if v_ym !~ '^[0-9]{4}-[0-9]{2}$' then raise exception '귀속월(YYYY-MM)이 올바르지 않습니다.'; end if;
  select * into v_old from erp.payrolls where company_id = v_company and year_month = v_ym for update;
  if found then
    if v_old.voucher_id is not null and exists (select 1 from erp.vouchers where id = v_old.voucher_id and status = 'active') then
      raise exception '지급한 급여대장입니다. 지급을 취소한 뒤 고치세요.';
    end if;
    v_id := v_old.id;
    update erp.payrolls set pay_date = (p->>'pay_date')::date, note = nullif(p->>'note', ''), voucher_id = null where id = v_id;
    delete from erp.payroll_lines where payroll_id = v_id;
  else
    v_id := 'pay-' || v_company || '-' || v_ym;
    insert into erp.payrolls (id, company_id, year_month, pay_date, note)
    values (v_id, v_company, v_ym, (p->>'pay_date')::date, nullif(p->>'note', ''));
  end if;
  insert into erp.payroll_lines (payroll_id, line_no, employee_id, employee_name, base, allowance, overtime,
                                 income_tax, local_tax, pension, health, employment, other_deduct, note)
  select v_id, l.ord::int,
         (select id from erp.employees e where e.id = l.v->>'employee_id' and e.company_id = v_company),
         l.v->>'employee_name',
         coalesce((l.v->>'base')::numeric, 0), coalesce((l.v->>'allowance')::numeric, 0), coalesce((l.v->>'overtime')::numeric, 0),
         coalesce((l.v->>'income_tax')::numeric, 0), coalesce((l.v->>'local_tax')::numeric, 0), coalesce((l.v->>'pension')::numeric, 0),
         coalesce((l.v->>'health')::numeric, 0), coalesce((l.v->>'employment')::numeric, 0), coalesce((l.v->>'other_deduct')::numeric, 0),
         nullif(l.v->>'note', '')
  from jsonb_array_elements(p->'lines') with ordinality l(v, ord);
  return v_id;
end $$;

-- 지급: 출금 전표 한 장. (차) 802 지급계 / (대) 257 공제계 → 통장 실지급액.
create or replace function public.pay_payroll(p_payroll_id text, p_date date default null, p_cash_account text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r erp.payrolls; v_gross numeric; v_deduct numeric; v_id text := 'v-' || gen_random_uuid(); v_no text; v_date date;
begin
  select * into r from erp.payrolls where id = p_payroll_id for update;
  if not found then raise exception '급여대장을 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(r.company_id);
  if r.voucher_id is not null and exists (select 1 from erp.vouchers where id = r.voucher_id and status = 'active') then
    raise exception '이미 지급한 대장입니다.';
  end if;
  select sum(base + allowance + overtime), sum(income_tax + local_tax + pension + health + employment + other_deduct)
  into v_gross, v_deduct from erp.payroll_lines where payroll_id = r.id;
  if coalesce(v_gross, 0) <= 0 then raise exception '지급계가 0입니다.'; end if;
  v_date := coalesce(p_date, r.pay_date, current_date);
  v_no := erp.next_no(r.company_id, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, cash_account_id, amount, memo, created_by, created_at, legacy_collection)
  values (v_id, r.company_id, v_no, v_date, '출금', p_cash_account, v_gross - v_deduct, r.year_month || ' 급여', erp.actor_name(), now(), 'app');
  insert into erp.voucher_lines (voucher_id, line_no, line_kind, name, amount, account_code, side) values
    (v_id, 1, 'account', '급여(지급계)', v_gross, '802', '차변');
  if v_deduct <> 0 then
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, name, amount, account_code, side)
    values (v_id, 2, 'account', '원천공제 예수금', v_deduct, '257', '대변');
  end if;
  update erp.payrolls set voucher_id = v_id where id = r.id;
  return jsonb_build_object('voucher_id', v_id, 'voucher_no', v_no, 'net', v_gross - v_deduct);
end $$;

create or replace function public.cancel_payroll_payment(p_payroll_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.payrolls;
begin
  select * into r from erp.payrolls where id = p_payroll_id for update;
  if not found then raise exception '급여대장을 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(r.company_id);
  if not exists (select 1 from erp.vouchers where id = r.voucher_id and legacy_collection = 'app' and status = 'active') then
    raise exception '새 앱에서 지급한 대장만 지급 취소할 수 있습니다.';
  end if;
  update erp.vouchers set status = 'canceled' where id = r.voucher_id;
  update erp.payrolls set voucher_id = null where id = r.id;
end $$;

revoke all on function public.build_tax_invoices(text, text, text), public.set_tax_invoice_status(text, text, text),
  public.export_tax_invoices(text, text, text), public.save_payroll(jsonb), public.pay_payroll(text, date, text),
  public.cancel_payroll_payment(text) from public, anon;
grant execute on function public.build_tax_invoices(text, text, text), public.set_tax_invoice_status(text, text, text),
  public.export_tax_invoices(text, text, text), public.save_payroll(jsonb), public.pay_payroll(text, date, text),
  public.cancel_payroll_payment(text) to authenticated;
revoke all on function erp.assert_admin(text) from public, anon, authenticated;
