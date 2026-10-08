export type CompanyId = 'taebaek' | 'punghoe';

export interface RawMaterialLot {
  id: string;
  supplierId?: string;        // 거래처 ID (이월 로트는 없음)
  supplierName: string;       // 거래처명 (예: '풍회유통') 또는 '이월'
  packageType?: string;       // '캔' | '포대' | '자루'
  packageKg?: number;         // 포장 1개당 kg (16.5 등)
  qtyIn?: number;             // 입고 시 포장 개수 (캔 68)
  kgIn: number;               // 입고 kg (= packageKg × qtyIn, 자동계산)
  kgRemaining: number;        // 잔여 kg (사용 시 차감)
  receivedDate: string;       // 입고일 'YYYY-MM-DD'
  lotNo?: string;             // 로트번호 (미래 확장)
  status: 'active' | 'depleted';
  poId?: string;              // 원본 입고 전표(purchaseOrders) 참조 — OEM 박스 로트는 가공 배치 id
  createdAt: string;

  // ── 물질 축 ──────────────────────────────────────────────────────────
  /**
   * 이 로트가 무슨 물질인가 — 벌크든 박스든 같은 값('볶음참깨').
   *
   * 로트는 **재고를 들고 있는 품목**에 붙는다(박스 재고는 박스 품목에 있으니 로트도 거기).
   * 그래서 같은 볶음참깨가 벌크 홀더와 박스 품목 세 개에 흩어진다.
   * 회수·역추적은 품목이 아니라 물질 단위로 물으므로, 이 키로 가로질러 모은다.
   * (같은 배열에 몰아넣으면 재고가 두 번 잡히고 FIFO가 엉킨다 — 저장은 나누고 조회만 묶는다)
   */
  material?: string;
  /** 잔여 **개수** — 박스·개로 세는 완제품 로트용. 벌크는 이 값이 없고 kgRemaining을 쓴다. */
  qtyRemaining?: number;
  /** 1개당 kg — 개수↔kg 환산(박스 1개 = 20kg). 완제품 로트만. */
  unitKg?: number;
}

