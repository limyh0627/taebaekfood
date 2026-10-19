import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
vi.hoisted(() => {
    process.env.FIREBASE_CONFIG = JSON.stringify({
        storageBucket: 'demo-document-sdk.appspot.com'
    });
});
import * as admin from 'firebase-admin';
import { randomUUID, createHash } from 'node:crypto';
import { executeDocumentMetadataCommand, cleanupLateDocumentObject, documentDiscoveryScopeKey, documentMetadataReceiptId, documentStoragePathId } from './documentMetadataCommand';
import { documentUploadPath, documentMetadataOpening, serializeDocumentMetadataRequest, type DocumentMetadataRequest, type DocumentMetadataReference, type DocumentMetadataResult } from './shared/documentMetadataCommand';
import type { DocumentStoragePort, DocumentStorageObject } from './documentStorageCleanup';
const active = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = {
    uid: 'document-admin-' + randomUUID(), token: {
        employeeId: 'document-emp-' + randomUUID(), companyId: 'taebaek', isAdmin: true
    }
};
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const doc = (p: string) => {
    owned.add(p);
    return db.doc(p);
};
const bytes = Buffer.from('실파일원문'), sha = createHash('sha256').update(bytes).digest('hex');
function fixture() {
    const id = randomUUID(), reference: DocumentMetadataReference = {
        companyId: 'taebaek', planId: 'plan-' + id, documentId: 'doc-' + id
    };
    doc('documentMetadataOperations/' + documentMetadataReceiptId(reference, actor.uid));
    const upload = {
        uploadId: 'upload-' + id, path: documentUploadPath('taebaek', 'upload-' + id, '원본.pdf'), sha256: sha, size: bytes.length, contentType: 'application/pdf'
    };
    doc('documentUploadReservations/' + upload.uploadId);
    doc('documentStoragePaths/' + documentStoragePathId(upload.path));
    const target = doc('fileCabinetDocs/' + reference.documentId);
    const request: DocumentMetadataRequest = {
        version: 1, reference, action: 'create', metadata: {
            category: '업무', subCategory: '일반', fileName: '원본.pdf', note: '', uploadedBy: '이름원문', uploadedAt: '2026-10-19T01:00:00Z'
        }, upload
    };
    let object: DocumentStorageObject | null = {
        generation: '1', size: bytes.length, contentType: 'application/pdf', metadata: {
            uploadId: upload.uploadId, sha256: sha, actorUid: actor.uid, employeeId: actor.token.employeeId, firebaseStorageDownloadTokens: 'test-token'
        }
    };
    const remove = vi.fn(async (_p: string, g: string) => {
        if (object?.generation !== g)
            throw {
                code: 412
            };
        object = null;
    });
    const storage: DocumentStoragePort = {
        bucketName: 'demo-doc.appspot.com', stat: async () => object, read: async () => bytes, remove
    };
    const run = (command: Parameters<typeof executeDocumentMetadataCommand>[2]) => executeDocumentMetadataCommand(db, actor, command, storage) as Promise<DocumentMetadataResult>;
    return {
        reference, request, target, storage, remove, run, setObject: (v: DocumentStorageObject | null) => {
            object = v;
        }, object: () => object
    };
}
describe.skipIf(!active)('문서 메타데이터 실제 Firestore SDK', () => {
    beforeAll(async () => {
        app = admin.initializeApp({
            projectId: 'demo-document-' + randomUUID().slice(0, 8)
        }, 'document-' + randomUUID());
        db = admin.firestore(app);
        await doc('employees/' + actor.token.employeeId).set({
            companyId: 'taebaek'
        });
    });
    afterAll(async () => {
        for (const p of owned)
            await db.doc(p).delete();
        await app?.delete();
    }, 60000);
    it('예약은업무0·실파일확인뒤metadata+receipt를같은TX확정·ACK유실재호출은불변', async () => {
        const f = fixture();
        expect((await f.run({
            mode: 'reserveUpload', request: f.request
        })).status).toBe('active');
        expect((await f.target.get()).exists).toBe(false);
        expect((await f.run({
            mode: 'apply', request: f.request
        })).status).toBe('applied');
        const before = await f.target.get();
        await f.target.update({
            note: '후속변경'
        });
        const changed = await f.target.get();
        expect((await f.run({
            mode: 'apply', request: f.request
        })).status).toBe('applied');
        expect((await f.target.get()).updateTime!.isEqual(changed.updateTime!)).toBe(true);
        expect(before.get('storageGeneration')).toBe('1');
    });
    it('예약없는apply는unknown·없는inspect는nullhashunknown·cancel fence뒤늦은reserve도0', async () => {
        const f = fixture();
        expect((await f.run({
            mode: 'apply', request: f.request
        })).status).toBe('unknown');
        expect(await f.run({
            mode: 'inspect', reference: f.reference
        })).toMatchObject({
            status: 'unknown', requestHash: null
        });
        expect((await f.run({
            mode: 'cancel', reference: f.reference
        })).status).toBe('cancelled');
        expect((await f.run({
            mode: 'reserveUpload', request: f.request
        })).status).toBe('cancelled');
        expect((await f.target.get()).exists).toBe(false);
    });
    it('cancel과apply동시경합은한업무결과만·cancel승리시metadata생성0', async () => {
        const f = fixture();
        await f.run({
            mode: 'reserveUpload', request: f.request
        });
        const [a, b] = await Promise.all([f.run({
                mode: 'cancel', reference: f.reference
            }), f.run({
                mode: 'apply', request: f.request
            })]);
        expect(a.status).toBe(b.status);
        expect((await f.target.get()).exists).toBe(a.status === 'applied');
    });
    it('실nativeCAS메모clear는legacy필드보존·옛버전후속저장거절', async () => {
        const f = fixture(), raw = {
            companyId: 'taebaek', fileName: '과거', note: '기존', other: {
                kept: true
            }
        };
        await f.target.set(raw);
        const opened = await executeDocumentMetadataCommand(db, actor, {
            mode: 'open', reference: f.reference, opening: documentMetadataOpening(raw)
        }, f.storage);
        expect('expectedVersion' in opened).toBe(true);
        const expectedVersion = 'expectedVersion' in opened ? opened.expectedVersion : '';
        await f.target.update({
            other: {
                kept: '바뀜'
            }
        });
        expect((await f.run({
            mode: 'apply', request: {
                version: 1, reference: f.reference, action: 'note', expectedVersion, note: ''
            }
        })).status).toBe('rejected');
        expect((await f.target.get()).get('note')).toBe('기존');
    });
    it('명시회사누락nullforeign은open과write모두거절·direct업무생성0', async () => {
        for (const companyId of [undefined, null, 'punghoe']) {
            const f = fixture();
            const raw = {
                fileName: 'a', ...(companyId === undefined ? {} : {
                    companyId
                })
            };
            await f.target.set(raw);
            await expect(executeDocumentMetadataCommand(db, actor, {
                mode: 'open', reference: f.reference, opening: documentMetadataOpening(raw)
            }, f.storage)).rejects.toMatchObject({
                code: 'failed-precondition'
            });
            const s = await f.target.get(), expectedVersion = `${s.updateTime!.seconds}:${String(s.updateTime!.nanoseconds).padStart(9, '0')}`;
            expect((await f.run({
                mode: 'apply', request: {
                    version: 1, reference: f.reference, action: 'delete', expectedVersion
                }
            })).status).toBe('rejected');
            expect((await f.target.get()).exists).toBe(true);
        }
    });
    it('취소예약늦은객체는cleanup만·같은path참조있으면공유파일보존', async () => {
        const f = fixture();
        await f.run({
            mode: 'reserveUpload', request: f.request
        });
        await f.run({
            mode: 'cancel', reference: f.reference
        });
        const shared = doc('fileCabinetDocs/shared-' + randomUUID());
        await shared.set({
            companyId: 'taebaek', storagePath: f.request.action === 'create' ? f.request.upload.path : ''
        });
        expect((await f.run({
            mode: 'cleanup', reference: f.reference
        })).cleanupStatus).toBe('retained-shared');
        expect(f.remove).not.toHaveBeenCalled();
        await shared.delete();
        expect((await f.run({
            mode: 'cleanup', reference: f.reference
        })).cleanupStatus).toBe('deleted');
        expect(f.remove).toHaveBeenCalledTimes(1);
        expect((await f.target.get()).exists).toBe(false);
    });
    it('삭제후파일정리실패는업무ACK보존·cleanup만재시도', async () => {
        const f = fixture();
        await f.run({
            mode: 'reserveUpload', request: f.request
        });
        await f.run({
            mode: 'apply', request: f.request
        });
        const s = await f.target.get(), expectedVersion = `${s.updateTime!.seconds}:${String(s.updateTime!.nanoseconds).padStart(9, '0')}`;
        const ref = {
            ...f.reference, planId: 'delete-' + randomUUID()
        };
        doc('documentMetadataOperations/' + documentMetadataReceiptId(ref, actor.uid));
        await f.run({
            mode: 'apply', request: {
                version: 1, reference: ref, action: 'delete', expectedVersion
            }
        });
        f.remove.mockRejectedValueOnce(Error('네트워크'));
        expect(await f.run({
            mode: 'cleanup', reference: ref
        })).toMatchObject({
            status: 'applied', cleanupStatus: 'pending'
        });
        expect((await f.target.get()).exists).toBe(false);
        expect((await f.run({
            mode: 'cleanup', reference: ref
        })).cleanupStatus).toBe('deleted');
    });
    it('다른generation은조건삭제0·같은path새참조는closedfence로차단', async () => {
        const f = fixture();
        await f.run({
            mode: 'reserveUpload', request: f.request
        });
        await f.run({
            mode: 'apply', request: f.request
        });
        const s = await f.target.get(), ref = {
            ...f.reference, planId: 'del-' + randomUUID()
        };
        doc('documentMetadataOperations/' + documentMetadataReceiptId(ref, actor.uid));
        await f.run({
            mode: 'apply', request: {
                version: 1, reference: ref, action: 'delete', expectedVersion: `${s.updateTime!.seconds}:${String(s.updateTime!.nanoseconds).padStart(9, '0')}`
            }
        });
        f.setObject({
            ...f.object()!, generation: '2'
        });
        expect((await f.run({
            mode: 'cleanup', reference: ref
        })).cleanupStatus).toBe('retained-replaced');
        expect(f.remove).not.toHaveBeenCalled();
    });
    it('latefinalize실패는pending영속·throw재시도뒤같은객체만정리한다', async () => {
        const f = fixture();
        await f.run({
            mode: 'reserveUpload', request: f.request
        });
        await f.run({
            mode: 'cancel', reference: f.reference
        });
        f.remove.mockRejectedValueOnce(Error('일시실패'));
        const object = {
            name: f.request.action === 'create' ? f.request.upload.path : '', generation: '1', bucket: 'demo-doc.appspot.com'
        };
        await expect(cleanupLateDocumentObject(db, object, f.storage)).rejects.toThrow('미확정');
        expect((await db.collection('documentMetadataOperations').doc(documentMetadataReceiptId(f.reference, actor.uid)).get()).get('result.cleanupStatus')).toBe('pending');
        await cleanupLateDocumentObject(db, object, f.storage);
        expect(f.object()).toBeNull();
        expect((await f.run({
            mode: 'inspect', reference: f.reference
        })).cleanupStatus).toBe('deleted');
    });
    it('늦은이벤트G1은G2보존·bucket다름은I/O전거절', async () => {
        const f = fixture();
        await f.run({
            mode: 'reserveUpload', request: f.request
        });
        await f.run({
            mode: 'cancel', reference: f.reference
        });
        f.setObject({
            ...f.object()!, generation: '2'
        });
        const object = {
            name: f.request.action === 'create' ? f.request.upload.path : '', generation: '1', bucket: 'demo-doc.appspot.com'
        };
        await cleanupLateDocumentObject(db, object, f.storage);
        expect(f.remove).not.toHaveBeenCalled();
        expect(f.object()?.generation).toBe('2');
        await expect(cleanupLateDocumentObject(db, {
            ...object, bucket: 'wrong'
        }, f.storage)).rejects.toThrow('버킷');
    });
    it('동시cleanup의늦은실패는새성공ACK를pending으로되돌리지않는다', async () => {
        const f = fixture();
        await f.run({
            mode: 'reserveUpload', request: f.request
        });
        await f.run({
            mode: 'cancel', reference: f.reference
        });
        let rejectFirst!: (e: Error) => void;
        let entered!: () => void;
        const started = new Promise<void>(r => {
            entered = r;
        });
        const first = {
            ...f.storage, stat: async () => {
                entered();
                return new Promise<never>((_, reject) => {
                    rejectFirst = reject;
                });
            }
        };
        const old = executeDocumentMetadataCommand(db, actor, {
            mode: 'cleanup', reference: f.reference
        }, first);
        await started;
        expect((await f.run({
            mode: 'cleanup', reference: f.reference
        })).cleanupStatus).toBe('deleted');
        rejectFirst(Error('늦은실패'));
        expect(await old).toMatchObject({
            cleanupStatus: 'deleted'
        });
        expect((await f.run({
            mode: 'inspect', reference: f.reference
        })).cleanupStatus).toBe('deleted');
    });
    it('서버미완료목록은50scan빈페이지cursor보존·다음페이지active·타UID격리', async () => {
        for (const path of owned)
            if (path.startsWith('documentMetadataOperations/'))
                await db.doc(path).delete();
        const rows = Array.from({
            length: 51
        }, () => {
            const f = fixture(), request = f.request, text = serializeDocumentMetadataRequest(request), hash = createHash('sha256').update(text).digest('hex');
            return {
                f, text, hash, id: documentMetadataReceiptId(f.reference, actor.uid)
            };
        }).sort((a, b) => a.id.localeCompare(b.id));
        for (let i = 0; i < rows.length; i++) {
            const { f, text, hash, id } = rows[i];
            await doc('documentMetadataOperations/' + id).set({
                discoveryScopeKey: documentDiscoveryScopeKey('taebaek', actor.uid, actor.token.employeeId), requestText: text, requestHash: hash, result: {
                    version: 1, reference: f.reference, actorUid: actor.uid, employeeId: actor.token.employeeId, requestHash: hash, status: i < 50 ? 'applied' : 'active', uploadStatus: i < 50 ? 'verified' : 'reserved', cleanupStatus: 'not-required', message: '실제기록'
                }
            });
        }
        const first = await executeDocumentMetadataCommand(db, actor, {
            mode: 'listPending', companyId: 'taebaek'
        }, rows[0].f.storage);
        expect('entries' in first).toBe(true);
        if (!('entries' in first))
            throw Error('목록아님');
        expect(first.entries).toHaveLength(0);
        expect(first.nextCursor).toBe(rows[49].id);
        const next = await executeDocumentMetadataCommand(db, actor, {
            mode: 'listPending', companyId: 'taebaek', cursor: first.nextCursor!
        }, rows[0].f.storage);
        expect(next).toMatchObject({
            entries: [{
                    result: {
                        reference: rows[50].f.reference, status: 'active'
                    }, label: '원본.pdf'
                }], nextCursor: null
        });
        await expect(executeDocumentMetadataCommand(db, {
            ...actor, uid: 'different-' + actor.uid
        }, {
            mode: 'listPending', companyId: 'taebaek'
        }, rows[0].f.storage)).resolves.toMatchObject({
            entries: [], nextCursor: null
        });
        await expect(executeDocumentMetadataCommand(db, actor, {
            mode: 'listPending', companyId: 'taebaek', cursor: '../bad'
        }, rows[0].f.storage)).rejects.toMatchObject({
            code: 'invalid-argument'
        });
        for (const row of rows)
            await db.doc('documentMetadataOperations/' + row.id).delete();
    });
    it('원문없는중단pending도문서번호로발견·다른직원scope미노출', async () => {
        const f = fixture(), id = documentMetadataReceiptId(f.reference, actor.uid), result = {
            version: 1, reference: f.reference, actorUid: actor.uid, employeeId: actor.token.employeeId, requestHash: null, status: 'cancelled', uploadStatus: 'reserved', cleanupStatus: 'pending', message: '늦은파일정리미완료'
        };
        await doc('documentMetadataOperations/' + id).set({
            discoveryScopeKey: documentDiscoveryScopeKey('taebaek', actor.uid, actor.token.employeeId), requestText: null, requestHash: null, result
        });
        const listed = await executeDocumentMetadataCommand(db, actor, {
            mode: 'listPending', companyId: 'taebaek'
        }, f.storage);
        if (!('entries' in listed))
            throw Error('목록아님');
        expect(listed.entries.some(e => e.result.reference.planId === f.reference.planId && e.label === f.reference.documentId)).toBe(true);
        const otherId = 'emp-other-' + randomUUID();
        await doc('employees/' + otherId).set({
            companyId: 'taebaek'
        });
        const other = await executeDocumentMetadataCommand(db, {
            ...actor, token: {
                ...actor.token, employeeId: otherId
            }
        }, {
            mode: 'listPending', companyId: 'taebaek'
        }, f.storage);
        expect(other).toMatchObject({
            entries: []
        });
        await db.doc('documentMetadataOperations/' + id).delete();
    });
    it('같은문서두예약중둘째등록거절도파일정리pending·첫파일보존·늦은객체정리', async () => {
        const first = fixture(), second = fixture(), reference = {
            ...second.reference, documentId: first.reference.documentId
        };
        doc('documentMetadataOperations/' + documentMetadataReceiptId(reference, actor.uid));
        const request = {
            ...second.request, reference
        };
        await first.run({
            mode: 'reserveUpload', request: first.request
        });
        await second.run({
            mode: 'reserveUpload', request
        });
        await first.run({
            mode: 'apply', request: first.request
        });
        expect(await second.run({
            mode: 'apply', request
        })).toMatchObject({
            status: 'rejected', uploadStatus: 'verified', cleanupStatus: 'pending'
        });
        expect((await db.collection('documentUploadReservations').doc(request.action === 'create' ? request.upload.uploadId : '').get()).get('closed')).toBe(true);
        const pending = await executeDocumentMetadataCommand(db, actor, {
            mode: 'listPending', companyId: 'taebaek'
        }, second.storage);
        if (!('entries' in pending))
            throw Error('목록아님');
        expect(pending.entries.some(e => e.result.reference.planId === reference.planId && e.result.cleanupStatus === 'pending')).toBe(true);
        expect(await second.run({
            mode: 'cleanup', reference
        })).toMatchObject({
            status: 'rejected', cleanupStatus: 'deleted'
        });
        expect(second.object()).toBeNull();
        expect(first.object()?.generation).toBe('1');
        expect((await first.target.get()).get('storagePath')).toBe(first.request.action === 'create' ? first.request.upload.path : '');
        second.setObject({
            generation: '2', size: bytes.length, contentType: 'application/pdf', metadata: {
                uploadId: request.action === 'create' ? request.upload.uploadId : '', sha256: sha, actorUid: actor.uid, employeeId: actor.token.employeeId
            }
        });
        await cleanupLateDocumentObject(db, {
            name: request.action === 'create' ? request.upload.path : '', generation: '2', bucket: 'demo-doc.appspot.com'
        }, second.storage);
        expect(second.object()?.generation).toBe('2');
        expect((await second.run({
            mode: 'inspect', reference
        })).cleanupStatus).toBe('retained-replaced');
        expect(first.object()).not.toBeNull();
    });
    it('실SDKcommit두번째receipt쓰기NOT_FOUND면metadata쓰기전체rollback·원문재시도성공', async () => {
        const f = fixture(), raw = {
            companyId: 'taebaek', fileName: '원본', note: '기존', unknown: {
                keep: true
            }
        };
        await f.target.set(raw);
        const before = await f.target.get(), request: DocumentMetadataRequest = {
            version: 1, reference: f.reference, action: 'note', expectedVersion: `${before.updateTime!.seconds}:${String(before.updateTime!.nanoseconds).padStart(9, '0')}`, note: '수정'
        };
        let receiptWriteInjected = false;
        const failingDb = new Proxy(db, {
            get(target, key) {
                if (key === 'runTransaction')
                    return async (work: (tx: admin.firestore.Transaction) => Promise<unknown>) => target.runTransaction(async (tx) => work(new Proxy(tx, {
                        get(t, k) {
                            if (k === 'set')
                                return (ref: admin.firestore.DocumentReference, data: admin.firestore.DocumentData) => {
                                    if (ref.path.startsWith('documentMetadataOperations/')) {
                                        receiptWriteInjected = true;
                                        return t.update(ref, data);
                                    }
                                    return t.set(ref, data);
                                };
                            const value = Reflect.get(t, k);
                            return typeof value === 'function' ? value.bind(t) : value;
                        }
                    })));
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        await expect(executeDocumentMetadataCommand(failingDb, actor, {
            mode: 'apply', request
        }, f.storage)).rejects.toMatchObject({
            code: 5
        });
        expect(receiptWriteInjected).toBe(true);
        const after = await f.target.get();
        expect(after.data()).toEqual(raw);
        expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true);
        expect((await db.collection('documentMetadataOperations').doc(documentMetadataReceiptId(f.reference, actor.uid)).get()).exists).toBe(false);
        expect((await f.run({
            mode: 'apply', request
        })).status).toBe('applied');
        expect((await f.target.get()).get('note')).toBe('수정');
    });
});
