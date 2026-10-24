// 출력 수명·명시 PDF 분리·월간 캡처 변경만 제외하고 기존 업무 본문을 보호한다.
const withoutOutput = (text: string) => text.replace(/\r\n/g, '\n').replace(/\n  const outputSignal = useOutputScope[^\n]*;/g, '').replace(/, outputSignal\(\)/g, '').replace(/  useEffect\(\(\) => \{\n    if \(!bulkList\) return;[\s\S]*?\n  \}, \[bulkList\]\);/g, '').replace(/      if \(await appConfirm\('확인 처리되었습니다\.[^\n]*\)\) \{[\s\S]*?\n      \}/g, '').replace(/      alert\('확인 결과를 저장했습니다\.[^\n]*\);/g, '').replace(/ title="확인 결과만 저장합니다\.[^"]*"/g, '');
/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';
const state = vi.hoisted(() => ({ subscriptions: [] as any[], user: { uid: 'output-test' } as {
        uid: string;
    } | null, listeners: [] as any[], confirm: vi.fn(), rows: [] as any[], add: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ db: {}, auth: { get currentUser() { return state.user; }, onAuthStateChanged: (fn: any) => { state.listeners.push(fn); return () => { }; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_: unknown, fn: any) => { state.listeners.push(fn); return () => { }; } }));
vi.mock('../../../shared/components/appDialog', () => ({ appConfirm: state.confirm }));
vi.mock('../../../shared/services/firebaseService', () => ({ addItem: state.add, updateItem: state.update, deleteItem: state.remove, setDocument: vi.fn() }));
vi.mock('firebase/firestore', () => ({ collection: (_: unknown, name: string) => ({ collection: name }), doc: (_: unknown, name: string, id: string) => ({ collection: name, id }), where: (field: string, op: string, value: unknown) => ({ field, op, value }), query: (ref: object, ...clauses: unknown[]) => ({ ...ref, clauses }), onSnapshot: (ref: any, next: any, error: any) => {
        const stop = vi.fn();
        state.subscriptions.push({ ref, next, error, stop });
        if (ref.collection === 'haccp_temp')
            next({ docs: state.rows.map(row => ({ id: row.id, data: () => row })) });
        else
            next({ exists: () => false });
        return stop;
    } }));
import { TempForm } from './TempForm';
import { TempForm as LegacyTempForm } from '../../../../components/HaccpChecklist';
import { HaccpCompanyContext } from '../context/HaccpCompanyContext';
import { todayStr } from '../domain/haccpDate';
import { STORAGE_ZONES } from '../domain/tempZones';
beforeEach(() => { state.subscriptions = []; state.rows = []; state.user = { uid: 'output-test' }; state.listeners = []; state.confirm.mockReset().mockResolvedValue(true); state.add.mockReset(); state.update.mockReset(); state.remove.mockReset(); });
it('기존 named export는 직접 함수와 같고 온도행 기본구역·검사자·정수입력을 보존한다', () => {
    expect(LegacyTempForm).toBe(TempForm);
    render(<TempForm currentUser={{ id: 'test', name: '합성 측정자' }} isAdmin/>);
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    for (const zone of STORAGE_ZONES)
        expect(screen.getAllByDisplayValue(zone.name).length).toBeGreaterThan(0);
    const row = screen.getAllByRole('row').find(row => within(row).queryByDisplayValue('냉장창고 1'))!;
    const inputs = within(row).getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: '-18.7℃' } });
    expect(inputs[0]).toHaveValue('-187');
    expect(within(row).getByDisplayValue('합성 측정자')).toBeInTheDocument();
});
it('두 구독의 회사 조건·템플릿 문서와 회사 전환 cleanup을 보존한다', () => {
    const view = render(<HaccpCompanyContext.Provider value="punghoe"><TempForm /></HaccpCompanyContext.Provider>);
    expect(state.subscriptions[0].ref).toEqual({ collection: 'haccp_temp', clauses: [{ field: 'companyId', op: '==', value: 'punghoe' }] });
    expect(state.subscriptions[1].ref).toEqual({ collection: 'haccp_templates', id: 'punghoe--temp_zones' });
    view.rerender(<HaccpCompanyContext.Provider value="taebaek"><TempForm /></HaccpCompanyContext.Provider>);
    expect(state.subscriptions[0].stop).toHaveBeenCalledOnce();
    expect(state.subscriptions[1].stop).toHaveBeenCalledOnce();
    expect(state.subscriptions[2].ref.clauses[0].value).toBe('taebaek');
    view.unmount();
    expect(state.subscriptions[2].stop).toHaveBeenCalledOnce();
    expect(state.subscriptions[3].stop).toHaveBeenCalledOnce();
});
it('온도 타입·기본행·구역 원문 AST와 부모 실제 연결을 보존한다', () => {
    const expected: Record<string, string> = { TempRow: 'cbf9e771f9aa1b3912e7777f02710170028617a6eba46ec0c097d3b98d60262b', TempRecord: 'd0ad44b82a88d8c3d8489d2dc3e17440a7be3fe364375ac8e3ffd9a853823b1f', defaultTempRows: '163abc3178b721404981356ed1b6370db66ee86cc004246c35e58449c7cf99ac', STORAGE_ZONES: 'b34cf6ad3ad874fd7c4fed9d975ea53e51fe16fb3821c2e0604c8743f68038a5', StorageZone: '049e0d456eb1fc7bab6e9edbdf91e1c98b6df6e6273edefc1fbaf05549103e9a' };
    const found: Record<string, string> = {};
    for (const path of ['src/features/haccp/ui/TempForm.tsx', 'src/features/haccp/domain/tempZones.ts']) {
        const text = readFileSync(path, 'utf8'), s = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        for (const n of s.statements) {
            if (ts.isVariableStatement(n))
                for (const d of n.declarationList.declarations) {
                    const key = d.name.getText(s);
                    if (expected[key])
                        found[key] = createHash('sha256').update(withoutOutput(d.initializer!.getText(s))).digest('hex');
                }
            else if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) {
                const key = n.name.text;
                if (expected[key])
                    found[key] = createHash('sha256').update(n.getText(s).replace(/^export /, '').replace(/\r\n/g, '\n')).digest('hex');
            }
        }
        expect(text).not.toContain('HaccpChecklist');
    }
    expect(found).toEqual(expected);
    const parent = readFileSync('components/HaccpChecklist.tsx', 'utf8'), shell = readFileSync('src/features/haccp/ui/HaccpChecklistShells.tsx', 'utf8');
    expect(parent).toContain("export {TempForm} from '../src/features/haccp/ui/TempForm'");
    expect(shell).toContain("{activeTab === 'temp'       && <TempForm currentUser={currentUser} isAdmin={isAdmin} canConfirm={isAdmin} />}");
    expect(parent).not.toContain('const STORAGE_ZONES =');
});
it('저장 대기 중 온도와 측정자 입력을 잠가 ACK가 새 입력을 지우지 않는다', async () => {
    let finish!: (id: string) => void;
    state.add.mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
    render(<TempForm currentUser={{ id: 'test', name: '합성 측정자' }} isAdmin/>);
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    fireEvent.change(screen.getAllByPlaceholderText('예: 5')[0], { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getAllByPlaceholderText('예: 5')[0]).toBeDisabled();
    await act(async () => finish('saved'));
});
const tempRow = { zone: '냉장창고 1', temp: '5', result: 'O', corrective: '', inspector: '담당' };
const record = (id: string, date = todayStr()) => ({ id, date, measureTime: '12:30', rows: [{ ...tempRow }], createdBy: '담당', createdAt: '2026-01-01T00:00:00Z', updatedBy: '담당', updatedAt: '2026-01-01T00:00:00Z', revisionCount: 0 });
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
it('새 기록 실패는 입력과 이유를 보존하고 잠금 해제 후 명시 재시도한다', async () => {
    state.add.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce('saved');
    render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin/>);
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    fireEvent.change(screen.getAllByPlaceholderText('예: 5')[0], { target: { value: '-18.7℃' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByRole('alert');
    expect(screen.getAllByPlaceholderText('예: 5')[0]).toHaveValue('-187');
    expect(screen.getAllByPlaceholderText('예: 5')[0]).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText(/Rev.0/);
    expect(state.add).toHaveBeenCalledTimes(2);
    expect(state.add.mock.calls[1][1]).toMatchObject({ date: todayStr(), measureTime: '12:30', createdBy: '측정자', revisionCount: 0, rows: expect.arrayContaining([expect.objectContaining({ temp: '-187' })]) });
});
it('저장과 확인 교차·동일 tick 송신은 하나이며 입력과 기록 선택도 잠근다', async () => {
    state.rows = [record('today'), record('past', '2020-01-01')];
    const d = deferred<void>();
    state.update.mockReturnValue(d.promise);
    render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin canConfirm/>);
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    fireEvent.click(screen.getByRole('button', { name: '저장 중...' }));
    expect(screen.getAllByRole('button', { name: '처리 중...' })[0]).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: '처리 중...' })[0]);
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(screen.getAllByPlaceholderText('예: 5')[0]).toBeDisabled();
    await act(async () => d.resolve());
    expect(state.update.mock.calls[0][1]).toBe('today');
});
it('삭제 확인 도중 관리자 권한이 사라지면 승인해도 송신하지 않는다', async () => {
    state.rows = [record('past', '2020-01-01')];
    const d = deferred<boolean>();
    state.confirm.mockReturnValue(d.promise);
    const view = render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin/>);
    fireEvent.click(screen.getByRole('button', { name: /이전 측정 기록/ }));
    fireEvent.click(screen.getByText('2020-01-01').parentElement!.querySelector('button')!);
    view.rerender(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin={false}/>);
    await act(async () => d.resolve(true));
    expect(state.remove).not.toHaveBeenCalled();
});
it('삭제 확인 도중 실제 UID 변경과 대상 소실이면 송신하지 않는다', async () => {
    state.rows = [record('past', '2020-01-01')];
    const d = deferred<boolean>();
    state.confirm.mockReturnValue(d.promise);
    render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin/>);
    fireEvent.click(screen.getByRole('button', { name: /이전 측정 기록/ }));
    fireEvent.click(screen.getByText('2020-01-01').parentElement!.querySelector('button')!);
    state.user = { uid: 'other' };
    await act(async () => d.resolve(true));
    expect(state.remove).not.toHaveBeenCalled();
});
it('회사 왕복과 새 요청 중 옛 ACK는 새 입력과 잠금을 건드리지 않는다', async () => {
    const a = deferred<string>(), b = deferred<string>();
    state.add.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const element = (companyId: 'taebaek' | 'punghoe') => <HaccpCompanyContext.Provider value={companyId}><TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin/></HaccpCompanyContext.Provider>;
    const v = render(element('taebaek'));
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    v.rerender(element('punghoe'));
    v.rerender(element('taebaek'));
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    fireEvent.change(screen.getAllByPlaceholderText('예: 5')[0], { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await act(async () => a.resolve('old'));
    expect(screen.getAllByPlaceholderText('예: 5')[0]).toHaveValue('8');
    expect(screen.getAllByPlaceholderText('예: 5')[0]).toBeDisabled();
    await act(async () => b.resolve('new'));
    expect(screen.getAllByPlaceholderText('예: 5')[0]).toBeEnabled();
});
it('현재 조회 오류는 빈 기록으로 새 저장하지 않고 명시 재조회로 회복한다', async () => {
    render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin/>);
    act(() => state.subscriptions[0].error(new Error('read')));
    expect(screen.getByRole('alert')).toHaveTextContent('조회');
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    expect(state.add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '다시 조회' }));
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
});
it('삭제 확인 중 기록이 사라지면 이전 대상에 쓰지 않는다', async () => {
    state.rows = [record('past', '2020-01-01')];
    const d = deferred<boolean>();
    state.confirm.mockReturnValue(d.promise);
    render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin/>);
    fireEvent.click(screen.getByRole('button', { name: /이전 측정 기록/ }));
    fireEvent.click(screen.getByText('2020-01-01').parentElement!.querySelector('button')!);
    act(() => state.subscriptions[0].next({ docs: [] }));
    await act(async () => d.resolve(true));
    expect(state.remove).not.toHaveBeenCalled();
});
it('정상 확인은 기존 확인자·시각 payload만 저장하고 입력은 보존한다', async () => {
    state.rows = [record('today')];
    state.update.mockResolvedValue(undefined);
    render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin canConfirm/>);
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '관리자 확인' })));
    expect(state.update).toHaveBeenCalledWith('haccp_temp', 'today', { confirmedBy: '측정자', confirmedAt: expect.any(String) });
    expect(screen.getAllByPlaceholderText('예: 5')[0]).toHaveValue('5');
});
it('명시 재조회 뒤 해지된 옛 callback은 새 정상 조회를 오류로 바꾸지 않는다', () => {
    render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin/>);
    const old = state.subscriptions[0];
    act(() => old.error(new Error('first')));
    fireEvent.click(screen.getByRole('button', { name: '다시 조회' }));
    act(() => old.error(new Error('late')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /오늘 온도 측정 기록/ })).toBeEnabled();
});
it('신규 저장 ACK 뒤 목록 수신 전에도 자신의 저장 기록을 확인할 수 있다', async () => {
    state.add.mockResolvedValue('new-record');
    state.update.mockResolvedValue(undefined);
    render(<TempForm currentUser={{ id: 'staff', name: '측정자' }} isAdmin canConfirm/>);
    fireEvent.click(screen.getByRole('button', { name: /오늘 온도 측정 기록/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '저장' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '관리자 확인' })));
    expect(state.update).toHaveBeenCalledWith('haccp_temp', 'new-record', { confirmedBy: '측정자', confirmedAt: expect.any(String) });
});
it('신규 ACK와 조회 오류가 겹치면 상단 카드는 미작성이 아닌 조회 필요로 표시한다',async()=>{
 const d=deferred<string>();state.add.mockReturnValue(d.promise);
 render(<TempForm currentUser={{id:'staff',name:'측정자'}} isAdmin canConfirm/>);
 fireEvent.click(screen.getByRole('button',{name:/오늘 온도 측정 기록/}));fireEvent.click(screen.getByRole('button',{name:'저장'}));
 act(()=>state.subscriptions[0].error(new Error('read')));await act(async()=>d.resolve('known-record'));
 expect(screen.getByRole('button',{name:/오늘 온도 측정 기록/})).toHaveTextContent('조회 필요');
 expect(screen.getByRole('button',{name:/오늘 온도 측정 기록/})).not.toHaveTextContent('미작성');
 expect(screen.getByText(/Rev.0/)).toBeInTheDocument();expect(state.add).toHaveBeenCalledTimes(1);
});
