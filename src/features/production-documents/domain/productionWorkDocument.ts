import type { CompanyId } from '../../../shared/types';
import { kstDateRangeUtc } from '../../../shared/day';

export const PRODUCTION_WORK_PAGE_ROWS = 20;
export interface ProductionWorkDocument {
  id: string;
  companyId: CompanyId;
  documentDate: string;
  templateVersion: 1;
  specialNotes: string;
  preparedByName: string;
  reviewedByName: string;
  approvedByName: string;
  revision: number;
  rowCount?: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ProductionWorkFields {
  manufacturedDate: string;
  itemId: string | null;
  itemNameSnapshot: string;
  specSnapshot: string;
  manufacturingLotNo: string;
  expiryDate: string;
  productionQty: number | null;
  productionUnit: string;
  rawItemId: string | null;
  rawNameSnapshot: string;
  rawUsedKg: number | null;
  rawLotId: string | null;
  rawLotNoSnapshot: string;
  workerNameSnapshot: string;
  note: string;
}

export interface ProductionWorkSource {
  kind: 'production' | 'raw-usage' | 'manual';
  sourceId: string;
  operationId: string;
  ledgerId: string;
  lotId: string;
  recordedAt: string;
  importedAt: string;
}

export interface ProductionWorkDocumentLine extends ProductionWorkFields {
  id: string;
  companyId: CompanyId;
  documentId: string;
  batchKey: string;
  sortOrder: number;
  documentRevision?: number;
  source: ProductionWorkSource;
  sourceState: 'active' | 'missing' | 'reversed';
  sourceSnapshot: ProductionWorkFields;
  manualFields: Partial<Record<keyof ProductionWorkFields, true>>;
}

// 판매량과 현재 배합표는 실생산 근거가 아니므로 이 입구의 입력에 포함하지 않는다.
export interface ProductionWorkEvidence {
  companyId: CompanyId;
  key: string;
  batchKey: string;
  fields: ProductionWorkFields;
  source: Omit<ProductionWorkSource, 'importedAt'>;
  reversed: boolean;
}

export const emptyProductionWorkFields = (): ProductionWorkFields => ({
  manufacturedDate: '', itemId: null, itemNameSnapshot: '', specSnapshot: '',
  manufacturingLotNo: '', expiryDate: '', productionQty: null, productionUnit: '',
  rawItemId: null, rawNameSnapshot: '', rawUsedKg: null, rawLotId: null,
  rawLotNoSnapshot: '', workerNameSnapshot: '', note: '',
});

export function newProductionWorkDocument(
  companyId: CompanyId, date: string, actorId: string, now: string,
): ProductionWorkDocument {
  kstDateRangeUtc(date, date);
  return {
    id: `${companyId}__production-work__${date}`, companyId, documentDate: date,
    templateVersion: 1, specialNotes: '', preparedByName: '', reviewedByName: '', approvedByName: '',
    revision: 0, createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId,
  };
}

export function editProductionWorkLine<K extends keyof ProductionWorkFields>(
  line: ProductionWorkDocumentLine, key: K, value: ProductionWorkFields[K],
): ProductionWorkDocumentLine {
  return { ...line, [key]: value, manualFields: { ...line.manualFields, [key]: true } };
}

export function mergeProductionWorkEvidence(
  document: ProductionWorkDocument, existing: ProductionWorkDocumentLine[],
  evidence: ProductionWorkEvidence[], now: string,
): ProductionWorkDocumentLine[] {
  const byId = new Map<string, ProductionWorkEvidence>();
  for (const source of evidence) {
    if (source.companyId !== document.companyId) throw new Error('다른 회사의 생산 근거입니다.');
    if (!source.key || !source.batchKey) throw new Error('생산 근거의 고유번호가 없습니다.');
    const id = `${document.id}__${encodeURIComponent(source.key)}`;
    if (byId.has(id)) throw new Error('같은 생산 근거가 중복되었습니다.');
    byId.set(id, source);
  }
  const seen = new Set<string>();
  const result: ProductionWorkDocumentLine[] = existing.map(line => {
    if (line.companyId !== document.companyId || line.documentId !== document.id) throw new Error('다른 문서의 생산 행입니다.');
    if (seen.has(line.id)) throw new Error('같은 생산 행이 중복되었습니다.');
    seen.add(line.id);
    if (line.source.kind === 'manual') return line;
    const source = byId.get(line.id);
    byId.delete(line.id);
    // 원본 취소·삭제가 수동 보완을 지우지 않도록 행을 보존하고 확인 대상으로 남긴다.
    if (!source) return { ...line, sourceState: 'missing' };
    const preserved = Object.fromEntries(Object.keys(line.manualFields)
      .filter(key => line.manualFields[key as keyof ProductionWorkFields])
      .map(key => [key, line[key as keyof ProductionWorkFields]]));
    return {
      ...line, ...source.fields, ...preserved, batchKey: source.batchKey,
      sourceSnapshot: { ...source.fields },
      source: { ...source.source, importedAt: line.source.importedAt },
      sourceState: source.reversed ? 'reversed' : 'active',
    };
  });
  let sortOrder = Math.max(-1, ...existing.map(line => line.sortOrder)) + 1;
  for (const [id, source] of byId) result.push({
    ...source.fields, id, companyId: document.companyId, documentId: document.id,
    batchKey: source.batchKey, sortOrder: sortOrder++, manualFields: {},
    sourceSnapshot: { ...source.fields }, source: { ...source.source, importedAt: now },
    sourceState: source.reversed ? 'reversed' : 'active',
  });
  return result.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export function productionWorkLineIssues(line: ProductionWorkDocumentLine): string[] {
  const issues: string[] = [];
  if (line.sourceState !== 'active') issues.push(line.sourceState === 'reversed' ? '원본 취소됨' : '원본 재확인 필요');
  for (const [key, label] of [['manufacturedDate', '제조일자'], ['expiryDate', '소비기한']] as const) {
    if (!line[key]) issues.push(`${label} 미확인`);
    else { try { kstDateRangeUtc(line[key], line[key]); } catch { issues.push(`${label} 오류`); } }
  }
  for (const [key, label] of [
    ['itemNameSnapshot', '생산 품목'], ['specSnapshot', '규격'], ['manufacturingLotNo', '제조 LOT'],
    ['productionUnit', '생산 단위'], ['rawNameSnapshot', '사용 원료'],
    ['rawLotNoSnapshot', '원료 LOT'], ['workerNameSnapshot', '작업자'],
  ] as const) if (!line[key].trim()) issues.push(`${label} 미확인`);
  for (const [key, label] of [['productionQty', '생산량'], ['rawUsedKg', '원료 사용량']] as const) {
    const value = line[key];
    if (value === null || !Number.isFinite(value) || value <= 0) issues.push(`${label} 미확인`);
  }
  return issues;
}

export interface ProductionWorkPrintRow {
  line: ProductionWorkDocumentLine;
  showProduction: boolean;
  issues: string[];
}

export function productionWorkPrintPages(lines: ProductionWorkDocumentLine[]): ProductionWorkPrintRow[][] {
  const batches = new Map<string, ProductionWorkDocumentLine[]>();
  for (const line of [...lines].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))) {
    const key = JSON.stringify([line.companyId, line.documentId, line.batchKey]);
    batches.set(key, [...(batches.get(key) ?? []), line]);
  }
  const rows: ProductionWorkPrintRow[] = [];
  for (const batch of batches.values()) {
    const first = batch[0];
    const conflict = batch.some(line => line.itemId !== first.itemId || line.itemNameSnapshot !== first.itemNameSnapshot
      || line.productionQty !== first.productionQty || line.productionUnit !== first.productionUnit
      || line.specSnapshot !== first.specSnapshot || line.expiryDate !== first.expiryDate
      || line.manufacturedDate !== first.manufacturedDate || line.manufacturingLotNo !== first.manufacturingLotNo);
    batch.forEach((line, index) => rows.push({
      line, showProduction: index === 0,
      issues: [...productionWorkLineIssues(line), ...(conflict ? ['같은 생산 묶음의 정보 불일치'] : [])],
    }));
  }
  const pages: ProductionWorkPrintRow[][] = [];
  for (let offset = 0; offset < rows.length; offset += PRODUCTION_WORK_PAGE_ROWS) {
    pages.push(rows.slice(offset, offset + PRODUCTION_WORK_PAGE_ROWS));
  }
  return pages.length ? pages : [[]];
}
