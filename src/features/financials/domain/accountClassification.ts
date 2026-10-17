import type {AccountCode,AccountGroup} from '../../../shared/types';
import {BANK} from '../../../shared/autoJournal';
import {STANDARD_ACCOUNT} from '../../../shared/accountChart';

/**
 * 손익 계산 순수 도메인 모듈 — 부수효과 없음(입력 → 값). 단위 테스트 용이.
 */

// 계산결과 그룹(집계용) / 구 판매비·관리비 그룹 id
export const COMPUTED_GROUP_IDS = new Set(['ag-gross-profit', 'ag-op-profit']);

export const SGNA_LEGACY_IDS = new Set(['ag-selling', 'ag-admin']);

/**
 * 계정코드(code) → AccountGroup 조회기.
 *
 * **그룹은 있는 그대로 돌려준다.** 예전엔 표시용으로 id를 'ag-sgna'로 갈아끼워 내보냈는데,
 * 설정 화면이 그 id를 그대로 저장하면서 없는 그룹을 가리키는 계정이 생겼다(운임·카드대금).
 * 그런 계정은 plLine을 못 찾아 손익 집계에서 통째로 빠진다.
 */
export function makeCodeToGroup(
  accountCodes: AccountCode[],
  accountGroups: AccountGroup[],
  rawAccountGroups: AccountGroup[],
): (code: string | undefined) => AccountGroup | undefined {
  const codeMap = new Map(accountCodes.map(ac => [ac.code, ac]));
  const groupMap = new Map(accountGroups.map(g => [g.id, g]));
  const sgnaGroup = groupMap.get('ag-sgna') ?? rawAccountGroups.find(g => SGNA_LEGACY_IDS.has(g.id));
  return (code) => {
    if (!code) return undefined;
    const ac = codeMap.get(code);
    if (!ac?.groupId) return undefined;
    // 옛 '판매비'/'관리비'로 갈려 있던 것은 판관비 하나로 본다 — id는 안 바꾼다.
    if (SGNA_LEGACY_IDS.has(ac.groupId)) return groupMap.get(ac.groupId) ?? sgnaGroup;
    return groupMap.get(ac.groupId);
  };
}

/**
 * 현금성 계정인가 — 통장·현금. **대체전표에서 막아야 할 유일한 것**이다.
 * 돈이 실제로 오갔으면 자금원장으로 가야 통장 잔액이 맞는다.
 */
export function isCashAccountCode(code: string | undefined, accountCodes: AccountCode[] = []): boolean {
  if (!code) return false;
  if (code === STANDARD_ACCOUNT.CASH || code === BANK) return true;
  return /현금|보통예금|당좌예금|제예금/.test(accountCodes.find(a => a.code === code)?.name ?? '');
}

/**
 * 전표 문맥에 맞는 계정과목만 추린다 — 매출전표에 '단기차입금'이 뜨는 걸 막는다.
 * 계정과목 마스터는 하나로 두되, 고르는 자리에서 성격으로 거른다.
 *
 *  매출: 수익
 *  매입: 비용 — 손익 나는 것만. 기계·차량 같은 자산 취득은 손익이 아니라 투자이므로
 *        자금원장에서 끊는다(손익에 닿는 건 그 자산의 감가상각뿐이다).
 *  자금: 전부 (돈이 나가는 이유는 비용·자산·부채 뭐든 될 수 있다)
 *  대체: **통장·현금만 뺀다.**
 *
 * 전에는 대체를 `noncash` 계정(감가상각·퇴직충당)만으로 좁혔다. 49개 중 4개만 남아
 * **급여도 이자도 못 골랐다** — 거래처 없이 발생만 세우는 전표가 원래 그 둘인데.
 *   (차) 515 급여   / (대) 254 예수금
 *   (차) 951 이자비용 / (대) 262 미지급비용
 * 대체는 '차·대를 직접 세우는' 전표라 상대변 계정(부채·자산)도 필요하다. 막아야 할 건
 * 하나뿐이다 — **현금이 오간 것을 대체로 적는 것.** 그건 통장 잔액과 어긋나므로 자금원장으로 간다.
 *
 * 그룹이 없는 계정은 감추지 않고 통과시킨다 — 숨겨버리면 기존 전표를 고칠 수도 없다.
 */
export function filterCodesForContext(
  codes: AccountCode[],
  groups: AccountGroup[],
  context: '매출' | '매입' | '자금' | '대체',
): AccountCode[] {
  // 계정번호(code) 오름차순 정렬 — 전표 발행 등 드롭다운에서 계정번호대로 보이게
  const byCode = (list: AccountCode[]) => [...list].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  if (context === '자금') return byCode(codes);
  if (context === '대체') return byCode(codes.filter(c => !isCashAccountCode(c.code, codes)));
  const allow: AccountGroup['type'][] = context === '매출' ? ['수익'] : ['비용'];
  const groupType = new Map(groups.map(g => [g.id, g.type]));
  return byCode(codes.filter(c => {
    if (!c.groupId) return true;                 // 그룹 미지정 — 거르지 않고 노출
    const t = groupType.get(c.groupId);
    return !t || allow.includes(t);
  }));
}
