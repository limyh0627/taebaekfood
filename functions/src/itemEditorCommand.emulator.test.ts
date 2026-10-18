import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executeItemEditorCommand, itemEditorReceiptId } from './itemEditorCommand';
import { ITEM_EDITOR_STAGES, ITEM_EDITOR_GRAPH_PARTS, ITEM_EDITOR_OPERATIONS, serializeItemEditorGraphPart, itemEditorTargetExpected, type ItemEditorRequest, type ItemEditorReference, type ItemEditorGraphDocuments, type ItemEditorGraphEvidence, type ItemEditorStage, type CatalogValueAdapter } from './shared/itemEditorCommand';

const active = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'item-editor-sdk-actor', token: { employeeId: 'item-editor-sdk-employee', companyId: 'taebaek' } };
const collections = { items: 'items', boms: 'item_bom', formulas: 'item_formula', links: 'partner_item' } as const;
const codec: Pick<CatalogValueAdapter, 'special'> = { special: (value: unknown) => value instanceof admin.firestore.Timestamp ? ['timestamp', value.seconds, value.nanoseconds] : undefined };
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const ref = (path: string) => { owned.add(path); return db.doc(path); };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const reference = (request: ItemEditorReference): ItemEditorReference => ({ companyId: request.companyId, targetId: request.targetId, planId: request.planId });
const receipt = (request: ItemEditorReference) => ref(`${ITEM_EDITOR_OPERATIONS}/${itemEditorReceiptId(request.companyId, actor.uid, request.planId)}`);
const apply = (request: ItemEditorRequest, stage: ItemEditorStage) => executeItemEditorCommand(db, actor, { mode: 'apply', request, stage });
async function graph(): Promise<ItemEditorGraphDocuments> {
  const result = {} as ItemEditorGraphDocuments;
  for (const part of ITEM_EDITOR_GRAPH_PARTS) {
    const snapshot = await db.collection(collections[part]).where('companyId', '==', 'taebaek').get();
    result[part] = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  }
  return result;
}
async function fixture(isNew = false) {
  const id = 'sdk-item-' + randomUUID();
  const original = { companyId: 'taebaek', name: id, type: 'raw', unit: 'kg', cost: 10, costSource: 'manual', stock: 17, inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 7 };
  const target = ref('items/' + id);
  if (!isNew) await target.set(original);
  const documents = await graph();
  const evidence = { schemaVersion: 1 } as ItemEditorGraphEvidence;
  for (const part of ITEM_EDITOR_GRAPH_PARTS) evidence[part] = { count: documents[part].length, digest: sha(serializeItemEditorGraphPart(part, documents[part], codec)) };
  const request: ItemEditorRequest = { version: 1, companyId: 'taebaek', targetId: id, planId: 'sdk-plan-' + randomUUID(), graph: evidence, targetExpected: isNew ? null : itemEditorTargetExpected(original, codec), draft: { isNew, metadata: { name: id + '-수정', type: 'raw', unit: 'kg', cost: 20, costSource: 'manual' }, inPartnerIds: [], photoChanged: false } };
  receipt(request);
  return { id, original, target, request };
}

