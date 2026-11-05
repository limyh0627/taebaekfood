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

revoke all on function public.tax_invoice_lines(text), public.save_tax_invoice_items(text, jsonb) from public, anon;
grant execute on function public.tax_invoice_lines(text), public.save_tax_invoice_items(text, jsonb) to authenticated;
