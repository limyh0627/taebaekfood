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

\echo '## 10. 전표 금액 대조: 명세서 합계 ≠ 줄 합계 / 자금 전표 금액 ≠ 줄 합계'
select v.legacy_collection as "원본", count(*) as "안 맞는 전표", round(sum(abs(v.amount - l.s))) as "차이 합계(원)"
from erp.vouchers v
join (select voucher_id, sum(amount) as s from erp.voucher_lines group by 1) l on l.voucher_id = v.id
where abs(coalesce(v.amount, 0) - coalesce(l.s, 0)) >= 1
group by 1;

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
