import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

/**
 * **말로 온 주문을 읽어 표로 옮긴다** — 복사주문의 'AI로 다시 읽기'가 이 함수를 부른다.
 *
 * 2026-09-15 사장님: "api달아서 메시지에서 주문 추출하는 기능 할 수 있냐 지금 복사주문 처럼",
 * "그냥 복사주문 업그레이드", "걔는 너무 못해".
 *
 * ---
 * **왜 서버에 두나 — 열쇠 때문이다.**
 * 앱에 API 키를 박으면 브라우저에서 그대로 보인다. 누구든 그 키로 사장님 계정에 요금을
 * 물릴 수 있다. 그래서 키는 **Firebase 시크릿**에만 두고, 앱은 이 함수를 부른다.
 * (스마트스토어 열쇠 때 정한 규칙 그대로 — "그 값은 저장소에 넣지 않는다")
 *
 *   설정:  npx firebase functions:secrets:set ANTHROPIC_API_KEY
 *   배포:  cd functions && npm run deploy
 *
 * **읽어 온 것을 여기서 믿지 않는다.** 모양만 JSON 으로 받아 넘기고, 우리 품목 목록에
 * 비추어 거르는 일은 화면 쪽 `shared/orderExtract.validateExtract` 가 한다 — 그래야
 * 네트워크 없이 시험할 수 있고 무엇을 믿는지가 한 곳에 모인다.
 */
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const REGION = 'asia-northeast3';

/** 한 번에 받을 수 있는 글·목록 크기. 넘치면 값이 비싸지고 읽기도 나빠진다. */
const 글자한도 = 4000;
const 품목한도 = 400;

interface 들어온것 {
  text?: string;
  /** `id\t이름 규격` 줄들 — 부르는 쪽이 그 거래처가 사는 것만 추려 넘긴다. */
  catalog?: string[];
  partners?: string[];
  /** 오늘 날짜(YYYY-MM-DD). "내일" 같은 말을 날짜로 옮기는 기준이 된다. */
  today?: string;
}

const 지침 = (오늘: string) => `너는 식품 제조사의 주문 접수 담당이다.
거래처가 카카오톡·문자로 보낸 글에서 **주문**을 뽑아 JSON 으로만 답한다.

오늘은 ${오늘} 이다.

규칙:
- 반드시 아래 품목 목록에 있는 **id** 만 쓴다. 목록에 없으면 그 줄은 itemId 를 비운다.
  비슷한 이름으로 **짐작해서 고르지 마라** — 못 고르는 것이 잘못 고르는 것보다 낫다.
- 같은 이름이 여럿이면 규격으로 가린다. '12개입'·'한 박스' 같은 말이 있으면 박스 쪽 id 를 쓴다.
- 수량은 숫자로 옮긴다. "두 박스"=2, "다섯개"=5, "한 짝"=1.
- 수량을 못 읽으면 qty 를 비운다. **1 로 채우지 마라.**
- isBox 는 박스로 시킨 것이 분명할 때만 true, 낱개가 분명할 때만 false, 아니면 넣지 마라.
- "내일"·"모레"·"이번 주 금요일" 같은 말은 오늘을 기준으로 YYYY-MM-DD 로 옮긴다.
  날짜 이야기가 없으면 deliveryDate 를 비운다.
- 거래처 이름이 글에 있고 목록에 있으면 partnerId 를 채운다. 아니면 비운다.
- 주문과 상관없는 말(인사·잡담)은 버린다. 다만 "급함"·"오전까지" 같은 **작업에 필요한 말**은
  note 에 그대로 옮긴다.
- source 에는 그 줄이 나온 **원문 조각**을 그대로 적는다. 사람이 대조할 수 있어야 한다.

JSON 형식(이것만 출력한다. 설명·코드블록 금지):
{"partnerId":"","deliveryDate":"","note":"","lines":[{"itemId":"","qty":0,"isBox":true,"source":""}]}`;

export const extractOrder = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    //  **로그인한 사람만** — 열쇠를 대신 써 주는 함수라 아무나 부르면 요금이 샌다.
    if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

    const { text, catalog, partners, today } = (request.data ?? {}) as 들어온것;
    const 글 = String(text ?? '').trim().slice(0, 글자한도);
    if (!글) throw new HttpsError('invalid-argument', '읽을 글이 없습니다.');

    const 품목목록 = (Array.isArray(catalog) ? catalog : []).slice(0, 품목한도);
    if (!품목목록.length) throw new HttpsError('invalid-argument', '품목 목록이 비어 있습니다.');
    const 거래처목록 = (Array.isArray(partners) ? partners : []).slice(0, 품목한도);
    const 오늘 = /^\d{4}-\d{2}-\d{2}$/.test(String(today ?? '')) ? String(today) : new Date().toISOString().slice(0, 10);

    const 본문 = [
      지침(오늘),
      '',
      '## 품목 목록 (id\t이름)',
      ...품목목록,
      ...(거래처목록.length ? ['', '## 거래처 목록 (id\t이름)', ...거래처목록] : []),
      '',
      '## 받은 글',
      글,
    ].join('\n');

    let 답: string;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 2000,
          //  **0 에 가깝게** — 주문은 창의력이 필요한 일이 아니다. 같은 글은 같게 읽혀야 한다.
          temperature: 0,
          messages: [{ role: 'user', content: 본문 }],
        }),
      });
      if (!res.ok) {
        const 사유 = await res.text().catch(() => '');
        console.error('[주문 읽기] API 응답 실패', res.status, 사유.slice(0, 300));
        throw new HttpsError('internal', `주문을 읽지 못했습니다(${res.status}).`);
      }
      const json = await res.json() as { content?: { type?: string; text?: string }[] };
      답 = (json.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim();
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[주문 읽기] 부르지 못함', error);
      throw new HttpsError('internal', '주문 읽기 서버에 연결하지 못했습니다.');
    }

    //  **앞뒤에 뭐가 붙어 와도 JSON 만 떼어 낸다** — 코드블록으로 감싸 오는 일이 있다.
    const 열림 = 답.indexOf('{');
    const 닫힘 = 답.lastIndexOf('}');
    if (열림 < 0 || 닫힘 <= 열림) {
      console.error('[주문 읽기] JSON 이 아닌 답', 답.slice(0, 300));
      throw new HttpsError('internal', '주문을 알아보지 못했습니다. 글을 조금 다듬어 다시 시도해 주세요.');
    }
    try {
      //  **그대로 넘긴다** — 우리 품목에 비추어 거르는 일은 화면 쪽(`validateExtract`)이 한다.
      return JSON.parse(답.slice(열림, 닫힘 + 1));
    } catch {
      console.error('[주문 읽기] JSON 을 못 풀었다', 답.slice(0, 300));
      throw new HttpsError('internal', '주문을 알아보지 못했습니다. 글을 조금 다듬어 다시 시도해 주세요.');
    }
  },
);
