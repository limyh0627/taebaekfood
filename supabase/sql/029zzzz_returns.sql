-- erp-core 저장소 supabase/returns.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 반품: 매출·매입 명세서에서 줄과 수량을 골라 '마이너스 명세서'를 만든다. purchasing.sql·lots.sql 뒤에 돈다.
--
--  · 반품 명세서는 원 명세서와 같은 종류(매출/매입)이고 수량·금액이 음수다. return_of가 원 명세서를 가리킨다.
--    → 분개(journal_raw)는 음수를 반대쪽으로 돌려 (차) 매출계정·255 (대) 108 이 되고, 거래처 잔액·월 세금계산서 합계에서 자연히 빠진다.
--  · 금액은 원 줄을 수량 비율로 나눈다. 그 줄의 남은 수량을 다 돌려받으면 남은 금액을 그대로 쓴다(반올림 찌꺼기 없음).
--  · 재고: 매출 반품은 '다시 팔 수 있음'인 줄만 +, 매입 반품은 − (오래된 로트부터).
--  · 반품이 걸린 원 명세서는 취소(출고 취소·입고 취소)할 수 없다. 반품을 먼저 취소한다.

alter table erp.vouchers add column if not exists return_of text references erp.vouchers(id);
alter table erp.voucher_lines add column if not exists source_line_no int;
create index if not exists vouchers_return_of on erp.vouchers (return_of) where return_of is not null;

-- 원 명세서 줄별로 이미 돌려받은 수량·금액(취소 안 된 반품만, 양수로)
create or replace view erp.returned_lines as
select r.return_of as voucher_id, l.source_line_no as line_no,
       -sum(l.qty) as qty, -sum(l.supply) as supply, -sum(l.tax) as tax, -sum(l.amount) as amount
from erp.vouchers r join erp.voucher_lines l on l.voucher_id = r.id
where r.return_of is not null and r.status = 'active'
group by 1, 2;
alter view erp.returned_lines set (security_invoker = true);
grant select on erp.returned_lines to authenticated;

-- p: {voucher_id, date?, memo?, lines: [{line_no, qty, restock?}]}  qty는 양수(돌려받는 수량)
create or replace function public.create_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  src erp.vouchers;
  v_date date := coalesce((p->>'date')::date, current_date);
  v_id text := 'v-' || gen_random_uuid();
  v_no text;
  r record;
  n int := 0;
  v_sup numeric; v_tax numeric;
begin
  select * into src from erp.vouchers where id = p->>'voucher_id' for update;
  if not found then raise exception '명세서를 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(src.company_id);  -- 직원은 반품 요청(request_return) → 관리자 확인사항에서 반품 처리(기존 앱과 같음)
  if src.kind not in ('매출', '매입') then raise exception '매출·매입 명세서만 반품할 수 있습니다.'; end if;
  if src.status <> 'active' then raise exception '취소된 명세서입니다.'; end if;
  if src.return_of is not null then raise exception '반품 명세서는 다시 반품할 수 없습니다.'; end if;
  if jsonb_typeof(p->'lines') <> 'array' then raise exception '반품할 줄을 고르세요.'; end if;

  create temp table if not exists _ret (line_no int, qty numeric, restock boolean) on commit drop;
  truncate _ret;
  insert into _ret select (l->>'line_no')::int, (l->>'qty')::numeric, coalesce((l->>'restock')::boolean, true)
  from jsonb_array_elements(p->'lines') l where coalesce((l->>'qty')::numeric, 0) <> 0;
  if not exists (select 1 from _ret) then raise exception '반품할 수량을 넣으세요.'; end if;
  if exists (select 1 from _ret g
             left join erp.voucher_lines l on l.voucher_id = src.id and l.line_no = g.line_no
             left join erp.returned_lines x on x.voucher_id = src.id and x.line_no = g.line_no
             where l.voucher_id is null or coalesce(l.qty, 0) <= 0 or g.qty < 0
                or g.qty > l.qty - coalesce(x.qty, 0) + 0.0005) then
    raise exception '원 명세서에 없는 줄이거나, 남은 수량보다 많이 반품합니다.';
  end if;

  v_no := erp.next_no(src.company_id, v_date, '', 'voucher');
  insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, return_of, memo,
                            created_by, created_at, legacy_collection)
  values (v_id, src.company_id, v_no, v_date, src.kind, src.partner_id, src.partner_name, src.id,
          concat_ws(' ', '반품(원 명세서 ' || coalesce(src.voucher_no, src.id) || ')', nullif(p->>'memo', '')),
          erp.actor_name(), now(), 'app');

  for r in select g.qty as q, g.restock, l.*, coalesce(x.qty, 0) as rq, coalesce(x.supply, 0) as rs, coalesce(x.tax, 0) as rt
           from _ret g join erp.voucher_lines l on l.voucher_id = src.id and l.line_no = g.line_no
           left join erp.returned_lines x on x.voucher_id = src.id and x.line_no = g.line_no
           order by g.line_no loop
    n := n + 1;
    if abs(r.q - (r.qty - r.rq)) < 0.0005 then
      v_sup := coalesce(r.supply, 0) - r.rs; v_tax := coalesce(r.tax, 0) - r.rt;
    else
      v_sup := erp.js_round(coalesce(r.supply, 0) * r.q / r.qty); v_tax := erp.js_round(coalesce(r.tax, 0) * r.q / r.qty);
    end if;
    insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, spec, qty, price, supply, tax, amount,
                                   account_code, tax_exempt, source_line_no, note)
    values (v_id, n, 'item', r.item_id, r.name, r.spec, -r.q, r.price, -v_sup, -v_tax, -(v_sup + v_tax),
            r.account_code, r.tax_exempt, r.line_no,
            case when src.kind = '매출' and not r.restock then '재고로 안 돌림' end);
    if r.item_id is not null and (src.kind = '매입' or r.restock) then
      perform erp.post_stock('ret:' || v_id || ':' || n, src.company_id, r.item_id,
                             case when src.kind = '매출' then r.q else -r.q end,
                             case when src.kind = '매출' then '반품 입고' else '반품 출고' end,
                             'return', v_id, src.partner_id, v_date, coalesce(src.voucher_no, src.id));
    end if;
  end loop;

  update erp.vouchers v set supply = s.supply, tax = s.tax, amount = s.amount
  from (select sum(supply) supply, sum(tax) tax, sum(amount) amount from erp.voucher_lines where voucher_id = v_id) s
  where v.id = v_id;
  -- 미결 명세서에서 원 명세서를 먼저 줄이도록 반제로 묶는다
  insert into erp.voucher_applies (id, company_id, voucher_id, applies_to, amount, created_at)
  select 'ap-' || gen_random_uuid(), src.company_id, v_id, src.id, -amount, now() from erp.vouchers where id = v_id and amount < 0;

  return jsonb_build_object('voucher_id', v_id, 'voucher_no', v_no, 'lines', n);
