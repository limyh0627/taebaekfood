import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { IssuedStatement, CashEntry, Settlement, AccountCode, CompanyId, JournalEntry } from '../../shared/types';
import { openingDocId } from '../../shared/types';
import { fetchDateRange, fetchByIds, fetchWhere, fetchCollection } from '../../shared/services/firebaseService';
import { buildJournals } from '../../shared/buildJournals';
import { isReceivableStmt, allocatePartnerCash } from './cashLedger';
import {
  anchorBefore, readFrom, openStatementIds, allocationInputs, balancesWithAnchor,
  type PartnerAnchor,
} from './partnerAnchor';
import { today } from '../../shared/day';

/**
 * **전표 화면이 딛고 선 장부** — 전표를 어디까지 떠오고, 그걸로 잔액을 어떻게 세는가.
 *
 * 이 화면에는 겉보기에 다른 여러 기능이 얹혀 있지만(거래명세서 발행, 일반전표, 수금·지불,
 * 정기전표) 전부 **같은 전표 목록과 같은 잔액**을 봐야 한다. 예전엔 자리마다 props를
 * 그냥 쓰기도 하고 따로 떠오기도 해서, props를 고른 자리가 하나같이 "최근 7일 밖은 못 본다"는
 * 같은 병을 앓았다 — 끊은 주문이 미발행으로 뜨고, 소급 발행하면 문서번호가 겹치고,
 * 정기전표가 두 번 나가고, 다 안 갚은 전표에서 수금 버튼이 사라졌다.
 *
 * 그래서 **떠오는 일과 세는 일을 여기 한 군데로 모은다.** 화면은 결과만 쓴다.
 *
 * 세 갈래로 떠온다:
 *   ① props     — 최근 7일, 실시간 구독. 방금 낸 전표가 바로 보인다.
 *   ② 장부 전체 — `ledgerFrom`부터. 잔액의 근거라 넉넉히 떠온다.
 *   ③ 앵커 미결 — 앵커가 짚어 준 옛 미결 전표만 id로. 배분을 이어 가려면 필요하다.
 * 합칠 때는 props가 이긴다(가장 최신이다).
 */
export interface VoucherLedgerInput {
  companyId: CompanyId;
  /** 최근 7일 실시간 구독분 */
  issuedStatements: IssuedStatement[];
  cashEntries: CashEntry[];
  settlements: Settlement[];
  accountCodes: AccountCode[];
  /** 조회 기간 — 이보다 옛날을 보겠다고 하면 그만큼 더 떠온다 */
  histFrom: string;
  histTo: string;
}

