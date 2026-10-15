/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AddPartnerModal from './AddPartnerModal';

describe('신규 거래처 주소', () => {
  it('주소 아래에서 상세주소를 입력해 거래처에 저장한다', () => {
    const save = vi.fn();
    render(<AddPartnerModal onClose={vi.fn()} onSave={save} />);

    fireEvent.change(screen.getByPlaceholderText('예: 태백물산'), { target: { value: '새 거래처' } });
    fireEvent.change(screen.getByLabelText('상세주소'), { target: { value: '가동 201호' } });
    fireEvent.change(screen.getByLabelText('기본 배송방식'), { target: { value: '수령' } });
    fireEvent.click(screen.getByRole('button', { name: '등록 완료' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      name: '새 거래처',
      addressDetail: '가동 201호',
    }));
  });
});

for (const role of ['매출처','매출+매입처']) it(role+' 신규 등록은 배송방식을 직접 선택해야 한다',()=>{
 const save=vi.fn();render(<AddPartnerModal onClose={vi.fn()} onSave={save}/>);
 fireEvent.change(screen.getByPlaceholderText('예: 태백물산'),{target:{value:'가상 거래처'}});
 fireEvent.click(screen.getByRole('button',{name:role}));
 expect(screen.getByLabelText('기본 배송방식')).toHaveValue('');
 fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));expect(save).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('기본 배송방식을 선택해 주세요.');
 fireEvent.change(screen.getByLabelText('기본 배송방식'),{target:{value:'화물'}});
 fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({defaultShipMethod:'화물',partnerType:role}));
});
for(const role of ['매입처','금융기관']) it(role+' 신규 등록은 배송방식이 필요 없다',()=>{
 const save=vi.fn();render(<AddPartnerModal onClose={vi.fn()} onSave={save}/>);
 fireEvent.change(screen.getByPlaceholderText('예: 태백물산'),{target:{value:'가상 거래처'}});
 fireEvent.click(screen.getByRole('button',{name:role}));expect(screen.queryByLabelText('기본 배송방식')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0]).not.toHaveProperty('defaultShipMethod');
});

const deferredSave = () => { let resolve!:(value?:unknown)=>void, reject!:(error:unknown)=>void; const promise=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; };
const fillPartner = () => {fireEvent.change(screen.getByPlaceholderText('예: 태백물산'),{target:{value:'합성 신규 거래처'}});fireEvent.change(screen.getByLabelText('기본 배송방식'),{target:{value:'화물'}});};
it('등록 ACK 전에는 중복 제출·입력·닫기·취소·배경닫기를 막고 ACK 뒤 닫는다',async()=>{
 const pending=deferredSave(),save=vi.fn(()=>pending.promise),close=vi.fn();render(<AddPartnerModal onSave={save} onClose={close}/>);fillPartner();const submit=screen.getByRole('button',{name:'등록 완료'}),form=screen.getByPlaceholderText('예: 태백물산').closest('form')!;
 act(()=>{fireEvent.click(submit);fireEvent.submit(form);fireEvent.submit(form);});expect(save).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();expect(screen.getByPlaceholderText('예: 태백물산')).toBeDisabled();expect(screen.getByLabelText('기본 배송방식')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'신규 거래처 등록 닫기'}));fireEvent.click(screen.getByRole('button',{name:'취소'}));fireEvent.click(screen.getByRole('dialog').parentElement!);expect(close).not.toHaveBeenCalled();
 await act(async()=>pending.resolve());expect(close).toHaveBeenCalledTimes(1);
});
it('등록 응답 거절은 초안과 기본값을 보존하며 같은 창 재시도는 같은 UUID를 쓴다',async()=>{
 const pending=deferredSave(),close=vi.fn(),save=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce('saved');render(<AddPartnerModal onSave={save} onClose={close}/>);fillPartner();fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));const first=save.mock.calls[0][0];expect(first.id).toMatch(/^c-[0-9a-f-]{36}$/);
 await act(async()=>pending.reject(Object.assign(new Error('network unavailable'),{code:'unavailable'})));expect(screen.getByRole('alert')).toHaveTextContent('저장 결과를 확인하지 못했습니다');expect(close).not.toHaveBeenCalled();expect(screen.getByPlaceholderText('예: 태백물산')).toHaveValue('합성 신규 거래처');expect(screen.getByLabelText('기본 배송방식')).toHaveValue('화물');expect(screen.queryByRole('button',{name:'기존 거래처 확인/수정'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));expect(save.mock.calls[1][0]).toEqual(first);
});
it('동기 throw도 잡아 입력을 유지하고 재시도한다',async()=>{const save=vi.fn().mockImplementationOnce(()=>{throw Object.assign(new Error('permission denied'),{code:'permission-denied'});}).mockResolvedValueOnce('ok'),close=vi.fn();render(<AddPartnerModal onSave={save} onClose={close}/>);fillPartner();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'등록 완료'})));expect(screen.getByRole('alert')).toHaveTextContent('거래처 저장 권한');expect(close).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save.mock.calls[0][0].id).toBe(save.mock.calls[1][0].id);});
it('창이 해제된 뒤 온 ACK는 다음 창을 닫지 않고 새 창에는 새 ID를 부여한다',async()=>{const old=deferredSave(),oldClose=vi.fn(),save=vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce('ok');const first=render(<AddPartnerModal onSave={save} onClose={oldClose}/>);fillPartner();fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));const id=save.mock.calls[0][0].id;first.unmount();const newClose=vi.fn();render(<AddPartnerModal onSave={save} onClose={newClose}/>);fillPartner();await act(async()=>old.resolve());expect(oldClose).not.toHaveBeenCalled();expect(newClose).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));await waitFor(()=>expect(newClose).toHaveBeenCalledOnce());expect(save.mock.calls[1][0].id).not.toBe(id);});
it('동일회사 충돌은 자동 폐기하지 않고 명시 확인 버튼으로만 현재 거래처를 연다',async()=>{const open=vi.fn(),close=vi.fn(),save=vi.fn(p=>Promise.reject({code:'partner-registration-conflict',partnerId:p.id,existingPartner:{id:p.id,name:'서버의 현재 거래처',type:'일반',defaultShipMethod:'수령'}}));render(<AddPartnerModal onSave={save} onClose={close} onOpenExisting={open}/>);fillPartner();fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));await screen.findByRole('button',{name:'기존 거래처 확인/수정'});expect(open).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(screen.getByPlaceholderText('예: 태백물산')).toHaveValue('합성 신규 거래처');fireEvent.click(screen.getByRole('button',{name:'기존 거래처 확인/수정'}));expect(open).toHaveBeenCalledWith(expect.objectContaining({name:'서버의 현재 거래처',defaultShipMethod:'수령'}));expect(close).toHaveBeenCalledOnce();});
it('현재 스냅샷이 없는 충돌은 기존 거래처 열기 버튼이나 타회사 자료를 내보내지 않는다',async()=>{const save=vi.fn(p=>Promise.reject({code:'partner-registration-conflict',partnerId:p.id}));render(<AddPartnerModal onSave={save} onClose={vi.fn()} onOpenExisting={vi.fn()}/>);fillPartner();fireEvent.click(screen.getByRole('button',{name:'등록 완료'}));await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'기존 거래처 확인/수정'})).not.toBeInTheDocument();expect(screen.getByPlaceholderText('예: 태백물산')).toHaveValue('합성 신규 거래처');});
