/**
 * **이 전표가 그 거래처의 최신 전표인가** — 단가를 되밀지 말지를 가른다.
 *
 * 2026-09-09 사장님: "옛 전표는 고쳐도 단가 반영이 안되도 돼 그게 그 거래처의 최신 전표가 아니면".
 *
 * 거래처 단가는 **"지금 그 거래처에 파는 값"**이다. 6월 전표의 오타를 고쳤다고 오늘 단가가
 * 6월 값으로 돌아가면 안 된다. 되밀 자격이 있는 건 **제일 최근 거래**뿐이다.
 *
 * ---
 * **지금은 이게 우연히 막혀 있다.** 옛 전표 줄에는 `itemId` 가 없어서(9/8 이전 761줄 전부)
 * 되밀 품목을 못 찾아 그냥 지나간다. 하지만 그건 규칙이 아니라 **사고다** —
 * 최신 전표라도 옛것이면 못 되밀고, 소급해서 끊은 새 전표는 되밀어 버린다.
 * 그래서 규칙으로 박는다.
 *
 * ---
 * **기준은 거래일(tradeDate)이다.** 끊은 시각이 아니다 — 오늘 소급해서 6월 전표를 끊어도
 * 그건 6월 거래지 지금 단가가 아니다.
 *
 * **매출과 매입을 따로 본다.** 파는 값과 사는 값은 다른 장부다.
 *
 * 부수효과 없음(입력 → 값).
 */

export interface StatementLike {
  id?: string;
  partnerId?: string;
  type?: string;
  tradeDate?: string;
}

export interface LatestInput {
  /** 지금 발행·수정하는 전표. 새로 끊는 중이면 `id` 가 없다. */
  this: StatementLike;
  /** 그 회사의 전표 전부 — 거래처·갈래는 여기서 거른다 */
  all: readonly StatementLike[];
}

/**
 * 되밀 자격이 있나.
 *
 * **같은 날짜면 되민다**(`>=`). 하루에 두 장을 끊는 일이 흔하고, 그중 뭘 나중에 고칠지는
 * 모르는 일이다. 막는 게 목적이 아니라 **옛 거래가 지금 값을 덮는 걸** 막는 게 목적이다.
 *
 * 그래서 **자기 자신을 목록에서 뺄 필요가 없다** — 제 날짜는 언제나 제 날짜보다 크지 않아서
 * `>=` 판정을 못 뒤집는다. 빼는 줄을 넣어 봤더니 시험이 하나도 안 흔들려서 지웠다.
 * (`>` 로 바꾸면 그때는 빼야 한다. 그러면 같은 날 두 번째 전표가 영영 못 되민다.)
 */
export function isLatestForPartner({ this: 이번, all }: LatestInput): boolean {
  const pid = 이번.partnerId ?? '';
  const 갈래 = 이번.type ?? '';
  const 날 = String(이번.tradeDate ?? '');
  if (!pid || !날) return false;          // 거래처나 날짜가 없으면 견줄 수가 없다

  let 최신 = '';
  for (const s of all) {
    if ((s.partnerId ?? '') !== pid) continue;
    if ((s.type ?? '') !== 갈래) continue;
    const d = String(s.tradeDate ?? '');
    if (d > 최신) 최신 = d;
  }
  return 날 >= 최신;
}
