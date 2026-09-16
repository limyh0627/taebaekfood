/**
 * 회사별 관리자 계정을 바로잡는다.
 *
 * - `admin`(태백식품)의 관리자 권한을 복구한다.
 * - 풍회 이은경 계정 아이디에는 `_p`를 붙이고 태백용 별도 계정은 기존 아이디를 쓴다.
 *   같은 username을 두 문서에 쓰면 로그인 조회가 2건이 되어 둘 다 막힌다.
 *
 * 기본은 미리보기, `--apply` 적용, `--undo` 복원.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { applicationDefault, cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';
const root = resolve(import.meta.dirname, '..');
const backupPath = resolve(root, '로컬전용', '백업', 'admin-company-accounts-backup.json');
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credential = keyPath
  ? cert(JSON.parse(await readFile(keyPath, 'utf8')))
  : applicationDefault();
const app = getApps()[0] ?? initializeApp({ credential, projectId: 'taebaek-3abe4' });
const db = getFirestore(app);

const 태백관리자Ref = db.collection('employees').doc('admin');
const 풍회이은경Ref = db.collection('employees').doc('emp-1773373867440');
const 태백이은경Ref = db.collection('employees').doc('admin-taebaek-eunkyung');
const 태백이은경아이디 = 'lek861215';
const 풍회이은경아이디 = 'lek861215_p';
const uidFor = (employeeId: string) => `emp_${createHash('sha256').update(employeeId).digest('hex').slice(0, 28)}`;

try {
  const [태백관리자Snap, 풍회이은경Snap, 태백이은경Snap] = await Promise.all([
    태백관리자Ref.get(), 풍회이은경Ref.get(), 태백이은경Ref.get(),
  ]);
  if (!태백관리자Snap.exists) throw new Error('employees/admin 태백식품 계정이 없다.');
  if (!풍회이은경Snap.exists) throw new Error('풍회 이은경 원본 계정이 없다.');
  const 태백관리자 = 태백관리자Snap.data()!;
  const 풍회이은경 = 풍회이은경Snap.data()!;

  if (mode === 'dry') {
    console.log(JSON.stringify({
      mode,
      changes: [
        { id: 태백관리자Ref.id, name: 태백관리자.name, username: 태백관리자.username, companyId: 'taebaek', adminAccess: true },
        { id: 풍회이은경Ref.id, name: 풍회이은경.name, username: 풍회이은경아이디, companyId: 'punghoe', adminAccess: true },
        { id: 태백이은경Ref.id, name: 풍회이은경.name, username: 태백이은경아이디, companyId: 'taebaek', adminAccess: true, action: 태백이은경Snap.exists ? '이미 있음' : '새로 생성' },
      ],
    }, null, 2));
    process.exit(0);
  }

  if (mode === 'undo') {
    const backup = JSON.parse(await readFile(backupPath, 'utf8')) as {
      adminBefore: Record<string, unknown>;
      punghoeEunkyungBefore: Record<string, unknown>;
      taebaekEunkyungBefore: Record<string, unknown> | null;
    };
    const batch = db.batch();
    batch.set(태백관리자Ref, backup.adminBefore);
    batch.set(풍회이은경Ref, backup.punghoeEunkyungBefore);
    if (backup.taebaekEunkyungBefore) batch.set(태백이은경Ref, backup.taebaekEunkyungBefore);
    else batch.delete(태백이은경Ref);
    await batch.commit();
    console.log(JSON.stringify({ mode, restored: [태백관리자Ref.id, 태백이은경Ref.id] }));
    process.exit(0);
  }

  try {
    await readFile(backupPath, 'utf8');
    throw new Error(`백업이 이미 있다. 두 번 실행하지 않는다: ${backupPath}`);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const [태백아이디사용, 풍회아이디사용] = await Promise.all([
    db.collection('employees').where('usernameNormalized', '==', 태백이은경아이디).get(),
    db.collection('employees').where('usernameNormalized', '==', 풍회이은경아이디).get(),
  ]);
  const 태백충돌 = 태백아이디사용.docs.find(doc => doc.id !== 풍회이은경Ref.id && doc.id !== 태백이은경Ref.id);
  const 풍회충돌 = 풍회아이디사용.docs.find(doc => doc.id !== 풍회이은경Ref.id);
  if (태백충돌) throw new Error(`이미 쓰는 아이디다: ${태백이은경아이디}`);
  if (풍회충돌) throw new Error(`이미 쓰는 아이디다: ${풍회이은경아이디}`);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    adminBefore: 태백관리자,
    punghoeEunkyungBefore: 풍회이은경,
    taebaekEunkyungBefore: 태백이은경Snap.exists ? 태백이은경Snap.data() : null,
  }, null, 2), 'utf8');

  const { fcmTokens: _tokens, fcmDevices: _devices, authUid: _authUid, username: _username,
    usernameNormalized: _normalized, companyId: _companyId, ...직원정보 } = 풍회이은경;
  const batch = db.batch();
  batch.update(태백관리자Ref, { companyId: 'taebaek', adminAccess: true });
  batch.update(풍회이은경Ref, { username: 풍회이은경아이디, usernameNormalized: 풍회이은경아이디 });
  batch.set(태백이은경Ref, {
    ...직원정보,
    companyId: 'taebaek',
    adminAccess: true,
    username: 태백이은경아이디,
    usernameNormalized: 태백이은경아이디,
    authUid: uidFor(태백이은경Ref.id),
    companyAccountCreatedAt: new Date().toISOString(),
  });
  await batch.commit();
  console.log(JSON.stringify({ mode, updated: [태백관리자Ref.id, 풍회이은경Ref.id], created: 태백이은경Ref.id, usernames: { taebaek: 태백이은경아이디, punghoe: 풍회이은경아이디 } }));
} finally {
  await deleteApp(app);
}
