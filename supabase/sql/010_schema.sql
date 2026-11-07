-- 시험 이전 2단계: 새 ERP 핵심 표 (2026-11-04 ERD 기준, 생산·재고·주문·기준정보만).
-- 회사는 company_id로 나눈다(태백·풍회). id는 추적을 위해 Firestore 문서 id를 그대로 쓴다.
-- 모든 표는 RLS를 켜고 정책은 아직 두지 않는다 = 앱 API로는 아무도 못 읽는다. 시험 단계는 직접 접속만.
-- 다시 돌려도 되도록 erp 스키마를 통째로 지우고 새로 만든다(시험 전용).

-- 날짜는 한국 시간으로. 기본(UTC)이면 한국 00~09시에 '오늘'이 어제로 잡혀 전표·원장 날짜와 번호가 하루 밀린다.
-- 데이터베이스 설정은 새 접속부터 먹으므로 이번 이전 세션에도 따로 건다.
do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'Asia/Seoul'); end $$;
set timezone to 'Asia/Seoul';

-- 전환(실제 운영 시작) 뒤에는 이 파이프라인이 운영 데이터를 지우지 않게 멈춘다. 표시는 supabase/cutover-mark.sql.
do $$ begin
  if to_regclass('app.cutover') is not null then
    raise exception '이미 실제 운영으로 전환한 DB입니다. 시험 이전을 다시 돌리면 운영 데이터가 지워지므로 멈춥니다.';
  end if;
end $$;

drop schema if exists erp cascade;
create schema erp;

create table erp.companies (
  id   text primary key,
  name text not null
);

create table erp.partners (
  id             text primary key,
  company_id     text not null references erp.companies(id),
  name           text not null,
  partner_type   text,
  biz_no         text,
  owner_name     text,
  email          text,
  address        text,
  is_oem_factory boolean not null default false,
  archived       boolean not null default false,
  channel        text,            -- 판매 채널: 일반·택배·스마트스토어 (옛 앱 type)
  phone text, mobile text, fax text, region text, note text,
  default_ship_method text,
  ship_tos       jsonb not null default '[]'   -- 배송지 [{id, name, archived?, default_ship_method?}], 맨 앞이 기본
);

-- 품목. 재고 수량은 여기 두지 않는다(stock_balances). legacy_type은 지금 앱의 type 값 그대로.
create table erp.items (
  id           text primary key,
  company_id   text not null references erp.companies(id),
  name         text not null,
  type         text not null check (type in ('RAW','SUB','WIP','FINISHED','GOODS','SERVICE','PALLET','OTHER')),
  legacy_type  text,
  unit         text,            -- 재고·원장 단위. 기름 같은 벌크는 kg으로 센다.
  display_unit text,            -- 화면에 같이 보여 줄 단위(예: L). 있으면 density로 바꿔 보여 준다.
  density      numeric,         -- kg/L
  cost         numeric,
  min_stock    numeric,
  procure_type text,
  is_bulk      boolean not null default false,
  phantom      boolean not null default false,
  archived     boolean not null default false,
  category     text,            -- 옛 앱 카테고리: 참기름·들기름·라벨·용기·박스·마개·테이프·향미유…
  subtype      text,            -- 낱개·배송·선물세트·벌크
  spec         text,            -- 규격(350ml, 1kg * 10)
  unpackable   boolean not null default false   -- 캔처럼 까서 벌크로 되돌리는 품목(사람이 켬)
);

create table erp.item_boms (
  id             text primary key,
  company_id     text not null references erp.companies(id),
  parent_item_id text not null references erp.items(id),
  child_item_id  text not null references erp.items(id),
  quantity       numeric not null
);

-- 배합: 키(parent_key)는 등급·서류 품목 이름 그대로, 원료만 품목 ID로. 못 찾은 원료는 child_name만 남긴다.
create table erp.item_formulas (
  id            text primary key,
  company_id    text not null references erp.companies(id),
  parent_key    text not null,
  child_item_id text references erp.items(id),
  child_name    text not null,
  ratio         numeric not null,
  yield_rate    numeric
);

