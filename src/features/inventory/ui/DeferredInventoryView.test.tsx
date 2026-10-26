/** @vitest-environment jsdom */
import React,{useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
vi.mock('../../../../components/ItemList',()=>({default:(props:any)=>{const [draft,setDraft]=useState('');return <section><p>{props.companyId}:{props.mode}:{props.items[0]?.name}</p><input aria-label="재고 초안" value={draft} onChange={event=>setDraft(event.target.value)}/><button onClick={()=>props.onUpdateItem(props.items[0])}>기존 저장</button></section>;}}));
vi.mock('../../../../components/BomIntegrityPanel',()=>({default:(props:any)=><p>BOM:{props.items[0]?.name}</p>}));
import DeferredInventoryView,{DeferredInventorySection} from './DeferredInventoryView';
const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const View=({value}:{value:string})=><p>{value}</p>;
beforeEach(()=>vi.spyOn(console,'error').mockImplementation(()=>{}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('대기 중 최신 props를 유지하고 로드 완료 뒤 현재 값을 표시한다',async()=>{
 const load=deferred<{default:typeof View}>(),loader=vi.fn(()=>load.promise);
 const ui=render(<DeferredInventorySection loader={loader} label="재고" viewProps={{value:'이전'}}/>);
 expect(screen.getByRole('status').textContent).toContain('재고');expect(loader).toHaveBeenCalledTimes(1);
 ui.rerender(<DeferredInventorySection loader={loader} label="재고" viewProps={{value:'현재'}}/>);
 await act(async()=>load.resolve({default:View}));expect(await screen.findByText('현재')).toBeTruthy();expect(screen.queryByText('이전')).toBeNull();expect(loader).toHaveBeenCalledTimes(1);
});
it('실패 뒤 명시 재시도만 새 lazy를 시작하고 현재 props로 복구한다',async()=>{
 const first=deferred<{default:typeof View}>(),second=deferred<{default:typeof View}>();const loader=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 const ui=render(<DeferredInventorySection loader={loader} label="재고" viewProps={{value:'이전'}}/>);
 await act(async()=>first.reject(Error('chunk unavailable')));expect(await screen.findByRole('alert')).toBeTruthy();expect(loader).toHaveBeenCalledTimes(1);
 ui.rerender(<DeferredInventorySection loader={loader} label="재고" viewProps={{value:'현재'}}/>);expect(loader).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'다시 불러오기'}));expect(loader).toHaveBeenCalledTimes(2);
 await act(async()=>second.resolve({default:View}));expect(await screen.findByText('현재')).toBeTruthy();
});
it('BOM 실패와 재시도가 이미 열린 재고 입력을 언마운트하지 않는다',async()=>{
 const bom1=deferred<{default:typeof View}>(),bom2=deferred<{default:typeof View}>();const bom=vi.fn().mockReturnValueOnce(bom1.promise).mockReturnValueOnce(bom2.promise);
 const Draft=()=>{const [text,setText]=useState('');return <input aria-label="입력" value={text} onChange={event=>setText(event.target.value)}/>;};const items=vi.fn(async()=>({default:Draft}));
 render(<><DeferredInventorySection loader={bom} label="BOM 점검" viewProps={{value:'복구'}}/><DeferredInventorySection loader={items} label="재고" viewProps={{}}/></>);
 const input=await screen.findByLabelText('입력');fireEvent.change(input,{target:{value:'보존할 입력'}});
 await act(async()=>bom1.reject(Error('bom fail')));fireEvent.click(await screen.findByRole('button',{name:'다시 불러오기'}));await act(async()=>bom2.resolve({default:View}));
 expect(await screen.findByText('복구')).toBeTruthy();expect((screen.getByLabelText('입력') as HTMLInputElement).value).toBe('보존할 입력');expect(screen.getByLabelText('입력')).toBe(input);expect(items).toHaveBeenCalledTimes(1);
});
it('이탈 뒤 옛 loader 완료가 현재 다른 화면을 바꾸지 않는다',async()=>{
 const load=deferred<{default:typeof View}>(),loader=()=>load.promise;
 const ui=render(<DeferredInventorySection loader={loader} label="재고" viewProps={{value:'옛 재고'}}/>);ui.rerender(<p>다른 메뉴</p>);
 await act(async()=>load.resolve({default:View}));expect(screen.getByText('다른 메뉴')).toBeTruthy();expect(screen.queryByText('옛 재고')).toBeNull();
});
it('회사 key 교체 중 옛 결과는 새 회사 props로만 표시된다',async()=>{
 const old=deferred<{default:typeof View}>(),fresh=deferred<{default:typeof View}>(),loader=vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
 const ui=render(<DeferredInventorySection key="taebaek" loader={loader} label="재고" viewProps={{value:'태백'}}/>);ui.rerender(<DeferredInventorySection key="punghoe" loader={loader} label="재고" viewProps={{value:'풍회'}}/>);
 await act(async()=>old.resolve({default:View}));expect(screen.queryByText('태백')).toBeNull();expect(screen.getByRole('status')).toBeTruthy();await act(async()=>fresh.resolve({default:View}));expect(await screen.findByText('풍회')).toBeTruthy();
});
it('실제 wrapper는 최신 props/콜백을 전달하고 같은 회사 메뉴 전환은 입력을 보존한다',async()=>{
 const first=vi.fn(),latest=vi.fn();const props:any={companyId:'taebaek',mode:'inventory',items:[{id:'a',name:'품목A'}],onUpdateItem:first};
 const ui=render(<DeferredInventoryView {...props} bomProps={{items:props.items,itemFormulas:[],bomIndex:{} } as any}/>);
 const input=await screen.findByLabelText('재고 초안');expect(await screen.findByText('BOM:품목A')).toBeTruthy();fireEvent.change(input,{target:{value:'미저장'}});
 const item={id:'b',name:'품목B'};ui.rerender(<DeferredInventoryView {...props} mode="lots" items={[item]} onUpdateItem={latest}/>);
 expect(screen.getByText('taebaek:lots:품목B')).toBeTruthy();expect(screen.queryByText('BOM:품목A')).toBeNull();expect((screen.getByLabelText('재고 초안') as HTMLInputElement).value).toBe('미저장');fireEvent.click(screen.getByText('기존 저장'));expect(latest).toHaveBeenCalledWith(item);expect(first).not.toHaveBeenCalled();
 ui.rerender(<DeferredInventoryView {...props} companyId="punghoe"/>);await waitFor(()=>expect((screen.getByLabelText('재고 초안') as HTMLInputElement).value).toBe(''));
});

