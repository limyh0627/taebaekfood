import type { IssuedStatement } from './types';
import { journalizeStatement } from './autoJournal';

/**
 * **이 전표로 분개가 서나 — 분개를 실제로 세워 보고 판단한다.**
 *
 * 품목 줄만 세면 안 된다. 매출·매입 전표는 줄에 **한쪽만** 적고 상대변(108 외상매출금 ·
 * 251 외상매입금)은 journalizeStatement가 세운다. 그걸 모르고 줄만 더하면
 * "차변 1,233,780원 / 대변 0원"이라며 멀쩡한 전기세 매입전표를 막는다 —
 * 화면 미리보기엔 (차)520 / (대)251로 제대로 서 있는데도.
 *
 * 그러니 갈래를 따지지 않는다. **분개를 세워서 차·대가 맞는지 본다.**
 * 분개가 안 서는 전표(기초이월처럼 줄에 side를 직접 적은 양변 전표)만 줄에서 읽는다.
 *
 * 차·대가 안 맞는 전표는 장부에 있으면 안 된다 — 시산표가 무너진다. 고치는 게 아니라
 * **만들지 못하게** 막는다.
 */
const r = (n: number) => Math.round(n * 100) / 100;

export function statementBlockReason(s: Partial<IssuedStatement>): string | null {
  const items = s.items ?? [];
  if (items.length === 0) return '품목이 없습니다. 전표에는 최소 한 줄이 있어야 합니다.';

  const noCode = items.filter(i => !i.accountCode);
  if (noCode.length) {
    return `계정과목이 없는 줄이 ${noCode.length}건 있습니다 (${noCode.slice(0, 3).map(i => i.name || '이름없음').join(', ')}). `
      + '계정이 없으면 대변을 못 채워 분개가 안 서고, 그 전표는 시산표에서 사라집니다.';
  }

  //  ① 분개가 서면 통과 — journalizeStatement는 차·대가 맞을 때만 내보낸다(안 맞으면 null).
  if (journalizeStatement(s as IssuedStatement)) return null;

  /**
   * ② 분개가 안 섰다. 갈래를 보고 왜 안 섰는지 갈라 말한다.
   *   · 매출·매입인데 안 섰다 = **품목 합계와 전표 합계가 다르다**(그 외 이유는 위에서 걸렀다).
   *     채권/채무 줄은 전표 머리(totalAmount)에서, 손익 줄은 품목(supply)에서 오므로 어긋날 수 있다.
   *   · 그 밖의 갈래 = 줄에 차·대를 직접 세우는 양변 전표. 줄끼리 스스로 맞아야 한다.
   */
  if (s.type === '매출' || s.type === '매입') {
    const itemSum = r(items.reduce((a, i) => a + (i.total ?? 0), 0));
    const head = r(Number(s.totalAmount ?? 0));
    return `품목 합계 ${Math.round(itemSum).toLocaleString()}원과 전표 합계 ${Math.round(head).toLocaleString()}원이 다릅니다. `
      + '채권·채무는 전표 합계로, 매출·매입 계정은 품목 합계로 서기 때문에 이대로면 시산표가 틀어집니다.';
  }

  const sided = items.filter(i => i.side);
  if (sided.length === 0) {
    return '차변·대변이 안 적혀 있습니다. 이 갈래의 전표는 줄마다 차변·대변을 세워야 분개가 섭니다.';
  }
  if (sided.length !== items.length) {
    return `차변·대변을 적은 줄과 안 적은 줄이 섞여 있습니다 (${sided.length}/${items.length}). `
      + '양변 전표는 모든 줄에 차변·대변이 있어야 분개가 섭니다.';
  }
  const debit = r(items.filter(i => i.side === '차변').reduce((a, i) => a + (i.total ?? 0), 0));
  const credit = r(items.filter(i => i.side === '대변').reduce((a, i) => a + (i.total ?? 0), 0));
  if (debit !== credit) {
    return `차변 ${Math.round(debit).toLocaleString()}원과 대변 ${Math.round(credit).toLocaleString()}원이 안 맞습니다.`;
  }
  return null;
}
