import { adminDb } from './_admin.mts';
const db = adminDb();
const rows = await db.collection('issuedStatements').get();
console.log(JSON.stringify(rows.docs.filter(doc => {
  const row = doc.data();
  return JSON.stringify([row.memo, row.partnerName, ...(row.items ?? []).map((item: Record<string, unknown>) => item.name)]).includes('상여금');
}).map(doc => {
  const row = doc.data();
  return { id: doc.id, docNo: row.docNo, tradeDate: row.tradeDate, companyId: row.companyId,
    type: row.type, partnerId: row.partnerId, partnerName: row.partnerName, totalAmount: row.totalAmount,
    items: (row.items ?? []).map((item: Record<string, unknown>) => ({ name: item.name, accountCode: item.accountCode, side: item.side, total: item.total })) };
}), null, 2));
