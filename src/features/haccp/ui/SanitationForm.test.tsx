// 출력 수명·명시 PDF 분리·월간 캡처 변경만 제외하고 기존 업무 본문을 보호한다.
const withoutOutput=(text:string)=>text.replace(/\r\n/g,'\n').replace(/\n  const outputSignal = useOutputScope[^\n]*;/g,'').replace(/, outputSignal\(\)/g,'').replace(/  useEffect\(\(\) => \{\n    if \(!bulkList\) return;[\s\S]*?\n  \}, \[bulkList\]\);/g,'').replace(/      if \(await appConfirm\('확인 처리되었습니다\.[^\n]*\)\) \{[\s\S]*?\n      \}/g,'').replace(/      alert\('확인 결과를 저장했습니다\.[^\n]*\);/g,'').replace(/ title="확인 결과만 저장합니다\.[^"]*"/g,'');
/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
const m=vi.hoisted(()=>({rows:[] as any[],subs:[] as any[],rafs:[] as FrameRequestCallback[],add:vi.fn(),update:vi.fn(),remove:vi.fn(),confirm:vi.fn(),singlePDF:vi.fn(),raster:vi.fn(),capture:vi.fn(),pdf:{addPage:vi.fn(),addImage:vi.fn(),save:vi.fn()}}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{currentUser:{uid:'output-test'},onAuthStateChanged:()=>()=>{}}}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update,deleteItem:m.remove,setDocument:vi.fn()}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:m.confirm}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.singlePDF}));
vi.mock('../../../shared/rasterPdfOutput',async original=>({...await original<typeof import('../../../shared/rasterPdfOutput')>(),previewRasterPdf:m.raster}));
vi.mock('firebase/firestore',()=>({collection:(_:unknown,name:string)=>({collection:name}),doc:(_:unknown,name:string,id:string)=>({collection:name,id}),where:(field:string,op:string,value:unknown)=>({field,op,value}),query:(ref:object,...clauses:unknown[])=>({...ref,clauses}),onSnapshot:(ref:any,next:any)=>{const stop=vi.fn();m.subs.push({ref,next,stop});if(ref.collection==='haccp_sanitation')next({docs:m.rows.map(row=>({id:row.id,data:()=>row}))});else next({exists:()=>true,data:()=>({items:[{item:'항목A',standard:'기준A'},{item:'항목B',standard:'기준B'}]})});return stop;}}));
vi.mock('jspdf',()=>({default:class {constructor(){return m.pdf;}}}));
vi.mock('html2canvas',()=>({default:m.capture}));
import {SanitationForm} from './SanitationForm';
import {SanitationForm as LegacySanitationForm} from '../../../../components/HaccpChecklist';
import {PersonalHygieneForm as LegacyPersonalForm} from '../../../../components/HaccpChecklist';
import {PersonalHygieneForm} from './PersonalHygieneForm';
import {HaccpCompanyContext} from '../context/HaccpCompanyContext';
import {todayStr} from '../domain/haccpDate';
const canvas={width:1000,height:2000,toDataURL:()=> 'synthetic-png'};
const fixture=(slot='08:30')=>({id:slot,checkDate:todayStr(),checkTime:slot,checkZone:'합성구역',rows:[{result:'pass',note:'',inspector:'합성 담당'}],specialNotes:'',createdBy:'합성 담당',createdAt:'',updatedBy:'합성 담당',updatedAt:'',revisionCount:2});
beforeEach(()=>{m.rows=[];m.subs=[];m.rafs=[];m.add.mockReset().mockResolvedValue('new-id');m.update.mockReset().mockResolvedValue(undefined);m.remove.mockReset();m.confirm.mockReset().mockResolvedValue(false);m.capture.mockReset().mockResolvedValue(canvas);m.singlePDF.mockReset();m.raster.mockReset().mockResolvedValue(undefined);vi.spyOn(window,'alert').mockImplementation(()=>{});Object.values(m.pdf).forEach(fn=>fn.mockReset());vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{m.rafs.push(callback);return m.rafs.length;});});
afterEach(()=>vi.unstubAllGlobals());
const open=()=>fireEvent.click(screen.getByRole('button',{name:/오전 08:30/}));
const renderForm=()=>render(<SanitationForm currentUser={{id:'test',name:'합성 담당'}} isAdmin canConfirm/>);
const twoFrames=async()=>{await act(async()=>{m.rafs.shift()!(0);m.rafs.shift()!(16);});};

