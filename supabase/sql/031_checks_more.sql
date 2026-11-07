-- 나머지 컬렉션 대조.

\echo '## 8. 나머지: 원본 대비 옮긴 수'
select x.c as "Firestore", x.raw as "원본", x.moved as "옮김", x.t as "새 표"
from (values
  ('accountGroups + accountCodes', (select count(*) from raw.docs where collection in ('accountGroups','accountCodes')), (select count(*) from erp.accounts), 'accounts'),
  ('cashAccounts', (select count(*) from raw.docs where collection = 'cashAccounts'), (select count(*) from erp.cash_accounts), 'cash_accounts'),
  ('loanContracts', (select count(*) from raw.docs where collection = 'loanContracts'), (select count(*) from erp.loan_contracts), 'loan_contracts'),
  ('issuedStatements', (select count(*) from raw.docs where collection = 'issuedStatements'), (select count(*) from erp.vouchers where legacy_collection = 'issuedStatements'), 'vouchers'),
  ('cashEntries', (select count(*) from raw.docs where collection = 'cashEntries'), (select count(*) from erp.vouchers where legacy_collection = 'cashEntries'), 'vouchers'),
  ('(전표 줄)', null, (select count(*) from erp.voucher_lines), 'voucher_lines'),
  ('settlements', (select count(*) from raw.docs where collection = 'settlements'), (select count(*) from erp.voucher_applies), 'voucher_applies'),
  ('pendingStatementEdits', (select count(*) from raw.docs where collection = 'pendingStatementEdits'), (select count(*) from erp.voucher_edit_requests), 'voucher_edit_requests'),
  ('fixedCostTemplates + expensePresets', (select count(*) from raw.docs where collection in ('fixedCostTemplates','expensePresets')), (select count(*) from erp.voucher_templates), 'voucher_templates'),
  ('openingBalances', (select count(*) from raw.docs where collection = 'openingBalances'), (select count(*) from erp.balance_snapshots), 'balance_snapshots'),
  ('itemCostHistory', (select count(*) from raw.docs where collection = 'itemCostHistory'), (select count(*) from erp.item_cost_history), 'item_cost_history'),
  ('inventorySnapshots', (select count(*) from raw.docs where collection = 'inventorySnapshots'), (select count(*) from erp.inventory_snapshots), 'inventory_snapshots'),
  ('purchaseOrders', (select count(*) from raw.docs where collection = 'purchaseOrders'), (select count(*) from erp.purchase_orders), 'purchase_orders'),
  ('(발주 줄)', null, (select count(*) from erp.purchase_order_lines), 'purchase_order_lines'),
  ('adjustmentRequests', (select count(*) from raw.docs where collection = 'adjustmentRequests'), (select count(*) from erp.adjustment_requests), 'adjustment_requests'),
  ('주문 이력 3종', (select count(*) from raw.docs where collection in ('orderStatusAudits','orderItemEdits','deliveryScheduleAudits')), (select count(*) from erp.order_history), 'order_history'),
  ('quotations', (select count(*) from raw.docs where collection = 'quotations'), (select count(*) from erp.quotations), 'quotations'),
  ('orderInterpretationRules', (select count(*) from raw.docs where collection = 'orderInterpretationRules'), (select count(*) from erp.order_interpretation_rules), 'order_interpretation_rules'),
  ('leaveRequests', (select count(*) from raw.docs where collection = 'leaveRequests'), (select count(*) from erp.leave_requests), 'leave_requests'),
  ('payrolls', (select count(*) from raw.docs where collection = 'payrolls'), (select count(*) from erp.payrolls), 'payrolls'),
  ('users', (select count(*) from raw.docs where collection = 'users'), (select count(*) from erp.partner_accounts), 'partner_accounts'),
  ('fileCabinet 분류 2종', (select count(*) from raw.docs where collection in ('fileCabinetCategories','fileCabinetSubCategories')), (select count(*) from erp.file_categories), 'file_categories'),
  ('fileCabinetDocs', (select count(*) from raw.docs where collection = 'fileCabinetDocs'), (select count(*) from erp.files), 'files'),
  ('haccp 점검 6종', (select count(*) from raw.docs where collection like 'haccp\_%' and collection <> 'haccp_templates'), (select count(*) from erp.haccp_records), 'haccp_records'),
  ('chatMessages', (select count(*) from raw.docs where collection = 'chatMessages'), (select count(*) from erp.chat_messages), 'chat_messages'),
  ('notifications', (select count(*) from raw.docs where collection = 'notifications'), (select count(*) from erp.notifications), 'notifications'),
  ('pallets', (select count(*) from raw.docs where collection = 'pallets'), (select count(*) from erp.items where type = 'PALLET'), 'items(PALLET)'),
  ('palletTransactions', (select count(*) from raw.docs where collection = 'palletTransactions'), (select count(*) from erp.stock_ledger where source_type = 'pallet'), 'stock_ledger'),
  ('itemReceipts', (select count(*) from raw.docs where collection = 'itemReceipts'), (select count(*) from erp.stock_ledger where id like 'receipt:%'), 'stock_ledger')
) x(c, raw, moved, t);

