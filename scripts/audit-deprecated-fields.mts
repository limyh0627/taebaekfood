import { adminDb } from './_admin.mts';
import { mkdirSync, writeFileSync } from 'node:fs';

// Read-only counts: no document IDs, names, or field values leave the database.
const db = adminDb();
const targets = {
  items: ['itemType', 'partnerId', 'partnerIds', 'defaultBoxConfig', 'partnerBoxConfigs', 'unpackTo', 'lotsAreTotal'],
  fixedCostTemplates: ['postMode'],
  pallets: ['inUse'],
};
const rows = await Promise.all(Object.entries(targets).map(async ([collection, fields]) => {
  const snapshot = await db.collection(collection).select('companyId', ...fields).get();
  const companies: Record<string, { documents: number; fields: Record<string, number> }> = {};
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const company = String(data.companyId || '(missing)');
    const counts = companies[company] ??= { documents: 0, fields: Object.fromEntries(fields.map(field => [field, 0])) };
    counts.documents++;
    for (const field of fields) if (Object.hasOwn(data, field)) counts.fields[field]++;
  }
  return { collection, companies };
}));
const result = { project: db.projectId, auditedAt: new Date().toISOString(), readOnly: true, rows };
mkdirSync('outputs', { recursive: true });
writeFileSync('outputs/deprecated-field-counts.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
