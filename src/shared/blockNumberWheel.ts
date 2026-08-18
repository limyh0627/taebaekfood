/**
 * 숫자 칸 위에서 휠을 굴리면 값이 바뀌던 것을 막는다.
 *
 * 브라우저 기본 동작이다. 수량 칸에 커서를 둔 채 화면을 스크롤하면 **입력한 수량이 조용히
 * 바뀐다** — 주문·재고·금액이 전부 이 위험을 안고 있었다(number 칸 70곳).
 * 칸마다 onWheel을 다는 대신 여기 한 곳에서 막는다.
 *
 * 포커스된 number 칸에서 일어난 휠만 막으므로, 그 위를 지나가며 하는 페이지 스크롤은 그대로다.
 * (막지 않으면 화면이 안 움직이는 게 아니라 값이 바뀌는 쪽이 더 나쁘다.)
 */
export function blockNumberWheel(): () => void {
  const onWheel = (e: WheelEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el || el !== document.activeElement) return;
    if (el.tagName !== 'INPUT') return;
    if ((el as HTMLInputElement).type !== 'number') return;
    e.preventDefault();
  };
  // passive:false 여야 preventDefault가 먹는다
  document.addEventListener('wheel', onWheel, { passive: false });
  return () => document.removeEventListener('wheel', onWheel);
}
