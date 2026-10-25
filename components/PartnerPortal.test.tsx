/** @vitest-environment jsdom */
import { act,fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach,expect, it, vi } from 'vitest';
beforeEach(()=>{localStorage.clear();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:any,_opts:any,fn:any)=>fn()}});});
import Portal from './PartnerPortal';
import type {ComponentProps} from 'react';
const actor=vi.hoisted(()=>({auth:{currentUser:{uid:'uid'},onAuthStateChanged:vi.fn((_listener:(user:{uid:string}|null)=>void)=>()=>{})}}));
vi.mock('../src/shared/firebase',()=>({auth:actor.auth}));
type PortalProps=ComponentProps<typeof Portal>;
const PartnerPortal=(props:Omit<PortalProps,'companyId'|'employeeId'|'getUid'|'readOrder'>&Partial<Pick<PortalProps,'companyId'|'employeeId'|'getUid'|'readOrder'>>)=><Portal companyId="taebaek" employeeId="employee" getUid={()=>actor.auth.currentUser?.uid} readOrder={async()=>({kind:'unconfirmed',reason:'조회 실패'})} {...props}/>;
import type { Item, Partner, PartnerItem } from '../types';
it('응답 유실 뒤 재mount한 실제 화면은 원번호를 복원하고 명시 조회만 한다',async()=>{
 vi.spyOn(window,'alert').mockImplementation(()=>{});const write=vi.fn().mockRejectedValue(Error('lostACK')),read=vi.fn(async()=>({kind:'found' as const,record:{...write.mock.calls[0]![0],companyId:'taebaek',status:'PENDING'}}));const props={partners:[{id:'c',name:'거래처',type:'일반'} as Partner],items:[{id:'p',name:'품목',type:'product',unit:'개'} as Item],partnerItems:[{id:'l',partnerId:'c',itemId:'p',Direction:'out',price:1000} as PartnerItem],onOrderSubmit:write,onExit:vi.fn(),readOrder:read};const first=render(<PartnerPortal {...props}/>);fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'),{target:{value:'c'}});fireEvent.click(screen.getByRole('button',{name:'입장하기'}));fireEvent.click(screen.getAllByRole('button').find(b=>b.querySelector('svg.lucide-plus'))!);fireEvent.click(screen.getByRole('button',{name:/주문하기/}));await waitFor(()=>expect(write).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getAllByRole('button').find(b=>b.querySelector('svg.lucide-plus'))!).toBeEnabled());const id=write.mock.calls[0]![0].id;first.unmount();render(<PartnerPortal {...props}/>);expect(screen.getByLabelText('원주문 결과 확인')).toHaveTextContent(id);expect(write).toHaveBeenCalledOnce();expect(read).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'주문 저장 여부 확인'}));expect(await screen.findByRole('button',{name:'확인 후 새 주문 작성'})).toBeTruthy();expect(write).toHaveBeenCalledOnce();
});

it('품목 원본이 같아도 거래처 연결의 추가·삭제를 주문 목록에 반영한다', () => {
  const items = [{ id: 'p1', name: '연결 검수 품목', type: 'product', unit: '개' }] as Item[];
  const partners = [{ id: 'c1', name: '검수거래처', type: '일반' }] as Partner[];
  const props = { items, partners, onOrderSubmit: vi.fn(), onExit: vi.fn() };
  const links = [{ id: 'pi1', itemId: 'p1', partnerId: 'c1', Direction: 'out', price: 1000 }] as PartnerItem[];
  const view = render(<PartnerPortal {...props} partnerItems={[]} />);
  fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'), { target: { value: 'c1' } });
  fireEvent.click(screen.getByRole('button', { name: '입장하기' }));
  expect(screen.queryByText('연결 검수 품목')).not.toBeInTheDocument();
  view.rerender(<PartnerPortal {...props} partnerItems={links} />);
  expect(screen.getByText('연결 검수 품목')).toBeInTheDocument();
  view.rerender(<PartnerPortal {...props} partnerItems={[]} />);
  expect(screen.queryByText('연결 검수 품목')).not.toBeInTheDocument();
});

