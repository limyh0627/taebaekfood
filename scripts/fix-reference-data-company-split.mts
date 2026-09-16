// 회사값만 붙어 있던 기준정보를 풍회용 독립 문서로 복제한다.
//   미리보기  node scripts/fix-reference-data-company-split.mts
//   적용      node scripts/fix-reference-data-company-split.mts --apply
//   되돌리기  node scripts/fix-reference-data-company-split.mts --undo
//
// 왜 — 같은 기준정보 문서를 두 회사가 함께 쓰면 풍회에서 분류·계정과목을 고친 순간
// 태백 화면도 함께 바뀐다. 원본은 태백 것으로 보존하고 풍회는 별도 문서를 가져야 한다.
// 복제 ID를 매번 새로 만들면 재실행 때 중복되므로 `punghoe--<원본 id>`로 고정한다.
import { adminDb, 실행모드 } from './_admin.mts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

const { APPLY, UNDO } = 실행모드();
const db = adminDb();
const BACKUP = '로컬전용/백업/reference-data-company-split-backup.json';
const SOURCE_COMPANY = 'taebaek';
const TARGET_COMPANY = 'punghoe';

const EXPECTED = {
  accountCodes: 54,
  itemTaxonomy: 41,
  accountGroups: 12,
  fileCabinetCategories: 5,
  fileCabinetSubCategories: 15,
  haccp_templates: 7,
  dashboardLinks: 5,
} as const;

type CollectionName = keyof typeof EXPECTED;
type Plain = Record<string, unknown>;
type SourceDoc = { collection: CollectionName; id: string; data: Plain };
type PlannedDoc = SourceDoc & { sourceId: string; fingerprint: string };
type Backup = {
  version: 1;
  createdAt: string;
  sourceCompany: string;
  targetCompany: string;
  created: { path: string; fingerprint: string }[];
  stampedSourcePaths: string[];
};

const targetId = (sourceId: string) => `${TARGET_COMPANY}--${sourceId}`;

/** Firestore Timestamp 같은 값도 실행마다 같은 문자열이 되도록 정규화한다. */
const canonical = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return { __date: value.toISOString() };
  const maybeTimestamp = value as { toDate?: () => Date };
  if (typeof maybeTimestamp.toDate === 'function') return { __timestamp: maybeTimestamp.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.entries(value as Plain).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
};
const fingerprint = (data: Plain) => createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');

const readSources = async (): Promise<Map<CollectionName, SourceDoc[]>> => {
  const result = new Map<CollectionName, SourceDoc[]>();
  for (const collection of Object.keys(EXPECTED) as CollectionName[]) {
    const snap = await db.collection(collection).get();
    const docs = snap.docs
      // 이 스크립트로 만든 사본을 다시 원본으로 삼지 않는다.
      .filter(doc => !(doc.data().clonedFrom as Plain | undefined)?.documentId)
      .filter(doc => !doc.data().companyId || doc.data().companyId === SOURCE_COMPANY)
      .map(doc => ({ collection, id: doc.id, data: doc.data() as Plain }))
      .sort((a, b) => a.id.localeCompare(b.id));
    result.set(collection, docs);
  }
  return result;
};

/**
 * 확인된 ID 참조만 바꾼다.
 * accountCodes.groupId는 accountGroups 문서 ID다. `code`까지 모든 동일 문자열을 바꾸면
 * 문서 ID가 `500`인 계정의 실제 계정코드도 `punghoe--500`으로 망가진다.
 */
const cloneData = (source: SourceDoc, groupIds: Set<string>): Plain => {
  const id = targetId(source.id);
  const data: Plain = {
    ...source.data,
    companyId: TARGET_COMPANY,
    clonedFrom: { companyId: SOURCE_COMPANY, documentId: source.id },
  };
  if (data.id === source.id) data.id = id;
  if (source.collection === 'accountCodes' && typeof data.groupId === 'string' && groupIds.has(data.groupId)) {
    data.groupId = targetId(data.groupId);
  }
  return data;
};

const listExternalReferences = async (sourceIds: Map<string, string>): Promise<string[]> => {
  const hits: string[] = [];
  const visit = (value: unknown, path: string, owner: string) => {
    if (typeof value === 'string') {
      const sourcePath = sourceIds.get(value);
      if (sourcePath && /(^|\.)(id|.*Id|.*Ids\[\d+\])$/.test(path)) hits.push(`${owner}.${path} -> ${sourcePath}`);
      return;
    }
    if (Array.isArray(value)) return value.forEach((v, i) => visit(v, `${path}[${i}]`, owner));
    if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate !== 'function') {
      for (const [key, child] of Object.entries(value as Plain)) visit(child, path ? `${path}.${key}` : key, owner);
    }
  };
  for (const collection of await db.listCollections()) {
    const snap = await collection.get();
    for (const doc of snap.docs) visit(doc.data(), '', `${collection.id}/${doc.id}`);
  }
  return [...new Set(hits)].sort();
};

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  const changed: string[] = [];
  for (const item of backup.created) {
    const snap = await db.doc(item.path).get();
    if (snap.exists && fingerprint(snap.data() as Plain) !== item.fingerprint) changed.push(item.path);
  }
  if (changed.length) {
    console.error('\n복제 뒤 수정된 문서는 자동으로 지우지 않는다:');
    changed.forEach(path => console.error(`  - ${path}`));
    process.exit(1);
  }
  for (let i = 0; i < backup.created.length; i += 400) {
    const batch = db.batch();
    for (const item of backup.created.slice(i, i + 400)) batch.delete(db.doc(item.path));
    await batch.commit();
  }
  for (let i = 0; i < backup.stampedSourcePaths.length; i += 400) {
    const batch = db.batch();
    for (const path of backup.stampedSourcePaths.slice(i, i + 400)) {
      batch.update(db.doc(path), { companyId: FieldValue.delete() });
    }
    await batch.commit();
  }
  console.log(`풍회 기준정보 ${backup.created.length}건을 삭제해 적용 전으로 되돌렸다.`);
  process.exit(0);
}

