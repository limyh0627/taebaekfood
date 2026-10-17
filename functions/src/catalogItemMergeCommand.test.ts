import { beforeEach, describe, expect, it } from 'vitest';
import type * as admin from 'firebase-admin';
import { executeCatalogItemMerge, catalogItemMergeReceiptId, CATALOG_MERGE_RECEIPTS } from './catalogItemMergeCommand';
import type { CatalogItemMergePreview, CatalogItemMergeRequest, CatalogItemMergeResult } from './shared/catalogItemMerge';

type Row = Record<string, any>;
/** Firestore의 읽기/원자 커밋 경계만 대체한다. 업무 fixture는 실제 필드로 구성한다. */
class Store {
  docs = new Map<string, { data: Row; tick: number }>(); tick = 0;
  seed(path: string, data: Row) { this.docs.set(path, { data: structuredClone(data), tick: ++this.tick }); }
  ref(path: string) { return { path, id: path.split('/').at(-1)!, parent: { id: path.split('/')[0] } }; }
  snap(path: string) { const row = this.docs.get(path); return { ref: this.ref(path), id: path.split('/').at(-1)!, exists: !!row, updateTime: row ? { seconds: row.tick, nanoseconds: 1 } : undefined, data: () => row && structuredClone(row.data) }; }
  collection = (name: string) => ({ doc: (id: string) => this.ref(name + '/' + id), where: (field: string, op: string, value: unknown) => ({ name, field, op, value, limit: (limit: number) => ({ name, field, op, value, maximum: limit }) }) });
  runTransaction = async (callback: (tx: any) => Promise<unknown>) => {
    const writes: { path: string; data?: Row }[] = [];
    const result = await callback({ get: async (ref: any) => {
      if (ref.path) return this.snap(ref.path);
      const rows = [...this.docs].filter(([path, row]) => path.split('/')[0] === ref.name && (ref.op === 'in' ? ref.value.includes(row.data[ref.field]) : row.data[ref.field] === ref.value)).slice(0, ref.maximum).map(([path]) => this.snap(path));
      return { docs: rows, size: rows.length, empty: !rows.length };
    }, set: (ref: any, data: Row) => writes.push({ path: ref.path, data }), create: (ref: any, data: Row) => { if (this.docs.has(ref.path)) throw Error('이미 존재'); writes.push({ path: ref.path, data }); }, delete: (ref: any) => writes.push({ path: ref.path }) });
    for (const write of writes) if (write.data) this.seed(write.path, write.data); else this.docs.delete(write.path);
    return result;
  };
  get db() { return this as unknown as admin.firestore.Firestore; }
}
const actor = { uid: 'synthetic-admin', token: { isAdmin: true, companyId: 'taebaek', employeeId: 'employee' } };
let store: Store;
const item = (over: Row = {}) => ({ companyId: 'taebaek', name: '같은 품목', type: 'product', unit: '개', stock: 0, ...over });
const link = (itemId = 'old', over: Row = {}) => ({ companyId: 'taebaek', itemId, partnerId: 'partner', Direction: 'out', price: 550, taxType: '면세', unknownBusiness: { label: '원문' }, ...over });
beforeEach(() => { store = new Store(); store.seed('appMeta/releaseCutover', { status: 'active', releaseId: 'release' }); store.seed('items/keep', item({ stock: 17, custom: '보존' })); store.seed('items/old', item()); store.seed('partners/partner', { companyId: 'taebaek', name: '합성 거래처' }); store.seed('partner_item/source', link()); });
const read = () => executeCatalogItemMerge(store.db, actor, { mode: 'read', companyId: 'taebaek', keepId: 'keep', donorIds: ['old'] }) as Promise<CatalogItemMergePreview>;
const request = async (): Promise<CatalogItemMergeRequest> => ({ version: 1, companyId: 'taebaek', operationId: 'operation', keepId: 'keep', donorIds: ['old'], releaseId: 'release', snapshotDigest: (await read()).snapshotDigest, resolutions: [] });
const apply = (request: CatalogItemMergeRequest) => executeCatalogItemMerge(store.db, actor, { mode: 'apply', request }) as Promise<CatalogItemMergeResult>;
describe('중복 품목 서버 원자 명령', () => {
  it('정상 통합은 keeper 전체를 보존하고 원문 연결·영구 tomb·epoch·영수증을 함께 기록한다', async () => {
    const keep = structuredClone(store.docs.get('items/keep')); const r = await request(); expect((await read()).plan.phase).toBe('ready');
    expect((await apply(r)).status).toBe('applied'); expect(store.docs.get('items/keep')).toEqual(keep); expect(store.docs.has('items/old')).toBe(false);
    expect(store.docs.get('partner_item/keep_partner_out')!.data).toEqual({ ...link(), id: 'keep_partner_out', itemId: 'keep' }); expect(store.docs.has('partner_item/source')).toBe(false);
    expect(store.docs.get('inventoryWriterDeletions/taebaek__old')!.data).toMatchObject({ mergedIntoItemId: 'keep', mergeOperationId: 'operation', deletionRevision: 1, lastDeletedItemRevision: 0 }); expect(store.docs.get('catalogItemMergeState/taebaek')!.data.revision).toBe(1);
    const before = JSON.stringify([...store.docs]); store.seed('appMeta/releaseCutover', {status:'paused'}); const afterGate = JSON.stringify([...store.docs]); expect((await apply(r)).status).toBe('applied'); expect(JSON.stringify([...store.docs])).toBe(afterGate); expect(before).not.toBe(afterGate);
  });
  it.each(['price', 'new-link', 'raw-missing', 'epoch'])('%s 변경은 최초 digest를 거절하고 품목·연결은 보존한다', async mode => {
    const r = await request(); if (mode === 'price') store.seed('partner_item/source', link('old', {price:551}));
    if (mode === 'new-link') store.seed('partner_item/late', link()); if (mode === 'raw-missing') store.seed('rawInventories/taebaek__old', {companyId:'taebaek',rawItemId:'old',stockKg:0,activeLots:[],revision:0}); if (mode === 'epoch') store.seed('catalogItemMergeState/taebaek',{companyId:'taebaek',revision:1});
    expect(await apply(r)).toMatchObject({status:'rejected',errorCode:'snapshot-changed'}); expect(store.docs.has('items/old')).toBe(true); expect(store.docs.has('partner_item/source')).toBe(true);
  });
  it('회사 미기재 legacy 진행주문도 donor 참조이면 차단하고 과거 완료 주문은 변경하지 않는다', async () => {
    store.seed('orders/legacy', {status:'PROCESSING',items:[{itemId:'old',quantity:1}]}); expect((await read()).plan.blockers.map(row=>row.code)).toContain('active-order'); expect((await apply(await request())).status).toBe('rejected');
  });
  it('충돌은 실제 후보를 명시 선택해 모든 업무 필드를 보존한다', async () => {
    store.seed('partner_item/existing', link('keep',{price:700})); const p=await read();expect(p.plan.phase).toBe('needs-resolution');const r=await request();r.resolutions=[{destinationKey:p.plan.groups[0].destinationKey,sourceLinkId:'source'}]; expect((await apply(r)).status).toBe('applied');expect(store.docs.get('partner_item/existing')!.data).toMatchObject({partnerId:'partner',price:550,unknownBusiness:{label:'원문'},itemId:'keep'});
  });
  it('미확정 조회는 쓰지 않고 참조만 중단한 영수증이 늦은 apply를 봉쇄한다', async () => {
    const r=await request(),reference={version:1 as const,companyId:r.companyId,operationId:r.operationId};const before=JSON.stringify([...store.docs]);expect((await executeCatalogItemMerge(store.db,actor,{mode:'inspect-request',reference}) as CatalogItemMergeResult).status).toBe('unknown');expect(JSON.stringify([...store.docs])).toBe(before);
    expect((await executeCatalogItemMerge(store.db,actor,{mode:'discard-request',reference}) as CatalogItemMergeResult).opaqueFence).toBe(true);expect((await apply(r)).status).toBe('discarded');expect(store.docs.has('items/old')).toBe(true);
  });
  it('같은 작업번호의 다른 최초 원문 및 손상 영수증은 성공으로 보지 않는다',async()=>{const r=await request();await apply(r);await expect(apply({...r,resolutions:[{destinationKey:'["partner","out"]',sourceLinkId:'source'}]})).rejects.toMatchObject({code:'already-exists'});const path=CATALOG_MERGE_RECEIPTS+'/'+catalogItemMergeReceiptId('taebaek',actor.uid,r.operationId);store.seed(path,{...store.docs.get(path)!.data,actorUid:'foreign'});await expect(apply(r)).rejects.toThrow('영수증');});
  it('관리자·회사 경계를 검사하고 다른 회사 품목 원문을 반환하지 않는다',async()=>{await expect(executeCatalogItemMerge(store.db,undefined,{mode:'read',companyId:'taebaek',keepId:'keep',donorIds:['old']})).rejects.toMatchObject({code:'unauthenticated'});await expect(executeCatalogItemMerge(store.db,{...actor,token:{...actor.token,isAdmin:false}},{mode:'read',companyId:'taebaek',keepId:'keep',donorIds:['old']})).rejects.toMatchObject({code:'permission-denied'});store.seed('items/old',item({companyId:'punghoe'}));await expect(read()).rejects.toMatchObject({code:'permission-denied'});});
  it('donor 재고와 활성매입단위는 계획에서 차단한다',async()=>{store.seed('item_purchase_unit/unit',{companyId:'taebaek',itemId:'old',active:true});expect((await read()).plan.phase).toBe('blocked');store.docs.delete('item_purchase_unit/unit');store.seed('items/old',item({stock:1}));expect((await read()).plan.phase).toBe('blocked');});
});

it('손상된 재고버전과 과대한 감사 원문은 조회 단계에서 복구 안내로 차단한다',async()=>{store.seed('items/old',item({inventoryWriterProtocolVersion:1,inventoryWriteRevision:'bad'}));expect((await read()).plan.phase).toBe('blocked');store.seed('items/old',item());store.seed('partner_item/source',link('old',{largeBusiness:'x'.repeat(700001)}));expect((await read()).plan.phase).toBe('blocked');expect(store.docs.has('items/old')).toBe(true);});
