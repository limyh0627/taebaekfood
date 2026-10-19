import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { DOCUMENT_CATEGORY_FENCES } from './documentCategoryCommand';
export const documentCategoryFenceId = (companyId: string, category?: string, subCategory?: string) => createHash('sha256').update(JSON.stringify([companyId, category ?? null, subCategory ?? null])).digest('hex');
/** 이름으로 연결된 문서·분류는 같은 이름 fence를 읽고 갱신해야 삭제와 생성이 직렬화된다. */
export async function readDocumentCategoryFences(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, companyId: string, paths: {
    category?: string;
    subCategory?: string;
}[]) {
    const refs = [...new Set(paths.map(p => documentCategoryFenceId(companyId, p.category, p.subCategory)))].sort().map(id => db.collection(DOCUMENT_CATEGORY_FENCES).doc(id));
    const snapshots: admin.firestore.DocumentSnapshot[] = [];
    for (const ref of refs)
        snapshots.push(await tx.get(ref));
    return {
        touch: () => {
            for (let i = 0; i < refs.length; i++)
                tx.set(refs[i], {
                    companyId, revision: Number(snapshots[i].get('revision') ?? 0) + 1
                });
        }
    };
}
export async function readDocumentCategoryPath(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, companyId: string, category: string, subCategory: string) {
    const fence = await readDocumentCategoryFences(tx, db, companyId, [{
            category
        }, {
            category, subCategory
        }]);
    const categories = await tx.get(db.collection('fileCabinetCategories').where('companyId', '==', companyId).where('name', '==', category));
    const subs = await tx.get(db.collection('fileCabinetSubCategories').where('companyId', '==', companyId).where('category', '==', category).where('name', '==', subCategory));
    return {
        exists: !categories.empty && !subs.empty, touch: fence.touch
    };
}
