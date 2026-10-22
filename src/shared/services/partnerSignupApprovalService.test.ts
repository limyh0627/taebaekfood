/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import type { PartnerSignupUser } from './partnerSignupApprovalService';
const m = vi.hoisted(() => ({ user: { uid: 'admin', getIdTokenResult: vi.fn() }, ready: Promise.resolve(), docs: new Map<string, Record<string, unknown>>(), writes: [] as {
        path: string;
        data: Record<string, unknown>;
    }[], listeners: new Set<(user: unknown) => void>(), query: [] as unknown[], fail: false, afterCommit: () => { } }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return m.user; } }, get authReady() { return m.ready; }, db: {} }));
vi.mock('firebase/auth', () => ({ onIdTokenChanged: (_auth: unknown, cb: (user: unknown) => void) => { m.listeners.add(cb); queueMicrotask(() => { if (m.listeners.has(cb))
        cb(m.user); }); return () => m.listeners.delete(cb); } }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => collection + '/' + id, collection: (_db: unknown, name: string) => name, where: (field: string, op: string, value: unknown) => ({ field, op, value }), query: (...parts: unknown[]) => { m.query = parts; return parts; }, onSnapshot: (_q: unknown, cb: (snapshot: unknown) => void) => { cb({ docs: [] }); return () => { }; }, getDocFromServer: async (path: string) => snapshot(path), runTransaction: async (_db: unknown, cb: (tx: unknown) => Promise<void>) => { const pending: {
        path: string;
        data: Record<string, unknown>;
    }[] = []; await cb({ get: async (path: string) => snapshot(path), update: (path: string, data: Record<string, unknown>) => pending.push({ path, data }) }); if (m.fail)
        throw Error('응답 유실'); for (const write of pending) {
        m.writes.push(write);
        m.docs.set(write.path, { ...m.docs.get(write.path), ...write.data });
    } m.afterCommit(); } }));
import { decidePartnerSignup, readPartnerSignup, subscribePendingPartnerSignups, PartnerSignupError, capturePartnerSignupOriginal } from './partnerSignupApprovalService';
function snapshot(path: string) { return { id: path.split('/')[1], exists: () => m.docs.has(path), data: () => m.docs.get(path) }; }
const row: PartnerSignupUser = { id: 'u', companyId: 'taebaek', uid: 'customer', name: '신청자', status: 'pending', linkedPartnerId: null };
const scope = { companyId: 'taebaek' as const, actorUid: 'admin', isCurrent: () => true };
beforeEach(() => { m.docs.clear(); m.writes = []; m.listeners.clear(); m.fail = false; m.afterCommit = () => { }; m.ready = Promise.resolve(); m.user = { uid: 'admin', getIdTokenResult: vi.fn().mockResolvedValue({ claims: { companyId: 'taebaek', employeeId: 'admin', isAdmin: true } }) }; m.docs.set('users/u', { ...row, hidden: '보존' }); m.docs.set('partners/p', { companyId: 'taebaek', name: '현재 이름' }); });
it('pending 구독은 회사와 상태조건을 함께 사용하고 dispose한다', async () => { const values = vi.fn(), error = vi.fn(); const stop = subscribePendingPartnerSignups(scope, values, error); await vi.waitFor(() => expect(values).toHaveBeenCalledWith([])); expect(m.query).toContainEqual({ field: 'companyId', op: '==', value: 'taebaek' }); expect(m.query).toContainEqual({ field: 'status', op: '==', value: 'pending' }); stop(); expect(m.listeners.size).toBe(0); });
it('승인은 현재 거래처 이름과 기존필드만 patch하고 미소유필드를 보존한다', async () => { await decidePartnerSignup(scope, { original: row, decision: 'approve', partnerId: 'p' }); expect(m.docs.get('users/u')).toMatchObject({ status: 'approved', linkedPartnerId: 'p', linkedPartnerName: '현재 이름', hidden: '보존' }); expect(Object.keys(m.writes[0].data).sort()).toEqual(['approvedAt', 'linkedPartnerId', 'linkedPartnerName', 'status']); });
it('거절은 기존 연결값을 바꾸지 않고 status와 날짜만 수정한다', async () => { await decidePartnerSignup(scope, { original: row, decision: 'reject' }); expect(m.docs.get('users/u')).toMatchObject({ status: 'rejected', linkedPartnerId: null }); expect(Object.keys(m.writes[0].data).sort()).toEqual(['rejectedAt', 'status']); });
it.each(['absent', 'status', 'identity', 'link', 'company', 'partner'] as const)('%s 경합은 쓰기와 삭제대상 재생성을 막는다', async (mode) => { if (mode === 'absent')
    m.docs.delete('users/u');
else if (mode === 'partner')
    m.docs.set('partners/p', { companyId: 'punghoe', name: '외부' });
else
    m.docs.set('users/u', { ...row, ...(mode === 'status' ? { status: 'approved' } : mode === 'identity' ? { name: '다른 신청자' } : mode === 'link' ? { linkedPartnerId: 'other' } : { companyId: 'punghoe' }) }); await expect(decidePartnerSignup(scope, { original: row, decision: 'approve', partnerId: 'p' })).rejects.toMatchObject({ outcome: 'not-started' }); expect(m.writes).toHaveLength(0); if (mode === 'absent')
    expect(m.docs.has('users/u')).toBe(false); });
it('관리자권한 없는 현재 actor는 시작하지 않는다', async () => { m.user.getIdTokenResult.mockResolvedValue({ claims: { companyId: 'taebaek', employeeId: 'staff', isAdmin: false } }); await expect(decidePartnerSignup(scope, { original: row, decision: 'reject' })).rejects.toMatchObject({ outcome: 'not-started' }); expect(m.writes).toHaveLength(0); });
it('claims await 중 원user uid가 바뀌면 송신하지 않는다', async () => { let release!: (v: unknown) => void; m.user.getIdTokenResult.mockReturnValue(new Promise(r => release = r)); const call = decidePartnerSignup(scope, { original: row, decision: 'reject' }); await vi.waitFor(() => expect(m.user.getIdTokenResult).toHaveBeenCalled()); m.user.uid = 'other'; release({ claims: { companyId: 'taebaek', employeeId: 'a', isAdmin: true } }); await expect(call).rejects.toMatchObject({ outcome: 'not-started' }); expect(m.writes).toHaveLength(0); });
it('commit 통신실패는 미처리로 단정하지 않는다', async () => { m.fail = true; await expect(decidePartnerSignup(scope, { original: row, decision: 'reject' })).rejects.toMatchObject({ outcome: 'unknown' }); });
it('현재 단건조회는 없음/현재상태만 반환하고 새쓰기를 하지 않는다', async () => { expect(await readPartnerSignup(scope, 'u')).toMatchObject(row); m.docs.delete('users/u'); expect(await readPartnerSignup(scope, 'u')).toBeNull(); expect(m.writes).toHaveLength(0); });
it('공개 original은 미지 객체를 복제하거나 hash로 끌어들이지 않는다', () => { const input = { ...row, hidden: { sdk: true } }; expect(capturePartnerSignupOriginal(input)).toEqual(row); });
it('commit 뒤 현재성이 사라져도 미시작으로 분류하지 않는다', async () => { let current = true; m.afterCommit = () => { current = false; }; await expect(decidePartnerSignup({ ...scope, isCurrent: () => current }, { original: row, decision: 'reject' })).rejects.toMatchObject({ outcome: 'unknown' }); expect(m.docs.get('users/u')?.status).toBe('rejected'); });
