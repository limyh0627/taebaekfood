import { adminDb } from './_admin.mts';

const db = adminDb();
const [partners, statements, cash, opening] = await Promise.all([
  db.collection('partners').get(), db.collection('issuedStatements').get(),
  db.collection('cashEntries').get(), db.doc('openingBalances/main').get(),
]);
const matches = partners.docs.filter(doc => /논두렁.*(선릉|선릉.*논두렁)/.test(String(doc.get('name') ?? '')));
const ids = new Set(matches.map(doc => doc.id));
console.log(JSON.stringify({
  opening: { date: opening.get('date'), arAggregate: opening.get('amounts')?.['108'], hasPartnerOpening: opening.get('hasPartnerOpening') },
  partners: matches.map(doc => ({ id: doc.id, name: doc.get('name'), companyId: doc.get('companyId') })),
  statements: statements.docs.filter(doc => ids.has(String(doc.get('partnerId') ?? '')) || /논두렁.*선릉/.test(String(doc.get('partnerName') ?? '')))
    .map(doc => ({ id: doc.id, partnerId: doc.get('partnerId'), partnerName: doc.get('partnerName'), companyId: doc.get('companyId'),
      docNo: doc.get('docNo'), tradeDate: doc.get('tradeDate'), issuedAt: doc.get('issuedAt'), type: doc.get('type'), totalAmount: doc.get('totalAmount'),
      lines: (doc.get('items') ?? []).map((line: Record<string, unknown>) => ({ accountCode: line.accountCode, side: line.side, total: line.total })) }))
    .sort((a, b) => String(a.tradeDate ?? a.issuedAt).localeCompare(String(b.tradeDate ?? b.issuedAt))),
  cash: cash.docs.filter(doc => ids.has(String(doc.get('partnerId') ?? '')) || /논두렁.*선릉/.test(String(doc.get('partnerName') ?? '')))
    .map(doc => ({ id: doc.id, partnerId: doc.get('partnerId'), date: doc.get('date'), amount: doc.get('amount'), accountCode: doc.get('accountCode'), type: doc.get('type') })),
}, null, 2));
