import { it, expect, vi } from 'vitest';
import { executeDocumentCategoryCommand, documentCategoryReceiptId, documentCategoryScopeKey } from './documentCategoryCommand';
import { documentCategoryFenceId } from './shared/documentCategoryFence';
const reference = {
    companyId: 'taebaek' as const, planId: 'p'
}, actor = {
    uid: 'u', token: {
        companyId: 'taebaek', employeeId: 'e', isAdmin: true
    }
};
it('claim회사UID관리자검사는업무접근전거절', async () => {
    const db = {
        runTransaction: vi.fn()
    } as never;
    await expect(executeDocumentCategoryCommand(db, undefined, {
        mode: 'inspect', reference
    })).rejects.toMatchObject({
        code: 'unauthenticated'
    });
    await expect(executeDocumentCategoryCommand(db, {
        ...actor, token: {
            ...actor.token, isAdmin: false
        }
    }, {
        mode: 'inspect', reference
    })).rejects.toMatchObject({
        code: 'permission-denied'
    });
    await expect(executeDocumentCategoryCommand(db, actor, {
        mode: 'inspect', reference: {
            ...reference, companyId: 'punghoe'
        }
    })).rejects.toMatchObject({
        code: 'permission-denied'
    });
});
it('조회와입력명령필드추가/없는필수값은DB전거절', async () => {
    const db = {
        runTransaction: vi.fn()
    } as never;
    await expect(executeDocumentCategoryCommand(db, actor, {
        mode: 'apply', request: {}
    } as never)).rejects.toMatchObject({
        code: 'invalid-argument'
    });
    await expect(executeDocumentCategoryCommand(db, actor, {
        mode: 'inspect', reference, extra: true
    } as never)).rejects.toMatchObject({
        code: 'invalid-argument'
    });
});
it('receipt·discovery·명칭fence는회사UID직원과이름경계를구분한다', () => {
    expect(documentCategoryReceiptId(reference, 'u')).not.toBe(documentCategoryReceiptId(reference, 'v'));
    expect(documentCategoryScopeKey('taebaek', 'u', 'e')).not.toBe(documentCategoryScopeKey('taebaek', 'u', 'other'));
    expect(documentCategoryFenceId('taebaek', 'a|b', 'c')).not.toBe(documentCategoryFenceId('taebaek', 'a', 'b|c'));
    expect(documentCategoryFenceId('taebaek', 'a')).not.toBe(documentCategoryFenceId('punghoe', 'a'));
});
