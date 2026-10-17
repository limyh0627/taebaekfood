/** @vitest-environment jsdom */
import {beforeEach,expect,it,vi} from 'vitest';
import {snapshotOutputElement} from '../../../shared/rasterPdfOutput';
const m=vi.hoisted(()=>({render:vi.fn(),preview:vi.fn()}));
vi.mock('html2canvas',()=>({default:m.render}));
vi.mock('../../../shared/rasterPdfOutput',async importOriginal=>({...await importOriginal<typeof import('../../../shared/rasterPdfOutput')>(),previewRasterPdf:m.preview}));
import {downloadAsPDF} from './downloadAsPDF';
beforeEach(()=>{m.render.mockReset();m.preview.mockReset();m.preview.mockResolvedValue(undefined);});
it('긴 캔버스의 A4 절단 좌표·축척과 전체 페이지를 미리보기에 전달한다',async()=>{
 const source=document.createElement('div');source.innerHTML='<input value="처음">';document.body.appendChild(source);
 const canvas={width:100,height:300,toDataURL:vi.fn(()=> 'same-image')};m.render.mockResolvedValue(canvas);const signal=new AbortController().signal;
 await downloadAsPDF(source,'long.pdf',signal);
 expect(m.render).toHaveBeenCalledWith(expect.any(HTMLElement),{scale:2,backgroundColor:'#ffffff',useCORS:true});expect(m.render.mock.calls[0][0]).not.toBe(source);
 expect(m.preview).toHaveBeenCalledWith({fileName:'long.pdf',signal,pages:[-0,-297,-594].map(y=>({width:210,height:297,draws:[{image:'same-image',x:0,y,width:210,height:630}]}))});expect(canvas.toDataURL).toHaveBeenCalledTimes(3);expect(m.render.mock.calls[0][0].isConnected).toBe(false);source.remove();
});
it('복사한 입력·체크·선택·textarea는 원폼의 뒤늦은 수정과 분리된다',()=>{
 const source=document.createElement('div');source.innerHTML='<input value="이전"><input type="checkbox"><textarea>이전</textarea><select><option>a</option><option>b</option></select>';
 const input=source.querySelector('input')!,check=source.querySelectorAll('input')[1],text=source.querySelector('textarea')!,select=source.querySelector('select')!;input.value='현재';check.checked=true;text.value='현재 메모';select.value='b';
 const snapshot=snapshotOutputElement(source);input.value='뒤 변경';check.checked=false;text.value='뒤 변경';select.value='a';
 expect(snapshot.element.querySelector('input')!.value).toBe('현재');expect(snapshot.element.querySelectorAll('input')[1].checked).toBe(true);expect(snapshot.element.querySelector('textarea')!.value).toBe('현재 메모');expect(snapshot.element.querySelector('select')!.value).toBe('b');snapshot.dispose();expect(snapshot.element.isConnected).toBe(false);
});
it('캡처 대기 중 취소나 오류는 미리보기를 열지 않고 복사 DOM을 정리한다',async()=>{
 let finish!:(value:unknown)=>void;m.render.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const source=document.createElement('div'),controller=new AbortController();
 const pending=downloadAsPDF(source,'cancel.pdf',controller.signal);await vi.waitFor(()=>expect(m.render).toHaveBeenCalledOnce());controller.abort();finish({width:100,height:100,toDataURL:()=> 'png'});await pending;expect(m.preview).not.toHaveBeenCalled();expect(m.render.mock.calls[0][0].isConnected).toBe(false);
 m.render.mockRejectedValueOnce(Error('캡처 실패'));await expect(downloadAsPDF(source,'failed.pdf',new AbortController().signal)).rejects.toThrow('캡처 실패');expect(m.preview).not.toHaveBeenCalled();
});
