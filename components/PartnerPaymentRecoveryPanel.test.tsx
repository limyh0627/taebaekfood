// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import PartnerPaymentRecoveryPanel,{type PartnerPaymentRecoveryController} from './PartnerPaymentRecoveryPanel';
import type {PartnerPaymentRecoveryEntry} from '../src/features/statements/infrastructure/partnerPaymentRecovery';

afterEach(cleanup);
const entry=():PartnerPaymentRecoveryEntry=>({key:'body',bodyText:'fixed-original',sidecarKey:'sidecar',sidecarText:'fixed-ref',reference:{companyId:'taebaek',partnerId:'partner',operationId:'original-op'},request:{operationId:'original-op',expectedRevision:1,releaseId:'release',tradeDate:'2026-10-01',partnerId:'partner',direction:'입금',amount:2891460,cashAccountId:'original-bank',pin:true,allocations:[{statementId:'statement',amount:2891460}],note:'원래 수금'},requestHash:'a'.repeat(64),sidecarHash:'a'.repeat(64),status:'valid',description:'원래 수금'});
const controller=(row=entry()):PartnerPaymentRecoveryController=>({pending:[row],selectedEntry:row,selectEntry:vi.fn(),busy:false,inspect:vi.fn(),cancel:vi.fn(),retry:vi.fn(),discardCopy:vi.fn(),canRetryEntry:()=>true,canDiscardEntry:()=>true,history:[],historyMore:false,loadHistory:vi.fn(),nextHistory:vi.fn(),inspectHistory:vi.fn(),cancelHistory:vi.fn(),message:'',error:'',readFailed:false,refresh:vi.fn(),blockedReason:'',ready:true});

it('원금액 날짜 계좌를 표시하고 모든 복구 동작은 같은 관측 항목을 전달한다',()=>{
 const row=entry(),payment=controller(row);render(<PartnerPaymentRecoveryPanel payment={payment}/>);
 expect(screen.getByText(/원래 요청: 2,891,460원 · 2026-10-01 · 계좌 original-bank/)).toBeTruthy();
 for(const [name,method] of [['이 요청 확인','selectEntry'],['결과 확인','inspect'],['같은 요청 재시도','retry'],['미처리 요청 중단','cancel'],['이 기기 사본 정리','discardCopy']] as const){fireEvent.click(screen.getByRole('button',{name:name==='이 요청 확인'?/이 요청 확인/:name}));expect(payment[method]).toHaveBeenCalledWith(row);}
 expect(screen.queryByRole('button',{name:/수금 기록|지불 기록/})).toBeNull();
});
it('원문없는 사본은 금액을 추정하지 않고 조회 중단과 이력만 제공한다',()=>{
 const row={...entry(),request:null,status:'corrupt' as const},payment=controller(row);payment.canRetryEntry=()=>false;render(<PartnerPaymentRecoveryPanel payment={payment}/>);
 expect(screen.getByText(/금액·날짜·계좌를 추정해 다시 보내지 않습니다/)).toBeTruthy();expect(screen.queryByRole('button',{name:'같은 요청 재시도'})).toBeNull();expect(screen.queryByText(/원래 요청:/)).toBeNull();
});
it('식별불가 사본은 서버요청과 자동연결하지 않고 이력을 명시조회한다',()=>{
 const row={...entry(),request:null,reference:null,status:'corrupt' as const},payment=controller(row);payment.canRetryEntry=()=>false;render(<PartnerPaymentRecoveryPanel payment={payment}/>);expect(screen.queryByRole('button',{name:'결과 확인'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'서버 처리 이력 확인'}));expect(payment.loadHistory).toHaveBeenCalledOnce();
});
it('빈 이력 페이지에도 다음20건 cursor 동선을 유지하고 원인과 부분정리를 표시한다',()=>{
 const payment=controller();payment.historyMore=true;payment.message='입금은 확인됐지만 기기 사본 정리가 끝나지 않았습니다. 결과를 다시 확인해 주세요.';render(<PartnerPaymentRecoveryPanel payment={payment}/>);fireEvent.click(screen.getByRole('button',{name:'다음 20건'}));expect(payment.nextHistory).toHaveBeenCalledOnce();expect(screen.getByRole('status').textContent).toContain('사본 정리');
});
it('busy에는 조회 재시도 중단 정리 모두 잠그고 read실패는 조회만 재개한다',()=>{
 const payment=controller();payment.busy=true;payment.readFailed=true;payment.error='기기 요청 조회 실패';const view=render(<PartnerPaymentRecoveryPanel payment={payment}/>);for(const button of screen.getAllByRole('button'))expect((button as HTMLButtonElement).disabled).toBe(true);payment.busy=false;view.rerender(<PartnerPaymentRecoveryPanel payment={payment}/>);fireEvent.click(screen.getByRole('button',{name:'이전 요청 다시 읽기'}));expect(payment.refresh).toHaveBeenCalledOnce();expect(screen.getByRole('alert').textContent).toContain('조회 실패');
});
it('서버 이력은 선택한 결과 그대로 확인하고 최초 가용 필드만 표시한다',()=>{
 const payment=controller(),result={version:1 as const,reference:entry().reference!,actorUid:'actor',status:'applied' as const,requestHash:'a'.repeat(64),message:'반영 확인',amount:100,tradeDate:'2026-10-01',cashAccountId:'first-bank',docNo:'입금1'};payment.history=[result];render(<PartnerPaymentRecoveryPanel payment={payment}/>);fireEvent.click(screen.getByRole('button',{name:'original-op 결과 확인'}));expect(payment.inspectHistory).toHaveBeenCalledWith(result);fireEvent.click(screen.getByRole('button',{name:'original-op 미처리 요청 중단'}));expect(payment.cancelHistory).toHaveBeenCalledWith(result);expect(screen.getByText('최초 금액: 100원')).toBeTruthy();
});
it('보관 사본이 없어도 준비된 본인 범위의 이력을 명시조회하고 자동조회하지 않는다',()=>{
 const payment=controller();payment.pending=[];payment.selectedEntry=null;const view=render(<PartnerPaymentRecoveryPanel payment={payment}/>);expect(payment.loadHistory).not.toHaveBeenCalled();expect(screen.getAllByRole('button',{name:'서버 처리 이력 확인'})).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'서버 처리 이력 확인'}));expect(payment.loadHistory).toHaveBeenCalledOnce();payment.ready=false;view.rerender(<PartnerPaymentRecoveryPanel payment={payment}/>);expect(screen.queryByRole('button',{name:'서버 처리 이력 확인'})).toBeNull();
});
it('관측한 실패 이유와 상태를 복구 행동보다 먼저 보여주고 미조회 요청을 실패로 단정하지 않는다',()=>{
 const payment=controller();payment.message='서버 반영은 확인됐지만 사본 정리에 실패했습니다. 결과를 다시 확인해 주세요.';payment.error='기기 저장소 접근 실패';const view=render(<PartnerPaymentRecoveryPanel payment={payment}/>);const firstAction=screen.getByRole('button',{name:/이 요청 확인/});expect(screen.getByRole('status').compareDocumentPosition(firstAction)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getByRole('alert').compareDocumentPosition(firstAction)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();payment.message='';payment.error='';view.rerender(<PartnerPaymentRecoveryPanel payment={payment}/>);expect(screen.getByRole('status').textContent).toContain('결과를 아직 확인하지 않았습니다');expect(screen.queryByRole('alert')).toBeNull();expect(screen.getAllByRole('button',{name:'서버 처리 이력 확인'})).toHaveLength(1);
});
