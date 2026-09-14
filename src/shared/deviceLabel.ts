/**
 * **이 표(token)가 어느 기기 것인가 — 사람이 읽을 이름.**
 *
 * 2026-09-14 사장님: 이총제·이지영·남명숙·박은지·윤찬호 알림이 안 온다.
 * 서버 로그는 `보냄 10/10` 으로 멀쩡했다. 표는 **글자만 저장돼서** 그게 누구 폰 건지,
 * 언제 담긴 건지 아무도 몰랐다 — 사무실 PC 크롬에 로그인해 둔 표가 남아 있으면 FCM 은
 * 영원히 "성공"을 돌려주고, 알림은 그 PC 화면에 조용히 뜬다. 폰에는 아무것도 안 온다.
 *
 * 그래서 표를 담을 때 **기기 이름과 날짜를 같이 적는다.** 마이페이지에서 "내 폰 표가
 * 목록에 없다"를 본인이 바로 볼 수 있어야 한다.
 *
 * 부수효과 없음(입력 → 값). 브라우저 밖에서도 시험할 수 있게 `userAgent` 를 받는다.
 */

/** 홈 화면에 추가한 앱으로 열렸나 — 아이폰은 이래야 알림이 된다(iOS 16.4+). */
export interface DeviceHint {
  userAgent: string;
  /** `display-mode: standalone` — 홈 화면 앱이면 참 */
  standalone?: boolean;
}

const 운영체제 = (ua: string): string => {
  if (/iPhone/i.test(ua)) return '아이폰';
  if (/iPad/i.test(ua)) return '아이패드';
  //  아이패드OS 는 맥으로 위장한다 — 손가락 입력이 있으면 아이패드로 본다.
  if (/Android/i.test(ua)) return '안드로이드';
  if (/Windows/i.test(ua)) return '윈도';
  if (/Mac OS X|Macintosh/i.test(ua)) return '맥';
  return '기기';
};

const 브라우저 = (ua: string): string => {
  //  **차례가 중요하다** — 엣지·삼성인터넷·웨일은 제 이름 뒤에 Chrome 도 같이 적는다.
  //  크롬을 먼저 보면 전부 크롬으로 뭉개진다.
  if (/Edg\//i.test(ua)) return '엣지';
  if (/SamsungBrowser/i.test(ua)) return '삼성인터넷';
  if (/Whale/i.test(ua)) return '웨일';
  if (/FxiOS|Firefox/i.test(ua)) return '파이어폭스';
  if (/CriOS|Chrome/i.test(ua)) return '크롬';
  //  사파리는 맨 뒤 — 위 브라우저들이 다 Safari 도 같이 적는다.
  if (/Safari/i.test(ua)) return '사파리';
  return '';
};

/**
 * `아이폰 · 홈화면 앱` · `윈도 크롬` 처럼 한 줄로 만든다.
 *
 * 홈 화면 앱이면 브라우저 이름보다 **그게 더 중요한 정보**다 — 아이폰은 홈 화면에
 * 추가해야만 알림이 되므로, 목록에 `아이폰 · 사파리` 가 있으면 그건 알림이 안 되는 표다.
 */
export function deviceLabel({ userAgent, standalone }: DeviceHint): string {
  const os = 운영체제(String(userAgent ?? ''));
  if (standalone) return `${os} · 홈화면 앱`;
  const br = 브라우저(String(userAgent ?? ''));
  return br ? `${os} ${br}` : os;
}

/** 지금 이 브라우저의 이름. 브라우저 밖(시험·서버)에서는 빈 글자. */
export function currentDeviceLabel(): string {
  if (typeof navigator === 'undefined') return '';
  const standalone = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true);
  return deviceLabel({ userAgent: navigator.userAgent, standalone });
}
