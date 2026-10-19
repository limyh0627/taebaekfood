// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useDocumentCategories, type DocumentCategoriesOptions } from './useDocumentCategories';
import { createDocumentCategoryWrites, type DocumentCategoryPort, type DocumentCategoryScope, type DocumentCategoryRequest, type DocumentCategoryResult } from '../infrastructure/documentCategoryWrites';
import { serializeDocumentCategoryRequest, type DocumentCategoryCommand } from '../../../shared/documentCategoryCommand';
const auth = vi.hoisted(() => ({ currentUser: { uid: 'A' } }));
vi.mock('../../../shared/firebase', () => ({ auth, authReady: Promise.resolve(), functions: {} }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true) }));
const category = { id: 'category', companyId: 'taebaek' as const, name: '자료', order: 0, createdAt: '2026-10-19' };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { auth.currentUser.uid = 'A'; });
function fixture() {
    const values = new Map<string, string>(), records = new Map<string, DocumentCategoryResult>();
    let scope: DocumentCategoryScope = { companyId: 'taebaek', actorUid: 'A', employeeId: 'employee' };
    const storage = { get length() { return values.size; }, key: vi.fn((i: number) => [...values.keys()][i] ?? null), getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, text: string) => { values.set(key, text); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
    const reply = async (request: DocumentCategoryRequest): Promise<DocumentCategoryResult> => ({ version: 1, reference: request.reference, actorUid: scope.actorUid, employeeId: scope.employeeId, requestHash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeDocumentCategoryRequest(request))))].map(n => n.toString(16).padStart(2, '0')).join(''), status: 'applied', message: '서버에서 분류 처리 완료를 확인했습니다.' });
    const apply = vi.fn(async (request: DocumentCategoryRequest) => { const result = await reply(request); records.set(request.reference.planId, result); return result; });
    const command = vi.fn(async (input: DocumentCategoryCommand): Promise<unknown> => {
        if (input.mode === 'apply')
            return apply(input.request);
        if (input.mode === 'listPending')
            return { version: 1, companyId: input.companyId, actorUid: scope.actorUid, employeeId: scope.employeeId, entries: [], nextCursor: null };
        const old = records.get(input.reference.planId);
        if (old)
            return old;
        const result: DocumentCategoryResult = { version: 1, reference: input.reference, actorUid: scope.actorUid, employeeId: scope.employeeId, requestHash: null, status: input.mode === 'cancel' ? 'cancelled' : 'unknown', message: input.mode === 'cancel' ? '미처리 중단 확인' : '아직 서버 결과를 확인하지 못했습니다.' };
        if (input.mode === 'cancel')
            records.set(input.reference.planId, result);
        return result;
    });
    const port: DocumentCategoryPort = { storage, command, assertScope: vi.fn(async (next) => { scope = next; }), exclusive: vi.fn(async (_scope, work) => work()) };
    const writes = createDocumentCategoryWrites(port);
    const options: DocumentCategoriesOptions = { companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', categories: [category], subCategories: [], writes };
    return { values, records, storage, port, writes, command, apply, reply, options };
}
async function ready(result: {
    current: ReturnType<typeof useDocumentCategories>;
}) { await waitFor(() => expect(result.current.readLoading).toBe(false)); }
it('실추안·고정ID·trim·order를소유하고중복호출과ACK전초기화를막는다', async () => {
    const f = fixture(), gate = deferred<void>();
    f.apply.mockImplementationOnce(async (request) => { const result = await f.reply(request); await gate.promise; f.records.set(request.reference.planId, result); return result; });
    const view = renderHook(() => useDocumentCategories(f.options));
    await ready(view.result);
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName(' 새 자료 '); });
    let a!: Promise<void>, b!: Promise<void>;
    act(() => { a = view.result.current.addCategory(); b = view.result.current.addCategory(); });
    await waitFor(() => expect(f.apply).toHaveBeenCalledOnce());
    expect(view.result.current.addingCat).toBe(true);
    expect(view.result.current.newCatName).toBe(' 새 자료 ');
    expect(f.apply.mock.calls[0][0]).toMatchObject({ action: 'createCategory', name: '새 자료', order: 1 });
    await act(async () => { gate.resolve(); await Promise.all([a, b]); });
    expect(view.result.current.addingCat).toBe(false);
    expect(view.result.current.newCatName).toBe('');
});
it('응답유실은고정원문을보존하고실서버inspect로만현재초안을종결한다', async () => {
    const f = fixture();
    f.apply.mockImplementationOnce(async (request) => { const result = await f.reply(request); f.records.set(request.reference.planId, result); throw Error('ACK lost'); });
    const view = renderHook(() => useDocumentCategories(f.options));
    await ready(view.result);
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('원분류'); });
    await act(() => view.result.current.addCategory());
    expect(view.result.current.addingCat).toBe(true);
    act(() => view.result.current.changeCategoryName('다른입력'));
    expect(view.result.current.newCatName).toBe('원분류');
    await act(() => view.result.current.inspect(view.result.current.operations[0].id));
    expect(f.apply).toHaveBeenCalledOnce();
    expect(view.result.current.addingCat).toBe(false);
    expect(view.result.current.operations).toHaveLength(0);
});
it('미확정창을닫고새작성한뒤옛inspect완료가새입력이나창을닫지않는다', async () => {
    const f = fixture();
    f.apply.mockImplementationOnce(async (request) => { f.records.set(request.reference.planId, await f.reply(request)); throw Error('lost'); });
    const view = renderHook(() => useDocumentCategories(f.options));
    await ready(view.result);
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('A'); });
    await act(() => view.result.current.addCategory());
    const id = view.result.current.operations[0].id;
    act(() => { view.result.current.cancelAddCategory(); view.result.current.openAddCategory(); view.result.current.changeCategoryName('B'); });
    await act(() => view.result.current.inspect(id));
    expect(view.result.current.addingCat).toBe(true);
    expect(view.result.current.newCatName).toBe('B');
    expect(f.apply).toHaveBeenCalledOnce();
});
it('같은회사UID·직원교체와A복귀에서도oldACK·oldfinally는새초안을지우지않는다', async () => {
    for (const field of ['actorUid', 'employeeId'] as const) {
        const f = fixture(), gate = deferred<void>();
        f.apply.mockImplementationOnce(async (request) => { const result = await f.reply(request); await gate.promise; return result; });
        const view = renderHook(({ value }) => useDocumentCategories({ ...f.options, [field]: value }), { initialProps: { value: field === 'actorUid' ? 'A' : 'employee' } });
        await ready(view.result);
        act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('A 입력'); });
        let old!: Promise<void>;
        act(() => { old = view.result.current.addCategory(); });
        await waitFor(() => expect(f.apply).toHaveBeenCalledOnce());
        if (field === 'actorUid')
            auth.currentUser.uid = 'B';
        view.rerender({ value: 'B' });
        await ready(view.result);
        act(() => view.result.current.changeCategoryName('B 입력'));
        await act(async () => { gate.resolve(); await old; });
        expect(view.result.current.newCatName).toBe('B 입력');
        expect(view.result.current.addingCat).toBe(true);
        view.unmount();
        auth.currentUser.uid = 'A';
    }
});
it('삭제확인대기중동기중복·scope변경·unmount뒤는업무0이다', async () => {
    const f = fixture(), gate = deferred<boolean>(), confirm = vi.fn(() => gate.promise);
    const view = renderHook(({ employeeId }) => useDocumentCategories({ ...f.options, employeeId, confirm }), { initialProps: { employeeId: 'employee' } });
    await ready(view.result);
    let a!: Promise<void>, b!: Promise<void>;
    act(() => { a = view.result.current.deleteCategory(category); b = view.result.current.deleteCategory(category); });
    expect(confirm).toHaveBeenCalledOnce();
    view.rerender({ employeeId: 'other' });
    await act(async () => { gate.resolve(true); await Promise.all([a, b]); });
    expect(f.apply).not.toHaveBeenCalled();
    view.unmount();
});
it('파일·중분류가있는삭제는확인과송신을하지않고원행presence를보존한다', async () => {
    const f = fixture(), confirm = vi.fn(async () => true), view = renderHook(({ blocked }) => useDocumentCategories({ ...f.options, confirm, docCountByCat: new Map([['자료', blocked ? 1 : 0]]) }), { initialProps: { blocked: true } });
    await ready(view.result);
    await act(() => view.result.current.deleteCategory(category));
    expect(confirm).not.toHaveBeenCalled();
    view.rerender({ blocked: false });
    await act(() => view.result.current.deleteCategory(category));
    expect(f.apply.mock.calls[0][0]).toMatchObject({ action: 'deleteCategory', targetId: 'category' });
    expect(f.apply.mock.calls[0][0].action === 'deleteCategory' && f.apply.mock.calls[0][0].opening).toEqual(['map', [['name', ['string', '자료']]]]);
});
it('defaultseed세고정ID와ensurePath두ID는한원자요청씩만작성한다', async () => {
    const f = fixture(), view = renderHook(() => useDocumentCategories({ ...f.options, categories: [], seed: [{ category: '서류관리', subCategory: '생산판매' }] }));
    await ready(view.result);
    await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(2));
    const seed = f.apply.mock.calls[0][0], path = f.apply.mock.calls[1][0];
    expect(seed.action).toBe('seedDefaults');
    expect(seed.action === 'seedDefaults' && new Set(seed.categoryIds).size).toBe(3);
    expect(path).toMatchObject({ action: 'ensurePath', category: '서류관리', subCategory: '생산판매' });
    await act(() => view.result.current.refresh());
    expect(f.apply).toHaveBeenCalledTimes(2);
});
it('seed준비전보관실패는명시refresh로재개하고미확정seed는자동재송신하지않는다', async () => {
    const f = fixture();
    f.storage.setItem.mockImplementationOnce(() => { throw Error('quota'); });
    const view = renderHook(() => useDocumentCategories({ ...f.options, categories: [] }));
    await ready(view.result);
    await waitFor(() => expect(view.result.current.message).toContain('quota'));
    expect(f.apply).not.toHaveBeenCalled();
    await act(() => view.result.current.refresh());
    await waitFor(() => expect(f.apply).toHaveBeenCalledOnce());
    view.unmount();
    const g = fixture();
    g.apply.mockRejectedValueOnce(Error('lost'));
    const second = renderHook(() => useDocumentCategories({ ...g.options, categories: [] }));
    await ready(second.result);
    await waitFor(() => expect(g.apply).toHaveBeenCalledOnce());
    await act(() => second.result.current.refresh());
    expect(g.apply).toHaveBeenCalledOnce();
    expect(second.result.current.operations).toHaveLength(1);
    await act(() => second.result.current.cancel(second.result.current.operations[0].id));
    expect(g.apply).toHaveBeenCalledOnce();
});
it('부분정리실패는현재폼과원인·다음행동을유지하고조회뒤에만닫는다', async () => {
    const f = fixture();
    f.storage.removeItem.mockImplementationOnce(() => { throw Error('cleanup'); });
    const view = renderHook(() => useDocumentCategories(f.options));
    await ready(view.result);
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('원분류'); });
    await act(() => view.result.current.addCategory());
    expect(view.result.current.addingCat).toBe(true);
    expect(view.result.current.message).toContain('다시 저장하지 말고');
    expect(view.result.current.operations).toHaveLength(1);
    await act(() => view.result.current.inspect(view.result.current.operations[0].id));
    expect(view.result.current.addingCat).toBe(false);
    expect(f.apply).toHaveBeenCalledOnce();
});
it('초기read대기와stale함수진입은송신0이며새원문필드를조립하지않는다', async () => {
    const f = fixture(), gate = deferred<void>();
    vi.mocked(f.port.assertScope).mockImplementationOnce(async () => { await gate.promise; });
    const view = renderHook(({ employeeId }) => useDocumentCategories({ ...f.options, employeeId }), { initialProps: { employeeId: 'employee' } });
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('조기'); });
    await act(() => view.result.current.addCategory());
    expect(f.apply).not.toHaveBeenCalled();
    await act(async () => gate.resolve());
    await ready(view.result);
    const old = view.result.current;
    view.rerender({ employeeId: 'other' });
    await act(() => old.deleteCategory(category));
    expect(f.apply).not.toHaveBeenCalled();
});
it('구독행이늦어도대중분류ACK선택과원래중분류추가순서를보존한다', async () => {
    const f = fixture(), view = renderHook(() => useDocumentCategories({ ...f.options, subCategories: [{ id: 'sub', companyId: 'taebaek', category: '자료', name: '기존', order: 0, createdAt: '2026-10-19' }] }));
    await ready(view.result);
    act(() => { view.result.current.openAddSubCategory(); view.result.current.changeSubName(' 새 중분류 '); });
    await act(() => view.result.current.addSubCategory());
    expect(f.apply.mock.calls[0][0]).toMatchObject({ action: 'createSubCategory', category: '자료', name: '새 중분류', order: 1 });
    expect(view.result.current.activeSub).toBe('새 중분류');
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('신규 대분류'); });
    await act(() => view.result.current.addCategory());
    expect(view.result.current.activeCat).toBe('신규 대분류');
});
it('서버이력빈cursor·본인이력조회는현재새폼을닫거나원문없이재실행하지않는다', async () => {
    const f = fixture(), ref = { companyId: 'taebaek' as const, planId: 'server-plan' }, server: DocumentCategoryResult = { version: 1, reference: ref, actorUid: 'A', employeeId: 'employee', requestHash: 'b'.repeat(64), status: 'applied', message: '서버 생성완료' };
    f.records.set(ref.planId, server);
    const original = f.command.getMockImplementation()!;
    f.command.mockImplementation(async (input) => input.mode === 'listPending' ? { version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: input.cursor ? [{ result: server, label: '서버 분류' }] : [], nextCursor: input.cursor ? null : 'c'.repeat(64) } : original(input));
    const view = renderHook(() => useDocumentCategories(f.options));
    await ready(view.result);
    expect(f.command.mock.calls.some(([input]) => input.mode === 'listPending')).toBe(false);
    await act(() => view.result.current.refresh());
    expect(view.result.current.historyMore).toBe(true);
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('새 입력'); });
    await act(() => view.result.current.nextPage());
    expect(view.result.current.operations[0]).toMatchObject({ description: '서버 분류', canRetry: false, canDiscard: false, serverOnly: true });
    const id = view.result.current.operations[0].id;
    await act(() => view.result.current.inspect(id));
    await act(() => view.result.current.retry(id));
    expect(view.result.current.newCatName).toBe('새 입력');
    expect(view.result.current.addingCat).toBe(true);
    expect(f.apply).not.toHaveBeenCalled();
});
it('손상보관과다른hash는서버완료를표시하되현재새폼과관측사본을명시정리로분리한다', async () => {
    const f = fixture();
    f.apply.mockImplementationOnce(async (request) => { f.records.set(request.reference.planId, await f.reply(request)); throw Error('lost'); });
    const view = renderHook(() => useDocumentCategories(f.options));
    await ready(view.result);
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('A'); });
    await act(() => view.result.current.addCategory());
    const row = view.result.current.operations[0], body = JSON.parse(f.values.get(row.id)!);
    body.description = 'B 관측사본';
    body.request.name = 'B';
    body.requestHash = (await f.reply(body.request)).requestHash;
    const sidecar = JSON.parse(f.values.get(row.id + ':ref')!);
    sidecar.requestHash = body.requestHash;
    f.values.set(row.id, JSON.stringify(body));
    f.values.set(row.id + ':ref', JSON.stringify(sidecar));
    act(() => { view.result.current.cancelAddCategory(); view.result.current.openAddCategory(); view.result.current.changeCategoryName('현재 입력'); });
    await act(() => view.result.current.inspect(row.id));
    expect(view.result.current.operations[0].description).toBe('B 관측사본');
    expect(view.result.current.message).toContain('원문이 달라');
    const observed = view.result.current.operations[0].observedLocalText!;
    await act(() => view.result.current.discard(row.id, observed));
    expect(f.values.size).toBe(0);
    expect(view.result.current.newCatName).toBe('현재 입력');
    expect(view.result.current.addingCat).toBe(true);
    expect(f.apply).toHaveBeenCalledOnce();
});
it('조회오류는부재가아니며준비일부만보관되면자동seed새ID를만들지않는다', async () => {
    const f = fixture();
    f.storage.setItem.mockImplementationOnce((key, text) => { f.values.set(key, text); }).mockImplementationOnce(() => { throw Error('sidecar quota'); });
    const view = renderHook(() => useDocumentCategories({ ...f.options, categories: [] }));
    await ready(view.result);
    await waitFor(() => expect(view.result.current.operations).toHaveLength(1));
    expect(f.apply).not.toHaveBeenCalled();
    expect(view.result.current.operations[0].canRetry).toBe(false);
    await act(() => view.result.current.refresh());
    expect(f.apply).not.toHaveBeenCalled();
    expect(view.result.current.operations).toHaveLength(1);
});
it('같은plan의다른확정원문을관측해도현재A입력을그완료로닫지않는다', async () => {
    const f = fixture();
    f.apply.mockRejectedValueOnce(Error('lost'));
    const view = renderHook(() => useDocumentCategories(f.options));
    await ready(view.result);
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('A'); });
    await act(() => view.result.current.addCategory());
    const row = view.result.current.operations[0], body = JSON.parse(f.values.get(row.id)!);
    body.request.name = 'B';
    body.description = 'B';
    const confirmed = await f.reply(body.request);
    body.requestHash = confirmed.requestHash;
    const sidecar = JSON.parse(f.values.get(row.id + ':ref')!);
    sidecar.requestHash = body.requestHash;
    f.values.set(row.id, JSON.stringify(body));
    f.values.set(row.id + ':ref', JSON.stringify(sidecar));
    f.records.set(confirmed.reference.planId, confirmed);
    await act(() => view.result.current.inspect(row.id));
    expect(view.result.current.operations[0].description).toBe('B');
    await act(() => view.result.current.inspect(row.id));
    expect(view.result.current.addingCat).toBe(true);
    expect(view.result.current.newCatName).toBe('A');
    expect(view.result.current.message).toContain('현재');
    expect(f.apply).toHaveBeenCalledOnce();
});
it('초기진입은로컬원문만자동조회하고과거종결이력은명시조회뒤에만표시한다', async () => {
    const f = fixture();
    const request: DocumentCategoryRequest = {version:1,reference:{companyId:'taebaek',planId:'local-plan'},action:'createCategory',categoryId:'local-category',name:'로컬 원문',order:1,createdAt:'2026-10-19'};
    await f.writes.prepare({companyId:'taebaek',actorUid:'A',employeeId:'employee'},request,'로컬 원문');
    const server = {...await f.reply(request),reference:{companyId:'taebaek' as const,planId:'past-terminal'},message:'지난 처리 완료'};
    const original=f.command.getMockImplementation()!;
    f.command.mockImplementation(async input=>input.mode==='listPending'?{version:1,companyId:'taebaek',actorUid:'A',employeeId:'employee',entries:[{result:server,label:'지난 분류 이력'}],nextCursor:null}:original(input));
    const view=renderHook(()=>useDocumentCategories(f.options));await ready(view.result);
    expect(f.command).toHaveBeenCalledWith({mode:'inspect',reference:request.reference});
    expect(f.command.mock.calls.filter(([input])=>input.mode==='listPending')).toHaveLength(0);
    expect(view.result.current.operations.map(row=>row.description)).toEqual(['로컬 원문']);
    act(()=>{view.result.current.openAddCategory();view.result.current.changeCategoryName('현재 새 초안');});
    await act(()=>view.result.current.refresh());
    expect(view.result.current.operations.map(row=>row.description)).toContain('지난 분류 이력');
    expect(view.result.current.addingCat).toBe(true);expect(view.result.current.newCatName).toBe('현재 새 초안');expect(f.apply).not.toHaveBeenCalled();
});
it('두기기사본이사라져도동일현재plan의opaque중단확정은옛잠긴폼을종결한다', async () => {
    const f = fixture();
    f.apply.mockRejectedValueOnce(Error('lost'));
    const view = renderHook(() => useDocumentCategories(f.options));
    await ready(view.result);
    act(() => { view.result.current.openAddCategory(); view.result.current.changeCategoryName('원본'); });
    await act(() => view.result.current.addCategory());
    const id = view.result.current.operations[0].id;
    f.values.clear();
    await act(() => view.result.current.cancel(id));
    expect(view.result.current.addingCat).toBe(false);
    expect(view.result.current.newCatName).toBe('');
    expect(f.apply).toHaveBeenCalledOnce();
});
