import type { OrderItem } from './types';

/**
 * **라벨·제조일을 누가 언제 바꿨는지 찍는다** — 바뀐 줄에만.
 *
 * 2026-09-14 사장님: "라벨이나 작업완료 등의 상태변경 누가하고 언제 했는지 볼 수 있게".
 * 체크(`checkedBy`)와 비고(`noteBy`)에는 이미 사람이 남는데 라벨·제조일에만 없었다.
 *
 * 라벨을 바꾸는 자리는 여럿이다(카드·리스트·보드·수정창). 자리마다 찍으면 한 곳은 반드시 샌다.
 * 그래서 **저장하는 문 한 곳**에서 이전 값과 비교해 찍는다.
 *
 * 순수 함수다 — 시각과 사람은 부르는 쪽이 준다(시험에서 시각을 고정할 수 있어야 한다).
 */
export function stampOrderItemEdits(
  before: OrderItem[],
  after: OrderItem[],
  who: string | undefined,
  at: string,
): OrderItem[] {
  //  **줄을 `lineId` 로 찾는다.** 자리(index)로 찾으면 줄을 지우거나 넣은 순간 한 칸씩 밀려
  //  엉뚱한 줄에 남의 이름이 찍힌다. `lineId` 가 없는 옛 줄만 자리로 떨어진다.
  const 이전 = new Map(before.filter(line => line.lineId).map(line => [line.lineId!, line]));
  const 사람 = (who ?? '').trim() || '미기록';

  return after.map((line, index) => {
    const old = (line.lineId && 이전.get(line.lineId)) || before[index];
    if (!old) return line;   // 새로 넣은 줄 — 라벨을 '바꾼' 것이 아니다
    //  자리로 떨어진 줄이 **다른 품목**이면 그건 같은 줄이 아니다(줄을 지웠거나 품목을 바꿨다).
    //  그대로 두면 새 줄에 남의 이름이 찍힌다.
    if (old.itemId !== line.itemId) return line;
    const 라벨바뀜 = (old.labelType ?? '대기') !== (line.labelType ?? '대기');
    const 제조일바뀜 = (old.mfgDate ?? '') !== (line.mfgDate ?? '');
    if (!라벨바뀜 && !제조일바뀜) return line;
    return {
      ...line,
      ...(라벨바뀜 ? { labelBy: 사람, labelAt: at } : {}),
      ...(제조일바뀜 ? { mfgBy: 사람, mfgAt: at } : {}),
    };
  });
}
