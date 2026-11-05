-- 시험 이전 3-2단계: 나머지 컬렉션 → erp 표. 020 뒤에 돈다(별도 세션이라 src를 다시 만든다).
-- 참조가 깨지면: 꼭 있어야 하는 참조는 줄을 빼고 import_rejects에 남기고, 없어도 되는 참조는 비워 둔다.
-- 옮기지 않는 컬렉션: appMeta(시스템 표식·번호), auditBackups, confirmedOrders, documentStoragePaths,
--   fixedCosts·stockClosings(안 씀), products(옛 표), purchaseOrderBatchAudits(처리 기록), usernames,
--   rawDocEntries·productionSalesLogs(서류 — ERP 밖. raw에는 남아 있어 내보내기에 쓴다).

create temp view src as
select collection, id, company_id, data from raw.docs where company_id in ('taebaek', 'punghoe');

insert into erp.import_rejects
select collection, id, 'companyId 없음 또는 알 수 없는 회사: ' || coalesce(company_id, '(없음)')
from raw.docs where (company_id is null or company_id not in ('taebaek', 'punghoe'))
  and collection in ('accountGroups','accountCodes','cashAccounts','loanContracts','issuedStatements','cashEntries',
    'settlements','pendingStatementEdits','fixedCostTemplates','expensePresets','openingBalances','itemCostHistory',
    'inventorySnapshots','purchaseOrders','adjustmentRequests','orderStatusAudits','orderItemEdits',
    'deliveryScheduleAudits','quotations','orderInterpretationRules','leaveRequests','payrolls','users',
    'fileCabinetCategories','fileCabinetSubCategories','fileCabinetDocs','haccp_templates','haccp_temp',
    'haccp_sanitation','haccp_personal_hygiene','haccp_periodic_sanitation','haccp_closing_checklist',
    'haccp_incoming','haccp_cleaning','benzopyreneTests','chatRooms','chatMessages','notices','notifications','dashboardLinks',
    'itemTaxonomy','workProjectsV1','settings','pallets','palletTransactions','itemReceipts','itemUnpackMovements');

