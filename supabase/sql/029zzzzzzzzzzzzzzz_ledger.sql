-- erp-core 저장소 supabase/ledger.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 장부 (기존 앱 장부와 같게, 2026-11-05). checklist.sql 뒤에 돈다.
--  · 일반전표(비용·대출·급여 등): 차변 = 대변인 계정 줄. kind '비용'(화면 이름 '일반'). 거래처는 108·251·253 줄에 붙는다.
--  · 상계(대체): 한 거래처 안에서 계정끼리 정리. 예) 미수금↔미지급금, 선수금으로 미수 정리, 선급금으로 미지급 정리.
--  · 현금출납장: 통장·카드·현금별 기초(opening_balance, opening_date) + 그 뒤 입금 − 출금 = 잔액.
--  · 실잔액 맞추기: 실제 잔액을 넣으면 차이만큼 입금/출금 전표(기본 계정: 늘면 930 잡이익, 줄면 960 잡손실, 고칠 수 있음).
--  · 거래처원장·시산표·재무상태표: 분개(erp.journal_lines)에서 바로 센다(저장하지 않는다).

-- 계정 이름
create or replace function erp.account_name(p_company text, p_code text) returns text language sql stable set search_path = '' as $$
  select name from erp.accounts where company_id = p_company and code = p_code limit 1
$$;

