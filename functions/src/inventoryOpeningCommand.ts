import { advanceInventoryWriterProtocol } from './shared/inventoryWriterProtocol';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { inventoryOpeningStatement, calendarDay } from './shared/inventoryOpening';
import { anchorLotsByQty, stocktakeLotMaterial } from './shared/lotAnchor';
import { itemPackageKg, unpackStockComponent } from './shared/stockUnitMeasure';
import { isRawHolder } from './shared/rawHolder';
import { prepareRawCommand } from './shared/rawInventoryPrepare';
import { inventoryDocId, operationDocId, legacyOperationDocId, type RawInventoryCommand } from './shared/rawInventoryCore';
import { toLedgerDoc } from './shared/rawInventoryDocument';
import type { CompanyId } from './shared/rawLot';
import { assertReleaseActive, releaseGateRef } from './releaseGate';

type Row = Record<string, any>;
export type InventoryOpeningInput = { companyId: CompanyId; date: string; itemId: string; quantity: number; value: number; releaseId: string };
type Actor = {uid: string; token: Row} | undefined;
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const companyOf = (row: Row) => row.companyId ?? 'taebaek';
function fail(message: string): never {throw new HttpsError('failed-precondition', message);}
const snapshot = (row: admin.firestore.DocumentSnapshot) => ({exists: () => row.exists, data: () => row.data()});

