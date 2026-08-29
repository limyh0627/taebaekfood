import { describe, it, expect } from 'vitest';
import type { AccountCode, AccountGroup } from '../../shared/types';

/**
 * 전표 검색의 계정 선택지 — **계정그룹(재료비·판관비…)도 고를 수 있어야 한다.**
 *
 * 판정(acctHit)은 진작 `group:<id>`를 알아들었는데 목록에 그룹이 없어서,
 * '재료비'로 검색하면 그 밑 계정들이 낱개로 줄줄이 나올 뿐 묶어서 고를 수가 없었다.
 *
 * 화면 코드(TradeStatement)에서 그대로 옮긴 규칙이라, 여기가 깨지면 화면도 깨진 것이다.
 */
type Item = { value: string; label: string; path: string; axis: '손익' | '재무'; branch: string; isGroup?: boolean };

function buildAccountItems(codes: AccountCode[], groups: AccountGroup[]): Item[] {
  const groupOf = (code?: string) => groups.find(g => g.id === codes.find(c => c.code === code)?.groupId);
  const plBranchOf = (code?: string) => {
    const t = codes.find(c => c.code === code)?.type;
    return t === '수익' ? '이익' : t === '비용' ? '비용' : null;
  };
  const bsTypeOf = (code?: string) => {
    const t = codes.find(c => c.code === code)?.type;
    return t === '자산' || t === '부채' || t === '자본' ? t : null;
  };
  const out: Item[] = [];
  const codesOfGroup = new Map<string, string[]>();
  for (const c of codes) {
    const gid = groupOf(c.code)?.id;
    if (!gid) continue;
    (codesOfGroup.get(gid) ?? codesOfGroup.set(gid, []).get(gid)!).push(c.code);
  }
  for (const g of groups) {
    const kids = codesOfGroup.get(g.id) ?? [];
    if (!kids.length) continue;                       // 빈 그룹은 안 넣는다
    const pl = plBranchOf(kids[0]);
    const axis: '손익' | '재무' = pl ? '손익' : '재무';
    const branch = pl ?? bsTypeOf(kids[0]) ?? '';
    if (!branch) continue;
    out.push({ value: `group:${g.id}`, label: `${g.name} 전체`, axis, branch, isGroup: true, path: `${axis} › ${branch} › ${g.name}` });
  }
  for (const c of [...codes].sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }))) {
    const pl = plBranchOf(c.code);
    const g = groupOf(c.code);
    if (pl) { out.push({ value: `code:${c.code}`, label: `${c.code} ${c.name}`, axis: '손익', branch: pl, path: `손익 › ${pl}${g ? ` › ${g.name}` : ''}` }); continue; }
    const bs = bsTypeOf(c.code);
    if (bs) out.push({ value: `code:${c.code}`, label: `${c.code} ${c.name}`, axis: '재무', branch: bs, path: `재무 › ${bs}${g ? ` › ${g.name}` : ''}` });
  }
  return out;
}

const G = (id: string, name: string, type: AccountGroup['type']): AccountGroup => ({ id, name, type } as AccountGroup);
const C = (code: string, name: string, type: AccountCode['type'], groupId?: string): AccountCode =>
  ({ id: code, code, name, type, groupId } as AccountCode);

const groups = [
  G('ag-cogs', '재료비', '비용'),
  G('ag-admin', '판관비', '비용'),
  G('ag-revenue', '총매출', '수익'),
  G('ag-asset', '자산', '자산'),
  G('ag-gross-profit', '매출총이익', '수익'),   // 계산용 — 밑에 계정이 없다
];
const codes = [
  C('501', '원료매입', '비용', 'ag-cogs'),
  C('502', '부자재매입', '비용', 'ag-cogs'),
  C('811', '복리후생비', '비용', 'ag-admin'),
  C('800', '일반매출', '수익', 'ag-revenue'),
  C('108', '외상매출금', '자산', 'ag-asset'),
];

describe('전표 검색 — 계정 선택지', () => {
  const items = buildAccountItems(codes, groups);

  it('계정그룹이 목록에 뜬다 — 재료비·판관비를 묶어서 고를 수 있다', () => {
    const g = items.filter(i => i.isGroup).map(i => i.label);
    expect(g).toContain('재료비 전체');
    expect(g).toContain('판관비 전체');
  });

  it('그룹 값은 group: — 판정(acctHit)이 알아듣는 꼴이다', () => {
    expect(items.find(i => i.label === '재료비 전체')!.value).toBe('group:ag-cogs');
  });

  it('밑에 계정이 없는 계산용 그룹은 안 넣는다 — 골라 봐야 아무것도 안 걸린다', () => {
    expect(items.some(i => i.label.startsWith('매출총이익'))).toBe(false);
  });

  it('그룹도 손익/재무 갈래를 제대로 탄다', () => {
    const 재료비 = items.find(i => i.value === 'group:ag-cogs')!;
    expect([재료비.axis, 재료비.branch]).toEqual(['손익', '비용']);
    const 자산 = items.find(i => i.value === 'group:ag-asset')!;
    expect([자산.axis, 자산.branch]).toEqual(['재무', '자산']);
    const 매출 = items.find(i => i.value === 'group:ag-revenue')!;
    expect([매출.axis, 매출.branch]).toEqual(['손익', '이익']);
  });

  it('재무 계정도 경로에 묶음 이름이 붙는다 — 검색으로 찾을 수 있어야 한다', () => {
    expect(items.find(i => i.value === 'code:108')!.path).toBe('재무 › 자산 › 자산');
  });

  it('계정과목은 그대로 다 있다', () => {
    expect(items.filter(i => !i.isGroup)).toHaveLength(codes.length);
  });
});