const sources = await readSources();
const countProblems: string[] = [];
for (const [collection, expected] of Object.entries(EXPECTED) as [CollectionName, number][]) {
  const actual = sources.get(collection)?.length ?? 0;
  if (actual !== expected) countProblems.push(`${collection}: 예상 ${expected}, 실제 ${actual}`);
}
if (countProblems.length) {
  console.error('\n원본 수가 승인받은 139건과 다르다. 잘못 복제하지 않고 중단한다.');
  countProblems.forEach(x => console.error(`  - ${x}`));
  process.exit(1);
}

const groupIds = new Set((sources.get('accountGroups') ?? []).map(x => x.id));
const plan: PlannedDoc[] = [];
for (const docs of sources.values()) {
  for (const source of docs) {
    const data = cloneData(source, groupIds);
    plan.push({ collection: source.collection, sourceId: source.id, id: targetId(source.id), data, fingerprint: fingerprint(data) });
  }
}

const occupied: string[] = [];
for (const item of plan) {
  if ((await db.collection(item.collection).doc(item.id).get()).exists) occupied.push(`${item.collection}/${item.id}`);
}
if (occupied.length) {
  console.error('\n복제 목적지 문서가 이미 있다. 덮어쓰지 않고 중단한다:');
  occupied.slice(0, 30).forEach(path => console.error(`  - ${path}`));
  if (occupied.length > 30) console.error(`  … 외 ${occupied.length - 30}건`);
  process.exit(1);
}

const sourceIdIndex = new Map<string, string>();
const sourceIdCounts = new Map<string, number>();
for (const item of plan) {
  sourceIdCounts.set(item.sourceId, (sourceIdCounts.get(item.sourceId) ?? 0) + 1);
  sourceIdIndex.set(item.sourceId, `${item.collection}/${item.sourceId}`);
}
for (const [id, count] of sourceIdCounts) if (count !== 1) sourceIdIndex.delete(id);
const externalRefs = await listExternalReferences(sourceIdIndex);
const referenceCollectionNames = new Set(Object.keys(EXPECTED));
const crossCollectionRefs = externalRefs.filter(hit => !referenceCollectionNames.has(hit.slice(0, hit.indexOf('/'))));

console.log(`\n${APPLY ? '🔴 실제 적용' : '🟢 미리보기(dry) — 쓰기 없음'}`);
console.log('태백 원본은 그대로 두고 아래 수만큼 풍회 독립 문서를 만든다.');
for (const collection of Object.keys(EXPECTED) as CollectionName[]) {
  console.log(`  ${collection.padEnd(28)} ${sources.get(collection)?.length ?? 0}건`);
}
console.log(`  합계${''.padEnd(26)} ${plan.length}건`);
const stampedSources = [...sources.values()].flat().filter(source => !source.data.companyId);
console.log(`회사값이 비어 태백으로 명시할 원본: ${stampedSources.length}건`);
console.log('\n참조 치환: accountCodes.groupId -> 풍회 accountGroups ID');
console.log(`기준정보 내부 ID 참조 후보: ${externalRefs.length - crossCollectionRefs.length}건`);
console.log(`다른 업무자료에서 기준정보 ID를 가리키는 후보: ${crossCollectionRefs.length}건`);
crossCollectionRefs.forEach(x => console.log(`  - ${x}`));

if (!APPLY) {
  console.log('\n적용하지 않았다. --apply를 붙여야 쓴다.');
  process.exit(0);
}
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있다. 재실행하지 않는다: ${BACKUP}`);

const backup: Backup = {
  version: 1,
  createdAt: new Date().toISOString(),
  sourceCompany: SOURCE_COMPANY,
  targetCompany: TARGET_COMPANY,
  created: plan.map(item => ({ path: `${item.collection}/${item.id}`, fingerprint: item.fingerprint })),
  stampedSourcePaths: stampedSources.map(item => `${item.collection}/${item.id}`),
};
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');

for (let i = 0; i < plan.length; i += 400) {
  const batch = db.batch();
  for (const source of stampedSources.slice(i, i + 400)) {
    batch.update(db.collection(source.collection).doc(source.id), { companyId: SOURCE_COMPANY });
  }
  for (const item of plan.slice(i, i + 400)) batch.create(db.collection(item.collection).doc(item.id), item.data);
  await batch.commit();
}

const verificationFailures: string[] = [];
for (const item of plan) {
  const snap = await db.collection(item.collection).doc(item.id).get();
  if (!snap.exists || fingerprint(snap.data() as Plain) !== item.fingerprint) verificationFailures.push(`${item.collection}/${item.id}`);
}
for (const source of stampedSources) {
  const snap = await db.collection(source.collection).doc(source.id).get();
  if (!snap.exists || snap.data()?.companyId !== SOURCE_COMPANY) verificationFailures.push(`${source.collection}/${source.id} (원본 회사값)`);
}
if (verificationFailures.length) throw new Error(`적용 뒤 검증 실패: ${verificationFailures.join(', ')}`);
console.log(`\n풍회 기준정보 ${plan.length}건을 만들고 다시 읽어 확인했다.`);