for(const path of ['apps/admin/main.tsx','apps/staff/main.tsx'])it(path+' 실제 청크 처리와 오류 경계는 자동 reload 없이 클릭으로만 새로고침한다',()=>{
 const source=readFileSync(path,'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const beforeReactDom=ast.statements.findIndex(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.getText(ast).includes('react-dom/client'));
 const bootstrap=ast.statements.slice(0,beforeReactDom).filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getText(ast)).join('\n');
 const listeners=new Map<string,Function[]>(),fakeWindow={location:{reload:vi.fn()},addEventListener:(name:string,callback:Function)=>listeners.set(name,[...(listeners.get(name)??[]),callback])};
 new Function('window',ts.transpileModule(bootstrap,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(fakeWindow);
 const preload=new Event('vite:preloadError',{cancelable:true}),rejection=Object.assign(new Event('unhandledrejection',{cancelable:true}),{reason:Error('Failed to fetch dynamically imported module')});
 for(const [name,event] of [['vite:preloadError',preload],['unhandledrejection',rejection]] as const)for(const listener of listeners.get(name)??[])listener(event);
 expect(fakeWindow.location.reload).not.toHaveBeenCalled();expect(preload.defaultPrevented).toBe(false);expect(rejection.defaultPrevented).toBe(false);
 const boundary=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='ErrorBoundary');if(!boundary)throw Error('실제 오류 경계 없음');
 const body=ts.transpileModule(boundary.getText(ast),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const ActualBoundary=new Function('React','Component','window',body+';return ErrorBoundary;')(React,React.Component,fakeWindow);
 const Crash=()=>{throw Error('청크 오류 유지');};render(<ActualBoundary><Crash/></ActualBoundary>);
 expect(screen.getByText('청크 오류 유지')).toBeTruthy();expect(fakeWindow.location.reload).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'화면 새로고침'}));expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
});
