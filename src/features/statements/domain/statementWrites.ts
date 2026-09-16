import type { IssuedStatement } from '../../../shared/types';
import type { StatementCommand } from './statementCommand';
import { COL, type CollectionName } from '../../../shared/collections';

/**
 * **전표 한 장이 만들어 내는 쓰기를 전부 적는다.**
 *
 * 설계([전표-원가-원장-재무-통합설계](../../../../로컬전용/docs/전표-원가-원장-재무-통합설계.md) §2 저장 규칙)
 * 3단계. 지금은 [TradeStatement](../../../../components/TradeStatement.tsx) 가 네 번을
 * **차례로** 저장한다 — 전표 본문 → 거래처 단가·품목 원가 → 주문 발행표시 → 발주카드.
 * 앞이 되고 뒤가 엎어지면 **주문에 발행표시가 안 찍혀 그 주문이 목록에 다시 뜨고, 다시 누르면
 * 전표가 두 장 나간다.** 한 덩이로 쓰려면 먼저 무엇을 쓰는지 한 목록으로 적어야 한다.
 *
 * 이 파일은 Firestore 를 모른다 — 무엇을 어디에 쓸지 **값으로** 말하기만 한다.
 */

export interface StatementWrite {
  collection: CollectionName;
  id: string;
  data: Record<string, unknown>;
  /** `true` 면 적힌 칸만 덮는다. 전표 본문처럼 통째로 쓰는 것은 `false`. */
  merge: boolean;
}

export interface StatementWritePlan {
  writes: StatementWrite[];
  /**
   * **커밋한 뒤에 할 일.** 장부가 아니라 **장부에서 다시 셀 수 있는 것**만 여기 온다.
   * 지금은 품목 원가의 BOM 되말기(`recomputeAllCosts`) 하나다 — 원가를 적는 것은 쓰기에 넣고,
   * 그 원가로 상위 품목을 다시 세는 것은 언제 다시 돌려도 같은 답이라 뒤로 미뤄도 된다.
   * 여기서 실패해도 전표와 주문은 이미 짝이 맞다.
   */
  afterCommit: { kind: 'RECOMPUTE_COSTS'; itemIds: string[] }[];
}

interface PlanInput {
  command: StatementCommand;
  /** 저장할 전표 본문 — 화면이 만든 그대로. */
  statement: IssuedStatement & { companyId?: string };
  /** 매입이면 품목 원가도 따라 움직인다(`partnerPriceWrites` 의 답). */
  costUpdates?: readonly { itemId: string; price: number; beforeCost?: number; sourceLineIndex?: number }[];
  /** 이력의 실제 기록 시각과 작업자. 업무 적용일은 command.tradeDate다. */
  recordedAt?: string;
  actorId?: string;
  /** 발주카드 연결 — 이미 있는 카드를 이 전표에 묶는다. */
  poLinks?: readonly { poId: string; data: Record<string, unknown> }[];
  /** 발주카드 없이 매입을 발행했을 때 새로 세우는 입고대기 카드. */
  newPo?: { id: string; data: Record<string, unknown> };
}

/**
 * 명령 → 쓸 것들.
 *
 * 차례는 **전표 본문이 먼저**다. 한 덩이로 커밋하므로 순서가 결과를 바꾸지는 않지만,
 * 사람이 읽을 때 무엇이 중심인지 드러나는 게 낫다.
 */
export function planStatementWrites(input: PlanInput): StatementWritePlan {
  const { command, statement } = input;
  const writes: StatementWrite[] = [];

  //  ① 전표 본문 — **명령 도장(`operationId`)을 같이 박는다.**
  //     다시 눌렀을 때 이 도장을 보고 두 번째를 거른다.
  const { id: _전표id, ...본문 } = statement;
  writes.push({
    collection: 'issuedStatements',
    id: command.statementId,
    // 당사자 스냅샷은 화면이 따로 끼워 넣은 값을 믿지 않고 명령에 실린 값으로 확정한다.
    data: {
      ...본문,
      ...(command.partySnapshot ? { partySnapshot: command.partySnapshot } : {}),
      operationId: command.operationId,
    },
    merge: false,
  });

  /*  **거래처 단가는 여기 없다 — 일부러다.**
      단가를 되미는 자리(`handleUpsertPartnerItem`)에는 **박스 품목을 등록하면 낱개도 같이
      등록하는 규칙**이 붙어 있다(사장님이 안 물어도 낱개가 따라 붙어야 한다). 그걸 통째로
      이 목록에 옮기면 그 규칙이 사라진다. 그래서 단가는 **커밋 뒤에** 지금 쓰던 길로 민다.
      갈라 둬도 장부가 깨지지 않는다 — 단가는 "지금 파는 값"의 스냅샷이라 늦게 반영돼도
      전표·주문의 짝은 이미 맞다. 반대로 주문 발행표시가 빠지면 전표가 두 장 나간다(아래 ③). */

  //  ② 품목 현재 원가 — 되말기(상위 품목 다시 세기)는 커밋 뒤로 미룬다
  for (const c of input.costUpdates ?? []) {
    writes.push({ collection: 'items', id: c.itemId, data: { cost: c.price }, merge: true });
    if (c.beforeCost !== undefined && c.beforeCost !== c.price) {
      const lineIndex = c.sourceLineIndex ?? command.lines.findIndex(line => line.itemId === c.itemId);
      writes.push({
        collection: COL.itemCostHistory,
        // 같은 전표 명령을 재시도해도 같은 이력 문서를 덮어써 한 건만 남긴다.
        id: `${command.statementId}_${c.itemId}_${Math.max(0, lineIndex)}`,
        data: {
          itemId: c.itemId,
          beforeCost: c.beforeCost,
          afterCost: c.price,
          effectiveAt: command.tradeDate,
          recordedAt: input.recordedAt ?? statement.issuedAt,
          actorId: input.actorId ?? '',
          sourceStatementId: command.statementId,
          sourceLineIndex: Math.max(0, lineIndex),
        },
        merge: false,
      });
    }
  }

  //  ③ 주문에 발행표시 — **이게 안 찍히면 그 주문이 목록에 다시 떠서 두 번 발행된다.**
  //     전표와 한 덩이로 묶는 가장 큰 이유다.
  for (const orderId of command.orderIds) {
    writes.push({ collection: 'orders', id: orderId, data: { invoicePrinted: true }, merge: true });
  }

  //  ④ 발주카드 — 매입 전표가 세우거나 잇는다
  for (const link of input.poLinks ?? []) {
    writes.push({ collection: 'purchaseOrders', id: link.poId, data: link.data, merge: true });
  }
  if (input.newPo) {
    writes.push({ collection: 'purchaseOrders', id: input.newPo.id, data: input.newPo.data, merge: false });
  }

  const 원가바뀐품목 = (input.costUpdates ?? []).map(c => c.itemId);
  return {
    writes,
    afterCommit: 원가바뀐품목.length ? [{ kind: 'RECOMPUTE_COSTS', itemIds: 원가바뀐품목 }] : [],
  };
}
