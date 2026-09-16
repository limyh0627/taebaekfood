// 문서함·오피스톡의 옛 Storage 경로를 companies/{companyId}/... 아래로 복사한다.
//   미리보기  npx tsx scripts/fix-storage-company-paths.mts
//   적용      npx tsx scripts/fix-storage-company-paths.mts --apply
//   되돌리기  npx tsx scripts/fix-storage-company-paths.mts --undo
//
// 원본은 이 스크립트가 절대 지우지 않는다. 새 파일의 크기·MD5를 확인한 뒤에만 Firestore
// 참조를 바꾸며, 원본 정리는 별도 검증·승인 뒤 별도 스크립트로 해야 한다.
import { getStorage } from 'firebase-admin/storage';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';
import { hasExpectedFields, requireStorageCompany, type StorageCompanyId } from './storage-company-paths-safety.mts';

// tsx가 top-level await 오류 때 변환된 스크립트 전체를 stack에 찍는다. 운영 파일 경로가 수백 줄로
// 쏟아지는 것보다 실패 이유 한 줄이 안전하고 읽기 쉽다.
Error.stackTraceLimit = 0;

type FileMove = { source: string; destination: string; size: string; md5Hash?: string; token?: string };
type DocRestore = { path: string; fields: Record<string, unknown>; expected: Record<string, unknown> };
type Backup = { bucket: string; files: FileMove[]; docs: DocRestore[] };

const { APPLY, UNDO } = 실행모드();
const BACKUP = '로컬전용/백업/storage-company-paths-backup.json';
const PROJECT = 'taebaek-3abe4';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT}.firebasestorage.app`;
const db = adminDb();
const bucket = getStorage().bucket(BUCKET);

const 스토리지 = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
  try { return await work(); }
  catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code === '403') {
      throw new Error(`${label}: 서비스 계정에 Storage 객체 권한이 없다(roles/storage.objectAdmin 필요).`);
    }
    throw new Error(`${label}: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
  }
};

