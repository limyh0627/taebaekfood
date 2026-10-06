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
const [items, links] = await Promise.all([
  db.collection('items').select('companyId', 'partnerIds', 'isSmartStore').get(),
  db.collection('partner_item').select('companyId', 'itemId', 'partnerId', 'Direction').get(),
]);
const saleLinks = new Set(links.docs.filter(doc => doc.get('Direction') !== 'in')
  .map(doc => JSON.stringify([doc.get('companyId'), doc.get('itemId'), doc.get('partnerId')])));
const connectionAudit: Record<string, { legacyConnections: number; missingSaleLinks: number; smartStoreMarkers: number; markersWithoutNewFlag: number; malformedLists: number }> = {};
for (const doc of items.docs) {
  const company = String(doc.get('companyId') || '(missing)');
  const counts = connectionAudit[company] ??= { legacyConnections: 0, missingSaleLinks: 0, smartStoreMarkers: 0, markersWithoutNewFlag: 0, malformedLists: 0 };
  const ids = doc.get('partnerIds');
  if (ids == null) continue;
  if (!Array.isArray(ids)) { counts.malformedLists++; continue; }
  for (const id of new Set(ids)) {
    if (id === 'SMARTSTORE') {
      counts.smartStoreMarkers++;
      if (doc.get('isSmartStore') !== true) counts.markersWithoutNewFlag++;
    } else {
      counts.legacyConnections++;
      if (!saleLinks.has(JSON.stringify([doc.get('companyId'), doc.id, id]))) counts.missingSaleLinks++;
    }
  }
}
const result = { project: db.projectId, auditedAt: new Date().toISOString(), readOnly: true, rows, connectionAudit };
mkdirSync('outputs', { recursive: true });
writeFileSync('outputs/deprecated-field-counts.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
