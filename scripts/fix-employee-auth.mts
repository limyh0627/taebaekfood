import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, deleteField, doc, getDocs, getFirestore, setDoc, updateDoc } from 'firebase/firestore';
import { hashPassword } from '../functions/src/passwordHash.ts';

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--undo') ? 'undo' : 'dry';
const root = resolve(import.meta.dirname, '..');
const backupPath = resolve(root, '로컬전용', '백업', 'employee-auth-backup.json');
const app = initializeApp({
  apiKey: 'AIzaSyBOppTpeiRV1lQDU9ijQGVHQRS-zQW-OOE',
  authDomain: 'taebaek-3abe4.firebaseapp.com',
  projectId: 'taebaek-3abe4',
});
const auth = getAuth(app);
const db = getFirestore(app);

function uidFor(employeeId: string): string {
  return `emp_${createHash('sha256').update(employeeId).digest('hex').slice(0, 28)}`;
}

try {
  await signInAnonymously(auth);
  if (mode === 'undo') {
    const backup = JSON.parse(await readFile(backupPath, 'utf8')) as { records: Array<{ id: string; data: Record<string, unknown> }> };
    for (const record of backup.records) await setDoc(doc(db, 'employees', record.id), record.data);
    console.log(JSON.stringify({ mode, restored: backup.records.length }));
  } else {
    const snapshot = await getDocs(collection(db, 'employees'));
    const accounts = snapshot.docs.filter(entry => {
      const data = entry.data();
      return typeof data.username === 'string' && data.username.trim() && typeof data.password === 'string' && data.password;
    });
    const names = new Set<string>();
    for (const entry of accounts) {
      const normalized = String(entry.data().username).trim().toLowerCase();
      if (names.has(normalized)) throw new Error(`중복 아이디가 있습니다: ${normalized}`);
      names.add(normalized);
    }

    if (mode === 'dry') {
      const migrated = snapshot.docs.filter(entry => {
        const data = entry.data();
        return typeof data.passwordHash === 'string' && !!data.authUid && !!data.usernameNormalized;
      }).length;
      const plaintextPasswords = snapshot.docs.filter(entry => typeof entry.data().password === 'string').length;
      console.log(JSON.stringify({ mode, employees: snapshot.size, plaintextAccounts: accounts.length, migrated, plaintextPasswords, duplicates: 0 }));
    } else {
      try {
        await readFile(backupPath, 'utf8');
        throw new Error(`백업이 이미 있습니다. 두 번 실행하지 않습니다: ${backupPath}`);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const records = accounts.map(entry => ({ id: entry.id, data: entry.data() }));
      await mkdir(dirname(backupPath), { recursive: true });
      await writeFile(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), records }, null, 2), 'utf8');
      for (const record of records) {
        const data = record.data as any;
        await updateDoc(doc(db, 'employees', record.id), {
          authUid: uidFor(record.id),
          usernameNormalized: String(data.username).trim().toLowerCase(),
          passwordHash: hashPassword(String(data.password)),
          password: deleteField(),
          authMigratedAt: new Date().toISOString(),
        });
      }
      console.log(JSON.stringify({ mode, migrated: records.length, backupPath }));
    }
  }
} finally {
  await deleteApp(app);
}
