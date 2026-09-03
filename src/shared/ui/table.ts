/**
 * **화면 모양은 여기서 정한다** — 메뉴마다 손으로 적으면 규칙이 없어진다(2026-09-03 사장님 지시).
 *
 * 기준은 **거래명세서와 손익/비용분석**이다(사장님이 지금 쓰기 괜찮다고 한 둘).
 * 그 둘이 실제로 쓰는 어휘를 세어 보니 거의 같았다 — 그걸 그대로 규칙으로 삼는다.
 *
 *     모서리   rounded-xl(칸·단추) · rounded-2xl(판)
 *     글자     text-xs(본문) · text-[11px](곁들임) · text-[10px](딱지·머리)
 *     여백     px-4 py-2.5(표 칸) · px-5 py-4(판 안쪽)
 *     틈       gap-2(가로) · gap-3(세로)
 *     테두리   border border-slate-200(판) · border-slate-100(줄)
 *     바탕     bg-white(판) · bg-slate-50(머리·바닥)
 *
 * ---
 * **폰에서 표는 옆으로 민다** — 칸을 감추지 않는다(사장님 확인).
 * 대신 **글자가 한 자씩 세로로 쌓이면 안 된다.** 그게 진짜 문제였다 —
 * `w-full` 만 주면 폭에 맞춰 칸이 찌그러지고 한글이 쌓인다. 그래서 둘이 같이 필요하다:
 *
 *     ① 표에 최소 너비    → 넘쳐서 스크롤이 생긴다
 *     ② 칸에 nowrap       → 안 접힌다
 *
 * 새 화면을 만들 때 여기 있는 걸 쓴다. 없는 게 필요하면 **여기 더한다.**
 */

/** 표를 감싸는 자리 — 좁으면 가로로 민다 */
export const SCROLL = 'overflow-x-auto';

/** 표. `minW` 를 꼭 준다 — 없으면 폭에 맞춰 찌그러진다. */
export const table = (minW = 720) => `w-full min-w-[${minW}px] text-xs`;

export const THEAD = 'bg-slate-50/70 text-slate-400';
export const TH = 'px-4 py-2.5 text-left font-black whitespace-nowrap';
export const TH_NUM = 'px-4 py-2.5 text-right font-black whitespace-nowrap';

export const TD = 'px-4 py-2.5 whitespace-nowrap';
/** 길어질 수 있는 이름·적요 — 접지 말고 잘라 낸다 */
export const TD_NAME = 'px-4 py-2.5 truncate max-w-[240px]';
export const TD_NUM = 'px-4 py-2.5 text-right font-black tabular-nums whitespace-nowrap';

/** 판(카드) */
export const CARD = 'bg-white rounded-2xl border border-slate-200';
export const CARD_PAD = 'px-5 py-4';

/** 좌우 두 판 — 폰에서는 위아래로 쌓는다 */
export const SPLIT = 'grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3 lg:gap-4';
/** 그 왼쪽 판(목록) — 폰에서 위를 다 차지하면 아래를 못 본다 */
export const SPLIT_SIDE = 'max-h-[40vh] lg:max-h-[calc(100vh-260px)] overflow-y-auto';

/* ═══════════════════════════════════════════════════════════════════
   단추 — 기준 두 화면(거래명세서·손익분석)이 쓰는 모양
   ═══════════════════════════════════════════════════════════════════ */

/** 이 화면에서 **제일 중요한 한 가지** — 발행·저장처럼 되돌리기 어려운 것 */
export const BTN = 'px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 transition-all disabled:opacity-40';
/** 돈이 들어오는 쪽(수금·매출) */
export const BTN_IN = 'px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 transition-all disabled:opacity-40';
/** 서류를 내보내는 쪽(엑셀·PDF) */
export const BTN_OUT = 'px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 transition-all disabled:opacity-40';
/** 그 밖 — 취소·닫기·보조 */
export const BTN_SUB = 'px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-black hover:bg-slate-50 transition-all';
/** 아직 안 끝난 것 · 봐야 할 것(대기·주의) */
export const BTN_WARN = 'px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 transition-all';
/** 지우기처럼 되돌릴 수 없는 것 */
export const BTN_DANGER = 'px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700 transition-all';

/**
 * **탭은 셋뿐이다.** 2026-09-03 에 세어 보니 관리자 화면에 **72가지**가 있었다 —
 * 같은 탭인데 화면마다 크기·모서리·글자가 달랐다. 크기로 층을 나눈다.
 *
 *   tab      화면 맨 위 큰 갈래        px-3 py-2   rounded-lg  text-xs
 *   tabSm    그 안 작은 갈래           px-2.5 py-1 rounded-lg  text-[11px]
 *   pill     목록 안 딱지형 고르기     px-2 py-0.5 rounded-full text-[10px]
 */
export const tab = (on: boolean) =>
  `px-3 py-2 rounded-lg text-xs font-black transition-all ${on ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-50'}`;

export const tabSm = (on: boolean) =>
  `px-2.5 py-1 rounded-lg text-[11px] font-black transition-all ${on ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-50'}`;

export const pill = (on: boolean) =>
  `px-2 py-0.5 rounded-full text-[10px] font-black transition-all ${on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`;

/** 딱지(상태 표시) — 색은 부르는 쪽이 정한다 */
export const CHIP = 'text-[10px] font-black px-1.5 py-0.5 rounded';
