export interface MenuGroup { id: string; label: string }
export interface MenuItem { id: string; label: string; groupId: string }
export interface MenuPreferences { version: 1; groups: string[]; items: { id: string; groupId: string; hidden: boolean }[] }
export interface MenuScope { companyId: string; uid: string; mode: 'admin' | 'staff' }
export const menuPreferenceKey = (scope: MenuScope): string | null => scope.uid ? `my-menu:v1:${encodeURIComponent(scope.companyId)}:${encodeURIComponent(scope.uid)}:${scope.mode}` : null;

/** 옛 설정을 현재 실제 메뉴로 제한하고 신규 항목은 기본 그룹 끝에 추가한다. */
export function normalizeMenuPreferences(raw: unknown, groups: readonly MenuGroup[], items: readonly MenuItem[]): MenuPreferences {
  const source = raw && typeof raw === 'object' && (raw as any).version === 1 ? raw as Partial<MenuPreferences> : {};
  const allowedGroups = new Set(groups.map(g => g.id)), allowedItems = new Map(items.map(item => [item.id, item]));
  const order: string[] = [], rows: MenuPreferences['items'] = [], seen = new Set<string>();
  for (const id of Array.isArray(source.groups) ? source.groups : []) if (allowedGroups.has(id) && !order.includes(id)) order.push(id);
  for (const group of groups) if (!order.includes(group.id)) order.push(group.id);
  for (const row of Array.isArray(source.items) ? source.items : []) {
    if (!row || !allowedItems.has(row.id) || !allowedGroups.has(row.groupId) || seen.has(row.id)) continue;
    seen.add(row.id); rows.push({ id: row.id, groupId: row.groupId, hidden: row.hidden === true });
  }
  for (const item of items) if (!seen.has(item.id)) rows.push({ id: item.id, groupId: item.groupId, hidden: false });
  return { version: 1, groups: order, items: rows };
}
export function loadMenuPreferences(key: string | null, groups: readonly MenuGroup[], items: readonly MenuItem[]): MenuPreferences {
  if (!key) return normalizeMenuPreferences(null, groups, items);
  let raw: unknown; try { raw = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { raw = null; }
  return normalizeMenuPreferences(raw, groups, items);
}
export function saveMenuPreferences(key: string | null, value: MenuPreferences): void {
  if (!key) throw Error('로그인 상태를 확인한 뒤 메뉴를 설정하세요.');
  localStorage.setItem(key, JSON.stringify(value));
}
export function resetMenuPreferences(key: string | null): void {
  if (!key) throw Error('로그인 상태를 확인한 뒤 메뉴를 설정하세요.');
  localStorage.removeItem(key);
}
/** 항목 배열의 그룹별 순서를 사용한다. 그룹을 옮긴 항목은 대상 그룹 끝에 둔다. */
export function moveMenuItem(value: MenuPreferences, id: string, targetGroup: string): MenuPreferences {
  const row = value.items.find(item => item.id === id); if (!row || !value.groups.includes(targetGroup) || row.groupId === targetGroup) return value;
  return { ...value, items: [...value.items.filter(item => item.id !== id), { ...row, groupId: targetGroup }] };
}
export function reorderMenuItem(value: MenuPreferences, id: string, delta: -1 | 1): MenuPreferences {
  const rows = [...value.items], index = rows.findIndex(item => item.id === id); if (index < 0) return value;
  const siblings = rows.map((row, i) => row.groupId === rows[index].groupId ? i : -1).filter(i => i >= 0);
  const other = siblings[siblings.indexOf(index) + delta]; if (other === undefined) return value;
  [rows[index], rows[other]] = [rows[other], rows[index]]; return { ...value, items: rows };
}
export function reorderMenuGroup(value: MenuPreferences, id: string, delta: -1 | 1): MenuPreferences {
  const groups = [...value.groups], index = groups.indexOf(id), other = index + delta;
  if (index < 0 || other < 0 || other >= groups.length) return value;
  [groups[index], groups[other]] = [groups[other], groups[index]]; return { ...value, groups };
}
