-- 이관 기준일(cutover) — 시험·최종 이관 전용(erp-core에는 없다). 다른 02* 파일이 다 돈 뒤 맨 끝에 돈다. 2026-11-08
--
-- 회사마다 기준일(기본 2026-10-01)부터 새 ERP로 시작한다:
--  1) 기준일 전에 시작해서 아직 안 끝난 일(출고 안 한 주문 · 명세서 안 낸 주문 · 다 안 받은/명세서 안 낸 발주)을 '이관 후보'로 남긴다.
--     관리자가 새 ERP '이관 고르기' 화면에서 가져올 것만 고른다(app 스키마 — 이관을 다시 돌려도 안 지워진다).
--  2) 기준일 전날까지의 잔액을 계정·거래처별로 셈해 기준일 전날 날짜 기초 전표로 넣는다(상대 375 이월이익잉여금).
--     통장·현금은 계좌별 기초(opening_balance), 차입금은 계약별 기초 원금으로. 손익 계정은 375에 녹는다.
--  3) 기준일 전 전표는 지우지 않고 status='archived'(보관)로 돌린다 — 잔액·장부·목록에서 빠지고 자료는 남는다.
--     고르지 않은 옛 주문은 '예전 주문'(DELIVERED)·명세서 발행 안 함, 옛 발주는 취소로 둔다.
-- 재고 원장·로트·생산 기록·HACCP·직원·품목·거래처는 그대로 둔다(재고 수량은 이관 시점 그대로가 맞다).

create table if not exists app.migration_settings (
  company_id text primary key,
  cutoff     date not null default date '2026-10-01',
  apply      boolean not null default true
);
create table if not exists app.migration_candidates (
  company_id   text not null,
  kind         text not null check (kind in ('order', 'unbilled', 'po', 'po_unbilled')),
  ref_id       text not null,
  ref_date     date,
  partner_name text,
  summary      text,
  amount       numeric,
  primary key (company_id, kind, ref_id)
);
create table if not exists app.migration_picks (
  company_id text not null,
  kind       text not null,
  ref_id     text not null,
  picked_by  text,
  picked_at  timestamptz not null default now(),
  primary key (company_id, kind, ref_id)
);
alter table app.migration_settings enable row level security;
alter table app.migration_candidates enable row level security;
alter table app.migration_picks enable row level security;
revoke all on app.migration_settings, app.migration_candidates, app.migration_picks from anon, authenticated;

insert into app.migration_settings (company_id) select id from erp.companies on conflict do nothing;

-- 보관(archived): 기준일 전 전표. 잔액·장부·목록은 status='active'만 보므로 빠진다.
alter table erp.vouchers drop constraint if exists vouchers_status_check;
alter table erp.vouchers add constraint vouchers_status_check check (status in ('active', 'canceled', 'archived'));

