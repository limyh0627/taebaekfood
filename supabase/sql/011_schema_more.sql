-- 시험 이전 2-2단계: 나머지 표 (회계·구매·인사·주문 이력·문서·협업). 010 뒤에 돈다.
-- 깊게 중첩돼 아직 구조를 정하지 않은 부분(점검표 행, 스냅샷 품목 등)은 jsonb로 둔다.

-- ---------- 회계 ----------
-- 계정과목과 계정 묶음을 한 표로. 묶음은 code 없는 상위 계정(parent_id로 연결).
create table erp.accounts (
  id             text primary key,
  company_id     text not null references erp.companies(id),
  code           text,
  name           text not null,
  parent_id      text references erp.accounts(id),
  type           text,
  normal_balance text,
  pl_line        text,
  cf_section     text,
  is_cash        boolean not null default false,
  note           text
);
create unique index accounts_code on erp.accounts (company_id, code) where code is not null;

create table erp.cash_accounts (
  id                 text primary key,
  company_id         text not null references erp.companies(id),
  name               text not null,
  type               text,
  opening_balance    numeric,
  opening_date       date,
  active             boolean not null default true,
  confirmed_balances jsonb,
  note               text
);

create table erp.loan_contracts (
  id                text primary key,
  company_id        text not null references erp.companies(id),
  name              text not null,
  partner_id        text references erp.partners(id),
  lender_name       text,
  account_code      text,
  opening_date      date,
  opening_principal numeric,
  maturity_date     date
);

-- 전표 하나: 거래명세서(매출·매입 등)와 자금 전표(입금·출금·대체)를 kind로 나눈다.
create table erp.vouchers (
  id               text primary key,
  company_id       text not null references erp.companies(id),
  voucher_no       text,
  date             date,
  kind             text not null,
  partner_id       text references erp.partners(id),
  partner_name     text,
  order_id         text references erp.orders(id),
  cash_account_id  text references erp.cash_accounts(id),
  loan_id          text references erp.loan_contracts(id),
  account_code     text,
  supply           numeric,
  tax              numeric,
  amount           numeric,
  memo             text,
  created_by       text,
  created_at       timestamptz,
  status           text not null default 'active' check (status in ('active', 'canceled')),
  legacy_collection text not null
);
alter table erp.orders add constraint orders_voucher_fk foreign key (voucher_id) references erp.vouchers(id);
create unique index vouchers_no on erp.vouchers (company_id, voucher_no) where voucher_no is not null and status = 'active' and legacy_collection = 'app';
create index vouchers_partner on erp.vouchers (partner_id, date);

-- 전표 줄. 명세서는 품목 줄, 자금 전표는 계정 줄.
create table erp.voucher_lines (
  voucher_id   text not null references erp.vouchers(id) on delete cascade,
  line_no      int  not null,
  line_kind    text,
  item_id      text references erp.items(id),
  name         text,
  spec         text,
  qty          numeric,
  price        numeric,
  supply       numeric,
  tax          numeric,
  amount       numeric,
  account_code text,
  side         text,
  tax_exempt   boolean,
  note         text,
  primary key (voucher_id, line_no)
);

-- 반제: 입금·출금 전표가 어느 명세서를 얼마만큼 정리했는지 (옛 settlements).
create table erp.voucher_applies (
  id         text primary key,
  company_id text not null references erp.companies(id),
  voucher_id text not null references erp.vouchers(id),
  applies_to text not null references erp.vouchers(id),
  amount     numeric not null,
  created_at timestamptz
);

create table erp.voucher_edit_requests (
  id         text primary key,
  company_id text not null references erp.companies(id),
  voucher_id text references erp.vouchers(id),
  status     text,
  reason     text,
  changes    jsonb,
  proposed   jsonb,
  created_by text,
  created_at timestamptz
);

-- 반복 전표 양식 + 경비 프리셋.
create table erp.voucher_templates (
  id           text primary key,
  company_id   text not null references erp.companies(id),
  name         text not null,
  kind         text,
  direction    text,
  mode         text,
  amount       numeric,
  account_code text,
  partner_id   text references erp.partners(id),
  loan_id      text references erp.loan_contracts(id),
  auto_issue   boolean,
  issue_day    int,
  active       boolean,
  lines        jsonb,
  note         text,
  legacy_collection text not null
);