-- 일반전표 / 상계. p: {company_id, kind: '비용'|'대체', date, memo, partner_id?, lines: [{account_code, side: 차변|대변, amount, note?}]}
create or replace function public.save_journal(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_kind text := coalesce(p->>'kind', '비용'); v_partner text := nullif(p->>'partner_id', '');
        v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Seoul')::date); v_id text := 'v-' || gen_random_uuid(); v_no text;
        v_dr numeric; v_cr numeric; v_bad text;
begin
  perform erp.assert_member(v_company);
  if v_kind not in ('비용', '대체') then raise exception '일반전표나 상계만 됩니다.'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') < 2 then raise exception '줄이 두 개 이상 있어야 합니다.'; end if;
  select string_agg(distinct coalesce(l->>'account_code', '(빈칸)'), ', ') into v_bad from jsonb_array_elements(p->'lines') l
  where not exists (select 1 from erp.accounts a where a.company_id = v_company and a.code = l->>'account_code');
  if v_bad is not null then raise exception '없는 계정입니다: %', v_bad; end if;
  if exists (select 1 from jsonb_array_elements(p->'lines') l where l->>'side' not in ('차변', '대변')
             or coalesce((l->>'amount')::numeric, 0) <= 0 or (l->>'amount')::numeric <> trunc((l->>'amount')::numeric)) then
    raise exception '줄마다 차변/대변과 0보다 큰 원 단위 금액을 넣으세요.';
  end if;
  select sum(case when l->>'side' = '차변' then (l->>'amount')::numeric else 0 end), sum(case when l->>'side' = '대변' then (l->>'amount')::numeric else 0 end)
  into v_dr, v_cr from jsonb_array_elements(p->'lines') l;
  if v_dr <> v_cr then raise exception '차변(%)과 대변(%)이 같아야 합니다.', v_dr, v_cr; end if;
  if v_partner is not null and not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then raise exception '거래처를 찾을 수 없습니다.'; end if;
  if v_partner is null and (v_kind = '대체' or exists (select 1 from jsonb_array_elements(p->'lines') l where l->>'account_code' in ('108', '251', '253'))) then
    raise exception '외상 계정(108·251·253)이나 상계는 거래처가 있어야 합니다.';
  end if;
  v_no := erp.next_no(v_company, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, amount, memo, created_by, created_at, legacy_collection)
  values (v_id, v_company, v_no, v_date, v_kind, v_partner, (select name from erp.partners where id = v_partner), v_dr, nullif(p->>'memo', ''), erp.actor_name(), now(), 'app');
  insert into erp.voucher_lines (voucher_id, line_no, line_kind, name, amount, account_code, side, note)
  select v_id, ord::int, 'account', coalesce(nullif(l->>'note', ''), erp.account_name(v_company, l->>'account_code')), (l->>'amount')::numeric,
         l->>'account_code', l->>'side', nullif(l->>'note', '')
  from jsonb_array_elements(p->'lines') with ordinality x(l, ord);
  return jsonb_build_object('voucher_id', v_id, 'voucher_no', v_no);
end $$;

-- 통장별 잔액(오늘까지): 기초 + 기초일 뒤 입금 − 출금. 통장 미지정 전표는 따로.
create or replace view erp.cash_balances as
select ca.id cash_account_id, ca.company_id, ca.name, ca.type, ca.opening_balance, ca.opening_date,
       coalesce(ca.opening_balance, 0) + coalesce(sum(case v.kind when '입금' then v.amount when '출금' then -v.amount end), 0) balance
from erp.cash_accounts ca
left join erp.vouchers v on v.cash_account_id = ca.id and v.status = 'active' and v.kind in ('입금', '출금')
     and (ca.opening_date is null or v.date >= ca.opening_date)
where ca.active
group by ca.id;
alter view erp.cash_balances set (security_invoker = true);
grant select on erp.cash_balances to authenticated;

-- 현금출납장: 기간의 줄마다 잔액. p_cash = null이면 통장 미지정 전표.
create or replace function public.cash_book(p_company text, p_cash text, p_from date, p_to date)
returns table (date date, voucher_id text, voucher_no text, kind text, memo text, partner text, account_code text, account_name text,
               inflow numeric, outflow numeric, balance numeric, legacy boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_open numeric; v_od date;
begin
  perform erp.assert_member(p_company);
  select coalesce(opening_balance, 0), opening_date into v_open, v_od from erp.cash_accounts where id = p_cash and company_id = p_company;
  v_open := coalesce(v_open, 0) + coalesce((select sum(case v.kind when '입금' then v.amount else -v.amount end) from erp.vouchers v
            where v.company_id = p_company and v.cash_account_id is not distinct from p_cash and v.status = 'active' and v.kind in ('입금', '출금')
              and v.date < p_from and (v_od is null or v.date >= v_od)), 0);
  return query
  select v.date, v.id, v.voucher_no, v.kind, v.memo, coalesce(pt.name, v.partner_name), v.account_code, erp.account_name(p_company, v.account_code),
         case when v.kind = '입금' then v.amount else 0 end, case when v.kind = '출금' then v.amount else 0 end,
         v_open + sum(case v.kind when '입금' then v.amount else -v.amount end) over (order by v.date, v.voucher_no, v.id),
         v.legacy_collection <> 'app'
  from erp.vouchers v left join erp.partners pt on pt.id = v.partner_id
  where v.company_id = p_company and v.cash_account_id is not distinct from p_cash and v.status = 'active' and v.kind in ('입금', '출금')
    and v.date between p_from and p_to and (v_od is null or v.date >= v_od)
  order by v.date desc, v.voucher_no desc, v.id desc;
end $$;

-- 실잔액 맞추기. p: {company_id, cash_account_id, actual, date?, reason, account_code?}
create or replace function public.adjust_cash_balance(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_cash text := p->>'cash_account_id'; v_date date := coalesce((p->>'date')::date, (now() at time zone 'Asia/Seoul')::date);
        v_book numeric; v_diff numeric; ca erp.cash_accounts;
begin
  perform erp.assert_member(v_company);
  select * into ca from erp.cash_accounts where id = v_cash and company_id = v_company;
  if ca.id is null then raise exception '통장을 고르세요.'; end if;
  if (p->>'actual') is null then raise exception '실제 잔액을 넣으세요.'; end if;
  v_book := coalesce(ca.opening_balance, 0) + coalesce((select sum(case kind when '입금' then amount else -amount end) from erp.vouchers
            where cash_account_id = v_cash and status = 'active' and kind in ('입금', '출금') and date <= v_date and (ca.opening_date is null or date >= ca.opening_date)), 0);
  v_diff := (p->>'actual')::numeric - v_book;
  if v_diff = 0 then return jsonb_build_object('diff', 0, 'book', v_book); end if;
  return public.record_cash(jsonb_build_object('company_id', v_company, 'dir', case when v_diff > 0 then '입금' else '출금' end, 'date', v_date,
           'cash_account_id', v_cash, 'amount', abs(v_diff),
           'account_code', coalesce(nullif(p->>'account_code', ''), case when v_diff > 0 then '930' else '960' end),
           'note', '실잔액 맞추기 ' || v_book || '→' || (p->>'actual') || coalesce(': ' || nullif(p->>'reason', ''), '')))
         || jsonb_build_object('diff', v_diff, 'book', v_book);
end $$;

-- 거래처원장: 계정별 기초(기간 앞) 한 줄 + 기간 분개 줄, 계정별 누적 잔액(차변−대변)
create or replace function public.partner_ledger(p_company text, p_partner text, p_from date, p_to date)
returns table (date date, voucher_id text, voucher_no text, kind text, memo text, account_code text, account_name text, debit numeric, credit numeric, balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return query
  with j as (
    select j.date, j.voucher_id, j.account_code, j.debit, j.credit from erp.journal_lines j
    where j.company_id = p_company and j.partner_id = p_partner and j.date <= p_to),
  o as (select j.account_code, sum(j.debit) d, sum(j.credit) c from j where j.date < p_from group by 1),
  rs as (
    select null::date d, null::text vid, o.account_code ac, case when o.d > o.c then o.d - o.c else 0 end dr, case when o.c > o.d then o.c - o.d else 0 end cr, 0 seq
    from o where o.d <> o.c
    union all
    select j.date, j.voucher_id, j.account_code, j.debit, j.credit, 1 from j where j.date >= p_from)
  select r.d, r.vid, v.voucher_no, coalesce(v.kind, '이월'), v.memo, r.ac, erp.account_name(p_company, r.ac), r.dr, r.cr,
         sum(r.dr - r.cr) over (partition by r.ac order by r.seq, r.d, v.voucher_no, r.vid rows unbounded preceding)
  from rs r left join erp.vouchers v on v.id = r.vid
  order by r.ac, r.seq, r.d, v.voucher_no, r.vid;
end $$;

-- 시산표: 계정별 기초·기간 차변·대변·기말 (잔액 = 차변 − 대변)
create or replace function public.trial_balance(p_company text, p_from date, p_to date)
returns table (account_code text, account_name text, opening numeric, debit numeric, credit numeric, closing numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return query
  select j.account_code, erp.account_name(p_company, j.account_code),
         sum(case when j.date < p_from then j.debit - j.credit else 0 end),
         sum(case when j.date >= p_from then j.debit else 0 end), sum(case when j.date >= p_from then j.credit else 0 end),
         sum(j.debit - j.credit)
  from erp.journal_lines j where j.company_id = p_company and j.date <= p_to
  group by j.account_code having sum(abs(j.debit) + abs(j.credit)) > 0
  order by j.account_code;
end $$;

-- 재무상태표(p_date 기준). 1xx 자산(차변 잔액), 2xx 부채·3xx 자본(대변 잔액).
-- 손익 계정(4xx~9xx)은 결산 대체를 하지 않으므로: 올해 것은 '당기순이익', 그 전 해 것은 '이월이익잉여금(미처분)'으로 자본에 넣는다.
create or replace function public.balance_sheet(p_company text, p_date date)
returns table (section text, account_code text, account_name text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_year date := date_trunc('year', p_date)::date;
begin
  perform erp.assert_member(p_company);
  return query
  with b as (select j.account_code c, sum(j.debit - j.credit) bal,
                    sum(case when j.date >= v_year then j.debit - j.credit else 0 end) ytd
             from erp.journal_lines j where j.company_id = p_company and j.date <= p_date group by 1)
  select '자산', c, erp.account_name(p_company, c), bal from b where c like '1%' and bal <> 0
  union all select '부채', c, erp.account_name(p_company, c), -bal from b where c like '2%' and bal <> 0
  union all select '자본', c, erp.account_name(p_company, c), -bal from b where c like '3%' and bal <> 0
  union all select '자본', null, '이월이익잉여금(미처분)', -sum(bal - ytd) from b where c ~ '^[4-9]' having sum(bal - ytd) <> 0
  union all select '자본', null, '당기순이익', -sum(ytd) from b where c ~ '^[4-9]' having sum(ytd) <> 0;
end $$;

revoke all on function public.save_journal(jsonb), public.cash_book(text, text, date, date), public.adjust_cash_balance(jsonb),
  public.partner_ledger(text, text, date, date), public.trial_balance(text, date, date), public.balance_sheet(text, date) from public, anon;
grant execute on function public.save_journal(jsonb), public.cash_book(text, text, date, date), public.adjust_cash_balance(jsonb),
  public.partner_ledger(text, text, date, date), public.trial_balance(text, date, date), public.balance_sheet(text, date) to authenticated;
