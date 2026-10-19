// JSDOM에는 펼친 목록의 스크롤 API가 없어 브라우저 동작만 대체한다.
/** @vitest-environment jsdom */
import React from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import type { DirectoryDeleteInput, DirectoryDeletePrepared, DirectoryDeleteOutcome, PendingDirectoryDelete } from '../src/shared/services/directoryDeleteWrites';
import ActualPartnerManager from './PartnerManager';
import type { Partner } from '../types';
import { partnerEditOpening, decodePartnerEditOpening } from '../src/shared/partnerEditCommand';
import type { PartnerEditBindings, PartnerEditEntry, PartnerEditObservation } from '../src/shared/services/partnerEditWrites';
import { partnerSaveErrorMessage } from './AddPartnerModal';
const authFixture = vi.hoisted(() => ({ currentUser: { uid: 'actor-a' }, listeners: new Set<(user: {
        uid: string;
    }) => void>() }));
vi.mock('../src/shared/firebase', () => ({ auth: authFixture, authReady: Promise.resolve(), functions: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: {
        uid: string;
    }) => void) => { authFixture.listeners.add(callback); callback(authFixture.currentUser); return () => { authFixture.listeners.delete(callback); }; } }));
function PartnerManager({ onUpdateClient, ...input }: Omit<React.ComponentProps<typeof ActualPartnerManager>, 'partnerEditBindings'> & {
    onUpdateClient: (row: Partner) => unknown;
}) {
    const latest = React.useRef({ onUpdateClient, input });
    latest.current = { onUpdateClient, input };
    const actor = input.requestScopeKey || 'actor-a';
    authFixture.currentUser.uid = actor;
    React.useEffect(() => { authFixture.listeners.forEach(callback => callback({ ...authFixture.currentUser })); }, [actor]);
    const bindings = React.useMemo<PartnerEditBindings>(() => {
        let entries: PartnerEditEntry[] = [];
        const originals = new Map<string, Partner>();
        return {
            open: vi.fn<PartnerEditBindings['open']>(async (scope, reference, opening) => { const raw = decodePartnerEditOpening(opening); originals.set(reference.planId, { ...raw, id: reference.targetId } as Partner); return { reference, actorUid: scope.actorUid, opening, expectedVersion: '1:000000000' }; }),
            read: vi.fn<PartnerEditBindings['read']>(async () => entries), prepare: vi.fn<PartnerEditBindings['prepare']>(async (_scope, request) => { const entry: PartnerEditEntry = { key: request.reference.planId, reference: request.reference, request, requestHash: 'a'.repeat(64), referenceHash: 'a'.repeat(64), observedLocalText: JSON.stringify(request), observedReferenceText: JSON.stringify(request.reference), status: 'valid', description: '거래처 수정 · ' + request.reference.targetId }; entries = [entry]; return entry; }),
            command: vi.fn<PartnerEditBindings['command']>(async (_scope, entry, mode) => {
                try {
                    if (mode === 'apply')
                        await latest.current.onUpdateClient({ ...originals.get(entry.reference!.planId), ...entry.request!.patch, id: entry.reference!.targetId } as Partner);
                    entries = [];
                    return { terminal: true, outcome: mode === 'cancel' ? { status: 'cancelled', message: '미처리 요청을 중단했습니다.', nextAction: '현재 거래처를 다시 열어 주세요.' } : { status: 'saved' }, result: { version: 1, reference: entry.reference!, actorUid: authFixture.currentUser.uid, status: mode === 'cancel' ? 'cancelled' : 'applied', requestHash: entry.requestHash, message: '거래처 수정 결과를 확인했습니다.' } };
                }
                catch (error) {
                    return { terminal: false, outcome: { status: 'unknown', message: partnerSaveErrorMessage(error), nextAction: '같은 요청의 결과를 확인하거나 재시도해 주세요.' } };
                }
            }),
            discard: vi.fn<PartnerEditBindings['discard']>(async () => { entries = []; return { status: 'cleared', message: '이 기기의 사본만 정리했습니다.' }; }), history: vi.fn<PartnerEditBindings['history']>(async (scope) => ({ version: 1, companyId: scope.companyId, actorUid: scope.actorUid, entries: [], nextCursor: null }))
        };
    }, []);
    return <ActualPartnerManager {...input} companyId="taebaek" actorUid={actor} partnerEditBindings={bindings}/>;
}
async function click(element: HTMLElement) { await act(async () => { await Promise.resolve(); fireEvent.click(element); }); }
HTMLElement.prototype.scrollIntoView = vi.fn();
const partner = { id: 'p', name: '가상 거래처', type: '일반', partnerType: '매출처', shipTos: [{ id: 's', name: '기존 창고' }] } as Partner;
const props = { onAddClient: vi.fn() };
it('기존 미설정 표시는 무관한 거래처 수정 저장을 막지 않는다', async () => {
    const save = vi.fn();
    render(<PartnerManager {...props} partners={[partner]} onUpdateClient={save}/>);
    expect(screen.getByText('기본 배송방식: 미설정')).toBeInTheDocument();
    await click(screen.getByRole('button', { name: '가상 거래처 수정' }));
    expect(screen.getByLabelText('기본 배송방식')).toHaveValue('');
    fireEvent.change(screen.getByPlaceholderText('메모, 특이사항 등'), { target: { value: '연락 메모' } });
    await click(screen.getByRole('button', { name: '저장' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ note: '연락 메모' }));
    expect(save.mock.calls[0][0]).not.toHaveProperty('defaultShipMethod');
});
it('거래처와 배송지별 기본값을 각각 저장하고 매입처에는 거래처 설정을 보이지 않는다', async () => { const save = vi.fn(); const view = render(<PartnerManager {...props} partners={[partner]} onUpdateClient={save}/>); await click(screen.getByRole('button', { name: '가상 거래처 수정' })); fireEvent.change(screen.getByLabelText('기본 배송방식'), { target: { value: '수령' } }); fireEvent.change(screen.getByLabelText('기존 창고 기본 배송방식'), { target: { value: '화물' } }); await click(screen.getByRole('button', { name: '저장' })); expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultShipMethod: '수령', shipTos: [expect.objectContaining({ defaultShipMethod: '화물' })] })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); view.rerender(<PartnerManager {...props} partners={[{ ...partner, partnerType: '매입처' }]} onUpdateClient={save}/>); await click(screen.getByRole('button', { name: '가상 거래처 수정' })); expect(screen.queryByLabelText('기본 배송방식')).not.toBeInTheDocument(); });
const pendingUpdate = () => { let resolve!: (value?: unknown) => void, reject!: (error: unknown) => void; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const editPartner = async () => await click(screen.getByRole('button', { name: '가상 거래처 수정' }));
it('수정은 ACK 전 닫기와 중복저장을 차단하며 기본값·배송지 입력을 동결한다', async () => { const pending = pendingUpdate(), save = vi.fn(() => pending.promise); render(<PartnerManager {...props} partners={[partner]} onUpdateClient={save}/>); await editPartner(); fireEvent.change(screen.getByLabelText('기본 배송방식'), { target: { value: '화물' } }); fireEvent.change(screen.getByLabelText('기존 창고 기본 배송방식'), { target: { value: '수령' } }); const submit = screen.getByRole('button', { name: '저장' }); await act(async () => { fireEvent.click(submit); fireEvent.click(submit); }); expect(save).toHaveBeenCalledOnce(); expect(screen.getByLabelText('기본 배송방식')).toBeDisabled(); expect(screen.getByLabelText('기존 창고 기본 배송방식')).toBeDisabled(); await click(screen.getByRole('button', { name: '거래처 수정 닫기' })); await click(screen.getByRole('button', { name: '취소' })); await click(screen.getByRole('dialog').parentElement!); expect(screen.getByRole('dialog')).toBeInTheDocument(); await act(async () => pending.resolve()); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
it('수정 실패는 배송기본·배송지·비고를 보존하며 명시 재시도 성공 뒤 닫는다', async () => { const pending = pendingUpdate(), save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined); render(<PartnerManager {...props} partners={[partner]} onUpdateClient={save}/>); await editPartner(); fireEvent.change(screen.getByLabelText('기본 배송방식'), { target: { value: '화물' } }); fireEvent.change(screen.getByLabelText('기존 창고 기본 배송방식'), { target: { value: '수령' } }); fireEvent.change(screen.getByPlaceholderText('메모, 특이사항 등'), { target: { value: '초안 보존' } }); await click(screen.getByRole('button', { name: '저장' })); await act(async () => pending.reject(Object.assign(new Error('connection timeout'), { code: 'deadline-exceeded' }))); expect(screen.getByRole('button', { name: '실패 1' })).toBeInTheDocument(); expect(screen.getByLabelText('기본 배송방식')).toHaveValue('화물'); expect(screen.getByLabelText('기존 창고 기본 배송방식')).toHaveValue('수령'); expect(screen.getByPlaceholderText('메모, 특이사항 등')).toHaveValue('초안 보존'); expect(screen.queryByRole('button', { name: '기존 거래처 확인/수정' })).not.toBeInTheDocument(); await click(screen.getByRole('button', { name: '실패 1' })); await click(screen.getByRole('button', { name: '같은 요청 재시도' })); expect(screen.queryByRole('dialog', { name: '거래처 수정' })).toBeNull(); expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]); });
for (const [code, message] of [['permission-denied', '저장 권한'], ['unauthenticated', '로그인 상태'], ['not-found', '목록에서 거래처가 존재']])
    it('수정 ' + code + '는 원인과 복구행동을 알리고 새 거래처를 만들지 않는다', async () => { const save = vi.fn(() => { throw Object.assign(new Error('SDK error'), { code }); }), add = vi.fn(); render(<PartnerManager {...props} onAddClient={add} partners={[partner]} onUpdateClient={save}/>); await editPartner(); fireEvent.change(screen.getByPlaceholderText('메모, 특이사항 등'), { target: { value: '명시 변경' } }); await act(async () => await click(screen.getByRole('button', { name: '저장' }))); await click(screen.getByRole('button', { name: '실패 1' })); expect(screen.getByText(new RegExp(message))).toBeInTheDocument(); expect(screen.getByRole('dialog', { name: '거래처 수정' })).toBeInTheDocument(); expect(add).not.toHaveBeenCalled(); });
