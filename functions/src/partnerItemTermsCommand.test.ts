import {it,expect,vi} from 'vitest';
import {executePartnerItemTermsCommand,partnerItemTermsReceiptId} from './partnerItemTermsCommand';
const reference={companyId:'taebaek' as const,planId:'plan',targetId:'item_partner_out',itemId:'item',partnerId:'partner',direction:'out' as const};
it('로그인·claim 회사·형식 오류는 TX 전 거절한다',async()=>{
 const runTransaction=vi.fn(),db={runTransaction} as never;
 await expect(executePartnerItemTermsCommand(db,undefined,{mode:'inspect',reference})).rejects.toMatchObject({code:'unauthenticated'});
 await expect(executePartnerItemTermsCommand(db,{uid:'actor',token:{companyId:'taebaek'}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executePartnerItemTermsCommand(db,{uid:'actor',token:{companyId:'punghoe',employeeId:'e'}},{mode:'inspect',reference})).rejects.toMatchObject({code:'permission-denied'});
 await expect(executePartnerItemTermsCommand(db,{uid:'actor',token:{companyId:'taebaek',employeeId:'e'}},{mode:'apply',request:{}} as never)).rejects.toMatchObject({code:'invalid-argument'});expect(runTransaction).not.toHaveBeenCalled();
});
it('저장 receipt 번호는 회사·UID·계획에 묶인다',()=>{const id=partnerItemTermsReceiptId('taebaek','actor','plan');expect(id).toHaveLength(64);expect(id).not.toBe(partnerItemTermsReceiptId('punghoe','actor','plan'));expect(id).not.toBe(partnerItemTermsReceiptId('taebaek','other','plan'));});

it('기존 쓰기대상 회사 누락·null·타회사는 preview 거절과 유효 원문 거절 영수증만 남긴다', async () => {
  const { partnerItemTermsOpening, partnerItemTermsExpected, normalizePartnerItemTermsRequest } = await import('./shared/partnerItemTermsCommand');
  const actor = { uid: 'actor', token: { companyId: 'taebaek', employeeId: 'employee' } };
  for (const company of [undefined, null, 'punghoe']) {
    const raw = { itemId: 'item', partnerId: 'partner', Direction: 'out', price: 1200, ...(company === undefined ? {} : { companyId: company }) };
    const snapshot = (data: Record<string, unknown>) => ({ exists: true, data: () => data, get: (key: string) => data[key] });
    const create = vi.fn(), update = vi.fn();
    interface Query { queryCollection: string; where(...args: unknown[]): Query }
    const query = (name: string): Query => ({ queryCollection: name, where: () => query(name) });
    const absent = () => ({ exists: false, data: () => undefined, get: () => undefined });
    const tx = { get: vi.fn(async (ref: { path: string } | Query) => {
      if ('queryCollection' in ref) return { docs: [], size: 0 };
      if (ref.path.startsWith('partnerItemTermsOperations/') || ref.path.startsWith('inventoryWriterDeletions/')) return absent();
      if (ref.path === 'employees/employee' || ref.path === 'partners/partner') return snapshot({ companyId: 'taebaek', name: '합성 참조' });
      if (ref.path === 'items/item') return snapshot({ companyId: 'taebaek', name: '합성 품목', type: 'product' });
      return snapshot(raw);
    }), create, update };
    const db = { collection: (collection: string) => ({ ...query(collection), doc: (id: string) => ({ path: collection + '/' + id }) }), runTransaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx) };
    await expect(executePartnerItemTermsCommand(db as never, actor, { mode: 'preview', input: { version: 1, ...reference, opening: partnerItemTermsOpening(raw), terms: { price: 2400 } } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    const request = normalizePartnerItemTermsRequest({ version: 1, ...reference, expected: partnerItemTermsExpected(raw), terms: { price: 2400 }, evidence: { schemaVersion: 1, queries: [], documents: [] } });
    const result = await executePartnerItemTermsCommand(db as never, actor, { mode: 'apply', request });
    expect(result).toMatchObject({ status: 'rejected', actorUid: actor.uid, message: expect.stringContaining(company == null ? '소속 회사가 지정되지' : '다른 회사') });
    expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0][0].path).toMatch(/^partnerItemTermsOperations\//); expect(create.mock.calls[0][1]).toMatchObject({ status: 'rejected', requestText: expect.any(String), requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) }); expect(update).not.toHaveBeenCalled();
  }
});
