/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { menuPreferenceKey, normalizeMenuPreferences, type MenuPreferences } from '../../../shared/menuPreferences';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'u' } as { uid: string } | null } }));
vi.mock('../../../shared/firebase', () => ({ auth: mocks.auth }));
import { useMenuPreferencesController } from './useMenuPreferencesController';
type Props = Parameters<typeof useMenuPreferencesController>[0];
const groups = [{ id: 'work', label: '업무' }], items = [{ id: 'one', label: '하나', groupId: 'work' }];
const props = (): Props => ({ identity: { uid: 'u', employeeId: 'e', companyId: 'taebaek', admin: true }, companyId: 'taebaek', employeeId: 'e', isAdmin: true, groups, items });
const keyOf = (companyId = 'taebaek', mode: 'admin' | 'staff' = 'admin', uid = 'u') => menuPreferenceKey({ companyId, mode, uid })!;
const hidden = (): MenuPreferences => ({ version: 1, groups: ['work'], items: [{ id: 'one', groupId: 'work', hidden: true }] });
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); mocks.auth.currentUser = { uid: 'u' }; });
it('신원·직원·회사·관리자 모드 일치와 관리자 회사 예외만 기존 키를 만든다', () => {
 const p = props(), view = renderHook((input: Props) => useMenuPreferencesController(input), { initialProps: p }); expect(view.result.current.key).toBe(keyOf());
 view.rerender({ ...p, companyId: 'punghoe' }); expect(view.result.current.key).toBe(keyOf('punghoe'));
 view.rerender({ ...p, companyId: 'punghoe', isAdmin: false }); expect(view.result.current.key).toBe(keyOf('punghoe', 'staff'));
 view.rerender({ ...p, companyId: 'punghoe', isAdmin: false, identity: { ...p.identity!, admin: false } }); expect(view.result.current.key).toBeNull();
 view.rerender({ ...p, identity: { ...p.identity!, admin: false } }); expect(view.result.current.key).toBeNull();
 view.rerender({ ...p, employeeId: 'other' }); expect(view.result.current.key).toBeNull(); view.rerender({ ...p, identity: null }); expect(view.result.current.key).toBeNull();
 mocks.auth.currentUser = { uid: 'other' }; view.rerender(p); expect(view.result.current.key).toBeNull();
});
it('회사 전환 첫 렌더에서 이전 저장값을 숨기고 새 scope 값을 effect로 불러온다', () => {
 localStorage.setItem(keyOf(), JSON.stringify(hidden())); localStorage.setItem(keyOf('punghoe'), JSON.stringify(hidden()));
 const renders: { key: string | null; value: MenuPreferences }[] = [];
 const view = renderHook((p: Props) => { const value = useMenuPreferencesController(p); renders.push({ key: value.key, value: value.value }); return value; }, { initialProps: props() });
 expect(view.result.current.value.items[0].hidden).toBe(true); renders.length = 0;
 view.rerender({ ...props(), companyId: 'punghoe' }); expect(renders[0].key).toBe(keyOf('punghoe')); expect(renders[0].value.items[0].hidden).toBe(false); expect(view.result.current.value.items[0].hidden).toBe(true);
});
it('동일 내용의 새 객체는 다시 읽지 않고 카탈로그 변경은 신규 메뉴를 복구한다', () => {
 const read = vi.spyOn(Storage.prototype, 'getItem'); const p = props(), view = renderHook((input: Props) => useMenuPreferencesController(input), { initialProps: p }); expect(read).toHaveBeenCalledTimes(1);
 view.rerender({ ...p, groups: [...groups], items: items.map(item => ({ ...item })) }); expect(read).toHaveBeenCalledTimes(1);
 view.rerender({ ...p, items: [...items, { id: 'new', label: '신규', groupId: 'work' }] }); expect(read).toHaveBeenCalledTimes(2); expect(view.result.current.value.items.map(row => row.id)).toEqual(['one', 'new']);
});
it('저장 실패에도 현재 화면에 먼저 적용하고 초기화 실패에도 기본값을 적용한다', () => {
 const view = renderHook(() => useMenuPreferencesController(props())); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); });
 act(() => view.result.current.change(hidden())); expect(view.result.current.value.items[0].hidden).toBe(true); expect(view.result.current.error).toContain('현재 화면에는 적용');
 vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw Error('remove'); }); act(() => view.result.current.reset()); expect(view.result.current.value.items[0].hidden).toBe(false); expect(view.result.current.error).toContain('기본 메뉴는 적용');
});
it('현재 UID가 바뀐 뒤 보관된 변경·초기화 콜백은 저장하거나 화면을 바꾸지 않는다', () => {
 const view = renderHook(() => useMenuPreferencesController(props())), write = vi.spyOn(Storage.prototype, 'setItem'), remove = vi.spyOn(Storage.prototype, 'removeItem'); const change = view.result.current.change, reset = view.result.current.reset;
 mocks.auth.currentUser = { uid: 'next' }; act(() => { change(hidden()); reset(); }); expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(view.result.current.value.items[0].hidden).toBe(false);
});
it('정상 저장·초기화와 scope 로드 오류 해제를 유지하며 null 키는 저장소를 읽지 않는다', () => {
 const p = props(), view = renderHook((input: Props) => useMenuPreferencesController(input), { initialProps: p }); act(() => view.result.current.change(hidden())); expect(JSON.parse(localStorage.getItem(keyOf())!).items[0].hidden).toBe(true); act(() => view.result.current.reset()); expect(localStorage.getItem(keyOf())).toBeNull();
 vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); }); act(() => view.result.current.change(hidden())); expect(view.result.current.error).not.toBe(''); view.rerender({ ...p, companyId: 'punghoe' }); expect(view.result.current.error).toBe('');
 const read = vi.spyOn(Storage.prototype, 'getItem'); read.mockClear(); view.rerender({ ...p, identity: null }); expect(read).not.toHaveBeenCalled(); expect(view.result.current.value).toEqual(normalizeMenuPreferences(null, groups, items));
});