end $$;

-- 반품 취소: 재고를 되돌리고 반품 명세서를 취소한다.
create or replace function public.cancel_return(p_voucher_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v erp.vouchers; r record;
begin
  select * into v from erp.vouchers where id = p_voucher_id for update;
  if not found or v.return_of is null then raise exception '반품 명세서를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v.company_id);
  if v.status <> 'active' then raise exception '이미 취소된 반품입니다.'; end if;
  for r in select l.* from erp.stock_ledger l
           where l.source_type = 'return' and l.source_id = v.id and l.stock_effect
             and not exists (select 1 from erp.stock_ledger x where x.reversal_of = l.id) loop
    perform erp.post_stock('unret:' || r.id, r.company_id, r.item_id, -r.qty, '반품 취소', 'return', v.id,
                           r.partner_id, current_date, r.note, r.id);
  end loop;
  update erp.vouchers set status = 'canceled' where id = v.id;
end $$;

-- 반품이 살아 있는 명세서는 취소 못 하게
create or replace function erp.guard_returned_voucher() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'canceled' and old.status = 'active'
     and exists (select 1 from erp.vouchers r where r.return_of = new.id and r.status = 'active') then
    raise exception '반품이 걸린 명세서입니다. 반품을 먼저 취소하세요.';
  end if;
  return new;
end $$;
drop trigger if exists vouchers_guard_returned on erp.vouchers;
create trigger vouchers_guard_returned before update of status on erp.vouchers
for each row execute function erp.guard_returned_voucher();

-- 직원 반품 요청: 고른 줄·수량·재입고 여부를 담아 확인사항에 올린다. 관리자가 승인하면 그대로 create_return.
alter table erp.adjustment_requests add column if not exists payload jsonb;
alter table erp.adjustment_requests add column if not exists voucher_id text;
create or replace function public.request_return(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare src erp.vouchers; v_id text := 'RET-' || gen_random_uuid(); v_desc text;
begin
  select * into src from erp.vouchers where id = p->>'voucher_id';
  if not found then raise exception '명세서를 찾을 수 없습니다.'; end if;
  perform erp.assert_member(src.company_id);
  if src.kind not in ('매출', '매입') or src.status <> 'active' or src.return_of is not null then raise exception '반품할 수 없는 명세서입니다.'; end if;
  if exists (select 1 from erp.adjustment_requests where type = 'return_request' and status = 'pending' and payload->>'voucher_id' = src.id) then
    raise exception '이 명세서는 이미 반품 요청이 올라가 있습니다.';
  end if;
  select string_agg(coalesce(l.name, '') || ' ' || (x->>'qty'), ', ') into v_desc
  from jsonb_array_elements(coalesce(p->'lines', '[]')) x join erp.voucher_lines l on l.voucher_id = src.id and l.line_no = (x->>'line_no')::int
  where coalesce((x->>'qty')::numeric, 0) > 0;
  if v_desc is null then raise exception '돌려받을 수량을 넣으세요.'; end if;
  insert into erp.adjustment_requests (id, company_id, type, status, reason, voucher_id, payload, requested_at)
  values (v_id, src.company_id, 'return_request', 'pending',
          coalesce(src.voucher_no, '') || ' ' || coalesce(src.partner_name, '') || ' — ' || v_desc || coalesce(' · ' || nullif(p->>'memo', ''), '')
            || ' (' || coalesce((select name from public.company_people(src.company_id) where user_id = auth.uid()), erp.actor_name(), '') || ')',
          src.id, p, now());
  return v_id;
end $$;
revoke all on function public.request_return(jsonb) from public, anon;
grant execute on function public.request_return(jsonb) to authenticated;

revoke all on function public.create_return(jsonb), public.cancel_return(text) from public, anon;
grant execute on function public.create_return(jsonb), public.cancel_return(text) to authenticated;
