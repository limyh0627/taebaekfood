import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../shared/firebase';
import { statementBlockReason } from '../../../shared/statementGuard';
import type { StatementWrite } from '../domain/statementWrites';

/**
 * **전표가 만드는 쓰기를 한 덩이로 커밋한다.**
 *
 * 설계([전표-원가-원장-재무-통합설계](../../../../docs/전표-원가-원장-재무-통합설계.md) §2) 3단계.
 *
 * 전에는 네 번을 차례로 저장했다 — 전표 본문 → 거래처 단가·품목 원가 → 주문 발행표시 →
 * 발주카드. 앞이 되고 뒤가 엎어지면 **주문에 발행표시가 안 찍혀 그 주문이 목록에 다시 뜨고,
 * 다시 누르면 전표가 두 장 나간다.** 이제 하나라도 실패하면 전부 안 들어간다.
 *
 * **두 번 눌러도 한 번만 먹는다** — 전표 문서에 박아 둔 `operationId` 를 보고 같은 도장이면
 * 그대로 돌아간다(`duplicate`). 화면이 재시도해도 도장이 같아야 하므로 그 값은 전표 id 에서
 * 짓는다([statementCommand](../domain/statementCommand.ts)).
 */
export type ApplyStatementResult = 'applied' | 'duplicate';

/**
 * Firestore 는 `undefined` 를 못 받는다. `updateDoc` 이 통째로 실패하는 사고가 실제로 있었다
 * (전표 줄의 빈 `accountCode`) — 그래서 깊이 걷어낸다. `firebaseService` 의 것과 같은 규칙이다.
 */
const undefined걷기 = (값: unknown): unknown => {
  if (Array.isArray(값)) return 값.map(undefined걷기);
  if (값 && typeof 값 === 'object' && !(값 instanceof Date)) {
    return Object.fromEntries(
      Object.entries(값 as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, undefined걷기(v)]),
    );
  }
  return 값;
};

export async function applyStatementWrites(
  writes: readonly StatementWrite[],
  { statementId, operationId }: { statementId: string; operationId: string },
): Promise<ApplyStatementResult> {
  /*  **차·대를 못 채우는 전표는 여기서도 막는다.**
      만드는 길이 여러 갈래라 화면마다 막으면 한 곳은 반드시 샌다 — `addItem` 이 같은 이유로
      같은 가드를 들고 있다(인수인계: "쓰는 문 하나에서 막는다"). 이 길이 새 문이므로 같이 건다. */
  const 본문 = writes.find(w => w.collection === 'issuedStatements');
  if (본문) {
    const reason = statementBlockReason({ id: 본문.id, ...본문.data } as never);
    if (reason) throw new Error(`전표를 만들 수 없습니다 — ${reason}`);
  }

  return runTransaction(db, async tx => {
    //  **읽기가 먼저다** — Firestore 트랜잭션은 쓰기 뒤에 읽을 수 없다.
    const 전표자리 = doc(db, 'issuedStatements', statementId);
    const 지금 = await tx.get(전표자리);
    if (지금.exists() && (지금.data() as { operationId?: string }).operationId === operationId) {
      //  같은 도장이 이미 찍혀 있다 — 두 번째 클릭이거나 재시도다. 아무것도 안 한다.
      return 'duplicate' as const;
    }

    for (const w of writes) {
      tx.set(doc(db, w.collection, w.id), undefined걷기(w.data) as Record<string, unknown>, { merge: w.merge });
    }
    return 'applied' as const;
  });
}
