import { useEffect, useState } from 'react';
import { auth } from '../../../shared/firebase';
import type { useMenuIdentity } from './useMenuIdentity';
import { menuPreferenceKey, normalizeMenuPreferences, loadMenuPreferences, saveMenuPreferences, resetMenuPreferences, type MenuPreferences, type MenuGroup, type MenuItem } from '../../../shared/menuPreferences';

export function useMenuPreferencesController({identity:menuIdentity, companyId, employeeId, isAdmin, groups:menuGroups, items:menuCatalog}: {identity:ReturnType<typeof useMenuIdentity>;companyId:string;employeeId:string;isAdmin:boolean;groups:MenuGroup[];items:MenuItem[]}) {
  const [menuSaved, setMenuSaved] = useState<{key:string|null;value:MenuPreferences}|null>(null);
  const [menuError, setMenuError] = useState('');
  const menuKey = menuIdentity && menuIdentity.uid === auth.currentUser?.uid && menuIdentity.employeeId === employeeId && (menuIdentity.companyId === companyId || menuIdentity.admin) && (!isAdmin || menuIdentity.admin) ? menuPreferenceKey({companyId,uid:menuIdentity.uid,mode:isAdmin?'admin':'staff'}) : null;
  const menuDefaults = normalizeMenuPreferences(null,menuGroups,menuCatalog);
  const menuValue = normalizeMenuPreferences(menuSaved?.key === menuKey && menuKey ? menuSaved.value : null,menuGroups,menuCatalog);
  const menuCatalogSignature = JSON.stringify({groups:menuGroups,items:menuCatalog});
  useEffect(() => { setMenuSaved({key:menuKey,value:loadMenuPreferences(menuKey,menuGroups,menuCatalog)});setMenuError(''); },[menuKey,menuCatalogSignature]);
  const changeMenu = (next: MenuPreferences) => {
    if(!menuKey || menuIdentity?.uid !== auth.currentUser?.uid) return;
    const value=normalizeMenuPreferences(next,menuGroups,menuCatalog);setMenuSaved({key:menuKey,value});
    try{saveMenuPreferences(menuKey,value);setMenuError('');}catch{setMenuError('이 브라우저에 메뉴 설정을 저장하지 못했습니다. 현재 화면에는 적용했지만 다시 열면 유지되지 않을 수 있습니다.');}
  };
  const resetMenu = () => {
    if(!menuKey || menuIdentity?.uid !== auth.currentUser?.uid)return;
    setMenuSaved({key:menuKey,value:menuDefaults});
    try{resetMenuPreferences(menuKey);setMenuError('');}catch{setMenuError('기본 메뉴는 적용했지만 저장된 설정을 삭제하지 못했습니다. 다시 시도해 주세요.');}
  };
  return {key:menuKey,value:menuValue,error:menuError,change:changeMenu,reset:resetMenu};
}
