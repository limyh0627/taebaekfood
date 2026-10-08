import * as admin from 'firebase-admin';
import { readOemCounter } from './newScopeCounter';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertReleaseActive, releaseGateRef } from './releaseGate';

type Row = Record<string, any>;
type Input = {
  poId: string;
  operationId: string;
  date: string;
  returns: { itemId: string; qty: number }[];
  bulk?: { material: string; kg: number }[];
  unitPricePerKg?: number;
  releaseId: string;
};
type Result = { status: 'applied' | 'duplicate'; receivedKg: number; loss: number; lotNos: Record<string, string> };
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const invalid = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const ownCompany = (row: Row) => row.companyId ?? 'taebaek';
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const dateOk = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const idOk = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,160}$/.test(value);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const lotCounterId = (companyId: string, date: string, material: string) =>
  `oemLotSequence_${companyId}_${date.replace(/-/g, '')}_${encodeURIComponent(material)}`;
const packageKg = (value: unknown) => {
  const match = /([\d.]+)\s*kg/i.exec(String(value ?? ''));
  return match ? Number(match[1]) : 0;
};
const specCount = (value: unknown) => {
  const match = /[*x×]\s*([\d.]+)/i.exec(String(value ?? ''));
  return match ? Number(match[1]) : 1;
};
const productKg = (item: Row, boxed: boolean) => {
  const kg = item.packageKg || (packageKg(item.spec) || packageKg(item.name)) * (boxed ? specCount(item.spec) : 1);
  return typeof kg === 'number' && Number.isFinite(kg) && kg > 0 ? kg : fail('OEM 품목의 단위중량이 없습니다.');
};
const prune = (lots: Row[]) => lots.filter(lot => Number(lot.qtyRemaining ?? 0) > 0 || lot.status !== 'depleted');

