/** 모든 기존 오피스톡 방을 태백으로 확정하고 옛 이은경 ID를 태백 계정으로 바꾼다. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminDb, 실행모드 } from './_admin.mts';
import type { Employee } from '../src/shared/types.ts';
import { participantCompaniesOf } from '../src/shared/chatParticipants.ts';

const { APPLY, UNDO } = 실행모드();
const db = adminDb();
const BACKUP = '로컬전용/백업/chat-room-participant-companies.json';
const OLD_EUNKYUNG = 'emp-1773373867440';
const TAEBAEK_EUNKYUNG = 'admin-taebaek-eunkyung';
type DocData = Record<string, unknown>;
type Saved = { before: DocData; after: DocData };
type Backup = { savedAt: string; rooms: Record<string, Saved>; messages: Record<string, Saved> };
const replaceId = (id: string | undefined) => id === OLD_EUNKYUNG ? TAEBAEK_EUNKYUNG : id;
const replaceIds = (ids: unknown): string[] => [...new Set((Array.isArray(ids) ? ids : []).map(String).map(id => replaceId(id)!))];
const replaceMapKey = (value: unknown): unknown => !value || typeof value !== 'object' || Array.isArray(value)
  ? value
  : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, row]) => [replaceId(key)!, row]));
const json = (value: unknown) => JSON.stringify(value);

if (UNDO) {
  if (!existsSync(BACKUP)) throw new Error(`백업이 없습니다: ${BACKUP}`);
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Backup;
  for (const [collection, rows] of [['chatRooms', backup.rooms], ['chatMessages', backup.messages]] as const) for (const [id, saved] of Object.entries(rows)) {
    const current = (await db.collection(collection).doc(id).get()).data() ?? {};
    if (json(current) !== json(saved.after)) throw new Error(`${collection}/${id}: 이관 뒤 수정돼 복구를 중단합니다.`);
  }
  const batch = db.batch();
  for (const [id, saved] of Object.entries(backup.rooms)) batch.set(db.collection('chatRooms').doc(id), saved.before);
  for (const [id, saved] of Object.entries(backup.messages)) batch.set(db.collection('chatMessages').doc(id), saved.before);
  await batch.commit();
  console.log(`방 ${Object.keys(backup.rooms).length}개·메시지 ${Object.keys(backup.messages).length}개를 복구했습니다.`);
  process.exit(0);
}

const [roomSnap, employeeSnap, messageSnap] = await Promise.all([
  db.collection('chatRooms').get(), db.collection('employees').get(), db.collection('chatMessages').get(),
]);
const employees = employeeSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as Employee));
if (!employees.some(employee => employee.id === TAEBAEK_EUNKYUNG && employee.companyId === 'taebaek')) throw new Error('태백 이은경 계정이 없습니다.');

const rooms: Record<string, Saved> = {};
for (const snap of roomSnap.docs) {
  const before = snap.data() as DocData;
  const participantIds = replaceIds(before.participantIds);
  const notice = before.notice && typeof before.notice === 'object'
    ? { ...(before.notice as DocData), by: replaceId(String((before.notice as DocData).by ?? '')) }
    : before.notice;
  const after: DocData = {
    ...before, companyId: 'taebaek', participantIds,
    participantCompanies: participantCompaniesOf(participantIds, employees, 'taebaek'),
    createdBy: replaceId(typeof before.createdBy === 'string' ? before.createdBy : undefined),
    nameBy: replaceMapKey(before.nameBy), lastReadBy: replaceMapKey(before.lastReadBy),
    pinnedBy: replaceMapKey(before.pinnedBy), notice,
  };
  for (const key of ['createdBy', 'nameBy', 'lastReadBy', 'pinnedBy', 'notice']) if (after[key] === undefined) delete after[key];
  if (json(before) !== json(after)) rooms[snap.id] = { before, after };
}

const roomIds = new Set(roomSnap.docs.map(doc => doc.id));
const messages: Record<string, Saved> = {};
let punghoeStorageRefs = 0;
for (const snap of messageSnap.docs) {
  const before = snap.data() as DocData;
  if (!roomIds.has(String(before.roomId ?? ''))) continue;
  const reactions = before.reactions && typeof before.reactions === 'object'
    ? Object.fromEntries(Object.entries(before.reactions as Record<string, unknown>).map(([emoji, ids]) => [emoji, replaceIds(ids)]))
    : before.reactions;
  const after: DocData = {
    ...before, companyId: 'taebaek',
    senderId: replaceId(typeof before.senderId === 'string' ? before.senderId : undefined),
    mentions: replaceIds(before.mentions),
    deletedBy: replaceId(typeof before.deletedBy === 'string' ? before.deletedBy : undefined), reactions,
  };
  for (const key of ['mentions', 'deletedBy', 'reactions']) if (after[key] === undefined || (key === 'mentions' && !Array.isArray(before.mentions))) delete after[key];
  if (json(before).includes('/punghoe/') || json(before).includes('%2Fpunghoe%2F')) punghoeStorageRefs += 1;
  if (json(before) !== json(after)) messages[snap.id] = { before, after };
}

console.log(`모든 기존 방을 태백으로 확정: 방 ${Object.keys(rooms).length}개 / 메시지 ${Object.keys(messages).length}개 변경`);
console.log(`옛 이은경 ID ${OLD_EUNKYUNG} → ${TAEBAEK_EUNKYUNG}`);
console.log(`풍회 Storage 경로를 가리키는 메시지: ${punghoeStorageRefs}개`);
console.log(APPLY ? '실제 적용' : '미리보기(dry) — 쓰기 없음');
if (!APPLY) process.exit(0);
if (punghoeStorageRefs > 0) throw new Error('풍회 Storage 참조를 태백 경로로 먼저 옮겨야 합니다.');
if (existsSync(BACKUP)) throw new Error(`기존 백업이 있습니다: ${BACKUP}`);
const backup: Backup = { savedAt: new Date().toISOString(), rooms, messages };
mkdirSync(dirname(BACKUP), { recursive: true });
writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');
const batch = db.batch();
for (const [id, saved] of Object.entries(rooms)) batch.set(db.collection('chatRooms').doc(id), saved.after);
for (const [id, saved] of Object.entries(messages)) batch.set(db.collection('chatMessages').doc(id), saved.after);
await batch.commit();
for (const [collection, rows] of [['chatRooms', rooms], ['chatMessages', messages]] as const) for (const [id, saved] of Object.entries(rows)) {
  const current = (await db.collection(collection).doc(id).get()).data() ?? {};
  if (json(current) !== json(saved.after)) throw new Error(`${collection}/${id}: 적용 뒤 재조회 검증 실패`);
}
console.log(`방 ${Object.keys(rooms).length}개·메시지 ${Object.keys(messages).length}개 적용·재조회 검증 완료`);