-- 기준일 잔액(기초 등). 줄은 계정 코드별 금액.
create table erp.balance_snapshots (
  id         text primary key,
  company_id text not null references erp.companies(id),
  kind       text not null,
  as_of      date not null
);
create table erp.balance_snapshot_lines (
  snapshot_id  text not null references erp.balance_snapshots(id) on delete cascade,
  account_code text not null,
  partner_id   text references erp.partners(id),
  amount       numeric not null
);

create table erp.item_cost_history (
  id                text primary key,
  company_id        text not null references erp.companies(id),
  item_id           text not null references erp.items(id),
  before_cost       numeric,
  after_cost        numeric,
  effective_date    date,
  source_voucher_id text references erp.vouchers(id),
  source_line_no    int,
  actor             text,
  recorded_at       timestamptz
);

create table erp.inventory_snapshots (
  id         text primary key,
  company_id text not null references erp.companies(id),
  year_month text not null,
  value      numeric,
  items      jsonb,
  recorded_at timestamptz
);

-- ---------- 구매 ----------
create table erp.purchase_orders (
  id            text primary key,
  company_id    text not null references erp.companies(id),
  po_no         text,
  po_type       text,
  partner_id    text references erp.partners(id),
  partner_name  text,
  status        text,
  voucher_id    text references erp.vouchers(id),
  oem_fee_per_kg numeric,
  oem_sent      jsonb,
  note          text,
  created_at    timestamptz,
  received_at   timestamptz
);
create table erp.purchase_order_lines (
  po_id    text not null references erp.purchase_orders(id) on delete cascade,
  line_no  int  not null,
  item_id  text references erp.items(id),
  name     text,
  qty      numeric,
  unit     text,
  price    numeric,              -- 세금 포함 단가
  tax_exempt boolean,
  received_qty numeric not null default 0,
  primary key (po_id, line_no)
);
-- 매입 명세서가 어느 발주에서 왔나
alter table erp.vouchers add column po_id text references erp.purchase_orders(id);

-- 입고 한 번 = 줄마다 한 행. 입고 취소 때 받은 수량을 되돌리는 근거.
create table erp.purchase_receipts (
  id          text primary key,
  company_id  text not null references erp.companies(id),
  po_id       text not null references erp.purchase_orders(id),
  line_no     int  not null,
  qty         numeric not null,
  voucher_id  text references erp.vouchers(id),
  ledger_id   text,
  received_on date,
  canceled_at timestamptz
);

create table erp.adjustment_requests (
  id          text primary key,
  company_id  text not null references erp.companies(id),
  item_id     text,
  type        text,
  status      text,
  reason      text,
  qty_before  numeric,
  qty_after   numeric,
  po_id       text references erp.purchase_orders(id),
  requested_at timestamptz,
  processed_at timestamptz
);

-- ---------- 주문 ----------
create table erp.order_history (
  id         text primary key,
  company_id text not null references erp.companies(id),
  order_id   text not null,
  kind       text not null,
  changes    jsonb,
  by_name    text,
  at         timestamptz
);
create index order_history_order on erp.order_history (order_id, at);

create table erp.quotations (
  id           text primary key,
  company_id   text not null references erp.companies(id),
  quote_no     text,
  date         date,
  valid_until  date,
  partner_id   text references erp.partners(id),
  partner_name text,
  lines        jsonb,
  supply       numeric,
  tax          numeric,
  amount       numeric,
  created_by   text
);

create table erp.order_interpretation_rules (
  id         text primary key,
  company_id text not null references erp.companies(id),
  partner_id text references erp.partners(id),
  alias      text not null,
  item_id    text references erp.items(id),
  status     text
);

-- ---------- 인사 ----------
alter table erp.employees add column phone text, add column birth_date date,
  add column health_cert_date date, add column annual_leave jsonb;

create table erp.leave_requests (
  id           text primary key,
  company_id   text not null references erp.companies(id),
  employee_id  text references erp.employees(id),
  employee_name text,
  type         text,
  start_date   date,
  end_date     date,
  days_used    numeric,
  status       text,
  reason       text,
  requested_at date
);