it('응답유실은 서버에서 원주문 확인 뒤 새 주문을 명시해 재개한다', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const onOrderSubmit = vi.fn().mockRejectedValueOnce(new Error('권한 거부')).mockResolvedValueOnce('order-1');
  render(<PartnerPortal
    partners={[{ id: 'c1', name: '검수거래처', type: '일반' } as Partner]}
    items={[{ id: 'p1', name: '검수품목', type: 'product', unit: '개' } as Item]}
    partnerItems={[{ id: 'pi1', itemId: 'p1', partnerId: 'c1', Direction: 'out', price: 1000 } as PartnerItem]}
    onOrderSubmit={onOrderSubmit} onExit={vi.fn()} readOrder={async()=>({kind:'found',record:{...onOrderSubmit.mock.calls[0][0],companyId:'taebaek',status:'PENDING'}})}
  />);
  fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'), { target: { value: 'c1' } });
  fireEvent.click(screen.getByRole('button', { name: '입장하기' }));
  const plus = screen.getAllByRole('button').find(button => button.querySelector('svg.lucide-plus'))!;
  fireEvent.click(plus);
  fireEvent.click(screen.getByRole('button', { name: /주문하기/ }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('권한 거부')));
  expect(screen.queryByText('주문이 접수되었습니다!')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /주문하기/ }));expect(onOrderSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('원주문 결과 확인')).toHaveTextContent(onOrderSubmit.mock.calls[0][0].id);
  fireEvent.click(screen.getByRole('button',{name:'주문 저장 여부 확인'}));await screen.findByRole('button',{name:'확인 후 새 주문 작성'});expect(screen.getByLabelText('현재 등록된 주문')).toHaveTextContent('현재 상태: 대기중');expect(screen.queryByRole('alert')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'확인 후 새 주문 작성'}));await waitFor(()=>expect(screen.queryByLabelText('원주문 결과 확인')).toBeNull());expect(onOrderSubmit).toHaveBeenCalledTimes(1);fireEvent.click(plus);fireEvent.click(screen.getByRole('button',{name:/주문하기/}));
  expect(await screen.findByText('주문이 접수되었습니다!')).toBeTruthy();
  expect(onOrderSubmit).toHaveBeenCalledTimes(2);
  alert.mockRestore();
});

