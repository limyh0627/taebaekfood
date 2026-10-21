/** @vitest-environment jsdom */
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useOpeningDetailEditors } from './useOpeningDetailEditors';
const ports = vi.hoisted(() => ({ partner: vi.fn(), inventory: vi.fn(), notice: vi.fn() }));
vi.mock('../../../shared/services/firebaseService', () => ({ createOpeningPartnerBalance: ports.partner, createOpeningInventory: ports.inventory }));
vi.mock('../../../shared/components/appDialog', () => ({ appNotice: ports.notice }));
beforeEach(() => { ports.partner.mockReset().mockResolvedValue('created'); ports.inventory.mockReset().mockResolvedValue('created'); ports.notice.mockReset().mockResolvedValue(undefined); });
const options = { companyId: 'taebaek' as 'taebaek' | 'punghoe', openingDate: '2026-01-02' as string | null, openingReady: true };
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((r,j) => { resolve=r;reject=j; }); return {promise,resolve,reject}; };
function fill(result: {current: ReturnType<typeof useOpeningDetailEditors>}) {
    act(() => { result.current.partner.change('partnerId','p'); result.current.partner.change('code','251'); result.current.partner.change('amount','1,200원'); result.current.inventory.change('itemId','item'); result.current.inventory.change('quantity','1,234.5개'); result.current.inventory.change('value','20,000원'); });
}
it('최초 문서 조회 전 입력은 송신하지 않고 조회 완료 뒤에도 임의 초기화하지 않는다',async()=>{
    const {result,rerender}=renderHook(props=>useOpeningDetailEditors(props),{initialProps:{...options,openingDate:null,openingReady:false} as typeof options});fill(result);
    expect(result.current.partner.canSubmit).toBe(false);expect(result.current.inventory.canSubmit).toBe(false);await act(async()=>{await result.current.partner.save();await result.current.inventory.save();});expect(ports.partner).not.toHaveBeenCalled();expect(ports.inventory).not.toHaveBeenCalled();
    rerender(options);
    expect(result.current.partner.draft.amount).toBe('1,200');expect(result.current.inventory.draft.quantity).toBe('1,234.5');expect(result.current.partner.canSubmit).toBe(true);
});
it('두 폼은 독립 잠금으로 같은 tick에 각각 한 번만 고정 payload를 보낸다',async()=>{
    const p=deferred<string>(),i=deferred<string>();ports.partner.mockReturnValueOnce(p.promise);ports.inventory.mockReturnValueOnce(i.promise);const {result}=renderHook(()=>useOpeningDetailEditors(options));fill(result);let first!:Promise<void>,second!:Promise<void>;
    act(()=>{first=result.current.partner.save();void result.current.partner.save();second=result.current.inventory.save();void result.current.inventory.save();});
    expect(ports.partner).toHaveBeenCalledExactlyOnceWith('taebaek','2026-01-02','p','251',1200);expect(ports.inventory).toHaveBeenCalledExactlyOnceWith('taebaek','2026-01-02','item',1234.5,20000);expect(result.current.partner.saving).toBe(true);expect(result.current.inventory.saving).toBe(true);
    act(()=>{result.current.partner.change('amount','9');result.current.inventory.change('quantity','9');});expect(result.current.partner.draft.amount).toBe('1,200');expect(result.current.inventory.draft.quantity).toBe('1,234.5');
    await act(async()=>{p.resolve('created');await first;});expect(result.current.partner.draft.amount).toBe('');expect(result.current.partner.draft.code).toBe('251');expect(result.current.inventory.saving).toBe(true);
    await act(async()=>{i.resolve('unchanged');await second;});expect(result.current.inventory.draft.quantity).toBe('1,234.5');expect(result.current.inventory.saving).toBe(false);
});
it('회사 왕복 뒤 옛 응답과 finally는 새 폼과 새 저장을 건드리지 않는다',async()=>{
    const old=deferred<string>(),fresh=deferred<string>();ports.partner.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);const {result,rerender}=renderHook(props=>useOpeningDetailEditors(props),{initialProps:options});fill(result);let first!:Promise<void>;act(()=>{first=result.current.partner.save();});rerender({...options,companyId:'punghoe'});expect(result.current.partner.draft).toEqual({partnerId:'',code:'108',amount:''});expect(result.current.partner.saving).toBe(false);rerender(options);fill(result);let next!:Promise<void>;act(()=>{next=result.current.partner.save();});await act(async()=>{old.resolve('created');await first;});expect(result.current.partner.saving).toBe(true);expect(result.current.partner.draft.amount).toBe('1,200');expect(ports.notice).not.toHaveBeenCalled();await act(async()=>{fresh.resolve('created');await next;});expect(result.current.partner.saving).toBe(false);
});
it('기준일만 바뀌어도 옛 성공의 통지·안내·입력 정리는 막고 자기 잠금은 끝낸다',async()=>{
    const reply=deferred<string>(),applied=vi.fn();ports.inventory.mockReturnValueOnce(reply.promise);const {result,rerender}=renderHook(props=>useOpeningDetailEditors({...props,onInventoryApplied:applied}),{initialProps:options});fill(result);let save!:Promise<void>;act(()=>{save=result.current.inventory.save();});rerender({...options,openingDate:'2026-02-03'});await act(async()=>{reply.resolve('created');await save;});expect(applied).not.toHaveBeenCalled();expect(ports.notice).not.toHaveBeenCalled();expect(result.current.inventory.draft.quantity).toBe('1,234.5');expect(result.current.inventory.saving).toBe(false);expect(result.current.inventory.canSubmit).toBe(true);
});
it('알림 await 뒤 새 회사 입력을 지우거나 새 실행 잠금을 풀지 않는다',async()=>{
    const notice=deferred<void>();ports.notice.mockReturnValueOnce(notice.promise);const {result,rerender}=renderHook(props=>useOpeningDetailEditors(props),{initialProps:options});fill(result);let save!:Promise<void>;await act(async()=>{save=result.current.partner.save();await Promise.resolve();});expect(ports.notice).toHaveBeenCalledOnce();rerender({...options,companyId:'punghoe'});fill(result);await act(async()=>{notice.resolve();await save;});expect(result.current.partner.draft.amount).toBe('1,200');expect(result.current.partner.saving).toBe(false);
});
it('StrictMode 정상 마운트의 저장은 각 한 번 처리하고 재고는 좁은 통지만 전달한다',async()=>{
    const applied=vi.fn(),wrapper=({children}:{children:React.ReactNode})=><React.StrictMode>{children}</React.StrictMode>;const {result}=renderHook(()=>useOpeningDetailEditors({...options,onInventoryApplied:applied}),{wrapper});fill(result);await act(async()=>{await result.current.partner.save();await result.current.inventory.save();});expect(ports.partner).toHaveBeenCalledOnce();expect(ports.inventory).toHaveBeenCalledOnce();expect(applied).toHaveBeenCalledExactlyOnceWith('taebaek','2026-01-02');expect(result.current.partner.saving).toBe(false);expect(result.current.inventory.draft).toEqual({itemId:'',quantity:'',value:''});
});
it('실제 unmount 뒤 재마운트한 새 폼은 옛 거절과 응답으로 변경되지 않는다',async()=>{
    const reply=deferred<string>();ports.inventory.mockReturnValueOnce(reply.promise);const first=renderHook(()=>useOpeningDetailEditors(options));fill(first.result);let save!:Promise<void>;act(()=>{save=first.result.current.inventory.save();});first.unmount();const next=renderHook(()=>useOpeningDetailEditors(options));fill(next.result);await act(async()=>{reply.reject(Error('옛 오류'));await save;});expect(ports.notice).not.toHaveBeenCalled();expect(next.result.current.inventory.draft.quantity).toBe('1,234.5');expect(next.result.current.inventory.saving).toBe(false);
});
