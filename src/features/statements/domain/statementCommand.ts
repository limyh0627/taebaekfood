import type { LineItem, StatementType } from '../../../shared/statementLines';
import type { StatementPartySnapshot } from '../../../shared/types';
import { lineTotals } from '../../../shared/statementLines';

/**
 * **전표 명령** — 발행·수정·취소를 한 덩이로 적은 것.
 *
 * Codex 설계([전표-원가-원장-재무-통합설계](../../../../로컬전용/docs/전표-원가-원장-재무-통합설계.md) §2)
 * 2단계다. **아직 저장하지 않는다** — 저장을 원자로 묶는 것은 3단계고, 여기서는
 * "무엇을 쓸 것인가"를 값으로 만들고 **그 값이 성한지 따지기만 한다.**
 *
 * 왜 굳이 나누나 — 지금 발행은 [TradeStatement](../../../../components/TradeStatement.tsx)
 * 안에서 네 번을 **차례로** 저장한다: 전표 본문 → 거래처 단가·품목 원가 → 주문에 발행 표시 →
 * 발주카드 연결. 앞이 되고 뒤가 엎어지면 **반쪽이 남고, 다시 누르면 앞엣것이 두 번 들어간다.**
 * 한 덩이로 쓰려면 먼저 한 덩이로 **말할 수 있어야** 한다.
 *
 * 이 파일은 React 도 Firestore 도 모른다. 입력 → 값.
 */

/** 무엇을 할 것인가. 취소는 지우지 않고 `REVERSE` 를 뒤에 쌓는다(설계 §2). */
export type StatementCommandKind = 'ISSUE' | 'EDIT' | 'REVERSE';

export interface StatementCommand {
  /**
   * **같은 클릭을 두 번 눌러도 한 번만 먹게 하는 열쇠.**
   * 원료 명령의 `operationId` 와 같은 생각이다 — 받는 쪽이 이 값을 보고 두 번째를 거른다.
   * 화면이 발행을 다시 시도해도 값이 그대로여야 하므로 **전표 id 에서 짓는다**(시각이 아니다).
   */
  operationId: string;
  kind: StatementCommandKind;
  /** 전표의 영구 id. 수정해도 바꾸지 않는다. */
  statementId: string;
  /** 읽은 뒤 딴 사람이 먼저 고쳤는지 보는 값. 없으면 아직 안 쓰는 것이다. */
  expectedVersion?: number;
  companyId?: string;
  partnerId: string;
  partnerName: string;
  /** 손익·원장에 반영되는 회계 발생일(`YYYY-MM-DD`). */
  tradeDate: string;
  type: StatementType;
  docNo: string;
  memo?: string;
  /** 이 전표에 묶인 주문 — 저장할 때 쉼표로 이어 담는다. */
  orderIds: string[];
  lines: LineItem[];
  /** 발행 당시 서류 당사자. 저장 뒤 마스터 정보가 바뀌어도 과거 서류는 이 값을 쓴다. */
  partySnapshot?: StatementPartySnapshot;
  /** 줄에서 셈한 합계 — 저장 값과 화면 값이 갈리지 않게 명령이 들고 다닌다. */
  totals: { supply: number; tax: number; amount: number };
}

/** 왜 못 쓰는가. 화면이 이 코드로 제 말투를 고른다 — 여기서 문구를 짓지 않는다. */
export type StatementRejectionCode =
  | 'NO_PARTNER'      // 거래처를 안 골랐다
  | 'NO_LINES'        // 줄이 하나도 없다
  | 'NO_ACCOUNT_CODE' // 계정과목이 없는 줄
  | 'ZERO_PRICE'      // 단가가 0인 줄
  | 'NO_TRADE_DATE';  // 거래일이 없다

export interface StatementRejection {
  code: StatementRejectionCode;
  /** 걸린 줄의 자리(0부터). 줄과 무관한 거절이면 빈 배열이다. */
  lineIndexes: number[];
  /** 걸린 줄의 이름 — 화면이 "(들기름, 참기름 외)" 처럼 보여줄 때 쓴다. */
  lineNames: string[];
}

/** 막지는 않지만 **알고 발행해야 하는 것.** */
export type StatementWarningCode =
  | 'ITEM_LINE_WITHOUT_ID'  // 품목 줄인데 품목 id 가 없다 — 원가·단가를 되짚을 수 없다
  | 'TAX_UNDECIDED';        // 과세·면세를 아직 아무도 안 정했다

export interface StatementWarning {
  code: StatementWarningCode;
  lineIndexes: number[];
  lineNames: string[];
}

export interface StatementCheck {
  /** 거절이 하나도 없나 */
  ok: boolean;
  rejections: StatementRejection[];
  warnings: StatementWarning[];
}

