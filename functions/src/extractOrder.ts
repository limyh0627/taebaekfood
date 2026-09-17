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
 *   설정:  npx firebase functions:secrets:set GEMINI_API_KEY
 *   배포:  cd functions && npm run deploy
 *
 * **읽어 온 것을 여기서 믿지 않는다.** 모양만 JSON 으로 받아 넘기고, 우리 품목 목록에
 * 비추어 거르는 일은 화면 쪽 `shared/orderExtract.validateExtract` 가 한다 — 그래야
 * 네트워크 없이 시험할 수 있고 무엇을 믿는지가 한 곳에 모인다.
 */
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const REGION = 'asia-northeast3';
// 2.5 Flash는 2026-09부터 신규 사용자 호출에 404를 돌려준다. API가 안내한 현행 Flash를 쓴다.
const GEMINI_MODEL = 'gemini-3.6-flash';

/** 한 번에 받을 수 있는 글·목록 크기. 넘치면 값이 비싸지고 읽기도 나빠진다. */
const 글자한도 = 4000;
const 품목한도 = 400;
/** 지난 주문 줄 수. 한 줄이 15토큰쯤이라 이만큼 붙여도 한 건에 몇 원이다. */
const 기록한도 = 60;
const 잠깐 = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface 들어온것 {
  text?: string;
  /** `id\t이름 규격` 줄들 — 부르는 쪽이 그 거래처가 사는 것만 추려 넘긴다. */
  catalog?: string[];
  partners?: string[];
  /**
   * **이 거래처가 전에 시킨 것** — `날짜\tid\t이름\t수량  "그때 그 집이 쓴 말"` 줄들.
   * 부르는 쪽이 `shared/orderExtract.historyLines` 로 만들어 넘긴다.
   */
  history?: string[];
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

'전에 시킨 것' 목록이 붙어 있으면 그것부터 본다:
- 그 집이 **실제로 사는 품목**이 거기 있다. 새 글의 품목은 **웬만하면 거기서 나온다.**
- 큰따옴표 안은 **그때 그 집이 보낸 말**이고 그 앞이 사람이 최종으로 고른 품목이다.
  곧 **사람이 맞다고 한 짝**이다. 같은 말이 또 오면 **같은 품목으로 읽는다.**
- '3박스' 처럼 적힌 줄은 그 집이 **박스로 시키는 버릇**이라는 뜻이다. isBox 를 정할 때 쓴다.
- 늘 시키던 수량과 다르더라도 **글에 적힌 대로** 옮긴다. 기록에 맞춰 고치지 마라.
- 전에 시킨 것에만 있고 위 품목 목록에 없는 id 는 **쓰지 않는다.** 품목 목록이 언제나 기준이다.

JSON 형식(이것만 출력한다. 설명·코드블록 금지):
{"partnerId":"","deliveryDate":"","note":"","lines":[{"itemId":"","qty":0,"isBox":true,"source":""}]}`;

export const extractOrder = onCall(
  { region: REGION, secrets: [GEMINI_API_KEY], timeoutSeconds: 60 },
  async (request) => {
    //  **로그인한 사람만** — 열쇠를 대신 써 주는 함수라 아무나 부르면 요금이 샌다.
    if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

    const { text, catalog, partners, history, today } = (request.data ?? {}) as 들어온것;
    const 글 = String(text ?? '').trim().slice(0, 글자한도);
    if (!글) throw new HttpsError('invalid-argument', '읽을 글이 없습니다.');

    const 품목목록 = (Array.isArray(catalog) ? catalog : []).slice(0, 품목한도);
    if (!품목목록.length) throw new HttpsError('invalid-argument', '품목 목록이 비어 있습니다.');
    const 거래처목록 = (Array.isArray(partners) ? partners : []).slice(0, 품목한도);
    //  **지난 주문은 없어도 된다** — 처음 거래하는 곳이면 빈 목록이 온다. 그때는 그 대목을 아예 뺀다.
    const 지난주문 = (Array.isArray(history) ? history : []).slice(0, 기록한도);
    const 오늘 = /^\d{4}-\d{2}-\d{2}$/.test(String(today ?? '')) ? String(today) : new Date().toISOString().slice(0, 10);

    const 본문 = [
      지침(오늘),
      '',
      '## 품목 목록 (id\t이름)',
      ...품목목록,
      ...(거래처목록.length ? ['', '## 거래처 목록 (id\t이름)', ...거래처목록] : []),
      ...(지난주문.length ? ['', '## 이 거래처가 전에 시킨 것 (최근순 · 날짜\tid\t이름\t수량  "그때 그 집이 쓴 말")', ...지난주문] : []),
      '',
      '## 받은 글',
      글,
    ].join('\n');

    let 답: string;
    try {
      const 요청 = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY.value(),
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 본문 }] }],
          generationConfig: {
            // 주문 추출은 깊은 추론보다 빠르고 완결된 JSON이 중요하다. 기본 medium은 2천 토큰에서 답을 잘랐다.
            thinkingConfig: { thinkingLevel: 'MINIMAL' },
            temperature: 0,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                partnerId: { type: 'STRING' },
                deliveryDate: { type: 'STRING' },
                note: { type: 'STRING' },
                lines: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      itemId: { type: 'STRING' },
                      qty: { type: 'NUMBER' },
                      isBox: { type: 'BOOLEAN' },
                      source: { type: 'STRING' },
                    },
                    required: ['itemId', 'qty', 'source'],
                  },
                },
              },
              required: ['partnerId', 'deliveryDate', 'note', 'lines'],
            },
          },
        }),
      } satisfies RequestInit;

      let res: Response | undefined;
      // 503은 Gemini가 고수요 때 잠깐 돌려주는 응답이다. 직원이 다시 누르게 하지 않고 서버에서 두 번 더 시도한다.
      for (let 시도 = 0; 시도 < 3; 시도 += 1) {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, 요청);
        if (res.status !== 503 || 시도 === 2) break;
        await 잠깐(500 * (시도 + 1));
      }
      if (!res) throw new Error('Gemini 응답이 없습니다.');
      if (!res.ok) {
        const 사유 = await res.text().catch(() => '');
        console.error('[주문 읽기] API 응답 실패', res.status, 사유.slice(0, 300));
        throw new HttpsError('internal', `주문을 읽지 못했습니다(${res.status}).`);
      }
      const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
      답 = (json.candidates?.[0]?.content?.parts ?? []).map(part => part.text ?? '').join('').trim();
      if (json.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        console.error('[주문 읽기] 출력 한도 초과', 답.slice(0, 300));
        throw new HttpsError('internal', '주문 내용이 너무 길어 끝까지 읽지 못했습니다. 주문 부분만 다시 넣어주세요.');
      }
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
