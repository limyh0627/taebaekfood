/** @vitest-environment jsdom */
import {render,screen,fireEvent,act} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import RawMaterialEntryModal from './RawMaterialEntryModal';
import {rawPressAttemptKey,saveRawPressAttempt,rawPressYieldKg,type RawPressRequest} from '../src/shared/rawPressAttempt';
import type {RawMaterialEntry,RawMaterialLot} from '../src/shared/types';
const lot={id:'lot',status:'active',kgRemaining:200} as RawMaterialLot;
function request(entry:RawMaterialEntry,uid='uid',companyId:'taebaek'|'punghoe'='taebaek'):RawPressRequest{
 return {version:1,companyId,actorUid:uid,entry,yieldRule:{product:'통깨참기름',rate:0.48},sourceCommand:{operationId:entry.id,companyId,rawItemId:'source',materialSnapshot:entry.material,effectiveAt:entry.effectiveAt!,source:{type:'manual',id:entry.id},kind:'consume-lot',kg:entry.used,lotId:entry.targetLotId!},derivedCommand:{operationId:`yield:${entry.id}`,companyId,rawItemId:'derived',materialSnapshot:'통깨참기름',effectiveAt:entry.effectiveAt!,source:{type:'manual',id:entry.id},kind:'receive',kg:rawPressYieldKg(entry.used,0.48),lot:{supplierName:'압착'}},sourceLegacy:{},derivedLegacy:{}};
}
function pending(){const entry={id:'fixed',companyId:'taebaek',material:'참깨',date:'2026-10-01',received:0,used:100,note:'최초메모',createdAt:'2026-10-01T03:00:00Z',effectiveAt:'2026-10-01T12:00:00+09:00',targetLotId:'lot',type:'manual'} as RawMaterialEntry;saveRawPressAttempt(request(entry));return entry;}
function props(){return {open:true,mode:'usage' as const,materials:['참깨'],companyId:'taebaek' as const,actorUid:'uid',getActorUid:()=> 'uid',rawYieldRules:{참깨:{product:'통깨참기름',rate:0.48}},lotsForMaterial:()=>[lot],onClose:vi.fn(),onSubmit:vi.fn().mockResolvedValue(true)};}
afterEach(()=>{localStorage.clear();vi.useRealTimers();});
it('현재 운영 수율로 canonical kg를 안내하고 첫 ID·시각을 한 번만 만든다',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T06:00:00Z'));const p=props();render(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});
 expect(screen.getByText(/자동 입고됩니다/)).toHaveTextContent('48kg');fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>{});
 expect(p.onSubmit).toHaveBeenCalledTimes(1);const entry=p.onSubmit.mock.calls[0][0];expect(entry).toMatchObject({used:100,companyId:'taebaek',createdAt:'2026-10-12T06:00:00.000Z',effectiveAt:'2026-10-12T06:00:00.000Z'});expect(entry.id).toMatch(/^rm-use-/);expect(p.onClose).toHaveBeenCalledTimes(1);
});
it('과거 날짜는 noon을 첫 원문으로 고정한다',async()=>{
 const p=props();render(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('날짜'),{target:{value:'2026-01-01'}});fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>{});expect(p.onSubmit.mock.calls[0][0].effectiveAt).toBe('2026-01-01T12:00:00+09:00');
});
it('unknown 뒤에는 입력·규칙 변경 없이 최초 원문으로 재개한다',async()=>{
 const p=props();p.onSubmit.mockImplementationOnce(async entry=>{saveRawPressAttempt(request(entry));throw Error('응답 유실');});p.onSubmit.mockResolvedValueOnce(true);
 const view=render(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>{});expect(p.onClose).not.toHaveBeenCalled();expect(screen.getByLabelText('사용량')).toBeDisabled();const first=p.onSubmit.mock.calls[0][0];
 view.rerender(<RawMaterialEntryModal {...p} rawYieldRules={{참깨:{product:'다른기름',rate:0.2}}}/>);fireEvent.click(screen.getByRole('button',{name:'이전 요청 재개'}));await act(async()=>{});expect(p.onSubmit.mock.calls[1][0]).toEqual(first);
});
it('새로 연 모달은 보존 요청을 재개하며 현재 로트가 없어도 원문을 바꾸지 않는다',async()=>{
 const entry=pending(),p=props();render(<RawMaterialEntryModal {...p} lotsForMaterial={()=>[]}/>);fireEvent.click(screen.getByRole('button',{name:'이전 요청 재개'}));await act(async()=>{});expect(p.onSubmit).toHaveBeenCalledWith(entry);
});
it('압착 pending이 있어도 일반 입고는 기존 새 입고 입력으로 저장한다',async()=>{
 pending();const p=props();render(<RawMaterialEntryModal {...p} mode="inbound"/>);fireEvent.change(screen.getByLabelText('입고량'),{target:{value:'25'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>{});expect(p.onSubmit.mock.calls[0][0]).toMatchObject({received:25,used:0});expect(p.onSubmit.mock.calls[0][0].id).not.toBe('fixed');expect(localStorage.getItem(rawPressAttemptKey('taebaek','uid'))).not.toBeNull();
});
it('손상 pending은 원문 유지·callback0이며 일반 입고는 막지 않는다',()=>{
 const key=rawPressAttemptKey('taebaek','uid');localStorage.setItem(key,'');const p=props(),view=render(<RawMaterialEntryModal {...p}/>);expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(localStorage.getItem(key)).toBe('');expect(p.onSubmit).not.toHaveBeenCalled();view.rerender(<RawMaterialEntryModal {...p} mode="inbound"/>);expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();
});
it('처리 중 닫기와 중복 submit을 보호하고 실패로 닫히지 않는다',async()=>{
 let finish!:(v:boolean)=>void;const p=props();p.onSubmit.mockReturnValue(new Promise(resolve=>finish=resolve));render(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});const save=screen.getByRole('button',{name:'저장'});fireEvent.click(save);fireEvent.click(save);fireEvent.click(screen.getByRole('button',{name:'원료 사용 기록 닫기'}));expect(p.onSubmit).toHaveBeenCalledTimes(1);expect(p.onClose).not.toHaveBeenCalled();await act(async()=>finish(false));expect(p.onClose).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'이전 요청 재개'})).toBeEnabled();
});
it('회사·모달 세대 전환 뒤 늦은 성공은 새 모달을 닫지 않는다',async()=>{
 let finish!:(v:boolean)=>void;const p=props();p.onSubmit.mockReturnValueOnce(new Promise(resolve=>finish=resolve));const view=render(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));view.rerender(<RawMaterialEntryModal {...p} companyId="punghoe"/>);await act(async()=>finish(true));expect(p.onClose).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();
});
it('같은 회사의 UID 변경 뒤 늦은 성공도 화면을 닫지 않는다',async()=>{
 let uid='uid',finish!:(v:boolean)=>void;const p=props();p.getActorUid=()=>uid;p.onSubmit.mockReturnValueOnce(new Promise(resolve=>finish=resolve));render(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));uid='other';await act(async()=>finish(true));expect(p.onClose).not.toHaveBeenCalled();
});
it('재개 전 다른 pending으로 치환되면 다른 요청을 전송하지 않는다',async()=>{
 const entry=pending(),p=props();render(<RawMaterialEntryModal {...p}/>);localStorage.setItem(rawPressAttemptKey('taebaek','uid'),JSON.stringify(request({...entry,id:'other'})));fireEvent.click(screen.getByRole('button',{name:'이전 요청 재개'}));await act(async()=>{});expect(p.onSubmit).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('원문이 변경');
});
it('같은 회사 닫힘·재개 뒤 새 요청 busy는 옛 finally가 풀지 않는다',async()=>{
 let first!:(v:boolean)=>void,second!:(v:boolean)=>void;const p=props();p.onSubmit.mockReturnValueOnce(new Promise(r=>first=r)).mockReturnValueOnce(new Promise(r=>second=r));const view=render(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));view.rerender(<RawMaterialEntryModal {...p} open={false}/>);view.rerender(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>first(true));expect(p.onClose).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'저장 중...'})).toBeDisabled();await act(async()=>second(true));expect(p.onClose).toHaveBeenCalledTimes(1);
});
it('canEditRetry가 있어도 다른 pending이 남으면 입력을 풀지 않는다',async()=>{
 const p=props();p.onSubmit.mockImplementation(async entry=>{saveRawPressAttempt(request(entry));return {ok:false,canEditRetry:true,reason:'재확인'} as any;});render(<RawMaterialEntryModal {...p}/>);fireEvent.change(screen.getByLabelText('사용량'),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await act(async()=>{});expect(screen.getByLabelText('사용량')).toBeDisabled();expect(screen.getByRole('button',{name:'이전 요청 재개'})).toBeEnabled();
});
