import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executePartnerItemTermsCommand, partnerItemTermsReceiptId } from './partnerItemTermsCommand';
import { PARTNER_ITEM_TERMS_OPERATIONS, partnerItemTermsOpening, partnerItemTermsExpected, normalizePartnerItemTermsPreview, normalizePartnerItemTermsRequest, normalizePartnerItemTermsResult, termsFromOpening, type PartnerItemTerms, type PartnerItemTermsReference, type PartnerItemTermsRequest, type PartnerItemTermsCommand } from './shared/partnerItemTermsCommand';

const active = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'terms-actor', token: { employeeId: 'terms-employee', companyId: 'taebaek' } };
let app: admin.app.App;
let db: admin.firestore.Firestore;
const owned = new Set<string>();
const doc = (path: string) => { owned.add(path); return db.doc(path); };
const receipt = (r: PartnerItemTermsReference) => doc(PARTNER_ITEM_TERMS_OPERATIONS + '/' + partnerItemTermsReceiptId(r.companyId, actor.uid, r.planId));
const run = async (command: Exclude<PartnerItemTermsCommand, { mode: 'preview' }>, database = db) => {
  const input = command.mode === 'apply' ? command.request : command.reference;
  const reference: PartnerItemTermsReference = { companyId: input.companyId, planId: input.planId, targetId: input.targetId, itemId: input.itemId, partnerId: input.partnerId, direction: input.direction };
  return normalizePartnerItemTermsResult(await executePartnerItemTermsCommand(database, actor, command), reference, actor.uid);
};
const apply = (request: PartnerItemTermsRequest, database = db) => run({ mode: 'apply', request }, database);
async function fixture(existing = true) {
  const id = 'terms-' + randomUUID(), box = id + '-box', child = id + '-child', partner = id + '-partner';
  const reference: PartnerItemTermsReference = { companyId: 'taebaek', planId: 'plan-' + randomUUID(), targetId: existing ? id + '-link' : `${box}_${partner}_out`, itemId: box, partnerId: partner, direction: 'out' };
  const raw = { companyId: 'taebaek', itemId: box, partnerId: partner, Direction: 'out', price: 1200, taxType: '면세', Account_Code: '404', packaging: '원포장' };
  await doc('items/' + box).set({ companyId: 'taebaek', name: '상자', type: 'product' });
  await doc('items/' + child).set({ companyId: 'taebaek', name: '낱개', type: 'product' });
  await doc('partners/' + partner).set({ companyId: 'taebaek', name: '합성 거래처' });
  const bom = doc('item_bom/' + id); await bom.set({ companyId: 'taebaek', parent_id: box, child_id: child, quantity: 10 });
  const target = doc('partner_item/' + reference.targetId), loose = doc(`partner_item/${child}_${partner}_out`);
  if (existing) await target.set(raw);
  receipt(reference);
  async function request(terms: PartnerItemTerms) {
    const preview = normalizePartnerItemTermsPreview(await executePartnerItemTermsCommand(db, actor, { mode: 'preview', input: { version: 1, ...reference, opening: existing ? partnerItemTermsOpening(raw) : null, terms } }), reference);
    return normalizePartnerItemTermsRequest({ version: 1, ...reference, expected: preview.expected, evidence: preview.evidence, terms, ...(preview.noticeHash ? { noticeHash: preview.noticeHash } : {}) });
  }
  return { reference, raw, target, loose, bom, box, child, partner, request };
}

