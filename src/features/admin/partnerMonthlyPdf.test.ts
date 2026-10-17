/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from 'vitest';
import { savePartnerMonthlyPdf, type NamedSettlementRow } from './partnerMonthlyPdf';

const capture = vi.hoisted(() => ({ pages: [] as string[], preview:vi.fn(), wait:null as null|(()=>Promise<void>) }));
vi.mock('html2canvas', () => ({ default: async (page: HTMLElement) => {
  capture.pages.push(page.outerHTML);
  await capture.wait?.();
  return { toDataURL: () => 'data:image/png;base64,AA==' };
} }));
vi.mock('../../shared/rasterPdfOutput',()=>({previewRasterPdf:capture.preview}));
beforeEach(()=>{capture.pages=[];capture.preview.mockReset().mockResolvedValue(undefined);capture.wait=null;});

it('한글 표와 합계를 2페이지 PDF로 출력한다', async () => {
  const rows: NamedSettlementRow[] = Array.from({ length: 18 }, (_, i) => ({
    partnerId: String(i), name: `거래처 ${i + 1}`, opening: 10, sales: 20,
    cashReceived: 5, cashRefunded: 0, nonCashDecrease: 2, receivableIncrease: 13, closing: 23, discrepancy: 0,
  }));
  await savePartnerMonthlyPdf('2026-08', rows);
  expect(capture.pages).toHaveLength(2);
  expect(capture.pages[0]).toContain('2026년 8월 거래처별 정산');
  expect(capture.pages[0]).toContain('Malgun Gothic');
  expect(capture.pages[0]).toContain('현금 입금');
  expect(capture.pages[0]).toContain('현금 환불');
  expect(capture.pages[1]).toContain('전체 합계');
  expect(capture.pages[1]).toContain('414');
  expect(capture.preview).toHaveBeenCalledOnce();
  expect(capture.preview.mock.calls[0][0]).toMatchObject({fileName:'거래처별정산_2026-08.pdf',pages:[{width:297,height:210,draws:[{x:0,y:0,width:297,height:210}]},{width:297,height:210}]});
  expect(document.body.querySelector('table')).toBeNull();
});
it('캡처 대기 중 취소하면 늦게 끝난 캔버스를 미리보기로 보내지 않고 임시 DOM을 정리한다',async()=>{
 const controller=new AbortController();let done!:()=>void;capture.wait=()=>new Promise<void>(r=>{done=r;});
 const running=savePartnerMonthlyPdf('2026-08',[],controller.signal);
 await vi.waitFor(()=>expect(capture.pages).toHaveLength(1));controller.abort();done();await running;
 expect(capture.preview).not.toHaveBeenCalled();expect(document.body.querySelector('table')).toBeNull();
});
it('입력 행을 준비 시점에 고정하고 여러 쪽을 모두 준비한 뒤 한번만 확인한다',async()=>{
 const row={partnerId:'a',name:'처음 이름',opening:1,sales:2,cashReceived:0,cashRefunded:0,nonCashDecrease:0,receivableIncrease:2,closing:3,discrepancy:0};
 let done!:()=>void;capture.wait=()=>new Promise<void>(r=>{done=r;});const running=savePartnerMonthlyPdf('2026-08',[row]);
 await vi.waitFor(()=>expect(capture.pages).toHaveLength(1));row.name='바뀐 이름';row.closing=900;done();await running;
 expect(capture.pages[0]).toContain('처음 이름');expect(capture.pages[0]).not.toContain('바뀐 이름');expect(capture.preview).toHaveBeenCalledOnce();
});
