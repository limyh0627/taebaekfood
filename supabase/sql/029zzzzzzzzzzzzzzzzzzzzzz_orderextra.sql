-- erp-core 저장소 supabase/orderextra.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 주문 카드 나머지 — 기존 앱과 같게(2026-11-05). taxdoc.sql 뒤에 돈다.
--  송장 양식(A~E, 택배사 양식), 파렛트(종류별 수량, 교환은 거래처 잔량에서 뺌), 택배 포장 박스(어느 박스 몇 개 — 기록만, 기존 앱도 재고 안 뺌).
--  파렛트는 출고할 때 거래처로 나간 것으로 원장에 남고(파렛트 화면 거래처별 잔량), 출고 취소하면 되돌린다.

alter table erp.orders add column if not exists invoice_type text check (invoice_type in ('A', 'B', 'C', 'D', 'E'));
alter table erp.orders add column if not exists pallets jsonb not null default '[]';         -- [{item_id, qty, exchange}]
alter table erp.orders add column if not exists delivery_boxes jsonb not null default '[]';  -- [{item_id, qty}]

-- 옛 주문에서 옮기기(시험 이전 때만)
do $$ begin
  if to_regclass('raw.docs') is null then return; end if;
  update erp.orders o set
    invoice_type = case when d.data->>'invoiceType' in ('A', 'B', 'C', 'D', 'E') then d.data->>'invoiceType' end,
    pallets = coalesce((select jsonb_agg(jsonb_build_object('item_id', p->>'type', 'qty', (p->>'quantity')::numeric, 'exchange', coalesce((p->>'isExchange')::boolean, false)))
                        from jsonb_array_elements(case when jsonb_typeof(d.data->'pallets') = 'array' then d.data->'pallets' else '[]' end) p
                        where exists (select 1 from erp.items i where i.id = p->>'type' and i.type = 'PALLET') and coalesce((p->>'quantity')::numeric, 0) > 0), '[]'),
    delivery_boxes = coalesce((select jsonb_agg(jsonb_build_object('item_id', b->>'itemId', 'qty', (b->>'quantity')::numeric))
                        from jsonb_array_elements(case when jsonb_typeof(d.data->'deliveryBoxes') = 'array' then d.data->'deliveryBoxes' else '[]' end) b
                        where exists (select 1 from erp.items i where i.id = b->>'itemId') and coalesce((b->>'quantity')::numeric, 0) > 0), '[]')
  from raw.docs d where d.collection = 'orders' and d.id = o.id;

  -- 옛 앱은 출고한 주문의 파렛트를 거래처 잔량에 셌는데(palletBalances.ts), 이전은 지급·회수 표만 옮겼다 → 이력으로 더한다.
  -- 보유 수량(기초)에는 이미 반영돼 있으니 stock_effect false.
  insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, source_id, partner_id, effective_date, note)
  select 'pallet:order:' || o.id || ':' || (p->>'item_id'), o.company_id, p->>'item_id', -(p->>'qty')::numeric, false, '개', '파렛트 지급', 'pallet', o.id,
         o.partner_id, coalesce(o.delivery_date, o.created_at::date), '주문 ' || coalesce(o.card_no, o.id) || ' 출고(이전)'
  from erp.orders o, jsonb_array_elements(o.pallets) p
  where o.status in ('SHIPPED', 'DELIVERED') and o.partner_id is not null and not coalesce((p->>'exchange')::boolean, false)
  on conflict (id) do nothing;

  -- 이동전표(isTransfer)는 거래처 잔량과 상관없다(옛 앱도 뺐음) → 거래처를 비운다
  update erp.stock_ledger l set partner_id = null
  from raw.docs d where d.collection = 'palletTransactions' and l.id = 'pallet:' || d.id and coalesce((d.data->>'isTransfer')::boolean, false);
end $$;

-- p: {invoice_type?: 'A'..'E'|null, pallets?: [{item_id, qty, exchange}], delivery_boxes?: [{item_id, qty}]}
create or replace function public.set_order_pack(p_order text, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare o erp.orders; v_pal jsonb; v_box jsonb;
begin
  select * into o from erp.orders where id = p_order for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(o.company_id);
  if p ? 'invoice_type' then
    if nullif(p->>'invoice_type', '') is not null and p->>'invoice_type' not in ('A', 'B', 'C', 'D', 'E') then raise exception '송장 양식은 A~E 중에서 고르세요.'; end if;
    update erp.orders set invoice_type = nullif(p->>'invoice_type', '') where id = o.id;
  end if;
  if p ? 'pallets' then
    if o.shipped_at is not null then raise exception '출고한 주문의 파렛트는 출고를 취소한 뒤 고치세요.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('item_id', x->>'item_id', 'qty', (x->>'qty')::int, 'exchange', coalesce((x->>'exchange')::boolean, false))), '[]') into v_pal
    from jsonb_array_elements(coalesce(p->'pallets', '[]')) x where coalesce((x->>'qty')::numeric, 0) > 0;
    if exists (select 1 from jsonb_array_elements(v_pal) x where not exists (select 1 from erp.items i where i.id = x->>'item_id' and i.company_id = o.company_id and i.type = 'PALLET')) then
      raise exception '파렛트를 찾을 수 없습니다.';
    end if;
    update erp.orders set pallets = v_pal where id = o.id;
  end if;
  if p ? 'delivery_boxes' then
    select coalesce(jsonb_agg(jsonb_build_object('item_id', x->>'item_id', 'qty', (x->>'qty')::int)), '[]') into v_box
    from jsonb_array_elements(coalesce(p->'delivery_boxes', '[]')) x where coalesce((x->>'qty')::numeric, 0) > 0;
    if exists (select 1 from jsonb_array_elements(v_box) x where not exists (select 1 from erp.items i where i.id = x->>'item_id' and i.company_id = o.company_id)) then
      raise exception '박스 품목을 찾을 수 없습니다.';
    end if;
    update erp.orders set delivery_boxes = v_box where id = o.id;
  end if;
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('pack:' || gen_random_uuid(), o.company_id, o.id, 'pack', p, erp.actor_name(), now());
end $$;

-- 출고하면 파렛트가 거래처로 나가고(교환은 빼고), 출고 취소하면 들어온다
create or replace function erp.order_pallets_on_ship() returns trigger
language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_sign int;
begin
  if (old.shipped_at is null) = (new.shipped_at is null) or new.partner_id is null then return new; end if;
  v_sign := case when new.shipped_at is not null then -1 else 1 end;
  for x in select * from jsonb_array_elements(coalesce(new.pallets, '[]')) loop
    continue when coalesce((x->>'exchange')::boolean, false) or coalesce((x->>'qty')::numeric, 0) <= 0;
    perform erp.post_stock('pallet:' || gen_random_uuid(), new.company_id, x->>'item_id', v_sign * (x->>'qty')::numeric,
      case when v_sign < 0 then '파렛트 지급' else '파렛트 회수' end, 'pallet', new.id, new.partner_id,
      (now() at time zone 'Asia/Seoul')::date, '주문 ' || coalesce(new.card_no, new.id) || case when v_sign < 0 then ' 출고' else ' 출고 취소' end);
  end loop;
  return new;
end $$;
drop trigger if exists order_pallets_on_ship on erp.orders;
create trigger order_pallets_on_ship after update of shipped_at on erp.orders for each row execute function erp.order_pallets_on_ship();

revoke all on function public.set_order_pack(text, jsonb) from public, anon;
grant execute on function public.set_order_pack(text, jsonb) to authenticated;
