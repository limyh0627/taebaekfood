import type {AccountCode,AccountGroup,JournalEntry} from '../../shared/types';

/** 회사별 조회 입력의 계정·그룹 손익을 기존 차대 부호와 기간 정책 그대로 집계한다. */
export function buildProfitAccountProjection({journalEntries,accountCodes,codeToGroup,periodMonths}:{
 journalEntries:JournalEntry[];accountCodes:AccountCode[];
 codeToGroup:(code:string)=>AccountGroup|undefined;periodMonths:string[];
}) {
    const ymSet = new Set(periodMonths);
    /*
     * **손익 계정을 전부 먼저 0으로 깔아 둔다.**
     *
     * 분개에 나온 계정만 세면, 그 기간에 안 움직인 계정은 줄 자체가 사라진다.
     * 그러면 "이자비용이 빠진 건가, 0인 건가"를 화면에서 가릴 수 없다 — 실제로
     * 기간이 통째로 잘려 전부 0이 됐을 때 계정이 사라진 것처럼 보였다.
     * 0으로라도 서 있으면 '이 기간엔 없다'가 눈에 보인다.
     */
    const tally = new Map<string, number>();
    for (const a of accountCodes) {
      if (a.type === '비용' || a.type === '수익') tally.set(String(a.code), 0);
    }
    for (const e of journalEntries) {
      if (!ymSet.has((e.date ?? '').slice(0, 7))) continue;
      for (const l of e.lines ?? []) {
        const acc = accountCodes.find(a => String(a.code) === String(l.accountCode));
        if (acc?.type !== '비용' && acc?.type !== '수익') continue;
        const normal = acc.normalBalance ?? (acc.type === '수익' ? 'credit' : 'debit');
        const amt = normal === 'debit' ? (l.debit ?? 0) - (l.credit ?? 0) : (l.credit ?? 0) - (l.debit ?? 0);
        if (!amt) continue;
        tally.set(String(l.accountCode), (tally.get(String(l.accountCode)) ?? 0) + amt);
      }
    }
    const plByCode = [...tally.entries()]
      .map(([code, amount]) => {
        const acc = accountCodes.find(a => String(a.code) === String(code));
        const g = codeToGroup(code);
        return { code, name: acc?.name ?? code, amount, plLine: g?.plLine, groupId: g?.id, groupName: g?.name };
      })
      .sort((a, b) => b.amount - a.amount);   // 0인 줄은 자연히 아래로 모인다

    const m = new Map<string, { name: string; plLine?: string; amount: number; rows: typeof plByCode }>();
    for (const r of plByCode) {
      const key = r.groupId ?? '(그룹없음)';
      const cur = m.get(key) ?? { name: r.groupName ?? '그룹 없음', plLine: r.plLine, amount: 0, rows: [] };
      cur.amount += r.amount;
      cur.rows.push(r);
      m.set(key, cur);
    }
    const plByGroup = [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.amount - a.amount);

 return {plByCode,plByGroup};
}