export interface LotMixSetting {
  topPercent?: number;
  ratios?: { lotId: string; percent: number }[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 자동 로트번호: 입고일(YYMMDD) + 같은 날 순번(2자리). 예) 2026-06-15 → "260615-01", "260615-02"…
 * 이월 번호는 일반 입고 번호와 접두사를 달리한다.
 */
export function nextLotNo(lots: RawMaterialLot[], receivedDate: string): string {
  const ymd = (receivedDate ?? '').replace(/-/g, '').slice(2); // 2026-06-15 → 260615
  const n = (lots ?? []).filter(l => (l.lotNo ?? '').startsWith(ymd + '-')).length + 1;
  return `${ymd}-${String(n).padStart(2, '0')}`;
}

/** 입고 1건 → 새 로트 1개 생성 (잔여 = 입고량) */
export function buildReceiveLot(params: {
  material: string;
  supplierId?: string;
  supplierName: string;
  qtyIn: number;           // 포장 개수 또는 입력 수량
  kgIn: number;            // 환산된 입고 kg
  packageType?: string;    // '캔' | '포대' | '자루'
  packageKg?: number;      // 포장 1개당 kg
  receivedDate: string;
  poId?: string;
  /**
   * 로트 id 를 밖에서 정해 넣는다 — **트랜잭션 안에서 부를 때는 반드시 넘긴다.**
   * Firestore 트랜잭션 콜백은 경합하면 여러 번 돈다. 안에서 `Date.now()`·난수로 id 를 만들면
   * 재시도마다 다른 로트가 생겨, 한 번의 입고가 여러 로트로 남을 수 있다.
   * (설계: 로컬전용/docs/원료실제원장-로트-원자화-설계.md §6)
   */
  id: string;
  /** 만든 시각을 밖에서 정해 넣는다 — 위와 같은 이유. */
  createdAt: string;
}): RawMaterialLot {
  const now = params.createdAt;
  return {
    id: params.id,
    material: params.material,
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    packageType: params.packageType,
    packageKg: params.packageKg,
    qtyIn: params.qtyIn,
    kgIn: round3(params.kgIn),
    kgRemaining: round3(params.kgIn),
    receivedDate: params.receivedDate,
    status: 'active',
    poId: params.poId,
    createdAt: now,
  };
}

/**
 * 로트 차감.
 * - 기본: 선입선출(FIFO) — 앞쪽 active 로트부터.
 * - 혼합(mix) 지정 시: 지정된 여러 active 로트에 비율대로 먼저 배분한다.
 *   예전 topPercent 설정도 상위 2개 비율로 계속 읽는다. 부족분은 FIFO로 이어서 차감한다.
 * 한 로트가 0이 되면 status='depleted'. 잔량이 부족하면 원본 로트 배열을 그대로 돌려준다.
 * 명령을 적용하는 쪽은 shortageKg > 0 을 반드시 거절해야 한다. 음수 이월을 새로 만들면
 * 같은 원료의 실제 재고와 로트가 함께 음수로 내려가던 사고를 되풀이한다.
 * @returns lots(차감 후), distribution(로트별 차감량), shortageKg(부족량)
 */
export function deductFromLots(
  lots: RawMaterialLot[],
  kgToUse: number,
  mix?: LotMixSetting,
): {
  lots: RawMaterialLot[];
  distribution: { lotId?: string; supplierName: string; lotNo?: string; receivedDate?: string; kg: number }[];
  shortageKg: number;
} {
  let remaining = round3(kgToUse);
  // 직접 호출에서 NaN은 부족량 검사도 통과해 로트 잔량까지 NaN으로 번진다.
  // 원자 명령의 검증과 별개로 FIFO 함수 입구에서도 유한한 양수만 받는다.
  if (!Number.isFinite(kgToUse) || !Number.isFinite(remaining) || !(remaining > 0)) {
    throw new RangeError('로트 사용량은 유한한 양수여야 한다');
  }
  const invalidLot = lots.find(lot => lot.status === 'active'
    && !Number.isFinite(Number(lot.kgRemaining ?? 0)));
  if (invalidLot) throw new RangeError(`활성 로트 ${invalidLot.id}의 잔량이 유한한 숫자가 아니다`);
  const availableKg = round3(lots.reduce((sum, lot) =>
    sum + (lot.status === 'active' ? Math.max(0, Number(lot.kgRemaining ?? 0)) : 0), 0));
  if (!Number.isFinite(availableKg)) throw new RangeError('활성 로트의 잔량 합계가 유한한 숫자가 아니다');
  const shortageKg = round3(Math.max(0, remaining - availableKg));
  if (shortageKg > 0) return { lots, distribution: [], shortageKg };
  const next = lots.map(l => ({ ...l }));
  const dist: { idx: number; lotId?: string; supplierName: string; lotNo?: string; receivedDate?: string; kg: number }[] = [];
  const activeIdx = next
    .map((l, i) => ({ l, i }))
    .filter(x => x.l.status === 'active' && (x.l.kgRemaining ?? 0) > 0)
    .map(x => x.i);

  const take = (idx: number, amount: number) => {
    const l = next[idx];
    const t = Math.min(l.kgRemaining, round3(amount), remaining);
    if (t <= 0) return;
    l.kgRemaining = round3(l.kgRemaining - t);
    remaining = round3(remaining - t);
    if (l.kgRemaining <= 0.0001) { l.kgRemaining = 0; l.status = 'depleted'; }
    const ex = dist.find(d => d.idx === idx);
    if (ex) ex.kg = round3(ex.kg + t);
    else dist.push({ idx, lotId: l.id, supplierName: l.supplierName, lotNo: l.lotNo, receivedDate: l.receivedDate, kg: round3(t) });
  };

  // 혼합: 선택한 여러 로트에 비율 배분 우선. 합계가 100이 아니어도 정규화해 안전하게 처리한다.
  if (mix && activeIdx.length >= 2 && remaining > 0) {
    const configured = (mix.ratios ?? [])
      .map(row => ({ idx: next.findIndex(lot => lot.id === row.lotId), percent: Math.max(0, Number(row.percent) || 0) }))
      .filter(row => activeIdx.includes(row.idx) && row.percent > 0);
    const targets = configured.length >= 2
      ? configured
      : [
          { idx: activeIdx[0], percent: Math.max(0, Math.min(100, mix.topPercent ?? 50)) },
          { idx: activeIdx[1], percent: 100 - Math.max(0, Math.min(100, mix.topPercent ?? 50)) },
        ];
    const percentTotal = targets.reduce((sum, row) => sum + row.percent, 0);
    const total = round3(kgToUse);
    targets.forEach((row, index) => {
      const amount = index === targets.length - 1
        ? round3(total - targets.slice(0, index).reduce((sum, prior) => sum + round3(total * prior.percent / percentTotal), 0))
        : round3(total * row.percent / percentTotal);
      take(row.idx, amount);
    });
  }
  // 나머지(또는 비혼합): FIFO로 잔여 차감
  for (const idx of activeIdx) {
    if (remaining <= 0) break;
    take(idx, remaining);
  }

  return {
    lots: next,
    distribution: dist.map(({ idx, ...d }) => d),
    shortageKg: round3(Math.max(0, remaining)),
  };
}

