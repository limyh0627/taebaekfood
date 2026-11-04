-- erp-core 저장소 supabase/portal.sql 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
-- 거래처 포털(taebaek-guest 사이트)용. haccp.sql 뒤에 돈다.
--
--  · 거래처 사용자는 직원과 다르다: app.memberships에 넣지 않는다(넣으면 회사 데이터를 다 읽는다).
--    대신 app.partner_users에 두고, 포털은 아래 portal_* 함수로만 자기 거래처 것을 읽고 주문한다.
--  · 가입: 사이트에서 Supabase 계정(실제 이메일) 가입 → portal_register로 신청(대기) → 관리자가 거래처에 연결해 승인.
--    옛 사이트에서 승인받았던 아이디·이메일로 다시 가입하면 그때 연결된 거래처로 바로 승인한다(비밀번호는 옮길 수 없어서).
--  · app 스키마라 시험 이전 때 지워지지 않는다.

create table if not exists app.partner_users (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  name        text,
  phone       text,
  type        text not null default 'business',
  company_id  text,
  partner_id  text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  text
);
alter table app.partner_users enable row level security;
revoke all on app.partner_users from anon, authenticated;

-- 로그인한 거래처 사용자(승인된)의 회사·거래처
create or replace function app.my_partner() returns app.partner_users language plpgsql stable security definer set search_path = '' as $$
declare r app.partner_users;
begin
  select * into r from app.partner_users where user_id = auth.uid();
  if not found then raise exception '거래처 계정이 아닙니다.' using errcode = '42501'; end if;
  if r.status <> 'approved' or r.partner_id is null then raise exception '아직 승인되지 않은 계정입니다. 승인 후 주문할 수 있습니다.' using errcode = '42501'; end if;
  return r;
end $$;
revoke all on function app.my_partner() from public, anon, authenticated;

-- ---------- 로그인 전 (anon) ----------
-- 아이디 → 로그인용 이메일 (옛 사이트의 usernames 공개 문서와 같은 역할)
create or replace function public.portal_login_email(p_username text) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from app.partner_users p join auth.users u on u.id = p.user_id where p.username = lower(trim(p_username))
$$;

