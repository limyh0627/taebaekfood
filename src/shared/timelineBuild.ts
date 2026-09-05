import type { IssuedStatement, CashEntry } from './types';
import type { TimelineRow } from './timelineRows';
import { AR, AP } from './autoJournal';
import { timeOfLocal, issuedMs } from './voucherStamp';
import { partnerCashParts } from '../features/admin/cashLedger';

/**
 * **전표 목록의 줄을 만들고 누적잔액을 굴리는 셈.**
 *
 * [TradeStatement.tsx](../../components/TradeStatement.tsx) 안에 130줄로 있던 것을
 * 떼어 왔다(목록 화면 정리, 2026-09-05). 돈이 걸린 자리라 손대기가 제일 무서웠고,
 * 그동안 여기서 난 사고가 주석으로 남아 있다.
 *
 * 부수효과 없음(입력 → 값).
 */

/** 이 전표가 그 거래처의 채권이냐 채무냐, 그리고 얼마를 움직이나. 분개를 보고 판정한다. */
export interface ArApSide { side: '채권' | '채무' | null; delta: number }

export interface BuildTimelineInput {
  statements: readonly IssuedStatement[];
  cashEntries: readonly CashEntry[];
  /**
   * 전표 → 채권·채무 판정. **분개에서 세야 한다.**
   *
   * 전표 갈래(type)로 가르면 안 된다. 기초 미수는 갈래가 '비용'(대체)이라 같은
   * 거래처인데도 매출과 다른 묶음이 됐고, 두 가지가 한꺼번에 어긋났다 —
   * 같은 수금을 두 묶음이 각자 끌어가 한 줄이 두 줄로 보였고, 누적잔액도 갈렸다.
   * 채권·채무는 **계정(108·251)이 정하는 것**이지 갈래가 정하는 게 아니다.
   */
  arapOf: (s: IssuedStatement) => ArApSide;
}

type Ev =
  | { kind: 'stmt'; s: IssuedStatement; date: string; ts: string }
  | { kind: 'pay'; date: string; ts: string; amount: number; method?: string; note?: string;
      paymentId: string; src: IssuedStatement; entry?: CashEntry };

const evId = (e: Ev) => (e.kind === 'stmt' ? e.s.id : e.paymentId);

/**
 * 발생 순서.
 *
 * 동시각이면 **전표 먼저**(매출 가산 후 수금 차감). 그래도 동률이면 **번호순으로 못 박는다** —
 * 안 그러면 읽어온 순서를 그대로 쓰게 돼 새로고침할 때마다 순서가 달라질 수 있다.
 * 소급 전표는 시각이 전부 23:59:59라 자주 부딪힌다.
 */
function 발생순(a: Ev, b: Ev): number {
  const d = (a.ts ?? '').localeCompare(b.ts ?? '');
  if (d !== 0) return d;
  if (a.kind === 'stmt' && b.kind === 'pay') return -1;
  if (a.kind === 'pay' && b.kind === 'stmt') return 1;
  return issuedMs(evId(a)) - issuedMs(evId(b))
    || String(evId(a)).localeCompare(String(evId(b)), undefined, { numeric: true });
}

