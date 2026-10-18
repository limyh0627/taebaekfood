export interface BomLine<T extends {id:string}={id:string}> {childId:string;qty:number;child?:T}
export interface BomParentLine<T extends {id:string}={id:string}> {parentId:string;qty:number;parent?:T}
export interface BomIndex<T extends {id:string}={id:string}> {of(parentId:string):BomLine<T>[];parentsOf(childId:string):BomParentLine<T>[]}
const push = <T>(m: Map<string, T[]>, k: string, v: T) => {
  const arr = m.get(k);
  if (arr) arr.push(v); else m.set(k, [v]);
};
/** BOM quantity의 숫자 원값만 쓰며 비숫자 legacy는 기존과 같이 1로 본다. */
export function buildBomIndex<T extends {id:string}>(
  items: T[],
  itemBoms: { parent_id: string; child_id: string; quantity?: number }[],
): BomIndex<T> {
  const byId = new Map(items.map(i => [i.id, i]));
  const children = new Map<string, BomLine<T>[]>();
  const parents = new Map<string, BomParentLine<T>[]>();
  for (const b of itemBoms) {
    if (!b?.parent_id || !b?.child_id) continue;
    const qty = typeof b.quantity === 'number' ? b.quantity : 1;
    push(children, b.parent_id, { childId: b.child_id, qty, child: byId.get(b.child_id) });
    push(parents, b.child_id, { parentId: b.parent_id, qty, parent: byId.get(b.parent_id) });
  }
  return {
    of: (parentId) => children.get(parentId) ?? [],
    parentsOf: (childId) => parents.get(childId) ?? [],
  };
}
