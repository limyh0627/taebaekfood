-- erp-core 저장소 supabase/accounting.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 분개(복식부기)와 거래처 잔액. 태백 앱 autoJournal(statementJournal·cashJournal·journalSupport)을 SQL 뷰로 옮김.
-- 분개는 저장하지 않고 전표에서 매번 만든다 — 전표가 근거이고 분개는 그 결과다(앱도 그렇게 한다).
--
--  매출   (차) 108 외상매출금[거래처] = 합계      (대) 줄 계정별 공급가액 + 255 부가세예수금
--  매입   (차) 줄 계정별 공급가액 + 135 부가세대급금 (대) 251/253 채무[거래처] = 합계
--  비용   줄마다 적힌 차변/대변 그대로. 108·251·253 줄에만 거래처.   (기초 이월·감가상각 같은 대체)
--  입금   (차) 통장 = 순액                         (대) 줄 계정들[거래처]
--  출금   (차) 줄 계정들[거래처]                    (대) 통장 = 순액
--  대체   줄 차변/대변 그대로[거래처]               (상계 — 통장이 안 움직인다)
--  차변 ≠ 대변이거나 계정이 빠진 전표는 분개하지 않고 erp.journal_skipped에 이유와 함께 남긴다(앱과 같음).

-- 채무 계정: 251 외상매입금(상거래) / 253 미지급금(그 밖). 앱 payableCodeFor와 같은 판정.
create or replace function erp.payable_code(codes text[]) returns text language sql immutable as $$
  select case
    when '251' = any(codes) then '251'
    when '253' = any(codes) then '253'
    when '108' = any(codes) then '251'
    when not exists (select 1 from unnest(codes) c
                     where c in ('500', '501', '503', '505') or c ~ '^(1[0-9]{2}|2[0-9]{2}|5[1-9][0-9]|6[0-9]{2}|8[0-9]{2}|9[0-9]{2})$') then '251'
    when exists (select 1 from unnest(codes) c where c in ('500', '501', '503', '505')) then '251'
    else '253' end
$$;

-- 금액이 음수인 줄(반품 명세서 같은 마이너스 전표)은 반대쪽 양수로 돌려 놓는다 — 차변−대변은 그대로다.
create or replace view erp.journal_raw as
select j.voucher_id, j.company_id, j.date, j.account_code, j.partner_id,
       greatest(j.debit, 0) + greatest(-j.credit, 0) as debit, greatest(j.credit, 0) + greatest(-j.debit, 0) as credit, j.note
