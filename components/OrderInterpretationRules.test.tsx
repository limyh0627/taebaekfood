/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import OrderInterpretationRules from './OrderInterpretationRules';
const service=vi.hoisted(()=>({list:vi.fn(),review:vi.fn()}));
vi.mock('../src/shared/services/orderCopyService',()=>({listOrderInterpretationRules:service.list,reviewOrderInterpretationRule:service.review}));
beforeEach(()=>{vi.clearAllMocks();service.review.mockResolvedValue(undefined);service.list.mockResolvedValue([{ruleId:'rule',companyId:'taebaek',partnerId:'partner',orderIds:['o1','o2','o3'],alias:'붙임참기름',itemId:'item',status:'proposed',revision:2,captureIds:['a','b','c']}]);});afterEach(cleanup);
it('서로 다른 확정 기록3건 제안만 현재 revision으로 승인하고 중지한다',async()=>{render(<OrderInterpretationRules companyId="taebaek" actorUid="actor" isAdmin onClose={()=>{}}/>);const button=await screen.findByRole('button',{name:'승인'});expect(button).toBeEnabled();fireEvent.click(button);await waitFor(()=>expect(service.review).toHaveBeenCalledWith({companyId:'taebaek',ruleId:'rule',expectedRevision:2,action:'approve'}));});
it('같은 capture의 반복은3건으로 승격하지 않는다',async()=>{service.list.mockResolvedValue([{ruleId:'r',partnerId:'partner',orderIds:['o1','o2','o3'],alias:'별칭',itemId:'item',status:'proposed',revision:1,captureIds:['a','a','a']}]);render(<OrderInterpretationRules companyId="taebaek" actorUid="actor" isAdmin onClose={()=>{}}/>);expect(await screen.findByRole('button',{name:'승인'})).toBeDisabled();expect(service.review).not.toHaveBeenCalled();});
it('직원 화면은 관리자 목록을 읽거나 승인하지 않는다',()=>{render(<OrderInterpretationRules companyId="taebaek" actorUid="staff" isAdmin={false} onClose={()=>{}}/>);expect(service.list).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'승인'})).not.toBeInTheDocument();});
