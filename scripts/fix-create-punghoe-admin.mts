/** 풍회 전용 관리자 계정 pung을 만든다. 기본 dry, --apply 적용, --undo 복원. */
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { applicationDefault, cert, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';
const root = resolve(import.meta.dirname, '..');
const backupPath = resolve(root, '로컬전용', '백업', 'create-punghoe-admin-backup.json');
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credential = keyPath ? cert(JSON.parse(await readFile(keyPath, 'utf8'))) : applicationDefault();
const app = getApps()[0] ?? initializeApp({ credential, projectId: 'taebaek-3abe4' });
const db = getFirestore(app);
const ref = db.collection('employees').doc('admin-punghoe');
const username = 'pung';
const uidFor = (id: string) => `emp_${createHash('sha256').update(id).digest('hex').slice(0, 28)}`;
const hashPassword = (password: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `$scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
};

try {
  const [current, duplicate] = await Promise.all([
    ref.get(),
    db.collection('employees').where('usernameNormalized', '==', username).get(),
  ]);
  const conflict = duplicate.docs.find(doc => doc.id !== ref.id);
  if (conflict) throw new Error(`이미 쓰는 아이디다: ${username}`);

  if (mode === 'dry') {
    console.log(JSON.stringify({ mode, action: current.exists ? '기존 문서 갱신' : '새로 생성', account: {
      id: ref.id, name: '풍회', username, companyId: 'punghoe', adminAccess: true, status: 'working',
    } }, null, 2));
    process.exit(0);
  }

  if (mode === 'undo') {
    const backup = JSON.parse(await readFile(backupPath, 'utf8')) as { before: Record<string, unknown> | null };
    if (backup.before) await ref.set(backup.before);
    else await ref.delete();
    console.log(JSON.stringify({ mode, restored: ref.id }));
    process.exit(0);
  }

  try {
    await readFile(backupPath, 'utf8');
    throw new Error(`백업이 이미 있다. 두 번 실행하지 않는다: ${backupPath}`);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, JSON.stringify({
    createdAt: new Date().toISOString(), before: current.exists ? current.data() : null,
  }, null, 2), 'utf8');
  await ref.set({
    name: '풍회', username, usernameNormalized: username,
    passwordHash: hashPassword('0000'), authUid: uidFor(ref.id),
    companyId: 'punghoe', adminAccess: true,
    position: '관리자', department: '관리', joinDate: '', phone: '', status: 'working',
    authMigratedAt: new Date().toISOString(), companyAccountCreatedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ mode, created: ref.id, username, companyId: 'punghoe' }));
} finally {
  await deleteApp(app);
}
