import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
vi.hoisted(() => {
    process.env.FIREBASE_CONFIG = JSON.stringify({
        storageBucket: 'demo-category.appspot.com'
    });
});
import * as admin from 'firebase-admin';
import { randomUUID, createHash } from 'node:crypto';
import { executeDocumentCategoryCommand, documentCategoryReceiptId, documentCategoryScopeKey } from './documentCategoryCommand';
import { documentCategoryOpening, type DocumentCategoryRequest, type DocumentCategoryReference, type DocumentCategoryResult } from './shared/documentCategoryCommand';
import { documentCategoryFenceId } from './shared/documentCategoryFence';
import { executeDocumentMetadataCommand, documentMetadataReceiptId, documentStoragePathId } from './documentMetadataCommand';
import { documentUploadPath, type DocumentMetadataRequest, type DocumentMetadataResult } from './shared/documentMetadataCommand';
import type { DocumentStoragePort } from './documentStorageCleanup';
const active = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182', createdAt = '2026-10-19T00:00:00Z';
const actor = {
    uid: 'category-admin-' + randomUUID(), token: {
        employeeId: 'category-employee-' + randomUUID(), companyId: 'taebaek', isAdmin: true
    }
};
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const inFlight=new Set<Promise<unknown>>();
function tracked<T>(promise:Promise<T>):Promise<T>{inFlight.add(promise);void promise.then(()=>inFlight.delete(promise),()=>inFlight.delete(promise));return promise;}
const doc = (path: string) => {
    owned.add(path);
    return db.doc(path);
};
const ref = (): DocumentCategoryReference => ({
    companyId: 'taebaek', planId: 'plan-' + randomUUID()
});
const track = (request: DocumentCategoryRequest) => {
    doc('documentCategoryOperations/' + documentCategoryReceiptId(request.reference, actor.uid));
    doc('documentCategoryFences/' + documentCategoryFenceId('taebaek'));
    if (request.action === 'seedDefaults') {
        for (const id of request.categoryIds)
            doc('fileCabinetCategories/' + id);
        for (const name of ['직원용', '업무용', '거래처용'])
            doc('documentCategoryFences/' + documentCategoryFenceId('taebaek', name));
    }
    if ('categoryId' in request)
        doc('fileCabinetCategories/' + request.categoryId);
    if ('subCategoryId' in request)
        doc('fileCabinetSubCategories/' + request.subCategoryId);
    if ('category' in request) {
        doc('documentCategoryFences/' + documentCategoryFenceId('taebaek', request.category));
        if (request.action === 'ensurePath')
            doc('documentCategoryFences/' + documentCategoryFenceId('taebaek', request.category, request.subCategory));
        if (request.action === 'createSubCategory')
            doc('documentCategoryFences/' + documentCategoryFenceId('taebaek', request.category, request.name));
    }
    if (request.action === 'createCategory')
        doc('documentCategoryFences/' + documentCategoryFenceId('taebaek', request.name));
    return request;
};
const run = async (request: DocumentCategoryRequest, database = db) => {
    track(request);
    return tracked(executeDocumentCategoryCommand(database, actor, {
        mode: 'apply', request
    }) as Promise<DocumentCategoryResult>);
};
const seed = (): DocumentCategoryRequest => ({
    version: 1, reference: ref(), action: 'seedDefaults', categoryIds: [randomUUID(), randomUUID(), randomUUID()], createdAt
});
const ensure = (category = '분류-' + randomUUID(), subCategory = '중-' + randomUUID()): Extract<DocumentCategoryRequest, {
    action: 'ensurePath';
}> => ({
    version: 1, reference: ref(), action: 'ensurePath', categoryId: randomUUID(), subCategoryId: randomUUID(), category, subCategory, createdAt
});
const deleteCategory = (id: string, name: string): DocumentCategoryRequest => ({
    version: 1, reference: ref(), action: 'deleteCategory', targetId: id, opening: documentCategoryOpening({
        name
    }, 'category')
});
const deleteSub = (id: string, category: string, name: string): DocumentCategoryRequest => ({
    version: 1, reference: ref(), action: 'deleteSubCategory', targetId: id, opening: documentCategoryOpening({
        category, name
    }, 'subCategory')
});
async function metadata(requested: Extract<DocumentCategoryRequest, {
    action: 'ensurePath';
}>) {
    const id = randomUUID(), reference = {
        companyId: 'taebaek' as const, planId: 'metadata-' + id, documentId: 'doc-' + id
    }, bytes = Buffer.from('원문'), sha256 = createHash('sha256').update(bytes).digest('hex'), upload = {
        uploadId: 'upload-' + id, path: documentUploadPath('taebaek', 'upload-' + id, 'a.pdf'), sha256, size: bytes.length, contentType: 'application/pdf'
    };
    const request: DocumentMetadataRequest = {
        version: 1, reference, action: 'create', metadata: {
            category: requested.category, subCategory: requested.subCategory, fileName: 'a.pdf', note: '', uploadedBy: '원작성자', uploadedAt: createdAt
        }, upload
    };
    for (const path of ['documentMetadataOperations/' + documentMetadataReceiptId(reference, actor.uid), 'documentUploadReservations/' + upload.uploadId, 'documentStoragePaths/' + documentStoragePathId(upload.path), 'fileCabinetDocs/' + reference.documentId])
        doc(path);
    const storage: DocumentStoragePort = {
        bucketName: 'demo-category.appspot.com', stat: async () => ({
            generation: '1', size: bytes.length, contentType: 'application/pdf', metadata: {
                uploadId: upload.uploadId, sha256, actorUid: actor.uid, employeeId: actor.token.employeeId, firebaseStorageDownloadTokens: 'token'
            }
        }), read: async () => bytes, remove: async () => {
        }
    };
    const command = (mode: 'reserveUpload' | 'apply') => tracked(executeDocumentMetadataCommand(db, actor, {
        mode, request
    }, storage) as Promise<DocumentMetadataResult>);
    await command('reserveUpload');
    return {
        request, command
    };
}
describe.skipIf(!active)('문서 분류 실제 Firestore SDK', () => {
    beforeAll(async () => {
        app = admin.initializeApp({
            projectId: 'demo-category-' + randomUUID().slice(0, 8)
        }, 'category-' + randomUUID());
        db = admin.firestore(app);
        await db.doc('employees/' + actor.token.employeeId).set({
            companyId: 'taebaek'
        });
    });
    afterEach(async () => {
        await Promise.allSettled([...inFlight]);
        for (const path of owned)
            await db.doc(path).delete();
        owned.clear();
    }, 60000);
    afterAll(async () => {
        await db.doc('employees/' + actor.token.employeeId).delete();
        await app.delete();
    });
    it('동시기본seed는정확세행만·기존이름과0/1/2정렬보존', async () => {
        const a = seed(), b = seed();
        expect((await Promise.all([run(a), run(b)])).map(r => r.status)).toEqual(['applied', 'applied']);
        const rows = await db.collection('fileCabinetCategories').get();
        expect(rows.size).toBe(3);
        expect(rows.docs.map(d => [d.get('order'), d.get('name')]).sort()).toEqual([[0, '직원용'], [1, '업무용'], [2, '거래처용']]);
    }, 30000);
    it('기존중복분류있으면seed는전체무변경·순서와ID보존', async () => {
        for (const id of ['old1', 'old2'])
            await doc('fileCabinetCategories/' + id).set({
                companyId: 'taebaek', name: '기존', order: 71, createdAt: '옛값'
            });
        expect((await run(seed())).status).toBe('applied');
        const rows = await db.collection('fileCabinetCategories').get();
        expect(rows.size).toBe(2);
        expect(rows.docs.map(d => d.data())).toEqual([{
                companyId: 'taebaek', name: '기존', order: 71, createdAt: '옛값'
            }, {
                companyId: 'taebaek', name: '기존', order: 71, createdAt: '옛값'
            }]);
    });
    it('동시ensurePath는명칭당하나씩·없는단계만90/0등록', async () => {
        const a = ensure(), b = ensure(a.category, a.subCategory);
        await Promise.all([run(a), run(b)]);
        const categories = await db.collection('fileCabinetCategories').get(), subs = await db.collection('fileCabinetSubCategories').get();
        expect(categories.size).toBe(1);
        expect(subs.size).toBe(1);
        expect(categories.docs[0].get('order')).toBe(90);
        expect(subs.docs[0].get('order')).toBe(0);
        expect((await run({
            ...b, reference: ref()
        })).status).toBe('applied');
        expect((await db.collection('fileCabinetCategories').get()).size).toBe(1);
    }, 30000);
    it('중분류·파일참조삭제보호/명시삭제완료와수동등록순서보존', async () => {
        const category = '일반-' + randomUUID(), categoryId = randomUUID(), subId = randomUUID();
        await run({
            version: 1, reference: ref(), action: 'createCategory', categoryId, name: category, order: 7, createdAt
        });
        await run({
            version: 1, reference: ref(), action: 'createSubCategory', subCategoryId: subId, category, name: '중', order: 3, createdAt
        });
        expect((await db.doc('fileCabinetCategories/' + categoryId).get()).get('order')).toBe(7);
        expect((await run(deleteCategory(categoryId, category))).status).toBe('rejected');
        const file = doc('fileCabinetDocs/' + randomUUID());
        await file.set({
            companyId: 'taebaek', category, subCategory: '중'
        });
        expect((await run(deleteSub(subId, category, '중'))).status).toBe('rejected');
        await file.delete();
        expect((await run(deleteSub(subId, category, '중'))).status).toBe('applied');
        expect((await run(deleteCategory(categoryId, category))).status).toBe('applied');
    });
    it('미처리cancel선행·apply경합·lateapply는receipt하나만·업무중복0', async () => {
        const a = ensure();
        doc('documentCategoryOperations/' + documentCategoryReceiptId(a.reference, actor.uid));
        expect(await executeDocumentCategoryCommand(db, actor, {
            mode: 'inspect', reference: a.reference
        })).toMatchObject({
            status: 'unknown', requestHash: null
        });
        expect(await executeDocumentCategoryCommand(db, actor, {
            mode: 'cancel', reference: a.reference
        })).toMatchObject({
            status: 'cancelled'
        });
        expect((await run(a)).status).toBe('cancelled');
        const b = ensure();
        track(b);
        const [x, y] = await Promise.all([run(b), executeDocumentCategoryCommand(db, actor, {
                mode: 'cancel', reference: b.reference
            })]);
        expect(x.status).toBe('status' in y ? y.status : null);
        expect((await db.doc('fileCabinetCategories/' + b.categoryId).get()).exists).toBe(x.status === 'applied');
    }, 30000);
    it('ACK유실재호출은원문유지·후속수정과삭제뒤부활0', async () => {
        const a = ensure();
        await run(a);
        await db.doc('fileCabinetCategories/' + a.categoryId).update({
            name: '후속변경'
        });
        expect((await run(a)).status).toBe('applied');
        expect((await db.doc('fileCabinetCategories/' + a.categoryId).get()).get('name')).toBe('후속변경');
        await db.doc('fileCabinetCategories/' + a.categoryId).delete();
        expect((await run(a)).status).toBe('applied');
        expect((await db.doc('fileCabinetCategories/' + a.categoryId).get()).exists).toBe(false);
        await expect(run({
            ...a, category: '다른원문'
        })).rejects.toMatchObject({
            code: 'failed-precondition'
        });
    });
    it('seed실backendcommitreceipt쓰기NOT_FOUND면세분류와fence모두rollback', async () => {
        const a = seed();
        track(a);
        let fault = false;
        const failing = new Proxy(db, {
            get(target, key) {
                if (key === 'runTransaction')
                    return async (work: (tx: admin.firestore.Transaction) => Promise<unknown>) => target.runTransaction(async (tx) => work(new Proxy(tx, {
                        get(t, k) {
                            if (k === 'create')
                                return (ref: admin.firestore.DocumentReference, data: admin.firestore.DocumentData) => {
                                    if (ref.path.startsWith('documentCategoryOperations/')) {
                                        fault = true;
                                        return t.update(ref, data);
                                    }
                                    return t.create(ref, data);
                                };
                            const v = Reflect.get(t, k);
                            return typeof v === 'function' ? v.bind(t) : v;
                        }
                    })));
                const v = Reflect.get(target, key);
                return typeof v === 'function' ? v.bind(target) : v;
            }
        });
        await expect(run(a, failing)).rejects.toMatchObject({
            code: 5
        });
        expect(fault).toBe(true);
        expect((await db.collection('fileCabinetCategories').get()).empty).toBe(true);
        expect((await db.collection('documentCategoryFences').get()).empty).toBe(true);
        expect((await db.doc('documentCategoryOperations/' + documentCategoryReceiptId(a.reference, actor.uid)).get()).exists).toBe(false);
        expect((await run(a)).status).toBe('applied');
    });
    // 실제 SDK의 경합 재시도가 5초 경계에 걸려 이 동시성 인수에만 완료 예산을 둔다.
    it('중분류삭제와문서등록경합은고아메타데이터0·완료한쪽만유지', async () => {
        const a = ensure();
        await run(a);
        const file = await metadata(a);
        const [deleted, created] = await Promise.all([run(deleteSub(a.subCategoryId, a.category, a.subCategory)), file.command('apply')]);
        expect([deleted.status, created.status].sort()).toEqual(['applied', 'rejected']);
        const exists = (await db.doc('fileCabinetDocs/' + file.request.reference.documentId).get()).exists;
        expect(exists).toBe(created.status === 'applied');
        expect((await db.doc('fileCabinetSubCategories/' + a.subCategoryId).get()).exists).toBe(created.status === 'applied');
    }, 30000);
    it('삭제확정뒤문서apply는분류없음거절·예약닫힘파일정리pending', async () => {
        const a = ensure();
        await run(a);
        const file = await metadata(a);
        await run(deleteSub(a.subCategoryId, a.category, a.subCategory));
        expect(await file.command('apply')).toMatchObject({
            status: 'rejected', cleanupStatus: 'pending'
        });
        expect((await db.doc('fileCabinetDocs/' + file.request.reference.documentId).get()).exists).toBe(false);
    });
    it('대분류삭제와중분류생성경합은삭제뒤고아중분류0', async () => {
        const category = '대-' + randomUUID(), id = randomUUID();
        await run({
            version: 1, reference: ref(), action: 'createCategory', categoryId: id, name: category, order: 0, createdAt
        });
        const sub: DocumentCategoryRequest = {
            version: 1, reference: ref(), action: 'createSubCategory', subCategoryId: randomUUID(), category, name: '새중', order: 0, createdAt
        };
        const [a, b] = await Promise.all([run(deleteCategory(id, category)), run(sub)]);
        expect([a.status, b.status].sort()).toEqual(['applied', 'rejected']);
        expect((await db.collection('fileCabinetSubCategories').get()).size).toBe(b.status === 'applied' ? 1 : 0);
    }, 30000);
    it('선택이름·명시회사변경/중복등록은거절·타회사목록·직원scope확인', async () => {
        await doc('fileCabinetCategories/foreign').set({
            companyId: 'punghoe', name: '외사'
        });
        expect((await run(deleteCategory('foreign', '외사'))).status).toBe('rejected');
        const a = ensure();
        await run(a);
        expect((await run(deleteSub(a.subCategoryId, a.category, '바뀐이름'))).status).toBe('rejected');
        expect((await run({
            version: 1, reference: ref(), action: 'createCategory', categoryId: randomUUID(), name: a.category, order: 0, createdAt
        })).status).toBe('rejected');
        await expect(executeDocumentCategoryCommand(db, actor, {
            mode: 'listPending', companyId: 'punghoe'
        })).rejects.toMatchObject({
            code: 'permission-denied'
        });
    });
    it('서버처리목록은scope별50페이지·같은회사다른UID직원격리·원문없이조회가능', async () => {
        const listActor={...actor,uid:'list-only-'+randomUUID()};
        const refs = Array.from({
            length: 51
        }, () => ref());
        const batch = db.batch();
        for (const reference of refs) {
            const target = doc('documentCategoryOperations/' + documentCategoryReceiptId(reference, listActor.uid));
            batch.create(target, {
                discoveryScopeKey: documentCategoryScopeKey('taebaek', listActor.uid, listActor.token.employeeId), requestText: null, requestHash: null, label: '중단된 분류 요청', result: {
                    version: 1, reference, actorUid: listActor.uid, employeeId: listActor.token.employeeId, requestHash: null, status: 'cancelled', message: '미처리중단'
                }
            });
        }
        await batch.commit();
        const first = await executeDocumentCategoryCommand(db, listActor, {
            mode: 'listPending', companyId: 'taebaek'
        });
        if (!('entries' in first))
            throw Error('목록아님');
        expect(first.entries).toHaveLength(50);
        expect(first.nextCursor).not.toBeNull();
        const next = await executeDocumentCategoryCommand(db, listActor, {
            mode: 'listPending', companyId: 'taebaek', cursor: first.nextCursor!
        });
        expect(next).toMatchObject({
            entries: [{
                    result: {
                        status: 'cancelled'
                    }
                }], nextCursor: null
        });
        await expect(executeDocumentCategoryCommand(db, {
            ...listActor, uid: 'other-' + listActor.uid
        }, {
            mode: 'listPending', companyId: 'taebaek'
        })).resolves.toMatchObject({
            entries: [], nextCursor: null
        });
        const employeeId = 'other-' + randomUUID();
        await doc('employees/' + employeeId).set({
            companyId: 'taebaek'
        });
        await expect(executeDocumentCategoryCommand(db, {
            ...listActor, token: {
                ...listActor.token, employeeId
            }
        }, {
            mode: 'listPending', companyId: 'taebaek'
        })).resolves.toMatchObject({
            entries: []
        });
        await expect(executeDocumentCategoryCommand(db, listActor, {
            mode: 'listPending', companyId: 'taebaek', cursor: '../bad'
        })).rejects.toMatchObject({
            code: 'invalid-argument'
        });
    });
    it('성공뒤직원삭제에도기존receiptACK보존·같은name신규ID중복정리0', async () => {
        const a = ensure();
        await run(a);
        await db.doc('employees/' + actor.token.employeeId).delete();
        try {
            expect((await run(a)).status).toBe('applied');
            expect((await db.doc('fileCabinetCategories/' + a.categoryId).get()).exists).toBe(true);
        }
        finally {
            await db.doc('employees/' + actor.token.employeeId).set({
                companyId: 'taebaek'
            });
        }
    });
});
