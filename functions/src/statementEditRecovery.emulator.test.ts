import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { editIssuedStatement } from './editIssuedStatementCommand';
import { recoverStatementEdit, statementEditDiscoveryScopeKey } from './statementEditRecovery';
const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const run = 'edit-recovery-' + randomUUID(), uid = run + '-uid', release = run;
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const ref = (path: string) => {
    owned.add(path);
    return db.doc(path);
};
const auth = (companyId = 'taebaek', actor = uid) => ({ uid: actor, token: { isAdmin: true, employeeId: 'employee', companyId } });
const reference = (operationId: string, statementId: string) => ({ companyId: 'taebaek' as const, operationId, statementId });
async function fixture() {
    const id = run + '-' + randomUUID(), op = run + '-' + randomUUID();
    await ref('issuedStatements/' + id).set({ companyId: 'taebaek', mutationRevision: 0, partnerId: '', memo: '원문', totalAmount: 100 });
    ref('voucherMutationOperations/' + op);
    return { id, op, input: { auth: auth(), data: { statementId: id, operationId: op, releaseId: release, expectedRevision: 0, patch: { memo: '수정' } } } };
}
describe.skipIf(!available)('전표 수정 영속복구 실제 Firestore SDK', { timeout: 30000 }, () => {
    beforeAll(async () => {
        app = admin.initializeApp({ projectId: 'demo-' + randomUUID().slice(0, 12) }, run);
        db = admin.firestore(app);
        await ref('appMeta/releaseCutover').set({ status: 'active', releaseId: release });
    });
    afterAll(async () => {
        if (db)
            for (const path of owned)
                await db.doc(path).delete();
        if (app)
            await app.delete();
    });
    it('동일원문 동시 적용은 once/duplicate이며 영수증 본문hash를 반환한다', async () => {
        const f = await fixture();
        const values = await Promise.all([editIssuedStatement(db, f.input), editIssuedStatement(db, f.input)]);
        expect(values.map(v => (v as any).status).sort()).toEqual(['applied', 'duplicate']);
        expect((await db.doc('issuedStatements/' + f.id).get()).get('mutationRevision')).toBe(1);
        expect((values[0] as any).requestHash).toMatch(/^[a-f0-9]{64}$/);
    });
    it('적용 뒤 gate교체·본문삭제도 과거 조회와 duplicate를 막지 않는다', async () => {
        const f = await fixture();
        await editIssuedStatement(db, f.input);
        await db.doc('issuedStatements/' + f.id).delete();
        await db.doc('appMeta/releaseCutover').update({ status: 'disabled', releaseId: 'changed' });
        try {
            expect((await recoverStatementEdit(db, { auth: auth(), data: { mode: 'inspect', reference: reference(f.op, f.id) } }) as any).status).toBe('applied');
            await expect(editIssuedStatement(db, f.input)).resolves.toMatchObject({ status: 'duplicate' });
        }
        finally {
            await db.doc('appMeta/releaseCutover').set({ status: 'active', releaseId: release });
        }
    });
    it('없는 요청 조회는 unknown/쓰기0·중단은 같은 operation 늦은 apply를 봉쇄한다', async () => {
        const f = await fixture(), r = reference(f.op, f.id);
        expect((await recoverStatementEdit(db, { auth: auth(), data: { mode: 'inspect', reference: r } }) as any).status).toBe('unknown');
        expect((await db.doc('voucherMutationOperations/' + f.op).get()).exists).toBe(false);
        await recoverStatementEdit(db, { auth: auth(), data: { mode: 'cancel', reference: r } });
        await expect(editIssuedStatement(db, f.input)).resolves.toMatchObject({ status: 'cancelled' });
        expect((await db.doc('issuedStatements/' + f.id).get()).get('memo')).toBe('원문');
    });
    it('cancel/apply 경합은 한 terminal만 남고 applied 중단은 역수정하지 않는다', async () => {
        const f = await fixture(), r = reference(f.op, f.id);
        await Promise.all([editIssuedStatement(db, f.input), recoverStatementEdit(db, { auth: auth(), data: { mode: 'cancel', reference: r } })]);
        const receipt = await db.doc('voucherMutationOperations/' + f.op).get(), before = await db.doc('issuedStatements/' + f.id).get();
        expect(['applied', 'cancelled']).toContain(receipt.get('status'));
        expect((await recoverStatementEdit(db, { auth: auth(), data: { mode: 'cancel', reference: r } }) as any).status).toBe(receipt.get('status'));
        expect((await db.doc('issuedStatements/' + f.id).get()).updateTime?.isEqual(before.updateTime!)).toBe(true);
    });
    it('타회사/타UID/타대상/다른원문hash는 기존성공을 재사용하지 않는다', async () => {
        const f = await fixture(), r = reference(f.op, f.id);
        await editIssuedStatement(db, f.input);
        for (const input of [{ auth: auth('punghoe'), data: { mode: 'inspect', reference: { ...r, companyId: 'punghoe' } } }, { auth: auth('taebaek', 'other'), data: { mode: 'inspect', reference: r } }, { auth: auth(), data: { mode: 'inspect', reference: { ...r, statementId: 'different' } } }])
            await expect(recoverStatementEdit(db, input)).rejects.toThrow();
        await expect(editIssuedStatement(db, { ...f.input, data: { ...f.input.data, patch: { memo: '다른사본' } } })).rejects.toThrow('겹쳤습니다');
    });
    it('본인 새 metadata만 조회하고 foreign ID를 cursor에 노출하지 않으며 다중 페이지를 유지한다', async () => {
        const actor = run + '-history';
        for (let i = 0; i < 50; i++)
            await ref('voucherMutationOperations/foreign-' + run + '-' + i).set({ uid: actor, companyId: 'punghoe', statementId: 'foreign-target', action: 'edit-statement', kind: 'issuedStatements', status: 'cancelled', requestHash: null, discoveryScopeKey: statementEditDiscoveryScopeKey('punghoe', actor) });
        for (let i = 0; i < 51; i++)
            await ref('voucherMutationOperations/own-' + run + '-' + String(i).padStart(3, '0')).set({ uid: actor, companyId: 'taebaek', statementId: 'history-target', action: 'edit-statement', kind: 'issuedStatements', status: 'cancelled', requestHash: null, discoveryScopeKey: statementEditDiscoveryScopeKey('taebaek', actor), createdAt: '2026-10-21' });
        await ref('voucherMutationOperations/other-kind-' + run).set({ uid: actor, companyId: 'taebaek', action: 'delete', discoveryScopeKey: JSON.stringify(['taebaek', actor, 'delete']) });
        const first: any = await recoverStatementEdit(db, { auth: auth('taebaek', actor), data: { mode: 'listHistory', companyId: 'taebaek' } });
        expect(first.entries).toHaveLength(50);
        expect(Buffer.from(first.nextCursor, 'base64url').toString()).not.toContain('foreign-');
        const second: any = await recoverStatementEdit(db, { auth: auth('taebaek', actor), data: { mode: 'listHistory', companyId: 'taebaek', cursor: first.nextCursor } });
        expect(second.entries).toHaveLength(1);
        await expect(recoverStatementEdit(db, { auth: auth('punghoe', actor), data: { mode: 'listHistory', companyId: 'punghoe', cursor: first.nextCursor } })).rejects.toThrow('페이지');
    });
    it('새 discovery metadata 없는 과거 receipt는 참조조회만 가능하고 새 이력에 포함했다고 주장하지 않는다', async () => {
        const f = await fixture(), actor = run + '-legacy';
        f.input.auth = auth('taebaek', actor);
        await editIssuedStatement(db, f.input);
        await db.doc('voucherMutationOperations/' + f.op).update({ discoveryScopeKey: admin.firestore.FieldValue.delete() });
        expect((await recoverStatementEdit(db, { auth: auth('taebaek', actor), data: { mode: 'inspect', reference: reference(f.op, f.id) } }) as any).status).toBe('applied');
        expect((await recoverStatementEdit(db, { auth: auth('taebaek', actor), data: { mode: 'listHistory', companyId: 'taebaek' } }) as any).entries).toEqual([]);
    });
    it('실제 두번째 receipt create 충돌 commit은 본문 update까지 rollback한다', async () => {
        const f = await fixture(), block = ref('voucherMutationOperations/' + run + '-block');
        await block.set({ occupied: true });
        const proxy = Object.create(db);
        proxy.runTransaction = (fn: any) => db.runTransaction(tx => fn(new Proxy(tx, { get(target, key) {
                if (key === 'create')
                    return (r: admin.firestore.DocumentReference, data: any) => target.create(r.path === 'voucherMutationOperations/' + f.op ? block : r, data);
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
            } })));
        await expect(editIssuedStatement(proxy, f.input)).rejects.toThrow();
        expect((await db.doc('issuedStatements/' + f.id).get()).get('memo')).toBe('원문');
        expect((await db.doc('voucherMutationOperations/' + f.op).get()).exists).toBe(false);
    });
});
