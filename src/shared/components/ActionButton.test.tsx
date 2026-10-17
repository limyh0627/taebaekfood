/** @vitest-environment jsdom */
import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ActionButton from './ActionButton';

it('기본은 폼 제출이 아닌 한 번의 일반 버튼 동작이다',()=>{
  const submit=vi.fn(event=>event.preventDefault()),click=vi.fn(),ref=React.createRef<HTMLButtonElement>();
  render(<form onSubmit={submit}><ActionButton ref={ref} onClick={click} title="도움말" aria-label="엑셀 내보내기">엑셀</ActionButton></form>);
  const button=screen.getByRole('button',{name:'엑셀 내보내기'});expect(ref.current).toBe(button);expect(button).toHaveAttribute('type','button');
  fireEvent.click(button);expect(click).toHaveBeenCalledOnce();expect(submit).not.toHaveBeenCalled();
});
it('명시한 제출과 비활성화 등 native props를 보존한다',()=>{
  const submit=vi.fn(event=>event.preventDefault()),click=vi.fn();
  const view=render(<form onSubmit={submit}><ActionButton type="submit" name="action" value="save" onClick={click}>저장</ActionButton></form>);
  fireEvent.click(screen.getByRole('button'));expect(submit).toHaveBeenCalledOnce();
  view.rerender(<ActionButton disabled onClick={click}>저장</ActionButton>);fireEvent.click(screen.getByRole('button'));expect(click).toHaveBeenCalledOnce();
});
it.each(['normal','primary','recovery'] as const)('%s도 같은 크기·글꼴을 사용하고 역할 색만 구분한다',tone=>{
  render(<ActionButton tone={tone}>실행</ActionButton>);
  const button=screen.getByRole('button');expect(button).toHaveClass('h-9','text-xs','font-semibold','whitespace-nowrap','shrink-0');
  expect(button).toHaveClass(tone==='primary'?'bg-indigo-600':'bg-white');
  expect(button).toHaveClass(tone==='normal'?'border-slate-200':tone==='primary'?'border-indigo-600':'border-amber-300');
});
