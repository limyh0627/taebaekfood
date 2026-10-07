import { collection, doc, getDocsFromServer, query, where, runTransaction } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { kstDateRangeUtc } from '../day';
import { COL } from '../collections';
import { withClaimCompany } from '../companyWriteBoundary';
import { companyScopedWriteData } from './firebaseService';
const stripUndefined = (value: any): any => Array.isArray(value) ? value.map(stripUndefined) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k,v]) => [k,stripUndefined(v)])) : value;

export interface ProductionDocumentWrite extends Record<string, unknown> {
  id: string;
  companyId: string;
  revision: number;
}
export interface ProductionDocumentLineWrite extends Record<string, unknown> {
  id: string;
  companyId: string;
  documentId: string;
}

/** 새 생산서류만 통과시키는 문이다. 다른 업무 컬렉션을 받지 않아 원장을 함께 쓸 수 없다. */
export async function replaceProductionWorkDocument(
  header: ProductionDocumentWrite,
  lines: ProductionDocumentLineWrite[],
  expectedRevision: number,
): Promise<{ header: ProductionDocumentWrite; lines: ProductionDocumentLineWrite[] }> {
  const scoped = await companyScopedWriteData(COL.productionWorkDocuments, header);
  const companyId = String(scoped.companyId);
  const actorId = auth.currentUser!.uid;
  if (typeof header.documentDate !== 'string') throw new Error('생산일지 날짜를 확인해 주세요.');
  kstDateRangeUtc(header.documentDate, header.documentDate);
  if (header.id !== companyId + '__production-work__' + header.documentDate) throw new Error('생산일지 문서번호와 날짜가 일치하지 않습니다.');
  const validId = (id: string) => typeof id === 'string' && id.length > 0 && id.length < 1200 && !id.includes('/');
  if (!validId(header.id) || !header.id.startsWith(`${companyId}__production-work__`)) throw new Error('생산일지 문서번호가 올바르지 않습니다.');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || header.revision !== expectedRevision) {
    throw new Error('생산일지 버전이 올바르지 않습니다.');
  }
  if (lines.length > 200) throw new Error('생산일지는 한 번에 200행까지 저장할 수 있습니다. 부분 저장하지 않았습니다.');
  const ids = new Set<string>();
  const nextLines = lines.map(line => {
    if (!validId(line.id) || !line.id.startsWith(`${header.id}__`) || ids.has(line.id) || line.documentId !== header.id) {
      throw new Error('생산일지 행 번호 또는 연결이 올바르지 않습니다.');
    }
    for (const field of ['productionQty', 'rawUsedKg']) {
      const value = line[field];
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('수량은 0 이상의 유한한 숫자로 입력해 주세요.');
    }
    ids.add(line.id);
    return {
      ...withClaimCompany(COL.productionWorkDocumentLines, stripUndefined(line), { companyId }),
      id: line.id, companyId, documentId: header.id, documentRevision: expectedRevision + 1,
    } as ProductionDocumentLineWrite;
  });
  if (new TextEncoder().encode(JSON.stringify([header, nextLines])).length > 4_000_000) {
    throw new Error('생산일지 내용이 저장 한도를 초과했습니다. 부분 저장하지 않았습니다.');
  }
  // 웹 SDK transaction은 질의를 못 받는다. 서버에서 행 ID를 읽고 헤더 revision을 같은 거래에서
  // 재검사한다. 행 쓰기도 헤더 revision 증가를 동반하도록 규칙을 묶어 phantom 행을 막는다.
  const previousRows = await getDocsFromServer(query(
    collection(db, COL.productionWorkDocumentLines),
    where('companyId', '==', companyId), where('documentId', '==', header.id),
  ));
  const allIds = [...new Set([...previousRows.docs.map(row => row.id), ...ids])];
  if (allIds.length > 400) throw new Error('행 교체 한도를 초과했습니다. 부분 저장하지 않았습니다.');
  const now = new Date().toISOString();
  return runTransaction(db, async tx => {
    const headerRef = doc(db, COL.productionWorkDocuments, header.id);
    const oldHeader = await tx.get(headerRef);
    const current = oldHeader.exists() ? oldHeader.data() : null;
    if (current && (current.companyId !== companyId || oldHeader.id !== header.id)) throw new Error('다른 회사의 생산일지입니다.');
    if ((current?.revision ?? 0) !== expectedRevision || (!current && expectedRevision !== 0)) {
      throw new Error('다른 직원이 먼저 저장했습니다. 입력 내용을 보관한 뒤 최신 문서를 다시 열어 주세요.');
    }
    const refs = allIds.map(id => doc(db, COL.productionWorkDocumentLines, id));
    const oldLines = await Promise.all(refs.map(ref => tx.get(ref)));
    for (const old of oldLines) {
      if (old.exists() && (old.data().companyId !== companyId || old.data().documentId !== header.id)) {
        throw new Error('다른 문서의 생산 행을 덮어쓸 수 없습니다.');
      }
    }
    const nextHeader = {
      ...stripUndefined(scoped), id: header.id, companyId, revision: expectedRevision + 1,
      rowCount: nextLines.length, createdAt: current?.createdAt ?? now,
      createdBy: current?.createdBy ?? actorId, updatedAt: now, updatedBy: actorId,
    } as ProductionDocumentWrite;
    // 모든 읽기를 마친 다음에만 쓴다. 배치 분할이나 재고 컬렉션 쓰기는 이 경로에 없다.
    tx.set(headerRef, nextHeader);
    for (const line of nextLines) tx.set(doc(db, COL.productionWorkDocumentLines, line.id), line);
    for (const ref of refs) if (!ids.has(ref.id)) tx.delete(ref);
    return { header: nextHeader, lines: nextLines };
  });
}