from (
-- 매출·매입 명세서
with stmt as (
  select v.*, (select array_agg(distinct l.account_code) from erp.voucher_lines l where l.voucher_id = v.id) as codes,
         exists (select 1 from erp.voucher_lines l where l.voucher_id = v.id and coalesce(l.account_code, '') = '') as missing
  from erp.vouchers v
  where v.status = 'active' and v.kind in ('매출', '매입')
    and exists (select 1 from erp.voucher_lines l where l.voucher_id = v.id)
)
select s.id as voucher_id, s.company_id, s.date, '108' as account_code, s.partner_id, s.amount as debit, 0::numeric as credit, null::text as note
from stmt s where s.kind = '매출' and not s.missing
union all
select s.id, s.company_id, s.date, l.account_code, null, 0, sum(l.supply), string_agg(distinct l.name, ', ')
from stmt s join erp.voucher_lines l on l.voucher_id = s.id
where s.kind = '매출' and not s.missing group by s.id, s.company_id, s.date, l.account_code having sum(l.supply) <> 0
union all
select s.id, s.company_id, s.date, '255', null, 0, s.tax, '매출세액' from stmt s where s.kind = '매출' and not s.missing and coalesce(s.tax, 0) <> 0
union all
select s.id, s.company_id, s.date, l.account_code, null, sum(l.supply), 0, string_agg(distinct l.name, ', ')
from stmt s join erp.voucher_lines l on l.voucher_id = s.id
where s.kind = '매입' and not s.missing group by s.id, s.company_id, s.date, l.account_code having sum(l.supply) <> 0
union all
select s.id, s.company_id, s.date, '135', null, s.tax, 0, '매입세액' from stmt s where s.kind = '매입' and not s.missing and coalesce(s.tax, 0) <> 0
union all
select s.id, s.company_id, s.date, erp.payable_code(s.codes), s.partner_id, 0, s.amount, null
from stmt s where s.kind = '매입' and not s.missing
-- 비용(대체) 명세서: 줄의 차변/대변 그대로
union all
select v.id, v.company_id, v.date, l.account_code,
       case when l.account_code in ('108', '251', '253') then v.partner_id end,
       case when l.side = '차변' then l.amount else 0 end, case when l.side = '대변' then l.amount else 0 end, l.name
from erp.vouchers v join erp.voucher_lines l on l.voucher_id = v.id
where v.status = 'active' and v.kind in ('비용', '기초') and coalesce(l.amount, 0) <> 0
-- 자금: 대체(상계)
union all
select v.id, v.company_id, v.date, l.account_code, v.partner_id,
       case when l.side = '차변' then l.amount else 0 end, case when l.side = '대변' then l.amount else 0 end, l.note
from erp.vouchers v join erp.voucher_lines l on l.voucher_id = v.id
where v.status = 'active' and v.kind = '대체' and coalesce(l.amount, 0) <> 0
-- 자금: 입금·출금의 계정 줄
union all
select v.id, v.company_id, v.date, l.account_code, v.partner_id,
       case when l.side = '차변' then l.amount else 0 end, case when l.side = '대변' then l.amount else 0 end, l.note
from erp.vouchers v join erp.voucher_lines l on l.voucher_id = v.id
where v.status = 'active' and v.kind in ('입금', '출금') and coalesce(l.amount, 0) <> 0
-- 자금: 입금·출금의 통장 줄(순액). 현금 계좌면 102, 아니면 103.
union all
select v.id, v.company_id, v.date, case when ca.type = '현금' then '102' else '103' end, null,
       greatest(n.net, 0), greatest(-n.net, 0), v.memo
from erp.vouchers v
left join erp.cash_accounts ca on ca.id = v.cash_account_id
cross join lateral (select sum(case when l.side = '대변' then l.amount else -l.amount end) as net
                    from erp.voucher_lines l where l.voucher_id = v.id) n
where v.status = 'active' and v.kind in ('입금', '출금') and coalesce(n.net, 0) <> 0
) j;

-- 분개 못 하는 전표와 이유
create or replace view erp.journal_skipped as
select v.id as voucher_id, v.company_id, v.kind, v.voucher_no, v.date, v.amount,
       case when not exists (select 1 from erp.voucher_lines l where l.voucher_id = v.id) then '줄 없음'
            when exists (select 1 from erp.voucher_lines l where l.voucher_id = v.id and coalesce(l.account_code, '') = '') then '계정 빠진 줄'
            else '차변 ≠ 대변' end as reason,
       t.debit, t.credit
from erp.vouchers v
left join (select voucher_id, sum(debit) debit, sum(credit) credit from erp.journal_raw group by 1) t on t.voucher_id = v.id
where v.status = 'active'
  and (t.voucher_id is null or abs(t.debit - t.credit) >= 1
       or exists (select 1 from erp.voucher_lines l where l.voucher_id = v.id and coalesce(l.account_code, '') = ''));

-- 분개: 차변 = 대변인 전표만
create or replace view erp.journal_lines as
select j.* from erp.journal_raw j
where not exists (select 1 from erp.journal_skipped s where s.voucher_id = j.voucher_id);

-- 거래처 잔액: 미수 = 108 차변−대변, 미지급 = 251·253 대변−차변 (앱 allPartnerBalances와 같은 규칙)
create or replace view erp.partner_balances as
select j.company_id, j.partner_id,
       sum(case when j.account_code = '108' then j.debit - j.credit else 0 end) as receivable,
       sum(case when j.account_code in ('251', '253') then j.credit - j.debit else 0 end) as payable
