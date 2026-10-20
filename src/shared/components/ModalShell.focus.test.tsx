/** @vitest-environment jsdom */
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import ModalShell from './ModalShell';
import LargeModalShell from './LargeModalShell';
beforeEach(()=>vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue({length:1} as DOMRectList));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('mount focuses dialog, Tab and ShiftTab stay inside and background focus is redirected',()=>{
 render(<><button>배경 필터</button><ModalShell title="반품" onClose={()=>{}}><input aria-label="수량"/><button>접수</button></ModalShell></>);
 const close=screen.getByRole('button',{name:'반품 닫기'}),last=screen.getByRole('button',{name:'접수'});
 expect(close).toHaveFocus();last.focus();fireEvent.keyDown(last,{key:'Tab'});expect(close).toHaveFocus();
 fireEvent.keyDown(close,{key:'Tab',shiftKey:true});expect(last).toHaveFocus();screen.getByRole('button',{name:'배경 필터'}).focus();expect(close).toHaveFocus();
});
it('closing returns to the actual trigger and Escape does not introduce a close action',()=>{
 function Example(){const [open,setOpen]=React.useState(false);return <><button onClick={()=>setOpen(true)}>상세 열기</button>{open&&<ModalShell title="상세" onClose={()=>setOpen(false)}><input aria-label="상세 초안" defaultValue="원입력"/></ModalShell>}</>}
 render(<Example/>);const trigger=screen.getByRole('button',{name:'상세 열기'});trigger.focus();fireEvent.click(trigger);
 const draft=screen.getByRole('textbox',{name:'상세 초안'});fireEvent.change(draft,{target:{value:'유지할 초안'}});fireEvent.click(screen.getByRole('dialog').parentElement!);expect(draft).toHaveValue('유지할 초안');expect(screen.getByRole('dialog')).toBeInTheDocument();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.getByRole('dialog')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'상세 닫기'}));expect(trigger).toHaveFocus();
});
it('nested large modal owns focus and closing it restores the parent control',()=>{
 function Example(){const [inner,setInner]=React.useState(false);return <ModalShell title="부모" onClose={()=>{}}><button onClick={()=>setInner(true)}>큰 상세</button>{inner&&<LargeModalShell title="자식" onClose={()=>setInner(false)}><button>자식 끝</button></LargeModalShell>}</ModalShell>}
 render(<Example/>);const trigger=screen.getByRole('button',{name:'큰 상세'});trigger.focus();fireEvent.click(trigger);const close=screen.getByRole('button',{name:'자식 닫기'});
 fireEvent.click(screen.getByRole('dialog',{name:'자식'}).parentElement!);expect(screen.getAllByRole('dialog')).toHaveLength(2);
 expect(close).toHaveFocus();screen.getByRole('button',{name:'자식 끝'}).focus();fireEvent.keyDown(document.activeElement!,{key:'Tab'});expect(close).toHaveFocus();
 fireEvent.click(close);expect(trigger).toHaveFocus();
});
it('higher-layer dialog owns focus even when an underlying dialog occurs later in DOM',()=>{
 render(<><ModalShell title="상단" layer={2000} onClose={()=>{}}><button>상단 끝</button></ModalShell><ModalShell title="하단" layer={1000} onClose={()=>{}}>내용</ModalShell></>);
 const first=screen.getByRole('button',{name:'상단 닫기'});expect(first).toHaveFocus();screen.getByRole('button',{name:'상단 끝'}).focus();fireEvent.keyDown(document.activeElement!,{key:'Tab'});expect(first).toHaveFocus();
});

it('바깥 클릭은 닫기 콜백을 호출하지 않고 내부 입력과 명시 닫기는 그대로 동작한다',()=>{
 const close=vi.fn();render(<ModalShell title="작성" onClose={close}><input aria-label="작성 초안" defaultValue="보존"/></ModalShell>);
 fireEvent.click(screen.getByRole('dialog').parentElement!);expect(close).not.toHaveBeenCalled();
 expect(screen.getByRole('textbox',{name:'작성 초안'})).toHaveValue('보존');
 fireEvent.click(screen.getByRole('button',{name:'작성 닫기'}));expect(close).toHaveBeenCalledOnce();
});