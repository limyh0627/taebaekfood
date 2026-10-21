/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import FinancialOpeningResume from './FinancialOpeningResume';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'u' } as {
            uid: string;
        } | null }, get: vi.fn(), resume: vi.fn(), rpc: vi.fn(), real: false, listeners: new Set<(user: {
        uid: string;
    } | null) => void>() }));
vi.mock('../src/shared/firebase', () => ({ auth: mocks.auth, authReady: Promise.resolve(), db: {}, functions: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, fn: (user: {
        uid: string;
    } | null) => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn); } }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.rpc }));
vi.mock('../src/shared/services/financialOpeningCommands', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/shared/services/financialOpeningCommands')>();
    return { ...actual, getPendingFinancialOpening: mocks.get, resumeFinancialOpening: mocks.resume,
        readFinancialOpeningObservation: (company: import('../src/shared/types').CompanyId) => { if (mocks.real)
            return actual.readFinancialOpeningObservation(company); const pending = mocks.get(company); return pending ? { pending, raw: JSON.stringify(pending) } : null; },
        resumeObservedFinancialOpening: (company: import('../src/shared/types').CompanyId, observed: NonNullable<ReturnType<typeof actual.readFinancialOpeningObservation>>, current: () => boolean) => mocks.real ? actual.resumeObservedFinancialOpening(company, observed, current) : mocks.resume(company, observed, current) };
});
const pending = { version: 1, companyId: 'taebaek', userId: 'u', request: { kind: 'account-update', original: { id: 'bank', name: '메인' }, name: '메인통장', newDate: '2026-07-31', targetBalance: 70000, operationId: 'same', releaseId: 'release' } };
beforeEach(() => { cleanup(); mocks.auth.currentUser = { uid: 'u' }; mocks.get.mockReset().mockReturnValue(null); mocks.resume.mockReset(); mocks.rpc.mockReset(); mocks.real = false; mocks.listeners.clear(); localStorage.clear(); });
it('평상시 알림을 표시하지 않는다', () => { render(<FinancialOpeningResume companyId="taebaek" onRecovered={() => { }}/>); expect(screen.queryByRole('region')).toBeNull(); });
it('닫힌 요청의 원문 요약을 보여 주고 성공하면 목록을 갱신한다', async () => { mocks.get.mockReturnValue(pending); mocks.resume.mockImplementation(async () => { mocks.get.mockReturnValue(null); return 'updated'; }); const recovered = vi.fn(); render(<FinancialOpeningResume companyId="taebaek" onRecovered={recovered}/>); expect(screen.getByText(/메인통장.*2026-07-31.*70,000/)).toBeTruthy(); expect(screen.getByText('보관된 같은 내용으로 저장을 다시 시도합니다. 아직 처리되지 않았다면 이 요청이 저장됩니다.')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' })); await waitFor(() => expect(recovered).toHaveBeenCalledOnce()); expect(mocks.resume).toHaveBeenCalledWith('taebaek', { pending, raw: JSON.stringify(pending) }, expect.any(Function)); expect(screen.queryByRole('region')).toBeNull(); });
it('불명확한 결과는 원문을 보존하고 같은 재개 API로 다시 확인한다', async () => { mocks.get.mockReturnValue(pending); mocks.resume.mockRejectedValue(new Error('응답 확인 불가')); render(<FinancialOpeningResume companyId="taebaek" onRecovered={() => { }}/>); fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' })); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' })); await waitFor(() => expect(mocks.resume).toHaveBeenCalledTimes(2)); expect(mocks.get()).toBe(pending); });
it('손상된 원문은 오류로 남기며 자동 저장이나 삭제를 하지 않는다', () => { localStorage.setItem('original', 'bad'); mocks.get.mockImplementation(() => { throw Error('원문은 보존했습니다.'); }); render(<FinancialOpeningResume companyId="taebaek" onRecovered={() => { }}/>); expect(screen.getByRole('alert').textContent).toContain('보존'); expect(localStorage.getItem('original')).toBe('bad'); expect(mocks.resume).not.toHaveBeenCalled(); });
it('같은 창 및 다른 창 저장 이벤트를 다시 읽는다', () => { render(<FinancialOpeningResume companyId="taebaek" onRecovered={() => { }}/>); mocks.get.mockReturnValue(pending); fireEvent(window, new Event('financial-opening-pending')); expect(screen.getByRole('button', { name: '같은 내용으로 다시 시도' })).toBeTruthy(); mocks.get.mockReturnValue(null); fireEvent(window, new StorageEvent('storage')); expect(screen.queryByRole('region')).toBeNull(); });
it('회사 key 전환 뒤 늦은 성공은 현재 회사 목록을 갱신하지 않는다', async () => { mocks.get.mockImplementation(company => company === 'taebaek' ? pending : null); let finish!: () => void; mocks.resume.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; })); const recovered = vi.fn(); const view = render(<FinancialOpeningResume key="taebaek:u" companyId="taebaek" onRecovered={recovered}/>); fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' })); view.rerender(<FinancialOpeningResume key="punghoe:u" companyId="punghoe" onRecovered={recovered}/>); finish(); await waitFor(() => expect(screen.queryByRole('region')).toBeNull()); expect(recovered).not.toHaveBeenCalled(); });
it('응답 중 실제 로그인 사용자가 변경되면 이전 요청은 현재 화면에 반영하지 않는다', async () => { mocks.get.mockReturnValue(pending); let finish!: () => void; mocks.resume.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; })); const recovered = vi.fn(); render(<FinancialOpeningResume companyId="taebaek" onRecovered={recovered}/>); fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' })); mocks.auth.currentUser = { uid: 'other' }; finish(); await new Promise(resolve => setTimeout(resolve, 0)); expect(recovered).not.toHaveBeenCalled(); });
it('확인 중 중복 클릭은 동일 요청을 추가로 보내지 않는다', async () => { mocks.get.mockReturnValue(pending); let finish!: () => void; mocks.resume.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; })); render(<FinancialOpeningResume companyId="taebaek" onRecovered={() => { }}/>); const button = screen.getByRole('button', { name: '같은 내용으로 다시 시도' }); fireEvent.click(button); fireEvent.click(button); expect(mocks.resume).toHaveBeenCalledOnce(); finish(); await waitFor(() => expect(screen.getByRole('button', { name: '같은 내용으로 다시 시도' })).toBeTruthy()); });
it('표시한 A 뒤 무이벤트 B교체는 실서비스가 B를 자동 송신하지 않는다', async () => {
    mocks.real = true;
    mocks.auth.currentUser = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) } as typeof mocks.auth.currentUser;
    const a = { ...pending, request: { ...pending.request, companyId: 'taebaek', original: { ...pending.request.original, companyId: 'taebaek' } } };
    const key = 'financial-opening:taebaek:u';
    localStorage.setItem(key, JSON.stringify(a));
    render(<FinancialOpeningResume companyId="taebaek" onRecovered={() => { }}/>);
    expect(screen.getByText(/메인통장/)).toBeTruthy();
    const b = { ...a, request: { ...a.request, operationId: 'other-operation', name: '다른 통장' } };
    const rawB = JSON.stringify(b);
    localStorage.setItem(key, rawB);
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }));
    await screen.findByText(/바뀌었습니다|다시 확인|교체|변경/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(rawB);
});
it('실서비스의 ACK 사본 정리 동기 이벤트는 정상 목록 갱신을 한 번 허용한다', async () => {
    mocks.real = true;
    mocks.auth.currentUser = { uid: 'u', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', isAdmin: true } }) } as typeof mocks.auth.currentUser;
    const a = { ...pending, request: { ...pending.request, companyId: 'taebaek', original: { ...pending.request.original, companyId: 'taebaek' } } };
    localStorage.setItem('financial-opening:taebaek:u', JSON.stringify(a));
    mocks.rpc.mockResolvedValue({ data: { result: 'updated' } });
    const recovered = vi.fn();
    render(<FinancialOpeningResume companyId="taebaek" onRecovered={recovered}/>);
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }));
    await waitFor(() => expect(recovered).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(localStorage.getItem('financial-opening:taebaek:u')).toBeNull();
});
it('진행 중 다른 B를 본 뒤 없음으로 바뀌어도 옛 ACK가 목록 갱신하지 않는다', async () => {
    mocks.get.mockReturnValue(pending);
    let finish!: () => void;
    mocks.resume.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const recovered = vi.fn();
    render(<FinancialOpeningResume companyId="taebaek" onRecovered={recovered}/>);
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }));
    mocks.get.mockReturnValue({ ...pending, request: { ...pending.request, name: '관측 B', operationId: 'b' } });
    fireEvent(window, new Event('financial-opening-pending'));
    expect(screen.getByText(/관측 B/)).toBeTruthy();
    mocks.get.mockReturnValue(null);
    fireEvent(window, new StorageEvent('storage'));
    await act(async () => finish());
    expect(recovered).not.toHaveBeenCalled();
});
it('다시 읽기는 새 B 표시만 하며 없음도 서버 미처리로 단정하지 않는다', () => {
    mocks.get.mockReturnValue(pending);
    render(<FinancialOpeningResume companyId="taebaek" onRecovered={() => { }}/>);
    mocks.get.mockReturnValue({ ...pending, request: { ...pending.request, name: '명시 새 B', operationId: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: '이 기기에 보관된 요청 다시 읽기' }));
    expect(screen.getByText(/명시 새 B/)).toBeTruthy();
    expect(mocks.resume).not.toHaveBeenCalled();
    mocks.get.mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: '이 기기에 보관된 요청 다시 읽기' }));
    expect(screen.getByRole('status')).toHaveTextContent('서버에서 처리되지 않았다는 뜻은 아닙니다');
});
it('실 auth 계정 왕복 뒤 옛 ACK와 finally는 새 확인 잠금을 건드리지 않는다', async () => {
    mocks.get.mockReturnValue(pending);
    const finishes: Array<() => void> = [];
    mocks.resume.mockImplementation(() => new Promise<void>(resolve => finishes.push(resolve)));
    const recovered = vi.fn();
    render(<FinancialOpeningResume companyId="taebaek" onRecovered={recovered}/>);
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }));
    act(() => { mocks.auth.currentUser = { uid: 'other' }; for (const listener of mocks.listeners)
        listener(mocks.auth.currentUser); mocks.auth.currentUser = { uid: 'u' }; for (const listener of mocks.listeners)
        listener(mocks.auth.currentUser); });
    expect(screen.queryByRole('button', { name: '같은 내용으로 다시 시도' })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }));
    expect(mocks.resume).toHaveBeenCalledTimes(2);
    await act(async () => finishes[0]());
    expect(recovered).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '저장 확인 중…' })).toBeDisabled();
    mocks.get.mockReturnValue(null);
    await act(async () => finishes[1]());
    expect(recovered).toHaveBeenCalledOnce();
});
it('진행 중 B 관측 뒤 옛 오류는 새 B 안내를 덮지 않는다', async () => {
    mocks.get.mockReturnValue(pending);
    let reject!: (e: Error) => void;
    mocks.resume.mockImplementation(() => new Promise<void>((_r, j) => { reject = j; }));
    render(<FinancialOpeningResume companyId="taebaek" onRecovered={() => { }}/>);
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }));
    mocks.get.mockReturnValue({ ...pending, request: { ...pending.request, name: '새 B 보존', operationId: 'b' } });
    fireEvent(window, new Event('financial-opening-pending'));
    await act(async () => reject(new Error('옛 A 오류')));
    expect(screen.getByText(/새 B 보존/)).toBeTruthy();
    expect(screen.queryByText('옛 A 오류')).toBeNull();
    expect(screen.getByRole('button', { name: '같은 내용으로 다시 시도' })).toBeEnabled();
});
it('무이벤트 B 교체를 ACK에서 발견하면 A와 안내를 유지하고 명시 읽기로만 B를 보여 준다', async () => {
    mocks.get.mockReturnValue(pending);
    let finish!: () => void;
    mocks.resume.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const recovered = vi.fn();
    render(<FinancialOpeningResume companyId="taebaek" onRecovered={recovered}/>);
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }));
    mocks.get.mockReturnValue({ ...pending, request: { ...pending.request, name: 'ACK에서 발견 B', operationId: 'b' } });
    await act(async () => finish());
    expect(recovered).not.toHaveBeenCalled();
    expect(screen.getByText(/메인통장/)).toBeTruthy();
    expect(screen.queryByText(/ACK에서 발견 B/)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('다시 읽');
    fireEvent.click(screen.getByRole('button', { name: '이 기기에 보관된 요청 다시 읽기' }));
    expect(screen.getByText(/ACK에서 발견 B/)).toBeTruthy();
    expect(mocks.resume).toHaveBeenCalledOnce();
});