export function buildTimeline(input: BuildTimelineInput): TimelineRow[] {
  const { statements, cashEntries, arapOf } = input;
  const rows: TimelineRow[] = [];

  //  거래처 × 채권/채무로 묶는다. 한 거래처에 받을 것과 줄 것이 같이 있으면 잔액도 따로 굴러야 한다.
  const grouped = new Map<string, IssuedStatement[]>();
  const arap = new Map<string, ArApSide>();
  for (const s of statements) {
    const a = arapOf(s);
    arap.set(s.id, a);
    const key = `${s.partnerId}__${a.side ?? '기타'}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  grouped.forEach((stmts, key) => {
    const side = key.slice(key.indexOf('__') + 2) as '채권' | '채무' | '기타';
    const evs: Ev[] = stmts.map(s => ({
      kind: 'stmt' as const, s, date: s.tradeDate, ts: `${s.tradeDate}T${timeOfLocal(s.issuedAt)}`,
    }));

    // 수금/지불 — 전표에 붙이지 않는다. 그 거래처로 오간 채권·채무(108/251) 자금을 그대로 뺀다.
    //  "어느 청구서를 갚았나"를 안 따지므로 매칭이 어긋날 자리가 없다. 분개(108·251 잔액)와 같은 방식.
    const pid = stmts[0]?.partnerId;
    if (pid && side !== '기타') {
      for (const e of cashEntries) {
        if (e.partnerId !== pid) continue;
        const want = side === '채무' ? AP : AR;
        /*
         * 얼마를 갚았나는 **partnerCashParts 한 곳**에서 센다(자금원장·거래처잔액과 같은 함수).
         * 여기서 따로 세다가 상계를 통째로 놓쳤다 — 상계는 dir이 '대체'라 방향으로 못 거르고,
         * 줄 하나가 음수다(한중교역 8/19: 251 +9,370,000 / 108 −9,370,000).
         * 그래서 채권 쪽은 음수라 걸러지고 채무 쪽은 방향에서 걸려, 미수·미지급이 나란히
         * 9,370,000씩 안 줄었다. 자금 행으로도 안 떴다(상계분을 뺀 나머지가 0이라).
         */
        const amt = partnerCashParts(e).filter(x => x.code === want).reduce((a, x) => a + x.reduce, 0);
        if (amt <= 0.5) continue;
        evs.push({
          kind: 'pay', date: e.date, ts: `${e.date}T${timeOfLocal(e.createdAt)}`,
          amount: amt, method: e.dir === '대체' ? '상계' : '계좌이체',
          note: e.note, paymentId: e.id, src: stmts[0], entry: e,
        });
      }
    }

    evs.sort(발생순);

    let running = 0;
    for (const e of evs) {
      if (e.kind === 'stmt') {
        // 잔액에 얹는 건 **분개가 세운 채권·채무**다. 매출·매입은 전표 총액과 같고,
        // 기초 이월(대체)도 제자리를 찾는다. 거래처 빚이 없는 대체는 0이라 잔액을 안 흔든다.
        running += arap.get(e.s.id)?.delta ?? e.s.totalAmount;
        rows.push({ kind: 'stmt', data: e.s, cumul: running, dateKey: `${e.date}__${e.ts}`, ts: e.ts });
      } else {
        running -= e.amount;
        rows.push({
          kind: 'pay', partnerId: e.src.partnerId, partnerName: e.src.partnerName,
          // 딱지는 묶음이 정한다 — 기초 이월(대체)이 맨 앞에 선 묶음이라도 '수금'은 수금이다
          stmtType: side === '채무' ? '매입' : '매출', offset: e.entry?.dir === '대체',
          date: e.date, amount: e.amount, method: e.method, note: e.note,
          paymentId: e.paymentId, cumul: running, dateKey: `${e.date}__${e.ts}`,
          ts: e.ts, src: e.src, entry: e.entry,
        });
      }
    }
  });

  /**
   * 거래처별 잔액 자취 — **자금 행에도 누적잔액을 달기 위한 것.**
   *
   * 입금·출금 행은 그 거래처 잔액을 안 보여줬다. 잔액이 안 움직이는 돈(비용·상환)이라도
   * "이 거래처가 지금 얼마 남았나"는 같이 보여야 읽힌다.
   * 위에서 이미 계산한 cumul을 그대로 쓰므로 수금/지불 행과 숫자가 저절로 맞는다.
   */
  const balTrail = new Map<string, { ts: string; cumul: number }[]>();
  for (const r of rows) {
    if (r.kind !== 'stmt' && r.kind !== 'pay') continue;      // 자금 행은 아직 안 만들었다
    //  채권·채무를 안 세우는 전표(급여·감가상각·선급금대체)는 제 묶음('기타')에서 0부터 굴러서
    //  그 값을 자취에 넣으면 그 거래처 잔액이 통째로 흐려진다. 자취는 채권·채무만 쌓는다.
    if (r.kind === 'stmt' && !arap.get(r.data.id)?.side) continue;
    const pid = r.kind === 'stmt' ? r.data.partnerId : r.partnerId;
    if (!pid || r.cumul == null) continue;
    const arr = balTrail.get(pid) ?? [];
    arr.push({ ts: r.ts, cumul: r.cumul });
    balTrail.set(pid, arr);
  }
  for (const arr of balTrail.values()) arr.sort((a, b) => a.ts.localeCompare(b.ts));

  /** 그 시각까지의 마지막 잔액. 그 앞에 아무 것도 없으면 undefined(잔액을 아직 세울 수 없음) */
  const balanceAt = (pid: string | undefined, ts: string): number | undefined => {
    const arr = pid ? balTrail.get(pid) : undefined;
    if (!arr?.length) return undefined;
    let out: number | undefined;
    for (const x of arr) { if (x.ts <= ts) out = x.cumul; else break; }
    return out;
  };

  /**
   * 채권·채무를 안 세우는 전표의 잔액 칸 — **그 거래처의 그 시점 잔액**을 적는다.
   *
   * 그 전표 자체는 잔액을 안 흔들지만, 거래처가 붙어 있으면 "이 거래처가 지금 얼마 남았나"는
   * 보여야 읽힌다(자금 행과 같은 규칙). 거래처가 없으면 undefined — 화면에서 —로 뜬다.
   */
  for (const r of rows) {
    if (r.kind !== 'stmt' || arap.get(r.data.id)?.side) continue;
    r.cumul = balanceAt(r.data.partnerId, r.ts);
  }

  // ── 자금 입출금 전표 ── 거래처 채권·채무(108/251)로 나간 부분은 이미 수금/지불 행으로 보였다.
  // 나머지(계정이 붙은 비용·차입금·선수금 등)만 자금 행으로 띄운다.
  for (const e of cashEntries) {
    const parts = (e.lines ?? []).filter(l => l.accountCode && l.amount > 0);
    const arapAmt = e.partnerId
      ? (parts.length
          ? parts.reduce((a, l) => a + (l.accountCode === AR || l.accountCode === AP ? l.amount : 0), 0)
          : (e.accountCode === AR || e.accountCode === AP ? e.amount : 0))
      : 0;
    const rest = e.amount - arapAmt;
    if (rest <= 0.5) continue;            // 전액이 거래처 상계분 → 수금/지불 행으로만
    const ts = `${e.date}T${timeOfLocal(e.createdAt)}`;
    rows.push({
      kind: 'cash', entry: e, dir: e.dir === '대체' ? '출금' : e.dir, amount: rest,
      accountCode: e.accountCode, note: e.note, partnerName: e.partnerName,
      cumul: balanceAt(e.partnerId, ts),
      date: e.date, ts, dateKey: `${e.date}`,
    });
  }

  return rows;
}
