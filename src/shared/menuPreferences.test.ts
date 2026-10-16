/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import { menuPreferenceKey, normalizeMenuPreferences, loadMenuPreferences, saveMenuPreferences, resetMenuPreferences, moveMenuItem, reorderMenuItem, reorderMenuGroup } from './menuPreferences';
const groups=[{id:'a',label:'첫 그룹'},{id:'b',label:'둘째 그룹'}],items=[{id:'one',label:'하나',groupId:'a'},{id:'two',label:'둘',groupId:'a'},{id:'new',label:'신규',groupId:'b'}];
beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
it('허용된 ID만 첫 유효 항목으로 보존하고 신규 메뉴·그룹을 추가한다',()=>{
 const value=normalizeMenuPreferences({version:1,groups:['b','b','foreign'],items:[{id:'one',groupId:'b',hidden:true},{id:'one',groupId:'a'},{id:'two',groupId:'bad'},{id:'admin-only',groupId:'a'}]},groups,items);
 expect(value).toEqual({version:1,groups:['b','a'],items:[{id:'one',groupId:'b',hidden:true},{id:'two',groupId:'a',hidden:false},{id:'new',groupId:'b',hidden:false}]});
 expect(normalizeMenuPreferences({version:99},groups,items).items.map(r=>r.id)).toEqual(['one','two','new']);
});
it('그룹 이동은 숨김을 유지하며 목적 그룹 끝에 두고 항목·그룹 순서를 바꾼다',()=>{
 let value=normalizeMenuPreferences(null,groups,items);value.items[0].hidden=true;
 value=moveMenuItem(value,'one','b');expect(value.items.filter(r=>r.groupId==='b').map(r=>r.id)).toEqual(['new','one']);expect(value.items.find(r=>r.id==='one')?.hidden).toBe(true);
 value=reorderMenuItem(value,'one',-1);expect(value.items.filter(r=>r.groupId==='b').map(r=>r.id)).toEqual(['one','new']);
 expect(reorderMenuGroup(value,'b',-1).groups).toEqual(['b','a']);expect(moveMenuItem(value,'one','bad')).toBe(value);
});
it('회사·실제 UID·화면별 저장을 분리하며 UID 없이는 기존 설정을 읽거나 저장하지 않는다',()=>{
 const keys=[menuPreferenceKey({companyId:'taebaek',uid:'a',mode:'admin'}),menuPreferenceKey({companyId:'punghoe',uid:'a',mode:'admin'}),menuPreferenceKey({companyId:'taebaek',uid:'b',mode:'admin'}),menuPreferenceKey({companyId:'taebaek',uid:'a',mode:'staff'})];expect(new Set(keys).size).toBe(4);
 const value=normalizeMenuPreferences(null,groups,items);value.items[0].hidden=true;saveMenuPreferences(keys[0],value);
 expect(loadMenuPreferences(keys[0],groups,items).items[0].hidden).toBe(true);expect(loadMenuPreferences(keys[1],groups,items).items[0].hidden).toBe(false);
 const read=vi.spyOn(Storage.prototype,'getItem');expect(menuPreferenceKey({companyId:'taebaek',uid:'',mode:'admin'})).toBeNull();loadMenuPreferences(null,groups,items);expect(read).not.toHaveBeenCalled();expect(()=>saveMenuPreferences(null,value)).toThrow();resetMenuPreferences(keys[0]);expect(loadMenuPreferences(keys[0],groups,items).items[0].hidden).toBe(false);
});
it('손상 JSON은 기본값으로 읽고 저장 실패는 호출자에게 전달한다',()=>{
 localStorage.setItem('bad','{');expect(loadMenuPreferences('bad',groups,items)).toEqual(normalizeMenuPreferences(null,groups,items));
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('저장 불가');});expect(()=>saveMenuPreferences('bad',normalizeMenuPreferences(null,groups,items))).toThrow('저장 불가');
});
