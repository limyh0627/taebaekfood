/** @vitest-environment jsdom */
import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,screen} from '@testing-library/react';
const m=vi.hoisted(()=>({construct:vi.fn(),pdf:{addPage:vi.fn(),addImage:vi.fn(),output:vi.fn()}}));
vi.mock('jspdf',()=>({default:class{constructor(...args:unknown[]){m.construct(...args);return m.pdf;}}}));
import {prepareRasterPdf,previewRasterPdf,type RasterPdfPage} from './rasterPdfOutput';
const image='data:image/png;base64,aGVsbG8=';
const pages=():RasterPdfPage[]=>[0,-297].map(y=>({width:210,height:297,draws:[{image,x:0,y,width:210,height:400}]}));
beforeEach(()=>{vi.clearAllMocks();m.pdf.output.mockReturnValue(new ArrayBuffer(4));});
it('최종 페이지의 같은 이미지·좌표·크기로 PDF를 한 번 만든다',async()=>{
 const input=pages(),artifact=await prepareRasterPdf(input);expect(m.construct).toHaveBeenCalledWith('p','mm','a4');expect(m.pdf.addPage).toHaveBeenCalledOnce();expect(m.pdf.addImage.mock.calls).toEqual([[image,'PNG',0,0,210,400],[image,'PNG',0,-297,210,400]]);expect(m.pdf.output).toHaveBeenCalledWith('arraybuffer');expect(artifact.pages).toBe(input);
});
it.each(['닫기','수명'])('미리보기 %s 취소와 중복 요청은 파일을 저장하지 않고 정리한다',async mode=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{}),controller=new AbortController();let pending!:Promise<void>;
 await act(async()=>{pending=previewRasterPdf({pages:pages(),fileName:'원문.pdf',signal:controller.signal});});await screen.findByRole('dialog');expect(screen.getAllByRole('region')).toHaveLength(2);
 await previewRasterPdf({pages:pages(),fileName:'중복.pdf',signal:controller.signal});expect(screen.getAllByRole('dialog')).toHaveLength(1);
 await act(async()=>{if(mode==='닫기')fireEvent.click(screen.getByRole('button',{name:'닫기'}));else controller.abort();});await pending;expect(click).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});
it('표시 좌표와 파일을 고정하고 저장 오류 재시도에도 같은 PDF를 쓴다',async()=>{
 const create=vi.fn(()=> 'blob:pdf'),revoke=vi.fn();Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke});
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementationOnce(()=>{throw Error('저장 실패');}).mockImplementation(()=>{});const input=pages();let pending!:Promise<void>;
 await act(async()=>{pending=previewRasterPdf({pages:input,fileName:'확인.pdf',signal:new AbortController().signal});});const dialog=await screen.findByRole('dialog');input[0].draws[0].y=999;
 const img=dialog.querySelectorAll('img')[1];expect(img.style.top).toBe('-100%');expect(img.style.height).toBe(`${400/297*100}%`);
 fireEvent.click(screen.getByRole('button',{name:'PDF 저장'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'PDF 저장'}));await act(async()=>pending);
 expect(m.pdf.output).toHaveBeenCalledOnce();expect(click).toHaveBeenCalledTimes(2);expect(revoke).toHaveBeenCalledTimes(2);expect(screen.queryByRole('dialog')).toBeNull();
});
it('가로·세로 혼합 문서도 미리보기와 같은 페이지 크기 및 방향으로 생성한다',async()=>{
 const input:RasterPdfPage[]=[{width:297,height:210,draws:[{image,x:0,y:0,width:297,height:210}]},{width:210,height:297,draws:[{image,x:0,y:0,width:210,height:297}]}];await prepareRasterPdf(input);expect(m.construct).toHaveBeenCalledWith('l','mm',[297,210]);expect(m.pdf.addPage).toHaveBeenCalledWith([210,297],'p');expect(m.pdf.addImage.mock.calls[0]).toEqual([image,'PNG',0,0,297,210]);
});
