import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ ready: Promise.resolve() as Promise<void>, user: null as any, listeners: new Set<(user: any) => void>(), initialDifferent: false, claims: async () => ({ claims: { companyId: 'taebaek' } as Record<string, unknown> }), reads: [] as {
        path: string;
        next: (snapshot: any) => void;
        error: (error: Error) => void;
        stop: ReturnType<typeof vi.fn>;
    }[], writes: [] as any[], write: async () => { }, syncReadError: false }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return m.user; } }, get authReady() { return m.ready; }, db: {} }));
vi.mock('firebase/auth', () => ({ onIdTokenChanged: (_auth: unknown, next: (user: any) => void) => { m.listeners.add(next); queueMicrotask(() => { if (m.listeners.has(next))
        next(m.initialDifferent ? { ...m.user, uid: 'different' } : m.user); }); return () => m.listeners.delete(next); } }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => collection + '/' + id, onSnapshot: (path: string, next: (snapshot: any) => void, error: (error: Error) => void) => { const stop = vi.fn(); m.reads.push({ path, next, error, stop }); if (m.syncReadError)
        error(Error('동기 읽기 실패')); return stop; }, setDoc: async (...args: any[]) => { m.writes.push(args); await m.write(); } }));
vi.mock('./firebaseService', () => ({ stripUndefined: (value: unknown) => JSON.parse(JSON.stringify(value)) }));
import { saveOrgChart, subscribeOrgChart, type OrgChartConfig } from './orgChartService';
const config = (): OrgChartConfig => ({ top: { title: '대표', name: '합성' }, departments: [{ id: 'd', keys: ['생산'], name: '부서', headId: undefined, memo: '', tier: 'normal' }] });
const scope = () => ({ companyId: 'taebaek' as const, isCurrent: () => true });
const input = () => ({ ...scope(), employeeId: 'synthetic-employee', config: config() });
const tick = async () => { for (let i = 0; i < 10; i++)
    await Promise.resolve(); };
const emit = (user: any) => { m.user = user; for (const listener of [...m.listeners])
    listener(user); };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
