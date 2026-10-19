import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, deleteObject, getBytes } from 'firebase/storage';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const running = async () => {
    try {
        return (await fetch('http://127.0.0.1:9199/', {
            signal: AbortSignal.timeout(1500)
        })).status < 500;
    }
    catch {
        return false;
    }
};
const ready = process.env.FIREBASE_STORAGE_EMULATOR_HOST === '127.0.0.1:9199' || await running();
let env: RulesTestEnvironment;
const paths = new Set<string>(), run = randomUUID();
const bytes = new Uint8Array([1, 2, 3]);
describe.skipIf(!ready)('회사별 권한 (Storage 규칙)', () => {
    beforeAll(async () => {
        env = await initializeTestEnvironment({
            projectId: process.env.DOCUMENT_RULES_PROJECT || 'demo-storage-rules-'+run.slice(0,8), storage: {
                rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199
            }, firestore: {
                host: '127.0.0.1', port: 8182
            }
        });
    });
    afterAll(async () => {
        await env.withSecurityRulesDisabled(async (c) => {
            for (const p of paths)
                try {
                    await deleteObject(ref(c.storage(), p));
                }
                catch {
                }
            await deleteDoc(doc(c.firestore(), 'documentUploadReservations', 'up-' + run));
            await deleteDoc(doc(c.firestore(), 'noticePhotoUploads', 'notice-'+run));
        });
        await env.cleanup();
    });
    const storage = (companyId: string, admin = true) => env.authenticatedContext((admin ? 'admin-' : 'staff-') + companyId, {
        employeeId: (admin ? 'admin-' : 'staff-') + companyId, companyId, isAdmin: admin
    }).storage();
    const path = (p: string) => {
        paths.add(p);
        return p;
    };
    it('공지 사진은 예약된 같은 회사 관리자 create만·overwrite/delete금지·직원읽기유지',async()=>{
        const uploadId='notice-'+run,postId='post-'+run,p=path(`companies/taebaek/notices/${postId}/${uploadId}`),metadata={contentType:'image/png',customMetadata:{uploadId,sha256:'a'.repeat(64),actorUid:'admin-taebaek',employeeId:'admin-taebaek'}};
        await assertFails(uploadBytes(ref(storage('taebaek'),p),bytes,metadata));
        await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'noticePhotoUploads',uploadId),{companyId:'taebaek',actorUid:'admin-taebaek',employeeId:'admin-taebaek',closed:false,reference:{companyId:'taebaek',postId,uploadId},request:{size:3,contentType:'image/png',sha256:'a'.repeat(64)}}));
        await assertFails(uploadBytes(ref(storage('taebaek',false),p),bytes,metadata));
        await assertFails(uploadBytes(ref(storage('punghoe'),p),bytes,metadata));
        await assertFails(uploadBytes(ref(storage('taebaek'),p),bytes,{...metadata,contentType:'image/svg+xml'}));
        await assertSucceeds(uploadBytes(ref(storage('taebaek'),p),bytes,metadata));
        await assertSucceeds(getBytes(ref(storage('taebaek',false),p)));
        await assertFails(uploadBytes(ref(storage('taebaek'),p),bytes,metadata));
        await assertFails(deleteObject(ref(storage('taebaek'),p)));
        await env.withSecurityRulesDisabled(async c=>{await deleteObject(ref(c.storage(),p));await setDoc(doc(c.firestore(),'noticePhotoUploads',uploadId),{companyId:'taebaek',actorUid:'admin-taebaek',employeeId:'admin-taebaek',closed:true,reference:{companyId:'taebaek',postId,uploadId},request:{size:3,contentType:'image/png',sha256:'a'.repeat(64)}});});
        await assertFails(uploadBytes(ref(storage('taebaek'),p),bytes,metadata));
    });
    it('직원은 자기 회사 오피스톡에만 올린다', async () => {
        await assertSucceeds(uploadBytes(ref(storage('taebaek', false), path(`companies/taebaek/officetalk/R-${run}/a.jpg`)), bytes));
        await assertFails(uploadBytes(ref(storage('taebaek', false), `companies/punghoe/officetalk/R-${run}/a.jpg`), bytes));
    });
    it('문서함 예약된 같은회사관리자 create만·overwrite/delete/닫힌예약/다른UID 거절', async () => {
        const uploadId = 'up-' + run, p = path(`companies/punghoe/file-cabinet/uploads/${uploadId}/a.pdf`), metadata = {
            contentType: 'application/pdf', customMetadata: {
                uploadId, sha256: 'a'.repeat(64), actorUid: 'admin-punghoe', employeeId: 'admin-punghoe'
            }
        };
        await env.withSecurityRulesDisabled(async (c) => {
            await setDoc(doc(c.firestore(), 'documentUploadReservations', uploadId), {
                companyId: 'punghoe', actorUid: 'admin-punghoe', employeeId: 'admin-punghoe', closed: false, upload: {
                    uploadId, path: p, sha256: 'a'.repeat(64), size: 3, contentType: 'application/pdf'
                }
            });
        });
        await assertFails(uploadBytes(ref(storage('punghoe', false), p), bytes, metadata));
        await assertFails(uploadBytes(ref(storage('taebaek'), p), bytes, metadata));
        await assertFails(uploadBytes(ref(env.authenticatedContext('other-uid', {
            employeeId: 'admin-punghoe', companyId: 'punghoe', isAdmin: true
        }).storage(), p), bytes, metadata));
        await assertSucceeds(uploadBytes(ref(storage('punghoe'), p), bytes, metadata));
        await assertFails(uploadBytes(ref(storage('punghoe'), p), bytes, metadata));
        await assertFails(deleteObject(ref(storage('punghoe'), p)));
        await assertSucceeds(getBytes(ref(storage('punghoe'), p)));
        await assertFails(getBytes(ref(storage('punghoe', false), p)));
        await env.withSecurityRulesDisabled(async (c) => {
            await deleteObject(ref(c.storage(), p));
            await setDoc(doc(c.firestore(), 'documentUploadReservations', uploadId), {
                companyId: 'punghoe', actorUid: 'admin-punghoe', employeeId: 'admin-punghoe', closed: true, upload: {
                    uploadId, path: p, sha256: 'a'.repeat(64), size: 3, contentType: 'application/pdf'
                }
            });
        });
        await assertFails(uploadBytes(ref(storage('punghoe'), p), bytes, metadata));
    });
    it('legacy문서함파일관리자읽기는보존·새직접업로드는거절', async () => {
        const p = path(`companies/taebaek/file-cabinet/업무/일반/${run}.pdf`);
        await env.withSecurityRulesDisabled(async (c) => {
            await uploadBytes(ref(c.storage(), p), bytes);
        });
        await assertSucceeds(getBytes(ref(storage('taebaek'), p)));
        await assertFails(getBytes(ref(storage('punghoe'), p)));
        await assertFails(uploadBytes(ref(storage('taebaek'), p + 'new'), bytes));
        await assertFails(deleteObject(ref(storage('taebaek'), p)));
    });
    it('미인증·claim없는계정과옛회사없는경로거절', async () => {
        await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), `companies/taebaek/officetalk/R-${run}/a.jpg`), bytes));
        await assertFails(uploadBytes(ref(env.authenticatedContext('old', {}).storage(), `companies/taebaek/officetalk/R-${run}/b.jpg`), bytes));
        await assertFails(uploadBytes(ref(storage('taebaek'), `file-cabinet/업무/일반/${run}.pdf`), bytes));
        await assertFails(uploadBytes(ref(storage('taebaek', false), `officetalk/R-${run}/old.jpg`), bytes));
    });
    it('품목사진회사관리자JPEGPNGWebP5MB규칙보존', async () => {
        const p = path(`companies/taebaek/items/item-${run}/photo-abc.jpg`);
        await assertSucceeds(uploadBytes(ref(storage('taebaek'), p), bytes, {
            contentType: 'image/jpeg'
        }));
        for (const ext of ['png', 'webp'])
            await assertSucceeds(uploadBytes(ref(storage('taebaek'), path(`companies/taebaek/items/item-${run}/photo-ok.${ext}`)), bytes, {
                contentType: 'image/' + ext
            }));
        await assertFails(uploadBytes(ref(storage('taebaek', false), p), bytes, {
            contentType: 'image/jpeg'
        }));
        await assertFails(uploadBytes(ref(storage('punghoe'), p), bytes, {
            contentType: 'image/jpeg'
        }));
        for (const type of ['image/svg+xml', 'text/plain'])
            await assertFails(uploadBytes(ref(storage('taebaek'), p), bytes, {
                contentType: type
            }));
        await assertFails(uploadBytes(ref(storage('taebaek'), p), new Uint8Array(5 * 1024 * 1024 + 1), {
            contentType: 'image/webp'
        }));
    });
});