const 새경로 = (companyId: StorageCompanyId, oldPath: string) => `companies/${companyId}/${oldPath}`;
const 토큰 = (metadata: Record<string, unknown>): string | undefined => {
  const raw = metadata.firebaseStorageDownloadTokens;
  return typeof raw === 'string' ? raw.split(',')[0] : undefined;
};
const 다운로드주소 = (path: string, token?: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media${token ? `&token=${encodeURIComponent(token)}` : ''}`;

/** Firebase 다운로드 URL에서 객체 경로만 꺼낸다. 외부 URL은 건드리지 않는다. */
const url경로 = (url: unknown): string | undefined => {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'firebasestorage.googleapis.com') return undefined;
    const marker = '/o/';
    const at = parsed.pathname.indexOf(marker);
    if (at < 0) return undefined;
    return decodeURIComponent(parsed.pathname.slice(at + marker.length));
  } catch { return undefined; }
};

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  if (backup.bucket !== BUCKET) throw new Error('백업의 Storage bucket이 현재 bucket과 다르다.');
  // 먼저 전부 검사한다. 한 건이라도 이후에 바뀌었으면 일부만 되돌리는 상태를 만들지 않는다.
  for (const row of backup.docs) {
    const snap = await db.doc(row.path).get();
    const current = snap.data() ?? {};
    // 복사 도중 실패해 Firestore 쓰기 전이라면 옛 값 그대로다. 그 상태도 안전하게 청소할 수 있다.
    if (!snap.exists || (!hasExpectedFields(current, row.expected) && !hasExpectedFields(current, row.fields))) {
      throw new Error(`${row.path}: 적용 뒤 값이 바뀌어 undo를 중단한다. 현재 변경을 먼저 확인해야 한다.`);
    }
  }
  for (let i = 0; i < backup.docs.length; i += 400) {
    const batch = db.batch();
    for (const row of backup.docs.slice(i, i + 400)) batch.update(db.doc(row.path), row.fields);
    await batch.commit();
  }
  // 원본은 그대로 있으므로, 우리가 만든 목적지만 없애면 파일 상태도 원상복구된다.
  for (const row of backup.files) await 스토리지(`복사본 삭제 ${row.destination}`, () => bucket.file(row.destination).delete({ ignoreNotFound: true }));
  console.log(`Firestore ${backup.docs.length}건 복원 · 복사본 ${backup.files.length}개 삭제. 원본은 그대로다.`);
  process.exit(0);
}

console.log('운영 Firestore와 Storage를 읽는다. 쓰지는 않는다…');
const fileDocs = await db.collection('fileCabinetDocs').get();
const rooms = await db.collection('chatRooms').get();
const messages = await db.collection('chatMessages').get();
// 파일을 하나 읽기 전에 전체 회사값을 검증한다. 회사 이관이 덜 된 상태에서 일부만 복사하지 않는다.
for (const doc of fileDocs.docs) requireStorageCompany(doc.data().companyId, doc.ref.path);
for (const doc of rooms.docs) requireStorageCompany(doc.data().companyId, doc.ref.path);
const roomCompany = new Map(rooms.docs.map(doc => [doc.id, requireStorageCompany(doc.data().companyId, doc.ref.path)]));

const moveBySource = new Map<string, FileMove>();
const restoreByDoc = new Map<string, DocRestore>();
const nextByDoc = new Map<string, Record<string, unknown>>();

const 파일등록 = async (source: string, companyId: StorageCompanyId) => {
  if (source.startsWith('companies/')) return;
  const destination = 새경로(companyId, source);
  const prior = moveBySource.get(source);
  if (prior && prior.destination !== destination) throw new Error(`같은 파일의 회사 판정이 갈린다: ${source}`);
  if (prior) return;
  const [meta] = await 스토리지(`원본 확인 ${source}`, () => bucket.file(source).getMetadata());
  const [destinationExists] = await 스토리지(`목적지 확인 ${destination}`, () => bucket.file(destination).exists());
  if (destinationExists) {
    throw new Error(`목적지가 이미 있다: ${destination}. 덮어쓰지 않고 중단한다.`);
  }
  moveBySource.set(source, {
    source, destination, size: String(meta.size ?? ''), md5Hash: meta.md5Hash, token: 토큰(meta.metadata ?? {}),
  });
};

for (const snap of fileDocs.docs) {
  const data = snap.data();
  const source = String(data.storagePath ?? '');
  if (!source || source.startsWith('companies/')) continue;
  if (!source.startsWith('file-cabinet/')) throw new Error(`알 수 없는 문서함 경로: ${snap.ref.path} → ${source}`);
  await 파일등록(source, requireStorageCompany(data.companyId, snap.ref.path));
  const move = moveBySource.get(source)!;
  const expected = { storagePath: move.destination, downloadUrl: 다운로드주소(move.destination, move.token) };
  restoreByDoc.set(snap.ref.path, {
    path: snap.ref.path, fields: { storagePath: source, downloadUrl: data.downloadUrl }, expected,
  });
  nextByDoc.set(snap.ref.path, expected);
}

// 메시지는 path 칸이 없어서 URL 세 칸에서 옛 경로를 복원한다.
for (const snap of messages.docs) {
  const data = snap.data();
  const roomId = String(data.roomId ?? '');
  // 방을 지운 뒤 메시지만 남은 옛 자료가 한 건 있다. 이때도 메시지 자체의 회사값은
  // 2차 회사 이관에서 원본 관계로 확정됐으므로 그 값을 쓴다. 둘 다 없으면 추정하지 않는다.
  const companyId = roomCompany.get(roomId) ?? requireStorageCompany(data.companyId, snap.ref.path);
  const oldFields: Record<string, unknown> = {};
  const newFields: Record<string, unknown> = {};
  for (const key of ['imageUrl', 'fileUrl'] as const) {
    const source = url경로(data[key]);
    if (!source || source.startsWith('companies/') || !source.startsWith('officetalk/')) continue;
    await 파일등록(source, companyId);
    const move = moveBySource.get(source)!;
    oldFields[key] = data[key];
    newFields[key] = 다운로드주소(move.destination, move.token);
  }
  if (Array.isArray(data.images)) {
    const next = [...data.images];
    let changed = false;
    for (let i = 0; i < next.length; i++) {
      const source = url경로(next[i]);
      if (!source || source.startsWith('companies/') || !source.startsWith('officetalk/')) continue;
      await 파일등록(source, companyId);
      const move = moveBySource.get(source)!;
      next[i] = 다운로드주소(move.destination, move.token);
      changed = true;
    }
    if (changed) { oldFields.images = data.images; newFields.images = next; }
  }
  if (Object.keys(newFields).length) {
    restoreByDoc.set(snap.ref.path, { path: snap.ref.path, fields: oldFields, expected: newFields });
    nextByDoc.set(snap.ref.path, newFields);
  }
}

// 참조가 끊긴 옛 오피스톡 파일도 방 ID로 회사를 판정해 함께 보존한다.
const [legacyChats] = await 스토리지('옛 오피스톡 파일 목록', () => bucket.getFiles({ prefix: 'officetalk/' }));
for (const file of legacyChats) {
  const roomId = file.name.split('/')[1];
  // 방이 없어도 앞에서 메시지 URL로 이미 판정한 파일이면 같은 판정을 재사용한다.
  const planned = moveBySource.get(file.name);
  const plannedCompany = planned?.destination.split('/')[1];
  const companyId = roomCompany.get(roomId)
    ?? (plannedCompany === 'taebaek' || plannedCompany === 'punghoe' ? plannedCompany : undefined);
  if (!companyId) throw new Error(`방을 찾을 수 없는 오피스톡 파일: ${file.name}`);
  await 파일등록(file.name, companyId);
}

const files = [...moveBySource.values()].sort((a, b) => a.source.localeCompare(b.source));
const docs = [...restoreByDoc.values()].sort((a, b) => a.path.localeCompare(b.path));
const companyCounts = files.reduce<Record<string, number>>((acc, row) => {
  const companyId = row.destination.split('/')[1]; acc[companyId] = (acc[companyId] ?? 0) + 1; return acc;
}, {});
console.log(`\n${APPLY ? '🔴 적용' : '🟢 미리보기'}: 파일 ${files.length}개 · Firestore 참조 ${docs.length}건`);
console.table(companyCounts);
for (const row of files) console.log(`  ${row.source} → ${row.destination}`);

if (!APPLY) {
  console.log('\n미리보기였다. 원본은 지우지 않는다. 적용하려면 --apply.');
  process.exit(0);
}
if (existsSync(BACKUP)) throw new Error(`백업이 이미 있다: ${BACKUP}`);
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify({ bucket: BUCKET, files, docs } satisfies Backup, null, 2), 'utf8');

for (const row of files) {
  const [existsNow] = await 스토리지(`복사 직전 목적지 확인 ${row.destination}`, () => bucket.file(row.destination).exists());
  if (existsNow) throw new Error(`복사 직전에 목적지가 생겼다: ${row.destination}. 덮어쓰지 않고 중단한다.`);
  await 스토리지(`복사 ${row.source}`, () => bucket.file(row.source).copy(bucket.file(row.destination)));
  const [meta] = await 스토리지(`복사 확인 ${row.destination}`, () => bucket.file(row.destination).getMetadata());
  if (String(meta.size ?? '') !== row.size || (row.md5Hash && meta.md5Hash !== row.md5Hash)) {
    throw new Error(`복사 검증 실패: ${row.destination}`);
  }
}
for (let i = 0; i < docs.length; i += 400) {
  const batch = db.batch();
  for (const row of docs.slice(i, i + 400)) batch.update(db.doc(row.path), nextByDoc.get(row.path)!);
  await batch.commit();
}

// 배치 성공도 믿지 않고 다시 읽는다. 한 필드라도 예상과 다르면 원본은 그대로 둔 채 실패시킨다.
for (const row of docs) {
  const snap = await db.doc(row.path).get();
  if (!snap.exists || !hasExpectedFields(snap.data() ?? {}, row.expected)) {
    throw new Error(`${row.path}: 적용 후 Firestore 참조 검증에 실패했다. --undo로 되돌려야 한다.`);
  }
}

console.log(`\n복사·검증 ${files.length}개, 참조 변경 ${docs.length}건 완료.`);
console.log('원본 파일은 하나도 삭제하지 않았다. 되돌리려면 --undo.');
