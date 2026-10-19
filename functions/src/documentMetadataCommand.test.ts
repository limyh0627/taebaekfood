import { it, expect, vi } from 'vitest';
vi.hoisted(() => {
    process.env.FIREBASE_CONFIG = JSON.stringify({
        storageBucket: 'demo-document-unit.appspot.com'
    });
});
import { createHash } from 'node:crypto';
import { executeDocumentMetadataCommand, cleanupLateDocumentUpload, documentMetadataReceiptId } from './documentMetadataCommand';
import { documentMetadataOpening, documentUploadPath, type DocumentMetadataRequest } from './shared/documentMetadataCommand';
import type { DocumentStoragePort } from './documentStorageCleanup';
const actor = {
    uid: 'u', token: {
        employeeId: 'e', companyId: 'taebaek', isAdmin: true
    }
}, reference = {
    companyId: 'taebaek' as const, planId: 'p', documentId: 'd'
};
const storage: DocumentStoragePort = {
    bucketName: 'demo-bucket', stat: vi.fn(async () => null), read: vi.fn(async () => Buffer.alloc(0)), remove: vi.fn(async () => {
    })
};
function runtime(initial: Record<string, Record<string, unknown>> = {}) {
    const rows = new Map(Object.entries(initial)), writes: {
        path: string;
        data?: Record<string, unknown>;
        kind: string;
    }[] = [];
    const snapshot = (path: string) => ({
        exists: rows.has(path), data: () => rows.get(path), get: (k: string) => k.split('.').reduce<unknown>((v, part) => v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined, rows.get(path)), updateTime: rows.has(path) ? {
            seconds: 1, nanoseconds: 2
        } : undefined
    });
    const doc = (path: string) => ({
        path, id: path.split('/').pop(), get: async () => snapshot(path)
    });
    const tx = {
        get: async (r: {
            path?: string;
            query?: {
                name: string;
                filters: [
                    string,
                    unknown
                ][];
            };
        }) => r.query ? {
            empty: ![...rows].some(([p, v]) => p.startsWith(r.query!.name + '/') && r.query!.filters.every(([k, value]) => v[k] === value))
        } : snapshot(r.path!), set: (r: {
            path: string;
        }, data: Record<string, unknown>, opts?: {
            merge?: boolean;
        }) => {
            writes.push({
                path: r.path, data, kind: 'set'
            });
            rows.set(r.path, {
                ...(opts?.merge ? rows.get(r.path) : {}), ...data
            });
        }, create: (r: {
            path: string;
        }, data: Record<string, unknown>) => {
            writes.push({
                path: r.path, data, kind: 'create'
            });
            rows.set(r.path, data);
        }, update: (r: {
            path: string;
        }, data: Record<string, unknown>) => {
            writes.push({
                path: r.path, data, kind: 'update'
            });
            rows.set(r.path, {
                ...rows.get(r.path), ...data
            });
        }, delete: (r: {
            path: string;
        }) => {
            writes.push({
                path: r.path, kind: 'delete'
            });
            rows.delete(r.path);
        }
    };
    interface QueryMock {
        query: {
            name: string;
            filters: [
                string,
                unknown
            ][];
        };
        where(field: string, op: string, value: unknown): QueryMock;
    }
    const query = (name: string, filters: [
        string,
        unknown
    ][] = []): QueryMock => ({
        query: {
            name, filters
        }, where: (field, _op, value) => query(name, [...filters, [field, value]])
    });
    const db = {
        collection: (name: string) => ({
            doc: (id: string) => doc(name + '/' + id), where: (field: string, op: string, value: unknown) => query(name).where(field, op, value)
        }), runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx)
    } as never;
    rows.set('employees/e', {
        companyId: 'taebaek'
    });
    rows.set('fileCabinetCategories/category', {
        companyId: 'taebaek', name: '업무'
    });
    rows.set('fileCabinetSubCategories/sub', {
        companyId: 'taebaek', category: '업무', name: '일반'
    });
    return {
        db, rows, writes
    };
}
it('회사UID관리자권한은DB접근전거절한다', async () => {
    const f = runtime();
    await expect(executeDocumentMetadataCommand(f.db, undefined, {
        mode: 'inspect', reference
    }, storage)).rejects.toMatchObject({
        code: 'unauthenticated'
    });
    await expect(executeDocumentMetadataCommand(f.db, {
        ...actor, token: {
            ...actor.token, isAdmin: false
        }
    }, {
        mode: 'inspect', reference
    }, storage)).rejects.toMatchObject({
        code: 'permission-denied'
    });
    expect(f.writes).toHaveLength(0);
});
it('열림원문과nativeversion검사·note는다른필드보존·stale거절영수증', async () => {
    const raw = {
        companyId: 'taebaek', fileName: 'a', note: '전', opaque: {
            keep: true
        }
    }, f = runtime({
        'fileCabinetDocs/d': raw
    });
    const opened = await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'open', reference, opening: documentMetadataOpening(raw)
    }, storage);
    expect(opened).toMatchObject({
        expectedVersion: '1:000000002'
    });
    const result = await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'apply', request: {
            version: 1, reference, action: 'note', expectedVersion: '1:000000002', note: ''
        }
    }, storage);
    expect(result).toMatchObject({
        status: 'applied'
    });
    expect(f.rows.get('fileCabinetDocs/d')).toEqual({
        ...raw, note: ''
    });
    expect(f.writes.map(w => w.path)).toEqual(['fileCabinetDocs/d', 'documentMetadataOperations/' + documentMetadataReceiptId(reference, 'u')]);
});
it('없는inspect는unknown·cancel first fence후늦은원문은업무0', async () => {
    const f = runtime();
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'inspect', reference
    }, storage)).toMatchObject({
        status: 'unknown', requestHash: null
    });
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'cancel', reference
    }, storage)).toMatchObject({
        status: 'cancelled', requestHash: null
    });
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'apply', request: {
            version: 1, reference, action: 'delete', expectedVersion: '1:000000002'
        }
    }, storage)).toMatchObject({
        status: 'cancelled'
    });
    expect(f.writes.some(w => w.path === 'fileCabinetDocs/d')).toBe(false);
});
it('동일ACK는삭제된직원·삭제된대상을다시생성하지않고보존한다', async () => {
    const f = runtime({
        'fileCabinetDocs/d': {
            companyId: 'taebaek', note: 'a'
        }
    }), request: DocumentMetadataRequest = {
        version: 1, reference, action: 'note', expectedVersion: '1:000000002', note: 'b'
    };
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'apply', request
    }, storage)).toMatchObject({
        status: 'applied'
    });
    f.rows.delete('employees/e');
    f.rows.delete('fileCabinetDocs/d');
    const n = f.writes.length;
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'apply', request
    }, storage)).toMatchObject({
        status: 'applied'
    });
    expect(f.writes).toHaveLength(n);
});
it('예약ACK전업로드등록0·예약뒤바이트검증후metadata와receipt동시확정', async () => {
    const bytes = Buffer.from('abc'), hash = createHash('sha256').update(bytes).digest('hex'), f = runtime(), request: DocumentMetadataRequest = {
        version: 1, reference, action: 'create', metadata: {
            category: '업무', subCategory: '일반', fileName: 'a.pdf', note: '', uploadedBy: '원작성자', uploadedAt: '2026-10-19T00:00:00Z'
        }, upload: {
            uploadId: 'upload', path: documentUploadPath('taebaek', 'upload', 'a.pdf'), sha256: hash, size: 3, contentType: 'application/pdf'
        }
    };
    const p: DocumentStoragePort = {
        ...storage, stat: vi.fn(async () => ({
            generation: '7', size: 3, contentType: 'application/pdf', metadata: {
                uploadId: 'upload', sha256: hash, actorUid: 'u', employeeId: 'e', firebaseStorageDownloadTokens: 'token'
            }
        })), read: vi.fn(async () => bytes)
    };
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'apply', request
    }, p)).toMatchObject({
        status: 'unknown'
    });
    expect(f.writes).toHaveLength(0);
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'reserveUpload', request
    }, p)).toMatchObject({
        status: 'active'
    });
    expect(f.rows.has('fileCabinetDocs/d')).toBe(false);
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'apply', request
    }, p)).toMatchObject({
        status: 'applied', uploadStatus: 'verified'
    });
    expect(f.rows.get('fileCabinetDocs/d')).toMatchObject({
        uploadedBy: '원작성자', storageGeneration: '7', storagePath: request.upload.path
    });
});
it('공유참조는파일cleanup0·업무ACK와파일보존상태를구분한다', async () => {
    const path = 'companies/taebaek/file-cabinet/legacy/a.pdf', f = runtime({
        'fileCabinetDocs/d': {
            companyId: 'taebaek', storagePath: path
        }, 'fileCabinetDocs/shared': {
            companyId: 'taebaek', storagePath: path
        }
    }), p = {
        ...storage, stat: vi.fn(async () => ({
            generation: '7', size: 3, contentType: 'application/pdf', metadata: {}
        })), remove: vi.fn(async () => {
        })
    };
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'apply', request: {
            version: 1, reference, action: 'delete', expectedVersion: '1:000000002'
        }
    }, p)).toMatchObject({
        status: 'applied', cleanupStatus: 'pending'
    });
    expect(await executeDocumentMetadataCommand(f.db, actor, {
        mode: 'cleanup', reference
    }, p)).toMatchObject({
        status: 'applied', cleanupStatus: 'retained-shared'
    });
    expect(p.remove).not.toHaveBeenCalled();
});
it('다른회사·타Storage경로는파일사전조회0·본문ID충돌은업무거절', async () => {
    for (const raw of [{
            companyId: 'punghoe', storagePath: 'companies/punghoe/file-cabinet/a'
        }, {
            companyId: 'taebaek', storagePath: 'companies/taebaek/items/item/photo.jpg'
        }, {
            companyId: 'taebaek', id: 'other'
        }]) {
        const f = runtime({
            'fileCabinetDocs/d': raw
        }), p = {
            ...storage, stat: vi.fn(async () => null)
        };
        const result = await executeDocumentMetadataCommand(f.db, actor, {
            mode: 'apply', request: {
                version: 1, reference, action: 'delete', expectedVersion: '1:000000002'
            }
        }, p);
        expect(p.stat).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            status: raw.companyId === 'punghoe' || 'id' in raw ? 'rejected' : 'applied'
        });
    }
});
it('늦은객체정리트리거는실패이벤트재시도를등록한다', () => {
    expect(cleanupLateDocumentUpload.__endpoint).toMatchObject({
        eventTrigger: {
            retry: true
        }
    });
});