-- ---------- 도우미: 있으면 그 id, 없으면 null ----------
create or replace function erp.ref_partner(v text) returns text language sql stable as $$ select id from erp.partners where id = v $$;
create or replace function erp.ref_item(v text) returns text language sql stable as $$ select id from erp.items where id = v $$;
create or replace function erp.ref_order(v text) returns text language sql stable as $$ select id from erp.orders where id = v $$;
create or replace function erp.ref_employee(v text) returns text language sql stable as $$ select id from erp.employees where id = v $$;
create or replace function erp.ref_voucher(v text) returns text language sql stable as $$ select id from erp.vouchers where id = v $$;
create or replace function erp.ref_cash(v text) returns text language sql stable as $$ select id from erp.cash_accounts where id = v $$;
create or replace function erp.ref_loan(v text) returns text language sql stable as $$ select id from erp.loan_contracts where id = v $$;
create or replace function erp.ref_po(v text) returns text language sql stable as $$ select id from erp.purchase_orders where id = v $$;
create or replace function erp.arr(v jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end $$;
create or replace function erp.txt_arr(v jsonb) returns text[] language sql immutable as $$
  select array(select jsonb_array_elements_text(erp.arr(v))) $$;
create or replace function erp.to_bool(v jsonb) returns boolean language sql immutable as $$
  select case when jsonb_typeof(v) = 'boolean' then (v #>> '{}')::boolean end $$;

-- ---------- 계정 (묶음 → 상위 계정, 과목 → 하위 계정) ----------
insert into erp.accounts (id, company_id, code, name, type, pl_line)
select id, company_id, null, coalesce(data->>'name', id), data->>'type', data->>'plLine'
from src where collection = 'accountGroups';

insert into erp.accounts (id, company_id, code, name, parent_id, type, normal_balance, cf_section, is_cash, note)
select distinct on (s.company_id, s.data->>'code')
       s.id, s.company_id, s.data->>'code', coalesce(s.data->>'name', s.id),
       (select a.id from erp.accounts a where a.id = s.data->>'groupId'),
       s.data->>'type', s.data->>'normalBalance', s.data->>'cfSection',
       coalesce(erp.to_bool(s.data->'isCash'), false), s.data->>'note'
from src s where s.collection = 'accountCodes'
order by s.company_id, s.data->>'code', s.id;

insert into erp.import_rejects
select 'accountCodes', id, '같은 회사에 같은 계정 코드가 또 있음: ' || coalesce(data->>'code', '(없음)')
from src s where collection = 'accountCodes' and not exists (select 1 from erp.accounts a where a.id = s.id);

-- ---------- 통장·대출 ----------
insert into erp.cash_accounts (id, company_id, name, type, opening_balance, opening_date, active, confirmed_balances, note)
select id, company_id, coalesce(data->>'name', id), data->>'type', erp.to_num(data->'openingBalance'),
       erp.to_date(data->>'openingDate'), coalesce(erp.to_bool(data->'active'), true), data->'confirmedBalances', data->>'note'
from src where collection = 'cashAccounts';

insert into erp.loan_contracts (id, company_id, name, partner_id, lender_name, account_code, opening_date, opening_principal, maturity_date)
select id, company_id, coalesce(data->>'name', id), erp.ref_partner(data->>'partnerId'), data->>'lenderName',
       data->>'accountCode', erp.to_date(data->>'openingDate'), erp.to_num(data->'openingPrincipal'), erp.to_date(data->>'maturityDate')
from src where collection = 'loanContracts';

-- ---------- 전표: 거래명세서 ----------
insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, order_id,
                          supply, tax, amount, memo, created_by, created_at, legacy_collection)
select id, company_id, data->>'docNo', erp.to_date(data->>'tradeDate'), coalesce(data->>'type', '명세서'),
       erp.ref_partner(data->>'partnerId'), data->>'partnerName', erp.ref_order(data->>'orderId'),
       erp.to_num(data->'totalSupply'), erp.to_num(data->'totalTax'), erp.to_num(data->'totalAmount'),
       nullif(data->>'memo', ''), data->>'createdBy', erp.to_ts(coalesce(data->>'createdAt', data->>'issuedAt')),
       'issuedStatements'
from src where collection = 'issuedStatements';

-- 비용 명세서(기초·대출 등)는 계정 줄에 차변/대변(side)이 있다.
insert into erp.voucher_lines (voucher_id, line_no, line_kind, item_id, name, spec, qty, price, supply, tax, amount, account_code, side, tax_exempt, note)
select s.id, l.ord::int, coalesce(l.v->>'lineKind', 'item'), erp.ref_item(l.v->>'itemId'), l.v->>'name', l.v->>'spec',
       erp.to_num(l.v->'qty'), erp.to_num(l.v->'price'), erp.to_num(l.v->'supply'), erp.to_num(l.v->'tax'),
       erp.to_num(l.v->'total'), l.v->>'accountCode', l.v->>'side', erp.to_bool(l.v->'isTaxExempt'), l.v->>'note'
from src s cross join lateral jsonb_array_elements(erp.arr(s.data->'items')) with ordinality as l(v, ord)
where s.collection = 'issuedStatements';

-- 주문 ↔ 명세서 연결 (주문 문서의 linkedStatementId)
update erp.orders o set voucher_id = v.id
from src s join erp.vouchers v on v.id = s.data->>'linkedStatementId'
where s.collection = 'orders' and s.id = o.id;

-- ---------- 전표: 자금 (입금·출금·대체) ----------
insert into erp.vouchers (id, company_id, voucher_no, date, kind, partner_id, partner_name, cash_account_id, loan_id,
                          account_code, amount, memo, created_by, created_at, legacy_collection)
select id, company_id, data->>'docNo', erp.to_date(data->>'date'), coalesce(data->>'dir', '자금'),
       erp.ref_partner(data->>'partnerId'), data->>'partnerName', erp.ref_cash(data->>'cashAccountId'),
       erp.ref_loan(data->>'loanId'), data->>'accountCode', erp.to_num(data->'amount'),
       nullif(data->>'note', ''), data->>'createdBy', erp.to_ts(data->>'createdAt'), 'cashEntries'
from src s where collection = 'cashEntries'
  and not exists (select 1 from erp.vouchers v where v.id = s.id);

insert into erp.import_rejects
select 'cashEntries', s.id, '거래명세서와 같은 id'
from src s where collection = 'cashEntries'
  and exists (select 1 from erp.vouchers v where v.id = s.id and v.legacy_collection <> 'cashEntries');

-- 줄이 있으면 그 줄들, 없으면 계정 한 줄. 줄은 언제나 차변/대변(side) + 양수 금액으로 고쳐 담는다.
-- 앱 규칙(cashLineProjection): side가 있으면 그대로. 없으면 부호가 차대다 —
--   입금·출금: 양수면 '제자리'(입금=대변, 출금=차변), 음수면 반대편.  대체: 양수=차변, 음수=대변.
insert into erp.voucher_lines (voucher_id, line_no, line_kind, name, amount, account_code, side, note)
select s.id, l.ord::int, 'account', l.v->>'name', abs(erp.to_num(l.v->'amount')), l.v->>'accountCode',
       coalesce(l.v->>'side',
         case when s.data->>'dir' = '대체' then case when erp.to_num(l.v->'amount') >= 0 then '차변' else '대변' end
              when (erp.to_num(l.v->'amount') >= 0) = (s.data->>'dir' = '입금') then '대변' else '차변' end),
       l.v->>'note'
from src s cross join lateral jsonb_array_elements(erp.arr(s.data->'lines')) with ordinality as l(v, ord)
where s.collection = 'cashEntries' and erp.to_num(l.v->'amount') is not null
  and exists (select 1 from erp.vouchers v where v.id = s.id and v.legacy_collection = 'cashEntries');

insert into erp.voucher_lines (voucher_id, line_no, line_kind, amount, account_code, side, note)
select s.id, 1, 'account', abs(erp.to_num(s.data->'amount')), s.data->>'accountCode',
       case when (erp.to_num(s.data->'amount') >= 0) = (s.data->>'dir' = '입금') then '대변' else '차변' end,
       nullif(s.data->>'note', '')
from src s
where s.collection = 'cashEntries' and jsonb_array_length(erp.arr(s.data->'lines')) = 0
  and exists (select 1 from erp.vouchers v where v.id = s.id and v.legacy_collection = 'cashEntries');

-- ---------- 반제 (옛 settlements) ----------
insert into erp.voucher_applies (id, company_id, voucher_id, applies_to, amount, created_at)
select id, company_id, data->>'cashEntryId', data->>'statementId', erp.to_num(data->'amount'), erp.to_ts(data->>'createdAt')
from src s where collection = 'settlements'
  and erp.ref_voucher(data->>'cashEntryId') is not null and erp.ref_voucher(data->>'statementId') is not null
  and erp.to_num(data->'amount') is not null;

insert into erp.import_rejects
select 'settlements', id,
       case when erp.ref_voucher(data->>'cashEntryId') is null then '없는 자금 전표: ' || coalesce(data->>'cashEntryId', '(없음)')
            else '없는 명세서: ' || coalesce(data->>'statementId', '(없음)') end
from src s where collection = 'settlements'
  and (erp.ref_voucher(data->>'cashEntryId') is null or erp.ref_voucher(data->>'statementId') is null);

insert into erp.voucher_edit_requests (id, company_id, voucher_id, status, reason, changes, proposed, created_by, created_at)
select id, company_id, erp.ref_voucher(data->>'statementId'), data->>'status', data->>'reason', data->'changes',
       data->'proposedData', data->>'createdBy', erp.to_ts(data->>'createdAt')
from src where collection = 'pendingStatementEdits';

-- ---------- 반복 전표 양식 ----------
insert into erp.voucher_templates (id, company_id, name, kind, direction, mode, amount, account_code, partner_id, loan_id,
                                   auto_issue, issue_day, active, lines, note, legacy_collection)
select id, company_id, coalesce(data->>'name', id), data->>'kind', data->>'dir', data->>'mode', erp.to_num(data->'amount'),
       data->>'accountCode', erp.ref_partner(data->>'partnerId'), erp.ref_loan(data->>'loanId'),
       erp.to_bool(data->'autoIssue'), erp.to_num(data->'issueDay')::int, erp.to_bool(data->'active'),
       data->'transferLines', data->>'note', 'fixedCostTemplates'
from src where collection = 'fixedCostTemplates';

insert into erp.voucher_templates (id, company_id, name, kind, amount, note, active, legacy_collection)
select id, company_id, coalesce(data->>'name', id), 'expense-preset', erp.to_num(data->'price'), data->>'taxType', true, 'expensePresets'
from src s where collection = 'expensePresets' and not exists (select 1 from erp.voucher_templates t where t.id = s.id);

-- ---------- 기초 잔액 ----------
insert into erp.balance_snapshots (id, company_id, kind, as_of)
select id, company_id, 'opening', erp.to_date(data->>'date')
from src where collection = 'openingBalances' and erp.to_date(data->>'date') is not null;

insert into erp.balance_snapshot_lines (snapshot_id, account_code, amount)
select s.id, a.key, erp.to_num(a.value)
from src s cross join lateral jsonb_each(case when jsonb_typeof(s.data->'amounts') = 'object' then s.data->'amounts' else '{}'::jsonb end) a
where s.collection = 'openingBalances' and erp.to_num(a.value) is not null
  and exists (select 1 from erp.balance_snapshots b where b.id = s.id);

-- ---------- 원가 이력·월말 재고 스냅샷 ----------
insert into erp.item_cost_history (id, company_id, item_id, before_cost, after_cost, effective_date, source_voucher_id, source_line_no, actor, recorded_at)
select id, company_id, data->>'itemId', erp.to_num(data->'beforeCost'), erp.to_num(data->'afterCost'),
       erp.to_date(data->>'effectiveAt'), erp.ref_voucher(data->>'sourceStatementId'),
       erp.to_num(data->'sourceLineIndex')::int + 1, data->>'actorId', erp.to_ts(data->>'recordedAt')
from src where collection = 'itemCostHistory' and erp.ref_item(data->>'itemId') is not null;

insert into erp.import_rejects
select 'itemCostHistory', id, '없는 품목을 가리킴: ' || coalesce(data->>'itemId', '(없음)')
from src where collection = 'itemCostHistory' and erp.ref_item(data->>'itemId') is null;

insert into erp.inventory_snapshots (id, company_id, year_month, value, items, recorded_at)
select id, company_id, coalesce(data->>'yearMonth', '?'), erp.to_num(data->'value'), data->'items', erp.to_ts(data->>'recordedAt')
from src where collection = 'inventorySnapshots';

-- ---------- 발주 ----------
insert into erp.purchase_orders (id, company_id, po_no, po_type, partner_id, partner_name, status, voucher_id,
                                 oem_fee_per_kg, oem_sent, note, created_at, received_at)
select id, company_id, data->>'cardNo', coalesce(data->>'poType', 'normal'), erp.ref_partner(data->>'partnerId'),
       data->>'partnerName', data->>'status', erp.ref_voucher(data->>'linkedStatementId'),
       erp.to_num(data->'oemFeePerKg'), data->'oemSent', data->>'note',
       erp.to_ts(data->>'createdAt'), erp.to_ts(data->>'receivedAt')
from src where collection = 'purchaseOrders';

insert into erp.purchase_order_lines (po_id, line_no, item_id, name, qty, unit)
select s.id, l.ord::int, erp.ref_item(l.v->>'itemId'), l.v->>'name', erp.to_num(l.v->'quantity'), l.v->>'unit'
from src s cross join lateral jsonb_array_elements(erp.arr(s.data->'items')) with ordinality as l(v, ord)
where s.collection = 'purchaseOrders';

-- 입고된 발주는 줄 수량을 다 받은 것으로 둔다. 매입 명세서에 발주를 이어 둔다.
update erp.purchase_order_lines l set received_qty = coalesce(l.qty, 0)
from erp.purchase_orders p where p.id = l.po_id and p.status = 'received';  -- invoiced = 입고대기(아직 안 받음)
update erp.vouchers v set po_id = p.id from erp.purchase_orders p where p.voucher_id = v.id;

-- 예전 형식: items 없이 품목 하나를 문서 칸에 직접.
insert into erp.purchase_order_lines (po_id, line_no, item_id, name, qty)
select s.id, 1, erp.ref_item(s.data->>'itemId'), s.data->>'itemName', erp.to_num(s.data->'quantity')
from src s
where s.collection = 'purchaseOrders' and jsonb_array_length(erp.arr(s.data->'items')) = 0
  and coalesce(s.data->>'itemId', '') <> '';

update erp.purchase_order_lines l set received_qty = coalesce(l.qty, 0)
from erp.purchase_orders p where p.id = l.po_id and p.status = 'received' and l.received_qty = 0;  -- invoiced = 입고대기(아직 안 받음)

insert into erp.adjustment_requests (id, company_id, item_id, type, status, reason, qty_before, qty_after, po_id, requested_at, processed_at)
select id, company_id, data->>'itemId', data->>'type', data->>'status', data->>'reason',
       erp.to_num(data->'originalQuantity'), erp.to_num(data->'requestedQuantity'), erp.ref_po(data->>'oemPoId'),
       erp.to_ts(data->>'requestedAt'), erp.to_ts(data->>'processedAt')
from src where collection = 'adjustmentRequests';

-- ---------- 주문 이력 (상태 변경·품목 수정·배송일 변경을 한 표로) ----------
insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
select 'status:' || id, company_id, data->>'orderId', 'status',
       jsonb_strip_nulls(jsonb_build_object('from', data->'previousStatus', 'to', data->'nextStatus', 'action', data->'action',
         'deleted', data->'deleted', 'note', data->'note', 'cardNo', data->'cardNo')),
       coalesce(data->>'approvedBy', data->>'actor', data->>'actorDisplay'),
       erp.to_ts(coalesce(data->>'completedAt', data->>'approvedAt', data->>'at'))
from src where collection = 'orderStatusAudits' and data->>'orderId' is not null;

insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
select 'items:' || id, company_id, data->>'orderId', 'items', data->'changes', data->>'by', erp.to_ts(data->>'at')
from src where collection = 'orderItemEdits' and data->>'orderId' is not null;

insert into erp.order_history (id, company_id, order_id, kind, changes, by_name, at)
select 'delivery:' || id, company_id, data->>'orderId', 'delivery',
       jsonb_build_object('fromDate', data->'previousDeliveryDate', 'toDate', data->'nextDeliveryDate',
         'fromSlot', data->'previousTimeSlot', 'toSlot', data->'nextTimeSlot'),
       data->>'changedBy', erp.to_ts(data->>'changedAt')
from src where collection = 'deliveryScheduleAudits' and data->>'orderId' is not null;

insert into erp.quotations (id, company_id, quote_no, date, valid_until, partner_id, partner_name, lines, supply, tax, amount, created_by)
select id, company_id, data->>'quoteNo', erp.to_date(data->>'date'), erp.to_date(data->>'validUntil'),
       erp.ref_partner(data->>'partnerId'), data->>'partnerName', data->'lines',
       erp.to_num(data->'totalSupply'), erp.to_num(data->'totalTax'), erp.to_num(data->'totalAmount'), data->>'createdBy'
from src where collection = 'quotations';

insert into erp.order_interpretation_rules (id, company_id, partner_id, alias, item_id, status)
select id, company_id, erp.ref_partner(data->>'partnerId'), coalesce(data->>'alias', ''), erp.ref_item(data->>'itemId'), data->>'status'
from src where collection = 'orderInterpretationRules';

-- ---------- 인사 ----------
update erp.employees e set legacy_uid = s.data->>'authUid', phone = s.data->>'phone', birth_date = erp.to_date(s.data->>'birthDate'),
       health_cert_date = erp.to_date(s.data->>'healthCertDate'), annual_leave = s.data->'annualLeave'
from src s where s.collection = 'employees' and s.id = e.id;

insert into erp.leave_requests (id, company_id, employee_id, employee_name, type, start_date, end_date, days_used, status, reason, requested_at)
select id, company_id, erp.ref_employee(data->>'employeeId'), data->>'employeeName', data->>'type',
       erp.to_date(data->>'startDate'), erp.to_date(data->>'endDate'), erp.to_num(data->'daysUsed'),
       data->>'status', data->>'reason', erp.to_date(data->>'requestedAt')
from src where collection = 'leaveRequests';

insert into erp.payrolls (id, company_id, year_month, pay_date, voucher_id, note)
select id, company_id, coalesce(data->>'yearMonth', id), erp.to_date(data->>'payDate'), erp.ref_voucher(data->>'cashEntryId'), data->>'note'
from src where collection = 'payrolls';

insert into erp.payroll_lines (payroll_id, line_no, employee_id, employee_name, base, allowance, overtime,
                               income_tax, local_tax, pension, health, employment, other_deduct, note)
select s.id, l.ord::int, erp.ref_employee(l.v->>'employeeId'), l.v->>'employeeName',
       erp.to_num(l.v->'base'), erp.to_num(l.v->'allowance'), erp.to_num(l.v->'overtime'),
       erp.to_num(l.v->'incomeTax'), erp.to_num(l.v->'localTax'), erp.to_num(l.v->'pension'),
       erp.to_num(l.v->'health'), erp.to_num(l.v->'employment'), erp.to_num(l.v->'otherDeduct'), l.v->>'note'
from src s cross join lateral jsonb_array_elements(erp.arr(s.data->'lines')) with ordinality as l(v, ord)
where s.collection = 'payrolls';

-- ---------- 거래처 포털 계정 (옛 users) ----------
insert into erp.partner_accounts (uid, username, type, company_id, partner_id, name, email, phone, status, approved_at)
select coalesce(data->>'uid', id), lower(data->>'username'), data->>'type', company_id, erp.ref_partner(data->>'linkedPartnerId'), data->>'name',
       data->>'email', data->>'phone', data->>'status', erp.to_ts(data->>'approvedAt')
from src where collection = 'users';

-- ---------- 서류함 ----------
insert into erp.file_categories (id, company_id, name, sort_order)
select id, company_id, coalesce(data->>'name', id), erp.to_num(data->'order')::int
from src where collection = 'fileCabinetCategories';

insert into erp.file_categories (id, company_id, name, parent_id, sort_order)
select s.id, s.company_id, coalesce(s.data->>'name', s.id),
       (select c.id from erp.file_categories c where c.company_id = s.company_id and c.parent_id is null
          and c.name = s.data->>'category' order by c.id limit 1),
       erp.to_num(s.data->'order')::int
from src s where s.collection = 'fileCabinetSubCategories';

insert into erp.files (id, company_id, category_id, file_name, content_type, size, storage_path, note, uploaded_by, uploaded_at)
select s.id, s.company_id,
       coalesce(
         (select c.id from erp.file_categories c join erp.file_categories p on p.id = c.parent_id
           where c.company_id = s.company_id and p.name = s.data->>'category' and c.name = s.data->>'subCategory' order by c.id limit 1),
         (select c.id from erp.file_categories c where c.company_id = s.company_id and c.parent_id is null
           and c.name = s.data->>'category' order by c.id limit 1)),
       s.data->>'fileName', s.data->>'contentType', erp.to_num(s.data->'size')::bigint, s.data->>'storagePath',
       nullif(s.data->>'note', ''), s.data->>'uploadedBy', erp.to_ts(s.data->>'uploadedAt')
from src s where s.collection = 'fileCabinetDocs';

-- ---------- 위생 점검 (컬렉션 7개 → 한 표, type으로 구분) ----------
insert into erp.haccp_templates (id, company_id, data)
select id, company_id, data - 'companyId' - 'clonedFrom' from src where collection = 'haccp_templates';

-- 하루 2번(작업장 위생: checkTime)·주간/월간(cycle)은 meta에 남겨 같은 날짜의 기록을 가른다.
-- 위생·주간/월간·마감 점검표의 rows에는 항목 이름이 없고 템플릿 순서로만 맞는다 → 이관 시점 템플릿 항목을 meta.items로 붙인다.
-- 세척·소독 일지(haccp_cleaning)는 rows 대신 machineRows·areaRows를 쓴다 → rows에 둘을 묶어 둔다.
insert into erp.haccp_records (id, company_id, type, date, rows, notes, created_by, created_at, confirmed_by, confirmed_at, meta)
select s.collection || ':' || s.id, s.company_id, substr(s.collection, 7),
       coalesce(s.data->>'checkDate', s.data->>'date', s.data->>'period', s.data->>'month'),
       case when s.collection = 'haccp_cleaning' then jsonb_build_object('machineRows', s.data->'machineRows', 'areaRows', s.data->'areaRows')
            else s.data->'rows' end,
       nullif(s.data->>'specialNotes', ''), s.data->>'createdBy', erp.to_ts(s.data->>'createdAt'),
       s.data->>'confirmedBy', erp.to_ts(s.data->>'confirmedAt'),
       (s.data - 'companyId' - 'rows' - 'machineRows' - 'areaRows' - 'specialNotes')
         || case when t.data is not null then jsonb_build_object('items', t.data->'items') else '{}'::jsonb end
from src s
cross join lateral (select case s.collection when 'haccp_sanitation' then 'sanitation' when 'haccp_closing_checklist' then 'closing_checklist'
                     when 'haccp_periodic_sanitation' then case when s.data->>'cycle' = 'monthly' then 'monthly_sanitation' else 'weekly_sanitation' end end as key) k
left join lateral (
  select x.data from src x
  where x.collection = 'haccp_templates' and x.company_id = s.company_id
    and x.id in (k.key, s.company_id || '--' || k.key) and jsonb_typeof(x.data->'items') = 'array'
  order by x.id = k.key desc limit 1) t on true
where s.collection like 'haccp\_%' and s.collection <> 'haccp_templates';

insert into erp.benzopyrene_tests (id, company_id, product_name, test_item, lot_no, received_date, completed_date, criteria, result, judgment)
select id, company_id, data->>'productName', data->>'testItem', nullif(data->>'lotNo', ''), erp.to_date(data->>'receivedDate'),
       erp.to_date(data->>'completedDate'), data->>'criteria', data->>'result', data->>'judgment'
from src where collection = 'benzopyreneTests';

-- ---------- 협업 ----------
insert into erp.chat_rooms (id, company_id, name, is_group, participant_ids, last_updated_at, last_message, last_read, created_by, notice)
select id, company_id, data->>'name', erp.to_bool(data->'isGroup'), erp.txt_arr(data->'participantIds'), erp.to_ts(data->>'lastUpdatedAt'),
       data->>'lastMessage', data->'lastReadBy', data->>'createdBy', data->'notice'
from src where collection = 'chatRooms';

insert into erp.chat_messages (id, company_id, room_id, sender_id, sender_name, text, image_url, file_url, file_name, images, reply_to,
                               created_at, deleted_at, deleted_by)
select id, company_id, data->>'roomId', data->>'senderId', data->>'senderName', data->>'text',
       data->>'imageUrl', data->>'fileUrl', data->>'fileName', data->'images', data->'replyTo',
       erp.to_ts(data->>'createdAt'), erp.to_ts(data->>'deletedAt'), data->>'deletedBy'
from src s where collection = 'chatMessages' and exists (select 1 from erp.chat_rooms r where r.id = s.data->>'roomId');

insert into erp.import_rejects
select 'chatMessages', id, '없는 대화방: ' || coalesce(data->>'roomId', '(없음)')
from src s where collection = 'chatMessages' and not exists (select 1 from erp.chat_rooms r where r.id = s.data->>'roomId');

insert into erp.notices (id, company_id, title, content, tag, author, date, pinned)
-- 블록(문단·사진)으로 쓴 공지는 글을 이어 붙이고, 사진은 주소 줄로 남긴다.
select id, company_id, data->>'title',
       coalesce(nullif(data->>'content', ''), (select string_agg(coalesce(b->>'text', case when b->>'url' is not null then '[사진] ' || (b->>'url') end), E'\n' order by o)
                                               from jsonb_array_elements(erp.arr(data->'blocks')) with ordinality x(b, o))),
       data->>'tag', data->>'author', erp.to_date(data->>'date'),
       coalesce(erp.to_bool(data->'pinned'), false)
from src where collection = 'notices';

insert into erp.notifications (id, company_id, type, title, body, linked_id, target_id, sender_id, read_by, created_at)
select id, company_id, data->>'type', data->>'title', data->>'body', data->>'linkedId', data->>'targetId',
       data->>'senderId', erp.txt_arr(data->'readBy'), erp.to_ts(data->>'createdAt')
from src where collection = 'notifications';

insert into erp.dashboard_links (id, company_id, label, url, sort_order)
select id, company_id, data->>'label', data->>'url', erp.to_num(data->'order')::int
from src where collection = 'dashboardLinks';

insert into erp.item_taxonomy (id, company_id, kind, key, label, parent, sort_order, hidden)
select id, company_id, data->>'kind', data->>'key', data->>'label', data->>'parent', erp.to_num(data->'order')::int,
       coalesce(erp.to_bool(data->'hidden'), false)
from src where collection = 'itemTaxonomy';

insert into erp.work_projects (id, company_id, title, description, status, owner_id, participant_ids, created_at)
select id, company_id, data->>'title', data->>'description', data->>'status', data->>'ownerEmployeeId',
       erp.txt_arr(data->'participantIds'), erp.to_ts(data->>'createdAt')
from src where collection = 'workProjectsV1';

insert into erp.settings (id, company_id, data)
select id, company_id, data - 'companyId' from src where collection = 'settings';

-- ---------- 파렛트 → 품목(PALLET) + 원장 ----------
insert into erp.items (id, company_id, name, type, legacy_type, unit, archived)
select id, company_id, coalesce(data->>'name', id), 'PALLET', 'pallet', '개', coalesce(erp.to_bool(data->'hidden'), false)
from src s where collection = 'pallets' and not exists (select 1 from erp.items i where i.id = s.id);

insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, effective_date, note)
select 'opening:' || id, company_id, id, coalesce(erp.to_num(data->'total'), 0), true, '개', '기초', 'migration', current_date,
       '이관 시점 파렛트 보유 수량' || case when coalesce(erp.to_num(data->'damaged'), 0) <> 0
                                          then ' (파손 ' || (data->>'damaged') || '개 포함)' else '' end
