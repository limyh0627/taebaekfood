/** @vitest-environment jsdom */
import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import QrLabelPrint from './QrLabelPrint';
import type {Item} from '../src/shared/types';
const state=vi.hoisted(()=>({html:vi.fn().mockResolvedValue(undefined),auth:{currentUser:{uid:'qa'},onAuthStateChanged:vi.fn(()=>()=>{})}}));
vi.mock('../src/shared/firebase',()=>({auth:state.auth}));
vi.mock('../src/shared/htmlPrintOutput',()=>({previewHtmlPrint:state.html}));
vi.mock('qrcode',()=>({default:{toDataURL:vi.fn().mockResolvedValue('data:image/png;base64,QA')}}));
beforeEach(()=>state.html.mockClear());
const rows:Item[]=[{id:'label-a',name:'<img src=x onerror=alert(1)> & 이름',unit:'"kg',type:'submaterial',stock:0,minStock:0,image:''},{id:'label-b',name:'두번째',unit:'개',type:'submaterial',stock:0,minStock:0,image:''}];
it('전체 선택 라벨은 자동인쇄없이 escaped 문서 한개로 전달하고 닫으면 취소한다',async()=>{
 const close=vi.fn(),view=render(<QrLabelPrint submaterials={rows} onClose={close}/>);await waitFor(()=>expect(document.querySelectorAll('img')).toHaveLength(2));fireEvent.click(screen.getByRole('button',{name:'전체 선택'}));fireEvent.click(screen.getByRole('button',{name:'선택 2개 라벨 인쇄'}));expect(state.html).toHaveBeenCalledOnce();const input=state.html.mock.calls[0][0];expect(input.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; 이름');expect(input.html).toContain('&quot;kg');expect(input.html).toContain('두번째');expect(input.html).not.toMatch(/<script|window\.print|window\.close/);expect(input.signal.aborted).toBe(false);view.unmount();expect(input.signal.aborted).toBe(true);expect(close).not.toHaveBeenCalled();
});
it('선택변경과 회사변경은 이전 라벨 문서 수명을 끝낸다',async()=>{
 const view=render(<QrLabelPrint submaterials={rows} onClose={()=>{}}/>);await waitFor(()=>expect(document.querySelectorAll('img')).toHaveLength(2));fireEvent.click(screen.getByRole('button',{name:'전체 선택'}));fireEvent.click(screen.getByRole('button',{name:'선택 2개 라벨 인쇄'}));const first=state.html.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:'전체 해제'}));expect(first.signal.aborted).toBe(true);fireEvent.click(screen.getByRole('button',{name:'전체 선택'}));fireEvent.click(screen.getByRole('button',{name:'선택 2개 라벨 인쇄'}));const next=state.html.mock.calls[1][0];view.rerender(<QrLabelPrint companyId="punghoe" submaterials={rows} onClose={()=>{}}/>);expect(next.signal.aborted).toBe(true);
});
