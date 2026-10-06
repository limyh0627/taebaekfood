import { adminDb } from './_admin.mts';
import { buildJournals } from '../src/shared/buildJournals';
import commandModule from '../../todo032-035-integration-candidate/functions/lib/partnerPaymentCommand.js';
import planModule from '../../todo032-035-integration-candidate/functions/lib/partnerPaymentPlan.js';
const { claimFromStatement, cashFromEntry } = commandModule;
const { planPartnerPayment } = planModule;
const db = adminDb();
const partners = await db.collection('partners').get();
const targets = partners.docs.filter(d => d.id === 'c-1779251336139');
for (const partner of targets) {
  const result: Record<string, unknown> = { partner: { id: partner.id, name: partner.get('name') } };
  for (const collection of ['issuedStatements', 'cashEntries', 'settlements', 'returnApplications']) {
    const rows = await db.collection(collection).where('partnerId', '==', partner.id).get();
    result[collection] = rows.docs.map(d => { const r = d.data(); return { id: d.id, date: r.tradeDate ?? r.date, docNo: r.docNo, totalAmount:r.totalAmount, amount:r.amount, type:r.type, dir:r.dir, lines:r.lines, items:r.items?.map((i: any) => ({name:i.name, qty:i.qty, total:i.total, supply:i.supply, tax:i.tax, accountCode:i.accountCode})), totalTax:r.totalTax, status:r.status, originalStatementId:r.originalStatementId }; });
  }
  console.log(JSON.stringify(result));
  const [statements, cash] = await Promise.all(['issuedStatements','cashEntries'].map(c => db.collection(c).where('partnerId','==',partner.id).get()));
  const ledger = buildJournals({ statements: statements.docs.map(d => ({id:d.id,...d.data()})) as any, cashEntries:cash.docs.map(d=>({id:d.id,...d.data()})) as any, accounts:[] });
  console.log(JSON.stringify({skipped:ledger.skipped, payable:ledger.entries.flatMap(e=>e.lines).filter(l=>l.accountCode==='251').reduce((sum,l)=>sum+l.credit-l.debit,0), returnJournal:ledger.entries.find(e=>e.sourceId==='stmt-1787551517911')}));
  console.log(JSON.stringify(statements.docs.map(d=>({id:d.id,updated:d.updateTime.toDate().toISOString()}))));
  console.log(JSON.stringify(planPartnerPayment({companyId:'taebaek',partnerId:partner.id,direction:'출금',amount:7603640,pin:false,allocations:[],claims:statements.docs.map(d=>claimFromStatement(d.id,d.data())).filter(Boolean) as any,cashEntries:cash.docs.filter(d=>!d.id.startsWith('partner-payment-')).map(d=>cashFromEntry(d.id,d.data())).filter(Boolean) as any,settlements:[]})));
}