it('주문 응답 대기 중 거래처 이동과 수량 변경을 막고 실패 초안을 유지한다', async () => {
  let reject!: (error: Error) => void;
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const submit = vi.fn(() => new Promise((_resolve, no) => { reject = no; }));
  render(<PartnerPortal partners={[{id:'c1',name:'검수거래처',type:'일반'} as Partner]} items={[{id:'p1',name:'검수품목',type:'product',unit:'개'} as Item]} partnerItems={[{id:'pi1',itemId:'p1',partnerId:'c1',Direction:'out',price:1000} as PartnerItem]} onOrderSubmit={submit} onExit={vi.fn()}/>);
  fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'),{target:{value:'c1'}});
  fireEvent.click(screen.getByRole('button',{name:'입장하기'}));
  const plus=screen.getAllByRole('button').find(button=>button.querySelector('svg.lucide-plus'))!;
  const close=screen.getAllByRole('button').find(button=>button.querySelector('svg.lucide-x'))!;
  fireEvent.click(plus); fireEvent.click(screen.getByRole('button',{name:/주문하기/}));
  expect(plus).toBeDisabled(); expect(close).toBeDisabled();
  await waitFor(()=>expect(submit).toHaveBeenCalledOnce());reject(Error('응답 실패'));
  await waitFor(()=>expect(alert).toHaveBeenCalledWith(expect.stringContaining('응답 실패')));
  expect(screen.getByRole('button',{name:/1,000원 주문하기/})).toBeDisabled();expect(plus).toBeEnabled();fireEvent.click(plus);expect(submit).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

import {readFileSync} from 'node:fs';
import ts from 'typescript';
it('실제 직원 entry는 현재 회사·직원·UID와 단건 읽기를 명시 연결한다',()=>{const source=readFileSync('apps/staff/main.tsx','utf8'),tree=ts.createSourceFile('main.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let attrs:string[]=[];const visit=(node:ts.Node)=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(tree)==='PartnerPortal')attrs=node.attributes.properties.map(p=>p.getText(tree));ts.forEachChild(node,visit);};visit(tree);expect(attrs).toContain('companyId={companyId}');expect(attrs).toContain('employeeId={currentUser.id}');expect(attrs).toContain('getUid={()=>auth.currentUser?.uid}');expect(attrs.some(text=>text.startsWith('readOrder=')&&text.includes('readPendingOrder({id,partnerId,signal,companyId,employeeId:currentUser.id,uid:auth.currentUser?.uid'))).toBe(true);});
it('실제 useOutputScope Auth ABA가 늦은 주문 ACK를 완료 화면에 반영하지 않는다',async()=>{let listener!:(user:{uid:string}|null)=>void;actor.auth.currentUser={uid:'uid'};actor.auth.onAuthStateChanged.mockImplementation(cb=>{listener=cb;return()=>{};});let finish!:(value:unknown)=>void;const submit=vi.fn(()=>new Promise(r=>{finish=r;}));render(<PartnerPortal partners={[{id:'c',name:'거래처',type:'일반'} as Partner]} items={[{id:'p',name:'품목',type:'product',unit:'개'} as Item]} partnerItems={[{id:'l',itemId:'p',partnerId:'c',Direction:'out',price:1000} as PartnerItem]} onOrderSubmit={submit} onExit={vi.fn()}/>);fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'),{target:{value:'c'}});fireEvent.click(screen.getByRole('button',{name:'입장하기'}));fireEvent.click(screen.getAllByRole('button').find(b=>b.querySelector('svg.lucide-plus'))!);fireEvent.click(screen.getByRole('button',{name:/주문하기/}));await waitFor(()=>expect(submit).toHaveBeenCalledOnce());act(()=>{actor.auth.currentUser={uid:'other'};listener(actor.auth.currentUser);actor.auth.currentUser={uid:'uid'};listener(actor.auth.currentUser);});await act(async()=>finish(undefined));expect(screen.queryByText('주문이 접수되었습니다!')).toBeNull();expect(screen.queryByLabelText('원주문 결과 확인')).toBeNull();expect(submit).toHaveBeenCalledOnce();actor.auth.onAuthStateChanged.mockImplementation(()=>()=>{});});
it('StrictMode에서도 정상 ACK는 조회 없이 완료한다',async()=>{const {StrictMode}=await import('react');const read=vi.fn(),submit=vi.fn().mockResolvedValue(undefined);render(<StrictMode><PartnerPortal partners={[{id:'c',name:'거래처',type:'일반'} as Partner]} items={[{id:'p',name:'품목',type:'product',unit:'개'} as Item]} partnerItems={[{id:'l',itemId:'p',partnerId:'c',Direction:'out',price:1000} as PartnerItem]} onOrderSubmit={submit} readOrder={read} onExit={vi.fn()}/></StrictMode>);fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'),{target:{value:'c'}});fireEvent.click(screen.getByRole('button',{name:'입장하기'}));fireEvent.click(screen.getAllByRole('button').find(b=>b.querySelector('svg.lucide-plus'))!);fireEvent.click(screen.getByRole('button',{name:/주문하기/}));expect(await screen.findByText('주문이 접수되었습니다!')).toBeTruthy();expect(submit).toHaveBeenCalledOnce();expect(read).not.toHaveBeenCalled();});

import AppDialogHost from '../src/shared/components/AppDialogHost';
it('미확인 주문 이탈은 앱 확인창에서 원번호를 보고 취소 후 다시 나간다',async()=>{
 const native=vi.spyOn(window,'confirm').mockReturnValue(false);vi.spyOn(window,'alert').mockImplementation(()=>{});
 const exit=vi.fn(),write=vi.fn().mockRejectedValue(Error('unknown'));
 render(<><AppDialogHost/><PartnerPortal partners={[{id:'c',name:'거래처',type:'일반'} as Partner]} items={[{id:'p',name:'품목',type:'product',unit:'개'} as Item]} partnerItems={[{id:'l',itemId:'p',partnerId:'c',Direction:'out',price:1000} as PartnerItem]} onOrderSubmit={write} onExit={exit}/></>);
 fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'),{target:{value:'c'}});fireEvent.click(screen.getByRole('button',{name:'입장하기'}));
 fireEvent.click(screen.getAllByRole('button').find(b=>b.querySelector('svg.lucide-plus'))!);fireEvent.click(screen.getByRole('button',{name:/주문하기/}));await waitFor(()=>expect(screen.getByRole('button',{name:/주문하기/})).toBeDisabled());await waitFor(()=>expect(screen.getAllByRole('button').find(b=>b.querySelector('svg.lucide-plus'))!).toBeEnabled());
 fireEvent.click(screen.getAllByRole('button').find(b=>b.querySelector('svg.lucide-x'))!);const close=screen.getByRole('button',{name:'관리자 화면으로 돌아가기'});fireEvent.click(close);
 expect(await screen.findByText('주문 확인 화면을 나갈까요?')).toBeTruthy();
 expect(screen.getByText(new RegExp('주문 '+write.mock.calls[0][0].id+'의 원문'))).toHaveTextContent('서버 주문은 취소되지 않습니다');
 fireEvent.click(screen.getByRole('button',{name:'계속 확인'}));await waitFor(()=>expect(screen.queryByText('주문 확인 화면을 나갈까요?')).toBeNull());
 expect(exit).not.toHaveBeenCalled();expect(screen.getByLabelText('원주문 결과 확인')).toHaveTextContent(write.mock.calls[0][0].id);
 fireEvent.click(close);await screen.findByText('주문 확인 화면을 나갈까요?');fireEvent.click(screen.getByRole('button',{name:'나가기'}));await waitFor(()=>expect(exit).toHaveBeenCalledOnce());expect(write).toHaveBeenCalledOnce();expect(native).not.toHaveBeenCalled();native.mockRestore();
});
