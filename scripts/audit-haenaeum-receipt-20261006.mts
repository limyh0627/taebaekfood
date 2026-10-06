import { adminDb } from './_admin.mts';
const db = adminDb();
const partners = await db.collection('partners').get();
const matches = partners.docs.filter(doc => /해내음/.test(String(doc.get('name') ?? '')));
const ids = matches.map(doc => doc.id);
const [cash, statements, accounts] = await Promise.all([
  db.collection('cashEntries').get(), db.collection('issuedStatements').get(), db.collection('cashAccounts').get(),
]);
console.log(JSON.stringify({
  partners: matches.map(doc => ({ id: doc.id, ...doc.data() })),
  cash: cash.docs.filter(doc => ids.includes(doc.get('partnerId'))).map(doc => ({ id: doc.id, ...doc.data() })),
  statements: statements.docs.filter(doc => ids.includes(doc.get('partnerId'))).map(doc => ({ id: doc.id, docNo: doc.get('docNo'), type: doc.get('type'), date: doc.get('tradeDate'), amount: doc.get('totalAmount') })),
  accounts: accounts.docs.map(doc => ({ id: doc.id, name: doc.get('name'), companyId: doc.get('companyId'), active: doc.get('active'), archived: doc.get('archived'), accountCode: doc.get('accountCode') })),
}, null, 2));