/** 기초 재고·로트·원료 원장·146/375 전표는 하나의 서버 거래로 저장한다. */
export async function createInventoryOpening(db: admin.firestore.Firestore, actor: Actor, input: InventoryOpeningInput): Promise<'created'|'unchanged'> {
  if (!actor?.uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  if (actor.token.isAdmin !== true || !['taebaek','punghoe'].includes(actor.token.companyId) || actor.token.companyId !== input?.companyId) throw new HttpsError('permission-denied', '현재 회사 관리자만 기초 재고를 등록할 수 있습니다.');
  const {companyId, date, itemId, quantity, value} = input;
  if (typeof itemId !== 'string' || !itemId || itemId.includes('/') || !calendarDay(date) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(value) || value <= 0) fail('기초 재고 날짜·수량·평가금액을 확인하세요.');
  const itemRef = db.collection('items').doc(itemId), openingRef = db.collection('openingBalances').doc(companyId === 'taebaek' ? 'main' : 'main-punghoe');
  const voucherRef = db.collection('issuedStatements').doc(`opening-inventory-${companyId}-${itemId}`);
  const operationId = `opening-inventory:${companyId}:${itemId}`, recordedAt = new Date().toISOString();
  const command: RawInventoryCommand = {kind:'opening',operationId,companyId,rawItemId:itemId,materialSnapshot:'',effectiveAt:`${date}T00:00:00+09:00`,source:{type:'opening',id:itemId},kg:quantity};
  return db.runTransaction(async tx => {
    // 첫 읽기를 먼저 완료하여 SDK의 transaction 시작도 한 번으로 고정한다.
    const release = await tx.get(releaseGateRef(db));
    assertReleaseActive(release,input.releaseId);
    const itemSnap = await tx.get(itemRef);
    const [openingSnap, voucherSnap] = await Promise.all([tx.get(openingRef),tx.get(voucherRef)]);
    if (!itemSnap.exists) fail('기초 재고 품목이 없습니다.');
    const item = {...itemSnap.data()!,id:itemSnap.id} as Row & {id:string;name:string};
    if (companyOf(item) !== companyId || item.type === 'service' || item.archived || item.phantom) fail('현재 회사의 실물 품목만 기초 재고로 등록할 수 있습니다.');
    if (Math.abs(quantity - Math.round(quantity * 1000) / 1000) > 1e-9 || (!isRawHolder(item) && !Number.isInteger(quantity))) fail('기초 재고 수량은 개수 품목은 정수, 벌크 원료는 소수 셋째 자리까지 입력하세요.');
    const voucher = inventoryOpeningStatement(companyId,date,item,quantity,value);
    if (voucherSnap.exists) {
      const saved = voucherSnap.data()!;
      if (saved.companyId === companyId && saved.tradeDate === date && saved.totalAmount === value && saved.openingQuantity === quantity && saved.openingItemId === itemId) return 'unchanged';
      fail('같은 품목의 기초 재고가 다른 내용으로 이미 등록됐습니다.');
    }
    const opening = openingSnap.data();
    if (!opening || opening.companyId !== companyId || opening.date !== date) fail('먼저 해당 날짜의 회계 기초잔액을 저장하세요.');
    if (Number(opening.amounts?.['146'] ?? 0) !== 0) fail('146 재고자산 계정에 수기 기초 합계가 있어 이중계상됩니다. 기존 금액을 확인하세요.');
    if (Number(item.stock ?? 0) !== 0 || (item.lots ?? []).some((lot:Row) => Number(lot.qtyRemaining ?? 0) !== 0 || Number(lot.kgRemaining ?? 0) !== 0) || (item.stocktakeAnchors ?? []).length > 0) fail('이미 재고나 실사 이력이 있는 품목은 기초 재고로 등록할 수 없습니다.');
    if (isRawHolder(item)) {
      const movementRef = db.collection('rawMaterialLedger').doc(operationDocId(operationId));
      const oldId = legacyOperationDocId(operationId), stateRef = db.collection('rawInventories').doc(inventoryDocId(companyId,itemId));
      const [movementSnap, oldMovementSnap, stateSnap] = await Promise.all([tx.get(movementRef),oldId === movementRef.id ? Promise.resolve(null) : tx.get(db.collection('rawMaterialLedger').doc(oldId)),tx.get(stateRef)]);
      if (stateSnap.exists && (Number(stateSnap.data()?.stockKg ?? 0) !== 0 || Number(stateSnap.data()?.revision ?? 0) !== 0)) fail('원료 상태에 기존 재고 이력이 있어 기초 재고로 등록할 수 없습니다.');
      const result = prepareRawCommand(command,{itemSnap:snapshot(itemSnap),stateSnap:snapshot(stateSnap),movementSnap:snapshot(movementSnap),oldMovementSnap:oldMovementSnap ? snapshot(oldMovementSnap) : null},{now:recordedAt,legacy:{note:'기초 재고',type:'manual'}});
      if (result.status !== 'applied') fail(result.status === 'rejected' ? result.message : '기초 원료 명령이 이미 처리됐습니다.');
      tx.set(stateRef,advanceInventoryWriterProtocol(stateSnap.data(),clean(result.state)));
      tx.set(movementRef,advanceInventoryWriterProtocol(movementSnap.data(),clean(toLedgerDoc(result.movement,{note:'기초 재고',type:'manual'}))));
      tx.update(itemRef,advanceInventoryWriterProtocol(item,{stock:result.state.stockKg,lots:clean([...result.state.activeLots,...result.state.recentDepletedLots])}));
    } else {
      const bom = await tx.get(db.collection('item_bom').where('parent_id','==',itemId));
      const ownLines = bom.docs.filter(row => companyOf(row.data()) === companyId);
      const childSnaps = await Promise.all(ownLines.map(row => tx.get(db.collection('items').doc(String(row.data().child_id)))));
      if (childSnaps.some(row => row.exists && companyOf(row.data()!) !== companyId)) fail('다른 회사의 구성 품목입니다.');
      const component = unpackStockComponent(ownLines.map((row,index) => ({childId:String(row.data().child_id),qty:typeof row.data().quantity === 'number' ? row.data().quantity : 1,child:childSnaps[index].data()})));
      const unitKg = itemPackageKg(item,component !== null);
      const anchored = anchorLotsByQty({lots:[],targetQty:quantity,unitKg,material:stocktakeLotMaterial(item),det:{id:`lot-${operationId}`,createdAt:recordedAt,receivedDate:date}});
      tx.update(itemRef,advanceInventoryWriterProtocol(item,{stock:quantity,lots:clean(anchored.lots),stocktakeAnchors:[{id:operationId,date,createdAt:recordedAt,targetQty:quantity,beforeQty:0,deltaQty:quantity,note:'기초 재고'}]}));
    }
    tx.update(openingRef,{hasInventoryOpening:true});
    tx.set(voucherRef,voucher);
    return 'created';
  });
}

export const createOpeningInventoryCommand = onCall({region:'asia-northeast3'}, request => createInventoryOpening(admin.firestore(),request.auth,request.data));