from erp.journal_lines j
where j.partner_id is not null and j.account_code in ('108', '251', '253')
group by 1, 2;

-- 뷰는 만든 사람 권한으로 돈다 → 화면에서는 소속 회사만 보이게 security_invoker로 둔다(아래 표의 RLS를 따른다).
alter view erp.journal_raw set (security_invoker = true);
alter view erp.journal_skipped set (security_invoker = true);
alter view erp.journal_lines set (security_invoker = true);
alter view erp.partner_balances set (security_invoker = true);
grant select on erp.journal_raw, erp.journal_lines, erp.journal_skipped, erp.partner_balances to authenticated;

-- ---------- 미결 명세서 (반제) ----------
-- 거래처·채권/채무별로, 잔액을 세운 전표(청구)와 줄인 전표(결제)를 맞춘다. 태백 앱 allocatePartnerCash와 같은 순서:
--   1) 사람이 지정한 반제(voucher_applies)를 먼저 채우고  2) 남은 결제는 오래된 청구부터(선입선출).
-- 잔액(partner_balances)은 이걸 안 쓴다 — 반제가 틀려도 잔액은 안 흔들리고 '어느 명세서냐'만 틀린다.
create or replace view erp.open_items as
with net as (
  select j.company_id, j.partner_id, j.voucher_id,
         case when j.account_code = '108' then 'AR' else 'AP' end as side,
         sum(case when j.account_code = '108' then j.debit - j.credit else j.credit - j.debit end) as n
  from erp.journal_lines j
  where j.partner_id is not null and j.account_code in ('108', '251', '253')
  group by 1, 2, 3, 4
), claims as (
  select n.*, v.date, v.voucher_no, v.kind from net n join erp.vouchers v on v.id = n.voucher_id where n.n > 0
), pays as (
  select company_id, partner_id, side, sum(-n) as amt from net where n < 0 group by 1, 2, 3
), explicit as (
  select a.applies_to, sum(a.amount) as amt
  from erp.voucher_applies a
  join erp.vouchers pv on pv.id = a.voucher_id and pv.status = 'active'
  group by 1
), step1 as (
  select c.*, least(coalesce(e.amt, 0), c.n) as manual
  from claims c left join explicit e on e.applies_to = c.voucher_id
), pool as (
  select s.company_id, s.partner_id, s.side,
         greatest(coalesce(max(p.amt), 0) - sum(s.manual), 0) as left_over
  from step1 s left join pays p on p.company_id = s.company_id and p.partner_id = s.partner_id and p.side = s.side
  group by 1, 2, 3
), fifo as (
  select s.*, s.n - s.manual as rem,
         sum(s.n - s.manual) over (partition by s.company_id, s.partner_id, s.side order by s.date, s.voucher_id
                                   rows between unbounded preceding and current row) as cum
  from step1 s
)
select f.company_id, f.partner_id, f.side, f.voucher_id, f.date, f.voucher_no, f.kind,
       f.n as claim,
       f.manual + least(greatest(p.left_over - (f.cum - f.rem), 0), f.rem) as settled,
       f.rem - least(greatest(p.left_over - (f.cum - f.rem), 0), f.rem) as open
from fifo f join pool p on p.company_id = f.company_id and p.partner_id = f.partner_id and p.side = f.side;

alter view erp.open_items set (security_invoker = true);
grant select on erp.open_items to authenticated;

