-- erp-core 저장소 supabase/analytics.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 분석 — 기존 앱 '손익·비용 분석·현금흐름·거래처 통계'와 같은 갈래(2026-11-05). workdoc.sql 뒤에 돈다. 관리자만.
--  모두 분개(journal_lines)에서 센다 — 전표에 계정이 빠진 줄은 장부와 같이 빠진다.

create or replace function erp.pl_section(p_code text) returns text language sql immutable as $$
  select case when p_code ~ '^4' then '매출' when p_code ~ '^8' then '판매비와관리비' when p_code ~ '^9([0-2][0-9]|30)$' then '영업외수익'
              when p_code ~ '^9' then '영업외비용' when p_code ~ '^[5-7]' then '제조경비' end $$;

-- 월별 손익: month(YYYY-MM), section, account_code, account_name, amount(수익은 대변−차변, 비용은 차변−대변)
create or replace function public.analysis_monthly(p_company text, p_from date, p_to date)
returns table (month text, section text, account_code text, account_name text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_admin(p_company);
  return query
  select to_char(j.date, 'YYYY-MM'), erp.pl_section(j.account_code), j.account_code, coalesce(max(a.name), j.account_code),
         sum(case when erp.pl_section(j.account_code) in ('매출', '영업외수익') then j.credit - j.debit else j.debit - j.credit end)
  from erp.journal_lines j left join erp.accounts a on a.company_id = p_company and a.code = j.account_code
  where j.company_id = p_company and j.date between p_from and p_to and erp.pl_section(j.account_code) is not null
  group by 1, 2, 3 having abs(sum(j.credit - j.debit)) >= 1
  order by 1, 2, 3;
end $$;

-- 월별 현금흐름: 현금·예금(101~103 또는 현금 계정) 움직임을 상대 계정별로. in_amount 들어옴, out_amount 나감.
create or replace function public.analysis_cashflow(p_company text, p_from date, p_to date)
returns table (month text, account_code text, account_name text, cf_section text, in_amount numeric, out_amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_admin(p_company);
  return query
  with cash_codes as (
    select code from erp.accounts where company_id = p_company and is_cash union select unnest(array['101', '102', '103'])
  ), v as (
    select j.voucher_id, min(j.date) d, sum(case when j.account_code in (select code from cash_codes) then j.debit - j.credit else 0 end) cash
    from erp.journal_lines j where j.company_id = p_company and j.date between p_from and p_to
    group by 1 having sum(case when j.account_code in (select code from cash_codes) then j.debit - j.credit else 0 end) <> 0
  ), counter as (   -- 전표에서 현금이 아닌 줄 중 가장 큰 것을 상대 계정으로
    select distinct on (j.voucher_id) j.voucher_id, j.account_code
    from erp.journal_lines j join v on v.voucher_id = j.voucher_id
    where j.account_code not in (select code from cash_codes)
    order by j.voucher_id, greatest(j.debit, j.credit) desc
  )
  select to_char(v.d, 'YYYY-MM'), coalesce(c.account_code, '-'), coalesce(max(a.name), c.account_code, '현금끼리 옮김'), max(a.cf_section),
         sum(greatest(v.cash, 0)), sum(greatest(-v.cash, 0))
  from v left join counter c on c.voucher_id = v.voucher_id
  left join erp.accounts a on a.company_id = p_company and a.code = c.account_code
  group by 1, 2, c.account_code order by 1, 2;
end $$;

-- 거래처 통계: 기간 매출·매입(합계·장수·마지막 거래일) + 지금 미수·미지급
create or replace function public.analysis_partners(p_company text, p_from date, p_to date)
returns table (partner_id text, partner_name text, channel text, sales numeric, sales_count bigint, purchases numeric, purchase_count bigint,
               last_date date, receivable numeric, payable numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_admin(p_company);
  return query
  with t as (
    select v.partner_id, sum(case when v.kind = '매출' then v.amount else 0 end) s, count(*) filter (where v.kind = '매출') sc,
           sum(case when v.kind = '매입' then v.amount else 0 end) pu, count(*) filter (where v.kind = '매입') pc, max(v.date) ld
    from erp.vouchers v where v.company_id = p_company and v.status = 'active' and v.kind in ('매출', '매입') and v.date between p_from and p_to and v.partner_id is not null
    group by 1
  )
  select p.id, p.name, p.channel, coalesce(t.s, 0), coalesce(t.sc, 0), coalesce(t.pu, 0), coalesce(t.pc, 0), t.ld,
         coalesce(b.receivable, 0), coalesce(b.payable, 0)
  from erp.partners p left join t on t.partner_id = p.id left join erp.partner_balances b on b.partner_id = p.id
  where p.company_id = p_company and (t.partner_id is not null or abs(coalesce(b.receivable, 0)) >= 1 or abs(coalesce(b.payable, 0)) >= 1)
  order by coalesce(t.s, 0) + coalesce(t.pu, 0) desc;
end $$;

revoke all on function public.analysis_monthly(text, date, date), public.analysis_cashflow(text, date, date), public.analysis_partners(text, date, date) from public, anon;
grant execute on function public.analysis_monthly(text, date, date), public.analysis_cashflow(text, date, date), public.analysis_partners(text, date, date) to authenticated;
