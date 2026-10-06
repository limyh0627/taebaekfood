import { adminDb } from './_admin.mts';
const db = adminDb();
const [gate, accounts, statements, cash, templates] = await Promise.all([
  db.doc('appMeta/releaseCutover').get(),
  db.collection('accountCodes').where('companyId','==','punghoe').get(),
  db.collection('issuedStatements').where('companyId','==','punghoe').get(),
  db.collection('cashEntries').where('companyId','==','punghoe').get(),
  db.collection('fixedCostTemplates').where('companyId','==','punghoe').get(),
]);
const rows = [...statements.docs, ...cash.docs].filter(doc => {
  const d = doc.data();
  return (d.tradeDate ?? d.date) === '2026-09-30' || JSON.stringify([d.memo,d.note,d.partnerName,d.items]).includes('급여');
}).map(doc=>({path:doc.ref.path,...doc.data()}));
console.log(JSON.stringify({gate:gate.data(),accounts:accounts.docs.map(d=>({id:d.id,...d.data()})).filter(d=>/급여|임금|미지급/.test(JSON.stringify(d))),salaryTemplates:templates.docs.map(d=>({id:d.id,...d.data()})).filter(d=>/급여/.test(JSON.stringify(d))),existing:rows},null,2));
