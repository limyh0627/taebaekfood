/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {달력열기} from './orderDateInteraction';
it('같은 클릭에서 부모 전파를 멈추고 스크롤 없는 focus 뒤 달력을 연다',()=>{
 const parent=vi.fn(),picker=vi.fn(),change=vi.fn();render(<div onClick={parent}><input aria-label="날짜" type="date" onClick={달력열기} onChange={change}/></div>);
 const input=screen.getByLabelText('날짜') as HTMLInputElement;Object.defineProperty(input,'showPicker',{value:picker,configurable:true});const focus=vi.spyOn(input,'focus');
 fireEvent.click(input);expect(focus).toHaveBeenCalledWith({preventScroll:true});expect(input).toHaveFocus();expect(picker).toHaveBeenCalledOnce();expect(parent).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
});
it.each(['absent','blocked'])('showPicker가 %s여도 입력 focus와 직접 입력 가능 상태를 유지한다',kind=>{
 render(<input aria-label="날짜" type="date" onClick={달력열기}/>);const input=screen.getByLabelText('날짜') as HTMLInputElement;
 Object.defineProperty(input,'showPicker',{value:kind==='absent'?undefined:()=>{throw Error('사용자 제스처 차단');},configurable:true});expect(()=>fireEvent.click(input)).not.toThrow();expect(input).toHaveFocus();expect(input).not.toBeDisabled();
});