/** Finished-goods-only OEM intake. Every persisted value is derived from transaction reads. */
export async function receiveOemFinishedGoods(db: admin.firestore.Firestore, companyId: string, input: Input): Promise<Result> {
  if (!input || !idOk(input.poId) || !idOk(input.operationId) || !idOk(input.releaseId)
    || input.operationId !== `oem-receive:${input.poId}` || !dateOk(input.date)
    || !Array.isArray(input.returns) || input.returns.length === 0 || input.returns.length > 100
    || input.returns.some(row => !idOk(row?.itemId) || typeof row.qty !== 'number'
      || !Number.isFinite(row.qty) || row.qty <= 0 || round3(row.qty) !== row.qty)
    || (input.unitPricePerKg !== undefined && (!Number.isSafeInteger(input.unitPricePerKg) || input.unitPricePerKg <= 0))) {
    invalid('OEM 입고 요청이 잘못되었습니다.');
  }
  // The old engine wrote bulk raw lots in a separate transaction. Never accept that partial path here.
  if (input.bulk?.length) fail('벌크 OEM 입고는 단일 거래 명령이 아직 지원하지 않습니다.');
  const quantityByItem = new Map<string, number>();
  for (const row of input.returns) quantityByItem.set(row.itemId, round3((quantityByItem.get(row.itemId) ?? 0) + row.qty));
  const lines = [...quantityByItem].sort(([a], [b]) => a.localeCompare(b));
  const perKg = input.unitPricePerKg ?? 500;
  const fingerprint = hash([companyId, input.poId, input.operationId, input.date, lines, perKg]);
  const poRef = db.collection('purchaseOrders').doc(input.poId);
  const feeRef = db.collection('adjustmentRequests').doc(`OEMFEE-${input.poId}`);
  const operationRef = db.collection('oemReceiptOperations').doc(input.operationId);
  const itemRefs = lines.map(([id]) => db.collection('items').doc(id));
  return db.runTransaction(async tx => {
    const [gate, poSnap, feeSnap, operationSnap, ...items] = await Promise.all([
      tx.get(releaseGateRef(db)), tx.get(poRef), tx.get(feeRef), tx.get(operationRef),
      ...itemRefs.map(ref => tx.get(ref)),
    ]);
    assertReleaseActive(gate, input.releaseId);
    // 과거 번호 범위는 감사·승인된 시작일 이전에 재사용할 수 없다.
    const lotCutoverDate = gate.data()?.oemLotCutoverDate;
    if (!dateOk(lotCutoverDate) || input.date < lotCutoverDate) fail('OEM_LOT_DATE_BEFORE_CUTOVER');
    if (!poSnap.exists) fail('OEM 배치가 없습니다.');
    const po = poSnap.data()!;
    if (po.oemCancelledAt || po.oemCancelOperationId) fail('취소된 OEM 발주는 입고할 수 없습니다.');
    if (ownCompany(po) !== companyId || po.poType !== 'oem') fail('다른 회사이거나 OEM 배치가 아닙니다.');
    const partnerId = po.oemPartnerId ?? po.partnerId;
    if (!idOk(partnerId)) fail('OEM 거래처가 없습니다.');
    const partner = await tx.get(db.collection('partners').doc(partnerId));
    if (!partner.exists || ownCompany(partner.data()!) !== companyId) fail('OEM 거래처의 회사가 다릅니다.');
    if (items.some((snap, index) => !snap.exists || ownCompany(snap.data()!) !== companyId
      || snap.id !== lines[index]![0] || snap.data()!.procureType !== '임가공')) fail('현재 회사의 OEM 완제품이 아닙니다.');

    // Persisted BOM, not a client-supplied material or lot, establishes the lot axis.
    const bomSnaps = await Promise.all(itemRefs.map(ref => tx.get(db.collection('item_bom').where('parent_id', '==', ref.id))));
    const childIds = [...new Set(bomSnaps.flatMap(snap => snap.docs.map(doc => doc.data().child_id as string)).filter(Boolean))];
    const childSnaps = await Promise.all(childIds.map(id => tx.get(db.collection('items').doc(id))));
    const children = new Map(childSnaps.filter(snap => snap.exists).map(snap => [snap.id, snap.data()!]));
    const keys = items.map(item => String(item.data()!.품목 || item.data()!.name || '').trim());
    // The legacy buildFormula scans all items for phantom names, independent of item_bom child IDs.
    // Read the same company inventory before writing so a missing BOM edge or /spec suffix cannot turn
    // a phantom ingredient into a finished-goods lot axis.
    const [formulaSnaps, allItemSnaps] = await Promise.all([
      Promise.all(keys.map(key => tx.get(db.collection('item_formula').where('parent_key', '==', key)))),
      tx.get(db.collection('items')),
    ]);
    const phantomMaterials = new Set(allItemSnaps.docs.filter(snap => {
      const candidate = snap.data();
      return ownCompany(candidate) === companyId && !!candidate.phantom;
    }).map(snap => String(snap.data().name ?? '').split('/')[0].trim()));
    const rows = items.map((itemSnap, index) => {
      const item = itemSnap.data()!;
      const qty = lines[index]![1];
      const finishedChildren = bomSnaps[index]!.docs.map(snap => snap.data())
        .filter(row => ['product', '완제품'].includes(children.get(row.child_id)?.type));
      const boxed = (finishedChildren.length === 1 && Number(finishedChildren[0].quantity ?? 1) > 1)
        || Number(item.unpackTo?.count ?? 0) > 1 || item.unit === '박스';
      const unitKg = productKg(item, boxed);
      const formulas = formulaSnaps[index]!.docs.map(snap => snap.data())
        .filter(formula => typeof formula.child_name === 'string' && formula.child_name
          && Number.isFinite(formula.ratio) && formula.ratio > 0);
      // A formula-free or phantom/mixed item needs the full legacy formula engine; do not guess its lot material.
      if (formulas.length !== formulaSnaps[index]!.size || formulas.length === 0
        || formulas.some(formula => formula.yield_rate != null && (!Number.isFinite(formula.yield_rate) || formula.yield_rate <= 0))) {
        fail('OEM 품목의 저장된 원료식이 없거나 잘못되었습니다.');
      }
      if (formulas.some(formula => phantomMaterials.has(formula.child_name))) {
        fail('팬텀 BOM의 OEM 입고는 아직 지원하지 않습니다.');
      }
      const material = [...formulas].sort((a, b) => (b.ratio * (b.yield_rate || 1)) - (a.ratio * (a.yield_rate || 1)))[0].child_name as string;
      const stock = Number(item.stock ?? 0);
      if (!Number.isFinite(stock) || stock < 0 || round3(stock) !== stock || !Array.isArray(item.lots ?? [])) fail('OEM 품목의 현재 재고·로트가 잘못되었습니다.');
      return { item, qty, unitKg, material, stock, itemRef: itemRefs[index]! };
    });
    const receivedKg = round3(rows.reduce((sum, row) => sum + row.qty * row.unitKg, 0));
    if (!(receivedKg > 0)) fail('OEM 입고 중량이 없습니다.');
    const total = Math.round(receivedKg * perKg);
    if (!Number.isSafeInteger(total) || total <= 0) fail('OEM 가공비 금액이 잘못되었습니다.');
    const sent = Array.isArray(po.oemSent) ? po.oemSent.reduce((sum: number, row: Row) => sum + Number(row.kg || 0), 0) : 0;
    if (!Number.isFinite(sent) || sent < 0) fail('OEM 출고 중량이 잘못되었습니다.');
    const loss = Math.max(0, round3(sent - receivedKg));
    const materials = [...new Set(rows.map(row => row.material))].sort();
    const counterRefs = materials.map(material => db.collection('appMeta').doc(lotCounterId(companyId, input.date, material)));
    const counterSnaps = await Promise.all(counterRefs.map(ref => tx.get(ref)));
    const counterStates = await Promise.all(counterSnaps.map((snap, index) =>
      readOemCounter(db, tx, snap, gate, companyId, input.date, materials[index])));
    if (counterStates.some((state, index) => state.companyId !== companyId
      || state.date !== input.date || state.material !== materials[index]
      || !Number.isSafeInteger(state.lastSequence) || state.lastSequence < 0)) {
      fail('OEM_LOT_COUNTER_NOT_INITIALIZED');
    }
    if (operationSnap.exists) {
      const saved = operationSnap.data()!;
      if (saved.companyId !== companyId || saved.fingerprint !== fingerprint
        || po.status !== 'received' || po.oemReceiptOperationId !== input.operationId
        || !feeSnap.exists || feeSnap.data()!.oemPoId !== input.poId
        || feeSnap.data()!.oemTotal !== total || feeSnap.data()!.oemFeePerKg !== perKg
        || po.oemReceivedKg !== receivedKg || po.oemFeePerKg !== perKg) fail('기존 OEM 입고와 재시도 내용이 다릅니다.');
      for (const row of rows) {
        const lot = (row.item.lots as Row[]).find(candidate => candidate.id === `lot-oem-${input.poId}-${row.itemRef.id}`);
        if (!lot || lot.lotNo !== saved.lotNos?.[row.itemRef.id] || lot.qtyIn !== row.qty
          || lot.material !== row.material) fail('기존 OEM 로트와 작업 기록이 다릅니다.');
      }
      return { status: 'duplicate', receivedKg, loss, lotNos: saved.lotNos };
    }
    if (po.status !== 'invoiced' || po.oemReceiptOperationId || feeSnap.exists) fail('이미 처리되었거나 입고할 수 없는 OEM 배치입니다.');
    const sequences = new Map(materials.map((material, index) => [material, counterStates[index].lastSequence as number]));
    const lotNos: Record<string, string> = {};
    for (const row of rows) {
      const sequence = sequences.get(row.material)! + 1;
      if (!Number.isSafeInteger(sequence)) fail('OEM 로트번호 범위를 초과했습니다.');
      sequences.set(row.material, sequence);
      const lotNo = `${input.date.replace(/-/g, '').slice(2)}-${String(sequence).padStart(2, '0')}`;
      lotNos[row.itemRef.id] = lotNo;
      const existingLots = row.item.lots as Row[] | undefined ?? [];
      const carry = existingLots.length || row.stock === 0 ? [] : [{
        id: `lot-carry-oem-${input.poId}-${row.itemRef.id}`, material: row.material,
        supplierName: '이월', qtyIn: row.stock, qtyRemaining: row.stock, unitKg: row.unitKg,
        kgIn: round3(row.stock * row.unitKg), kgRemaining: round3(row.stock * row.unitKg),
        receivedDate: input.date, status: 'active', createdAt: new Date().toISOString(),
      }];
      const lot = {
        id: `lot-oem-${input.poId}-${row.itemRef.id}`, material: row.material,
        supplierId: partnerId, supplierName: po.partnerName ?? partner.data()!.name ?? '외주',
        qtyIn: row.qty, qtyRemaining: row.qty, unitKg: row.unitKg,
        kgIn: round3(row.qty * row.unitKg), kgRemaining: round3(row.qty * row.unitKg),
        receivedDate: input.date, status: 'active', poId: input.poId, lotNo,
        createdAt: new Date().toISOString(),
      };
      if (existingLots.some(existing => existing.id === lot.id)) fail('기존 OEM 로트가 있어 정합성 확인이 필요합니다.');
      tx.update(row.itemRef, { stock: round3(row.stock + row.qty), lots: prune([...existingLots, ...carry, lot]) });
    }
    counterRefs.forEach((ref, index) => {
      const lastSequence = sequences.get(materials[index]!)!;
      if (counterSnaps[index].exists) tx.update(ref, { lastSequence });
      else tx.create(ref, { ...counterStates[index], lastSequence });
    });
    tx.update(poRef, { companyId, status: 'received', receivedAt: new Date().toISOString(),
      oemReceivedKg: receivedKg, oemFeePerKg: perKg, oemReceiptOperationId: input.operationId,
      items: rows.map(row => ({ itemId: row.itemRef.id, name: row.item.name, quantity: row.qty, unit: row.item.unit ?? '개' })) });
    tx.create(feeRef, { id: feeRef.id, companyId, itemId: input.poId,
      itemName: `외주가공비 — ${po.partnerName ?? ''}`, originalQuantity: receivedKg,
      requestedQuantity: receivedKg, type: 'oem_fee', unit: 'kg', oemPoId: input.poId,
      oemFeePerKg: perKg, oemTotal: total,
      reason: `${po.partnerName ?? ''} 가공비 ${receivedKg}kg × ${perKg}원 = ${total.toLocaleString()}원 — 전표 발행 필요`,
      status: 'pending', requestedAt: new Date().toISOString() });
    tx.create(operationRef, { companyId, poId: input.poId, date: input.date, materials, fingerprint, receivedKg, loss, lotNos,
      releaseId: input.releaseId, createdAt: new Date().toISOString() });
    return { status: 'applied', receivedKg, loss, lotNos };
  });
}

export const receiveOemFinishedGoodsCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe')) {
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  }
  return receiveOemFinishedGoods(admin.firestore(), companyId, request.data as Input);
});
