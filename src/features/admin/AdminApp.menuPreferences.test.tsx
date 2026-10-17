/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
import {menuPreferenceKey,normalizeMenuPreferences} from '../../shared/menuPreferences';
const source=readFileSync('src/features/admin/AdminApp.tsx','utf8');
const parsed=ts.createSourceFile('AdminApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function initializer(name:string){let text='';const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(parsed)===name&&node.initializer)text=node.initializer.getText(parsed);ts.forEachChild(node,visit);};visit(parsed);if(!text)throw Error('실제 초기화 식 없음: '+name);return text;}
function evaluate(text:string,values:Record<string,unknown>){const js=ts.transpileModule('const result='+text,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(values),js+';return result;')(...Object.values(values));}
function catalog(admin:boolean){
 const nav=vi.fn(),ledger=vi.fn(),qr=vi.fn(),portal=vi.fn();
 const values:Record<string,unknown>={React,NavItem:({label,onClick,badge}:any)=><button onClick={onClick}>{label}{badge?` ${badge}`:''}</button>,isAdmin:admin,currentView:'ledger-cash',ledgerTab:'partner',isSidebarCollapsed:false,handleNavClick:nav,setLedgerTab:ledger,setShowQrLabel:qr,openPartnerPortal:portal,viewAllowed:()=>true,chatRooms:[],currentUser:{id:'e'},adminPendingCount:7,lowStockCount:2,returnRequests:[],receivedOrders:[],pendingSignupCount:3};
 for(const match of initializer('menuEntries').matchAll(/icon=\{(\w+)\}/g))values[match[1]]=()=>null;
 for(const icon of ['Globe','ExternalLink'])values[icon]=()=>null;
 return {entries:evaluate(initializer('menuEntries'),values) as {id:string;label:string;groupId:string;element:React.ReactElement<any>}[],groups:evaluate(initializer('menuGroups'),values),nav,ledger,qr,portal};
}
it('실제 관리자·직원 목록을 기준으로 독립 ID와 기존 동작·배지를 보존한다',()=>{
 const c=catalog(true);expect(c.entries).toHaveLength(29);expect(new Set(c.entries.map(r=>r.id)).size).toBe(29);
 c.entries.find(r=>r.id==='ledger-partner')!.element.props.onClick();expect(c.ledger).toHaveBeenCalledWith('partner');expect(c.nav).toHaveBeenCalledWith('ledger-cash');
 c.entries.find(r=>r.id==='ledger-cash')!.element.props.onClick();expect(c.ledger).toHaveBeenCalledWith('cash');
 c.entries.find(r=>r.id==='qr-label')!.element.props.onClick();expect(c.qr).toHaveBeenCalledWith(true);
 c.entries.find(r=>r.id==='partner-portal')!.element.props.onClick();expect(c.portal).toHaveBeenCalled();
 expect(c.entries.find(r=>r.id==='admin-checklist')!.element.props.badge).toBe(7);
 const staff=catalog(false);expect(staff.entries).toHaveLength(12);expect(staff.entries.some(r=>r.id==='hr'||r.id==='trade-statement')).toBe(false);
 expect(normalizeMenuPreferences({version:1,items:[{id:'hr',groupId:'staff-work'}]},staff.groups,staff.entries).items.some(r=>r.id==='hr')).toBe(false);
});
it('회사·UID·직원 prop 일치 전에는 현재 메뉴 키를 만들지 않고 기본 목록만 사용한다',()=>{
 const values={menuIdentity:{uid:'u',employeeId:'e',companyId:'taebaek',admin:true},auth:{currentUser:{uid:'u'}},currentUser:{id:'e'},companyId:'taebaek',isAdmin:true,menuPreferenceKey};
 expect(evaluate(initializer('menuKey'),values)).toBe(menuPreferenceKey({companyId:'taebaek',uid:'u',mode:'admin'}));
 expect(evaluate(initializer('menuKey'),{...values,auth:{currentUser:{uid:'new'}}})).toBeNull();
 expect(evaluate(initializer('menuKey'),{...values,currentUser:{id:'previous'}})).toBeNull();
 expect(evaluate(initializer('menuKey'),{...values,companyId:'punghoe'})).toBe(menuPreferenceKey({companyId:'punghoe',uid:'u',mode:'admin'}));
 expect(evaluate(initializer('menuKey'),{...values,isAdmin:false,companyId:'punghoe'})).toBe(menuPreferenceKey({companyId:'punghoe',uid:'u',mode:'staff'}));
 expect(evaluate(initializer('menuKey'),{...values,isAdmin:false,companyId:'punghoe',menuIdentity:{...values.menuIdentity,admin:false}})).toBeNull();
 expect(evaluate(initializer('menuKey'),{...values,menuIdentity:null})).toBeNull();
 const c=catalog(true),old=normalizeMenuPreferences(null,c.groups,c.entries);old.items[0].hidden=true;
 expect(evaluate(initializer('menuValue'),{menuSaved:{key:'old',value:old},menuKey:'new',normalizeMenuPreferences,menuGroups:c.groups,menuCatalog:c.entries}).items[0].hidden).toBe(false);
});
it('계정 메뉴는 설정 목록 밖에 고정하고 빈 그룹만 사이드바에서 숨긴다',()=>{
 expect(source).toContain('<AccountMenu currentUser={currentUser}');expect(initializer('menuEntries')).not.toContain('AccountMenu');
 expect(source).toContain('if(!rows.length)return null;');expect(source).toContain('onReset:resetMenu');
});
it('현재 메뉴 변경은 저장 실패에도 화면에 적용하고 계정 변경 뒤에는 쓰지 않는다',()=>{
 const c=catalog(true),value=normalizeMenuPreferences(null,c.groups,c.entries);value.items[0].hidden=true;
 const saved=vi.fn(),error=vi.fn(),write=vi.fn(()=>{throw Error('용량 부족');});
 const auth={currentUser:{uid:'u'}};
 const change=evaluate(initializer('changeMenu'),{menuKey:'key',menuIdentity:{uid:'u'},auth,normalizeMenuPreferences,menuGroups:c.groups,menuCatalog:c.entries,setMenuSaved:saved,saveMenuPreferences:write,setMenuError:error});
 change(value);expect(saved).toHaveBeenCalledWith({key:'key',value});expect(error).toHaveBeenCalledWith(expect.stringContaining('현재 화면에는 적용'));
 auth.currentUser.uid='other';change(value);expect(write).toHaveBeenCalledOnce();
});
it('실제 사이드바 식은 사용자 순서·숨김을 적용하고 빈 그룹은 그리지 않는다',()=>{
 const c=catalog(true),menuValue=normalizeMenuPreferences(null,c.groups,c.entries);
 menuValue.items=menuValue.items.map(row=>({...row,hidden:!['ledger-partner','ledger-cash'].includes(row.id)}));
 const first=menuValue.items.findIndex(row=>row.id==='ledger-cash'),second=menuValue.items.findIndex(row=>row.id==='ledger-partner');
 [menuValue.items[first],menuValue.items[second]]=[menuValue.items[second],menuValue.items[first]];
 let expression='';const visit=(node:ts.Node)=>{if(ts.isJsxExpression(node)&&node.expression?.getText(parsed).startsWith('menuValue.groups.map'))expression=node.expression.getText(parsed);ts.forEachChild(node,visit);};visit(parsed);if(!expression)throw Error('실제 메뉴 렌더 식 없음');
 render(<>{evaluate(expression,{React,menuValue,menuGroups:c.groups,menuEntries:c.entries,isSidebarCollapsed:false,NavGroup:({title,children}:any)=><section aria-label={title}>{children}</section>})}</>);
 expect(screen.getAllByRole('region')).toHaveLength(1);expect(screen.getAllByRole('button').map(button=>button.textContent)).toEqual(['거래처원장','현금출납장']);
 fireEvent.click(screen.getByRole('button',{name:'거래처원장'}));expect(c.ledger).toHaveBeenCalledWith('partner');expect(c.nav).toHaveBeenCalledWith('ledger-cash');
});
it('도움말 화면 이동은 현재 역할의 실메뉴·마이페이지로만 연결하고 늦은 UID 이동은 무시한다',()=>{
 let callback='';const visit=(node:ts.Node)=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(parsed)==='HelpChat'){const attr=node.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText(parsed)==='onNavigate');if(attr&&ts.isJsxAttribute(attr)&&attr.initializer&&ts.isJsxExpression(attr.initializer)&&attr.initializer.expression)callback=attr.initializer.expression.getText(parsed);}ts.forEachChild(node,visit);};visit(parsed);
 if(!callback)throw Error('실제 도움말 이동 함수 없음');
 const c=catalog(false),current=vi.fn(),close=vi.fn(),auth={currentUser:{uid:'u'}};
 const navigate=evaluate(callback,{menuIdentity:{uid:'u'},auth,menuEntries:c.entries,setCurrentView:current,setHelpOpen:close});
 navigate('trade-statement');expect(c.nav).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 navigate('orders');expect(c.nav).toHaveBeenCalledWith('orders');expect(close).toHaveBeenCalledWith(null);
 navigate('mypage');expect(current).toHaveBeenCalledWith('mypage');auth.currentUser.uid='other';navigate('orders');expect(c.nav).toHaveBeenCalledOnce();
 expect(evaluate(initializer('helpSessionKey'),{menuKey:'scope',currentView:'mypage'})).toBe('scope:mypage');
 expect(evaluate(initializer('helpSessionKey'),{menuKey:null,currentView:'mypage'})).toBeNull();
});
it('상단 챗봇은 종 바로 앞에 있고 desktop 공통 표시와 모바일 메뉴 버튼을 유지한다',()=>{
 let header='';const visit=(node:ts.Node)=>{if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(parsed)==='header'&&node.getText(parsed).includes('aria-label="챗봇 열기"'))header=node.getText(parsed);ts.forEachChild(node,visit);};visit(parsed);if(!header)throw Error('상단 챗봇 없음');
 const open=vi.fn();const build=(key:string|null)=>evaluate(header,{React,helpSessionKey:key,setHelpOpen:open,setIsSidebarCollapsed:vi.fn(),Menu:()=>null,Bell:()=>null,currentView:'mypage',appNotifications:[],currentUser:{id:'u',name:'직원'},accountProfileImageUrl:()=>'/profile.png',setNotifPanelPos:vi.fn(),setShowNotifPanel:vi.fn()});
 const view=render(build('scope'));const button=screen.getByRole('button',{name:'챗봇 열기'});
 expect(button).toHaveTextContent('챗봇');expect(button).toHaveAttribute('aria-keyshortcuts','Alt+/');expect(button).toHaveClass('min-h-11');expect(button).not.toHaveClass('fixed');expect(button.nextElementSibling).toBe(screen.getByRole('button',{name:'알림'}));
 expect(button.closest('header')).not.toHaveClass('xl:hidden');expect(screen.getByRole('button',{name:'메뉴 열기'})).toHaveClass('xl:hidden');fireEvent.click(button);expect(open).toHaveBeenCalledWith('scope');
 view.rerender(build(null));expect(screen.getByRole('button',{name:'챗봇 열기'})).toBeDisabled();expect(source).not.toContain('z-[2100]');
});
it('공통 단축키는 현재 scope만 열며 보이는 작성창이 있으면 근거 화면 이동을 차단한다',()=>{
 let effect:ts.ArrowFunction|undefined,callback='';const visit=(node:ts.Node)=>{
  if(ts.isCallExpression(node)&&node.expression.getText(parsed)==='useEffect'&&ts.isArrowFunction(node.arguments[0])&&node.arguments[0].getText(parsed).includes("window.addEventListener('keydown',openHelp)"))effect=node.arguments[0];
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(parsed)==='HelpChat'){const attr=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(parsed)==='onNavigate');if(attr&&ts.isJsxAttribute(attr)&&attr.initializer&&ts.isJsxExpression(attr.initializer)&&attr.initializer.expression)callback=attr.initializer.expression.getText(parsed);}
  ts.forEachChild(node,visit);
 };visit(parsed);if(!effect||!callback)throw Error('실제 도움말 동작 없음');
 const open=vi.fn(),cleanup=evaluate(effect.getText(parsed),{window,helpSessionKey:'scope',setHelpOpen:open})();
 fireEvent.keyDown(window,{key:'/',altKey:true});expect(open).toHaveBeenCalledWith('scope');cleanup();
 const c=catalog(true),close=vi.fn();const navigate=evaluate(callback,{menuIdentity:{uid:'u'},auth:{currentUser:{uid:'u'}},menuEntries:c.entries,setCurrentView:vi.fn(),setHelpOpen:close});
 const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.getClientRects=()=>[{}] as any;document.body.appendChild(dialog);
 expect(navigate('orders')).toBe(false);expect(c.nav).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
 dialog.hidden=true;expect(navigate('orders')).toBe(true);expect(c.nav).toHaveBeenCalledWith('orders');dialog.remove();
});
