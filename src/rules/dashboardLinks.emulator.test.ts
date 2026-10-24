import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
const enabled = process.env.DASHBOARD_LINK_RULES_TEST === 'true';
const projectId = process.env.DASHBOARD_LINK_TEST_PROJECT || 'demo-dashboard-links-d';
let environment: RulesTestEnvironment;
const ids = ['taebaek-link', 'punghoe-link', 'created-link'];
describe.skipIf(!enabled)('바로가기 현 Rules 회사 질의 경계', () => {
    beforeAll(async () => {
        environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8182, rules: readFileSync('firestore.rules', 'utf8') } });
        await environment.withSecurityRulesDisabled(async (context) => {
            for (const companyId of ['taebaek', 'punghoe'])
                await setDoc(doc(context.firestore(), 'dashboardLinks', `${companyId}-link`), { companyId, label: '합성 주소', url: 'https://example.com', order: 0 });
        });
    }, 30000);
    afterAll(async () => {
        if (!environment)
            return;
        let absent = false;
        await environment.withSecurityRulesDisabled(async (context) => {
            for (const id of ids)
                await deleteDoc(doc(context.firestore(), 'dashboardLinks', id));
            const remaining = await Promise.all(ids.map(id => getDoc(doc(context.firestore(), 'dashboardLinks', id))));
            absent = remaining.every(snapshot => !snapshot.exists());
            expect(absent).toBe(true);
        });
        writeFileSync('work/next-cleanup-D-sdk-cleanup.json', JSON.stringify({ projectId, collection: 'dashboardLinks', ids, deletedAndGetAbsent: absent, auth: 'synthetic Rules claims', rulesSource: 'firestore.rules', globalFlush: false }, null, 2));
        await environment.cleanup();
    });
    for (const isAdmin of [true, false]) {
        it(`${isAdmin ? '관리자' : '직원'} 무필터 조회는 거절된다`, async () => {
            const db = environment.authenticatedContext('actor', { companyId: 'taebaek', employeeId: 'employee', isAdmin }).firestore();
            await assertFails(getDocs(collection(db, 'dashboardLinks')));
        });
        it(`${isAdmin ? '관리자' : '직원'} 회사 조건 조회는 같은 회사만 반환한다`, async () => {
            const db = environment.authenticatedContext('actor', { companyId: 'taebaek', employeeId: 'employee', isAdmin }).firestore();
            const result = await assertSucceeds(getDocs(query(collection(db, 'dashboardLinks'), where('companyId', '==', 'taebaek'))));
            expect(result.docs.map(row => row.id)).toEqual(['taebaek-link']);
        });
    }
    it('다른 회사 문서와 다른 회사 조건 질의를 거절한다', async () => {
        const db = environment.authenticatedContext('foreign', { companyId: 'punghoe', employeeId: 'employee', isAdmin: true }).firestore();
        await assertFails(getDoc(doc(db, 'dashboardLinks', 'taebaek-link')));
        await assertFails(getDocs(query(collection(db, 'dashboardLinks'), where('companyId', '==', 'taebaek'))));
    });
    it('기존 같은 회사 직원 쓰기를 보존하며 타회사 쓰기는 거절한다', async () => {
        const db = environment.authenticatedContext('actor', { companyId: 'taebaek', employeeId: 'employee', isAdmin: false }).firestore();
        await assertSucceeds(setDoc(doc(db, 'dashboardLinks', 'created-link'), { companyId: 'taebaek', label: '합성 생성', url: 'https://example.com' }));
        await assertFails(setDoc(doc(db, 'dashboardLinks', 'punghoe-link'), { companyId: 'taebaek', label: '거절' }));
    });
});
