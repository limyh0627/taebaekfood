import { signInWithCustomToken } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from './firebase';
import type { Employee } from './types';

type LoginResponse = { customToken: string; employee: Employee };

export async function loginEmployee(username: string, password: string): Promise<Employee> {
  const call = httpsCallable<{ username: string; password: string }, LoginResponse>(
    getFunctions(app, 'asia-northeast3'),
    'employeeLogin',
  );
  const result = await call({ username: username.trim(), password });
  await signInWithCustomToken(auth, result.data.customToken);
  return result.data.employee;
}
