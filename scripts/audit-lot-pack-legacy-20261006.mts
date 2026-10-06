import { adminDb } from './_admin.mts';

const db = adminDb();
const [itemSnap, packSnap, gateSnap] = await Promise.all([
  db.collection('items').get(),
  db.collection('item_pack').get(),
  db.collection('appMeta').doc('releaseCutover').get(),
]);
const items = itemSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
const packs = packSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
const packByItem = new Map(packs.map(pack => [String(pack.item_id), pack]));
const submaterialTypes = new Set(['submaterial', 'label', 'cap', 'container', 'box', 'tape']);
const submaterialLots = items
  .filter(item => submaterialTypes.has(String(item.type)) && Array.isArray(item.lots) && item.lots.length > 0)
  .map(item => ({
    id: item.id, name: item.name, type: item.type, category: item.category,
    stock: item.stock, lotCount: item.lots.length,
    activeLotCount: item.lots.filter((lot: { status?: string }) => lot.status !== 'depleted').length,
    activeLotQuantity: item.lots.filter((lot: { status?: string }) => lot.status !== 'depleted')
      .reduce((sum: number, lot: { qtyRemaining?: number }) => sum + Number(lot.qtyRemaining || 0), 0),
  }));
const legacyBox = items.filter(item => item.defaultBoxConfig != null || item.boxSize != null)
  .map(item => ({
    id: item.id, name: item.name, type: item.type, stock: item.stock,
    defaultBoxConfig: item.defaultBoxConfig, boxSize: item.boxSize,
    pack: packByItem.get(item.id) ?? null,
  }));
console.log(JSON.stringify({ project: db.projectId, releaseGate: {
  status: gateSnap.get('status') ?? null, releaseId: gateSnap.get('releaseId') ?? null,
  oldWritersBlocked: gateSnap.get('oldWritersBlocked') ?? null,
}, itemCount: items.length, packCount: packs.length,
  submaterialLotItemCount: submaterialLots.length,
  submaterialLotCount: submaterialLots.reduce((sum, item) => sum + item.lotCount, 0),
  stockMismatchCount: submaterialLots.filter(item => item.stock !== item.activeLotQuantity).length,
  legacyBox }, null, 2));
