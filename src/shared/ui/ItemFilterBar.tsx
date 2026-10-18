import React from 'react';
import { typeOptions, categoryOptions, keepCategory, ALL, type ItemLike } from '../itemFilter';
import SearchableSelect from '../components/SearchableSelect';
import { QUERY_FILTER_LABEL_CLASS, QUERY_FILTER_CONTROL_CLASS } from '../components/QueryFilterPanel';

/**
 * **품목 거르개 — 분류(타입) · 품목(카테고리) 드롭다운.**
 *
 * 화면마다 따로 만들고 있었다(2026-09-06 사장님: "제품별 원장은 또 필터 새로 만들어서
 * 달아뒀잖아 걔도 합쳐"). 제품별 원장은 `<select>` 두 개, 재고관리는 알약 드롭다운,
 * 견적서 품목 고르기는 아예 없어서 300품목을 검색으로만 찾아야 했다.
 *
 * **드롭다운이다** — 알약으로 늘어놓으면 카테고리가 14칸이라 폰에서 필터가 화면을
 * 다 잡아먹는다(2026-09-04 사장님). 모양은 `shared/ui/table` 의 SELECT 를 쓴다.
 *
 * 타입을 바꾸면 그 타입에 없는 카테고리는 저절로 풀린다(`keepCategory`).
 */
export const ItemFilterBar: React.FC<{
  items: readonly ItemLike[];
  type: string;
  setType: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  /** 한 줄로 나란히 놓을까(넓은 자리). 기본은 위아래로 쌓는다(좁은 창). */
  가로?: boolean;
}> = ({ items, type, setType, category, setCategory, 가로 = false }) => {
  const types = React.useMemo(() => typeOptions(items), [items]);
  const cats = React.useMemo(() => categoryOptions(items, type), [items, type]);

  const 타입고르기 = (v: string) => {
    setType(v);
    setCategory(keepCategory(items, v, category));   // 그 타입에 없는 품목이면 푼다
  };

  return <div className={가로 ? 'flex min-w-0 flex-wrap items-end gap-2' : 'w-full space-y-2'}>
    <label className={QUERY_FILTER_LABEL_CLASS + ' min-w-0 flex-1'}>분류
      <SearchableSelect ariaLabel="분류" value={type} onChange={타입고르기} className={QUERY_FILTER_CONTROL_CLASS + ' w-full'} options={[{value:ALL,label:'전체 '+items.length},...types.map(o=>({value:o.key,label:o.label+' '+o.count}))]}/>
    </label>
    {cats.length > 1 && <label className={QUERY_FILTER_LABEL_CLASS + ' min-w-0 flex-1'}>품목
      <SearchableSelect ariaLabel="품목" value={category} onChange={setCategory} className={QUERY_FILTER_CONTROL_CLASS + ' w-full'} options={[{value:ALL,label:'전체'},...cats.map(o=>({value:o.key,label:o.label+' '+o.count}))]}/>
    </label>}
  </div>;
};
export default ItemFilterBar;
