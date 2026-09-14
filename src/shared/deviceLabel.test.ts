import { describe, it, expect } from 'vitest';
import { deviceLabel } from './deviceLabel';

/**
 * 표가 어느 기기 것인지 알아야 "내 폰 표가 없다"를 본인이 본다.
 * 헷갈리기 쉬운 건 **제 이름 뒤에 Chrome·Safari 를 같이 적는 브라우저들**이다.
 */

const 아이폰사파리 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const 안드크롬 = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const 삼성 = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const 윈도엣지 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
const 윈도크롬 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('deviceLabel — 표가 어느 기기 것인가', () => {
  it('홈화면 앱이면 브라우저보다 그걸 먼저 적는다 — 아이폰은 그래야 알림이 된다', () => {
    expect(deviceLabel({ userAgent: 아이폰사파리, standalone: true })).toBe('아이폰 · 홈화면 앱');
  });

  it('아이폰인데 홈화면 앱이 아니면 사파리로 적는다 — 그 표는 알림이 안 온다', () => {
    expect(deviceLabel({ userAgent: 아이폰사파리 })).toBe('아이폰 사파리');
  });

  it('삼성인터넷·엣지를 크롬으로 뭉개지 않는다 — 둘 다 Chrome 을 같이 적는다', () => {
    expect(deviceLabel({ userAgent: 삼성 })).toBe('안드로이드 삼성인터넷');
    expect(deviceLabel({ userAgent: 윈도엣지 })).toBe('윈도 엣지');
  });

  it('평범한 것들', () => {
    expect(deviceLabel({ userAgent: 안드크롬 })).toBe('안드로이드 크롬');
    expect(deviceLabel({ userAgent: 윈도크롬 })).toBe('윈도 크롬');
  });

  it('모르는 것은 뭉개지 말고 기기로만 둔다', () => {
    expect(deviceLabel({ userAgent: '' })).toBe('기기');
  });
});
