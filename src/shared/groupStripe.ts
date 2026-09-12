/**
 * **묶음 띠 색 — 묶음마다 다르게.**
 *
 * 2026-09-12 사장님: "묶음 끼리는 색이 달라야 구분하지". 맞다 — 다 보라면 어느 줄이 어느
 * 묶음인지 붙어 있는 순서로 짐작할 수밖에 없다.
 *
 * **겹치지 않게 차례대로 준다**(2026-09-12 사장님: "이미 있는 색 다시 골라서 중복된다니께").
 * 처음엔 묶음 id 를 흩어(hash) 색을 골랐는데, 흩는 셈은 **두 묶음이 같은 색을 뽑는 것을
 * 못 막는다** — 실제로 겹쳤다.
 *
 * 그래서 **지금 있는 묶음들을 id 순으로 줄 세우고 그 자리 번호로** 색을 준다.
 * 묶음 id 는 `wg-<만든 때>` 라 id 순 = 만든 순이다. 줄을 끌어 옮겨도 자리가 안 바뀌고,
 * 새 묶음은 뒤에 붙으므로 **먼저 있던 묶음의 색은 그대로다.**
 *
 * 배송 줄(`DeliveryDayList`)과 작업순서 줄이 **같은 것을 쓴다** — 한쪽만 고치면
 * 같은 묶음이 두 화면에서 다른 색이 된다.
 *
 * **클래스 이름은 통째로 적는다** — Tailwind 는 글자를 찾아 만들기 때문에
 * `border-l-${색}-400` 처럼 이어 붙이면 그 클래스가 아예 안 만들어진다.
 */
/*  **서로 확실히 갈리는 색만 쓴다.** 처음엔 일곱을 뒀는데 초록·청록(emerald·teal)처럼
    붙어 있는 색이 걸리면 두 묶음이 같아 보였다. 색환에서 멀리 떨어진 다섯만 남긴다 —
    한 화면에 묶음이 다섯을 넘는 일은 없다. */
const 띠 = [
  'border-l-sky-500',      // 하늘
  'border-l-rose-500',     // 빨강
  'border-l-amber-500',    // 노랑
  'border-l-emerald-500',  // 초록
  'border-l-violet-500',   // 보라
];

/**
 * 지금 화면에 있는 묶음 id 들을 주면, **묶음 → 띠 색** 을 돌려주는 함수를 만든다.
 * @example const 띠색 = groupStripes(줄들.map(r => r.groupId)); 띠색(r.groupId)
 */
export const groupStripes = (groupIds: readonly (string | undefined)[]) => {
  const 차례 = [...new Set(groupIds.filter((id): id is string => !!id))].sort();
  return (groupId: string): string => {
    const 자리 = 차례.indexOf(groupId);
    return 띠[(자리 < 0 ? 0 : 자리) % 띠.length];
  };
};
