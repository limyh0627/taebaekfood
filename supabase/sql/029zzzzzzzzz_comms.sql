-- erp-core 저장소 supabase/comms.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 공지·채팅·알림. portal.sql 뒤에 돈다(accounts.sql의 계정↔직원 연결을 쓴다).
--
--  · 채팅 참여자는 로그인 계정 id(auth.users). 옛 앱 대화방은 Firebase uid였다 → 직원 카드(legacy_uid)와
--    계정↔직원 연결(app.member_employees)로 바꿔 붙인다. 아직 계정이 없는 사람은 옛 uid로 남는다(계정을 연결하면 다음 이전 때 붙는다).
--  · 대화는 참여자만 읽는다(회사 전체가 아니라). 공지·알림은 회사 사람 모두.
--  · 새 메시지·알림이 바로 보이도록 Supabase Realtime에 표를 올린다.

alter table erp.chat_rooms add column if not exists last_message text;
alter table erp.chat_rooms add column if not exists last_read jsonb;
alter table erp.chat_rooms add column if not exists created_by text;
alter table erp.chat_rooms add column if not exists notice jsonb;
alter table erp.chat_messages add column if not exists file_name text;
alter table erp.chat_messages add column if not exists images jsonb;
alter table erp.chat_messages add column if not exists reply_to jsonb;
alter table erp.chat_messages add column if not exists deleted_by text;
alter table erp.notifications add column if not exists dismissed_by text[];
create index if not exists chat_messages_room on erp.chat_messages (room_id, created_at);

-- 옛 Firebase uid → 계정 id
do $$
declare m record;
begin
  for m in select e.legacy_uid as old, me.user_id::text as new
           from erp.employees e join app.member_employees me on me.employee_id = e.id and me.company_id = e.company_id
           where e.legacy_uid is not null loop
    update erp.chat_rooms set participant_ids = array_replace(participant_ids, m.old, m.new) where m.old = any (participant_ids);
    update erp.chat_rooms set last_read = (last_read - m.old) || jsonb_build_object(m.new, last_read->m.old) where last_read ? m.old;
    update erp.chat_messages set sender_id = m.new where sender_id = m.old;
    update erp.notifications set target_id = m.new where target_id = m.old;
    update erp.notifications set read_by = array_replace(read_by, m.old, m.new) where m.old = any (read_by);
  end loop;
exception when undefined_column or undefined_table then null;  -- 옛 이전(legacy_uid 없음)이면 건너뜀
end $$;

-- 대화는 참여자만
drop policy if exists member_read on erp.chat_rooms;
create policy member_read on erp.chat_rooms for select to authenticated
  using (company_id = any (app.my_company_ids()) and auth.uid()::text = any (participant_ids));
drop policy if exists member_read on erp.chat_messages;
create policy member_read on erp.chat_messages for select to authenticated
  using (exists (select 1 from erp.chat_rooms r where r.id = room_id and auth.uid()::text = any (r.participant_ids)));

