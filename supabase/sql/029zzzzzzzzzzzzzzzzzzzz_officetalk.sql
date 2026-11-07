-- erp-core 저장소 supabase/officetalk.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 오피스톡 더하기 — 기존 앱과 같게(2026-11-05). comms.sql·projects.sql 뒤에 돈다.
--  이모지 반응(👍❤️😂😮😢👏, 한 사람이 여럿, 다시 누르면 뗌), 메시지마다 방 사람 모두에게 종 알림(기존 앱과 같음: '보낸 사람 (방)'),
--  @이름 멘션은 메시지에 남김, @관리자 → 확인사항(멘션), 메시지 → 주문 만들기(만든 주문을 메시지에 표시).
--  주문 글 읽기에서 사람이 고친 이름 → 품목은 거래처별로 남겨 다음에 그렇게 읽는다(order_interpretation_rules).

alter table erp.chat_messages add column if not exists reactions jsonb not null default '{}';
alter table erp.chat_messages add column if not exists mentions text[];
alter table erp.chat_messages add column if not exists order_id text;

-- 옛 반응·멘션·주문 연결 옮기기(시험 이전 때만). 옛 id(Firebase uid 또는 직원 id) → 계정 id
create or replace function erp.chat_user(p_company text, p_old text) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select me.user_id::text from erp.employees e join app.member_employees me on me.employee_id = e.id and me.company_id = e.company_id
     where e.company_id = p_company and (e.legacy_uid = p_old or e.id = p_old) limit 1),
    p_old) $$;
do $$ begin
  if to_regclass('raw.docs') is null then return; end if;
  update erp.chat_messages m set
    reactions = coalesce((select jsonb_object_agg(k, (select jsonb_agg(distinct erp.chat_user(m.company_id, x)) from jsonb_array_elements_text(v) x))
                          from jsonb_each(d.data->'reactions') r(k, v) where jsonb_typeof(v) = 'array' and jsonb_array_length(v) > 0), '{}'),
    mentions = (select array_agg(case when x = 'admin' then 'admin' else erp.chat_user(m.company_id, x) end) from jsonb_array_elements_text(case when jsonb_typeof(d.data->'mentions') = 'array' then d.data->'mentions' else '[]' end) x)
  from raw.docs d where d.collection = 'chatMessages' and d.id = m.id and (jsonb_typeof(d.data->'reactions') = 'object' or jsonb_typeof(d.data->'mentions') = 'array');
  update erp.chat_messages m set order_id = o.id
  from raw.docs d join erp.orders o on o.id = d.id
  where d.collection = 'orders' and d.data->>'sourceChatMessageId' = m.id;
exception when undefined_column then null;
end $$;

