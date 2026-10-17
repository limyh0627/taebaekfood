import type { Order, RawMaterialEntry } from '../../../shared/types';
import { DENSITY } from '../../../constants/formula';
import { applyLedgerRowByBusinessDate, sortLedger } from '../../../shared/rawLedgerBalance';
import { ledgerTrace } from '../../../shared/ledgerTrace';

export type DayRow = {
    key: string; date: string; material: string;
    received: number; used: number; adj: number; prev: number; cur: number;
    notes: string[]; who: Set<string>; wheres: Set<string>; cards: Set<string>;
    types: Set<string>; delIds: string[];
    mine: boolean; anchor?: number; rows: RawMaterialEntry[];
    /** 만들어진 차례(오래된 것부터 0,1,2…). 표시할 때 같은 날짜 안에서 뒤집는 데 쓴다. */
    seq: number;
  };

export function buildRawLedgerRows(allEntries: RawMaterialEntry[] | undefined, entries: RawMaterialEntry[], currentUserName: string | undefined, isAdmin: boolean, onDelete: ((id: string) => void) | undefined, orderById: Map<string, Order>, linesUsingRaw: ((order: Order, material: string) => Order['items'] | undefined) | undefined): DayRow[] {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const byMat = new Map<string, RawMaterialEntry[]>();
    for (const e of (allEntries ?? entries)) {
      const m = e.material ?? '';
      const arr = byMat.get(m); if (arr) arr.push(e); else byMat.set(m, [e]);
    }
    const out: DayRow[] = [];
    let order = 0;
    for (const [m, list] of byMat) {
      const density = DENSITY[m] ?? 1;
      // 날짜 → 같은 날은 기록된 시각 순 (그 묶음 첫 줄 직전 잔량 = 전일재고)
      // 날짜 → 기록된 시각 → 번호. 마지막 번호까지 봐야 동시각일 때 순서가 고정된다
      // (안 그러면 읽어온 순서라 새로고침마다 잔량 표시가 흔들린다).
      // 원자화 줄은 `recordedAt`, 옛 줄은 `createdAt`을 쓴다. 화면만 createdAt으로 정렬하면
      // 같은 원장을 공용 계산기는 1,009L, 표는 1,052L로 서로 다르게 보여 준다.
      const ordered = sortLedger(list);
      let bal = 0, seg = 0, curDate = '';
      let g: DayRow | null = null;
      const flush = () => { if (g) { g.seq = order++; out.push(g); g = null; } };
      for (const e of ordered) {
        // 옛 기록(unit='L')은 L로 저장돼 있어 kg로 환산해야 나머지와 더해진다
        const toKg = (v: number) => (e.unit === 'L' && density !== 1 ? v * density : v);
        const isCorr = e.type === 'correction' || e.targetKg != null;
        const date = e.date ?? '';
        if (date !== curDate) { flush(); curDate = date; seg = 0; }
        const key = `${m}|${date}#${isCorr ? 'adj' : ''}${seg}`;
        if (!g || g.key !== key) {
          flush();
          g = { key, date, material: m, received: 0, used: 0, adj: 0, prev: bal, cur: bal,
                notes: [], who: new Set(), wheres: new Set(), cards: new Set(),
                types: new Set(), delIds: [], mine: false, rows: [], seq: 0 };
        }
        const prev = bal;
        // 잔량 규칙은 shared/rawLedgerBalance.ts 한 곳에만 둔다 — 화면과 테스트가 같은 함수를 쓴다.
        // (재고실사(targetKg)는 잔량을 실제로 센 값으로 리셋하는 앵커다)
        // 이 표는 문서 날짜순이다. 처리 당시 스냅샷(balanceAfterKg)을 날짜 자리에서 쓰면
        // 소급 입력 뒤 중간 잔량이 튄다. 날짜별 수량과 실사 앵커만 누적한다.
        bal = applyLedgerRowByBusinessDate(bal, e, density);
        // 정정·실사는 입고·사용이 아니다 — 섞으면 사용량이 부풀려진다
        if (isCorr) g.adj = r3(g.adj + (bal - prev));
        else { g.received = r3(g.received + toKg(e.received ?? 0)); g.used = r3(g.used + toKg(e.used ?? 0)); }
        if (e.targetKg != null) g.anchor = Number(e.targetKg);
        //  누가·어디는 **ledgerTrace 한 곳**이 푼다 — 원료수불부(서류)도 같은 함수를 쓴다
        const tr = ledgerTrace(e, orderById, linesUsingRaw);
        if (tr.note) g.notes.push(tr.note);
        if (tr.who) g.who.add(tr.who);
        if (tr.where) g.wheres.add(tr.where);
        if (tr.cardNo) g.cards.add(tr.cardNo);
        g.types.add(e.type ?? 'manual');
        if (currentUserName && e.addedBy === currentUserName) g.mine = true;
        if (isAdmin && e.type !== 'auto' && !(e.kind === 'reverse' && e.reversalOf) && e.id && onDelete) g.delIds.push(e.id);
        g.cur = bal;
        g.rows.push(e);
        if (isCorr) { flush(); seg++; }   // 정정 뒤부터는 새 묶음
      }
      flush();
    }
    return out;
}
