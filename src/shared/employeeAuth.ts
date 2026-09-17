import { signInWithCustomToken, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, usingFirebaseEmulators } from './firebase';
import type { CompanyId, Employee } from './types';

type LoginResponse = { customToken: string; employee: Employee };

export type LoginApp = 'admin' | 'staff';

export async function loginEmployee(
  username: string,
  password: string,
  appKind: LoginApp,
  companyId?: CompanyId,
): Promise<Employee> {
  if (usingFirebaseEmulators) {
    const credential = await signInWithEmailAndPassword(auth, `${username.trim()}@local.test`, password);
    const snapshot = await getDoc(doc(db, 'employees', credential.user.uid));
    if (!snapshot.exists()) throw new Error('로컬 직원 계정을 찾을 수 없습니다.');
    const employee = { id: snapshot.id, ...snapshot.data() } as Employee;
    if (companyId && employee.companyId !== companyId) throw new Error('회사 불일치');
    if (appKind === 'admin' && !employee.adminAccess) throw new Error('관리자 권한 없음');
    return employee;
  }
  const call = httpsCallable<{
    username: string;
    password: string;
    app: LoginApp;
    companyId?: CompanyId;
  }, LoginResponse>(
    functions,
    'employeeLogin',
  );
  const result = await call({ username: username.trim(), password, app: appKind, companyId });
  await signInWithCustomToken(auth, result.data.customToken);
  return result.data.employee;
}
