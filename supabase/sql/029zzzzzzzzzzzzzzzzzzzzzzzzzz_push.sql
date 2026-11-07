-- erp-core 저장소 supabase/push.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 휴대폰 푸시 알림(웹 푸시, 2026-11-07). voucherlist.sql 뒤에 돈다.
--  흐름: 종 알림(erp.notifications)이 생기면 → 트리거가 pg_net으로 Edge Function(send-push)을 부른다
--        → 함수가 받는 사람들의 구독(app.push_subscriptions)으로 웹 푸시를 보낸다.
--  구독·설정은 app 스키마에 둔다(시험 이전이 erp 스키마를 지워도 남게).
--  VAPID 키는 함수가 처음 돌 때 만들어 app.push_config에 넣는다(비밀 키는 화면·채팅·Vercel 어디에도 안 나감).

do $$ begin create extension if not exists pg_net; exception when others then null; end $$;

create table if not exists app.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fails      int not null default 0
);
create table if not exists app.push_config (
  id            int primary key default 1 check (id = 1),
  function_url  text,                                   -- 배포 워크플로가 넣는다
  hook_secret   text not null default gen_random_uuid()::text,
  vapid_public  text,
  vapid_private text
);
insert into app.push_config (id) values (1) on conflict do nothing;
alter table app.push_subscriptions enable row level security;
alter table app.push_config enable row level security;
revoke all on app.push_subscriptions, app.push_config from public, anon, authenticated;

-- 화면: 공개 키(구독할 때 씀). 아직 함수가 안 돌았으면 null → '준비 중'
create or replace function public.push_public_key() returns text language sql stable security definer set search_path = '' as $$
  select vapid_public from app.push_config where id = 1 $$;

-- 화면: 이 기기 구독 넣기·빼기 p: {endpoint, keys: {p256dh, auth}, ua}
create or replace function public.save_push_subscription(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if coalesce(p->>'endpoint', '') !~ '^https://' or coalesce(p#>>'{keys,p256dh}', '') = '' or coalesce(p#>>'{keys,auth}', '') = '' then
    raise exception '알림 구독 정보가 올바르지 않습니다.';
  end if;
  insert into app.push_subscriptions (endpoint, user_id, p256dh, auth, ua)
  values (p->>'endpoint', auth.uid(), p#>>'{keys,p256dh}', p#>>'{keys,auth}', left(p->>'ua', 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fails = 0;
end $$;
create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from app.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() $$;
-- 화면: 내 기기 몇 대가 받고 있나
create or replace function public.my_push_devices() returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from app.push_subscriptions where user_id = auth.uid() $$;

-- 함수(service_role)만: 알림 하나를 보낼 거리 — 제목·내용·열 주소·받는 구독·키
create or replace function public.push_job(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n erp.notifications; c app.push_config;
begin
  select * into c from app.push_config where id = 1;
  select * into n from erp.notifications where id = p_id;
  if not found then return jsonb_build_object('secret', c.hook_secret, 'subs', '[]'::jsonb); end if;
  return jsonb_build_object(
    'secret', c.hook_secret, 'vapid_public', c.vapid_public, 'vapid_private', c.vapid_private,
    'title', coalesce(n.title, '알림'), 'body', coalesce(n.body, ''), 'tag', n.id,
    'url', case n.type when 'mention' then '/chat?room=' || coalesce(n.linked_id, '') when 'new_order' then '/orders'
                       when 'leave_request' then '/employees' else '/' end,
    'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                      from app.push_subscriptions s join app.memberships m on m.user_id = s.user_id and m.company_id = n.company_id
                      where (n.target_id is null or s.user_id::text = n.target_id)
                        and s.user_id::text is distinct from n.sender_id), '[]'::jsonb));
end $$;
-- 함수만: 처음 한 번 VAPID 키 넣기(이미 있으면 그대로)
create or replace function public.push_set_vapid(p_public text, p_private text) returns text
language sql security definer set search_path = '' as $$
  update app.push_config set vapid_public = coalesce(vapid_public, p_public), vapid_private = coalesce(vapid_private, p_private) where id = 1
  returning vapid_public $$;
-- 함수만: 보낸 결과. 끊긴 구독(404·410)은 지우고, 다른 실패는 세다가 5번이면 지운다.
create or replace function public.push_result(p_endpoint text, p_ok boolean, p_gone boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_gone then delete from app.push_subscriptions where endpoint = p_endpoint; return; end if;
  if p_ok then update app.push_subscriptions set last_ok_at = now(), fails = 0 where endpoint = p_endpoint; return; end if;
  update app.push_subscriptions set fails = fails + 1 where endpoint = p_endpoint;
  delete from app.push_subscriptions where endpoint = p_endpoint and fails >= 5;
end $$;

-- 종 알림이 생기면 함수를 부른다. 설정이 없거나 pg_net이 없으면 조용히 넘어간다(알림 저장은 절대 막지 않음).
create or replace function erp.push_on_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c app.push_config;
begin
  select * into c from app.push_config where id = 1;
  if c.function_url is null or to_regproc('net.http_post') is null then return new; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using c.function_url, jsonb_build_object('id', new.id),
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.hook_secret);
  return new;
exception when others then return new;
end $$;
drop trigger if exists notifications_push on erp.notifications;
create trigger notifications_push after insert on erp.notifications for each row execute function erp.push_on_notify();

revoke all on function public.push_job(text), public.push_set_vapid(text, text), public.push_result(text, boolean, boolean) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.push_job(text), public.push_set_vapid(text, text), public.push_result(text, boolean, boolean) to service_role';
exception when undefined_object then null; end $$;
revoke all on function public.push_public_key(), public.save_push_subscription(jsonb), public.delete_push_subscription(text), public.my_push_devices() from public, anon;
grant execute on function public.push_public_key(), public.save_push_subscription(jsonb), public.delete_push_subscription(text), public.my_push_devices() to authenticated;
revoke all on function erp.push_on_notify() from public, anon, authenticated;
