/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Partner } from '../../../shared/types';
import { PartnerEditModal } from './PartnerEditModal';
import PartnerManager from '../../../../components/PartnerManager';
import { partnerEditWrites } from '../../../shared/services/partnerEditWrites';
const authFixture = vi.hoisted(() => ({ currentUser: { uid: 'actor-a' } }));
vi.mock('../../../shared/firebase', () => ({ auth: authFixture, authReady: Promise.resolve(), functions: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { callback(authFixture.currentUser); return () => { }; } }));
const partner: Partner = { id: 'p', name: '합성 거래처', type: '일반', phone: '옛전화', address: '기존 주소' };
it('제어 입력은 모바일·전화 동시 갱신과 저장·삭제·주소·닫기 원콜백을 유지한다', () => {
    let latest: Partner | null = partner;
    const setEditForm: React.Dispatch<React.SetStateAction<Partner | null>> = value => { latest = typeof value === 'function' ? value(latest) : value; };
    const onSave = vi.fn(), onDelete = vi.fn(), onSearchAddress = vi.fn(), onClose = vi.fn();
    render(<PartnerEditModal editForm={partner} setEditForm={setEditForm} isSaving={false} saveError="저장 오류" onSave={onSave} onDelete={onDelete} onSearchAddress={onSearchAddress} onClose={onClose}/>);
    expect(screen.getByPlaceholderText('010-0000-0000')).toHaveValue('옛전화');
    fireEvent.change(screen.getByPlaceholderText('010-0000-0000'), { target: { value: '새전화' } });
    expect(latest).toEqual({ ...partner, mobile: '새전화', phone: '새전화' });
    expect(screen.getByLabelText('기본 배송방식')).toHaveValue('');
    fireEvent.change(screen.getByPlaceholderText('메모, 특이사항 등'), { target: { value: '메모' } });
    expect(latest?.note).toBe('메모');
    for (const name of ['저장', '삭제', '검색', '취소'])
        fireEvent.click(screen.getByRole('button', { name }));
    for (const cb of [onSave, onDelete, onSearchAddress, onClose])
        expect(cb).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('저장 오류');
});
it('금융기관 안내·유형별 배송 노출과 저장중 fieldset 동결을 유지한다', () => {
    const props = { editForm: { ...partner, partnerType: '금융기관' as const }, setEditForm: vi.fn(), isSaving: true, saveError: '', onClose: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onSearchAddress: vi.fn() };
    render(<PartnerEditModal {...props}/>);
    expect(screen.getByText('빌리고 갚는 상대')).toBeInTheDocument();
    expect(screen.queryByLabelText('기본 배송방식')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByPlaceholderText('거래처명')).toBeDisabled();
    expect(screen.getByRole('button', { name: '검색' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled();
});
it('같은 거래처를 취소 후 다시 열어도 이전 주소검색 세대의 응답은 새 초안을 바꾸지 않는다', async () => {
    let complete!: (data: {
        address: string;
    }) => void;
    window.daum = { Postcode: class {
            constructor(config: {
                oncomplete: (data: {
                    address: string;
                }) => void;
            }) { complete = config.oncomplete; }
            open() { }
        } };
    const bindings = { ...partnerEditWrites, read: vi.fn<typeof partnerEditWrites.read>(async () => []), open: vi.fn<typeof partnerEditWrites.open>(async (scope, reference, opening) => ({ reference, actorUid: scope.actorUid, opening, expectedVersion: '1:000000000' })) } satisfies typeof partnerEditWrites;
    render(<PartnerManager companyId="taebaek" actorUid="actor-a" partners={[partner]} partnerEditBindings={bindings} onAddClient={vi.fn()}/>);
    await act(async () => { await Promise.resolve(); fireEvent.click(screen.getByRole('button', { name: '합성 거래처 수정' })); });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(screen.getByRole('button', { name: '합성 거래처 수정' }));
    act(() => complete({ address: '이전 세대 주소' }));
    expect(screen.getByPlaceholderText('주소 검색 버튼을 눌러주세요')).toHaveValue('기존 주소');
});