describe.skipIf(!active)('거래처 품목 거래조건 실제 SDK 원자 계약', () => {
  beforeAll(async () => { app = admin.initializeApp({ projectId: 'demo-partner-terms-' + randomUUID().slice(0, 8) }, 'terms-' + randomUUID()); db = admin.firestore(app); await doc('employees/' + actor.token.employeeId).set({ companyId: 'taebaek', name: '합성 직원' }); });
  afterAll(async () => { if (!db) return; const paths = [...owned]; for (let i = 0; i < paths.length; i += 400) { const batch = db.batch(); paths.slice(i, i + 400).forEach(path => batch.delete(db.doc(path))); await batch.commit(); } await app.delete(); }, 60000);

  it('원행 과세·계정과 단가를 상자·새 낱개에 함께 저장하고 같은 영수증은 삭제 후에도 부활시키지 않는다', async () => {
    const f = await fixture(), request = await f.request(termsFromOpening(f.raw, { price: 2400 }));
    expect((await apply(request)).status).toBe('applied');
    expect((await f.target.get()).data()).toMatchObject({ price: 2400, taxType: '면세', Account_Code: '404', packaging: '원포장' });
    expect((await f.loose.get()).data()).toMatchObject({ price: 240, taxType: '면세', Account_Code: '404' });
    const first = await f.target.get();
    expect((await run({ mode: 'inspect', reference: f.reference })).status).toBe('applied');
    expect((await apply(request)).status).toBe('duplicate');
    expect((await f.target.get()).updateTime!.isEqual(first.updateTime!)).toBe(true);
    await f.target.delete(); await f.loose.delete();
    expect((await apply(request)).status).toBe('duplicate');
    expect((await f.target.get()).exists).toBe(false); expect((await f.loose.get()).exists).toBe(false);
  });

  it('기존 쓰기대상 회사 누락·null·타회사는 preview 거절과 유효 reject receipt만 남긴다', async () => {
    for (const company of [undefined, null, 'punghoe']) {
      const f = await fixture(), request = await f.request({ price: 2400 });
      await f.target.update({ companyId: company === undefined ? admin.firestore.FieldValue.delete() : company });
      const raw = (await f.target.get()).data()!;
      await expect(executePartnerItemTermsCommand(db, actor, { mode: 'preview', input: { version: 1, ...f.reference, opening: partnerItemTermsOpening(raw), terms: { price: 2400 } } })).rejects.toMatchObject({ code: 'failed-precondition' });
      expect((await receipt(f.reference).get()).exists).toBe(false);
      // 과거 원문 형태를 가진 유효 요청도 회사 누락을 신규 쓰기 권한으로 해석하지 않는다.
      const originalRequest = normalizePartnerItemTermsRequest({ ...request, expected: partnerItemTermsExpected(raw) });
      const rejected = await apply(originalRequest); expect(rejected.status).toBe('rejected'); expect(rejected.message).toContain(company == null ? '소속 회사가 지정되지' : '다른 회사');
      expect((await f.target.get()).data()).toEqual(raw); expect((await f.loose.get()).exists).toBe(false);
      expect((await receipt(f.reference).get()).data()).toMatchObject({ status: 'rejected', requestHash: expect.stringMatching(/^[a-f0-9]{64}$/), requestText: expect.any(String) });
      await f.target.update({ companyId: 'taebaek' }); expect((await apply(originalRequest)).status).toBe('rejected'); expect((await f.target.get()).get('price')).toBe(1200);
    }
  });

  it('신규 회사 주입과 참조·실직원 legacy 회사 판독은 기존대로 유지한다', async () => {
    const f = await fixture(false);
    await doc('items/' + f.box).update({ companyId: admin.firestore.FieldValue.delete() });
    await doc('partners/' + f.partner).update({ companyId: null });
    await doc('employees/' + actor.token.employeeId).update({ companyId: admin.firestore.FieldValue.delete() });
    try {
      expect((await apply(await f.request({ price: 2400 }))).status).toBe('applied');
      expect((await f.target.get()).get('companyId')).toBe('taebaek'); expect((await f.loose.get()).get('companyId')).toBe('taebaek');
    } finally { await doc('employees/' + actor.token.employeeId).set({ companyId: 'taebaek', name: '합성 직원' }); }
  });

  it('기존 낱개는 가격·과세·계정·포장을 그대로 두고 상자만 수정한다', async () => {
    const f = await fixture(); const original = { companyId: 'taebaek', itemId: f.child, partnerId: f.partner, Direction: 'out', price: 77, taxType: '과세', Account_Code: '909', packaging: '낱개 포장' };
    await f.loose.set(original); const request = await f.request({ price: 2400 });
    expect((await apply(request)).status).toBe('applied'); expect((await f.loose.get()).data()).toEqual(original);
  });

  it('명시된 0·null과 실제 생략을 구별하고 서버 현재값으로 새 낱개를 보충하지 않는다', async () => {
    for (const terms of [{ price: 0, taxType: null }, { Account_Code: '505' }] satisfies PartnerItemTerms[]) {
      const f = await fixture(); expect((await apply(await f.request(terms))).status).toBe('applied');
      const child = (await f.loose.get()).data()!; expect(child).not.toHaveProperty('price'); expect(child).not.toHaveProperty('taxType');
      if ('Account_Code' in terms) expect(child.Account_Code).toBe('505'); else expect(child).not.toHaveProperty('Account_Code');
      if ('taxType' in terms) expect((await f.target.get()).data()).not.toHaveProperty('taxType');
    }
    const f = await fixture(); expect((await apply(await f.request(termsFromOpening(f.raw, { taxType: '과세' })))).status).toBe('applied');
    expect((await f.loose.get()).data()).toMatchObject({ price: 120, taxType: '과세', Account_Code: '404' });
  });

  it('원문 변경·새 BOM·새 연결 phantom은 사전 근거를 깨고 업무를 하나도 쓰지 않는다', async () => {
    for (const kind of ['raw', 'bom', 'link'] as const) {
      const f = await fixture(), request = await f.request({ price: 2400 });
      if (kind === 'raw') await f.target.update({ taxType: '과세' });
      if (kind === 'bom') await doc('item_bom/phantom-' + randomUUID()).set({ companyId: 'taebaek', parent_id: f.box, child_id: f.child, quantity: 20 });
      if (kind === 'link') await doc('partner_item/phantom-' + randomUUID()).set({ companyId: 'taebaek', itemId: f.child, partnerId: f.partner, Direction: 'out', price: 5 });
      expect((await apply(request)).status).toBe('rejected'); expect((await f.target.get()).get('price')).toBe(1200); expect((await f.loose.get()).exists).toBe(false);
      expect((await run({ mode: 'inspect', reference: f.reference })).status).toBe('rejected');
    }
  });

  it('타회사 결정 ID 충돌과 직원 회사 불일치는 기존 자료를 덮지 않는다', async () => {
    const f = await fixture(), request = await f.request({ price: 2400 });
    const foreign = { companyId: 'punghoe', price: 11 }; await f.loose.set(foreign);
    expect((await apply(request)).status).toBe('rejected'); expect((await f.loose.get()).data()).toEqual(foreign); expect((await f.target.get()).get('price')).toBe(1200);
    const other = await fixture(), req = await other.request({ price: 2400 });
    await expect(executePartnerItemTermsCommand(db, { ...actor, token: { ...actor.token, companyId: 'punghoe' } }, { mode: 'apply', request: req })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await other.target.get()).get('price')).toBe(1200);
  });

  it('순환·보관·통합 tomb가 뒤늦게 생기면 상자와 낱개를 모두 쓰지 않는다', async () => {
    for (const kind of ['cycle', 'archived', 'tomb'] as const) {
      const f = await fixture(), request = await f.request({ price: 2400 });
      if (kind === 'cycle') await doc('item_bom/cycle-' + randomUUID()).set({ companyId: 'taebaek', parent_id: f.child, child_id: f.box, quantity: 10 });
      if (kind === 'archived') await doc('items/' + f.child).update({ archived: true });
      if (kind === 'tomb') await doc('inventoryWriterDeletions/taebaek__' + f.child).set({ companyId: 'taebaek', mergedIntoItemId: '다른품목' });
      expect((await apply(request)).status).toBe('rejected'); expect((await f.target.get()).get('price')).toBe(1200); expect((await f.loose.get()).exists).toBe(false);
      expect((await receipt(f.reference).get()).get('status')).toBe('rejected');
    }
  });

  it('실제 500단계 사슬은 499개 업무 한도에서 전부 거절하고 연결 하나도 생성하지 않는다', async () => {
    const f = await fixture(), request = await f.request({ price: 2400 });
    const nodes = [f.box, f.child, ...Array.from({ length: 498 }, (_, i) => f.box + '-depth-' + i)];
    const seeds: Array<{ path: string; data: admin.firestore.DocumentData }> = [];
    for (let i = 2; i < nodes.length; i++) seeds.push({ path: 'items/' + nodes[i], data: { companyId: 'taebaek', name: '한도 합성 품목', type: 'product' } });
    for (let i = 1; i < nodes.length - 1; i++) seeds.push({ path: 'item_bom/' + nodes[i], data: { companyId: 'taebaek', parent_id: nodes[i], child_id: nodes[i + 1], quantity: 2 } });
    for (let i = 0; i < seeds.length; i += 400) { const batch = db.batch(); for (const seed of seeds.slice(i, i + 400)) batch.set(doc(seed.path), seed.data); await batch.commit(); }
    const result = await apply(request); expect(result.status).toBe('rejected'); expect(result.message).toContain('499');
    expect((await f.target.get()).get('price')).toBe(1200);
    const links = await db.collection('partner_item').where('companyId', '==', 'taebaek').where('partnerId', '==', f.partner).get();
    expect(links.docs.map(row => row.id)).toEqual([f.reference.targetId]); expect((await receipt(f.reference).get()).get('status')).toBe('rejected');
  }, 120000);

  it('둘째 문서 실제 커밋 오류는 상자·낱개·영수증 모두 취소하며 같은 원문으로만 다시 저장한다', async () => {
    const f = await fixture(), request = await f.request({ price: 2400 });
    // 실제 Firestore TX의 두 번째 업무 문서만 크기 제한을 넘겨 커밋 실패를 주입한다.
    const failing = new Proxy(db, {
      get(database, property) {
        if (property === 'runTransaction') return (work: (tx: admin.firestore.Transaction) => Promise<unknown>) => database.runTransaction(async tx => {
          let writes = 0;
          const wrapped = new Proxy(tx, {
            get(transaction, method) {
              if (method === 'create' || method === 'update') return (target: admin.firestore.DocumentReference, data: admin.firestore.DocumentData) => {
                const payload = target.parent.id === 'partner_item' && ++writes === 2 ? { ...data, sdkFailurePadding: 'x'.repeat(1100000) } : data;
                return method === 'create' ? transaction.create(target, payload) : transaction.update(target, payload);
              };
              const value = Reflect.get(transaction, method); return typeof value === 'function' ? value.bind(transaction) : value;
            }
          });
          return work(wrapped);
        });
        const value = Reflect.get(database, property); return typeof value === 'function' ? value.bind(database) : value;
      }
    });
    await expect(apply(request, failing)).rejects.toThrow();
    expect((await f.target.get()).get('price')).toBe(1200); expect((await f.loose.get()).exists).toBe(false); expect((await receipt(f.reference).get()).exists).toBe(false);
    expect((await apply(request)).status).toBe('applied'); expect((await f.loose.get()).get('price')).toBe(240);
  }, 60000);

  it('부재 조회는 쓰기 0이며 중단 fence와 늦은 apply는 같은 확정 결과를 따른다', async () => {
    const f = await fixture(), request = await f.request({ price: 2400 });
    expect((await run({ mode: 'inspect', reference: f.reference })).status).toBe('unknown'); expect((await receipt(f.reference).get()).exists).toBe(false);
    expect((await run({ mode: 'cancel', reference: f.reference })).status).toBe('cancelled'); expect((await apply(request)).status).toBe('cancelled'); expect((await f.target.get()).get('price')).toBe(1200);
    const race = await fixture(), req = await race.request({ price: 2400 });
    const results = await Promise.all([apply(req), run({ mode: 'cancel', reference: race.reference })]);
    const status = (await receipt(race.reference).get()).get('status'); expect(results.every(result => result.status === status)).toBe(true);
    expect((await race.target.get()).get('price')).toBe(status === 'applied' ? 2400 : 1200); expect((await race.loose.get()).exists).toBe(status === 'applied');
  }, 60000);
});