it('신규 등록은 부모에서도 ACK를 기다리고 충돌 확인을 누를 때만 서버 현재값의 수정창을 연다', async () => { const pending = pendingUpdate(), add = vi.fn((_partner: Partner) => pending.promise); render(<PartnerManager {...props} onAddClient={add} partners={[partner]} onUpdateClient={vi.fn()}/>); await click(screen.getByRole('button', { name: '거래처 등록' })); fireEvent.change(screen.getByPlaceholderText('예: 태백물산'), { target: { value: '새 초안' } }); fireEvent.change(screen.getByLabelText('기본 배송방식'), { target: { value: '화물' } }); await click(screen.getByRole('button', { name: '등록 완료' })); expect(screen.getByRole('dialog', { name: '신규 거래처 등록' })).toBeInTheDocument(); const id = add.mock.calls[0][0].id; await act(async () => pending.reject({ code: 'partner-registration-conflict', partnerId: id, existingPartner: { ...partner, id, name: '서버 최신 거래처', defaultShipMethod: '수령', shipTos: [{ id: 'current', name: '서버 창고', defaultShipMethod: '택배' }] } })); expect(screen.queryByRole('dialog', { name: '거래처 수정' })).not.toBeInTheDocument(); expect(screen.getByPlaceholderText('예: 태백물산')).toHaveValue('새 초안'); await click(screen.getByRole('button', { name: '기존 거래처 확인/수정' })); expect(screen.queryByRole('dialog', { name: '신규 거래처 등록' })).not.toBeInTheDocument(); expect(screen.getByRole('dialog', { name: '거래처 수정' })).toBeInTheDocument(); expect(screen.getByPlaceholderText('거래처명')).toHaveValue('서버 최신 거래처'); expect(screen.getByLabelText('기본 배송방식')).toHaveValue('수령'); expect(screen.getByLabelText('서버 창고 기본 배송방식')).toHaveValue('택배'); });
it('부모 신규 wrapper는 성공 ACK 전에 닫지 않고 성공 뒤에만 닫는다', async () => { const pending = pendingUpdate(); render(<PartnerManager {...props} onAddClient={() => pending.promise} partners={[partner]} onUpdateClient={vi.fn()}/>); await click(screen.getByRole('button', { name: '거래처 등록' })); fireEvent.change(screen.getByPlaceholderText('예: 태백물산'), { target: { value: '새 거래처' } }); fireEvent.change(screen.getByLabelText('기본 배송방식'), { target: { value: '화물' } }); await click(screen.getByRole('button', { name: '등록 완료' })); expect(screen.getByRole('dialog')).toBeInTheDocument(); await act(async () => pending.resolve()); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
it('해제된 수정창의 늦은 ACK가 다음 관리 화면의 초안을 닫지 않는다', async () => { const pending = pendingUpdate(); const first = render(<PartnerManager {...props} partners={[partner]} onUpdateClient={() => pending.promise}/>); await editPartner(); fireEvent.change(screen.getByPlaceholderText('메모, 특이사항 등'), { target: { value: '첫 저장' } }); await click(screen.getByRole('button', { name: '저장' })); first.unmount(); render(<PartnerManager {...props} partners={[partner]} onUpdateClient={vi.fn()}/>); await editPartner(); fireEvent.change(screen.getByLabelText('기본 배송방식'), { target: { value: '화물' } }); await act(async () => pending.resolve()); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(screen.getByLabelText('기본 배송방식')).toHaveValue('화물'); });
it('취소한 수정창의 늦은 주소검색 완료는 다음 거래처 초안을 바꾸지 않는다', async () => {
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
    const second = { ...partner, id: 'second', name: '둘째 합성 거래처', address: '둘째 주소' };
    render(<PartnerManager {...props} partners={[partner, second]} onUpdateClient={vi.fn()}/>);
    await editPartner();
    await click(screen.getByRole('button', { name: '검색' }));
    await click(screen.getByRole('button', { name: '취소' }));
    await click(screen.getByRole('button', { name: '둘째 합성 거래처 수정' }));
    act(() => complete({ address: '늦은 옛 주소' }));
    expect(screen.getByPlaceholderText('주소 검색 버튼을 눌러주세요')).toHaveValue('둘째 주소');
});
it('보관된 거래처만 목록·검색·분류와 유형 개수에서 제외하고 원연결은 보존한다', async () => {
    const rows: Partner[] = [{ ...partner, id: 'parent', name: '해피유통', archived: false, shipTos: [{ id: 'old', name: '쿠팡' }] }, { ...partner, id: 'legacy', name: '옛 미지정 거래처' }, { ...partner, id: 'old', name: '해피유통(쿠팡)', archived: true }];
    const before = JSON.stringify(rows), update = vi.fn(), remove = vi.fn();
    render(<PartnerManager {...props} onConfirmDirectoryDelete={remove} partners={rows} onUpdateClient={update}/>);
    expect(screen.getByRole('button', { name: /^전체\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^매출처\s*2$/ })).toBeInTheDocument();
    await click(screen.getByRole('button', { name: '거래처 유형' }));
    expect(screen.getByRole('option', { name: /^일반 거래처\s*2$/ })).toBeInTheDocument();
    await click(screen.getByRole('option', { name: '전체' }));
    expect(screen.getByRole('heading', { name: '해피유통' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '옛 미지정 거래처' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '해피유통(쿠팡)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '해피유통(쿠팡) 수정' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('전체 거래처 검색...'), { target: { value: '해피유통(쿠팡)' } });
    expect(screen.getByText(/에 대한 검색 결과가 없습니다/)).toBeInTheDocument();
    expect(JSON.stringify(rows)).toBe(before);
    expect(rows[0].shipTos?.[0].id).toBe('old');
    expect(remove).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
});
it('제목 다음 분류·등록·검색 순서를 유지하고 채널 선택과 검색 초기화는 목록만 복원한다', async () => {
    const add = vi.fn(), update = vi.fn(), rows: Partner[] = [{ ...partner, id: 'general', name: '일반 합성' }, { ...partner, id: 'store', name: '스토어 합성', type: '스마트스토어' }, { ...partner, id: 'buy', name: '매입 합성', partnerType: '매입처' }];
    render(<PartnerManager {...props} partners={rows} onAddClient={add} onUpdateClient={update}/>);
    const title = screen.getByRole('heading', { name: '거래처 관리' }), tab = screen.getByRole('button', { name: /^전체\s*3$/ }), create = screen.getByRole('button', { name: '거래처 등록' }), panel = screen.getByRole('region', { name: '검색조건' });
    expect(title.compareDocumentPosition(tab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tab.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(create.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click(screen.getByRole('button', { name: '거래처 유형' }));
    await click(screen.getByRole('option', { name: /^일반 거래처\s*2$/ }));
    expect(screen.queryByRole('heading', { name: '스토어 합성' })).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: '거래처 유형' }));
    await click(screen.getByRole('option', { name: '전체' }));
    expect(screen.getByRole('heading', { name: '스토어 합성' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('전체 거래처 검색...'), { target: { value: '없는 거래처' } });
    expect(screen.queryByRole('heading', { name: '일반 합성' })).not.toBeInTheDocument();
    await click(screen.getByRole('button', { name: '초기화' }));
    expect(screen.getByRole('heading', { name: '일반 합성' })).toBeInTheDocument();
    await click(screen.getByRole('button', { name: /^매입처\s*1$/ }));
    expect(screen.queryByRole('button', { name: /^일반 거래처/ })).not.toBeInTheDocument();
    await click(create);
    expect(screen.getByRole('dialog', { name: '신규 거래처 등록' })).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
});
const deleteReference = { companyId: 'taebaek' as const, planId: 'partner-delete-plan', kind: 'partner' as const, targetId: partner.id };
async function openPartnerDelete() { await editPartner(); await click(within(screen.getByRole('dialog', { name: '거래처 수정' })).getByRole('button', { name: '삭제' })); return screen.findByRole('dialog', { name: '삭제 확인' }); }
it('거래처 수정 초안과 선택 원행을 분리하고 준비·명시삭제 ACK 전에는 두 창을 보존한다', async () => {
    let ready!: (value: DirectoryDeletePrepared) => void, finish!: (value: DirectoryDeleteOutcome) => void;
    const prepare = vi.fn((_input: DirectoryDeleteInput) => new Promise<DirectoryDeletePrepared>(resolve => { ready = resolve; })), confirm = vi.fn(() => new Promise<DirectoryDeleteOutcome>(resolve => { finish = resolve; }));
    render(<PartnerManager {...props} partners={[partner]} onUpdateClient={vi.fn()} onPrepareDirectoryDelete={prepare} onConfirmDirectoryDelete={confirm}/>);
    await editPartner();
    fireEvent.change(screen.getByPlaceholderText('거래처명'), { target: { value: '미저장 수정 이름' } });
    await click(within(screen.getByRole('dialog', { name: '거래처 수정' })).getByRole('button', { name: '삭제' }));
    const modal = screen.getByRole('dialog', { name: '삭제 확인' });
    expect(within(modal).getByRole('button', { name: '처리 중…' })).toBeDisabled();
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ kind: 'partner', targetId: partner.id, opening: partner });
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => ready({ status: 'ready', reference: deleteReference }));
    await click(within(modal).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledExactlyOnceWith(deleteReference));
    await click(within(modal).getByRole('button', { name: '닫기' }));
    expect(screen.getByRole('dialog', { name: '거래처 수정' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '삭제 확인' })).toBeInTheDocument();
    await act(async () => finish({ status: 'saved' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('삭제가 확인됐습니다.');
});
it('거래처 삭제 미확인은 초안을 남기고 목록 필터 밖에서도 실제 요청만 확인·중단한다', async () => {
    let pending: PendingDirectoryDelete[] = [];
    const prepare = vi.fn(async (): Promise<DirectoryDeletePrepared> => ({ status: 'ready', reference: deleteReference })), confirm = vi.fn(async (): Promise<DirectoryDeleteOutcome> => { pending = [{ reference: deleteReference, description: '가상 거래처 삭제' }]; return { status: 'unknown', message: '삭제 응답 미확인', nextAction: '결과를 확인하거나 요청을 중단하세요.' }; }), cancel = vi.fn(async (): Promise<DirectoryDeleteOutcome> => { pending = []; return { status: 'cancelled', requiresReopen: true, message: '삭제 요청을 중단했습니다.', nextAction: '현재 거래처를 다시 열어 주세요.' }; });
    const view = render(<PartnerManager {...props} partners={[partner]} onUpdateClient={vi.fn()} onPrepareDirectoryDelete={prepare} onConfirmDirectoryDelete={confirm} onCancelDirectoryDelete={cancel} onReadPendingDirectoryDeletes={() => pending}/>);
    expect(screen.queryByRole('region', { name: '처리 결과 확인이 필요한 삭제' })).toBeNull();
    const modal = await openPartnerDelete();
    await waitFor(() => expect(within(modal).getByRole('button', { name: '삭제' })).toBeEnabled());
    await click(within(modal).getByRole('button', { name: '삭제' }));
    expect(await screen.findByRole('status')).toHaveTextContent('삭제 응답 미확인');
    expect(screen.getByRole('dialog', { name: '거래처 수정' })).toBeInTheDocument();
    await click(within(modal).getByRole('button', { name: '확인창 닫기' }));
    await click(within(screen.getByRole('dialog', { name: '거래처 수정' })).getByRole('button', { name: '취소' }));
    fireEvent.change(screen.getByPlaceholderText('전체 거래처 검색...'), { target: { value: '없는 거래처' } });
    const panel = screen.getByRole('region', { name: '처리 결과 확인이 필요한 삭제' });
    await click(within(panel).getByRole('button', { name: '요청 중단' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledExactlyOnceWith(deleteReference));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: '처리 결과 확인이 필요한 삭제' })).toBeNull();
    view.unmount();
});
it('거래처 samecompany UID 전환 뒤 늦은 삭제 ACK는 다음 계정 폼을 닫지 않는다', async () => {
    let finish!: (value: DirectoryDeleteOutcome) => void;
    const prepare = vi.fn(async (): Promise<DirectoryDeletePrepared> => ({ status: 'ready', reference: deleteReference })), confirm = vi.fn(() => new Promise<DirectoryDeleteOutcome>(resolve => { finish = resolve; }));
    const view = render(<PartnerManager {...props} requestScopeKey="actor-a" partners={[partner]} onUpdateClient={vi.fn()} onPrepareDirectoryDelete={prepare} onConfirmDirectoryDelete={confirm}/>);
    const modal = await openPartnerDelete();
    await waitFor(() => expect(within(modal).getByRole('button', { name: '삭제' })).toBeEnabled());
    await click(within(modal).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    view.rerender(<PartnerManager {...props} requestScopeKey="actor-b" partners={[partner]} onUpdateClient={vi.fn()} onPrepareDirectoryDelete={prepare} onConfirmDirectoryDelete={confirm}/>);
    await editPartner();
    fireEvent.change(screen.getByPlaceholderText('거래처명'), { target: { value: '새 계정 초안' } });
    await act(async () => finish({ status: 'saved' }));
    expect(screen.getByPlaceholderText('거래처명')).toHaveValue('새 계정 초안');
    expect(screen.queryByText('삭제가 확인됐습니다. 현재 목록을 확인해 주세요.')).toBeNull();
});
function typedScenario(initial: PartnerEditEntry[] = []) {
    let entries = initial;
    const bindings: PartnerEditBindings = {
        open: vi.fn<PartnerEditBindings['open']>(async (scope, reference, opening) => ({ reference, actorUid: scope.actorUid, opening, expectedVersion: '1:000000000' })),
        read: vi.fn<PartnerEditBindings['read']>(async () => entries),
        prepare: vi.fn<PartnerEditBindings['prepare']>(async (_scope, request) => { const entry: PartnerEditEntry = { key: request.reference.planId, reference: request.reference, request, requestHash: 'a'.repeat(64), referenceHash: 'a'.repeat(64), observedLocalText: JSON.stringify(request), observedReferenceText: JSON.stringify(request.reference), status: 'valid', description: '거래처 수정 · ' + partner.name }; entries = [...entries, entry]; return entry; }),
        command: vi.fn<PartnerEditBindings['command']>(async (_scope, entry, mode): Promise<PartnerEditObservation> => ({ terminal: false, outcome: { status: 'unknown', message: '저장 응답을 확인하지 못했습니다.', nextAction: '같은 요청 결과를 확인해 주세요.' }, result: { version: 1, reference: entry.reference!, actorUid: authFixture.currentUser.uid, status: 'unknown', requestHash: entry.requestHash, message: '아직 처리 기록을 찾지 못했습니다.' } })),
        discard: vi.fn<PartnerEditBindings['discard']>(async (_scope, entry) => { entries = entries.filter(row => row.key !== entry.key); return { status: 'cleared', message: '관측한 이 기기 사본만 정리했습니다.' }; }),
        history: vi.fn<PartnerEditBindings['history']>(async (scope) => ({ version: 1, companyId: scope.companyId, actorUid: scope.actorUid, entries: [], nextCursor: null }))
    };
    return { bindings, setEntries: (next: PartnerEditEntry[]) => { entries = next; } };
}
function actualProps(bindings: PartnerEditBindings) { authFixture.currentUser = { uid: 'actor-a' }; return { companyId: 'taebaek' as const, actorUid: 'actor-a', partners: [partner], partnerEditBindings: bindings, onAddClient: vi.fn() }; }
it('주소 검색의 정상 완료는 기존 address 값을 적용하고 모바일과 전화는 같은 dirty patch로 보낸다', async () => {
    const scenario = typedScenario();
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
    render(<ActualPartnerManager {...actualProps(scenario.bindings)}/>);
    await editPartner();
    await click(screen.getByRole('button', { name: '검색' }));
    act(() => complete({ address: '정상 검색 주소' }));
    expect(screen.getByPlaceholderText('주소 검색 버튼을 눌러주세요')).toHaveValue('정상 검색 주소');
    fireEvent.change(screen.getByPlaceholderText('010-0000-0000'), { target: { value: '010-1234-5678' } });
    await click(screen.getByRole('button', { name: '저장' }));
    expect(scenario.bindings.prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ patch: { address: '정상 검색 주소', mobile: '010-1234-5678', phone: '010-1234-5678' } }), expect.any(Function), partner.name);
});
it('과거 손상 사본의 실제 결과 확인과 두 관측값 정리는 새 거래처 초안을 닫거나 덮지 않는다', async () => {
    const entry: PartnerEditEntry = { key: 'old-body', reference: { companyId: 'taebaek', planId: 'old-plan', targetId: 'old-target' }, request: null, requestHash: null, referenceHash: 'b'.repeat(64), observedLocalText: '손상 원문 A', observedReferenceText: '독립 참조 A', status: 'corrupt', description: '과거 거래처 수정' };
    const scenario = typedScenario([entry]);
    vi.mocked(scenario.bindings.command).mockResolvedValue({ terminal: false, copyMismatch: true, result: { version: 1, reference: entry.reference!, actorUid: 'actor-a', status: 'applied', requestHash: 'b'.repeat(64), message: '과거 요청의 수정 완료를 확인했습니다.' }, outcome: { status: 'rejected', message: '현재 입력의 저장 완료로 처리하지 않았습니다.', nextAction: '관측한 사본만 정리해 주세요.' } });
    render(<ActualPartnerManager {...actualProps(scenario.bindings)}/>);
    await editPartner();
    fireEvent.change(screen.getByPlaceholderText('메모, 특이사항 등'), { target: { value: '새 초안 메모' } });
    await click(screen.getByRole('button', { name: '실패 1' }));
    const recovery = screen.getByRole('dialog', { name: '거래처 수정 처리 확인' });
    await click(within(recovery).getByRole('button', { name: '결과 확인' }));
    expect(scenario.bindings.command).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorUid: 'actor-a' }), entry, 'inspect', expect.any(Function));
    expect(within(recovery).queryByRole('button', { name: '같은 요청 재시도' })).toBeNull();
    await click(within(recovery).getByRole('button', { name: '이 기기의 사본 정리' }));
    expect(scenario.bindings.discard).toHaveBeenCalledExactlyOnceWith(expect.anything(), entry, expect.any(Function));
    expect(screen.getByPlaceholderText('메모, 특이사항 등')).toHaveValue('새 초안 메모');
    expect(screen.getByRole('dialog', { name: '거래처 수정' })).toBeInTheDocument();
    expect(scenario.bindings.prepare).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '실패 1' })).toBeNull();
});
it('회사 안 UID 교체는 저장중 잠금을 새 세대에서 해제하고 옛 ACK가 새 초안을 닫지 않는다', async () => {
    const scenario = typedScenario();
    let finish!: (result: PartnerEditObservation) => void;
    vi.mocked(scenario.bindings.command).mockImplementation(() => new Promise(resolve => finish = resolve));
    const props = actualProps(scenario.bindings), view = render(<ActualPartnerManager {...props}/>);
    await editPartner();
    fireEvent.change(screen.getByPlaceholderText('거래처명'), { target: { value: '첫 계정 수정' } });
    await click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByPlaceholderText('거래처명')).toBeDisabled();
    scenario.setEntries([]);
    authFixture.currentUser = { uid: 'actor-b' };
    act(() => authFixture.listeners.forEach(callback => callback(authFixture.currentUser)));
    view.rerender(<ActualPartnerManager {...props} actorUid="actor-b" requestScopeKey="actor-b"/>);
    await editPartner();
    fireEvent.change(screen.getByPlaceholderText('거래처명'), { target: { value: '새 계정 초안' } });
    await act(async () => finish({ terminal: true, outcome: { status: 'saved' } }));
    expect(screen.getByPlaceholderText('거래처명')).toHaveValue('새 계정 초안');
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
});
it('처리 기록은 명시 조회만 하고 빈 페이지의 다음 기록과 과거 완료가 현재 초안을 종결하지 않는다', async () => {
    const scenario = typedScenario();
    vi.mocked(scenario.bindings.history).mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'actor-a', entries: [], nextCursor: 'opaque-next' }).mockResolvedValueOnce({ version: 1, companyId: 'taebaek', actorUid: 'actor-a', entries: [{ createdAt: '2026-10-20T00:00:00.000Z', result: { version: 1, reference: { companyId: 'taebaek', planId: 'past', targetId: partner.id }, actorUid: 'actor-a', status: 'applied', requestHash: 'c'.repeat(64), message: '이전 거래처 수정 완료' } }], nextCursor: null });
    render(<ActualPartnerManager {...actualProps(scenario.bindings)}/>);
    await editPartner();
    fireEvent.change(screen.getByPlaceholderText('메모, 특이사항 등'), { target: { value: '현재 메모' } });
    await click(screen.getByRole('button', { name: '처리 기록' }));
    expect(scenario.bindings.history).not.toHaveBeenCalled();
    const modal = screen.getByRole('dialog', { name: '거래처 수정 처리 확인' });
    await click(within(modal).getByRole('button', { name: '지난 처리 기록 조회' }));
    await click(within(modal).getByRole('button', { name: '다음 처리 기록' }));
    expect(scenario.bindings.history).toHaveBeenLastCalledWith(expect.anything(), 'opaque-next', expect.any(Function));
    expect(within(modal).getByText('현재 상태: 거래처 수정 완료')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^실패 / })).toBeNull();
    expect(screen.getByPlaceholderText('메모, 특이사항 등')).toHaveValue('현재 메모');
    expect(scenario.bindings.command).not.toHaveBeenCalled();
});
it('현재 요청 중단이 확인된 뒤에도 초안을 자동 갱신하지 않고 명시 현재 거래처 재열기로 새 원문을 읽는다', async () => {
    const scenario = typedScenario();
    const props = actualProps(scenario.bindings), view = render(<ActualPartnerManager {...props}/>);
    await editPartner();
    fireEvent.change(screen.getByPlaceholderText('메모, 특이사항 등'), { target: { value: '보존할 초안' } });
    await click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByPlaceholderText('메모, 특이사항 등')).toBeDisabled();
    await click(screen.getByRole('button', { name: '실패 1' }));
    vi.mocked(scenario.bindings.command).mockImplementation(async (_scope, entry) => { scenario.setEntries([]); return { terminal: true, outcome: { status: 'cancelled', message: '미처리 요청을 중단했습니다.', nextAction: '현재 거래처를 다시 열어 주세요.' }, result: { version: 1, reference: entry.reference!, actorUid: 'actor-a', status: 'cancelled', requestHash: entry.requestHash, message: '미처리 요청을 중단했습니다.' } }; });
    await click(screen.getByRole('button', { name: '미처리 요청 중단' }));
    expect(screen.getByPlaceholderText('메모, 특이사항 등')).toHaveValue('보존할 초안');
    view.rerender(<ActualPartnerManager {...props} partners={[{ ...partner, note: '현재 서버 메모' }]}/>);
    expect(screen.getByPlaceholderText('메모, 특이사항 등')).toHaveValue('보존할 초안');
    await click(screen.getByRole('button', { name: '현재 거래처 다시 열기' }));
    expect(screen.getByPlaceholderText('메모, 특이사항 등')).toHaveValue('현재 서버 메모');
    expect(scenario.bindings.prepare).toHaveBeenCalledTimes(1);
});
it('저장 미확인 원폼 안에서 실제 복구 모달을 위층으로 열고 입력을 보존한 채 결과를 확인한다', async () => {
    const scenario = typedScenario();
    render(<ActualPartnerManager {...actualProps(scenario.bindings)}/>);
    await editPartner();
    const edit = screen.getByRole('dialog', { name: '거래처 수정' });
    fireEvent.change(within(edit).getByPlaceholderText('메모, 특이사항 등'), { target: { value: '닫지 않고 확인할 초안' } });
    await click(within(edit).getByRole('button', { name: '저장' }));
    await click(within(edit).getByRole('button', { name: '실패 1' }));
    const recovery = screen.getByRole('dialog', { name: '거래처 수정 처리 확인' });
    expect(Number(recovery.parentElement!.style.zIndex)).toBeGreaterThan(Number(edit.parentElement!.style.zIndex) || 1090);
    expect(within(edit).getByPlaceholderText('메모, 특이사항 등')).toHaveValue('닫지 않고 확인할 초안');
    await click(within(recovery).getByRole('button', { name: '결과 확인' }));
    expect(scenario.bindings.command).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'inspect', expect.any(Function));
    await click(within(recovery).getByRole('button', { name: '닫기' }));
    expect(screen.getByRole('dialog', { name: '거래처 수정' })).toBe(edit);
    await click(within(edit).getByRole('button', { name: '처리 기록' }));
    expect(screen.getByRole('dialog', { name: '거래처 수정 처리 확인' })).toBeInTheDocument();
    expect(scenario.bindings.prepare).toHaveBeenCalledTimes(1);
});