-- 실시간
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_messages', 'chat_rooms', 'notifications'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'erp' and tablename = t) then
        execute format('alter publication supabase_realtime add table erp.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- 같은 회사 사람 목록(채팅 상대 고르기): 계정 id·이름
create or replace function public.company_people(p_company text)
returns table (user_id uuid, name text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_member(p_company);
  return query
  select m.user_id, coalesce(e.name, replace(u.email, '@erp.local', ''))::text, m.role
  from app.memberships m join auth.users u on u.id = m.user_id
  left join app.member_employees me on me.user_id = m.user_id and me.company_id = m.company_id
  left join erp.employees e on e.id = me.employee_id
  where m.company_id = p_company order by 2;
end $$;

-- ---------- 공지 ----------
-- p: {id?, company_id, title, content, tag(공지|긴급|매뉴얼|업무), pinned?}
create or replace function public.save_notice(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_company text := p->>'company_id'; v_id text := nullif(p->>'id', '');
begin
  perform erp.assert_admin(v_company);
  if coalesce(trim(p->>'title'), '') = '' then raise exception '제목을 넣으세요.'; end if;
  if coalesce(p->>'tag', '공지') not in ('공지', '긴급', '매뉴얼', '업무') then raise exception '분류를 고르세요.'; end if;
  if v_id is null then
    v_id := 'notice-' || gen_random_uuid();
    insert into erp.notices (id, company_id, author, date, pinned) values (v_id, v_company, erp.actor_name(), (now() at time zone 'Asia/Seoul')::date, false);
  elsif not exists (select 1 from erp.notices where id = v_id and company_id = v_company) then raise exception '공지를 찾을 수 없습니다.';
  end if;
  update erp.notices set title = trim(p->>'title'), content = p->>'content', tag = coalesce(p->>'tag', '공지'),
         pinned = coalesce((p->>'pinned')::boolean, pinned) where id = v_id;
  return v_id;
end $$;

create or replace function public.delete_notice(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company text;
begin
  select company_id into v_company from erp.notices where id = p_id;
  if v_company is null then raise exception '공지를 찾을 수 없습니다.'; end if;
  perform erp.assert_admin(v_company);
  delete from erp.notices where id = p_id;
end $$;

-- ---------- 채팅 ----------
-- 대화방 열기: 참여자(나 포함)가 같은 1:1 방이 있으면 그 방, 없으면 새로. p_users: 상대 계정 id들(비우면 나와의 대화)
create or replace function public.open_chat_room(p_company text, p_users uuid[], p_name text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare me text := auth.uid()::text; v_ids text[]; v_id text;
begin
  perform erp.assert_member(p_company);
  select array_agg(distinct x order by x) into v_ids from unnest(array_append(coalesce(p_users::text[], '{}'), me)) x;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from app.memberships m where m.user_id::text = x and m.company_id = p_company)) then
    raise exception '다른 회사 사람은 초대할 수 없습니다.';
  end if;
  if array_length(v_ids, 1) <= 2 then
    select id into v_id from erp.chat_rooms where company_id = p_company and not coalesce(is_group, false)
      and participant_ids @> v_ids and participant_ids <@ v_ids limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  v_id := 'ROOM-' || gen_random_uuid();
  insert into erp.chat_rooms (id, company_id, name, is_group, participant_ids, last_updated_at, created_by, last_read)
  values (v_id, p_company, nullif(trim(p_name), ''), array_length(v_ids, 1) > 2, v_ids, now(), me, jsonb_build_object(me, now()));
  return v_id;
end $$;

-- p: {room_id, text?, images?: [{path, name}], file?: {path, name}, reply_to?: {id, sender_name, text}}
create or replace function public.send_chat(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare r erp.chat_rooms; me text := auth.uid()::text; v_id text := 'MSG-' || gen_random_uuid(); v_name text; v_preview text;
begin
  select * into r from erp.chat_rooms where id = p->>'room_id' for update;
  if not found or not (me = any (r.participant_ids)) then raise exception '대화방을 찾을 수 없습니다.'; end if;
  if coalesce(trim(p->>'text'), '') = '' and p->'images' is null and p->'file' is null then raise exception '보낼 내용이 없습니다.'; end if;
  select name into v_name from public.company_people(r.company_id) where user_id::text = me;
  insert into erp.chat_messages (id, company_id, room_id, sender_id, sender_name, text, images, file_url, file_name, reply_to, created_at)
  values (v_id, r.company_id, r.id, me, coalesce(v_name, erp.actor_name()), nullif(p->>'text', ''), p->'images',
          p->'file'->>'path', p->'file'->>'name', p->'reply_to', now());
  v_preview := coalesce(nullif(left(p->>'text', 60), ''), case when p->'images' is not null then '사진' else '파일' end);
  update erp.chat_rooms set last_message = v_preview, last_updated_at = now(),
         last_read = coalesce(last_read, '{}') || jsonb_build_object(me, now()) where id = r.id;
  return v_id;
end $$;

create or replace function public.read_chat(p_room text) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := auth.uid()::text;
begin
  update erp.chat_rooms set last_read = coalesce(last_read, '{}') || jsonb_build_object(me, now())
  where id = p_room and me = any (participant_ids);
end $$;

-- 지우기: 보낸 사람 또는 관리자. 내용만 지우고 '삭제된 메시지'로 남긴다.
create or replace function public.delete_chat(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare m erp.chat_messages; me text := auth.uid()::text;
begin
  select * into m from erp.chat_messages where id = p_id;
  if not found then raise exception '메시지를 찾을 수 없습니다.'; end if;
  if m.sender_id <> me and not (m.company_id = any (app.my_admin_company_ids())) then raise exception '내가 보낸 메시지만 지울 수 있습니다.'; end if;
  update erp.chat_messages set text = null, images = null, image_url = null, file_url = null, file_name = null,
         deleted_at = now(), deleted_by = me where id = p_id;
end $$;

-- 대화방 이름·멤버 초대·나가기·방 공지
create or replace function public.update_chat_room(p_room text, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r erp.chat_rooms; me text := auth.uid()::text; add_ids text[];
begin
  select * into r from erp.chat_rooms where id = p_room for update;
  if not found or not (me = any (r.participant_ids)) then raise exception '대화방을 찾을 수 없습니다.'; end if;
  if p ? 'name' then update erp.chat_rooms set name = nullif(trim(p->>'name'), '') where id = r.id; end if;
  if p ? 'add' then
    select array_agg(x) into add_ids from jsonb_array_elements_text(p->'add') x
    where exists (select 1 from app.memberships m where m.user_id::text = x and m.company_id = r.company_id);
    update erp.chat_rooms set participant_ids = (select array_agg(distinct y) from unnest(participant_ids || coalesce(add_ids, '{}')) y),
           is_group = true where id = r.id;
  end if;
  if (p->>'leave')::boolean then update erp.chat_rooms set participant_ids = array_remove(participant_ids, me) where id = r.id; end if;
  if p ? 'notice' then
    update erp.chat_rooms set notice = case when jsonb_typeof(p->'notice') = 'object'
           then (p->'notice') || jsonb_build_object('by', erp.actor_name(), 'at', now()) end where id = r.id;
  end if;
end $$;

-- ---------- 알림(종) ----------
create or replace function erp.notify(p_company text, p_type text, p_title text, p_body text, p_linked text, p_target text default null)
returns void language sql security definer set search_path = '' as $$
  insert into erp.notifications (id, company_id, type, title, body, linked_id, target_id, sender_id, read_by, created_at)
  values ('ntf-' || gen_random_uuid(), p_company, p_type, p_title, p_body, p_linked, p_target, auth.uid()::text, '{}', now())
$$;
revoke all on function erp.notify(text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.read_notifications(p_company text, p_ids text[] default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me text := auth.uid()::text;
begin
  perform erp.assert_member(p_company);
  update erp.notifications set read_by = array_append(coalesce(read_by, '{}'), me)
  where company_id = p_company and (p_ids is null or id = any (p_ids)) and not (me = any (coalesce(read_by, '{}')))
    and (target_id is null or target_id = me);
end $$;

-- 새 주문 알림은 직원이 앱에서 넣은 주문만(orders.sql save_order). 거래처 포털 주문은 알리지 않는다(사장님 결정 2026-11-07).
drop trigger if exists orders_notify_portal on erp.orders;
drop function if exists erp.notify_portal_order();

-- 휴가 신청(대기) → 관리자 알림
create or replace function erp.notify_leave() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    perform erp.notify(new.company_id, 'leave_request', '휴가 신청', coalesce(new.employee_name, '') || ' ' || coalesce(new.type, '') || ' ' || new.start_date, new.id);
  end if;
  return new;
end $$;
drop trigger if exists leave_notify on erp.leave_requests;
create trigger leave_notify after insert on erp.leave_requests for each row execute function erp.notify_leave();

revoke all on function public.company_people(text), public.save_notice(jsonb), public.delete_notice(text), public.open_chat_room(text, uuid[], text),
  public.send_chat(jsonb), public.read_chat(text), public.delete_chat(text), public.update_chat_room(text, jsonb), public.read_notifications(text, text[]) from public, anon;
grant execute on function public.company_people(text), public.save_notice(jsonb), public.delete_notice(text), public.open_chat_room(text, uuid[], text),
  public.send_chat(jsonb), public.read_chat(text), public.delete_chat(text), public.update_chat_room(text, jsonb), public.read_notifications(text, text[]) to authenticated;
