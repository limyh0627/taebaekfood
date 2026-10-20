/** @vitest-environment jsdom */
import { webcrypto } from 'node:crypto';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { previewHtmlPrint } from './htmlPrintOutput';
beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
});
const html = '<html><head><style>@page{size:A4} .original{color:red}</style></head><body><p class="original">고정 문서 100원</p></body></html>';
async function open(signal = new AbortController().signal, prepareDocument?: (document: Document) => void | Promise<void>) {
    let pending!: Promise<void>;
    await act(async () => {
        pending = previewHtmlPrint({ html, title: '전표', signal, prepareDocument });
    });
    const frame = await screen.findByTitle('전표 인쇄 내용') as HTMLIFrameElement;
    return { pending, frame };
}
async function ready(frame: HTMLIFrameElement) {
    await act(async () => {
        frame.contentDocument!.open();
        frame.contentDocument!.write(frame.srcdoc);
        frame.contentDocument!.close();
        fireEvent.load(frame);
    });
}
it('완성HTML과CSS를visible sandbox프레임에고정하고자동인쇄없이같은프레임만명시인쇄', async () => {
    const { pending, frame } = await open();
    const print = vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {
        queueMicrotask(() => frame.contentWindow?.dispatchEvent(new Event('afterprint')));
    });
    vi.spyOn(frame.contentWindow!, 'focus').mockImplementation(() => {
    });
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin allow-modals');
    expect(frame.srcdoc).toContain('.original{color:red}');
    expect(frame.style.height).toBe('60vh');
    await ready(frame);
    expect(print).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' })));
    await pending;
    expect(print).toHaveBeenCalledOnce();
    expect(screen.queryByTitle('전표 인쇄 내용')).toBeNull();
});
it('미준비인쇄는실행0·미리보기유지후같은문서재시도', async () => {
    const { pending, frame } = await open();
    const print = vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {
        queueMicrotask(() => frame.contentWindow?.dispatchEvent(new Event('afterprint')));
    });
    vi.spyOn(frame.contentWindow!, 'focus').mockImplementation(() => {
    });
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await screen.findByText(/인쇄창을 열지 못했습니다/);
    expect(print).not.toHaveBeenCalled();
    expect(frame.isConnected).toBe(true);
    await ready(frame);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' })));
    await pending;
    expect(print).toHaveBeenCalledOnce();
});
it.each(['닫기', 'abort'])('명시%s는프레임정리·인쇄0', async (mode) => {
    const controller = new AbortController(), { pending, frame } = await open(controller.signal);
    const print = vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {
    });
    await act(async () => {
        if (mode === 'abort')
            controller.abort();
        else
            fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    });
    await pending;
    expect(print).not.toHaveBeenCalled();
    expect(frame.isConnected).toBe(false);
});
it('폰트준비대기뒤scopeabort면print0·지연완료가모달을다시열지않는다', async () => {
    const controller = new AbortController(), { pending, frame } = await open(controller.signal);
    await ready(frame);
    let finish!: () => void;
    Object.defineProperty(frame.contentDocument!, 'fonts', { configurable: true, value: { ready: new Promise<void>(resolve => {
                finish = resolve;
            }) } });
    const print = vi.spyOn(frame.contentWindow!, 'print').mockImplementation(() => {
    });
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await act(async () => controller.abort());
    await pending;
    await act(async () => finish());
    expect(print).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
});
it('로드실패는동일srcdoc재로딩후만인쇄하며동시미리보기추가0', async () => {
    const { pending, frame } = await open();
    await previewHtmlPrint({ html, title: '두번째', signal: new AbortController().signal });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const snapshot = frame.srcdoc;
    fireEvent.error(frame);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '같은 문서 다시 불러오기' }));
    const replacement = screen.getByTitle('전표 인쇄 내용') as HTMLIFrameElement;
    expect(replacement).not.toBe(frame);
    expect(replacement.srcdoc).toBe(snapshot);
    const print = vi.spyOn(replacement.contentWindow!, 'print').mockImplementation(() => {
        queueMicrotask(() => replacement.contentWindow?.dispatchEvent(new Event('afterprint')));
    });
    vi.spyOn(replacement.contentWindow!, 'focus').mockImplementation(() => {
    });
    await ready(replacement);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' })));
    await pending;
    expect(print).toHaveBeenCalledOnce();
});
it('afterprint전닫기는listener를정리하고뒤늦은이벤트로새인쇄0', async () => {
    const { pending, frame } = await open();
    await ready(frame);
    const win = frame.contentWindow!, print = vi.spyOn(win, 'print').mockImplementation(() => {
    }), remove = vi.spyOn(win, 'removeEventListener');
    vi.spyOn(win, 'focus').mockImplementation(() => {
    });
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '닫기' })));
    await pending;
    expect(remove).toHaveBeenCalledWith('afterprint', expect.any(Function));
    win.dispatchEvent(new Event('afterprint'));
    expect(print).toHaveBeenCalledOnce();
});
function deferred() {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function printer(frame: HTMLIFrameElement) {
    const win = frame.contentWindow!;
    vi.spyOn(win, 'focus').mockImplementation(() => {
    });
    return vi.spyOn(win, 'print').mockImplementation(() => {
        queueMicrotask(() => win.dispatchEvent(new Event('afterprint')));
    });
}
async function closePreview(pending: Promise<void>) {
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '닫기' })));
    await pending;
}
it('선택적 prepare는폰트완료뒤실문서를받고완료전인쇄0·완료뒤같은프레임만인쇄한다', async () => {
    const fonts = deferred(), work = deferred(), prepare = vi.fn(() => work.promise), { pending, frame } = await open(undefined, prepare);
    Object.defineProperty(frame.contentDocument!, 'fonts', { configurable: true, value: { ready: fonts.promise } });
    const print = printer(frame);
    await ready(frame);
    expect(prepare).not.toHaveBeenCalled();
    await act(async () => fonts.resolve());
    expect(prepare).toHaveBeenCalledExactlyOnceWith(frame.contentDocument);
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await screen.findByText(/인쇄창을 열지 못했습니다/);
    expect(print).not.toHaveBeenCalled();
    await act(async () => work.resolve());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' })));
    await pending;
    expect(print).toHaveBeenCalledOnce();
});
it('동일document의중복load는분할준비를다시실행하지않는다', async () => {
    const work = deferred(), prepare = vi.fn(() => work.promise), { pending, frame } = await open(undefined, prepare);
    await ready(frame);
    fireEvent.load(frame);
    expect(prepare).toHaveBeenCalledOnce();
    await act(async () => work.resolve());
    fireEvent.load(frame);
    expect(prepare).toHaveBeenCalledOnce();
    await closePreview(pending);
});
it('prepare구체오류는보이고인쇄0·원본문서새프레임재로드에서만다시준비한다', async () => {
    const prepare = vi.fn<(document: Document) => void | Promise<void>>().mockImplementationOnce(() => {
        throw Error('품목 한 행이 인쇄 영역보다 큽니다.');
    }).mockImplementation(() => {
    }), { pending, frame } = await open(undefined, prepare), print = printer(frame);
    await ready(frame);
    await screen.findByText('품목 한 행이 인쇄 영역보다 큽니다.');
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await screen.findByText(/인쇄창을 열지 못했습니다/);
    expect(print).not.toHaveBeenCalled();
    const snapshot = frame.srcdoc;
    fireEvent.click(screen.getByRole('button', { name: '같은 문서 다시 불러오기' }));
    const next = screen.getByTitle('전표 인쇄 내용') as HTMLIFrameElement;
    expect(next).not.toBe(frame);
    expect(next.srcdoc).toBe(snapshot);
    const nextPrint = printer(next);
    await ready(next);
    expect(prepare).toHaveBeenCalledTimes(2);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' })));
    await pending;
    expect(nextPrint).toHaveBeenCalledOnce();
});
it('재로드전옛prepare지연완료는새프레임을ready로승격하지않는다', async () => {
    const old = deferred(), nextWork = deferred(), prepare = vi.fn<(document: Document) => void | Promise<void>>().mockReturnValueOnce(old.promise).mockReturnValueOnce(nextWork.promise), { pending, frame } = await open(undefined, prepare);
    await ready(frame);
    fireEvent.click(screen.getByRole('button', { name: '같은 문서 다시 불러오기' }));
    const next = screen.getByTitle('전표 인쇄 내용') as HTMLIFrameElement, print = printer(next);
    await ready(next);
    await act(async () => old.resolve());
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await screen.findByText(/인쇄창을 열지 못했습니다/);
    expect(print).not.toHaveBeenCalled();
    await act(async () => nextWork.resolve());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' })));
    await pending;
    expect(print).toHaveBeenCalledOnce();
});
it('prepare대기중abort는문서를정리하고늦은완료나오류를다시표시하지않는다', async () => {
    const work = deferred(), controller = new AbortController(), { pending, frame } = await open(controller.signal, () => work.promise);
    await ready(frame);
    const print = printer(frame);
    await act(async () => controller.abort());
    await pending;
    await act(async () => work.reject(Error('뒤늦은 준비 오류')));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(print).not.toHaveBeenCalled();
});
it('폰트대기중새프레임으로바뀌면옛문서prepare는호출하지않는다', async () => {
    const fonts = deferred(), prepare = vi.fn(), { pending, frame } = await open(undefined, prepare);
    Object.defineProperty(frame.contentDocument!, 'fonts', { configurable: true, value: { ready: fonts.promise } });
    await ready(frame);
    fireEvent.click(screen.getByRole('button', { name: '같은 문서 다시 불러오기' }));
    await act(async () => fonts.resolve());
    expect(prepare).not.toHaveBeenCalled();
    const next = screen.getByTitle('전표 인쇄 내용') as HTMLIFrameElement;
    await ready(next);
    expect(prepare).toHaveBeenCalledExactlyOnceWith(next.contentDocument);
    await closePreview(pending);
});
it('prepare뒤원문표식변경은구체오류와인쇄금지로남긴다', async () => {
    const { pending, frame } = await open(undefined, doc => {
        doc.querySelector('meta[name="html-output-snapshot"]')!.setAttribute('content', '다른원문');
    });
    const print = printer(frame);
    await ready(frame);
    await screen.findByText(/인쇄 문서 원문 표식이 바뀌었습니다/);
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await screen.findByText(/인쇄창을 열지 못했습니다/);
    expect(print).not.toHaveBeenCalled();
    await closePreview(pending);
});
it('로드오류뒤옛prepare완료도ready가아니며재로드를요구한다', async () => {
    const work = deferred(), { pending, frame } = await open(undefined, () => work.promise), print = printer(frame);
    await ready(frame);
    fireEvent.error(frame);
    await act(async () => work.resolve());
    await screen.findByText('문서를 불러오지 못했습니다. 같은 문서를 다시 불러오세요.');
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await screen.findByText(/인쇄창을 열지 못했습니다/);
    expect(print).not.toHaveBeenCalled();
    await closePreview(pending);
});
it('준비완료뒤표식이바뀐같은프레임도명시인쇄에서막는다', async () => {
    const { pending, frame } = await open(undefined, () => {
    }), print = printer(frame);
    await ready(frame);
    frame.contentDocument!.querySelector('meta[name="html-output-snapshot"]')!.setAttribute('content', '다른문서');
    fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' }));
    await screen.findByText(/인쇄창을 열지 못했습니다/);
    expect(print).not.toHaveBeenCalled();
    await closePreview(pending);
});
it('재로드뒤떨어진옛프레임오류는새문서준비상태에섞이지않는다', async () => {
    const prepare = vi.fn(), { pending, frame } = await open(undefined, prepare);
    await ready(frame);
    fireEvent.click(screen.getByRole('button', { name: '같은 문서 다시 불러오기' }));
    const next = screen.getByTitle('전표 인쇄 내용') as HTMLIFrameElement, print = printer(next);
    await ready(next);
    fireEvent.error(frame);
    expect(screen.queryByText('문서를 불러오지 못했습니다. 같은 문서를 다시 불러오세요.')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '인쇄창 열기' })));
    await pending;
    expect(print).toHaveBeenCalledOnce();
});
