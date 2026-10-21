/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import PalletTransactionRecoveryPanel from './PalletTransactionRecoveryPanel';
import type { usePalletTransactionEditor } from '../hooks/usePalletTransactionEditor';
import type { PalletTransactionEntry } from '../../../shared/services/palletTransactionWrites';
type Editor=ReturnType<typeof usePalletTransactionEditor>;
const reference={companyId:'taebaek' as const,operationId:'op',transactionId:'transaction'};
const entry:PalletTransactionEntry={key:'observed-key',bodyRaw:'원문 A',referenceRaw:'참조 A',request:null,reference,transaction:null,summary:null,references:[{reference,source:'both'}],requestHash:null,lastAttempt:null,legacy:false,status:'corrupt',description:'보관된 등록 요청'};
function fixture(corrupt=false):Editor{
 const observed=corrupt?{...entry,reference:null,references:[]}:entry;
 const row={entry:observed,summary:null,terminal:false,isUnresolved:true,currentState:'처리 확인 필요',cause:'연결 응답을 받지 못했습니다.',nextAction:corrupt?'서버 취소가 아닌 이 기기 정보만 정리합니다.':'실제 결과를 확인해 주세요.',referenceRows:corrupt?[]:observed.references.map(item=>({...item,result:undefined,terminal:false,label:'보관된 요청',currentState:'미확정',cause:'',nextAction:'결과 확인',canInspect:true,canCancel:true})),canInspect:!corrupt,canRetry:false,canCancel:!corrupt,canDiscard:corrupt,canUpgradeReference:false};
 return {recordObservation:vi.fn(),scopeToken:{},scopeKey:'scope',isCurrent:()=>true,draft:{partnerId:'',palletId:'',quantity:'',returnQty:'0',newQty:'0',note:'',isTransfer:false},mode:'in',showForm:false,busy:false,locked:false,open:vi.fn(),close:vi.fn(),change:vi.fn(),submit:vi.fn(async()=>{}),completeExchange:vi.fn(async()=>{}),completingSourceId:null,isExchangeApplied:()=>false,refreshExchange:vi.fn(async()=>{}),canRefreshExchange:false,inlineError:'',inlineMessage:'',recoveryOpen:true,openRecovery:vi.fn(),closeRecovery:vi.fn(),failureRows:[row],recoveryRows:[row],failureCount:1,readLoading:false,readError:'',recoveryError:'',refresh:vi.fn(async()=>{}),inspect:vi.fn(async()=>{}),retry:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),discard:vi.fn(async()=>{}),upgrade:vi.fn(async()=>{})};
}
it('긴 실패 원인은 누른 복구 모달 안에서만 표시하고 정확한 관측 entry를 전달한다',()=>{
 const editor=fixture();const view=render(<PalletTransactionRecoveryPanel editor={{...editor,recoveryOpen:false}}/>);expect(screen.queryByText('연결 응답을 받지 못했습니다.')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'실패 1'}));expect(editor.openRecovery).toHaveBeenCalledOnce();view.rerender(<PalletTransactionRecoveryPanel editor={editor}/>);const dialog=screen.getByRole('dialog',{name:'파렛트 작업 처리 확인'});expect(dialog.parentElement).toHaveStyle({zIndex:1100});fireEvent.click(within(dialog).getByRole('button',{name:'보관된 요청 결과 확인'}));expect(editor.inspect).toHaveBeenCalledExactlyOnceWith(entry,reference);fireEvent.click(within(dialog).getByRole('button',{name:'보관된 요청 미처리 중단'}));expect(editor.cancel).toHaveBeenCalledExactlyOnceWith(entry,reference);expect(within(dialog).getByText('원문 A')).toBeInTheDocument();
});
it('식별 불가 손상은 가짜 조회·중단 버튼 없이 기기 정리만 제공한다',()=>{
 const editor=fixture(true);render(<PalletTransactionRecoveryPanel editor={editor}/>);expect(screen.queryByRole('button',{name:/결과 확인$/})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/미처리 중단$/})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'이 기기의 손상 정보만 정리'}));expect(editor.discard).toHaveBeenCalledExactlyOnceWith(editor.recoveryRows[0].entry);expect(editor.inspect).not.toHaveBeenCalled();expect(editor.cancel).not.toHaveBeenCalled();
});
it('종결된 처리 기록은 실패0이어도 중립 진입과 사본 정리 접근을 유지한다',()=>{
 const editor=fixture();editor.failureRows=[];editor.failureCount=0;editor.recoveryRows=editor.recoveryRows.map(row=>({...row,isUnresolved:false,terminal:true,canDiscard:true,canCancel:false,currentState:'이 요청은 처리되었습니다.'}));render(<PalletTransactionRecoveryPanel editor={editor}/>);expect(screen.queryByRole('button',{name:/실패/})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'처리 확인'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'이 기기에 남은 요청 정보 정리'}));expect(editor.discard).toHaveBeenCalledExactlyOnceWith(entry);
});
it('정상 보관0 상태는 실패와 처리 확인 버튼을 모두 숨긴다',()=>{
 const editor=fixture();editor.failureRows=[];editor.recoveryRows=[];editor.failureCount=0;editor.recoveryOpen=false;render(<PalletTransactionRecoveryPanel editor={editor}/>);expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('사람 요약을 모달에 표시하고 기술 원문은 보조 상세로 둔다',()=>{
 const editor=fixture();editor.recoveryRows=editor.recoveryRows.map(row=>({...row,summary:{action:'register' as const,date:'2026-10-21',kind:'교체 지급',quantity:8,returnQty:3,note:'교체 검수',partnerName:'현재 거래처',palletName:'현재 파렛트'}}));render(<PalletTransactionRecoveryPanel editor={editor}/>);expect(screen.getByText('2026-10-21 · 8개 · 회수 예정 3개')).toBeInTheDocument();expect(screen.getByText('현재 목록 이름: 현재 거래처 · 현재 파렛트')).toBeInTheDocument();expect(screen.getByText('비고: 교체 검수')).toBeInTheDocument();expect(screen.getByText('원문 A').closest('details')).toBeInTheDocument();
});
it('교체완료 요약은 원지급과 실제 회수 수량을 구분한다',()=>{
 const editor=fixture();editor.recoveryRows=editor.recoveryRows.map(row=>({...row,summary:{action:'complete-exchange' as const,date:'2026-10-21',kind:'교체완료',quantity:5,returnQty:3,note:'교체 지급',partnerName:'현재 거래처',palletName:'현재 파렛트'}}));render(<PalletTransactionRecoveryPanel editor={editor}/>);expect(screen.getByText('2026-10-21 · 원지급 5개 · 회수 3개')).toBeInTheDocument();expect(screen.getByText('교체완료')).toBeInTheDocument();
});
it('편집 요약은 날짜와 거래수량을 꾸며내지 않고 변경한 필드만 표시한다',()=>{
 const editor=fixture();editor.recoveryRows=editor.recoveryRows.map(row=>({...row,summary:{action:'edit-pallet' as const,palletName:'현재 파렛트',original:{name:'옛 이름',total:10,damaged:0},patch:{name:'새 이름'}}}));render(<PalletTransactionRecoveryPanel editor={editor}/>);expect(screen.getByText('파렛트 정보 수정')).toBeInTheDocument();expect(screen.getByText('변경 내용: 이름: 새 이름')).toBeInTheDocument();expect(screen.queryByText(/원지급|회수 예정/)).not.toBeInTheDocument();
});
