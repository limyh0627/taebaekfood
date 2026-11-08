-- erp-core 저장소 supabase/voucherlist.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 전표 목록(기존 앱 전표 화면과 같게, 2026-11-07). analytics.sql 뒤에 돈다.
--  한 줄에: 전표일자·시각, 담당자(이름), 구분, 업체명, 거래내역(품목 요약 또는 적요), 금액,
--  거래처 누적잔액(그 전표까지 미수·미지급), 수금/지불 남은 돈, 증빙(매출: 미발행·세금계산서·현금영수증 / 매입: 미수취·…).

alter table erp.vouchers add column if not exists evidence text;

-- 옛 앱 증빙 옮기기(시험 이전 때만): 손으로 고른 evidence, 없으면 세금계산서를 끊은 시각(taxIssuedAt)이 있으면 세금계산서
do $$ begin
  if to_regclass('raw.docs') is null then return; end if;
  update erp.vouchers v set evidence = coalesce(nullif(trim(d.data->>'evidence'), ''),
                                                case when coalesce(d.data->>'taxIssuedAt', '') <> '' then '세금계산서' end)
  from raw.docs d where d.collection = 'issuedStatements' and d.id = v.id and v.evidence is null;
end $$;

create or replace function erp.evidence_choices(p_kind text) returns text[] language sql immutable as $$
  select case p_kind when '매출' then array['미발행', '세금계산서', '현금영수증']
                     when '매입' then array['미수취', '세금계산서', '계산서(면세)', '신용카드', '현금영수증', '간이영수증']
                     else array[]::text[] end $$;

create or replace function public.set_voucher_evidence(p_id text, p_evidence text) returns void
language plpgsql security definer set search_path = '' as $$
declare v erp.vouchers;
begin
  select * into v from erp.vouchers where id = p_id for update;
  if not found then raise exception '전표를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v.company_id);
  if not (p_evidence = any (erp.evidence_choices(v.kind))) then raise exception '이 전표에 고를 수 없는 증빙입니다.'; end if;
  update erp.vouchers set evidence = p_evidence where id = p_id;
end $$;

-- 전표 목록. 누적잔액은 기간 밖 전표까지 거래처별로 쌓아 두고 기간 안 것만 돌려준다.
create or replace function public.voucher_list(p_company text, p_from date, p_to date)
returns table (id text, voucher_no text, date date, created_at timestamptz, kind text, partner_id text, partner_name text,
               amount numeric, supply numeric, tax numeric, memo text, status text, return_of text, legacy_collection text,
               evidence text, writer text, summary text, has_items boolean, accounts text[],
               ar_balance numeric, ap_balance numeric, open_amount numeric, open_side text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return query
  with net as (
    select j.voucher_id, j.partner_id,
           sum(case when j.account_code = '108' then j.debit - j.credit else 0 end) ar,
           sum(case when j.account_code in ('251', '253') then j.credit - j.debit else 0 end) ap
    from erp.journal_lines j
    where j.company_id = p_company and j.partner_id is not null and j.account_code in ('108', '251', '253')
    group by 1, 2
  ), run as (
    select n.voucher_id,
           sum(n.ar) over w as ar_bal, sum(n.ap) over w as ap_bal
    from net n join erp.vouchers v on v.id = n.voucher_id
    window w as (partition by n.partner_id order by v.date, v.created_at nulls first, v.id rows between unbounded preceding and current row)
  ), people as (
    select u.email::text email, coalesce(e.name, replace(u.email, '@erp.local', ''))::text nm
    from app.memberships m join auth.users u on u.id = m.user_id
    left join app.member_employees me on me.user_id = m.user_id and me.company_id = m.company_id
    left join erp.employees e on e.id = me.employee_id
    where m.company_id = p_company
  )
  select v.id, v.voucher_no, v.date, v.created_at, v.kind, v.partner_id, coalesce(p.name, v.partner_name),
         v.amount, v.supply, v.tax, v.memo, v.status, v.return_of, v.legacy_collection,
         coalesce(v.evidence, case v.kind when '매출' then '미발행' when '매입' then '미수취' end),
         -- 작성자: 새 ERP 계정(이메일) → 이름, 옛 앱 기록(직원 id, emp_…) → 직원 이름, 둘 다 아니면 그대로
         coalesce((select nm from people where email = v.created_by limit 1),
                  (select e.name from erp.employees e where e.id = v.created_by and e.company_id = p_company limit 1), v.created_by),
         (select case when count(*) = 0 then v.memo
                      else (array_agg(l.name order by l.line_no))[1] || case when count(*) > 1 then ' 외 ' || (count(*) - 1) || '개' else '' end end
          from erp.voucher_lines l where l.voucher_id = v.id and l.side is null),
         exists (select 1 from erp.voucher_lines l where l.voucher_id = v.id and l.side is null),
         (select array_agg(distinct l.account_code) filter (where l.account_code is not null) from erp.voucher_lines l where l.voucher_id = v.id),
         r.ar_bal, r.ap_bal,
         (select o.open from erp.open_items o where o.voucher_id = v.id limit 1),
         (select o.side from erp.open_items o where o.voucher_id = v.id limit 1)
  from erp.vouchers v
  left join erp.partners p on p.id = v.partner_id
  left join run r on r.voucher_id = v.id
  where v.company_id = p_company and v.date between p_from and p_to
  order by v.date desc, v.created_at desc nulls last, v.id desc;
end $$;

-- 빠른 추가 항목(기존 앱 '빠른 비용': 택배비·상차비…) — voucher_templates kind='expense-preset'. 이름·단가(세금 포함)·과세/면세·계정.
create or replace function public.save_line_preset(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_member(v_company);
  if trim(coalesce(p->>'name', '')) = '' then raise exception '항목 이름을 넣으세요.'; end if;
  if v_id is null then
    v_id := 'preset-' || gen_random_uuid();
    insert into erp.voucher_templates (id, company_id, name, kind, active, legacy_collection) values (v_id, v_company, trim(p->>'name'), 'expense-preset', true, 'app');
  elsif not exists (select 1 from erp.voucher_templates where id = v_id and company_id = v_company and kind = 'expense-preset') then
    raise exception '항목을 찾을 수 없습니다.';
  end if;
  update erp.voucher_templates set name = trim(p->>'name'), amount = nullif(p->>'amount', '')::numeric,
         note = case when p->>'tax' = '면세' then '면세' else '과세' end, account_code = nullif(p->>'account_code', '')
  where id = v_id;
  return v_id;
end $$;
create or replace function public.delete_line_preset(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.voucher_templates where id = p_id and kind = 'expense-preset';
  if v_company is null then raise exception '항목을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.voucher_templates where id = p_id;
end $$;
revoke all on function public.save_line_preset(jsonb), public.delete_line_preset(text) from public, anon;
grant execute on function public.save_line_preset(jsonb), public.delete_line_preset(text) to authenticated;

revoke all on function public.set_voucher_evidence(text, text), public.voucher_list(text, date, date) from public, anon;
grant execute on function public.set_voucher_evidence(text, text), public.voucher_list(text, date, date) to authenticated;