create or replace function public.react_chat(p_id text, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare m erp.chat_messages; me text := auth.uid()::text; who jsonb;
begin
  if p_emoji not in ('👍', '❤️', '😂', '😮', '😢', '👏') then raise exception '고를 수 없는 이모지입니다.'; end if;
  select * into m from erp.chat_messages where id = p_id for update;
  if not found or not exists (select 1 from erp.chat_rooms r where r.id = m.room_id and me = any (r.participant_ids)) then raise exception '메시지를 찾을 수 없습니다.'; end if;
  if m.deleted_at is not null then raise exception '지운 메시지입니다.'; end if;
  who := coalesce(m.reactions->p_emoji, '[]');
  who := case when who ? me then (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements_text(who) x where x <> me) else who || to_jsonb(me) end;
  update erp.chat_messages set reactions = case when jsonb_array_length(who) = 0 then coalesce(reactions, '{}') - p_emoji
                                                else coalesce(reactions, '{}') || jsonb_build_object(p_emoji, who) end
  where id = p_id;
end $$;

-- p: {room_id, text?, images?, file?, reply_to?, mentions?: [계정 id | 'admin']}
create or replace function public.send_chat(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare r erp.chat_rooms; me text := auth.uid()::text; v_id text := 'MSG-' || gen_random_uuid(); v_name text; v_preview text;
        v_mentions text[]; v_room text; t text;
begin
  select * into r from erp.chat_rooms where id = p->>'room_id' for update;
  if not found or not (me = any (r.participant_ids)) then raise exception '대화방을 찾을 수 없습니다.'; end if;
  if coalesce(trim(p->>'text'), '') = '' and p->'images' is null and p->'file' is null then raise exception '보낼 내용이 없습니다.'; end if;
  select name into v_name from public.company_people(r.company_id) where user_id::text = me;
  -- 멘션은 이 방 사람과 '관리자'만
  select array_agg(distinct x) into v_mentions from jsonb_array_elements_text(case when jsonb_typeof(p->'mentions') = 'array' then p->'mentions' else '[]' end) x
  where x <> me and (x = 'admin' or x = any (r.participant_ids));
  insert into erp.chat_messages (id, company_id, room_id, sender_id, sender_name, text, images, file_url, file_name, reply_to, mentions, created_at)
  values (v_id, r.company_id, r.id, me, coalesce(v_name, erp.actor_name()), nullif(p->>'text', ''), p->'images',
          p->'file'->>'path', p->'file'->>'name', p->'reply_to', v_mentions, now());
  v_preview := coalesce(nullif(left(p->>'text', 60), ''), case when p->'images' is not null then '사진' else '파일' end);
  update erp.chat_rooms set last_message = v_preview, last_updated_at = now(),
         last_read = coalesce(last_read, '{}') || jsonb_build_object(me, now()) where id = r.id;
  v_room := coalesce(r.name, case when cardinality(r.participant_ids) > 2 then '단체 채팅'
                                   else (select name from public.company_people(r.company_id) where user_id::text = any (array_remove(r.participant_ids, me)) limit 1) end, '대화');
  for t in select unnest(array_remove(r.participant_ids, me)) loop
    perform erp.notify(r.company_id, 'mention', coalesce(v_name, '') || ' (' || v_room || ')',
                       case when length(v_preview) > 40 then left(v_preview, 40) || '…' else v_preview end, r.id, t);
  end loop;
  if 'admin' = any (coalesce(v_mentions, '{}')) then
    insert into erp.adjustment_requests (id, company_id, type, status, reason, requested_at)
    values ('MENTION-' || gen_random_uuid(), r.company_id, 'chat_mention', 'pending', coalesce(v_name, '') || ': ' || left(p->>'text', 300), now());
  end if;
  return v_id;
end $$;

-- 메시지로 만든 주문을 그 메시지에 표시
create or replace function public.mark_chat_order(p_message text, p_order text) returns void
language plpgsql security definer set search_path = '' as $$
declare m erp.chat_messages;
begin
  select * into m from erp.chat_messages where id = p_message;
  if not found or not exists (select 1 from erp.chat_rooms r where r.id = m.room_id and auth.uid()::text = any (r.participant_ids)) then raise exception '메시지를 찾을 수 없습니다.'; end if;
  if not exists (select 1 from erp.orders o where o.id = p_order and o.company_id = m.company_id) then raise exception '주문을 찾을 수 없습니다.'; end if;
  update erp.chat_messages set order_id = p_order where id = p_message;
end $$;

-- 주문 글 읽기 규칙: [{alias, item_id}] — 같은 거래처·이름이 있으면 품목만 바꾼다
create or replace function public.save_order_aliases(p_company text, p_partner text, p_rules jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare x jsonb; n integer := 0; v_alias text;
begin
  perform erp.assert_member(p_company);
  if p_partner is not null and not exists (select 1 from erp.partners where id = p_partner and company_id = p_company) then raise exception '거래처를 찾을 수 없습니다.'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_rules, '[]')) loop
    v_alias := left(trim(x->>'alias'), 100);
    if coalesce(v_alias, '') = '' or not exists (select 1 from erp.items where id = x->>'item_id' and company_id = p_company) then continue; end if;
    update erp.order_interpretation_rules set item_id = x->>'item_id', status = 'approved'
    where company_id = p_company and partner_id is not distinct from p_partner and lower(replace(alias, ' ', '')) = lower(replace(v_alias, ' ', ''));
    if not found then
      insert into erp.order_interpretation_rules (id, company_id, partner_id, alias, item_id, status)
      values ('rule-' || gen_random_uuid(), p_company, p_partner, v_alias, x->>'item_id', 'approved');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 매칭표에서 짝 하나 지우기(거래처 정보 › 주문 읽기 매칭표, 2026-11-08)
create or replace function public.delete_order_alias(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.order_interpretation_rules where id = p_id;
  if v_company is null then raise exception '매칭을 찾을 수 없습니다.'; end if;
  perform erp.assert_member(v_company);
  delete from erp.order_interpretation_rules where id = p_id;
end $$;
revoke all on function public.delete_order_alias(text) from public, anon;
grant execute on function public.delete_order_alias(text) to authenticated;

revoke all on function public.react_chat(text, text), public.mark_chat_order(text, text), public.save_order_aliases(text, text, jsonb) from public, anon;
grant execute on function public.react_chat(text, text), public.mark_chat_order(text, text), public.save_order_aliases(text, text, jsonb) to authenticated;
revoke all on function erp.chat_user(text, text) from public, anon, authenticated;
