/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useOrderEditApplication } from '../hooks/useOrderEditApplication';
import { OrderEditRecovery } from './OrderEditRecovery';
import type { SaveOutcome } from '../../../shared/saveOutcome';
it('대상별 보관 계획은 정확한 plan·target으로 조회하고 저장을 다시 보내지 않는다', async () => {
    let pending = [{ id: 'a', planId: 'a-plan', description: 'A 보관 수정' }];
    const save = vi.fn(), inspect = vi.fn(async (): Promise<SaveOutcome> => {
        pending = [];
        return { status: 'saved' };
    });
    function View() {
        const application = useOrderEditApplication({ scopeKey: 'company:uid', onSaveOrderEdit: save, onReadPendingOrderEdits: () => pending, onInspectOrderEdit: inspect });
        return <><section aria-label="A 복구"><OrderEditRecovery application={application} orderId="a"/></section><section aria-label="B 복구"><OrderEditRecovery application={application} orderId="b"/></section></>;
    }
    render(<View />);
    expect(within(screen.getByRole('region', { name: 'B 복구' })).queryByRole('button')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '주문 수정 결과 확인' })));
    expect(inspect).toHaveBeenCalledExactlyOnceWith('a-plan', 'a');
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '주문 수정 결과 확인' })).toBeNull();
});
it('손상된 원문도 해당target 참조만 명시적으로 중단한다', async () => {
    const cancel = vi.fn(async (): Promise<SaveOutcome> => ({ status: 'cancelled', message: '요청을 중단했습니다.' }));
    function View() {
        const application = useOrderEditApplication({ scopeKey: 'company:uid', onReadOrderEditReferences: () => [{ id: 'a', planId: 'damaged', readable: false }], onCancelOrderEditReference: cancel });
        return <OrderEditRecovery application={application} orderId="a"/>;
    }
    render(<View />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '손상된 주문 수정 요청 중단' })));
    expect(cancel).toHaveBeenCalledExactlyOnceWith('damaged', 'a');
});
it('한 주문의 미확정 안내는 다른 주문에 복제하지 않는다', async () => {
    function View() {
        const application = useOrderEditApplication({ scopeKey: 'scope', onReadPendingOrderEdits: () => [{ id: 'a', planId: 'plan', description: '수정 요청' }], onInspectOrderEdit: async () => ({ status: 'unknown', message: 'A 응답 미확인', nextAction: 'A 결과를 확인하세요' }) });
        return <><section aria-label="A 영역"><OrderEditRecovery application={application} orderId="a"/></section><section aria-label="B 영역"><OrderEditRecovery application={application} orderId="b"/></section></>;
    }
    render(<View />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '주문 수정 결과 확인' })));
    expect(within(screen.getByRole('region', { name: 'A 영역' })).getByText(/A 응답 미확인/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'B 영역' })).queryByText(/A 응답 미확인/)).toBeNull();
});

it('관측한 사본만 명시 정리하고 손상 참조도 결과 확인을 제공한다',async()=>{
 const discard=vi.fn(async():Promise<SaveOutcome>=>({status:'saved'})),inspect=vi.fn(async():Promise<SaveOutcome>=>({status:'unknown',message:'확인중',nextAction:'중단'}));
 function View(){const application=useOrderEditApplication({scopeKey:'scope',onReadPendingOrderEdits:()=>[{id:'a',planId:'valid',description:'유효',observedLocalText:'관측원문'}],onReadOrderEditReferences:()=>[{id:'b',planId:'broken',readable:false}],onDiscardOrderEditCopy:discard,onInspectOrderEdit:inspect});return <OrderEditRecovery application={application} allTargets/>;}
 render(<View/>);expect(screen.getAllByRole('button',{name:'이 기기 사본만 정리'})).toHaveLength(1);
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이 기기 사본만 정리'})));expect(discard).toHaveBeenCalledExactlyOnceWith('valid','a','관측원문');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'손상된 주문 수정 결과 확인'})));expect(inspect).toHaveBeenCalledExactlyOnceWith('broken','b');
});

it('마지막 사본 정리 뒤에도 완료 status를 남기고 새 저장이나 닫기를 호출하지 않는다',async()=>{
 let pending=[{id:'a',planId:'old',description:'보관',observedLocalText:'raw'}];const save=vi.fn(),discard=vi.fn(async():Promise<SaveOutcome>=>{pending=[];return {status:'saved'};});
 function View(){const application=useOrderEditApplication({scopeKey:'scope',onSaveOrderEdit:save,onReadPendingOrderEdits:()=>pending,onDiscardOrderEditCopy:discard});return <OrderEditRecovery application={application} allTargets/>;}
 render(<View/>);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'이 기기 사본만 정리'})));
 expect(screen.getByRole('status')).toHaveTextContent('이 기기 사본만 정리');expect(screen.queryByRole('button')).toBeNull();expect(save).not.toHaveBeenCalled();
});