-- 아이디를 쓸 수 있나. 옛 사이트 아이디는 같은 이메일로 다시 가입할 때만 쓸 수 있다.
create or replace function public.portal_username_available(p_username text, p_email text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select lower(trim(p_username)) ~ '^[a-z0-9._-]{3,30}$'
     and not exists (select 1 from app.partner_users where username = lower(trim(p_username)))
     and not exists (select 1 from erp.partner_accounts a where a.username = lower(trim(p_username))
                     and lower(coalesce(a.email, '')) <> lower(coalesce(trim(p_email), '')))
$$;

-- 아이디 찾기(이름 + 연락처)
create or replace function public.portal_find_username(p_name text, p_phone text) returns text
language sql stable security definer set search_path = '' as $$
  select p.username from app.partner_users p
  where p.name = trim(p_name) and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
  order by p.created_at desc limit 1
$$;

-- 비밀번호 재설정: 아이디·이름·연락처가 맞으면 이메일을 돌려준다(사이트가 그 주소로 재설정 메일을 보낸다).
create or replace function public.portal_reset_email(p_username text, p_name text, p_phone text) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from app.partner_users p join auth.users u on u.id = p.user_id
  where p.username = lower(trim(p_username)) and p.name = trim(p_name)
    and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
$$;

-- ---------- 가입 신청 (가입 직후, 로그인 상태) ----------
-- p: {username, name, phone, type, company_id?}
create or replace function public.portal_register(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_user text := lower(trim(p->>'username')); old erp.partner_accounts;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  if exists (select 1 from app.memberships where user_id = v_uid) then raise exception '직원 계정으로는 거래처 가입을 할 수 없습니다.'; end if;
  select email into v_email from auth.users where id = v_uid;
  if not public.portal_username_available(v_user, v_email) and not exists (select 1 from app.partner_users where user_id = v_uid) then
    raise exception '이미 사용 중이거나 쓸 수 없는 아이디입니다.';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception '이름을 넣으세요.'; end if;
  -- 옛 사이트에서 승인받은 같은 아이디·이메일이면 그 거래처로 바로 승인
  select * into old from erp.partner_accounts a
  where a.username = v_user and lower(coalesce(a.email, '')) = lower(v_email) and a.status = 'approved' and a.partner_id is not null
  limit 1;
  insert into app.partner_users (user_id, username, name, phone, type, company_id, partner_id, status, decided_at, decided_by)
  values (v_uid, v_user, trim(p->>'name'), nullif(trim(p->>'phone'), ''), coalesce(nullif(p->>'type', ''), 'business'),
          coalesce(old.company_id, nullif(p->>'company_id', ''), 'taebaek'), old.partner_id,
          case when old.partner_id is not null then 'approved' else 'pending' end,
          case when old.partner_id is not null then now() end, case when old.partner_id is not null then '옛 사이트 승인 이어받음' end)
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone;
  return (select status from app.partner_users where user_id = v_uid);
end $$;

-- ---------- 로그인한 거래처 ----------
create or replace function public.portal_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r app.partner_users;
begin
  select * into r from app.partner_users where user_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('username', r.username, 'name', r.name, 'phone', r.phone, 'type', r.type, 'status', r.status,
    'email', (select email from auth.users where id = r.user_id), 'company_id', r.company_id, 'partner_id', r.partner_id,
    'partner_name', (select name from erp.partners where id = r.partner_id));
end $$;

-- 주문할 수 있는 품목: 이 거래처에 판매 단가로 연결된 품목. 단가는 세금 포함. per_box: 박스당 개수(있으면 박스로도 주문)
create or replace function public.portal_items()
returns table (item_id text, name text, type text, unit text, price numeric, tax_exempt boolean, per_box numeric)
language plpgsql stable security definer set search_path = '' as $$
declare me app.partner_users := app.my_partner();
begin
  return query
  select distinct on (i.id) i.id, i.name, i.type, i.unit, x.price, coalesce(x.tax_type = '면세', false),
         (select u.units_per_box from erp.item_units u where u.item_id = i.id and u.kind = 'box' and u.units_per_box > 0 limit 1)
  from erp.partner_items x join erp.items i on i.id = x.item_id
  where x.partner_id = me.partner_id and coalesce(x.direction, 'out') = 'out' and not i.archived
  order by i.id, x.price is null;
end $$;

-- 주문 넣기. p: {delivery_date, note, lines: [{item_id, qty}]} — qty는 품목 재고 단위. 단가는 서버가 정한다.
create or replace function public.portal_place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me app.partner_users := app.my_partner(); v_id text := 'WEB-' || gen_random_uuid(); v_no text; v_total numeric;
        v_date date := coalesce((p->>'delivery_date')::date, ((now() at time zone 'Asia/Seoul')::date + 3));
begin
  if jsonb_typeof(p->'lines') <> 'array' or not exists (select 1 from jsonb_array_elements(p->'lines') l where coalesce((l->>'qty')::numeric, 0) > 0) then
    raise exception '주문할 수량을 넣으세요.';
  end if;
  if exists (select 1 from jsonb_array_elements(p->'lines') l
             where coalesce((l->>'qty')::numeric, 0) > 0
               and not exists (select 1 from erp.partner_items x where x.partner_id = me.partner_id and x.item_id = l->>'item_id'
                               and coalesce(x.direction, 'out') = 'out')) then
    raise exception '주문할 수 없는 품목이 있습니다.';
  end if;
  if v_date < (now() at time zone 'Asia/Seoul')::date then raise exception '배송일이 지났습니다.'; end if;
  v_no := erp.next_no(me.company_id, v_date, 'ORD-', 'order');
  insert into erp.orders (id, company_id, partner_id, partner_name, status, source, delivery_date, created_at, card_no, note)
  values (v_id, me.company_id, me.partner_id, (select name from erp.partners where id = me.partner_id), 'PENDING', 'portal',
          v_date, now(), v_no, concat_ws(' / ', '거래처 주문(' || coalesce(me.name, me.username) || ')', nullif(trim(p->>'note'), '')));
  insert into erp.order_lines (order_id, line_no, item_id, name, qty, price, tax_exempt)
  select v_id, row_number() over (order by l.ord), i.id, i.name, (l.v->>'qty')::numeric, coalesce(pi.price, 0), coalesce(pi.tax_type = '면세', false)
  from jsonb_array_elements(p->'lines') with ordinality l(v, ord)
  join erp.items i on i.id = l.v->>'item_id'
  cross join lateral (select price, tax_type from erp.partner_items x where x.partner_id = me.partner_id and x.item_id = i.id
                      and coalesce(x.direction, 'out') = 'out' order by x.price is null limit 1) pi
  where coalesce((l.v->>'qty')::numeric, 0) > 0;
  select sum((erp.line_amount(qty, price, tax_exempt)).gross) into v_total from erp.order_lines where order_id = v_id;
  update erp.orders set total_amount = v_total where id = v_id;
  insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
  values ('portal:' || gen_random_uuid(), me.company_id, v_id, 'create', jsonb_build_object('lines', p->'lines', 'total', v_total, 'source', 'portal'),
          '거래처 ' || me.username, now());
  return jsonb_build_object('order_id', v_id, 'card_no', v_no, 'total', v_total, 'delivery_date', v_date);
end $$;

-- 내 주문(최근 200건)
create or replace function public.portal_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me app.partner_users := app.my_partner();
begin
  return coalesce((select jsonb_agg(o order by o->>'created_at' desc) from (
    select jsonb_build_object('id', o.id, 'card_no', o.card_no, 'status', o.status, 'delivery_date', o.delivery_date, 'created_at', o.created_at,
             'total_amount', o.total_amount, 'note', o.note, 'shipped_at', o.shipped_at,
             'lines', (select jsonb_agg(jsonb_build_object('name', l.name, 'qty', l.qty, 'price', l.price, 'unit', (select unit from erp.items where id = l.item_id)) order by l.line_no)
                       from erp.order_lines l where l.order_id = o.id)) as o
    from erp.orders o where o.partner_id = me.partner_id order by o.created_at desc nulls last limit 200) t), '[]');
end $$;

-- 받을 돈(우리가 받을 = 거래처가 낼) 잔액
create or replace function public.portal_balance() returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare me app.partner_users := app.my_partner();
begin
  return coalesce((select receivable from erp.partner_balances where partner_id = me.partner_id), 0);
end $$;

-- ---------- 관리자: 가입 승인 ----------
create or replace function public.partner_signups(p_company text)
returns table (user_id uuid, username text, name text, phone text, email text, type text, status text, partner_id text, partner_name text,
               created_at timestamptz, decided_at timestamptz, decided_by text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform erp.assert_admin(p_company);
  return query
  select p.user_id, p.username, p.name, p.phone, u.email::text, p.type, p.status, p.partner_id, x.name, p.created_at, p.decided_at, p.decided_by
  from app.partner_users p join auth.users u on u.id = p.user_id left join erp.partners x on x.id = p.partner_id
  where p.company_id = p_company or (p.status = 'pending' and p.company_id is null)
  order by p.status <> 'pending', p.created_at desc;
end $$;

-- 승인(거래처 연결) / 거절. p_status: approved | rejected | pending(되돌리기)
create or replace function public.decide_partner_user(p_company text, p_user_id uuid, p_status text, p_partner text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform erp.assert_admin(p_company);
  if p_status not in ('approved', 'rejected', 'pending') then raise exception '승인·거절만 됩니다.'; end if;
  if p_status = 'approved' and not exists (select 1 from erp.partners where id = p_partner and company_id = p_company) then
    raise exception '연결할 거래처를 고르세요.';
  end if;
  update app.partner_users set status = p_status, company_id = p_company,
         partner_id = case when p_status = 'approved' then p_partner else partner_id end,
         decided_at = now(), decided_by = erp.actor_name()
  where user_id = p_user_id and (company_id = p_company or company_id is null);
  if not found then raise exception '가입 신청을 찾을 수 없습니다.'; end if;
end $$;

revoke all on function public.portal_login_email(text), public.portal_username_available(text, text), public.portal_find_username(text, text),
  public.portal_reset_email(text, text, text), public.portal_register(jsonb), public.portal_me(), public.portal_items(),
  public.portal_place_order(jsonb), public.portal_orders(), public.portal_balance(), public.partner_signups(text),
  public.decide_partner_user(text, uuid, text, text) from public;
grant execute on function public.portal_login_email(text), public.portal_username_available(text, text), public.portal_find_username(text, text),
  public.portal_reset_email(text, text, text) to anon, authenticated;
grant execute on function public.portal_register(jsonb), public.portal_me(), public.portal_items(), public.portal_place_order(jsonb),
  public.portal_orders(), public.portal_balance(), public.partner_signups(text), public.decide_partner_user(text, uuid, text, text) to authenticated;
