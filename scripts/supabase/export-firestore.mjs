// Firestore 문서를 Supabase(Postgres)의 raw.docs에 원본 그대로 복사한다. 읽기만 하고 Firestore에는 쓰지 않는다.
// 실행: GOOGLE_APPLICATION_CREDENTIALS(Firestore 읽기 권한) + SUPABASE_DB_URL 환경 변수가 있어야 한다.
//   node scripts/supabase/export-firestore.mjs
import admin from 'firebase-admin';
import pg from 'pg';

const PROJECT_ID = 'taebaek-3abe4';
// 최상위 컬렉션을 전부 복사한다. 새 구조로 옮기지 않는 처리 기록·예약·중복 방지 문서만 뺀다.
const SKIP = /(Operations|AttemptsV1|AssignmentsV1|Reservations|Fences|Guards|Authorizations)$|^(sentinels|authLoginAttempts|helpChatUsage|rawInventoryJobs|inventoryWriterDeletions|orderRequestRetirements|orderManualCorrectionsV1|assignments|rawManualCorrectionReceipts)$/;
// 옮기지 않을 칸. 비밀번호 해시·푸시 토큰·로그인 아이디는 새 DB에 절대 두지 않는다(어느 컬렉션이든).
const DROP_KEY = /password|hash|token|fcm|^username/i;
const BATCH = 400;

if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL 환경 변수가 없습니다.');
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

/** Firestore 값 → JSON. 시각은 ISO 문자열, 참조는 경로 문자열로 바꾼다. */
function plain(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
  if (value instanceof admin.firestore.DocumentReference) return value.path;
  if (value instanceof admin.firestore.GeoPoint) return { lat: value.latitude, lng: value.longitude };
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const COLLECTIONS = (await db.listCollections()).map(c => c.id).filter(n => !SKIP.test(n)).sort();
console.log(`복사할 컬렉션 ${COLLECTIONS.length}개 (뺀 것: 처리 기록·예약 등)`);
const summary = [];
for (const name of COLLECTIONS) {
  await client.query('delete from raw.docs where collection = $1', [name]);
  let count = 0, last = null;
  for (;;) {
    let q = db.collection(name).orderBy(admin.firestore.FieldPath.documentId()).limit(BATCH);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const rows = snap.docs.map(doc => {
      const data = plain(doc.data()) ?? {};
      for (const f of Object.keys(data)) if (DROP_KEY.test(f)) delete data[f];
      return { collection: name, id: doc.id, company_id: typeof data.companyId === 'string' ? data.companyId : null, data };
    });
    await client.query(
      `insert into raw.docs (collection, id, company_id, data)
       select collection, id, company_id, data from jsonb_to_recordset($1::jsonb)
         as x(collection text, id text, company_id text, data jsonb)
       on conflict (collection, id) do update set company_id = excluded.company_id, data = excluded.data, imported_at = now()`,
      [JSON.stringify(rows)],
    );
    count += rows.length;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < BATCH) break;
  }
  summary.push([name, count]);
  console.log(`${name}: ${count}건`);
}
// 하위 컬렉션: 업무(workProjectsV1) 안의 할 일(tasks)과 할 일 댓글(comments). 최상위만 돌면 빠진다.
async function putRows(name, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    await client.query(
      `insert into raw.docs (collection, id, company_id, data)
       select collection, id, company_id, data from jsonb_to_recordset($1::jsonb) as x(collection text, id text, company_id text, data jsonb)
       on conflict (collection, id) do update set company_id = excluded.company_id, data = excluded.data, imported_at = now()`,
      [JSON.stringify(rows.slice(i, i + BATCH))]);
  }
}
const clean = (doc, extra) => { const d = plain(doc.data()) ?? {}; for (const f of Object.keys(d)) if (DROP_KEY.test(f)) delete d[f]; return { ...d, ...extra }; };
for (const sub of ['workProjectTasks', 'workProjectComments']) await client.query('delete from raw.docs where collection = $1', [sub]);
let nTask = 0, nComment = 0;
for (const p of (await db.collection('workProjectsV1').get()).docs) {
  const company = typeof p.data().companyId === 'string' ? p.data().companyId : null;
  const tasks = (await p.ref.collection('tasks').get()).docs;
  await putRows('workProjectTasks', tasks.map(t => ({ collection: 'workProjectTasks', id: `${p.id}:${t.id}`, company_id: company, data: clean(t, { projectId: p.id, taskId: t.id }) })));
  nTask += tasks.length;
  for (const t of tasks) {
    const cs = (await t.ref.collection('comments').get()).docs;
    await putRows('workProjectComments', cs.map(c => ({ collection: 'workProjectComments', id: `${p.id}:${t.id}:${c.id}`, company_id: company, data: clean(c, { projectId: p.id, taskId: t.id }) })));
    nComment += cs.length;
  }
}
summary.push(['workProjectTasks(하위)', nTask], ['workProjectComments(하위)', nComment]);
console.log(`업무 할 일 ${nTask}건, 댓글 ${nComment}건`);
await client.end();

console.log('\n| 컬렉션 | 복사한 문서 |\n|---|---|');
for (const [n, c] of summary) console.log(`| ${n} | ${c} |`);