from src where collection = 'pallets' and coalesce(erp.to_num(data->'total'), 0) <> 0;

-- 지급·회수 이력. 지금 보유 수량(기초)에 이미 반영된 결과라 이력으로만 남긴다(stock_effect false).
insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, source_id, partner_id, effective_date, note)
select 'pallet:' || s.id, s.company_id, s.data->>'palletId',
       case when s.data->>'type' = 'out' then -1 else 1 end * coalesce(erp.to_num(s.data->'quantity'), 0),
       false, '개', case when s.data->>'type' = 'out' then '파렛트 지급' else '파렛트 회수' end, 'pallet', s.id,
       erp.ref_partner(s.data->>'partnerId'), erp.to_date(s.data->>'date'), nullif(s.data->>'note', '')
from src s where s.collection = 'palletTransactions' and erp.ref_item(s.data->>'palletId') is not null;

insert into erp.import_rejects
select 'palletTransactions', id, '없는 파렛트: ' || coalesce(data->>'palletId', '(없음)')
from src where collection = 'palletTransactions' and erp.ref_item(data->>'palletId') is null;

-- ---------- 원료 외 품목의 입고·박스 해체 이력 ----------
-- 원료 외 품목은 이력이 처음부터 다 있지 않아 지금 수량을 '기초'로 넣었다. 그래서 이 이력도 잔고에는 넣지 않는다.
insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, unit, kind, source_type, source_id, partner_id, effective_date, note)
select 'receipt:' || s.id, s.company_id, s.data->>'itemId', erp.to_num(s.data->'quantity'), false, s.data->>'unit',
       '입고', 'purchase_order', s.data->>'poId', erp.ref_partner(s.data->>'partnerId'), erp.to_date(s.data->>'date'),
       case when s.data ? 'correction' then '정정: ' || coalesce(s.data#>>'{correction,reason}', '') end
from src s where s.collection = 'itemReceipts' and erp.ref_item(s.data->>'itemId') is not null
  and erp.to_num(s.data->'quantity') is not null;

insert into erp.import_rejects
select 'itemReceipts', id, '없는 품목을 가리킴: ' || coalesce(data->>'itemId', '(없음)')
from src where collection = 'itemReceipts' and erp.ref_item(data->>'itemId') is null;

insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, kind, source_type, source_id, effective_date)
select 'unpack-box:' || s.id, s.company_id, s.data->>'boxItemId', -coalesce(erp.to_num(s.data->'boxQty'), 0), false,
       '박스 해체', 'unpack', s.id, erp.to_date(s.data->>'createdAt')
from src s where s.collection = 'itemUnpackMovements' and erp.ref_item(s.data->>'boxItemId') is not null;

insert into erp.stock_ledger (id, company_id, item_id, qty, stock_effect, kind, source_type, source_id, effective_date)
select 'unpack-unit:' || s.id, s.company_id, s.data->>'unitItemId', coalesce(erp.to_num(s.data->'count'), 0), false,
       '박스 해체', 'unpack', s.id, erp.to_date(s.data->>'createdAt')
from src s where s.collection = 'itemUnpackMovements' and erp.ref_item(s.data->>'unitItemId') is not null;

-- ---------- 잔고 다시 계산 (파렛트 기초가 늘었다) ----------
delete from erp.stock_balances;
insert into erp.stock_balances (item_id, company_id, qty, unit)
select l.item_id, min(l.company_id), sum(l.qty), max(l.unit)
from erp.stock_ledger l where l.stock_effect
group by l.item_id;
