import { signInWithCustomToken } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from './firebase';
import type { CompanyId, Employee } from './types';

type LoginResponse = { customToken: string; employee: Employee };

export type LoginApp = 'admin' | 'staff';

export async function loginEmployee(
  username: string,
  password: string,
  appKind: LoginApp,
  companyId?: CompanyId,
): Promise<Employee> {
  const call = httpsCallable<{
    username: string;
    password: string;
    app: LoginApp;
    companyId?: CompanyId;
  }, LoginResponse>(
    getFunctions(app, 'asia-northeast3'),
    'employeeLogin',
  );
  const result = await call({ username: username.trim(), password, app: appKind, companyId });
  await signInWithCustomToken(auth, result.data.customToken);
  return result.data.employee;
}