beforeEach(() => { m.ready = Promise.resolve(); m.listeners.clear(); m.initialDifferent = false; m.claims = async () => ({ claims: { companyId: 'taebaek' } }); m.user = { uid: 'a', getIdTokenResult: () => m.claims() }; m.reads = []; m.writes = []; m.write = async () => { }; m.syncReadError = false; });
afterEach(() => { vi.useRealTimers(); });
it('정확 회사 ID/회사 patch와 undefined제거·merge true로 저장하고 새로운 역할조건은 요구하지 않는다', async () => { await saveOrgChart(input()); expect(m.writes).toHaveLength(1); expect(m.writes[0][0]).toBe('settings/taebaek__orgChart'); expect(m.writes[0][1]).toMatchObject({ ...config(), departments: [{ id: 'd', keys: ['생산'], name: '부서', memo: '', tier: 'normal' }], companyId: 'taebaek' }); expect(m.writes[0][1].updatedAt).toMatch(/^\d{4}-/); expect(m.writes[0][1].departments[0]).not.toHaveProperty('headId'); expect(m.writes[0][2]).toEqual({ merge: true }); expect(m.listeners.size).toBe(0); });
it('송신 전 입력 전체를 캡처하여 await 중 원본변경을 저장하지 않는다', async () => { const ready = deferred<void>(); m.ready = ready.promise; const selected = input(), task = saveOrgChart(selected); selected.config.top.name = '늦은 변경'; selected.config.departments[0].keys.push('다른부서'); ready.resolve(); await task; expect(m.writes[0][1].top.name).toBe('합성'); expect(m.writes[0][1].departments[0].keys).toEqual(['생산']); });
it('회사 claim이 다르거나 없으면 실제 setDoc을 보내지 않는다', async () => { for (const companyId of ['punghoe', undefined]) {
    m.claims = async () => ({ claims: { companyId } });
    await expect(saveOrgChart(input())).rejects.toThrow();
} expect(m.writes).toHaveLength(0); expect(m.listeners.size).toBe(0); });
it('외부 owner가 준비대기 중 끝나면 저장0이다', async () => { const ready = deferred<void>(); m.ready = ready.promise; let current = true; const task = saveOrgChart({ ...input(), isCurrent: () => current }); current = false; ready.resolve(); await expect(task).rejects.toThrow(); expect(m.writes).toHaveLength(0); });
it('토큰 조회 대기 중 UID A-B-A는 원래 User로 돌아와도 저장0이다', async () => { const claim = deferred<{
    claims: Record<string, unknown>;
}>(); m.claims = () => claim.promise; const a = m.user, task = saveOrgChart(input()); await tick(); emit({ ...a, uid: 'b' }); emit(a); claim.resolve({ claims: { companyId: 'taebaek' } }); await expect(task).rejects.toThrow(); expect(m.writes).toHaveLength(0); expect(m.listeners.size).toBe(0); });
it('같은 UID token event도 옛 시도를 무효화하고 새 명시 저장은 허용한다', async () => { const claim = deferred<{
    claims: Record<string, unknown>;
}>(); m.claims = () => claim.promise; const task = saveOrgChart(input()); await tick(); emit(m.user); claim.resolve({ claims: { companyId: 'taebaek' } }); await expect(task).rejects.toThrow(); expect(m.writes).toHaveLength(0); m.claims = async () => ({ claims: { companyId: 'taebaek' } }); await saveOrgChart(input()); expect(m.writes).toHaveLength(1); });
it('이벤트없는 User 객체 교체도 claims await 뒤 차단한다', async () => { const claim = deferred<{
    claims: Record<string, unknown>;
}>(); m.claims = () => claim.promise; const task = saveOrgChart(input()); await tick(); m.user = { ...m.user }; claim.resolve({ claims: { companyId: 'taebaek' } }); await expect(task).rejects.toThrow(); expect(m.writes).toHaveLength(0); });
it('authReady/token조회/쓰기 거절 모두 reject하고 listener를 정리한다', async () => { m.ready = Promise.reject(Error('준비 실패')); await expect(saveOrgChart(input())).rejects.toThrow('준비 실패'); m.ready = Promise.resolve(); m.claims = async () => { throw Error('토큰 실패'); }; await expect(saveOrgChart(input())).rejects.toThrow('토큰 실패'); m.claims = async () => ({ claims: { companyId: 'taebaek' } }); m.write = async () => { throw Error('저장 실패'); }; await expect(saveOrgChart(input())).rejects.toThrow('저장 실패'); expect(m.listeners.size).toBe(0); });
it('이미 송신된 쓰기는 취소하지 못하지만 늦은 ACK를 현재 성공으로 반환하지 않는다', async () => { const write = deferred<void>(); m.write = () => write.promise; let current = true; const task = saveOrgChart({ ...input(), isCurrent: () => current }); await tick(); expect(m.writes).toHaveLength(1); current = false; write.resolve(); await expect(task).rejects.toThrow(); expect(m.writes).toHaveLength(1); });
it('로그인없음·첫listener다름은 저장과 구독을 거절한다', async () => { m.user = null; await expect(saveOrgChart(input())).rejects.toThrow(); m.user = { uid: 'a', getIdTokenResult: () => m.claims() }; m.initialDifferent = true; await expect(saveOrgChart(input())).rejects.toThrow(); expect(m.writes).toHaveLength(0); expect(m.listeners.size).toBe(0); });
it('구독은 정확회사 문서만 받고 missing은 null·원문빈필드는 보존한다', async () => { const value = vi.fn(), error = vi.fn(), stop = subscribeOrgChart(scope(), value, error); await tick(); expect(m.reads[0].path).toBe('settings/taebaek__orgChart'); m.reads[0].next({ exists: () => true, data: () => ({ top: { title: '', name: '' }, departments: [] }) }); expect(value).toHaveBeenLastCalledWith({ top: { title: '', name: '' }, departments: [] }); m.reads[0].next({ exists: () => false }); expect(value).toHaveBeenLastCalledWith(null); expect(error).not.toHaveBeenCalled(); stop(); expect(m.listeners.size).toBe(0); });
it('명시 unsubscribe 뒤 snapshot과 error는 전달하지 않는다', async () => { const value = vi.fn(), error = vi.fn(), stop = subscribeOrgChart(scope(), value, error); await tick(); stop(); m.reads[0].next({ exists: () => true, data: config }); m.reads[0].error(Error('옛 오류')); expect(value).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(m.reads[0].stop).toHaveBeenCalled(); expect(m.listeners.size).toBe(0); });
it('구독의 같은 UID 후속event는 오류1회와 unsubscribe로 끝나며 이전 snapshot은 차단한다', async () => { const value = vi.fn(), error = vi.fn(), stop = subscribeOrgChart(scope(), value, error); await tick(); emit(m.user); m.reads[0].next({ exists: () => true, data: config }); expect(error).toHaveBeenCalledOnce(); expect(value).not.toHaveBeenCalled(); expect(m.reads[0].stop).toHaveBeenCalled(); expect(m.listeners.size).toBe(0); stop(); });
it('구독 owner가 바뀌면 옛 오류도 새화면에 보내지 않는다', async () => { let current = true; const value = vi.fn(), error = vi.fn(), stop = subscribeOrgChart({ ...scope(), isCurrent: () => current }, value, error); await tick(); current = false; emit({ ...m.user, uid: 'b' }); m.reads[0].next({ exists: () => true, data: config }); expect(value).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); stop(); });
it.each([false, true])('snapshot 오류는 %s 동기 여부에도 auth/read listener를 정리한다', async (sync) => { m.syncReadError = sync; const value = vi.fn(), error = vi.fn(), stop = subscribeOrgChart(scope(), value, error); await tick(); if (!sync)
    m.reads[0].error(Error('읽기 실패')); expect(error).toHaveBeenCalledOnce(); expect(m.listeners.size).toBe(0); expect(m.reads[0].stop).toHaveBeenCalled(); stop(); });
it('구독 준비거절과 권한회사불일치는 error로 종결하며 snapshot을 시작하지 않는다', async () => { m.ready = Promise.reject(Error('준비 거절')); const error = vi.fn(), stop = subscribeOrgChart(scope(), vi.fn(), error); await tick(); expect(error).toHaveBeenCalledOnce(); expect(m.reads).toHaveLength(0); expect(m.listeners.size).toBe(0); stop(); });
it('구독 claim회사가 다르면 snapshot0·error1과 listener정리를 지킨다', async () => { m.claims = async () => ({ claims: { companyId: 'punghoe' } }); const error = vi.fn(), stop = subscribeOrgChart(scope(), vi.fn(), error); await tick(); expect(error).toHaveBeenCalledOnce(); expect(m.reads).toHaveLength(0); expect(m.listeners.size).toBe(0); stop(); });
it('준비 중 구독해제는 늦은 authReady 뒤 snapshot을 만들지 않는다', async () => { const ready = deferred<void>(); m.ready = ready.promise; const value = vi.fn(), error = vi.fn(), stop = subscribeOrgChart(scope(), value, error); stop(); ready.resolve(); await tick(); expect(m.reads).toHaveLength(0); expect(value).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(m.listeners.size).toBe(0); });
