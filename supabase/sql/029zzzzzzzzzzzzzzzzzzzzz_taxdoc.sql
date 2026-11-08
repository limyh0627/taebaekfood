-- erp-core 저장소 supabase/taxdoc.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 세금계산서 미리보기·품목 편집 — 기존 앱 세금계산서 발행 탭과 같게(2026-11-05). officetalk.sql 뒤에 돈다.
--  계산서 한 장의 품목은 묶인 명세서 줄을 품목·규격별로 합친 것이 기본. 발행대기일 때 품목 이름·규격·수량·금액을 고칠 수 있고(기존 앱과 같음),
--  고친 줄 합계가 계산서 공급가액·세액이 된다. 묶인 명세서와 달라지면 화면에 차이를 보여 준다.

alter table erp.tax_invoices add column if not exists items jsonb;   -- [{name, spec, qty, supply, tax}] — 비어 있으면 명세서에서 만든다

create or replace function public.tax_invoice_lines(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t erp.tax_invoices;
begin
  select * into t from erp.tax_invoices where id = p_id;
  if not found then raise exception '계산서를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(t.company_id);
  if t.items is not null then return jsonb_build_object('edited', true, 'items', t.items); end if;
  return jsonb_build_object('edited', false, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('name', name, 'spec', spec, 'qty', qty, 'supply', supply, 'tax', tax) order by supply desc)
    from (select coalesce(l.name, '') name, coalesce(l.spec, '') spec, sum(l.qty) qty, sum(l.supply) supply, sum(l.tax) tax
          from erp.tax_invoice_vouchers tv join erp.voucher_lines l on l.voucher_id = tv.voucher_id
          where tv.invoice_id = t.id and coalesce(l.tax_exempt, false) = (t.kind = '계산서')
          group by 1, 2 having sum(l.supply) <> 0) x), '[]'));
end $$;

-- p_items가 null이면 처음(명세서대로)으로 되돌린다
create or replace function public.save_tax_invoice_items(p_id text, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t erp.tax_invoices; v_supply numeric; v_tax numeric; v_n int; v_top text;
begin
  select * into t from erp.tax_invoices where id = p_id for update;
  if not found then raise exception '계산서를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(t.company_id);
  if t.status <> '발행대기' then raise exception '발행대기인 계산서만 고칩니다. 발행한 것은 취소하고 다시 묶으세요.'; end if;
  if p_items is null then   -- 명세서대로: 묶인 명세서 합계로 되돌린다
    update erp.tax_invoices set items = null,
           supply = (select coalesce(sum(supply), 0) from erp.tax_invoice_vouchers where invoice_id = p_id),
           tax = (select coalesce(sum(tax), 0) from erp.tax_invoice_vouchers where invoice_id = p_id),
           amount = (select coalesce(sum(supply + tax), 0) from erp.tax_invoice_vouchers where invoice_id = p_id) where id = p_id;
    return;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception '품목이 하나는 있어야 합니다.'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where coalesce(trim(x->>'name'), '') = '') then raise exception '품목 이름을 비울 수 없습니다.'; end if;
  select sum(round((x->>'supply')::numeric)), sum(round((x->>'tax')::numeric)), count(*) into v_supply, v_tax, v_n from jsonb_array_elements(p_items) x;
  if t.kind = '계산서' and v_tax <> 0 then raise exception '계산서(면세)는 세액이 0이어야 합니다.'; end if;
  select x->>'name' into v_top from jsonb_array_elements(p_items) x order by (x->>'supply')::numeric desc limit 1;
  update erp.tax_invoices set
    items = (select jsonb_agg(jsonb_build_object('name', trim(x->>'name'), 'spec', coalesce(x->>'spec', ''), 'qty', nullif(x->>'qty', '')::numeric,
                                                 'supply', round((x->>'supply')::numeric), 'tax', round((x->>'tax')::numeric))) from jsonb_array_elements(p_items) x),
    item_summary = v_top || case when v_n > 1 then ' 외 ' || (v_n - 1) || '건' else '' end,
    supply = v_supply, tax = v_tax, amount = v_supply + v_tax
  where id = p_id;
end $$;

