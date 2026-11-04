// 서류함 파일을 Firebase Storage에서 Supabase Storage('files' 버킷)로 복사한다. Firebase 쪽은 읽기만 한다.
// 이미 있는 파일은 건너뛴다(여러 번 돌려도 된다). 경로: {회사}/legacy/{파일 id}
// 환경 변수: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_APPLICATION_CREDENTIALS(Storage 읽기 권한)
import admin from 'firebase-admin';
import pg from 'pg';

const BUCKET = 'taebaek-3abe4.firebasestorage.app';
for (const k of ['SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!process.env[k]) throw new Error(`${k} 환경 변수가 없습니다.`);
const base = new URL(process.env.SUPABASE_URL).origin;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

admin.initializeApp({ projectId: 'taebaek-3abe4', storageBucket: BUCKET });
const bucket = admin.storage().bucket();
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`select id, company_id, storage_path, content_type, file_name from erp.files
                                 where storage_path is not null and storage_path not like company_id || '/%' order by id`);
await db.end();

let copied = 0, skipped = 0, failed = 0, bytes = 0;
const failures = [];
for (const f of rows) {
  const target = `${f.company_id}/legacy/${f.id}`;
  try {
    const head = await fetch(`${base}/storage/v1/object/info/files/${encodeURI(target)}`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
    if (head.ok) { skipped++; continue; }
    const [buf] = await bucket.file(f.storage_path).download();
    const res = await fetch(`${base}/storage/v1/object/files/${encodeURI(target)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': f.content_type || 'application/octet-stream', 'x-upsert': 'false' },
      body: buf,
    });
    if (!res.ok && res.status !== 409) throw new Error(`${res.status} ${await res.text()}`);
    copied++; bytes += buf.length;
  } catch (e) {
    failed++; failures.push(`${f.file_name} (${f.storage_path}): ${e.message}`);
  }
}
console.log(`\n| 서류함 파일 | 건수 |\n|---|---|\n| 복사 | ${copied} (${(bytes / 1048576).toFixed(1)}MB) |\n| 이미 있음 | ${skipped} |\n| 실패 | ${failed} |`);
for (const line of failures.slice(0, 30)) console.log(`- 실패: ${line}`);