create table erp.payrolls (
  id         text primary key,
  company_id text not null references erp.companies(id),
  year_month text not null,
  pay_date   date,
  voucher_id text references erp.vouchers(id),
  note       text
);
create table erp.payroll_lines (
  payroll_id   text not null references erp.payrolls(id) on delete cascade,
  line_no      int  not null,
  employee_id  text references erp.employees(id),
  employee_name text,
  base         numeric,
  allowance    numeric,
  overtime     numeric,
  income_tax   numeric,
  local_tax    numeric,
  pension      numeric,
  health       numeric,
  employment   numeric,
  other_deduct numeric,
  note         text,
  primary key (payroll_id, line_no)
);

-- ---------- 거래처 포털 계정 ----------
create table erp.partner_accounts (
  uid        text primary key,
  company_id text not null references erp.companies(id),
  partner_id text references erp.partners(id),
  name       text,
  email      text,
  phone      text,
  status     text,
  approved_at timestamptz
);

-- ---------- 문서·점검 ----------
create table erp.file_categories (
  id         text primary key,
  company_id text not null references erp.companies(id),
  name       text not null,
  parent_id  text references erp.file_categories(id),
  sort_order int
);
-- 파일 본문은 아직 Firebase Storage에 있다(storage_path). Supabase Storage로 옮기는 건 별도.
create table erp.files (
  id           text primary key,
  company_id   text not null references erp.companies(id),
  category_id  text references erp.file_categories(id),
  file_name    text,
  content_type text,
  size         bigint,
  storage_path text,
  note         text,
  uploaded_by  text,
  uploaded_at  timestamptz
);

create table erp.haccp_templates (
  id         text primary key,
  company_id text not null references erp.companies(id),
  data       jsonb
);
create table erp.haccp_records (
  id           text primary key,
  company_id   text not null references erp.companies(id),
  type         text not null,
  date         text,
  rows         jsonb,
  notes        text,
  created_by   text,
  created_at   timestamptz,
  confirmed_by text,
  confirmed_at timestamptz
);

create table erp.benzopyrene_tests (
  id             text primary key,
  company_id     text not null references erp.companies(id),
  product_name   text,
  test_item      text,
  lot_no         text,
  received_date  date,
  completed_date date,
  criteria       text,
  result         text,
  judgment       text
);

-- ---------- 협업 ----------
create table erp.chat_rooms (
  id              text primary key,
  company_id      text not null references erp.companies(id),
  name            text,
  is_group        boolean,
  participant_ids text[],
  last_updated_at timestamptz
);
create table erp.chat_messages (
  id          text primary key,
  company_id  text not null references erp.companies(id),
  room_id     text not null references erp.chat_rooms(id),
  sender_id   text,
  sender_name text,
  text        text,
  image_url   text,
  file_url    text,
  created_at  timestamptz,
  deleted_at  timestamptz
);
create table erp.notices (
  id         text primary key,
  company_id text not null references erp.companies(id),
  title      text,
  content    text,
  tag        text,
  author     text,
  date       date,
  pinned     boolean
);
create table erp.notifications (
  id         text primary key,
  company_id text not null references erp.companies(id),
  type       text,
  title      text,
  body       text,
  linked_id  text,
  target_id  text,
  sender_id  text,
  read_by    text[],
  created_at timestamptz
);
create table erp.dashboard_links (
  id         text primary key,
  company_id text not null references erp.companies(id),
  label      text,
  url        text,
  sort_order int
);
create table erp.item_taxonomy (
  id         text primary key,
  company_id text not null references erp.companies(id),
  kind       text,
  key        text,
  label      text,
  parent     text,
  sort_order int,
  hidden     boolean
);
create table erp.work_projects (
  id          text primary key,
  company_id  text not null references erp.companies(id),
  title       text,
  description text,
  status      text,
  owner_id    text,
  participant_ids text[],
  created_at  timestamptz
);
create table erp.settings (
  id         text primary key,
  company_id text not null references erp.companies(id),
  data       jsonb
);

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'erp' loop
    execute format('alter table erp.%I enable row level security', t);
  end loop;
end $$;
revoke all on all tables in schema erp from anon, authenticated;
