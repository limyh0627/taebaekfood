import type { Order, OrderItem, OrderItemEdit, OrderStatusAudit } from './types';

/**
 * **이 주문에 누가 무엇을 언제 했나** — 주문 수정 창의 '로그 보기'가 띄우는 목록.
 *
 * 2026-09-14 사장님: "상단 헤더에 로그보기 버튼을 넣어서 주문 넣은 사람 일시 라벨이나
 * 작업완료 등의 상태변경 누가하고 언제 했는지 볼 수 있게 해봐".
 *
 * **새로 기록하지 않는다 — 이미 남아 있는 것을 모아 읽을 뿐이다.** 흩어져 있어서 못 봤을 뿐,
 * 주문 문서와 `orderStatusAudits` 에 사람과 시각이 이미 적혀 있다:
 *
 * | 무엇 | 어디에 |
 * |---|---|
 * | 주문 등록 | `order.createdBy` · `createdAt` |
 * | 상태 변경(작업중·작업완료·출고·되돌리기) | `orderStatusAudits` 한 건 한 줄 |
 * | 품목별 작업완료 체크 | `items[].checkedBy` · `checkedAt` |
 * | 라벨 · 제조일 | `items[].labelBy/labelAt` · `mfgBy/mfgAt` |
 * | 품목 수량·추가·삭제·단가 | `orderItemEdits` 한 번 저장에 한 줄 |
 * | 비고 | `items[].noteBy` · `noteAt` |
 * | 출고 확인 | `shipmentConfirmedBy` · `shipmentConfirmedAt` |
 *
 * 순수 함수다 — 읽어 오는 일은 부르는 쪽이 한다.
 */
export interface OrderActivityRow {
  /** ISO 시각. 없는 것(옛 주문)은 목록 맨 뒤로 간다. */
  at?: string;
  who: string;
  what: string;
  detail?: string;
  kind: 'create' | 'status' | 'line' | 'label' | 'note' | 'ship' | 'fail' | 'edit';
}

const 상태이름 = (s?: string) => ({
  PENDING: '대기중', PROCESSING: '작업중', DISPATCHED: '작업완료', SHIPPED: '출고완료', DELIVERED: '배송완료',
} as Record<string, string>)[String(s ?? '')] ?? String(s ?? '');

/**
 * 사람 이름이 안 적힌 옛 기록은 '미기록' 으로 — 빈칸으로 두면 누락인지 무기록인지 모른다.
 *
 * **`Order.createdBy` 에는 이름이 아니라 사번(`currentUser.id`)이 들어간다**(AddOrder 저장 경로).
 * 알림에서 넣은 사람을 빼려고 그렇게 쓴 칸이라, 그대로 띄우면 화면에 사번이 뜬다.
 * 그래서 `nameOf` 로 풀어 본다 — 못 풀면 적힌 그대로 둔다(이름이 적힌 칸은 그대로 지난다).
 */
const 사람 = (name?: string | null, nameOf?: (key: string) => string | undefined) => {
  const 적힌것 = (name ?? '').trim();
  if (!적힌것) return '미기록';
  return (nameOf?.(적힌것) ?? '').trim() || 적힌것;
};

const 줄이름 = (line: OrderItem) => line.name || line.itemId;

export function buildOrderActivityLog(
  order: Pick<Order, 'items' | 'createdAt' | 'createdBy' | 'shipmentConfirmedBy' | 'shipmentConfirmedAt'>,
  audits: OrderStatusAudit[] = [],
  /** 사번 → 이름. 없으면 적힌 글자를 그대로 쓴다. */
  nameOf?: (key: string) => string | undefined,
  edits: OrderItemEdit[] = [],
): OrderActivityRow[] {
  const rows: OrderActivityRow[] = [];

  //  **거래처 포털로 들어온 주문은 넣은 사람 칸이 비어 있다**(`Order.createdBy` 주석).
  //  빈칸을 그냥 '미기록'으로만 두면 기록이 새는 줄 알고 찾아 헤매게 된다 — 까닭을 같이 적는다.
  const 넣은사람 = order.createdBy?.trim();
  rows.push({
    at: order.createdAt,
    who: 사람(넣은사람, nameOf),
    what: '주문 등록',
    detail: 넣은사람 ? undefined : '거래처 포털로 들어온 주문은 넣은 사람이 남지 않습니다',
    kind: 'create',
  });

  for (const audit of audits) {
    const 움직임 = (audit.stockAdjustments ?? []).filter(row => Number(row.delta) !== 0);
    rows.push({
      //  끝난 시각이 있으면 그것을 쓴다 — 승인 시각은 확인창을 띄운 때라 실제와 어긋난다.
      at: audit.completedAt || audit.approvedAt,
      who: 사람(audit.approvedBy, nameOf),
      what: `${상태이름(audit.previousStatus)} → ${상태이름(audit.nextStatus)}`,
      detail: audit.state === 'failed'
        ? `실패 — ${audit.error ?? '사유 미기록'}`
        : [
            움직임.length ? `재고 ${움직임.length}건` : '',
            audit.legacyEvidenceWarning ? '당시 기록 없어 추정' : '',
            audit.state === 'processing' ? '처리 중' : '',
          ].filter(Boolean).join(' · ') || undefined,
      kind: audit.state === 'failed' ? 'fail' : 'status',
    });
  }

  /*  **품목 수정은 한 번 저장에 한 줄.** 수량 하나 고치면서 줄을 지웠으면 둘이 한 번에 일어난
      일이라, 따로 세우면 같은 시각 줄이 여럿 서서 무슨 일이 있었는지 되레 흐려진다.
      첫 줄을 제목으로 올리고 나머지는 아래에 붙인다. */
  for (const edit of edits) {
    const 적힌것 = (edit.changes ?? []).filter(Boolean);
    if (!적힌것.length) continue;
    rows.push({
      at: edit.at,
      who: 사람(edit.by, nameOf),
      what: 적힌것[0],
      detail: 적힌것.length > 1 ? 적힌것.slice(1).join('\n') : undefined,
      kind: 'edit',
    });
  }

  for (const line of order.items ?? []) {
    if (line.checkedAt || line.checkedBy) {
      rows.push({ at: line.checkedAt, who: 사람(line.checkedBy, nameOf), what: `작업완료 — ${줄이름(line)}`, kind: 'line' });
    }
    if (line.labelAt || line.labelBy) {
      rows.push({ at: line.labelAt, who: 사람(line.labelBy, nameOf), what: `라벨 ${line.labelType ?? '대기'} — ${줄이름(line)}`, kind: 'label' });
    }
    if (line.mfgAt || line.mfgBy) {
      rows.push({ at: line.mfgAt, who: 사람(line.mfgBy, nameOf), what: `제조일 ${line.mfgDate ?? '지움'} — ${줄이름(line)}`, kind: 'label' });
    }
    if (line.noteAt || line.noteBy) {
      rows.push({ at: line.noteAt, who: 사람(line.noteBy, nameOf), what: `비고 — ${줄이름(line)}`, detail: line.note, kind: 'note' });
    }
  }

  if (order.shipmentConfirmedAt || order.shipmentConfirmedBy) {
    rows.push({ at: order.shipmentConfirmedAt ?? undefined, who: 사람(order.shipmentConfirmedBy, nameOf), what: '출고 확인', kind: 'ship' });
  }

  //  **최근 것이 위로.** 시각이 없는 옛 기록은 맨 뒤로 — 가운데 끼면 순서가 거짓말이 된다.
  return rows.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return b.at.localeCompare(a.at);
  });
}
