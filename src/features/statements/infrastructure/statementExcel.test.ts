import { expect, it, vi } from 'vitest';
const output=vi.hoisted(()=>({preview:vi.fn()}));
vi.mock('../../../shared/workbookOutput',()=>({previewWorkbookOutput:output.preview}));
import { buildStatementWorkbook, downloadStatementExcel } from './statementExcel';
const input={type:'매출' as const,docNo:'TEST-1',dateLabel:'2026년 10월 18일',tradeDate:'2026-10-18',partnerName:'합성 거래처',items:[{key:'line-1',no:1,name:'원품목',spec:'kg',qty:2.5,price:100,supply:250,tax:0,total:250,isTaxExempt:true}],totals:{supply:250,tax:0,amount:250}};
it('원전표 품목·10행 서식·면세·합계와 병합을 그대로 만든다',()=>{
 const book=buildStatementWorkbook(input),sheet=book.getWorksheet('매출전표')!;expect(sheet.getCell('D6').value).toBe(2.5);expect(sheet.getCell('G6').value).toBe('면세');expect(sheet.getCell('H16').value).toBe(250);expect(sheet.getCell('B1').master.address).toBe('A1');expect(sheet.rowCount).toBe(16);expect(sheet.getCell('D6').numFmt).toBe('#,##0');
});
it('다운로드 대신 같은 문서와 필수 수명으로 미리보기를 요청하고 사전 취소는 건너뛴다',async()=>{
 const controller=new AbortController();await downloadStatementExcel({...input,signal:controller.signal});expect(output.preview).toHaveBeenCalledOnce();expect(output.preview.mock.calls[0][0]).toMatchObject({fileName:'매출전표_합성 거래처_2026-10-18.xlsx',signal:controller.signal});controller.abort();await downloadStatementExcel({...input,signal:controller.signal});expect(output.preview).toHaveBeenCalledOnce();
});
