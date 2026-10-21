import { arrayUnion, arrayRemove, deleteField, doc, updateDoc, FieldPath } from 'firebase/firestore';
import { onIdTokenChanged } from 'firebase/auth';
import { auth, authReady, db } from '../firebase';
import { COL } from '../collections';

export interface PushActorContext {
  readonly ready: Promise<void>;
  assertCurrent(): void;
  dispose(): void;
}
const actors = new WeakMap<PushActorContext, { employeeId: string; companyId: string | null }>();
const changedActor = () => new Error('본인의 푸시 정보만 변경할 수 있습니다. 로그인 계정이 바뀌었다면 현재 계정에서 다시 시도해 주세요.');

/** 최초 사용자 객체와 토큰 이벤트 수명을 함께 묶어 UID 왕복과 회사 교체를 영구 차단한다. */
export function capturePushActor(employeeId: string): PushActorContext {
  const actorState = { employeeId, companyId: null as string | null };
  const user = auth.currentUser;
  const uid = user?.uid;
  let invalid = false;
  let disposed = false;
  let initialized = false;
  let stop: (() => void) | undefined;
  let initialReady!: () => void;
  let initialFailed!: (error: Error) => void;
  const initial = new Promise<void>((resolve, reject) => { initialReady = resolve; initialFailed = reject; });
  const assertCurrent = () => {
    if (invalid || disposed || !user || user.isAnonymous || auth.currentUser !== user || auth.currentUser.uid !== uid) throw changedActor();
  };
  const invalidate = () => {
    invalid = true;
    initialFailed(changedActor());
    stop?.();
  };
  try {
    stop = onIdTokenChanged(auth, observed => {
      if (!initialized) {
        initialized = true;
        if (observed !== user || observed?.uid !== uid) invalidate();
        else initialReady();
      } else invalidate();
    }, invalidate);
  } catch { invalidate(); }
  if (invalid) stop?.();
  const ready = (async () => {
    await authReady;
    assertCurrent();
    await initial;
    assertCurrent();
    const token = await user!.getIdTokenResult();
    assertCurrent();
    if (token.claims.employeeId !== employeeId || !['taebaek', 'punghoe'].includes(String(token.claims.companyId)))
      throw new Error('본인의 푸시 정보만 변경할 수 있습니다.');
    actorState.companyId = String(token.claims.companyId);
  })().catch(error => {
    invalidate();
    throw error;
  });
  // 캡처와 첫 await 사이에 종료되더라도 미관찰 rejection을 만들지 않는다.
  void initial.catch(() => undefined);
  void ready.catch(() => undefined);
  const context: PushActorContext = Object.freeze({ ready, assertCurrent, dispose() {
    if (disposed) return;
    disposed = true;
    initialFailed(changedActor());
    stop?.();
  } });
  actors.set(context, actorState);
  return context;
}

/** 직원 문서 ID는 Auth UID가 아니라 로그인 토큰의 employeeId이다. */
export async function updateOwnPushToken(employeeId: string, token: string, device?: { name: string; at: string }, context?: PushActorContext): Promise<void> {
  const owned = context === undefined;
  const actor = context ?? capturePushActor(employeeId);
  try {
    if (actors.get(actor)?.employeeId !== employeeId) throw new Error('본인의 푸시 정보만 변경할 수 있습니다.');
    actor.assertCurrent();
    await actor.ready;
    actor.assertCurrent();
    const ref = doc(db, COL.employees, employeeId);
    actor.assertCurrent();
    await updateDoc(ref,
      'fcmTokens', device ? arrayUnion(token) : arrayRemove(token),
      new FieldPath('fcmDevices', token), device ?? deleteField());
    actor.assertCurrent();
  } finally {
    if (owned) actor.dispose();
  }
}
