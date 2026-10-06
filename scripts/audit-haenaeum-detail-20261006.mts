import { adminDb } from './_admin.mts';
const db=adminDb();
const [settlements,cash,acct]=await Promise.all([db.collection('settlements').get(),db.collection('cashEntries').where('date','==','2026-09-10').get(),db.doc('cashAccounts/cashacct-temp-main').get()]);
const ids=['stmt-1785763230282','stmt-1789930459714','stmt-open-C078-매출'];
console.log(JSON.stringify({settlements:settlements.docs.filter(d=>ids.includes(d.get('statementId'))).map(d=>({id:d.id,...d.data()})),dateCash:cash.docs.map(d=>({id:d.id,docNo:d.get('docNo'),amount:d.get('amount'),partnerId:d.get('partnerId')})),account:acct.data()},null,2));
