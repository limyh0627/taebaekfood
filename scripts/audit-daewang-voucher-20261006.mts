import { adminDb } from './_admin.mts';

const db = adminDb();
const [partners, statements, payments, settlements, orders] = await Promise.all([
  db.collection('partners').get(), db.collection('issuedStatements').get(), db.collection('cashEntries').get(),
  db.collection('settlements').get(), db.collection('orders').get(),
]);
const found = partners.docs.filter(doc => String(doc.get('name') ?? '').includes('대왕푸드'));
const ids = new Set(found.map(doc => doc.id));
console.log(JSON.stringify({
  partners: found.map(doc => ({ id: doc.id, name: doc.get('name'), companyId: doc.get('companyId') })),
  statements: statements.docs.filter(doc => ids.has(String(doc.get('partnerId') ?? '')) &&
    String(doc.get('tradeDate') ?? doc.get('issuedAt') ?? '').startsWith('2026-10-06'))
    .map(doc => ({ id: doc.id, updateTime: doc.updateTime.toDate().toISOString(), partnerId: doc.get('partnerId'), companyId: doc.get('companyId'),
      docNo: doc.get('docNo'), tradeDate: doc.get('tradeDate'), issuedAt: doc.get('issuedAt'), type: doc.get('type'),
      status: doc.get('status'), orderId: doc.get('orderId'), totalAmount: doc.get('totalAmount'),
      issueOperationId: doc.get('issueOperationId'), issuePayloadHashPresent: !!doc.get('issuePayloadHash'), mutationRevision: doc.get('mutationRevision'),
      lines: (doc.get('items') ?? []).map((line: Record<string, unknown>) => ({ accountCode: line.accountCode, side: line.side, total: line.total, itemId: line.itemId })) })),
  payments: payments.docs.filter(doc => ids.has(String(doc.get('partnerId') ?? '')) &&
    String(doc.get('date') ?? '').startsWith('2026-10-06'))
    .map(doc => ({ id: doc.id, date: doc.get('date'), amount: doc.get('amount'), accountCode: doc.get('accountCode') })),
  settlements: settlements.docs.filter(doc => doc.get('statementId') === 'stmt-1791250576381')
    .map(doc => ({ id: doc.id, amount: doc.get('amount'), cashEntryId: doc.get('cashEntryId') })),
  linkedOrders: orders.docs.filter(doc => String(doc.get('linkedStatementId') ?? '') === 'stmt-1791250576381'
    || ['ORD-1791191771781', 'ORD-1791156569696'].includes(doc.id))
    .map(doc => ({ id: doc.id, status: doc.get('status'), linkedStatementId: doc.get('linkedStatementId'), totalAmount: doc.get('totalAmount'), items: (doc.get('items') ?? []).length })),
}, null, 2));
