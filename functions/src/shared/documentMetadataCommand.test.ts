import { it, expect } from 'vitest';
import { documentUploadPath, normalizeDocumentMetadataRequest, serializeDocumentMetadataRequest, normalizeDocumentMetadataResult, normalizeDocumentMetadataPendingResult, documentMetadataOpening, type DocumentMetadataRequest } from './documentMetadataCommand';
const reference = {
    companyId: 'taebaek' as const, planId: 'p', documentId: 'd'
};
const request: DocumentMetadataRequest = {
    version: 1, reference, action: 'create', metadata: {
        category: '업무', subCategory: '일반', fileName: 'a.pdf', note: '', uploadedBy: '이름 원문', uploadedAt: '2026-10-19T00:00:00Z'
    }, upload: {
        uploadId: 'u', path: documentUploadPath('taebaek', 'u', 'a.pdf'), sha256: 'a'.repeat(64), size: 3, contentType: 'application/pdf'
    }
};
it('업로드 전 고정 원문은 URL·generation 없이 같은 canonical 문자열을 보존한다', () => {
    expect(normalizeDocumentMetadataRequest(request)).toEqual(request);
    expect(serializeDocumentMetadataRequest(request)).toBe(serializeDocumentMetadataRequest(JSON.parse(JSON.stringify(request))));
    for (const field of ['downloadUrl', 'generation'])
        expect(() => normalizeDocumentMetadataRequest({
            ...request, metadata: {
                ...request.metadata, [field]: 'x'
            }
        })).toThrow();
});
it('회사경로·크기·SHA·예약번호를 검사하고 metadata중복과 미지필드를 거절한다', () => {
    for (const patch of [{
            path: 'companies/punghoe/file-cabinet/uploads/u/a.pdf'
        }, {
            size: 30 * 1024 * 1024 + 1
        }, {
            sha256: 'bad'
        }, {
            path: request.upload.path + '/nested'
        }])
        expect(() => normalizeDocumentMetadataRequest({
            ...request, upload: {
                ...request.upload, ...patch
            }
        })).toThrow();
    expect(documentUploadPath('taebaek', 'u', 'a/b#?.pdf')).toBe('companies/taebaek/file-cabinet/uploads/u/a_b__.pdf');
});
it('열림 ownpresence와 메모 clear를 보존하며 원문버전 없는 변경은 거절한다', () => {
    expect(documentMetadataOpening({
        note: '', fileName: 'a', unknown: 1
    })).not.toEqual(documentMetadataOpening({
        fileName: 'a'
    }));
    expect(normalizeDocumentMetadataRequest({
        version: 1, reference, action: 'note', expectedVersion: '1:000000002', note: ''
    })).toMatchObject({
        note: ''
    });
    expect(() => normalizeDocumentMetadataRequest({
        version: 1, reference, action: 'delete', expectedVersion: null
    })).toThrow();
});
it('null해시는 no-record unknown·cancel fence만, 응답회사UID직원·hash도 엄격검사한다', () => {
    const base = {
        version: 1, reference, actorUid: 'u', employeeId: 'e', requestHash: null, status: 'unknown', uploadStatus: 'not-required', cleanupStatus: 'not-required', message: '아직 기록 없음'
    };
    expect(normalizeDocumentMetadataResult(base, reference, 'u', 'e').status).toBe('unknown');
    for (const patch of [{
            status: 'applied'
        }, {
            actorUid: 'v'
        }, {
            employeeId: 'f'
        }, {
            reference: {
                ...reference, documentId: 'other'
            }
        }])
        expect(() => normalizeDocumentMetadataResult({
            ...base, ...patch
        }, reference, 'u', 'e')).toThrow();
    expect(() => normalizeDocumentMetadataResult({
        ...base, requestHash: 'a'.repeat(64)
    }, reference, 'u', 'e', 'b'.repeat(64))).toThrow();
});
it('미완료목록은빈페이지cursor유지·회사UID직원과실pending만허용한다', () => {
    const value = {
        version: 1, companyId: 'taebaek', actorUid: 'u', employeeId: 'e', entries: [], nextCursor: 'a'.repeat(64)
    };
    expect(normalizeDocumentMetadataPendingResult(value, 'taebaek', 'u', 'e')).toEqual(value);
    for (const patch of [{
            actorUid: 'v'
        }, {
            employeeId: 'x'
        }, {
            companyId: 'punghoe'
        }, {
            nextCursor: '../bad'
        }])
        expect(() => normalizeDocumentMetadataPendingResult({
            ...value, ...patch
        }, 'taebaek', 'u', 'e')).toThrow();
});