\echo '## 9. 못 옮긴 줄 (나머지, 이유별)'
select collection as "컬렉션", regexp_replace(reason, ':.*$', '') as "이유", count(*) as "건수"
from erp.import_rejects
where collection not in ('partners','partner_item','items','item_bom','item_formula','item_pack','item_purchase_unit',
                         'employees','orders','productionRecords','rawMaterialLedger','rawInventories')
group by 1, 2 order by 3 desc;

\echo '## 10. 분개: 회사별 차변 합 = 대변 합'
select company_id as "회사", count(distinct voucher_id) as "분개된 전표", round(sum(debit)) as "차변 합", round(sum(credit)) as "대변 합"
from erp.journal_lines group by 1 order by 1;

\echo '## 10-2. 분개 못 한 전표 (이유별, 앱도 같은 전표를 건너뛴다)'
select company_id as "회사", kind as "종류", reason as "이유", count(*) as "건수", round(sum(amount)) as "금액"
from erp.journal_skipped group by 1, 2, 3 order by 4 desc;

\echo '## 10-3. 분개 못 한 전표 예시 (최대 10건)'
select voucher_id as "전표", kind as "종류", voucher_no as "번호", date as "날짜", amount as "금액", reason as "이유", debit as "차변", credit as "대변"
from erp.journal_skipped order by date desc limit 10;

\echo '## 10-4. 거래처 잔액 상위 — 지금 앱의 거래처 잔액과 대조해 보세요'
select b.company_id as "회사", p.name as "거래처", round(b.receivable) as "미수", round(b.payable) as "미지급"
from erp.partner_balances b join erp.partners p on p.id = b.partner_id
where abs(b.receivable) >= 1 or abs(b.payable) >= 1
order by greatest(abs(b.receivable), abs(b.payable)) desc limit 25;

\echo '## 10-5. 회사별 미수·미지급 합계'
select company_id as "회사", round(sum(receivable)) as "미수 합계", round(sum(payable)) as "미지급 합계"
from erp.partner_balances group by 1 order by 1;

\echo '## 11-1. 발주가 가리키는 없는 명세서 id (최대 15건)'
select p.id as "발주", r.data->>'linkedStatementId' as "가리키는 명세서", p.status as "상태"
from erp.purchase_orders p join raw.docs r on r.id = p.id and r.collection = 'purchaseOrders'
where p.voucher_id is null and coalesce(r.data->>'linkedStatementId', '') <> ''
limit 15;

\echo '## 10-1. 전표 종류별 건수·금액'
select legacy_collection as "원본", kind as "종류", count(*) as "건수", round(sum(amount)) as "금액 합계"
from erp.vouchers group by 1, 2 order by 1, 3 desc;

\echo '## 11. 비워 둔 참조 (원본에는 값이 있었는데 대상이 없음)'
select '전표 → 거래처' as "참조", count(*) as "건수" from erp.vouchers v
  join raw.docs r on r.id = v.id and r.collection = v.legacy_collection
  where v.partner_id is null and coalesce(r.data->>'partnerId', '') <> ''
union all select '전표 → 주문', count(*) from erp.vouchers v
  join raw.docs r on r.id = v.id and r.collection = v.legacy_collection
  where v.order_id is null and coalesce(r.data->>'orderId', '') <> ''
union all select '전표 줄 → 품목', count(*) from erp.voucher_lines l
  join erp.vouchers v on v.id = l.voucher_id
  join raw.docs r on r.id = v.id and r.collection = 'issuedStatements'
  where l.item_id is null and coalesce(r.data->'items'->(l.line_no - 1)->>'itemId', '') <> ''
union all select '발주 → 명세서', count(*) from erp.purchase_orders p
  join raw.docs r on r.id = p.id and r.collection = 'purchaseOrders'
  where p.voucher_id is null and coalesce(r.data->>'linkedStatementId', '') <> ''
union all select '휴가 → 직원', count(*) from erp.leave_requests where employee_id is null
union all select '급여 줄 → 직원', count(*) from erp.payroll_lines where employee_id is null
union all select '서류 → 분류', count(*) from erp.files where category_id is null;

\echo '## 12. 주문 합계 대조: 주문 totalAmount ≠ 줄(수량×단가) 합'
select count(*) filter (where abs(coalesce(o.total_amount, 0) - coalesce(l.s, 0)) >= 1) as "안 맞는 주문",
       count(*) as "주문 수"
from erp.orders o
left join (select order_id, sum(erp.js_round(coalesce(qty, 0) * coalesce(price, 0))) as s from erp.order_lines group by 1) l on l.order_id = o.id;

\echo '## 13. 미결 명세서 (반제 후 남은 돈) 회사별'
select company_id as "회사", side as "구분", count(*) filter (where open > 0) as "미결 건수", round(sum(open)) as "미결 합계"
from erp.open_items group by 1, 2 order by 1, 2;

\echo '## 14. 출고했는데 명세서 안 낸 주문(확인사항) / 묶은 명세서로 이어진 주문'
select (select count(*) from erp.unbilled_orders) as "확인사항에 뜨는 수",
       (select count(*) from erp.orders where shipped_at is not null and voucher_id is null and not accounting_excluded) as "출고+명세서 없음(옛 주문 포함)",
       (select count(distinct o.id) from erp.orders o join raw.docs s on s.collection = 'issuedStatements' and s.id = o.voucher_id
         where coalesce(s.data->>'orderId', '') ~ '[,[:space:]]') as "묶은 명세서로 이어진 주문";
