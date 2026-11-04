// Firestore 문서를 Supabase(Postgres)의 raw.docs에 원본 그대로 복사한다. 읽기만 하고 Firestore에는 쓰지 않는다.
// 실행: GOOGLE_APPLICATION_CREDENTIALS(Firestore 읽기 권한) + SUPABASE_DB_URL 환경 변수가 있어야 한다.
//   node scripts/supabase/export-firestore.mjs
import admin from 'firebase-admin';
import pg from 'pg';

const PROJECT_ID = 'taebaek-3abe4';
// 시험 이전 대상(핵심만). 예약·처리 기록처럼 새 구조로 옮기지 않을 컬렉션은 넣지 않는다.
const COLLECTIONS = [
  'partners', 'partner_item', 'items', 'item_bom', 'item_formula', 'item_pack', 'item_purchase_unit',
  'employees', 'orders', 'productionRecords', 'rawMaterialLedger', 'rawInventories',
];
// 옮기지 않을 칸. 비밀번호 해시와 푸시 토큰은 새 DB에 절대 두지 않는다.
const DROP_FIELDS = {
  employees: ['passwordHash', 'fcmTokens', 'fcmDevices', 'username', 'usernameNormalized'],
};
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
      for (const f of DROP_FIELDS[name] ?? []) delete data[f];
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
await client.end();

console.log('\n| 컬렉션 | 복사한 문서 |\n|---|---|');
for (const [n, c] of summary) console.log(`| ${n} | ${c} |`);
