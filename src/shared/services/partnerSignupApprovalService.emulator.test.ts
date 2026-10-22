/// <reference types="node" />
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
const m = vi.hoisted(() => ({ db: {} as object }));
vi.mock('../firebase', () => ({ get db() { return m.db; }, authReady: Promise.resolve(), auth: { currentUser: { uid: 'admin', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'admin', isAdmin: true } }) } } }));
vi.mock('firebase/auth', () => ({ onIdTokenChanged: (auth: {
        currentUser: unknown;
    }, callback: (user: unknown) => void) => { let active = true; queueMicrotask(() => { if (active)
        callback(auth.currentUser); }); return () => { active = false; }; } }));
import { decidePartnerSignup, readPartnerSignup, type PartnerSignupUser } from './partnerSignupApprovalService';
describe.skipIf(process.env.PARTNER_SIGNUP_SDK !== 'true')('가입승인 실제 로컬 Rules SDK', () => {
    let env: RulesTestEnvironment;
    const projectId = 'demo-partner-signup-' + randomUUID().slice(0, 8), paths = new Set<string>(), scope = { companyId: 'taebaek' as const, actorUid: 'admin', isCurrent: () => true };
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8182, rules: readFileSync('firestore.rules', 'utf8') } }); m.db = env.authenticatedContext('admin', { companyId: 'taebaek', employeeId: 'admin', isAdmin: true }).firestore(); }, 30000);
    afterAll(async () => { if (!env)
        return; await env.withSecurityRulesDisabled(async (ctx) => { for (const path of paths)
        await ctx.firestore().doc(path).delete(); for (const path of paths)
        expect((await ctx.firestore().doc(path).get()).exists).toBe(false); }); await env.cleanup(); }, 30000);
    const admin = () => env.authenticatedContext('admin', { companyId: 'taebaek', employeeId: 'admin', isAdmin: true }).firestore();
    async function seed(path: string, value: Record<string, unknown>) { paths.add(path); await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc(path).set(value)); }
    async function fixture() { const suffix = randomUUID(), row: PartnerSignupUser = { id: 'user-' + suffix, companyId: 'taebaek', uid: 'customer-' + suffix, name: '신청자', status: 'pending', linkedPartnerId: null }, partnerId = 'partner-' + suffix; await seed('users/' + row.id, { ...row, hidden: { keep: 1 } }); await seed('partners/' + partnerId, { companyId: 'taebaek', name: '현재 거래처' }); return { row, partnerId }; }
    it('현Rules에서 status-only 질의는 거절되고 samecompany관리자 질의만 허용된다', async () => { await fixture(); await assertFails(admin().collection('users').where('status', '==', 'pending').get()); await assertSucceeds(admin().collection('users').where('companyId', '==', 'taebaek').where('status', '==', 'pending').get()); const staff = env.authenticatedContext('staff', { companyId: 'taebaek', employeeId: 'staff', isAdmin: false }).firestore(); await assertFails(staff.collection('users').where('companyId', '==', 'taebaek').get()); });
    it('삭제된 가입 신청을 승인해도 부분문서를 다시 만들지 않는다', async () => { const f = await fixture(); await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('users/' + f.row.id).delete()); if (process.env.PARTNER_SIGNUP_BASELINE === 'true') {
        await admin().doc('users/' + f.row.id).set({ companyId: 'taebaek', status: 'approved', linkedPartnerId: f.partnerId }, { merge: true });
    }
    else
        await expect(decidePartnerSignup(scope, { original: f.row, decision: 'approve', partnerId: f.partnerId })).rejects.toThrow('삭제'); expect((await admin().doc('users/' + f.row.id).get()).exists).toBe(false); });
    it('동일 pending 두 처리경합은 한 승자만 있고 나머지는 현재상태충돌이다', async () => { const f = await fixture(); const results = await Promise.allSettled([decidePartnerSignup(scope, { original: f.row, decision: 'approve', partnerId: f.partnerId }), decidePartnerSignup(scope, { original: f.row, decision: 'reject' })]); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter(r => r.status === 'rejected')).toHaveLength(1); const row = await readPartnerSignup(scope, f.row.id); expect(['approved', 'rejected']).toContain(row?.status); });
    it('거래처 현재이름으로 patch하고 미소유 중첩필드는 유지한다', async () => { const f = await fixture(); await decidePartnerSignup(scope, { original: f.row, decision: 'approve', partnerId: f.partnerId }); expect((await admin().doc('users/' + f.row.id).get()).data()).toMatchObject({ linkedPartnerName: '현재 거래처', hidden: { keep: 1 }, status: 'approved' }); });
    it.each(['identity', 'link'] as const)('%s 변경은 원자 CAS 거절되고 원문을 덮지 않는다', async (mode) => { const f = await fixture(); const patch = mode === 'identity' ? { name: '다른 신청자' } : { linkedPartnerId: 'other' }; await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('users/' + f.row.id).update(patch)); await expect(decidePartnerSignup(scope, { original: f.row, decision: 'approve', partnerId: f.partnerId })).rejects.toThrow('변경'); expect((await admin().doc('users/' + f.row.id).get()).data()).toMatchObject({ status: 'pending', ...patch }); });
    it('타회사 신청과 타회사 거래처는 현재Rules에서 읽기·연결할 수 없다', async () => { const f = await fixture(); await seed('users/foreign-' + f.row.id, { companyId: 'punghoe', status: 'pending' }); await assertFails(admin().doc('users/foreign-' + f.row.id).get()); await seed('partners/' + f.partnerId, { companyId: 'punghoe', name: '외부' }); await expect(decidePartnerSignup(scope, { original: f.row, decision: 'approve', partnerId: f.partnerId })).rejects.toThrow(); expect((await admin().doc('users/' + f.row.id).get()).data()?.status).toBe('pending'); });
});