create table erp.item_units (
  id            text primary key,
  company_id    text not null references erp.companies(id),
  item_id       text not null references erp.items(id),
  kind          text not null check (kind in ('box','purchase')),
  units_per_box numeric,
  partner_id    text references erp.partners(id),
  purchase_unit text,
  unit_kg       numeric,
  is_default    boolean
);

create table erp.partner_items (
  id         text primary key,
  company_id text not null references erp.companies(id),
  partner_id text not null references erp.partners(id),
  item_id    text not null references erp.items(id),
  direction  text,
  price      numeric,
  tax_type   text,
  account_code text
);

-- 직원. 비밀번호 해시·푸시 토큰은 옮기지 않는다.
create table erp.employees (
  id           text primary key,
  company_id   text not null references erp.companies(id),
  name         text,
  position     text,
  department   text,
  join_date    date,
  status       text,
  admin_access boolean not null default false,
  auth_uid     text
);

create table erp.orders (
  id            text primary key,
  company_id    text not null references erp.companies(id),
  partner_id    text references erp.partners(id),
  partner_name  text,
  status        text,
  source        text,
  ship_method   text,
  delivery_date date,
  total_amount  numeric,
  created_at    timestamptz,
  delivered_at  timestamptz,
  card_no       text,
  note          text,
  shipped_at    timestamptz,
  voucher_id    text,
  ship_to_id    text,
  note_important boolean not null default false,
  invoice_stage text,                       -- 택배 송장: null → printed → attached
  accounting_excluded boolean not null default false,   -- 거래명세서 발행 안 함
  accounting_excluded_reason text
);

create table erp.order_lines (
  order_id text not null references erp.orders(id) on delete cascade,
  line_no  int  not null,
  line_id  text,
  item_id  text references erp.items(id),
  name     text,
  qty      numeric,
  price    numeric,
  tax_exempt boolean,
  checked_at timestamptz,        -- 생산 처리(체크) 한 때
  checked_by text,
  made_on    date,               -- 제조일(소비기한 = +1년)
  label_stage text,              -- 라벨: 대기 / 날인 / 부착
  run_id     text,               -- 이 줄 생산 처리로 만든 생산 기록(되돌리기용). 옛 앱 줄은 비어 있다.
  primary key (order_id, line_no)
);

create table erp.production_runs (
  id         text primary key,
  company_id text not null references erp.companies(id),
  order_id   text references erp.orders(id),
  line_id    text,
  item_id    text references erp.items(id),
  qty        numeric,
  run_date   date,
  cost_total numeric,
  note       text,
  canceled_at timestamptz
);

create table erp.lots (
  id          text primary key,
  company_id  text not null references erp.companies(id),
  item_id     text not null references erp.items(id),
  received_at date,
  qty_in      numeric,
  qty_left    numeric,
  supplier    text,
  lot_no      text,
  status      text
);

-- 실제 원장. 지우거나 고치지 않고 줄을 더한다. stock_effect가 false인 줄(임가공 생산 기록)은 잔고에서 뺀다.
create table erp.stock_ledger (
  id             text primary key,
  company_id     text not null references erp.companies(id),
  item_id        text not null references erp.items(id),
  qty            numeric not null,
  stock_effect   boolean not null default true,
  unit           text,
  kind           text,
  source_type    text,
  source_id      text,
  partner_id     text references erp.partners(id),
  reversal_of    text,
  effective_date date,
  note           text,
  created_by     text,          -- 작성자 이름(원료 입고·사용 기록 등). 옛 앱 addedBy
  created_at     timestamptz default now()
);
create index stock_ledger_item on erp.stock_ledger (item_id, effective_date);

create table erp.stock_balances (
  item_id    text primary key references erp.items(id),
  company_id text not null references erp.companies(id),
  qty        numeric not null,
  unit       text,
  updated_at timestamptz not null default now()
);

-- 옮기지 못한 줄과 이유. 데이터 상태를 보는 용도.
create table erp.import_rejects (
  collection text,
  doc_id     text,
  reason     text
);

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'erp' loop
    execute format('alter table erp.%I enable row level security', t);
  end loop;
end $$;
revoke all on schema erp from anon, authenticated;
revoke all on all tables in schema erp from anon, authenticated;
