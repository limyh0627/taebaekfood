/** 사용자 승인: 태백 완제품/수량 로트의 합계를 현재 숫자 재고에 맞춘다. 실측·생산 이력을 만들지 않는다. */
import { adminDb } from './_admin.mts';
import { anchorLotsByQty } from '../src/shared/lotAnchor';
import { lotQtyRemaining } from '../src/shared/lotUtils';
import { holdsUnitStock, isBulkItem } from '../src/shared/itemTaxonomy';
import { kgPerStockUnit } from '../src/shared/orderUnits';
import { buildBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex } from '../src/shared/packIndex';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import type { Item } from '../src/shared/types';
const db = adminDb(), base = 'outputs/production-lot-stock-20261007/', path = base + 'plan.json';
const apply = process.argv.includes('--apply'), undo = process.argv.includes('--undo'); assert(!(apply && undo));
const clean = (data: any) => JSON.parse(JSON.stringify(data));
mkdirSync(base, { recursive: true });
if (undo) {
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  await db.runTransaction(async tx => {
    const refs = saved.rows.map((row: any) => db.collection('items').doc(row.id));
    const snaps = await Promise.all(refs.map((ref: any) => tx.get(ref)));
    saved.rows.forEach((row: any, i: number) => assert.deepStrictEqual(snaps[i].data(), { ...row.before, ...row.patch }));
    saved.rows.forEach((row: any, i: number) => tx.set(refs[i], row.before));
  });
  console.log('정정 원본 복원 완료'); process.exit(0);
}
if (!apply) {
  assert(!existsSync(base + 'verification.json'), '이미 적용한 정정은 다시 계획하지 않습니다.');
  const [snapshot, bom] = await Promise.all([db.collection('items').get(), db.collection('item_bom').get()]);
  const items = snapshot.docs.map(s => ({ ...s.data(), id: s.id })) as Item[];
  const inputs = { bom: buildBomIndex(items, bom.docs.map(s => s.data()) as any), pack: buildPackIndex([]) };
  const now = new Date().toISOString(), date = now.slice(0, 10), rows: any[] = [], skipped: any[] = [];
  for (const snap of snapshot.docs) {
    const before = snap.data(), item = { ...before, id: snap.id } as Item;
    if (item.companyId !== 'taebaek' || before.archived || isBulkItem(item)) continue;
    const lots = Array.isArray(before.lots) ? before.lots : [];
    if (!holdsUnitStock(item) && !lots.some((lot: any) => lot.qtyRemaining != null)) continue;
    const stock = Number(before.stock ?? 0), sum = lotQtyRemaining(lots);
    if (!Number.isFinite(stock) || stock < 0) { skipped.push({ id: snap.id, name: item.name, stock, reason: '음수/잘못된 숫자 재고는 자동 목표로 쓰지 않음' }); continue; }
    if (Math.abs(stock - sum) < 0.0001) continue;
    const operationId = 'user-lot-stock-reconciliation-20261007-' + snap.id;
    const anchors = Array.isArray(before.stocktakeAnchors) ? before.stocktakeAnchors : [];
    assert(!anchors.some((a: any) => a.id === operationId));
    const unitKg = lots.find((lot: any) => Number(lot.unitKg) > 0)?.unitKg ?? kgPerStockUnit(item, id => items.find(i => i.id === id), inputs) ?? 0;
    try {
      const anchored = anchorLotsByQty({ lots, targetQty: stock, unitKg, det: { id: 'anchor-' + operationId, createdAt: now, receivedDate: date } });
      assert(Math.abs(lotQtyRemaining(anchored.lots) - stock) < 0.0001);
      const patch = clean({ lots: anchored.lots, stocktakeAnchors: [...anchors, { id: operationId, date, createdAt: now, targetQty: stock, beforeQty: sum, deltaQty: anchored.deltaQty,
        reason: '사용자 승인: 숫자 재고 기준 로트 정합성 정정. 실측 또는 과거 생산 증명이 아님.' }] });
      rows.push({ id: snap.id, name: item.name, stock, lotBefore: sum, delta: anchored.deltaQty, before, version: snap.updateTime, patch });
    } catch (error) { skipped.push({ id: snap.id, name: item.name, stock, lotBefore: sum, reason: String(error) }); }
  }
  assert(rows.length < 200);
  writeFileSync(path, JSON.stringify({ project: 'taebaek-3abe4', companyId: 'taebaek', plannedAt: now, rows, skipped }, null, 2));
  console.log(JSON.stringify({ planned: rows.length, rows: rows.map(({ id, name, stock, lotBefore, delta }) => ({ id, name, stock, lotBefore, delta })), skipped }, null, 2));
  process.exit(0);
}
assert(!existsSync(base + 'verification.json'), '이미 완료한 정정입니다.');
const saved = JSON.parse(readFileSync(path, 'utf8')); assert.equal(saved.project, 'taebaek-3abe4'); assert.equal(saved.companyId, 'taebaek');
await db.runTransaction(async tx => {
  const refs = saved.rows.map((row: any) => db.collection('items').doc(row.id));
  const snapshots = await Promise.all(refs.map((ref: any) => tx.get(ref)));
  saved.rows.forEach((row: any, i: number) => { const snap = snapshots[i]; assert.deepStrictEqual(snap.data(), row.before); assert.equal(snap.updateTime?.seconds, row.version._seconds); assert.equal(snap.updateTime?.nanoseconds, row.version._nanoseconds); assert.equal(row.before.companyId, 'taebaek'); });
  saved.rows.forEach((row: any, i: number) => tx.update(refs[i], row.patch));
});
for (const row of saved.rows) { const current = (await db.collection('items').doc(row.id).get()).data(); assert.deepStrictEqual(current, { ...row.before, ...row.patch }); assert.equal(current!.stock, row.stock); assert(Math.abs(lotQtyRemaining(current!.lots) - row.stock) < 0.0001); }
writeFileSync(base + 'verification.json', JSON.stringify({ verifiedAt: new Date().toISOString(), changed: saved.rows.length, stockChanges: 0, fields: ['lots', 'stocktakeAnchors'], skipped: saved.skipped, verified: true }, null, 2));
console.log('로트 정정 ' + saved.rows.length + '품목 재조회 검증 완료. 숫자 재고 변경 0');
