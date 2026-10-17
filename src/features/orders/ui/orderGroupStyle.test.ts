import { expect, it } from 'vitest';
import { 그룹색, 그룹색표 } from './orderGroupStyle';
it('다섯 색 원문과 여섯번째부터의 순환 순서를 유지한다',()=>{
 expect(그룹색표).toEqual([
 {칩:'border-violet-400 bg-violet-50 text-violet-700',줄:'bg-violet-50',번호:'bg-violet-600 border-violet-600',글자:'text-violet-500'},
 {칩:'border-amber-400 bg-amber-50 text-amber-700',줄:'bg-amber-50',번호:'bg-amber-500 border-amber-500',글자:'text-amber-600'},
 {칩:'border-emerald-400 bg-emerald-50 text-emerald-700',줄:'bg-emerald-50',번호:'bg-emerald-600 border-emerald-600',글자:'text-emerald-600'},
 {칩:'border-sky-400 bg-sky-50 text-sky-700',줄:'bg-sky-50',번호:'bg-sky-600 border-sky-600',글자:'text-sky-600'},
 {칩:'border-rose-400 bg-rose-50 text-rose-700',줄:'bg-rose-50',번호:'bg-rose-600 border-rose-600',글자:'text-rose-600'}]);
 const groups=Object.freeze(['가','나','다','라','마','바','사']);expect(groups.map(n=>그룹색(groups,n))).toEqual([...그룹색표,그룹색표[0],그룹색표[1]]);
});
it('모르는 이름·빈 이름·빈 그룹은 첫 색이고 중복 이름은 첫 위치를 따른다',()=>{
 const groups=Object.freeze(['가','중복','나','중복']);const before=[...groups];for(const name of [undefined,'','없음'])expect(그룹색(groups,name)).toBe(그룹색표[0]);expect(그룹색([], '가')).toBe(그룹색표[0]);expect(그룹색(groups,'중복')).toBe(그룹색표[1]);expect(groups).toEqual(before);
});