do $$
declare c record; v_open date; r record; v_bal numeric; v_rest numeric; v_id text; v_name text;
begin
  for c in select s.company_id, s.cutoff, s.apply from app.migration_settings s join erp.companies k on k.id = s.company_id loop
    v_open := c.cutoff - 1;

    -- ---------- 1) 이관 후보(원래 자료 기준으로 매번 새로) ----------
    delete from app.migration_candidates where company_id = c.company_id;
    insert into app.migration_candidates (company_id, kind, ref_id, ref_date, partner_name, summary, amount)
    select o.company_id,
           case when o.shipped_at is null and coalesce(o.status, '') not in ('SHIPPED', 'DELIVERED') then 'order' else 'unbilled' end,
           o.id, coalesce(o.delivery_date, o.created_at::date), coalesce(p.name, o.partner_name),
           (select string_agg(coalesce(l.name, '') || ' ' || trim(to_char(l.qty, 'FM999,999,990.###')), ', ' order by l.line_no) from erp.order_lines l where l.order_id = o.id),
           o.total_amount
    from erp.orders o left join erp.partners p on p.id = o.partner_id
    where o.company_id = c.company_id and coalesce(o.delivery_date, o.created_at::date) < c.cutoff
      and coalesce(o.status, '') not in ('CANCELED', 'CANCELLED')
      and ((o.shipped_at is null and coalesce(o.status, '') not in ('SHIPPED', 'DELIVERED'))
           or (o.voucher_id is null and not o.accounting_excluded and o.partner_id is not null));
    insert into app.migration_candidates (company_id, kind, ref_id, ref_date, partner_name, summary, amount)
    select po.company_id,
           case when po.status in ('pending', 'invoiced', 'partial') then 'po' else 'po_unbilled' end,
           po.id, po.created_at::date, coalesce(p.name, po.partner_name),
           (select string_agg(coalesce(l.name, '') || ' ' || trim(to_char(l.qty, 'FM999,999,990.###')) || coalesce(l.unit, ''), ', ' order by l.line_no) from erp.purchase_order_lines l where l.po_id = po.id),
           (select sum(round(coalesce(l.qty, 0) * coalesce(l.price, 0))) from erp.purchase_order_lines l where l.po_id = po.id)
    from erp.purchase_orders po left join erp.partners p on p.id = po.partner_id
    where po.company_id = c.company_id and po.created_at::date < c.cutoff and coalesce(po.status, '') <> 'cancelled'
      and (po.status in ('pending', 'invoiced', 'partial') or (po.voucher_id is null and po.partner_id is not null and po.status = 'received'));

    continue when not c.apply;

    -- ---------- 2) 기준일 전날 잔액 ----------
    create temp table if not exists _bal (account_code text, partner_id text, bal numeric) on commit drop;
    truncate _bal;
    insert into _bal
    select j.account_code, j.partner_id, sum(j.debit - j.credit)
    from erp.journal_lines j
    where j.company_id = c.company_id and j.date < c.cutoff and j.account_code ~ '^[123]' and j.account_code <> '375'
    group by 1, 2 having round(sum(j.debit - j.credit)) <> 0;

    create temp table if not exists _cash (id text, type text, name text, bal numeric) on commit drop;
    truncate _cash;
    insert into _cash
    select ca.id, ca.type, ca.name,
           case when ca.opening_date is null or ca.opening_date < c.cutoff then coalesce(ca.opening_balance, 0) else 0 end
           + coalesce((select sum(case v.kind when '입금' then v.amount else -v.amount end) from erp.vouchers v
                       where v.cash_account_id = ca.id and v.status = 'active' and v.kind in ('입금', '출금') and v.date < c.cutoff
                         and (ca.opening_date is null or v.date >= ca.opening_date)), 0)
    from erp.cash_accounts ca where ca.company_id = c.company_id;

    create temp table if not exists _loan (id text, name text, account_code text, partner_id text, bal numeric) on commit drop;
    truncate _loan;
    insert into _loan
    select l.id, l.name, l.account_code, l.partner_id,
           coalesce(l.opening_principal, 0) + coalesce((select sum(j.credit - j.debit) from erp.vouchers v join erp.journal_lines j on j.voucher_id = v.id and j.account_code = l.account_code
                                                        where v.loan_id = l.id and v.status = 'active' and v.date < c.cutoff), 0)
    from erp.loan_contracts l where l.company_id = c.company_id and l.account_code is not null;

    -- 통장·차입금 계정은 분개 잔액이 0이어도 계좌·계약 기초를 넣으면 차이 줄이 필요하다 → 빈 줄을 미리 둔다
    insert into _bal select x.code, null, 0 from (select distinct case when type = '현금' then '102' else '103' end code from _cash where coalesce(type, '') <> '카드'
                                                  union select distinct account_code from _loan) x
    where not exists (select 1 from _bal b where b.account_code = x.code and b.partner_id is null);

    -- ---------- 3) 기준일 전 전표 보관 ----------
    update erp.vouchers set status = 'archived' where company_id = c.company_id and status = 'active' and date < c.cutoff;

    -- 고르지 않은 옛 일
    update erp.orders o set status = case when x.kind = 'order' then 'DELIVERED' else o.status end,
           accounting_excluded = true, accounting_excluded_reason = '이관 안 함(' || c.cutoff || ' 전 주문)'
    from app.migration_candidates x
    where x.company_id = c.company_id and x.kind in ('order', 'unbilled') and x.ref_id = o.id
      and not exists (select 1 from app.migration_picks k where k.company_id = x.company_id and k.kind = x.kind and k.ref_id = x.ref_id);
    update erp.purchase_orders po set status = 'cancelled', note = trim(coalesce(po.note, '') || ' 이관 안 함(' || c.cutoff || ' 전 발주)')
    from app.migration_candidates x
    where x.company_id = c.company_id and x.kind in ('po', 'po_unbilled') and x.ref_id = po.id
      and not exists (select 1 from app.migration_picks k where k.company_id = x.company_id and k.kind = x.kind and k.ref_id = x.ref_id);

    -- ---------- 4) 기초 전표(기준일 전날) ----------
    -- 통장·현금: 계좌별 기초. 카드는 기초 전표 없이 숫자만(기존 규칙).
    for r in select * from _cash loop
      update erp.cash_accounts set opening_balance = round(r.bal), opening_date = v_open where id = r.id;
      if coalesce(r.type, '') <> '카드' then
        perform erp.put_opening('opening-cash-' || c.company_id || '-' || r.id, c.company_id, v_open, null, '기초계좌-' || r.id, '기초 잔액',
                                abs(round(r.bal)),
                                case when r.bal >= 0 then case when r.type = '현금' then '102' else '103' end else '375' end,
                                case when r.bal >= 0 then r.name else '기초 이월이익잉여금' end,
                                case when r.bal >= 0 then '375' else case when r.type = '현금' then '102' else '103' end end,
                                case when r.bal >= 0 then '기초 이월이익잉여금' else r.name end);
      end if;
    end loop;
    -- 차입금: 계약별 기초 원금
    for r in select * from _loan loop
      update erp.loan_contracts set opening_principal = round(r.bal), opening_date = v_open where id = r.id;
      perform erp.put_opening('opening-loan-' || c.company_id || '-' || r.id, c.company_id, v_open, r.partner_id, '기초대출-' || r.id, '기초 차입금',
                              abs(round(r.bal)),
                              case when r.bal >= 0 then '375' else r.account_code end, case when r.bal >= 0 then '기초 이월이익잉여금' else r.name end,
                              case when r.bal >= 0 then r.account_code else '375' end, case when r.bal >= 0 then r.name else '기초 이월이익잉여금' end);
    end loop;
    -- 나머지 계정: 거래처 계정은 거래처별, 그 밖은 계정별. 통장·차입금 계정은 위에서 넣고 남은 차이만.
    for r in select b.account_code, b.partner_id, sum(b.bal) bal from _bal b group by 1, 2 loop
      v_bal := r.bal;
      if r.account_code in ('102', '103') and r.partner_id is null then
        v_bal := v_bal - coalesce((select sum(round(x.bal)) from _cash x where coalesce(x.type, '') <> '카드' and (case when x.type = '현금' then '102' else '103' end) = r.account_code), 0);
      end if;
      if exists (select 1 from _loan x where x.account_code = r.account_code) and r.partner_id is null then
        -- 차입금 계정은 대변 잔액(음수). 계약 기초로 넣은 만큼 뺀다.
        v_bal := v_bal + coalesce((select sum(round(x.bal)) from _loan x where x.account_code = r.account_code), 0);
      end if;
      v_bal := round(v_bal);
      continue when v_bal = 0;
      v_name := coalesce((select a.name from erp.accounts a where a.company_id = c.company_id and a.code = r.account_code limit 1), r.account_code);
      if r.partner_id is not null and r.account_code in ('108', '251') and ((r.account_code = '108') = (v_bal > 0)) then
        -- 기초 잔액 화면(거래처)과 같은 id — 화면에서 고치면 이 전표가 고쳐진다
        v_id := 'opening-partner-' || c.company_id || '-' || v_open || '-' || r.partner_id || '-' || r.account_code;
        perform erp.put_opening(v_id, c.company_id, v_open, r.partner_id, '기초-' || replace(v_open::text, '-', '') || '-' || r.partner_id || '-' || r.account_code,
                                case when r.account_code = '108' then '기초 미수금' else '기초 미지급금' end, abs(v_bal),
                                case when v_bal > 0 then r.account_code else '375' end,
                                case when v_bal > 0 then '기초 미수금(이월)' else '기초 이월이익잉여금' end,
                                case when v_bal > 0 then '375' else r.account_code end,
                                case when v_bal > 0 then '기초 이월이익잉여금' else '기초 미지급금(이월)' end);
      else
        v_id := 'opening-cutover-' || c.company_id || '-' || r.account_code || '-' || coalesce(r.partner_id, '');
        perform erp.put_opening(v_id, c.company_id, v_open, r.partner_id, '기초-' || replace(v_open::text, '-', '') || '-' || r.account_code,
                                '기초 ' || v_name || case when r.account_code in ('102', '103') then '(계좌 미지정 차이)' when exists (select 1 from _loan x where x.account_code = r.account_code) then '(계약 미지정 차이)' else '' end,
                                abs(v_bal),
                                case when v_bal > 0 then r.account_code else '375' end, case when v_bal > 0 then v_name else '기초 이월이익잉여금' end,
                                case when v_bal > 0 then '375' else r.account_code end, case when v_bal > 0 then '기초 이월이익잉여금' else v_name end);
      end if;
    end loop;
  end loop;
