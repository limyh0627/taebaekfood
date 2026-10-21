/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FinancialOpeningResume from './FinancialOpeningResume';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'u' } as {
            uid: string;
            getIdTokenResult?: () => Promise<unknown>;
        } | null }, listeners: new Set<(user: any) => void>(), entry: null as any, readError: '', real: false, retry: vi.fn(), inspect: vi.fn(), cancel: vi.fn(), discard: vi.fn(), upgrade: vi.fn(), rpc: vi.fn() }));
vi.mock('../src/shared/firebase', () => ({ auth: mocks.auth, authReady: Promise.resolve(), db: {}, functions: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, fn: (user: any) => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn); } }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.rpc }));
vi.mock('../src/shared/services/financialOpeningCommands', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/shared/services/financialOpeningCommands')>();
    return { ...actual,
        readFinancialOpeningRecovery: async (company: any) => {
            if (mocks.real)
                return actual.readFinancialOpeningRecovery(company);
            if (mocks.readError)
                throw Error(mocks.readError);
            return mocks.entry;
        },
        financialOpeningRecoveryProjection: (entry: any, input: any) => {
            if (mocks.real)
                return actual.financialOpeningRecoveryProjection(entry, input);
            const results = Array.isArray(input) ? input : input ? [input] : [];
            const result = results[results.length - 1];
            const referenceRows = (entry.references ?? []).map((item: any) => {
                const bound = results.find((value: any) => JSON.stringify(value.reference) === JSON.stringify(item.reference));
                return { ...item, label: item.source === 'body' ? '본문에 남은 요청' : '참조에 남은 요청', currentState: bound?.status === 'applied' ? '이 요청은 처리되었습니다' : bound?.status === 'cancelled' ? '요청 중단 확정' : '아직 처리 결과를 확인하지 못했습니다', cause: '', nextAction: '각 요청을 확인해 주세요', canInspect: true, canCancel: !['applied', 'cancelled'].includes(bound?.status), terminal: ['applied', 'cancelled'].includes(bound?.status) };
            });
            const terminal = entry.conflictingReference ? referenceRows.every((row: any) => row.terminal) : ['applied', 'cancelled'].includes(result?.status);
            return { referenceRows, currentState: result?.status === 'applied' ? '이 요청은 처리되었습니다' : result?.status === 'cancelled' ? '요청 중단 확정' : '아직 처리 결과를 확인하지 못했습니다', cause: entry.error || '보관된 요청', nextAction: result?.status === 'applied' ? '현재 자료는 목록에서 확인하세요' : terminal ? '이 기기의 사본을 정리하고 새로 작성하세요' : '실제 처리 결과를 확인하세요', canInspect: !!entry.reference, canRetry: entry.validBody && !entry.legacy && !entry.conflictingReference && !terminal, canCancel: !!entry.reference && !terminal, canDiscard: terminal || !entry.reference && !entry.validBody, canUpgradeReference: entry.legacy && !entry.conflictingReference };
        },
        retryFinancialOpening: (...args: any[]) => mocks.real ? (actual.retryFinancialOpening as any)(...args) : mocks.retry(...args),
        inspectFinancialOpening: (...args: any[]) => mocks.real ? (actual.inspectFinancialOpening as any)(...args) : mocks.inspect(...args),
        cancelFinancialOpening: (...args: any[]) => mocks.real ? (actual.cancelFinancialOpening as any)(...args) : mocks.cancel(...args),
        discardFinancialOpeningCopy: (...args: any[]) => mocks.real ? (actual.discardFinancialOpeningCopy as any)(...args) : mocks.discard(...args),
        upgradeFinancialOpeningReference: (...args: any[]) => mocks.real ? (actual.upgradeFinancialOpeningReference as any)(...args) : mocks.upgrade(...args),
    };
});
const pending = { version: 1, companyId: 'taebaek', userId: 'u', request: { kind: 'account-update', companyId: 'taebaek', original: { id: 'bank', companyId: 'taebaek', name: '메인' }, name: '메인통장', newDate: '2026-07-31', targetBalance: 70000, operationId: 'same', releaseId: 'release' } };
function entry(name = '메인통장', op = 'same'): any { const body = { ...pending, request: { ...pending.request, name, operationId: op } }; return { companyId: 'taebaek', actorUid: 'u', key: 'financial-opening:taebaek:u', bodyRaw: JSON.stringify(body), referenceRaw: 'reference-' + op, pending: body, reference: { companyId: 'taebaek', operationId: op, kind: 'account-update' }, validBody: true, legacy: false, error: '', description: name, conflictingReference: false }; }
function view(recovered = vi.fn()) { return { recovered, ...render(<FinancialOpeningResume companyId="taebaek" onRecovered={recovered}/>) }; }
const ready = () => screen.findByRole('button', { name: '실제 처리 결과 확인' });
const retry = () => screen.getByRole('button', { name: '같은 내용으로 다시 시도' });
const announce = () => fireEvent(window, new Event('financial-opening-pending'));
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
    cleanup();
    mocks.auth.currentUser = { uid: 'u' };
    mocks.listeners.clear();
    mocks.entry = null;
    mocks.readError = '';
    mocks.real = false;
    for (const fn of [mocks.retry, mocks.inspect, mocks.cancel, mocks.discard, mocks.upgrade, mocks.rpc])
        fn.mockReset();
    localStorage.clear();
});
it('평상시 알림을 표시하지 않는다', async () => { view(); await act(pause); expect(screen.queryByRole('region')).toBeNull(); });
it('닫힌 요청의 원문 요약을 보여 주고 성공하면 목록을 갱신한다', async () => { mocks.entry = entry(); mocks.retry.mockImplementation(async () => { mocks.entry = null; return 'updated'; }); const { recovered } = view(); await ready(); expect(screen.getByText(/메인통장.*2026-07-31.*70,000/)).toBeTruthy(); fireEvent.click(retry()); await waitFor(() => expect(recovered).toHaveBeenCalledOnce()); expect(mocks.retry).toHaveBeenCalledWith('taebaek', expect.objectContaining({ bodyRaw: JSON.stringify(pending) }), expect.any(Function), expect.any(Function)); expect(screen.queryByRole('region')).toBeNull(); });
it('불명확한 결과는 원문을 보존하고 같은 재개 API로 다시 확인한다', async () => { mocks.entry = entry(); mocks.retry.mockRejectedValue(Error('응답 확인 불가')); view(); await ready(); fireEvent.click(retry()); await screen.findByRole('alert'); fireEvent.click(retry()); await waitFor(() => expect(mocks.retry).toHaveBeenCalledTimes(2)); expect(mocks.entry.bodyRaw).toBe(JSON.stringify(pending)); });
it('손상된 원문 읽기 오류는 남기며 자동 저장이나 삭제를 하지 않는다', async () => { localStorage.setItem('original', 'bad'); mocks.readError = '원문은 보존했습니다.'; view(); expect((await screen.findByRole('alert')).textContent).toContain('보존'); expect(localStorage.getItem('original')).toBe('bad'); expect(mocks.retry).not.toHaveBeenCalled(); });
it('같은 창 및 다른 창 저장 이벤트를 다시 읽는다', async () => { view(); await act(pause); mocks.entry = entry(); announce(); await ready(); mocks.entry = null; fireEvent(window, new StorageEvent('storage')); await waitFor(() => expect(screen.queryByRole('region')).toBeNull()); });
it('회사 key 전환 뒤 늦은 성공은 현재 회사 목록을 갱신하지 않는다', async () => { mocks.entry = entry(); let finish!: () => void; mocks.retry.mockImplementation(() => new Promise<void>(r => { finish = r; })); const recovered = vi.fn(); const v = render(<FinancialOpeningResume key="taebaek:u" companyId="taebaek" onRecovered={recovered}/>); await ready(); fireEvent.click(retry()); mocks.entry = null; v.rerender(<FinancialOpeningResume key="punghoe:u" companyId="punghoe" onRecovered={recovered}/>); await act(async () => finish()); expect(recovered).not.toHaveBeenCalled(); });
it('응답 중 실제 로그인 사용자가 변경되면 이전 요청은 현재 화면에 반영하지 않는다', async () => { mocks.entry = entry(); let finish!: () => void; mocks.retry.mockImplementation(() => new Promise<void>(r => { finish = r; })); const { recovered } = view(); await ready(); fireEvent.click(retry()); mocks.auth.currentUser = { uid: 'other' }; await act(async () => finish()); expect(recovered).not.toHaveBeenCalled(); });
it('확인 중 중복 클릭은 동일 요청을 추가로 보내지 않는다', async () => { mocks.entry = entry(); let finish!: () => void; mocks.retry.mockImplementation(() => new Promise<void>(r => { finish = r; })); view(); await ready(); const b = retry(); act(() => { fireEvent.click(b); fireEvent.click(b); }); expect(mocks.retry).toHaveBeenCalledOnce(); await act(async () => finish()); });
it('표시한 A 뒤 무이벤트 B교체는 실서비스가 B를 자동 송신하지 않는다', async () => { mocks.real = true; mocks.auth.currentUser = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) }; localStorage.setItem('financial-opening:taebaek:u', JSON.stringify(pending)); view(); await screen.findByRole('button', { name: '보관된 원문의 조회 참조 복구' }); const b = { ...pending, request: { ...pending.request, operationId: 'other-operation' } }; localStorage.setItem('financial-opening:taebaek:u', JSON.stringify(b)); fireEvent.click(screen.getByRole('button', { name: '보관된 원문의 조회 참조 복구' })); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('바뀌었습니다')); expect(mocks.rpc).not.toHaveBeenCalled(); expect(localStorage.getItem('financial-opening:taebaek:u')).toBe(JSON.stringify(b)); });
it('자기 ACK 사본 정리 동기 이벤트는 정상 목록 갱신을 한 번 허용한다', async () => { mocks.entry = entry(); mocks.retry.mockImplementation(async () => { mocks.entry = null; announce(); return 'updated'; }); const { recovered } = view(); await ready(); fireEvent.click(retry()); await waitFor(() => expect(recovered).toHaveBeenCalledOnce()); });
it('진행 중 다른 B를 본 뒤 없음으로 바뀌어도 옛 ACK가 목록 갱신하지 않는다', async () => { mocks.entry = entry(); let finish!: () => void; mocks.retry.mockImplementation(() => new Promise<void>(r => { finish = r; })); const { recovered } = view(); await ready(); fireEvent.click(retry()); mocks.entry = entry('관측 B', 'b'); announce(); await screen.findByText(/관측 B/); mocks.entry = null; announce(); await act(pause); await act(async () => finish()); expect(recovered).not.toHaveBeenCalled(); });
it('다시 읽기는 새 B 표시만 하며 없음도 서버 미처리로 단정하지 않는다', async () => { mocks.entry = entry(); view(); await ready(); mocks.entry = entry('명시 새 B', 'b'); fireEvent.click(screen.getByRole('button', { name: '이 기기에 보관된 요청 다시 읽기' })); await screen.findByText(/명시 새 B/); expect(mocks.retry).not.toHaveBeenCalled(); mocks.entry = null; fireEvent.click(screen.getByRole('button', { name: '이 기기에 보관된 요청 다시 읽기' })); await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('서버에서 처리되지 않았다는 뜻은 아닙니다')); });
it('실 auth 계정 왕복 뒤 옛 ACK와 finally는 새 확인 잠금을 건드리지 않는다', async () => {
    mocks.entry = entry();
    const finishes: Array<() => void> = [];
    mocks.retry.mockImplementation(() => new Promise<void>(r => finishes.push(r)));
    const { recovered } = view();
    await ready();
    fireEvent.click(retry());
    act(() => {
        mocks.auth.currentUser = { uid: 'other' };
        for (const fn of mocks.listeners)
            fn(mocks.auth.currentUser);
        mocks.auth.currentUser = { uid: 'u' };
        for (const fn of mocks.listeners)
            fn(mocks.auth.currentUser);
    });
    await ready();
    expect(retry()).toBeEnabled();
    fireEvent.click(retry());
    expect(mocks.retry).toHaveBeenCalledTimes(2);
    await act(async () => finishes[0]());
    expect(recovered).not.toHaveBeenCalled();
    expect(retry()).toBeDisabled();
    mocks.entry = null;
    await act(async () => finishes[1]());
    expect(recovered).toHaveBeenCalledOnce();
});
it('진행 중 B 관측 뒤 옛 오류는 새 B 안내를 덮지 않는다', async () => { mocks.entry = entry(); let reject!: (e: Error) => void; mocks.retry.mockImplementation(() => new Promise<void>((_r, j) => { reject = j; })); view(); await ready(); fireEvent.click(retry()); mocks.entry = entry('새 B 보존', 'b'); announce(); await screen.findByText(/새 B 보존/); await act(async () => reject(Error('옛 A 오류'))); expect(screen.queryByText(/옛 A 오류/)).toBeNull(); expect(screen.getByText(/새 B 보존/)).toBeTruthy(); });
it('무이벤트 B 교체를 ACK에서 발견하면 A와 안내를 유지하고 명시 읽기로만 B를 보여 준다', async () => { mocks.entry = entry(); let finish!: () => void; mocks.retry.mockImplementation(() => new Promise<void>(r => { finish = r; })); const { recovered } = view(); await ready(); fireEvent.click(retry()); mocks.entry = entry('ACK에서 발견 B', 'b'); await act(async () => finish()); expect(recovered).not.toHaveBeenCalled(); expect(screen.queryByText(/ACK에서 발견 B/)).toBeNull(); expect(screen.getByRole('status')).toHaveTextContent('다시 읽'); fireEvent.click(screen.getByRole('button', { name: '이 기기에 보관된 요청 다시 읽기' })); await screen.findByText(/ACK에서 발견 B/); expect(mocks.retry).toHaveBeenCalledOnce(); });
it('참조만 남은 손상 본문은 조회·중단·명시 정리만 허용하고 새 업무를 연다', async () => { mocks.entry = { ...entry(), pending: null, validBody: false, error: '원문 손상' }; mocks.inspect.mockResolvedValue({ status: 'unknown' }); mocks.cancel.mockResolvedValue({ status: 'cancelled' }); mocks.discard.mockImplementation(async () => { mocks.entry = null; }); const { recovered } = view(); await ready(); expect(screen.queryByRole('button', { name: '같은 내용으로 다시 시도' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '실제 처리 결과 확인' })); await screen.findByText(/아직 처리 결과/); expect(screen.queryByRole('button', { name: '이 기기의 확인한 사본 정리' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '미처리 요청 중단' })); await screen.findByText(/요청 중단 확정/); expect(screen.queryByRole('button', { name: '미처리 요청 중단' })).toBeNull(); const observed = mocks.entry; fireEvent.click(screen.getByRole('button', { name: '이 기기의 확인한 사본 정리' })); await waitFor(() => expect(recovered).toHaveBeenCalledOnce()); expect(mocks.discard).toHaveBeenCalledWith('taebaek', observed, expect.any(Function)); });
it('양사본 식별 불가는 서버 조회나 중단 대신 기기 손상 정보 정리만 제공한다', async () => { mocks.entry = { ...entry(), pending: null, reference: null, validBody: false, error: '서버 처리 확인 불가·서버 요청 취소가 아닙니다' }; view(); await screen.findByText(/서버 처리 확인 불가/); expect(screen.queryByRole('button', { name: '실제 처리 결과 확인' })).toBeNull(); expect(screen.queryByRole('button', { name: '미처리 요청 중단' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '이 기기의 손상된 복구 정보만 정리' })); await waitFor(() => expect(mocks.discard).toHaveBeenCalledOnce()); expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled(); });
it('과거 applied 조회는 현재 자료의 성공이나 새 업무 완료로 승격하지 않는다', async () => { mocks.entry = entry(); mocks.inspect.mockResolvedValue({ status: 'applied' }); const { recovered } = view(); await ready(); fireEvent.click(screen.getByRole('button', { name: '실제 처리 결과 확인' })); await screen.findByText(/이 요청은 처리되었습니다/); expect(screen.getByText(/현재 자료는 목록/)).toBeTruthy(); expect(recovered).not.toHaveBeenCalled(); expect(mocks.retry).not.toHaveBeenCalled(); });
it('자기 메타 관측 콜백 뒤 notify는 외부 B가 아니며 연속 재시도는 최신 양원문을 쓴다', async () => { mocks.entry = entry(); mocks.retry.mockImplementationOnce(async (_company, _entry, _current, own) => { mocks.entry = { ...mocks.entry, referenceRaw: 'own-attempt-1', error: '첫 응답 유실' }; own(mocks.entry); announce(); throw Error('첫 응답 유실'); }).mockImplementationOnce(async () => { mocks.entry = null; return 'updated'; }); const { recovered } = view(); await ready(); fireEvent.click(retry()); await screen.findByText(/첫 응답 유실/); fireEvent.click(retry()); await waitFor(() => expect(recovered).toHaveBeenCalledOnce()); expect(mocks.retry.mock.calls[1][1].referenceRaw).toBe('own-attempt-1'); });
it('실서비스 legacy 참조 복구 뒤 정상 재시도 ACK는 양사본을 정리하고 목록을 한 번 갱신한다', async () => {
    mocks.real = true;
    mocks.auth.currentUser = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) };
    const key = 'financial-opening:taebaek:u';
    localStorage.setItem(key, JSON.stringify(pending));
    mocks.rpc.mockResolvedValue({ data: { result: 'updated' } });
    const { recovered } = view();
    fireEvent.click(await screen.findByRole('button', { name: '보관된 원문의 조회 참조 복구' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '보관된 원문의 조회 참조 복구' })).toBeNull());
    fireEvent.click(retry());
    await waitFor(() => expect(recovered).toHaveBeenCalledOnce());
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(key + ':reference')).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledOnce();
});
it('실서비스 거절 원인은 재열기와 unknown 조회 뒤에도 남고 중단 뒤에만 현재 실패 안내에서 빠진다', async () => {
    mocks.real = true;
    mocks.auth.currentUser = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) };
    const key = 'financial-opening:taebaek:u';
    localStorage.setItem(key, JSON.stringify(pending));
    const current = () => true;
    const service = await vi.importActual<typeof import('../src/shared/services/financialOpeningCommands')>('../src/shared/services/financialOpeningCommands');
    const legacy = await service.readFinancialOpeningRecovery('taebaek');
    await service.upgradeFinancialOpeningReference('taebaek', legacy!, current);
    mocks.rpc.mockRejectedValueOnce(Object.assign(Error('계좌 원문 충돌'), { details: { operationStatus: 'rejected', version: 1, financialWrites: false, companyId: 'taebaek', operationId: 'same' } }));
    const first = view();
    await ready();
    fireEvent.click(retry());
    await screen.findByText(/서버가 이 시도는 반영하지 않았습니다/);
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(localStorage.getItem(key + ':reference')).not.toBeNull();
    first.unmount();
    const recovered = vi.fn();
    render(<FinancialOpeningResume companyId="taebaek" onRecovered={recovered}/>);
    await screen.findByText(/계좌 원문 충돌/);
    mocks.rpc.mockImplementation(async (input: any) => ({ data: { version: 1, reference: input.reference, actorUid: 'u', status: input.mode === 'cancel' ? 'cancelled' : 'unknown', requestHash: null, message: '합성 조회' } }));
    fireEvent.click(screen.getByRole('button', { name: '실제 처리 결과 확인' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/계좌 원문 충돌/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '미처리 요청 중단' }));
    await waitFor(() => expect(screen.queryByText(/계좌 원문 충돌/)).toBeNull());
    expect(screen.getByRole('button', { name: '이 기기의 확인한 사본 정리' })).toBeEnabled();
    expect(recovered).not.toHaveBeenCalled();
});
it('실서비스 연속 응답 유실은 자기 메타 최신 관측으로 수동 재읽기 없이 같은 원문을 재시도한다', async () => {
    mocks.real = true;
    mocks.auth.currentUser = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) };
    const key = 'financial-opening:taebaek:u';
    localStorage.setItem(key, JSON.stringify(pending));
    const service = await vi.importActual<typeof import('../src/shared/services/financialOpeningCommands')>('../src/shared/services/financialOpeningCommands');
    await service.upgradeFinancialOpeningReference('taebaek', (await service.readFinancialOpeningRecovery('taebaek'))!, () => true);
    mocks.rpc.mockRejectedValueOnce(Error('응답 유실 첫째')).mockRejectedValueOnce(Error('응답 유실 둘째')).mockResolvedValueOnce({ data: { result: 'updated' } });
    const { recovered } = view();
    await ready();
    fireEvent.click(retry());
    await screen.findByText(/응답 유실 첫째/);
    await waitFor(() => expect(retry()).toBeEnabled());
    fireEvent.click(retry());
    await screen.findByText(/응답 유실 둘째/);
    await waitFor(() => expect(retry()).toBeEnabled());
    fireEvent.click(retry());
    await waitFor(() => expect(recovered).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.rpc.mock.calls[0][0]).toEqual(mocks.rpc.mock.calls[1][0]);
    expect(mocks.rpc.mock.calls[1][0]).toEqual(mocks.rpc.mock.calls[2][0]);
    expect(localStorage.getItem(key)).toBeNull();
});
it('실서비스 손상 본문과 유효 참조는 조회·중단·재조회 후 양관측 정리로 새 업무를 연다', async () => {
    mocks.real = true;
    mocks.auth.currentUser = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) };
    const key = 'financial-opening:taebaek:u';
    localStorage.setItem(key, JSON.stringify(pending));
    const service = await vi.importActual<typeof import('../src/shared/services/financialOpeningCommands')>('../src/shared/services/financialOpeningCommands');
    await service.upgradeFinancialOpeningReference('taebaek', (await service.readFinancialOpeningRecovery('taebaek'))!, () => true);
    localStorage.setItem(key, '{broken-body');
    let cancelled = false;
    mocks.rpc.mockImplementation(async (input: any) => {
        if (input.mode === 'cancel')
            cancelled = true;
        return { data: { version: 1, reference: input.reference, actorUid: 'u', status: cancelled ? 'cancelled' : 'unknown', requestHash: null, message: '합성 조회 결과' } };
    });
    const { recovered } = view();
    await ready();
    expect(screen.queryByRole('button', { name: '같은 내용으로 다시 시도' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '실제 처리 결과 확인' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: '이 기기의 확인한 사본 정리' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '미처리 요청 중단' }));
    await screen.findByRole('button', { name: '이 기기의 확인한 사본 정리' });
    fireEvent.click(screen.getByRole('button', { name: '이 기기의 확인한 사본 정리' }));
    await waitFor(() => expect(recovered).toHaveBeenCalledOnce());
    expect(mocks.rpc.mock.calls.map(call => call[0].mode)).toEqual(['inspect', 'cancel', 'inspect']);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(key + ':reference')).toBeNull();
});
it('서로 다른 유효 본문 A와 참조 B는 두 요청을 각각 확인하고 모두 종결해야 정리한다', async () => {
    const a = entry('본문 A', 'a'), b = entry('참조 B', 'b');
    mocks.entry = { ...a, reference: b.reference, referenceRaw: b.referenceRaw, conflictingReference: true, references: [{ reference: a.reference, source: 'body' }, { reference: b.reference, source: 'reference' }] };
    view();
    await screen.findByRole('button', { name: '본문에 남은 요청 실제 처리 결과 확인' });
    expect(screen.queryByRole('button', { name: '본문에 남은 요청 실제 처리 결과 확인' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '참조에 남은 요청 실제 처리 결과 확인' })).not.toBeNull();
});
it('실서비스 본문 A·참조 B는 A 완료를 보존하며 B 중단 후 두 결과 재조회로만 정리한다', async () => {
    mocks.real = true;
    mocks.auth.currentUser = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) };
    const key = 'financial-opening:taebaek:u';
    const a = { ...pending, request: { ...pending.request, operationId: 'conflict-a', name: '본문 A' } };
    const b = { ...pending, request: { ...pending.request, operationId: 'conflict-b', name: '참조 B' } };
    const service = await vi.importActual<typeof import('../src/shared/services/financialOpeningCommands')>('../src/shared/services/financialOpeningCommands');
    localStorage.setItem(key, JSON.stringify(b));
    await service.upgradeFinancialOpeningReference('taebaek', (await service.readFinancialOpeningRecovery('taebaek'))!, () => true);
    mocks.rpc.mockRejectedValueOnce(Object.assign(Error('B에만 속한 과거 원인'), { details: { operationStatus: 'rejected', version: 1, financialWrites: false, companyId: 'taebaek', operationId: 'conflict-b' } }));
    await expect(service.retryFinancialOpening('taebaek', (await service.readFinancialOpeningRecovery('taebaek'))!, () => true)).rejects.toThrow('B에만 속한 과거 원인');
    mocks.rpc.mockReset();
    localStorage.setItem(key, JSON.stringify(a));
    let cancelled = false, failB = true;
    mocks.rpc.mockImplementation(async (input: any) => {
        const isA = input.reference.operationId === 'conflict-a';
        if (!isA && input.mode === 'inspect' && failB) {
            failB = false;
            throw Error('B 조회 연결 실패');
        }
        if (!isA && input.mode === 'cancel')
            cancelled = true;
        const status = isA ? 'applied' : cancelled ? 'cancelled' : 'unknown';
        return { data: { version: 1, reference: input.reference, actorUid: 'u', status, requestHash: isA ? 'a'.repeat(64) : null, ...(isA ? { result: 'updated' } : {}), message: '합성 요청별 결과' } };
    });
    const { recovered } = view();
    await screen.findByRole('button', { name: '본문에 남은 요청 실제 처리 결과 확인' });
    expect(screen.getAllByText(/B에만 속한 과거 원인/)).toHaveLength(1);
    expect(screen.getByText('본문에 남은 요청').parentElement?.textContent).not.toContain('B에만 속한 과거 원인');
    expect(screen.getByText('참조에 남은 요청').parentElement?.textContent).toContain('B에만 속한 과거 원인');
    fireEvent.click(screen.getByRole('button', { name: '본문에 남은 요청 실제 처리 결과 확인' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '본문에 남은 요청 미처리 요청 중단' })).toBeNull());
    expect(screen.queryByRole('button', { name: '같은 내용으로 다시 시도' })).toBeNull();
    expect(screen.queryByRole('button', { name: '보관된 원문의 조회 참조 복구' })).toBeNull();
    expect(screen.queryByRole('button', { name: '이 기기의 확인한 사본 정리' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '참조에 남은 요청 실제 처리 결과 확인' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '본문에 남은 요청 미처리 요청 중단' })).toBeNull();
    expect(screen.getByRole('button', { name: '참조에 남은 요청 미처리 요청 중단' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '참조에 남은 요청 미처리 요청 중단' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '이 기기의 확인한 사본 정리' })).not.toBeNull());
    expect(screen.getByText(/두 요청의 처리 결과를 모두 확인했습니다/)).toBeTruthy();
    expect(screen.queryByText(/B에만 속한 과거 원인/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '이 기기의 확인한 사본 정리' }));
    await waitFor(() => expect(recovered).toHaveBeenCalledOnce());
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(key + ':reference')).toBeNull();
    expect(mocks.rpc.mock.calls.slice(-2).map(call => [call[0].mode, call[0].reference.operationId]).sort((a, b) => a[1].localeCompare(b[1]))).toEqual([['inspect', 'conflict-a'], ['inspect', 'conflict-b']]);
});
