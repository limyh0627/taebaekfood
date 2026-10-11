/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
const mocks=vi.hoisted(()=>({save:vi.fn(),subscribe:vi.fn()}));
vi.mock('../../shared/services/itemPurchaseUnitService',()=>({saveItemPurchaseUnit:(...args:unknown[])=>mocks.save(...args),subscribeItemPurchaseUnits:(...args:unknown[])=>mocks.subscribe(...args)}));
vi.mock('../../shared/components/ModalShell',()=>({default:({children}:any)=><div>{children}</div>}));
import PurchaseUnitManagerModal from './PurchaseUnitManagerModal';
import type { Item } from '../../shared/types';
beforeEach(()=>{vi.clearAllMocks();mocks.subscribe.mockImplementation((_company:string,onData:any)=>{onData([]);return()=>{};});});
afterEach(cleanup);
it('등록 응답이 끊겨도 재시도는 같은 문서 ID와 생성시각을 쓴다',async()=>{
 mocks.save.mockRejectedValueOnce(Error('응답을 확인하지 못했습니다.')).mockResolvedValue(undefined);
 render(<PurchaseUnitManagerModal companyId="taebaek" item={{id:'raw',name:'들깨'} as Item} partners={[]} onClose={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText('매입단위 이름'),{target:{value:'포대'}});fireEvent.change(screen.getByLabelText('한 단위의 실제 중량 kg'),{target:{value:'22.5'}});fireEvent.click(screen.getByText('저장'));
 await screen.findByText('응답을 확인하지 못했습니다.');const first=mocks.save.mock.calls[0][0];expect(first).toMatchObject({companyId:'taebaek',itemId:'raw',purchaseUnit:'포대',unitKg:22.5});expect(screen.getByLabelText('매입단위 이름')).toHaveValue('포대');
 fireEvent.click(screen.getByText('저장'));await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2));const second=mocks.save.mock.calls[1][0];expect(second.id).toBe(first.id);expect(second.createdAt).toBe(first.createdAt);
 await waitFor(()=>expect(screen.getByLabelText('매입단위 이름')).toHaveValue(''));
 fireEvent.change(screen.getByLabelText('매입단위 이름'),{target:{value:'큰포대'}});fireEvent.change(screen.getByLabelText('한 단위의 실제 중량 kg'),{target:{value:'25'}});fireEvent.click(screen.getByText('저장'));await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(3));expect(mocks.save.mock.calls[2][0].id).not.toBe(first.id);
});
