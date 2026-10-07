import { arrayUnion, arrayRemove, deleteField, doc, updateDoc, FieldPath } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { COL } from '../collections';

/** 직원 문서 ID는 Auth UID가 아니라 로그인 토큰의 employeeId이다. */
export async function updateOwnPushToken(employeeId: string, token: string, device?: { name: string; at: string }): Promise<void> {
  await authReady;
  const user = auth.currentUser;
  if (!user || user.isAnonymous || (await user.getIdTokenResult()).claims.employeeId !== employeeId) {
    throw new Error('본인의 푸시 정보만 변경할 수 있습니다.');
  }
  const ref = doc(db, COL.employees, employeeId);
  await updateDoc(ref,
    'fcmTokens', device ? arrayUnion(token) : arrayRemove(token),
    new FieldPath('fcmDevices', token), device ?? deleteField());
}