-- 이 달 명세서 하나하나: 과세(공급가·세액)·면세 금액과 이미 계산서에 묶였는지(2026-11-08, 사용자가 골라 묶기)
create or replace function public.tax_invoice_candidates(p_company text, p_month text, p_direction text default '매출')
returns table (voucher_id text, voucher_no text, date date, partner_id text, partner_name text, biz_no text, summary text,
               tax_supply numeric, tax_tax numeric, exempt numeric, tax_bound boolean, exempt_bound boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_from date := (p_month || '-01')::date;
begin
  perform erp.assert_member(p_company);
  return query
  select v.id, v.voucher_no, v.date, v.partner_id, coalesce(p.name, v.partner_name), p.biz_no,
         (select case when count(*) = 0 then v.memo else (array_agg(l.name order by l.line_no))[1] || case when count(*) > 1 then ' 외 ' || (count(*) - 1) || '개' else '' end end
          from erp.voucher_lines l where l.voucher_id = v.id and l.side is null),
         coalesce(sum(l.supply) filter (where not coalesce(l.tax_exempt, false)), 0),
         coalesce(sum(l.tax) filter (where not coalesce(l.tax_exempt, false)), 0),
         coalesce(sum(l.supply + l.tax) filter (where coalesce(l.tax_exempt, false)), 0),
         exists (select 1 from erp.tax_invoice_vouchers tv join erp.tax_invoices t on t.id = tv.invoice_id where tv.voucher_id = v.id and t.status <> '취소' and t.kind = '세금계산서'),
         exists (select 1 from erp.tax_invoice_vouchers tv join erp.tax_invoices t on t.id = tv.invoice_id where tv.voucher_id = v.id and t.status <> '취소' and t.kind = '계산서')
  from erp.vouchers v
  left join erp.partners p on p.id = v.partner_id
  left join erp.voucher_lines l on l.voucher_id = v.id and l.side is null
  where v.company_id = p_company and v.kind = p_direction and v.status = 'active' and v.partner_id is not null
    and v.date between v_from and (v_from + interval '1 month - 1 day')::date
  group by v.id, p.name, p.biz_no
  order by coalesce(p.name, v.partner_name), v.date, v.voucher_no;
end $$;

-- 고른 명세서만 묶기: 거래처마다 과세 줄은 세금계산서 한 장, 면세 줄은 계산서 한 장. 이미 묶인 갈래는 빼고. 작성일은 그 달 말일.
create or replace function public.build_tax_invoices_for(p_company text, p_month text, p_direction text, p_vouchers text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_from date; v_to date; n int := 0; g record; v_id text;
begin
  perform erp.assert_member(p_company);
  if p_direction not in ('매출', '매입') then raise exception '매출 또는 매입만 됩니다.'; end if;
  if coalesce(array_length(p_vouchers, 1), 0) = 0 then raise exception '묶을 명세서를 고르세요.'; end if;
  v_from := (p_month || '-01')::date;
  v_to := (v_from + interval '1 month - 1 day')::date;
  for g in
    select v.partner_id, case when coalesce(l.tax_exempt, false) then '계산서' else '세금계산서' end as kind,
           array_agg(distinct v.id) as vids, sum(l.supply) as supply, sum(l.tax) as tax,
           (array_agg(l.name order by l.amount desc))[1] as top_item, count(distinct l.name) as names
    from erp.vouchers v join erp.voucher_lines l on l.voucher_id = v.id and l.side is null
    where v.id = any (p_vouchers) and v.company_id = p_company and v.kind = p_direction and v.status = 'active' and v.partner_id is not null
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
    where l.voucher_id = any (g.vids) and l.side is null and (coalesce(l.tax_exempt, false) = (g.kind = '계산서'))
    group by l.voucher_id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception '고른 명세서가 이미 다 묶였거나 금액이 없습니다.'; end if;
  return n;
end $$;
revoke all on function public.tax_invoice_candidates(text, text, text), public.build_tax_invoices_for(text, text, text, text[]) from public, anon;
grant execute on function public.tax_invoice_candidates(text, text, text), public.build_tax_invoices_for(text, text, text, text[]) to authenticated;

revoke all on function public.tax_invoice_lines(text), public.save_tax_invoice_items(text, jsonb) from public, anon;
grant execute on function public.tax_invoice_lines(text), public.save_tax_invoice_items(text, jsonb) to authenticated;