// 운영 프로젝트와 공유 초기화를 피하고, 생성한 문서만 개별 삭제한다.
describe.skipIf(!active)('품목 영속 단계 명령 실제 SDK', () => {
  beforeAll(async () => {
    app = admin.initializeApp({ projectId: 'demo-item-editor-' + randomUUID().slice(0, 8) }, 'item-editor-' + randomUUID());
    db = admin.firestore(app);
    await ref('employees/' + actor.token.employeeId).set({ companyId: 'taebaek', name: '합성 담당자' });
  });
  afterAll(async () => {
    if (!db) return;
    for (const path of owned) await db.doc(path).delete();
    await app.delete();
  }, 60000);

  it('다섯 단계 응답을 잃어도 inspect와 동일 단계 재호출은 ACK만 돌려주며 완료 뒤 삭제한 품목을 부활시키지 않는다', async () => {
    const f = await fixture();
    const partnerId = 'sdk-partner-' + randomUUID();
    await ref('partners/' + partnerId).set({ companyId: 'taebaek', name: '합성 매입처' });
    f.request.draft.inPartnerIds = [partnerId];
    f.request.draft.formulaRows = [{ child_name: '합성원료', yield_pct: 100 }];
    const formula = ref('item_formula/formula-' + f.request.draft.metadata.name + '-합성원료');
    const link = ref('partner_item/' + f.id + '_' + partnerId + '_in');
    for (let index = 0; index < ITEM_EDITOR_STAGES.length; index++) {
      const stage = ITEM_EDITOR_STAGES[index];
      const result = await apply(f.request, stage);
      expect(result.confirmedStageIds).toEqual(ITEM_EDITOR_STAGES.slice(0, index + 1));
      const business = await f.target.get(), proof = await receipt(f.request).get();
      expect(proof.get('confirmedStageIds')).toEqual(result.confirmedStageIds);
      expect((await executeItemEditorCommand(db, actor, { mode: 'inspect', reference: reference(f.request) })).confirmedStageIds).toEqual(result.confirmedStageIds);
      expect((await apply(f.request, stage)).confirmedStageIds).toEqual(result.confirmedStageIds);
      expect((await f.target.get()).updateTime!.isEqual(business.updateTime!)).toBe(true);
      expect((await receipt(f.request).get()).updateTime!.isEqual(proof.updateTime!)).toBe(true);
    }
    expect((await f.target.get()).data()).toMatchObject({ cost: 20, stock: 17, inventoryWriteRevision: 7 });
    expect((await formula.get()).data()).toMatchObject({ child_name: '합성원료', yield_rate: 1 });
    expect((await link.get()).data()).toMatchObject({ itemId: f.id, partnerId, Direction: 'in' });
    await f.target.delete();
    expect((await apply(f.request, 'primary')).status).toBe('completed');
    expect((await f.target.get()).exists).toBe(false);
  }, 60000);

  it('부재 조회는 쓰기 없고 중단 fence는 늦은 첫 저장을 막으며 경합한 완료 단계는 되돌리지 않는다', async () => {
    const f = await fixture();
    expect((await executeItemEditorCommand(db, actor, { mode: 'inspect', reference: reference(f.request) })).status).toBe('unknown');
    expect((await receipt(f.request).get()).exists).toBe(false);
    const results = await Promise.all([apply(f.request, 'primary'), executeItemEditorCommand(db, actor, { mode: 'cancel', reference: reference(f.request) })]);
    const final = await executeItemEditorCommand(db, actor, { mode: 'inspect', reference: reference(f.request) });
    expect(final.status).toBe('cancelled');
    expect(final.confirmedStageIds.length).toBeLessThanOrEqual(1);
    expect((await f.target.get()).get('cost')).toBe(final.confirmedStageIds.length ? 20 : 10);
    expect((await apply(f.request, 'primary')).status).toBe('cancelled');
    expect(results.every(result => ['active', 'cancelled'].includes(result.status))).toBe(true);
  }, 60000);

  it.each(['boms', 'links'] as const)('첫 ACK 뒤 새 %s 문서가 생기면 후속 단계는 거절하고 이미 완료된 품목은 보존한다', async part => {
    const f = await fixture();
    expect((await apply(f.request, 'primary')).status).toBe('active');
    const phantom = ref(collections[part] + '/phantom-' + randomUUID());
    await phantom.set({ companyId: 'taebaek', parent_id: f.id, child_id: f.id, itemId: f.id, partnerId: 'unrelated', quantity: 1 });
    const result = await apply(f.request, 'bom-cost');
    expect(result.status).toBe('rejected');
    expect(result.confirmedStageIds).toEqual(['primary']);
    expect((await f.target.get()).get('cost')).toBe(20);
    await phantom.delete();
    expect((await apply(f.request, 'bom-cost')).status).toBe('rejected');
  }, 60000);

  it('다른 회사의 결정적 BOM 번호 충돌은 업무 쓰기 없이 빈 ACK 거절 영수증만 남긴다', async () => {
    const f = await fixture();
    f.request.draft.bomDraft = [{ childId: f.id, qty: 1 }];
    const collision = ref('item_bom/bom-' + f.id + '__' + f.id);
    await collision.set({ companyId: 'punghoe', parent_id: 'foreign', child_id: 'foreign', quantity: 99 });
    expect((await apply(f.request, 'primary')).status).toBe('rejected');
    expect((await f.target.get()).get('cost')).toBe(10);
    expect((await receipt(f.request).get()).get('confirmedStageIds')).toEqual([]);
    expect((await collision.get()).get('quantity')).toBe(99);
  });

  it('열기 뒤 재고만 변경된 경우 메타데이터 저장이 최신 재고와 revision을 덮지 않는다', async () => {
    const f = await fixture();
    await f.target.update({ stock: 31, inventoryWriteRevision: 19, inventoryOperation: { state: 'processing', id: 'actual-inventory' } });
    expect((await apply(f.request, 'primary')).status).toBe('active');
    expect((await f.target.get()).data()).toMatchObject({ cost: 20, stock: 31, inventoryWriteRevision: 19, inventoryOperation: { state: 'processing', id: 'actual-inventory' } });
  });

  it('최초 graph 충돌은 빈 ACK 거절 영수증으로 확정되고 원문이 돌아와도 늦은 재호출은 저장으로 승격되지 않는다', async () => {
    const f = await fixture();
    const phantom = ref('item_bom/first-conflict-' + randomUUID());
    await phantom.set({ companyId: 'taebaek', parent_id: f.id, child_id: f.id, quantity: 1 });
    const result = await apply(f.request, 'primary');
    expect(result.status).toBe('rejected');
    expect(result.confirmedStageIds).toEqual([]);
    expect(result.requestHash).toMatch(/^[a-f0-9]{64}$/);
    const proof = await receipt(f.request).get();
    expect(proof.get('plansText')).toBeUndefined();
    expect(proof.get('status')).toBe('rejected');
    expect((await f.target.get()).get('cost')).toBe(10);
    expect(await executeItemEditorCommand(db, actor, { mode: 'inspect', reference: reference(f.request) })).toEqual(result);
    await phantom.delete();
    const original = await f.target.get();
    expect(await apply(f.request, 'primary')).toEqual(result);
    expect((await f.target.get()).updateTime!.isEqual(original.updateTime!)).toBe(true);
    expect((await receipt(f.request).get()).updateTime!.isEqual(proof.updateTime!)).toBe(true);
  });

  it('압축 계획 저장 한도를 넘으면 첫 업무 쓰기는 없고 빈 ACK 거절만 남긴다', async () => {
    const f = await fixture();
    const partnerId = 'large-partner-' + randomUUID();
    await ref('partners/' + partnerId).set({ companyId: 'taebaek', name: '합성 매입처' });
    const link = ref('partner_item/' + f.id + '_' + partnerId + '_in');
    await link.set({ companyId: 'taebaek', itemId: f.id, partnerId, Direction: 'in', taxType: 'x'.repeat(900000) });
    const documents = await graph();
    for (const part of ITEM_EDITOR_GRAPH_PARTS) f.request.graph[part] = { count: documents[part].length, digest: sha(serializeItemEditorGraphPart(part, documents[part], codec)) };
    f.request.draft.inPartnerIds = [partnerId];
    const result = await apply(f.request, 'primary');
    expect(result.status).toBe('rejected');
    expect(result.confirmedStageIds).toEqual([]);
    expect(result.message).toContain('너무 큽니다');
    expect((await f.target.get()).get('cost')).toBe(10);
    expect((await link.get()).get('taxType').length).toBe(900000);
    expect((await receipt(f.request).get()).get('plansText')).toBeUndefined();
    await link.delete();
  });

  it('다른 회사 사진 경로는 첫 쓰기 전에 거절한다', async () => {
    const f = await fixture();
    f.request.draft.photoChanged = true;
    f.request.draft.metadata.imagePath = `companies/punghoe/items/${f.id}/photo.jpg`;
    f.request.draft.metadata.image = 'https://storage.googleapis.com/bucket/' + f.request.draft.metadata.imagePath;
    await expect(apply(f.request, 'primary')).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await receipt(f.request).get()).exists).toBe(false);
    expect((await f.target.get()).get('cost')).toBe(10);
  });

  it('통합 tomb은 재생성을 막고 정상 삭제 tomb의 새 품목 revision은 삭제 전보다 높다', async () => {
    const merged = await fixture(true);
    await ref('inventoryWriterDeletions/taebaek__' + merged.id).set({ companyId: 'taebaek', itemId: merged.id, mergedIntoItemId: 'keeper' });
    expect((await apply(merged.request, 'primary')).status).toBe('rejected');
    expect((await merged.target.get()).exists).toBe(false);
    expect((await receipt(merged.request).get()).get('confirmedStageIds')).toEqual([]);
    const fresh = await fixture(true);
    await ref('inventoryWriterDeletions/taebaek__' + fresh.id).set({ companyId: 'taebaek', itemId: fresh.id, inventoryWriterProtocolVersion: 1, deletionRevision: 3, lastDeletedItemRevision: 11, beforeRevision: 11 });
    expect((await apply(fresh.request, 'primary')).status).toBe('active');
    expect((await fresh.target.get()).get('inventoryWriteRevision')).toBe(12);
    expect((await fresh.target.get()).get('stock')).toBe(0);
  });
});
