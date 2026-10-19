import { it, expect } from 'vitest';
import { DOCUMENT_DEFAULT_CATEGORIES, documentCategoryOpening, normalizeDocumentCategoryRequest, serializeDocumentCategoryRequest, normalizeDocumentCategoryResult, normalizeDocumentCategoryPendingResult } from './documentCategoryCommand';
const reference = {
    companyId: 'taebaek' as const, planId: 'plan'
}, createdAt = '2026-10-19T00:00:00Z';
it('고정원문ID·시각·정렬과기본이름을보존한다', () => {
    expect(DOCUMENT_DEFAULT_CATEGORIES).toEqual(['직원용', '업무용', '거래처용']);
    const request = normalizeDocumentCategoryRequest({
        version: 1, reference, action: 'ensurePath', categoryId: 'cat', subCategoryId: 'sub', category: '기존 명칭', subCategory: '원본', createdAt
    });
    expect(serializeDocumentCategoryRequest(request)).toBe(serializeDocumentCategoryRequest(JSON.parse(JSON.stringify(request))));
});
it('여섯action필수형식·미지필드·빈이름·중복seedID거절', () => {
    const base = {
        version: 1, reference, action: 'createCategory', categoryId: 'cat', name: '업무', order: 0, createdAt
    };
    for (const patch of [{
            name: ''
        }, {
            order: NaN
        }, {
            createdAt: undefined
        }, {
            categoryId: '../bad'
        }, {
            extra: 1
        }])
        expect(() => normalizeDocumentCategoryRequest({
            ...base, ...patch
        })).toThrow();
    expect(() => normalizeDocumentCategoryRequest({
        version: 1, reference, action: 'seedDefaults', categoryIds: ['a', 'a', 'b'], createdAt
    })).toThrow();
    expect(() => normalizeDocumentCategoryRequest({
        version: 1, reference, action: 'createCategory', categoryId: 'cat', name: 'a'
    })).toThrow();
});
it('삭제선택원문은name/category ownpresence만사용하고mutable다른필드제외', () => {
    expect(documentCategoryOpening({
        name: '기존', id: 'c', order: 99
    }, 'category')).toEqual(documentCategoryOpening({
        name: '기존'
    }, 'category'));
    expect(() => normalizeDocumentCategoryRequest({
        version: 1, reference, action: 'deleteSubCategory', targetId: 's', opening: documentCategoryOpening({
            name: '중'
        }, 'subCategory')
    })).toThrow();
});
it('엄격회사UID직원hash검증·nullhash는없는기록/중단fence만', () => {
    const result = {
        version: 1, reference, actorUid: 'u', employeeId: 'e', requestHash: null, status: 'unknown', message: '아직기록없음'
    };
    expect(normalizeDocumentCategoryResult(result, reference, 'u', 'e')).toEqual(result);
    for (const patch of [{
            actorUid: 'v'
        }, {
            employeeId: 'x'
        }, {
            status: 'applied'
        }])
        expect(() => normalizeDocumentCategoryResult({
            ...result, ...patch
        }, reference, 'u', 'e')).toThrow();
});
it('빈페이지라도다음cursor보존·다른scope응답거절', () => {
    const value = {
        version: 1, companyId: 'taebaek', actorUid: 'u', employeeId: 'e', entries: [], nextCursor: 'a'.repeat(64)
    };
    expect(normalizeDocumentCategoryPendingResult(value, 'taebaek', 'u', 'e')).toEqual(value);
    expect(() => normalizeDocumentCategoryPendingResult({
        ...value, actorUid: 'v'
    }, 'taebaek', 'u', 'e')).toThrow();
});