interface BuildInput {
  kind?: StatementCommandKind;
  statementId: string;
  partnerId: string;
  partnerName?: string;
  tradeDate: string;
  type: StatementType;
  docNo: string;
  memo?: string;
  orderIds?: readonly string[];
  lines: readonly LineItem[];
  companyId?: string;
  expectedVersion?: number;
  partySnapshot?: StatementPartySnapshot;
}

/**
 * 화면에 흩어져 있는 값을 **명령 하나**로 모은다.
 *
 * 합계는 여기서 [lineTotals](../../../shared/statementLines.ts) 로 셈한다 — 화면이 따로 더한
 * 값을 받아 적으면 둘이 갈린다. 양변 전표(일반전표)는 차변만 세는 규칙도 그 함수 안에 있다.
 */
export function buildStatementCommand(input: BuildInput): StatementCommand {
  const lines = [...input.lines];
  const totals = lineTotals(lines);
  const kind = input.kind ?? 'ISSUE';
  return {
    //  전표 id 에서 짓는다 — 다시 눌러도 같은 값이어야 두 번째를 거를 수 있다.
    operationId: `${input.statementId}:${kind}`,
    kind,
    statementId: input.statementId,
    ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
    ...(input.companyId ? { companyId: input.companyId } : {}),
    partnerId: input.partnerId,
    partnerName: input.partnerName ?? '',
    tradeDate: input.tradeDate,
    type: input.type,
    docNo: input.docNo,
    ...(input.memo?.trim() ? { memo: input.memo.trim() } : {}),
    orderIds: [...(input.orderIds ?? [])].filter(Boolean),
    lines,
    ...(input.partySnapshot ? { partySnapshot: input.partySnapshot } : {}),
    totals: { supply: totals.supply, tax: totals.tax, amount: totals.amount },
  };
}

/** 걸린 줄만 골라 하나로 묶는다. 걸린 게 없으면 아무것도 안 낸다. */
const 걸린줄 = <C extends string>(
  code: C, lines: readonly LineItem[], 걸리나: (line: LineItem) => boolean,
): { code: C; lineIndexes: number[]; lineNames: string[] } | undefined => {
  const 걸린 = lines.map((line, index) => ({ line, index })).filter(({ line }) => 걸리나(line));
  return 걸린.length
    ? { code, lineIndexes: 걸린.map(x => x.index), lineNames: 걸린.map(x => x.line.name) }
    : undefined;
};

/**
 * **이 명령을 써도 되나.**
 *
 * 막는 규칙은 지금 화면이 막는 것 **그대로**다(2026-09-13). 새로 조이지 않는다 —
 * 검사를 한곳으로 모으는 게 목적이지, 발행을 더 어렵게 만드는 게 아니다.
 * 지금 `handleIssue` 가 묻고 `markIssued` 가 한 번 더 막는 것이 두 벌로 쓰여 있어,
 * 한쪽만 고치면 다른 쪽이 남는다.
 *
 * · 단가 **0** 은 막고 **음수는 통과**시킨다 — 할인·반품 줄이 한 장에 단독으로 설 수 있어야 한다.
 * · 품목 줄인데 id 가 없는 것은 **막지 않고 알리기만** 한다. 주문 품목을 못 찾은 줄
 *   (`unknownItem`)이 그렇게 되는데, 지금도 발행은 된다. 막으면 오늘 되던 일이 안 된다.
 */
export function checkStatementCommand(command: StatementCommand): StatementCheck {
  const { lines } = command;
  const 거절후보: (StatementRejection | undefined)[] = [
    !command.partnerId ? { code: 'NO_PARTNER' as const, lineIndexes: [], lineNames: [] } : undefined,
    !command.tradeDate ? { code: 'NO_TRADE_DATE' as const, lineIndexes: [], lineNames: [] } : undefined,
    lines.length === 0 ? { code: 'NO_LINES' as const, lineIndexes: [], lineNames: [] } : undefined,
    걸린줄('NO_ACCOUNT_CODE' as const, lines, line => !line.accountCode),
    걸린줄('ZERO_PRICE' as const, lines, line => !line.price),
  ];
  const rejections = 거절후보.filter((r): r is StatementRejection => !!r);

  const 알림후보: (StatementWarning | undefined)[] = [
    걸린줄('ITEM_LINE_WITHOUT_ID' as const, lines, line => line.lineKind === 'item' && !line.itemId),
    걸린줄('TAX_UNDECIDED' as const, lines, line => !!line.taxUnknown),
  ];
  const warnings = 알림후보.filter((w): w is StatementWarning => !!w);

  return { ok: rejections.length === 0, rejections, warnings };
}
