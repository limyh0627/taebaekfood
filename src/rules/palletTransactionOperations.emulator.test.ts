import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
const enabled = process.env.PALLET_TRANSACTION_RULES_TEST === 'true';
let environment: RulesTestEnvironment;
const collections = ['palletTransactionOperations', 'pallets', 'palletTransactions'];
describe.skipIf(!enabled)('파렛트 처리 증거 직접 접근 차단과 기존 직원 권한', () => {
    beforeAll(async () => {
        environment = await initializeTestEnvironment({ projectId: `demo-pallet-rules-${randomUUID().slice(0, 8)}`, firestore: { host: '127.0.0.1', port: 8182, rules: readFileSync('firestore.rules', 'utf8') } });
        await environment.withSecurityRulesDisabled(async (context) => {
            for (const name of collections)
                await setDoc(doc(context.firestore(), name, 'owned-proof'), { companyId: 'taebaek', actorUid: 'actor', total: 10 });
        });
    }, 30000);
    afterAll(async () => {
        if (!environment)
            return;
        await environment.withSecurityRulesDisabled(async (context) => {
            for (const name of collections) {
                for (const id of ['owned-proof', 'owned-created'])
                    await deleteDoc(doc(context.firestore(), name, id));
            }
        });
        await environment.cleanup();
    });
    for (const companyId of ['taebaek', 'punghoe'])
        for (const isAdmin of [false, true]) {
            it(`${companyId} ${isAdmin ? '관리자' : '일반 직원'}도 처리 증거를 읽거나 위조하지 못한다`, async () => {
                const db = environment.authenticatedContext('actor', { companyId, employeeId: 'employee', isAdmin }).firestore();
                const ref = doc(db, 'palletTransactionOperations', 'owned-proof');
                await assertFails(getDoc(ref));
                await assertFails(getDocs(query(collection(db, 'palletTransactionOperations'), where('companyId', '==', companyId))));
                await assertFails(setDoc(doc(db, 'palletTransactionOperations', 'owned-created'), { companyId }));
                await assertFails(updateDoc(ref, { total: 99 }));
                await assertFails(deleteDoc(ref));
                await assertFails(setDoc(doc(ref, 'nested', 'proof'), { companyId }));
            });
        }
    it('기존 같은 회사 일반 직원의 파렛트·거래 읽기와 쓰기 권한은 보존한다', async () => {
        const db = environment.authenticatedContext('actor', { companyId: 'taebaek', employeeId: 'employee', isAdmin: false }).firestore();
        for (const name of ['pallets', 'palletTransactions']) {
            await assertSucceeds(getDoc(doc(db, name, 'owned-proof')));
            await assertSucceeds(getDocs(query(collection(db, name), where('companyId', '==', 'taebaek'))));
            const ref = doc(db, name, 'owned-created');
            await assertSucceeds(setDoc(ref, { companyId: 'taebaek', total: 12 }));
            await assertSucceeds(updateDoc(ref, { total: 13 }));
            await assertSucceeds(deleteDoc(ref));
        }
    });
    it('기존 다른 회사 파렛트·거래 권한은 확대하지 않는다', async () => {
        const db = environment.authenticatedContext('foreign', { companyId: 'punghoe', employeeId: 'employee', isAdmin: false }).firestore();
        for (const name of ['pallets', 'palletTransactions']) {
            await assertFails(getDoc(doc(db, name, 'owned-proof')));
            await assertFails(updateDoc(doc(db, name, 'owned-proof'), { total: 13 }));
        }
    });
});
