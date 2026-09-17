/**
 * 모바일 키보드의 Enter는 사용자가 보는 그대로 줄바꿈이다.
 * 데스크톱에서만 기존처럼 Enter 전송을 유지하고 Shift+Enter·한글 조합 중 Enter는 줄바꿈한다.
 */
export function shouldSendChatOnEnter(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  touchLike: boolean;
}): boolean {
  return input.key === 'Enter' && !input.shiftKey && !input.isComposing && !input.touchLike;
}

export function isTouchLikeDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches === true || window.innerWidth < 768;
}
