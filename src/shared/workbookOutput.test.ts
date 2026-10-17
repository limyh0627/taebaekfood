/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Workbook } from 'exceljs';
import { prepareWorkbookOutput, previewWorkbookOutput, confirmWorkbookOutput, downloadWorkbookArtifact } from './workbookOutput';

function workbook() { const book = new Workbook(), sheet = book.addWorksheet('첫 문서'); sheet.columns = [{width:20},{width:12}]; sheet.mergeCells('A1:B1'); sheet.getCell('A1').value='문서 제목'; sheet.getRow(2).height=30; sheet.getCell('A3').value=2.5; sheet.getCell('A3').numFmt='#,##0'; sheet.getCell('B3').value={formula:'1+2',result:3}; sheet.getCell('B3').numFmt='0.00'; book.addWorksheet('둘째 문서').getCell('A1').value='둘째'; return book; }
it('최종 파일의 모든 시트·병합·열폭·빈행·서식과 수식 캐시 표시를 보존한다', async () => {
 const book=workbook(), artifact=await prepareWorkbookOutput(book);
 expect(artifact.sheets.map(sheet=>sheet.name)).toEqual(['첫 문서','둘째 문서']);
 expect(artifact.sheets[0].rows).toHaveLength(3); expect(artifact.sheets[0].rows[0].cells).toHaveLength(1); expect(artifact.sheets[0].rows[0].cells[0]).toMatchObject({text:'문서 제목',colSpan:2,rowSpan:1});
 expect(artifact.sheets[0].widths).toEqual([145,89]); expect(artifact.sheets[0].rows[1].height).toBe(40); expect(artifact.sheets[0].rows[1].cells.every(cell=>cell.text==='')).toBe(true);
 expect(artifact.sheets[0].rows[2].cells.map(cell=>cell.text)).toEqual(['3','3.00']);
 const restored=new Workbook(); await restored.xlsx.load(artifact.buffer); expect(restored.getWorksheet('첫 문서')!.getCell('A3').value).toBe(2.5);
});
it('출력 확인 전 취소와 동시 요청은 다운로드하지 않는다', async () => {
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{}); let pending!:Promise<void>;
 await act(async()=>{pending=previewWorkbookOutput({workbook:workbook(),fileName:'문서.xlsx',signal:new AbortController().signal});});
 await screen.findByRole('dialog'); await previewWorkbookOutput({workbook:workbook(),fileName:'겹침.xlsx',signal:new AbortController().signal}); expect(screen.getAllByRole('dialog')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'닫기'})); await act(async()=>pending); expect(click).not.toHaveBeenCalled();
});
it('다운로드 실패 재시도도 동일한 한 번 생성한 파일을 사용하고 URL을 정리한다',async()=>{
 const book=workbook(), write=vi.spyOn(book.xlsx,'writeBuffer');
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:document')}); const revoke=vi.fn(); Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke});
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementationOnce(()=>{throw Error('다운로드 실패');}).mockImplementation(()=>{});let pending!:Promise<void>;
 await act(async()=>{pending=previewWorkbookOutput({workbook:book,fileName:'고정.xlsx',signal:new AbortController().signal});}); await screen.findByText('문서 제목'); book.getWorksheet('첫 문서')!.getCell('A1').value='변경';
 fireEvent.click(screen.getByRole('button',{name:'엑셀 저장'})); await screen.findByRole('alert'); expect(screen.getByText('문서 제목')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'엑셀 저장'})); await act(async()=>pending); expect(click).toHaveBeenCalledTimes(2);expect(write).toHaveBeenCalledOnce();expect(revoke).toHaveBeenCalledTimes(2);
});
it('파일 생성 중 인증 수명이 끝나면 모달과 다운로드를 만들지 않는다',async()=>{
 const book=workbook(), original=await book.xlsx.writeBuffer(); let finish!:(value:typeof original)=>void;
 vi.spyOn(book.xlsx,'writeBuffer').mockImplementation(()=>new Promise(resolve=>{finish=resolve;})); const controller=new AbortController(); const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 const pending=previewWorkbookOutput({workbook:book,fileName:'취소.xlsx',signal:controller.signal});controller.abort();finish(original);await pending;expect(screen.queryByRole('dialog')).toBeNull();expect(click).not.toHaveBeenCalled();
});

it('승인 전용 미리보기는 파일을 저장하지 않고 명시 승인만 반환한다',async()=>{
 const artifact=await prepareWorkbookOutput(workbook()),signal=new AbortController().signal,click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});let pending!:Promise<boolean>;
 await act(async()=>{pending=confirmWorkbookOutput({artifact,fileName:'승인.xlsx',signal});});await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'이 내용으로 진행'}));let approved=false;await act(async()=>{approved=await pending;});expect(approved).toBe(true);expect(click).not.toHaveBeenCalled();expect(downloadWorkbookArtifact(artifact,'승인.xlsx',signal)).toBe(true);expect(click).toHaveBeenCalledOnce();
});