end $$;

-- ---------- 이관 고르기 화면 ----------
create or replace function public.migration_list(p_company text)
returns table (kind text, ref_id text, ref_date date, partner_name text, summary text, amount numeric, picked boolean, cutoff date, applied boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_admin(p_company);
  return query
  select x.kind, x.ref_id, x.ref_date, x.partner_name, x.summary, x.amount,
         exists (select 1 from app.migration_picks k where k.company_id = x.company_id and k.kind = x.kind and k.ref_id = x.ref_id),
         s.cutoff, s.apply
  from app.migration_candidates x join app.migration_settings s on s.company_id = x.company_id
  where x.company_id = p_company
  order by x.kind, x.ref_date, x.partner_name;
end $$;

create or replace function public.set_migration_pick(p_company text, p_kind text, p_refs text[], p_pick boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform erp.assert_admin(p_company);
  if p_pick then
    insert into app.migration_picks (company_id, kind, ref_id, picked_by)
    select p_company, p_kind, r, erp.actor_name() from unnest(p_refs) r
    where exists (select 1 from app.migration_candidates x where x.company_id = p_company and x.kind = p_kind and x.ref_id = r)
    on conflict do nothing;
  else
    delete from app.migration_picks where company_id = p_company and kind = p_kind and ref_id = any (p_refs);
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.migration_list(text), public.set_migration_pick(text, text, text[], boolean) from public, anon;
grant execute on function public.migration_list(text), public.set_migration_pick(text, text, text[], boolean) to authenticated;
