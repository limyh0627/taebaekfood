/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import OrderInterpretationRules from './OrderInterpretationRules';
const service=vi.hoisted(()=>({list:vi.fn(),review:vi.fn()}));
vi.mock('../src/shared/services/orderCopyService',()=>({listOrderInterpretationRules:service.list,reviewOrderInterpretationRule:service.review}));
beforeEach(()=>{vi.clearAllMocks();service.review.mockResolvedValue(undefined);service.list.mockResolvedValue([{ruleId:'rule',companyId:'taebaek',partnerId:'partner',orderIds:['o1','o2','o3'],alias:'붙임참기름',itemId:'item',status:'proposed',revision:2,captureIds:['a','b','c']}]);});afterEach(cleanup);
it('서로 다른 확정 기록3건 제안만 현재 revision으로 승인하고 중지한다',async()=>{render(<OrderInterpretationRules companyId="taebaek" actorUid="actor" isAdmin onClose={()=>{}}/>);const button=await screen.findByRole('button',{name:'승인'});expect(button).toBeEnabled();fireEvent.click(button);await waitFor(()=>expect(service.review).toHaveBeenCalledWith({companyId:'taebaek',ruleId:'rule',expectedRevision:2,action:'approve'}));});
it('같은 capture의 반복은3건으로 승격하지 않는다',async()=>{service.list.mockResolvedValue([{ruleId:'r',partnerId:'partner',orderIds:['o1','o2','o3'],alias:'별칭',itemId:'item',status:'proposed',revision:1,captureIds:['a','a','a']}]);render(<OrderInterpretationRules companyId="taebaek" actorUid="actor" isAdmin onClose={()=>{}}/>);expect(await screen.findByRole('button',{name:'승인'})).toBeDisabled();expect(service.review).not.toHaveBeenCalled();});
it('직원 화면은 관리자 목록을 읽거나 승인하지 않는다',()=>{render(<OrderInterpretationRules companyId="taebaek" actorUid="staff" isAdmin={false} onClose={()=>{}}/>);expect(service.list).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'승인'})).not.toBeInTheDocument();});
const expression=(patch:Record<string,unknown>={})=>({ruleId:'expression',companyId:'taebaek',kind:'expression',scope:'company',partnerId:'',alias:'스티커X',itemId:'',target:'note',value:'스티커 없음',status:'proposed',revision:7,captureIds:['a','b','c'],orderIds:['o1','o2','o3'],...patch});
it.each([{scope:'company',target:'note',value:'스티커 없음',label:'회사 공통 표현',targetLabel:'비고'},
 {scope:'partner',target:'note',value:'별도 포장 없음',label:'거래처 표현',targetLabel:'비고'}])('typed $scope/$target의 의미와 현재 revision을 표시하고 승인한다',async row=>{
 service.list.mockResolvedValue([expression({scope:row.scope,target:row.target,value:row.value,partnerId:row.scope==='partner'?'partner':''})]);
 render(<OrderInterpretationRules companyId="taebaek" actorUid="actor" isAdmin onClose={()=>{}}/>);
 expect(await screen.findByText(new RegExp(row.label))).toHaveTextContent(`${row.targetLabel}: ${row.value}`);
 fireEvent.click(screen.getByRole('button',{name:'승인'}));await waitFor(()=>expect(service.review).toHaveBeenCalledWith({companyId:'taebaek',ruleId:'expression',expectedRevision:7,action:'approve'}));
});
it('서로 다른 capture3이어도 order가2개면 표현 승인을 막는다',async()=>{
 service.list.mockResolvedValue([expression({orderIds:['o1','o1','o2']})]);render(<OrderInterpretationRules companyId="taebaek" actorUid="actor" isAdmin onClose={()=>{}}/>);expect(await screen.findByRole('button',{name:'승인'})).toBeDisabled();expect(service.review).not.toHaveBeenCalled();
});
it('승인된 표현은 승인 버튼을 막고 중지 요청에 현재 revision을 그대로 보낸다',async()=>{
 service.list.mockResolvedValue([expression({status:'approved'})]);render(<OrderInterpretationRules companyId="taebaek" actorUid="actor" isAdmin onClose={()=>{}}/>);expect(await screen.findByRole('button',{name:'승인'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'중지'}));await waitFor(()=>expect(service.review).toHaveBeenCalledWith({companyId:'taebaek',ruleId:'expression',expectedRevision:7,action:'stop'}));
});
it('기존 품목 별칭은 표현 값으로 바꾸지 않고 기존 itemId와 동일한 승인 경로를 유지한다',async()=>{
 render(<OrderInterpretationRules companyId="taebaek" actorUid="actor" isAdmin onClose={()=>{}}/>);expect(await screen.findByText(/거래처 품목 별칭/)).toHaveTextContent('item');expect(screen.queryByText(/비고:/)).toBeNull();
});
it('승인 응답 중 UID가 바뀌면 새 화면의 변경 콜백과 재조회를 실행하지 않는다',async()=>{
 service.list.mockResolvedValue([expression()]);let finish!:()=>void;service.review.mockReturnValueOnce(new Promise<void>(resolve=>finish=resolve));const changed=vi.fn();const props={companyId:'taebaek' as const,actorUid:'actor',isAdmin:true,onClose:()=>{},onChanged:changed};
 const view=render(<OrderInterpretationRules {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'승인'}));view.rerender(<OrderInterpretationRules {...props} actorUid="other"/>);await waitFor(()=>expect(service.list).toHaveBeenCalledTimes(2));
 await act(async()=>{finish();await Promise.resolve();});expect(changed).not.toHaveBeenCalled();expect(service.list).toHaveBeenCalledTimes(2);
});
