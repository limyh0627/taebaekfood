import { adminDb } from './_admin.mts';
const db = adminDb();
const cash = await db.collection('cashEntries').where('date','==','2026-09-30').get();
const matches = cash.docs.filter(d => Number(d.get('amount')) === 1632579);
for(const doc of matches) console.log(JSON.stringify({id:doc.id,...doc.data()},null,2));