it('기존 named export와 같고 부적합 비고 필수·신규/수정 revision을 유지한다',async()=>{
 expect(LegacySanitationForm).toBe(SanitationForm);renderForm();open();
 fireEvent.click(screen.getAllByRole('checkbox')[1]);fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(m.add).not.toHaveBeenCalled();expect(screen.getByText(/부적합 항목의 비고사항/)).toBeInTheDocument();
 fireEvent.change(screen.getByPlaceholderText('필수 입력'),{target:{value:'합성 조치'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());
 expect(m.add).toHaveBeenCalledWith('haccp_sanitation',expect.objectContaining({revisionCount:0,checkTime:'08:30',rows:[expect.objectContaining({result:'fail',note:'합성 조치',inspector:'합성 담당'}),expect.objectContaining({result:''})]}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_sanitation','new-id',expect.objectContaining({revisionCount:1})));
});
it('템플릿보다 짧은 기존 rows를 채우며 다른 행과 슬롯을 바꾸지 않는다',()=>{
 m.rows=[fixture()];renderForm();open();
 const boxes=screen.getAllByRole('checkbox');expect(boxes).toHaveLength(4);expect(boxes[0]).toBeChecked();
 fireEvent.click(boxes[3]);expect(boxes[0]).toBeChecked();expect(boxes[1]).not.toBeChecked();expect(boxes[3]).toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:/오후 15:00/}));expect(screen.getAllByRole('checkbox').every(box=>!(box as HTMLInputElement).checked)).toBe(true);
});
it('회사별 조회와 템플릿 문서·구독 cleanup을 보존한다',()=>{
 const view=render(<HaccpCompanyContext.Provider value="punghoe"><SanitationForm/></HaccpCompanyContext.Provider>);
 expect(m.subs[0].ref).toEqual({collection:'haccp_sanitation',clauses:[{field:'companyId',op:'==',value:'punghoe'}]});expect(m.subs[1].ref.id).toBe('punghoe--sanitation');
 view.rerender(<HaccpCompanyContext.Provider value="taebaek"><SanitationForm/></HaccpCompanyContext.Provider>);expect(m.subs[0].stop).toHaveBeenCalledOnce();expect(m.subs[1].stop).toHaveBeenCalledOnce();
 view.unmount();expect(m.subs[2].stop).toHaveBeenCalledOnce();expect(m.subs[3].stop).toHaveBeenCalledOnce();
});
it('월별 PDF는 2프레임 뒤 표지·날짜/슬롯 순서와 별도 A4 fit를 유지한다',async()=>{
 m.rows=[fixture('15:00'),fixture('08:30')];renderForm();fireEvent.click(screen.getByRole('button',{name:'월별 PDF 생성'}));
 expect(m.capture).not.toHaveBeenCalled();expect(m.rafs).toHaveLength(1);await twoFrames();
 await waitFor(()=>expect(m.raster).toHaveBeenCalledWith(expect.objectContaining({fileName:`작업장위생점검표_${todayStr().slice(0,7)}_월별.pdf`,signal:expect.any(AbortSignal)})));
 expect(m.capture).toHaveBeenCalledTimes(3);expect(m.capture.mock.calls[0][0].textContent).toContain('작업장 위생점검 실시 현황');expect(m.capture.mock.calls[1][0].textContent).toContain('오전 08:30');expect(m.capture.mock.calls[2][0].textContent).toContain('오후 15:00');
 for(const call of m.capture.mock.calls)expect(call[1]).toEqual({scale:2,backgroundColor:'#ffffff',useCORS:true});
 expect(m.raster.mock.calls[0][0].pages).toEqual(Array(3).fill({width:210,height:297,draws:[{image:'synthetic-png',x:30.75,y:0,width:148.5,height:297}]}));expect(m.pdf.save).not.toHaveBeenCalled();expect(m.singlePDF).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'월별 PDF 생성'})).toBeEnabled();
});
it('월별 생성 전 언마운트하면 캡처·저장하지 않는다',async()=>{
 m.rows=[fixture()];const view=renderForm();fireEvent.click(screen.getByRole('button',{name:'월별 PDF 생성'}));view.unmount();await twoFrames();expect(m.capture).not.toHaveBeenCalled();expect(m.pdf.save).not.toHaveBeenCalled();expect(m.raster).not.toHaveBeenCalled();
});
it('진행 중 캡처가 언마운트 뒤 끝나도 다음 페이지·파일 저장을 시작하지 않는다',async()=>{
 let complete!:(value:typeof canvas)=>void;m.capture.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));m.rows=[fixture()];
 const view=renderForm();fireEvent.click(screen.getByRole('button',{name:'월별 PDF 생성'}));await twoFrames();await waitFor(()=>expect(m.capture).toHaveBeenCalledOnce());
 view.unmount();await act(async()=>complete(canvas));expect(m.capture).toHaveBeenCalledOnce();expect(m.pdf.save).not.toHaveBeenCalled();expect(m.raster).not.toHaveBeenCalled();
});
it('원문 initializer와 부모 실연결·공통 정본을 보존한다',()=>{
 const expected:Record<string,string>={emptyRecord:'4421861749638540e7ad6372f77fa3cfb35216212628a97de0fd563bd3cdb20e',SanitationForm:'23440b24680d2f0fee12aa4b1bc915e1747e5ca10f3da002c8c869affd4ba84d',SANITATION_ITEMS:'8030417df33b4ebf42fe915b39ec2f5aa2d92eb3f39247d05de399dd495a3e94',PERSONAL_HYGIENE_COLS:'e90cb1cdb9c36e5c72e75250c7412683fad23b658614cc8e9aae1537659c984a'};const found:Record<string,string>={};
 for(const path of ['src/features/haccp/ui/SanitationForm.tsx','src/features/haccp/domain/sanitationItems.ts','src/features/haccp/domain/personalHygieneColumns.ts']){const text=readFileSync(path,'utf8'),s=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);for(const n of s.statements)if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations){const key=d.name.getText(s);if(expected[key])found[key]=createHash('sha256').update(withoutOutput(d.initializer!.getText(s))).digest('hex');}expect(text).not.toContain('HaccpChecklist');}expect(found).toEqual(expected);
 const parent=readFileSync('components/HaccpChecklist.tsx','utf8');expect(parent).toContain("export {SanitationForm} from '../src/features/haccp/ui/SanitationForm'");expect(parent).not.toContain('const SANITATION_ITEMS =');expect(parent).not.toContain('const PERSONAL_HYGIENE_COLS =');expect(LegacyPersonalForm).toBe(PersonalHygieneForm);
 const protectedExpected:Record<string,string>={useChecklistDraftControl:'6fbc8703559f3dd84e1611718fdb71c45def1f1e44423bdc7cb7c8583a6d81c0',PeriodicSanitationForm:'a43943642153b51019ffa8a04b9ecab5a0d52d7a50c19a444a8f0d33c79a5429',ClosingChecklistForm:'a36fd5164f4337c83b51353fc573b3703305a65e6f6188b1f001f730422b4591'},protectedFound:Record<string,string>={};
 for(const path of ['src/features/haccp/hooks/useChecklistDraftControl.ts','src/features/haccp/ui/PeriodicSanitationForm.tsx','src/features/haccp/ui/ClosingChecklistForm.tsx']){const file=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);for(const node of file.statements){if(ts.isFunctionDeclaration(node)&&node.name&&protectedExpected[node.name.text])protectedFound[node.name.text]=createHash('sha256').update(node.body!.getText(file).replace(/\r\n/g,'\n')).digest('hex');else if(ts.isVariableStatement(node))for(const declaration of node.declarationList.declarations){const name=declaration.name.getText(file);if(protectedExpected[name])protectedFound[name]=createHash('sha256').update(withoutOutput(declaration.initializer!.getText(file))).digest('hex');}}}expect(protectedFound).toEqual(protectedExpected);
});
it('관리자 확인은 한 번 기록하고 PDF를 자동 열지 않으며 별도 출력 취소는 업무를 다시 쓰지 않는다',async()=>{
 m.rows=[{...fixture(),rows:[{result:'pass',note:'',inspector:'확인자'},{result:'pass',note:'',inspector:'확인자'}]}];renderForm();open();fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledOnce());expect(m.update.mock.calls[0][2]).toMatchObject({confirmedBy:'합성 담당'});expect(m.confirm).not.toHaveBeenCalled();expect(m.singlePDF).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'PDF'}));expect(m.singlePDF).toHaveBeenCalledWith(expect.any(HTMLElement),expect.any(String),expect.any(AbortSignal));expect(m.update).toHaveBeenCalledOnce();
});