-- ---------- 입금·출금 ----------
-- p: {company_id, dir: 입금|출금, date, partner_id, cash_account_id, amount, account_code?, note, applies?: [{voucher_id, amount}]}
-- 계정을 안 주면 입금은 108(외상매출금 회수), 출금은 251(외상매입금 지급).
create or replace function public.record_cash(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company text := p->>'company_id';
  v_dir text := p->>'dir';
  v_date date := coalesce((p->>'date')::date, current_date);
  v_amount numeric := (p->>'amount')::numeric;
  v_partner text := nullif(p->>'partner_id', '');
  v_cash text := nullif(p->>'cash_account_id', '');
  v_code text := coalesce(nullif(p->>'account_code', ''), case when p->>'dir' = '입금' then '108' else '251' end);
  v_id text := 'v-' || gen_random_uuid();
  v_no text;
  v_loan text := nullif(p->>'loan_id', '');
begin
  perform erp.assert_member(v_company);
  if v_loan is not null and not exists (select 1 from erp.loan_contracts where id = v_loan and company_id = v_company) then
    raise exception '차입금을 찾을 수 없습니다.';
  end if;
  if v_dir not in ('입금', '출금') then raise exception '입금 또는 출금만 됩니다.'; end if;
  if v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) then raise exception '금액은 0보다 큰 원 단위여야 합니다.'; end if;
  if v_partner is not null and not exists (select 1 from erp.partners where id = v_partner and company_id = v_company) then
    raise exception '거래처를 찾을 수 없습니다.';
  end if;
  if v_code in ('108', '251', '253') and v_partner is null then raise exception '외상 계정(108·251·253)은 거래처가 있어야 합니다.'; end if;
  if v_cash is not null and not exists (select 1 from erp.cash_accounts where id = v_cash and company_id = v_company) then
    raise exception '통장을 찾을 수 없습니다.';
  end if;
  v_no := erp.next_no(v_company, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, cash_account_id, account_code, loan_id,
                            amount, memo, created_by, created_at, legacy_collection)
  values (v_id, v_company, v_no, v_date, v_dir, v_partner, (select name from erp.partners where id = v_partner), v_cash, v_code, v_loan,
          v_amount, nullif(p->>'note', ''), erp.actor_name(), now(), 'app');
  insert into erp.voucher_lines (voucher_id, line_no, line_kind, amount, account_code, side, note)
  values (v_id, 1, 'account', v_amount, v_code, case when v_dir = '입금' then '대변' else '차변' end, nullif(p->>'note', ''));

  -- 반제 지정(선택): applies: [{voucher_id, amount}] — 이 돈으로 어느 명세서를 얼마 정리하는지.
  if jsonb_typeof(p->'applies') = 'array' and jsonb_array_length(p->'applies') > 0 then
    if exists (select 1 from jsonb_array_elements(p->'applies') a
               left join erp.vouchers t on t.id = a->>'voucher_id'
               where t.id is null or t.company_id <> v_company or t.partner_id is distinct from v_partner or t.status <> 'active'
                  or coalesce((a->>'amount')::numeric, 0) <= 0) then
      raise exception '반제할 명세서가 이 거래처의 것이 아니거나 금액이 0입니다.';
    end if;
    if (select sum((a->>'amount')::numeric) from jsonb_array_elements(p->'applies') a) > v_amount then
      raise exception '반제 금액 합계가 입출금액보다 큽니다.';
    end if;
    insert into erp.voucher_applies (id, company_id, voucher_id, applies_to, amount, created_at)
    select 'ap-' || gen_random_uuid(), v_company, v_id, a->>'voucher_id', (a->>'amount')::numeric, now()
    from jsonb_array_elements(p->'applies') a;
  end if;
  return jsonb_build_object('voucher_id', v_id, 'voucher_no', v_no);
end $$;

-- 새 앱에서 만든 입금·출금 전표만 취소한다(주문 매출 전표는 출고 취소로).
create or replace function public.cancel_voucher(p_voucher_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v erp.vouchers;
begin
  select * into v from erp.vouchers where id = p_voucher_id for update;
  if not found then raise exception '전표를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v.company_id);
  if v.legacy_collection <> 'app' then raise exception '옛 앱의 전표는 여기서 취소할 수 없습니다.'; end if;
  if v.kind not in ('입금', '출금') then raise exception '매출 전표는 주문의 출고 취소로 취소하세요.'; end if;
  if v.status = 'canceled' then raise exception '이미 취소된 전표입니다.'; end if;
  update erp.vouchers set status = 'canceled' where id = v.id;
end $$;

revoke all on function public.record_cash(jsonb), public.cancel_voucher(text) from public, anon;
grant execute on function public.record_cash(jsonb), public.cancel_voucher(text) to authenticated;
