/** @vitest-environment jsdom */
import React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import SearchableSelect from './SearchableSelect';
import ModalShell from './ModalShell';
const options=[{value:'a',label:'가을식품'},{value:'b',label:'바다유통'}];
const oldScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
beforeEach(()=>{vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue({length:1} as DOMRectList);Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});});
afterEach(()=>{cleanup();vi.restoreAllMocks();if(oldScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',oldScroll);else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;});
it('실제모달 안에 목록을 띄워 검색초점·초성선택·트리거복귀를 유지한다',()=>{
 const change=vi.fn();render(<ModalShell title="선택" onClose={()=>{}}><SearchableSelect ariaLabel="거래처" value="" onChange={change} options={options} searchThreshold={0}/></ModalShell>);const trigger=screen.getByRole('button',{name:'거래처'});fireEvent.click(trigger);const list=screen.getByRole('listbox'),search=screen.getByRole('textbox',{name:'거래처 검색'});expect(search).toHaveAttribute('placeholder','검색어 입력');expect(screen.getByRole('dialog')).toContainElement(list);expect(search).toHaveFocus();fireEvent.change(search,{target:{value:'ㅂㄷ'}});expect(screen.queryByRole('option',{name:'가을식품'})).not.toBeInTheDocument();fireEvent.keyDown(search,{key:'Enter'});expect(change).toHaveBeenCalledExactlyOnceWith('b');expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(trigger).toHaveFocus();
});
it('첫Escape는목록만닫고초점복원하며둘째Escape는부모의기존닫기를실행한다',()=>{
 const closed=vi.fn();function Example(){const[open,setOpen]=React.useState(true);React.useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){closed();setOpen(false);}};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);},[]);return open?<ModalShell title="선택" onClose={()=>setOpen(false)}><SearchableSelect ariaLabel="거래처" value="" onChange={()=>{}} options={options} searchThreshold={0}/></ModalShell>:null;}
 render(<Example/>);const trigger=screen.getByRole('button',{name:'거래처'});fireEvent.click(trigger);const search=screen.getByRole('textbox');fireEvent.keyDown(search,{key:'Escape'});expect(closed).not.toHaveBeenCalled();expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(trigger).toHaveFocus();fireEvent.keyDown(trigger,{key:'Escape'});expect(closed).toHaveBeenCalledOnce();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('모달밖에서는body포털을유지하고Tab은부모로전파하며목록만닫는다',()=>{
 const key=vi.fn();render(<div onKeyDown={key}><SearchableSelect ariaLabel="거래처" value="a" onChange={()=>{}} options={options} searchThreshold={0}/></div>);fireEvent.click(screen.getByRole('button',{name:'거래처'}));const list=screen.getByRole('listbox');expect(list.parentElement!.parentElement).toBe(document.body);fireEvent.keyDown(screen.getByRole('textbox'),{key:'Tab'});expect(key).toHaveBeenCalledOnce();expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
it('검색배경을눌러목록을닫아도모달닫기콜백을호출하지않는다',()=>{
 const close=vi.fn();render(<ModalShell title="선택" onClose={close}><SearchableSelect ariaLabel="거래처" value="" onChange={()=>{}} options={options} searchThreshold={0}/></ModalShell>);fireEvent.click(screen.getByRole('button',{name:'거래처'}));const backdrop=screen.getByRole('listbox').parentElement!.previousElementSibling!;fireEvent.mouseDown(backdrop);fireEvent.click(backdrop);expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(close).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeInTheDocument();
});
