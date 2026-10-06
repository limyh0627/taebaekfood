import { FieldValue } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync } from 'node:fs';
import { adminDb } from './_admin.mts';

const apply = process.argv.includes('--apply');
const db = adminDb();
if (db.projectId !== 'taebaek-3abe4') throw new Error('운영 프로젝트가 다릅니다.');
const [items, pack] = await Promise.all([
  db.collection('items').get(), db.collection('item_pack').doc('pack-f6').get(),
]);
const subTypes = new Set(['submaterial', 'label', 'cap', 'container', 'box', 'tape']);
const lotDocs = items.docs.filter(doc => subTypes.has(String(doc.get('type'))) && Array.isArray(doc.get('lots')) && doc.get('lots').length > 0);
const oldBox = items.docs.find(doc => doc.id === 'f6' && doc.get('defaultBoxConfig') != null);
if (oldBox && (pack.get('item_id') !== 'f6' || Number(pack.get('units_per_box')) !== 12))
  throw new Error('f6 포장 환산표가 예상값과 달라 중단합니다.');
const targets = [...lotDocs, ...(oldBox && !lotDocs.some(doc => doc.id === oldBox.id) ? [oldBox] : [])];
const preview = { project: db.projectId, lotItems: lotDocs.length, lots: lotDocs.reduce((n, doc) => n + doc.get('lots').length, 0),
  legacyBox: oldBox ? { id: oldBox.id, oldUnits: oldBox.get('defaultBoxConfig')?.unitsPerBox, packUnits: pack.get('units_per_box') } : null,
  stockMismatches: lotDocs.filter(doc => Number(doc.get('stock') || 0) !== doc.get('lots').reduce((n: number, lot: { qtyRemaining?: number }) => n + Number(lot.qtyRemaining || 0), 0)).length };
console.log(JSON.stringify(preview, null, 2));
if (!apply || targets.length === 0) process.exit(0);

const backupPath = `outputs/submaterial-lot-pack-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
mkdirSync('outputs', { recursive: true });
writeFileSync(backupPath, JSON.stringify({ at: new Date().toISOString(), preview,
  documents: targets.map(doc => ({ id: doc.id, updateTime: doc.updateTime?.toDate().toISOString(), data: doc.data() })) }, null, 2));

await db.runTransaction(async tx => {
  const fresh = await Promise.all(targets.map(doc => tx.get(doc.ref)));
  fresh.forEach((doc, i) => {
    if (!doc.exists || doc.updateTime?.isEqual(targets[i].updateTime!) !== true)
      throw new Error(`동시 변경이 감지되어 중단했습니다: ${targets[i].id}`);
  });
  fresh.forEach(doc => {
    const patch: Record<string, unknown> = {};
    if (subTypes.has(String(doc.get('type'))) && Array.isArray(doc.get('lots')) && doc.get('lots').length > 0) patch.lots = FieldValue.delete();
    if (doc.id === 'f6' && doc.get('defaultBoxConfig') != null) patch.defaultBoxConfig = FieldValue.delete();
    if (Object.keys(patch).length) tx.update(doc.ref, patch);
  });
});

const verify = await Promise.all(targets.map(doc => doc.ref.get()));
const failures = verify.filter(doc => (subTypes.has(String(doc.get('type'))) && doc.get('lots') != null)
  || (doc.id === 'f6' && doc.get('defaultBoxConfig') != null)
  || Number(doc.get('stock') || 0) !== Number(targets.find(before => before.id === doc.id)?.get('stock') || 0));
console.log(JSON.stringify({ backupPath, changed: targets.length, verified: verify.length - failures.length, failures: failures.map(doc => doc.id) }, null, 2));
if (failures.length) process.exitCode = 1;
