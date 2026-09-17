import { describe, expect, it } from 'vitest';
import { shouldSendChatOnEnter } from './chatComposer';

describe('오피스톡 입력 Enter', () => {
  it('모바일 Enter는 줄바꿈으로 남긴다', () => {
    expect(shouldSendChatOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, touchLike: true })).toBe(false);
  });

  it('데스크톱 Enter만 전송한다', () => {
    expect(shouldSendChatOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, touchLike: false })).toBe(true);
    expect(shouldSendChatOnEnter({ key: 'Enter', shiftKey: true, isComposing: false, touchLike: false })).toBe(false);
  });

  it('한글 조합을 확정하는 Enter는 전송하지 않는다', () => {
    expect(shouldSendChatOnEnter({ key: 'Enter', shiftKey: false, isComposing: true, touchLike: false })).toBe(false);
  });
});
