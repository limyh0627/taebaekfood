-- erp-core 저장소 supabase/delivery.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 배송 일정(기존 앱 DeliveryManager·deliveryPlan과 같게, 2026-11-05). home.sql 뒤에 돈다.
--  날짜마다: 사람이 정한 차례(ordering) · 실은 것 체크(done) · 같이 싣는 묶음(groups) · 마지막으로 손댄 사람.
--  오전/오후는 주문마다(orders.delivery_slot, 없으면 오전). 다른 날로 옮기기 = 배송일 바꾸기(set_order_meta).
--  옛 앱 settings/deliveryOrdering(byDate, timeSlots)을 처음 한 번 옮긴다.

alter table erp.orders add column if not exists delivery_slot text;
create table if not exists erp.delivery_plans (
  company_id text not null references erp.companies(id),
  day        date not null,
  ordering   text[] not null default '{}',
  done       text[] not null default '{}',
  groups     jsonb not null default '[]',   -- [{id, name?, orderIds: []}]
  by_name    text,
  updated_at timestamptz,
  primary key (company_id, day)
);
alter table erp.delivery_plans enable row level security;
revoke all on erp.delivery_plans from anon, authenticated;
grant select on erp.delivery_plans to authenticated;
drop policy if exists member_read on erp.delivery_plans;
create policy member_read on erp.delivery_plans for select to authenticated using (company_id = any (app.my_company_ids()));

-- 옛 계획 옮기기(이미 있으면 그대로)
insert into erp.delivery_plans (company_id, day, ordering, done, groups, by_name, updated_at)
select s.company_id, b.key::date,
       coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(b.value->'ordering') = 'array' then b.value->'ordering' end) x), '{}'),
       coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(b.value->'done') = 'array' then b.value->'done' end) x), '{}'),
       case when jsonb_typeof(b.value->'groups') = 'array' then b.value->'groups' else '[]' end,
       b.value#>>'{by,name}', (b.value#>>'{by,at}')::timestamptz
from erp.settings s cross join lateral jsonb_each(case when jsonb_typeof(s.data->'byDate') = 'object' then s.data->'byDate' end) b
where s.id like 'deliveryOrdering%' and s.company_id is not null and b.key ~ '^\d{4}-\d{2}-\d{2}$'
on conflict (company_id, day) do nothing;
update erp.orders o set delivery_slot = t.slot
from (select distinct on (k.key) k.key id, k.value #>> '{}' slot
      from erp.settings s
      cross join lateral (select s.data->'timeSlots' ts union all select b.value->'timeSlots' from jsonb_each(case when jsonb_typeof(s.data->'byDate') = 'object' then s.data->'byDate' end) b) t0
      cross join lateral jsonb_each(case when jsonb_typeof(t0.ts) = 'object' then t0.ts end) k
      where s.id like 'deliveryOrdering%') t
where o.id = t.id and o.delivery_slot is null and t.slot in ('오전', '오후');

-- p: {ordering?: [], done?: [], groups?: []} — 준 것만 바꾼다
create or replace function public.save_delivery_plan(p_company text, p_day date, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  if p ? 'groups' and jsonb_typeof(p->'groups') <> 'array' then raise exception '묶음 형식이 맞지 않습니다.'; end if;
  insert into erp.delivery_plans (company_id, day, by_name, updated_at) values (p_company, p_day, erp.actor_name(), now())
  on conflict (company_id, day) do nothing;
  update erp.delivery_plans set
    ordering = case when p ? 'ordering' then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'ordering') x), '{}') else ordering end,
    done = case when p ? 'done' then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'done') x), '{}') else done end,
    groups = case when p ? 'groups' then p->'groups' else groups end,
    by_name = erp.actor_name(), updated_at = now()
  where company_id = p_company and day = p_day;
end $$;
revoke all on function public.save_delivery_plan(text, date, jsonb) from public, anon;
grant execute on function public.save_delivery_plan(text, date, jsonb) to authenticated;