export function useVoucherLedger({
  companyId, issuedStatements, cashEntries, settlements, accountCodes, histFrom, histTo,
}: VoucherLedgerInput) {
  // ── 발행내역 온디맨드 fetch (7일 이전 데이터) ──
  const [extraStatements, setExtraStatements] = useState<IssuedStatement[]>([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const fetchedRangeRef = useRef<{ from: string; to: string } | null>(null);

  const sevenDaysAgoCutoff = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }, []);

  /**
   * 발행내역 온디맨드 fetch — **떠온 전표는 안 버린다.**
   *
   * 예전엔 조회 기간을 최근 7일로 좁히면 `setExtraStatements([])`로 통째로 비웠다.
   * 그런데 이 목록은 **거래처 잔액의 근거**이기도 하다(partnerJournals → partnerBalances).
   * 비우는 순간 옛 전표가 사라져 미수·미지급이 확 줄고, 일반전표 발행 화면이 보여주는
   * 누적잔액이 거래처 누적잔액과 안 맞았다.
   *
   * 화면에 뭘 **보여줄지**는 아래 filteredHistory가 날짜로 거른다. 여기서 버릴 이유가 없다.
   * 그래서 id로 합치기만 하고 지우지 않는다.
   */
  /**
   * **어디까지 거슬러 읽나 — 기초일이 앵커다.**
   *
   * 기초 전표(`기초260731-…` 62건)가 그 이전을 통째로 요약한다. 거래처별 108·251을
   * 그날 한 번에 세워 두므로, **기초일부터 읽으면 잔액이 맞는다.**
   * 앵커를 무시하고 2020년부터 읽으면 지금은 결과가 같지만(그 이전 전표가 0건),
   * 해가 쌓이면 읽는 양만 늘고 "왜 다 읽나"가 코드에 안 남는다.
   * 결산 때 다음 기초를 박으면 그 앞이 저절로 잘린다 — 그게 앵커의 값이다.
   *
   * 기초 문서가 없으면 근거가 없으니 전부 읽는다.
   */
  const [openingDate, setOpeningDate] = useState<string | null>(null);
  useEffect(() => {
    fetchCollection<{ id: string; date: string }>('openingBalances')
      .then(rows => setOpeningDate(rows.find(r => r.id === openingDocId(companyId))?.date ?? null))
      .catch(() => setOpeningDate(null));
  }, [companyId]);

  /**
   * **연말 앵커** — 결산 때 박아 둔 거래처 잔액·미결 전표(`partnerBalanceSnapshots`).
   * 있으면 그 다음 날부터만 읽는다. 없으면 기초일부터(지금이 이 길이다 — 첫 앵커는 2026-12-31).
   */
  const [anchors, setAnchors] = useState<PartnerAnchor[]>([]);
  useEffect(() => {
    fetchWhere<PartnerAnchor>('partnerBalanceSnapshots', 'companyId', companyId)
      .then(setAnchors).catch(() => setAnchors([]));
  }, [companyId]);
  const anchor = useMemo(() => anchorBefore(anchors, today()), [anchors]);

  /** 이 회사 장부를 어디부터 읽나. 앵커 > 기초 > 전부. */
  const ledgerFrom = readFrom(anchor, openingDate ?? '2020-01-01');

  /**
   * **앵커가 짚어 준 미결 전표를 따로 집어 온다.**
   *
   * 잔액은 앵커 숫자로 되지만 **전표 한 장씩 얼마 남았나**는 그 전표가 손에 있어야 센다.
   * 안 집어 오면 옛 미결 전표가 후보에서 빠져, 그 거래처 수금이 새 전표를 갉아먹고
   * 안 갚은 전표가 '완납'으로 보인다 → 수금·지불 버튼이 사라진다.
   * 연말에 살아 있는 건 몇 장뿐이라 id로 집어 오면 싸다.
   */
  const [anchorStatements, setAnchorStatements] = useState<IssuedStatement[]>([]);
  useEffect(() => {
    const ids = openStatementIds(anchor);
    if (!ids.length) { setAnchorStatements(prev => (prev.length ? [] : prev)); return; }
    fetchByIds<IssuedStatement>('issuedStatements', ids)
      .then(rows => setAnchorStatements(rows.map(x => ({ ...x, items: x.items ?? [], tradeDate: x.tradeDate ?? '', issuedAt: x.issuedAt ?? '' }))))
      .catch(() => setAnchorStatements([]));
  }, [anchor]);

  /**
   * **잔액용 전체 적재 — 화면을 열 때 한 번.**
   *
   * 조회 기간이 '당일'로 시작하는데(histFrom = 오늘), 그 조건만 보면 옛 전표를 아예 안 떠온다.
   * 그런데 거래처 잔액(partnerBalances)은 이 목록을 근거로 세므로, 안 떠오면 미수·미지급이
   * 최근 7일치만 잡혀 거래처 누적잔액과 안 맞는다.
   * 화면에 뭘 보여줄지는 filteredHistory가 날짜로 거른다 — 적재는 넉넉히 해 둔다.
   */
  useEffect(() => {
    fetchDateRange<IssuedStatement>('issuedStatements', 'tradeDate', ledgerFrom, today())
      .then(data => setExtraStatements(prev => {
        const m = new Map(prev.map(x => [x.id, x]));
        for (const x of data) m.set(x.id, { ...x, items: x.items ?? [], tradeDate: x.tradeDate ?? '', issuedAt: x.issuedAt ?? '' });
        return [...m.values()];
      }))
      .catch(() => {});
  }, [ledgerFrom]);

  useEffect(() => {
    const from = histFrom || ledgerFrom;
    const to   = histTo   || today();
    if (from >= sevenDaysAgoCutoff) return;          // 최근 7일은 props로 충분 — 더 안 떠온다
    if (fetchedRangeRef.current?.from === from && fetchedRangeRef.current?.to === to) return;
    setIsFetchingHistory(true);
    fetchDateRange<IssuedStatement>('issuedStatements', 'tradeDate', from, to)
      .then(data => {
        const fetched = data.map(s => ({
          ...s,
          items: s.items ?? [],
          tradeDate: s.tradeDate ?? '',
          issuedAt: s.issuedAt ?? '',
        }));
        setExtraStatements(prev => {
          const m = new Map(prev.map(x => [x.id, x]));
          for (const x of fetched) m.set(x.id, x);   // 새로 떠온 게 최신
          return [...m.values()];
        });
        fetchedRangeRef.current = { from, to };
      })
      .finally(() => setIsFetchingHistory(false));
  }, [histFrom, histTo, ledgerFrom, sevenDaysAgoCutoff]);

  // 방금 지운 전표 — extraStatements는 한 번 떠온 스냅샷이라 삭제가 안 비친다.
  // 지운 id를 여기 담아 두고 합칠 때 걸러 낸다(다시 떠와도 안 되살아난다).
  const [deletedStmtIds, setDeletedStmtIds] = useState<Set<string>>(new Set());

  /**
   * **전표의 유일한 원천.** 화면 어디서든 이걸 본다 — props(issuedStatements)를 직접
   * 보면 안 된다.
   *
   * props는 최근 7일 구독이고 extraStatements는 마운트 때 통째로 떠온 과거다.
   * 둘을 합치되 props가 이겨서, **과거 전부 + 최근은 실시간**이 된다.
   *
   * 예전엔 자리마다 둘 중 하나를 골라 썼고, props를 고른 자리가 전부 "7일 밖은
   * 못 본다"는 같은 병을 앓았다 — 끊은 주문이 미발행으로 뜨고, 소급 발행하면 문서번호가
   * 겹치고, 정기전표가 두 번 나가고, 이미 연결된 발주가 다시 떴다.
   */
  //
  // **회사로 한 번 더 거른다.** props는 이미 걸러져 오지만 extraStatements는 이 화면이
  // 직접 떠온 것이라 안 걸러져 있다 — 그래서 풍회로 바꿔도 태백 전표가 다 보였다.
  const mergedStatements = useMemo(() => {
    const map = new Map<string, IssuedStatement>();
    //  앵커가 짚어 준 옛 미결 전표가 맨 밑 — 나중 것이 이긴다
    anchorStatements.forEach(s => map.set(s.id, s));
    extraStatements.forEach(s => map.set(s.id, s));
    issuedStatements.forEach(s => map.set(s.id, s));
    for (const id of deletedStmtIds) map.delete(id);
    return Array.from(map.values()).filter(s => (s.companyId ?? 'taebaek') === companyId);
  }, [issuedStatements, extraStatements, anchorStatements, deletedStmtIds, companyId]);

  /**
   * **전표가 실제로 걸린 주문 id** — `invoicePrinted` 플래그가 아니라 전표를 근거로 본다.
   *
   * 플래그는 전표를 만들 때 세우는데, 전표를 지우거나 발행이 중간에 엎어져도 그대로 남는다.
   * 그러면 전표가 없는데도 목록에서 숨어 영영 안 보인다(2026-08 기준 3건이 그 상태였다:
   * 일성상회 08-18 · 세화식품 08-13 · 글로벌유통 08-05).
   *
   * 뱃지(5300줄 근처)는 진작 전표를 같이 보고 있었는데 **목록 필터만 플래그를 봐서**,
   * "미발행이라고 찍히는데 목록엔 안 뜨는" 상태였다. 둘을 하나로 맞춘다.
   *
   * 한 전표가 여러 주문을 묶기도 해서 콤마·공백으로 갈라 담는다.
   */
  const voucherOrderIds = useMemo(() => {
    const set = new Set<string>();
    for (const st of mergedStatements)
      for (const v of String(st.orderId ?? '').split(/[,\s]+/)) if (v) set.add(v);
    return set;
  }, [mergedStatements]);

  /**
   * 발행완료인가 — **전표가 걸렸느냐 하나만 본다.** `invoicePrinted` 플래그는 안 본다.
   *
   * 플래그는 양쪽으로 다 거짓말한다. 전표를 지워도 true로 남고(그 주문이 영영 숨는다),
   * 전표를 손으로 이어 붙이면 여전히 false다(전표가 있는데 미발행으로 뜬다).
   * 근거는 전표 실물뿐이다.
   *
   * 전표를 아직 못 불러왔으면 미발행으로 보이는데, 그쪽이 안전한 방향이다 —
   * 있는 걸 한 번 더 보는 건 괜찮지만 없는 걸 숨기면 매출이 통째로 샌다.
   */
  const isVouchered = useCallback(
    (o: { id: string }) => voucherOrderIds.has(o.id),
    [voucherOrderIds],
  );

  /**
   * 거래처별 잔액 — 전표 총액에서 그 거래처로 오간 채권·채무(108/251) 자금을 뺀다.
   * **전표에 안 붙인다.** 받은 돈이 어느 청구서를 갚았는지 따지지 않고 "이 거래처에 얼마 남았나"만 본다.
   * 분개(108·251 잔액)와 같은 규칙이라 전표화면·거래처통계·재무제표가 저절로 같은 숫자를 낸다.
   * 마이너스면 더 받은 것 = 선수금.
   */

  // 잔액은 **분개의 108·251**에서 센다 — 전표 갈래(type)로 세면 갈래를 바꿀 때 잔액이 사라진다.
  // 기초잔액은 거래처가 없으니 안 넘겨도 결과가 같다.
  const partnerJournals = useMemo(
    () => buildJournals({ statements: mergedStatements, cashEntries, accounts: accountCodes }).entries,
    [mergedStatements, cashEntries, accountCodes]);
  /** 전표 id → 그 전표의 분개. 몫을 셀 때 쓴다. */
  const journalBySource = useMemo(() => {
    const m = new Map<string, JournalEntry>();
    for (const je of partnerJournals) if (je.sourceId) m.set(je.sourceId, je);
    return m;
  }, [partnerJournals]);
  const partnerBalances = useMemo(() => {
    //  **분개에 나오는 거래처를 다 담는다.** 예전엔 mergedStatements에 등장한 거래처만 담아서,
    //  전표 조회창 밖 거래처는 통째로 빠져 일반전표 발행에서 잔액이 0으로 떴다.
    //
    //  앵커가 있으면 그 숫자 위에 앵커 뒤 움직임만 얹는다. 앵커가 없으면(지금이 그렇다)
    //  넘어온 분개가 전부라 예전과 똑같이 센다.
    return balancesWithAnchor(anchor, partnerJournals);
  }, [anchor, partnerJournals]);

  /**
   * 전표별 남은 금액 — **mergedStatements로 돌린다.**
   *
   * props(issuedStatements)는 최근 7일 창이라, 그걸로 배분하면 창 밖의 옛 전표가 후보에서 빠지고
   * 그 거래처의 수금 전액이 창 안 전표를 갉아먹는다 → 안 갚은 전표가 '완납'으로 보여
   * **수금처리 버튼이 사라진다.** 배분은 언제나 그 거래처의 전표 전부를 놓고 해야 맞다.
   */
  const openByStmt = useMemo(() => {
    //  앵커가 걸리면 전표·자금·시작잔액 셋을 같이 잘라야 한다 — 규칙은 앵커가 들고 있다
    const alloc = allocationInputs(anchor, mergedStatements, cashEntries);
    const out = new Map<string, number>();
    const keys = new Set(alloc.statements
      .filter(st => st.type === '매출' || st.type === '매입')
      .map(st => `${st.partnerId}|${st.type}`));
    for (const key of keys) {
      const [pid, type] = key.split('|');
      for (const [id, open] of allocatePartnerCash(pid, type as '매출' | '매입', alloc.statements, alloc.cashEntries, settlements, alloc.opening)) {
        out.set(id, open);
      }
    }
    return out;
  }, [anchor, mergedStatements, cashEntries, settlements]);
  //  배분에 없으면 총액으로 물러선다 — 채권·채무를 안 세우는 전표(감가상각·급여 등)가 그렇다
  const getBalance = useCallback(
    (s: IssuedStatement) => openByStmt.get(s.id) ?? s.totalAmount,
    [openByStmt]);
  /**
   * **수금·지불 버튼을 달 전표인가** — 채권(108)·채무(251)를 세우는 것만.
   *
   * 예전엔 `getBalance(s) > 0` 하나로 봤는데, getBalance는 배분에 없으면 총액으로 물러선다.
   * 그래서 감가상각·급여·선급금대체처럼 **갚을 상대가 없는 전표까지** 전액 미결제로 보여
   * 지불처리 버튼이 붙었다(지금 데이터로 비용 25건).
   *
   * 기초이월은 type이 '비용'이지만 108·251을 세우므로 여기 걸린다 — 실제로 갚아야 할 것이다.
   */
  const canSettle = useCallback((s: IssuedStatement) =>
    (isReceivableStmt(s, '매출') || isReceivableStmt(s, '매입')) && getBalance(s) > 0,
    [getBalance]);

  /**
   * **지운 전표를 잊는다** — 서버에서 지우는 건 화면 쪽 일이고, 여기선 목록에서 뺀다.
   *
   * `extraStatements`는 한 번 떠온 스냅샷이라 삭제가 저절로 안 비친다. 지운 id를
   * 담아 두고 합칠 때 걸러 낸다 — 다시 떠와도 안 되살아난다.
   */
  const forgetStatement = useCallback((id: string) => {
    setDeletedStmtIds(prev => new Set(prev).add(id));
    setExtraStatements(prev => prev.filter(s => s.id !== id));
  }, []);

  return {
    mergedStatements, journalBySource, partnerBalances,
    getBalance, canSettle, isVouchered, isFetchingHistory, forgetStatement,
  };
}
