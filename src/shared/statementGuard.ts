import type { IssuedStatement } from './types';

/**
 * **전표가 차·대를 채울 수 있나** — 못 채우면 아예 만들지 않는다.
 *
 * 품목에 계정이 안 붙으면 `journalizeStatement`가 대변을 못 채워 분개를 통째로 안 만든다.
 * 그러면 그 전표는 **시산표에서 사라지고**, 채권·채무 판정에도 안 잡혀 수금/지불 버튼까지 없어진다.
 * 차·대가 안 맞는 전표는 장부에 있으면 안 된다 — 고치는 게 아니라 **만들지 못하게** 막는다.
 *
 * 양변 전표(기초이월·감가상각)는 줄마다 `side`를 직접 세우므로 그것도 있어야 한다.
 * 없으면 autoJournal이 짐작하지 않고 분개를 안 만든다(미광팩 기초 미지급이 그렇게 비어 있었다).
 */
export function statementBlockReason(s: Partial<IssuedStatement>): string | null {
  const items = s.items ?? [];
  if (items.length === 0) return '품목이 없습니다. 전표에는 최소 한 줄이 있어야 합니다.';
  const noCode = items.filter(i => !i.accountCode);
  if (noCode.length) {
    return `계정과목이 없는 줄이 ${noCode.length}건 있습니다 (${noCode.slice(0, 3).map(i => i.name || '이름없음').join(', ')}). `
      + '계정이 없으면 대변을 못 채워 분개가 안 서고, 그 전표는 시산표에서 사라집니다.';
  }
  /**
   * 차·대 균형은 **양변 전표에만** 따진다.
   *
   * 매출·매입 전표는 줄에 한쪽(매출계정·매입계정)만 적고 **상대변(108·251)은
   * journalizeStatement가 세운다.** 그걸 모르고 줄만 세면 "대변 0원"이라며 멀쩡한
   * 매입전표를 막는다 — 전기세 1,233,780원 한 줄짜리가 그렇게 막혔다.
   *
   * 양변 전표(기초이월·감가상각)만 줄에 차·대를 직접 세우고, 그건 스스로 맞아야 한다.
   */
  if (s.type !== '매출' && s.type !== '매입') {
    const sided = items.filter(i => i.side);
    if (sided.length > 0 && sided.length !== items.length) {
      return `차변·대변을 적은 줄과 안 적은 줄이 섞여 있습니다 (${sided.length}/${items.length}). `
        + '양변 전표는 모든 줄에 차변·대변이 있어야 분개가 섭니다.';
    }
    if (sided.length > 0) {
      const debit = items.filter(i => i.side === '차변').reduce((a, i) => a + (i.total ?? 0), 0);
      const credit = items.filter(i => i.side === '대변').reduce((a, i) => a + (i.total ?? 0), 0);
      if (Math.round(debit) !== Math.round(credit)) {
        return `차변 ${Math.round(debit).toLocaleString()}원과 대변 ${Math.round(credit).toLocaleString()}원이 안 맞습니다.`;
      }
    }
  }
  return null;
}
