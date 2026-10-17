/** @vitest-environment jsdom */
import React, {useState} from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import MyPage from './MyPage';
import {normalizeMenuPreferences} from '../src/shared/menuPreferences';
import type {Employee} from '../types';
vi.mock('../src/shared/notify',()=>({notify:vi.fn(),notifySupported:()=>false,notifyPermission:()=> 'default',askNotifyPermission:vi.fn(),notifyDiagnose:vi.fn(),loadNotifyMode:()=> 'all',saveNotifyMode:vi.fn(),loadNotifyVolume:()=> 'normal',saveNotifyVolume:vi.fn(),playChime:vi.fn()}));
vi.mock('../src/shared/push',()=>({registerPush:vi.fn(),unregisterPush:vi.fn(),pushSupported:()=>false,pushMuted:()=>false,setPushMuted:vi.fn()}));
vi.mock('../src/shared/deviceLabel',()=>({currentDeviceLabel:()=> '시험 기기'}));
const groups=[{id:'a',label:'첫 그룹'},{id:'b',label:'둘째 그룹'}],items=[{id:'one',label:'하나',groupId:'a'},{id:'two',label:'둘',groupId:'a'}];
function Host({enabled=true,error=''}:{enabled?:boolean;error?:string}){const [value,setValue]=useState(()=>normalizeMenuPreferences(null,groups,items));return <><MyPage currentUser={{id:'e',name:'시험',position:'직원',department:'생산',joinDate:'2026-01-01',status:'working',phone:'',fcmTokens:[]} as Employee} onLogout={vi.fn()} menuSettings={{groups,items,value,enabled,error,onChange:setValue,onReset:()=>setValue(normalizeMenuPreferences(null,groups,items))}}/><output data-testid="value">{JSON.stringify(value)}</output></>;}
it('숨김·그룹간 이동·그룹순서·메뉴순서를 변경하고 빈 그룹도 복구 설정에 유지한다',()=>{
 render(<Host/>);expect(screen.getByText('메뉴 설정 열기').closest('details')).not.toHaveAttribute('open');fireEvent.click(screen.getByText('메뉴 설정 열기'));fireEvent.click(screen.getByLabelText('하나 표시'));expect(screen.getByLabelText('하나 표시')).not.toBeChecked();
 fireEvent.change(screen.getByLabelText('하나 그룹'),{target:{value:'b'}});expect(screen.getByLabelText('하나 그룹')).toHaveValue('b');expect(screen.getByLabelText('하나 표시')).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'둘째 그룹 그룹 위로'}));expect(screen.getByTestId('value').textContent).toContain('"groups":["b","a"]');
 fireEvent.change(screen.getByLabelText('하나 그룹'),{target:{value:'a'}});fireEvent.click(screen.getByRole('button',{name:'하나 위로'}));
 expect(JSON.parse(screen.getByTestId('value').textContent!).items.filter((r:any)=>r.groupId==='a').map((r:any)=>r.id)).toEqual(['one','two']);
 fireEvent.click(screen.getByRole('button',{name:'내 메뉴 초기화'}));expect(screen.getByLabelText('하나 표시')).toBeChecked();expect(screen.getByText('이 그룹의 메뉴 없음')).toBeInTheDocument();
});
it('계정 확인 전 설정을 비활성화하고 저장 실패 안내를 보여준다',()=>{render(<Host enabled={false} error="저장 실패 안내"/>);fireEvent.click(screen.getByText('메뉴 설정 열기'));expect(screen.getByLabelText('하나 표시')).toBeDisabled();expect(screen.getByRole('button',{name:'내 메뉴 초기화'})).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('저장 실패 안내');expect(screen.getByRole('region',{name:'이 브라우저의 내 메뉴'})).toBeInTheDocument();});
it('마이페이지에는 메뉴 설정만 유지하고 도움말 진입은 두지 않는다',()=>{render(<Host/>);expect(screen.queryByRole('button',{name:'사용법 질문하기'})).toBeNull();expect(screen.getByText('메뉴 설정 열기').closest('details')).not.toHaveAttribute('open');});
