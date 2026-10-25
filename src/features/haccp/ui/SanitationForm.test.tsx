// 출력 수명·명시 PDF 분리·월간 캡처 변경만 제외하고 기존 업무 본문을 보호한다.
const withoutOutput=(text:string)=>text.replace(/\r\n/g,'\n').replace(/\n  const outputSignal = useOutputScope[^\n]*;/g,'').replace(/, outputSignal\(\)/g,'').replace(/  useEffect\(\(\) => \{\n    if \(!bulkList\) return;[\s\S]*?\n  \}, \[bulkList\]\);/g,'').replace(/      if \(await appConfirm\('확인 처리되었습니다\.[^\n]*\)\) \{[\s\S]*?\n      \}/g,'').replace(/      alert\('확인 결과를 저장했습니다\.[^\n]*\);/g,'').replace(/ title="확인 결과만 저장합니다\.[^"]*"/g,'');
/** @vitest-environment jsdom */
import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as ts from 'typescript';
const m=vi.hoisted(()=>({user:{uid:'output-test'} as {uid:string}|null,listeners:new Set<(user:{uid:string}|null)=>void>(),recordsCache:false,templateCache:false,templateExists:true,rows:[] as any[],subs:[] as any[],rafs:[] as FrameRequestCallback[],add:vi.fn(),update:vi.fn(),remove:vi.fn(),confirm:vi.fn(),singlePDF:vi.fn(),raster:vi.fn(),capture:vi.fn(),pdf:{addPage:vi.fn(),addImage:vi.fn(),save:vi.fn()}}));
vi.mock('../../../shared/firebase',()=>({db:{},auth:{get currentUser(){return m.user;},onAuthStateChanged:(callback:(user:{uid:string}|null)=>void)=>{m.listeners.add(callback);return()=>m.listeners.delete(callback);}}}));
vi.mock('../../../shared/services/firebaseService',()=>({addItem:m.add,updateItem:m.update,deleteItem:m.remove,setDocument:vi.fn()}));
vi.mock('../../../shared/components/appDialog',()=>({appConfirm:m.confirm}));
vi.mock('../infrastructure/downloadAsPDF',()=>({downloadAsPDF:m.singlePDF}));
vi.mock('../../../shared/rasterPdfOutput',async original=>({...await original<typeof import('../../../shared/rasterPdfOutput')>(),previewRasterPdf:m.raster}));
vi.mock('firebase/firestore',()=>({collection:(_:unknown,name:string)=>({collection:name}),doc:(_:unknown,name:string,id:string)=>({collection:name,id}),where:(field:string,op:string,value:unknown)=>({field,op,value}),query:(ref:object,...clauses:unknown[])=>({...ref,clauses}),onSnapshot:(ref:any,...args:any[])=>{const next=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2];const stop=vi.fn();m.subs.push({ref,next,error,stop});if(ref.collection==='haccp_sanitation')next({docs:m.rows.map(row=>({id:row.id,data:()=>row})),metadata:{fromCache:m.recordsCache}});else next({exists:()=>m.templateExists,data:()=>({items:[{item:'항목A',standard:'기준A'},{item:'항목B',standard:'기준B'}]}),metadata:{fromCache:m.templateCache}});return stop;}}));
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
beforeEach(()=>{m.user={uid:'output-test'};m.listeners.clear();m.recordsCache=false;m.templateCache=false;m.templateExists=true;m.rows=[];m.subs=[];m.rafs=[];m.add.mockReset().mockResolvedValue('new-id');m.update.mockReset().mockResolvedValue(undefined);m.remove.mockReset();m.confirm.mockReset().mockResolvedValue(false);m.capture.mockReset().mockResolvedValue(canvas);m.singlePDF.mockReset();m.raster.mockReset().mockResolvedValue(undefined);vi.spyOn(window,'alert').mockImplementation(()=>{});Object.values(m.pdf).forEach(fn=>fn.mockReset());vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{m.rafs.push(callback);return m.rafs.length;});});
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
 const expected:Record<string,string>={emptyRecord:'4421861749638540e7ad6372f77fa3cfb35216212628a97de0fd563bd3cdb20e',SANITATION_ITEMS:'8030417df33b4ebf42fe915b39ec2f5aa2d92eb3f39247d05de399dd495a3e94',PERSONAL_HYGIENE_COLS:'e90cb1cdb9c36e5c72e75250c7412683fad23b658614cc8e9aae1537659c984a'};const found:Record<string,string>={};
 for(const path of ['src/features/haccp/ui/SanitationForm.tsx','src/features/haccp/domain/sanitationItems.ts','src/features/haccp/domain/personalHygieneColumns.ts']){const text=readFileSync(path,'utf8'),s=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);for(const n of s.statements)if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations){const key=d.name.getText(s);if(expected[key])found[key]=createHash('sha256').update(withoutOutput(d.initializer!.getText(s))).digest('hex');}expect(text).not.toContain('HaccpChecklist');}expect(found).toEqual(expected);
 const parent=readFileSync('components/HaccpChecklist.tsx','utf8');expect(parent).toContain("export {SanitationForm} from '../src/features/haccp/ui/SanitationForm'");expect(parent).not.toContain('const SANITATION_ITEMS =');expect(parent).not.toContain('const PERSONAL_HYGIENE_COLS =');expect(LegacyPersonalForm).toBe(PersonalHygieneForm);
 const protectedExpected:Record<string,string>={useChecklistDraftControl:'6fbc8703559f3dd84e1611718fdb71c45def1f1e44423bdc7cb7c8583a6d81c0'},protectedFound:Record<string,string>={};
 for(const path of ['src/features/haccp/hooks/useChecklistDraftControl.ts','src/features/haccp/ui/PeriodicSanitationForm.tsx','src/features/haccp/ui/ClosingChecklistForm.tsx']){const file=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);for(const node of file.statements){if(ts.isFunctionDeclaration(node)&&node.name&&protectedExpected[node.name.text])protectedFound[node.name.text]=createHash('sha256').update(node.body!.getText(file).replace(/\r\n/g,'\n')).digest('hex');else if(ts.isVariableStatement(node))for(const declaration of node.declarationList.declarations){const name=declaration.name.getText(file);if(protectedExpected[name])protectedFound[name]=createHash('sha256').update(withoutOutput(declaration.initializer!.getText(file))).digest('hex');}}}expect(protectedFound).toEqual(protectedExpected);
});
it('관리자 확인은 한 번 기록하고 PDF를 자동 열지 않으며 별도 출력 취소는 업무를 다시 쓰지 않는다',async()=>{
 m.rows=[{...fixture(),rows:[{result:'pass',note:'',inspector:'확인자'},{result:'pass',note:'',inspector:'확인자'}]}];renderForm();open();fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledOnce());expect(m.update.mock.calls[0][2]).toMatchObject({confirmedBy:'합성 담당'});expect(m.confirm).not.toHaveBeenCalled();expect(m.singlePDF).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'PDF'}));expect(m.singlePDF).toHaveBeenCalledWith(expect.any(HTMLElement),expect.any(String),expect.any(AbortSignal));expect(m.update).toHaveBeenCalledOnce();
});


const pending=<T,>()=>{let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const latestSub=(name:string)=>m.subs.filter(sub=>sub.ref.collection===name).at(-1);
const deliver=(rows:any[])=>act(()=>latestSub('haccp_sanitation').next({docs:rows.map(row=>({id:row.id,data:()=>row})),metadata:{fromCache:false}}));
it('삭제 확인 뒤 현재 관리자 권한을 재검해 송신하지 않는다',async()=>{
 m.rows=[fixture()];const d=pending<boolean>();m.confirm.mockReturnValue(d.promise);
 const view=renderForm();open();fireEvent.click(screen.getByRole('button',{name:/점검 기록 조회/}));fireEvent.click(view.container.querySelector('[role=button]')!);
 expect(m.confirm).toHaveBeenCalledOnce();view.rerender(<SanitationForm currentUser={{id:'test',name:'합성 담당'}} isAdmin={false} canConfirm={false}/>);
 await act(async()=>d.resolve(true));expect(m.remove).not.toHaveBeenCalled();
});
it('템플릿 오류 뒤 초안을 유지하며 송신을 막고 명시 재조회한다',async()=>{
 renderForm();open();fireEvent.change(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요'),{target:{value:'조회오류초안'}});
 act(()=>latestSub('haccp_templates').error?.({code:'unavailable'}));
 fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(m.add).not.toHaveBeenCalled();
 expect(screen.getByRole('alert')).toHaveTextContent('다시 조회');fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));
 expect(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요')).toHaveValue('조회오류초안');
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());
});
it('저장 대기 중 슬롯과 입력을 잠그고 한 번만 송신한다',async()=>{
 const d=pending<string>();m.add.mockReturnValue(d.promise);renderForm();open();
 fireEvent.change(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요'),{target:{value:'오전초안'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 fireEvent.click(screen.getByRole('button',{name:/오후 15:00/}));fireEvent.change(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요'),{target:{value:'침범'}});
 expect(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요')).toHaveValue('오전초안');expect(m.add).toHaveBeenCalledOnce();
 await act(async()=>d.resolve('ack-id'));expect(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요')).toHaveValue('오전초안');
});


// 수명·조회만 변경하며 도메인 계산·writer 원문과 PDF 정본은 이전 SHA로 보호한다.
const sanitationPreserved=(text:string)=>{
 const file=ts.createSourceFile('SanitationForm.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),result:Record<string,string>={};
 const stable=new Set(['emptyRecord','padRows','allChecked','todayMorning','todayAfternoon','isToday','isReadOnly','monthRecordsSorted','startBulkDownload','revLabel','slotLabel','resultBadge','monthOptions','historyList','historyDates','historyConfirmed','historyFail']);
 const hash=(key:string,node:ts.Node)=>{result[key]=createHash('sha256').update(node.getText(file).replace(/\r\n/g,'\n')).digest('hex');};
 const visit=(node:ts.Node,scope='')=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){
   const name=node.name.text;if(stable.has(name))hash(name,node.initializer);
   if(['handleSave','handleConfirm','setRow','toggleResult'].includes(name))scope=name;
   if(['handleSave','handleConfirm'].includes(scope)&&['data','update','newRev','now','userName','missingNote'].includes(name))hash(scope+':'+name,node.initializer);
  }
  if(ts.isCallExpression(node)&&node.expression.getText(file)==='setSelected'&&['setRow','toggleResult'].includes(scope))hash(scope+':rows',node.arguments[0]);
  if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'&&node.arguments[0]?.getText(file).includes('if (!bulkList) return;'))hash('bulkOutputEffect',node);
  if((ts.isJsxSelfClosingElement(node)||ts.isJsxElement(node))){const tag=ts.isJsxElement(node)?node.openingElement.tagName.getText(file):node.tagName.getText(file);if(['SanitationPrintable','SanitationMonthlyCover'].includes(tag))hash('print:'+tag,node);}
  ts.forEachChild(node,child=>visit(child,scope));
 };visit(file);return result;
};
it('수명 변경 밖 날짜·슬롯·revision·writer payload·PDF AST를 보존한다',()=>{expect(sanitationPreserved(readFileSync('src/features/haccp/ui/SanitationForm.tsx','utf8'))).toEqual({
  "emptyRecord": "4421861749638540e7ad6372f77fa3cfb35216212628a97de0fd563bd3cdb20e",
  "monthRecordsSorted": "228459268d8c37373e7d774554abe5e263f9e7dce50a551a839c29f2ba0d6c8f",
  "startBulkDownload": "cf298318bcd4657cc0b3d6b5d374008369203a8d12f9cf5bf6259dfafca582ce",
  "bulkOutputEffect": "be0428445bcf7945186c3259a48b72280dfd009db284b4f614c617a3d7818719",
  "todayMorning": "7b67672a413a1add2ba78102635ed96964f1cbbc6a36790fa7a8622063e3f69e",
  "todayAfternoon": "9b0214ddc987bfa2c9c2b3db40c93e0bb22cb01620b834957eb86d50798363b2",
  "isToday": "2f9e50baf3aaf77c7a48831d008877ca6bc378581d59849a1b6e4d9e5fe2cf17",
  "isReadOnly": "f43aa9a552fef95f8d970824e384a19fa7e40a9089dcbdb96430eb4c34e469ce",
  "allChecked": "343ad05cf49aaacac9acc0d2598c90c9b8d1ef186713e9826ec4037cc5040849",
  "padRows": "86515e03c0108dbf5b7a10a80b976b4b8b871a4be81072ad64609a3daacfa199",
  "setRow:rows": "7dab021baa9a904938531190e1904b2586de9ce6eb2d7d6a210bc506c5d46745",
  "toggleResult:rows": "b15c834018f797a503458d4b65c5b48e808b577fa8c96b4a922513361939057e",
  "handleSave:missingNote": "f8660cbb90025326305e660baf5a2529b88f697a19d3808c09635a29fbc1c0df",
  "handleSave:now": "c3b9a00586a0c69c38799a013a999abea28ca2bccd7793a4b699be0ca103b3c4",
  "handleSave:userName": "2b1992e6ddcd85779420d239aa027eceee0f9ac628bd341312f87d7b42043060",
  "handleSave:data": "17266a519f30e593ce9a5d9ea0c1cecf96129eed4f9e333c5f10e00279f9c65f",
  "handleSave:newRev": "293634fc8700eb3db5434fbc85666fe2ec67f82e8ad9d002f6f1834109a95731",
  "handleSave:update": "57f49b8c0ab02a870c95d83ba9fd21e3ddf3692df6c20052b626d22d9c14a99a",
  "handleConfirm:now": "c3b9a00586a0c69c38799a013a999abea28ca2bccd7793a4b699be0ca103b3c4",
  "handleConfirm:userName": "0faa609927b8d86194cd0c310b0d8cf5329e005e92fec4062807ecf2cca6eeb9",
  "handleConfirm:update": "4deb4496d1b0f3e670d1083dc93acd788992bb997061212ce9395ca08be03b9e",
  "revLabel": "fbf5ee170e1ef069714fb3cf0e0a98ab14ed6ee01d7fda646cfe18bb9ebea4be",
  "slotLabel": "4ff9538e39b35d59b31e2372d9c66f9571679830138b3ce3a757d53d683f74a2",
  "resultBadge": "1789e939fdb8ca048f8cf4a6fdb83434c8d1f7ef93f6900f3c1bd15ae8cc9a64",
  "monthOptions": "d36719b849aa092808caa69940a8621fa8526f728da813188e9b7a6bb3d5f14f",
  "historyList": "3743997d587bb09e2a06e0ef72435e0222cf6d6f95c9d7029e5223c1d8183e0d",
  "historyDates": "499465265500e1de87f6943db6cda107d6be5f47ee2700e3568ff416965d286c",
  "historyConfirmed": "8149b980574d1e8a3221b89d6a54f3a6dfdfd6012e098364128ab4853c410e05",
  "historyFail": "f77ec3796116923117e50857b0735b79f6b1cf651995d14fcce3355142721501",
  "print:SanitationMonthlyCover": "7b8b7affe1ec6e85e886b1cd2689e97baf9f69d248e2216076e9708cf0b9fc58",
  "print:SanitationPrintable": "c81fea3d404531a2c5720be46bdc26ea322e3d8e709ca3ca11464a88343b0d68"
});});
it('캐시만 있는 기록·템플릿은 송신하지 않고 조회 중 초안은 편집할 수 있다',async()=>{
 m.recordsCache=true;m.templateCache=true;renderForm();open();
 const notes=screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요');fireEvent.change(notes,{target:{value:'조회중초안'}});
 expect(notes).toHaveValue('조회중초안');expect(screen.getAllByText('조회 필요')).toHaveLength(2);expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();
 deliver([]);expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();
 act(()=>latestSub('haccp_templates').next({exists:()=>false,metadata:{fromCache:false}}));
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());
 expect(m.add.mock.calls[0][1].specialNotes).toBe('조회중초안');
});
it('기록 조회 오류는 정상 빈결과와 구분하고 재조회가 초안을 보존한다',()=>{
 renderForm();open();const notes=screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요');fireEvent.change(notes,{target:{value:'보존초안'}});
 const old=latestSub('haccp_sanitation');act(()=>old.error({code:'permission-denied'}));
 expect(screen.queryAllByText('미작성')).toHaveLength(0);expect(screen.getAllByText('조회 필요')).toHaveLength(2);
 expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));
 expect(old.stop).toHaveBeenCalledOnce();expect(notes).toHaveValue('보존초안');expect(screen.getAllByText('미작성')).toHaveLength(2);
 act(()=>old.next({docs:[{id:'stale',data:()=>fixture()}],metadata:{fromCache:false}}));expect(screen.queryByText(/Rev.2 저장됨/)).toBeNull();
});
it('초안 작성 중 같은 슬롯 수신은 덮지 않고 중복 add를 막는다',async()=>{
 m.recordsCache=true;renderForm();open();const notes=screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요');fireEvent.change(notes,{target:{value:'늦은조회초안'}});
 deliver([fixture()]);expect(notes).toHaveValue('늦은조회초안');expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(m.add).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'저장된 기록 열기'}));expect(notes).toHaveValue('');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_sanitation','08:30',expect.any(Object)));expect(m.add).not.toHaveBeenCalled();
});
it('실패 원문 보존과 신규 ACK/read오류 ID 유지 뒤 같은 ID를 수정한다',async()=>{
 const d=pending<string>();m.add.mockReturnValue(d.promise);renderForm();open();const notes=screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요');fireEvent.change(notes,{target:{value:'확정응답원문'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 act(()=>latestSub('haccp_sanitation').error({code:'unavailable'}));await act(async()=>d.resolve('known-id'));
 expect(notes).toHaveValue('확정응답원문');fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));deliver([{...m.add.mock.calls[0][1],id:'known-id'}]);
 m.update.mockRejectedValueOnce({code:'unavailable'});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('저장 결과를 확인하지 못했습니다'));
 expect(notes).toHaveValue('확정응답원문');fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));deliver([{...m.add.mock.calls[0][1],id:'known-id'}]);fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(m.update).toHaveBeenCalledTimes(2));expect(m.update.mock.calls.every(call=>call[1]==='known-id')).toBe(true);expect(m.add).toHaveBeenCalledOnce();
});
it('삭제 승인 뒤 대상 제거는 송신하지 않고 자기 삭제 snapshot 뒤 ACK는 선택을 닫는다',async()=>{
 m.rows=[fixture()];const confirm=pending<boolean>();m.confirm.mockReturnValue(confirm.promise);const view=renderForm();open();fireEvent.click(screen.getByRole('button',{name:/점검 기록 조회/}));fireEvent.click(view.container.querySelector('[role=button]')!);
 deliver([]);await act(async()=>confirm.resolve(true));expect(m.remove).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('현재 목록에서 선택 기록을 확인하지 못했습니다');
 deliver([fixture()]);const deletion=pending<void>();m.remove.mockReturnValue(deletion.promise);m.confirm.mockResolvedValue(true);fireEvent.click(view.container.querySelector('[role=button]')!);await waitFor(()=>expect(m.remove).toHaveBeenCalledOnce());
 deliver([]);await act(async()=>deletion.resolve());expect(screen.queryByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요')).toBeNull();
});
it('실제 UID 교체·ABA는 옛 삭제 승인과 ACK를 새 초안에서 격리한다',async()=>{
 m.rows=[fixture()];const d=pending<boolean>();m.confirm.mockReturnValue(d.promise);const view=renderForm();open();fireEvent.click(screen.getByRole('button',{name:/점검 기록 조회/}));fireEvent.click(view.container.querySelector('[role=button]')!);
 const old=latestSub('haccp_sanitation');act(()=>{m.user={uid:'other'};for(const listener of [...m.listeners])listener(m.user);});
 act(()=>{m.user={uid:'output-test'};for(const listener of [...m.listeners])listener(m.user);});await act(async()=>d.resolve(true));expect(m.remove).not.toHaveBeenCalled();expect(old.stop).toHaveBeenCalledOnce();
 open();expect(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요')).toHaveValue('');
});
it('직원·회사 owner 교체 뒤 옛 저장 ACK는 새 초안을 덮지 않는다',async()=>{
 const d=pending<string>();m.add.mockReturnValue(d.promise);const view=renderForm();open();fireEvent.click(screen.getByRole('button',{name:'저장'}));
 view.rerender(<HaccpCompanyContext.Provider value="punghoe"><SanitationForm currentUser={{id:'new',name:'새담당'}} isAdmin canConfirm/></HaccpCompanyContext.Provider>);open();const notes=screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요');fireEvent.change(notes,{target:{value:'새회사초안'}});
 await act(async()=>d.resolve('old-id'));expect(notes).toHaveValue('새회사초안');m.add.mockResolvedValue('newer');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledTimes(2));expect(m.update).not.toHaveBeenCalled();
});
it('확인 ACK의 현재 권한이 사라져도 같은 owner 잠금은 해제한다',async()=>{
 m.rows=[{...fixture(),rows:[{result:'pass',note:'',inspector:'a'},{result:'pass',note:'',inspector:'a'}]}];const d=pending<void>();m.update.mockReturnValue(d.promise);const view=renderForm();open();fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));
 view.rerender(<SanitationForm currentUser={{id:'test',name:'합성 담당'}} isAdmin={false} canConfirm={false}/>);await act(async()=>d.resolve());
 expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();expect(window.alert).not.toHaveBeenCalled();
});
it('저장 결과 미확인 뒤 자동 snapshot만으로 신규 재송신을 허용하지 않는다',async()=>{
 m.add.mockRejectedValueOnce({code:'unavailable'});renderForm();open();fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('저장 결과를 확인하지 못했습니다'));
 deliver([]);expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(m.add).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));expect(screen.getByRole('button',{name:'저장'})).toBeEnabled();
});

it('신규 ACK 뒤 query 미수신이어도 본인 현재 ID로 수정·확인한다',async()=>{
 renderForm();open();for(const box of screen.getAllByRole('checkbox').filter((_,index)=>index%2===0))fireEvent.click(box);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_sanitation','new-id',expect.objectContaining({confirmedBy:'합성 담당'})));
});

// 기존 전체 body hash 대신 허용 actor/read delta 밖의 이전 도메인·writer·PDF AST를 고정한다.
const remainingFormPreserved=(text:string)=>{
 const file=ts.createSourceFile('form.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),result:Record<string,string>={};
 const stable=new Set(['currentWeekStr','emptyPeriodRecord','emptyClosingRecord','padRows','toggleResult','setRow','resultBadge','currentRecord','isReadOnly','actualCurrentPeriod','pastRecords','period','items','cycleName','outputSignal']);
 const hash=(key:string,node:ts.Node)=>{result[key]=createHash('sha256').update(node.getText(file).replace(/\r\n/g,'\n')).digest('hex');};
 const visit=(node:ts.Node,scope='')=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){const name=node.name.text;if(stable.has(name))hash(name,node.initializer);if(['handleSave','handleConfirm'].includes(name))scope=name;if(['handleSave','handleConfirm'].includes(scope)&&['data','update','userName','now','missingNote'].includes(name))hash(scope+':'+name,node.initializer);}
  if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(attribute=>ts.isJsxAttribute(attribute)&&attribute.name.getText(file)==='ref'&&attribute.initializer?.getText(file)==='{printRef}'))hash('PDF:printRef',node);
  ts.forEachChild(node,child=>visit(child,scope));
 };visit(file);return result;
};
it('PeriodicSanitationForm의 허용 actor/조회 변경 밖 도메인·payload·PDF 원문을 보존한다',()=>{expect(remainingFormPreserved(readFileSync('src/features/haccp/ui/PeriodicSanitationForm.tsx','utf8'))).toEqual({
  "currentWeekStr": "f27bccb2bc9b1568ddbefb3ca424f783b5070d282df0a9eac06e5deb3b720ff7",
  "emptyPeriodRecord": "7810aa8ad0c86ac3640328556e38acf43732b44b510173a69419c56b5c7986cc",
  "outputSignal": "aa560ffc2073bb48e8612a7426c81d8427793716248b361b87d77779e7ecf1e9",
  "period": "736faf9530dcf31bde1957b1f71acb84e292f832f580b6484ed6c3f2e709fedc",
  "items": "fe01af0e4ca913690cf25a3e9de2ef2ab5289dfb1d163d9c1d3d4fec2b61f85a",
  "cycleName": "eb33b684611aede12e5d9aed1e6949f123a56e9eb21987db0298c647fc352191",
  "currentRecord": "53247bb373e718a4efe178a7d2c82b408f720c1eb627da94f7acbde28c7d7d03",
  "actualCurrentPeriod": "1234c899e563735f8a51e02f1d96d695bdd0c5ce2799660c8fc45bf0022c0a7e",
  "isReadOnly": "6b01cf9d09ff285ea0d254ebbb14917b29f4a8bcda23634aba4bb96b829e8f49",
  "padRows": "483ded0885922c118cfa1344228bafe4c20e8f2939a5952fe2800ba9aa1746db",
  "toggleResult": "3cb13bd1bcfaf061a4af84e20a2a9174ac741d286b90e1b764da0ed143e728c3",
  "setRow": "dd6dbb373da76be1bce8765755d0535523e60b2ba8790b748fb25f7fe3079a58",
  "handleSave:missingNote": "b8fbb97f32926f1adb54dc2623b9a56e57efdb180912293c15f3a60dd40e16f6",
  "handleSave:now": "c3b9a00586a0c69c38799a013a999abea28ca2bccd7793a4b699be0ca103b3c4",
  "handleSave:userName": "2b1992e6ddcd85779420d239aa027eceee0f9ac628bd341312f87d7b42043060",
  "handleSave:data": "b5ea67eaaffb1014249e21335cd1bed66983dc154b6c63a25e377f18b7d137c9",
  "handleSave:update": "f61db84e09549c57898b0d4ca0874427c7243970867e679f11a1d08f2cb4e3ae",
  "handleConfirm:now": "c3b9a00586a0c69c38799a013a999abea28ca2bccd7793a4b699be0ca103b3c4",
  "handleConfirm:userName": "0faa609927b8d86194cd0c310b0d8cf5329e005e92fec4062807ecf2cca6eeb9",
  "handleConfirm:update": "4deb4496d1b0f3e670d1083dc93acd788992bb997061212ce9395ca08be03b9e",
  "resultBadge": "670f274a2bbca8ecbaa6dffad6143e09c667dd9740bcc476c2a59f3cfa6a9cf7",
  "pastRecords": "13b8eeedd633abda7748778a6f2ec1325ad010c1345cde914ab8dd3707d074b5",
  "PDF:printRef": "322e56df681e52bd6045cae3c6c709e909580707dd4c1636c055a52ded3a3c80"
});});
it('ClosingChecklistForm의 허용 actor/조회 변경 밖 도메인·payload·PDF 원문을 보존한다',()=>{expect(remainingFormPreserved(readFileSync('src/features/haccp/ui/ClosingChecklistForm.tsx','utf8'))).toEqual({
  "emptyClosingRecord": "3e6298e457bfa6ddaa8d1e13c11af7129a02f63bcaf83ddd6e9907a981c26357",
  "outputSignal": "c67b5d00c90a3bd849775aab89b84b33a454f786cb001df7d700773e5051273d",
  "isReadOnly": "63e4a155b9a2448925e7a11d5f4e159988cbebfe00eaa0adde62d61c3bfe7fec",
  "padRows": "2ad4e19c72cbf1233ce7a358e684d4a50eafa200ff6d9e715d023f87e1b2b56b",
  "toggleResult": "3cb13bd1bcfaf061a4af84e20a2a9174ac741d286b90e1b764da0ed143e728c3",
  "setRow": "dd6dbb373da76be1bce8765755d0535523e60b2ba8790b748fb25f7fe3079a58",
  "handleSave:missingNote": "f8660cbb90025326305e660baf5a2529b88f697a19d3808c09635a29fbc1c0df",
  "handleSave:now": "c3b9a00586a0c69c38799a013a999abea28ca2bccd7793a4b699be0ca103b3c4",
  "handleSave:userName": "2b1992e6ddcd85779420d239aa027eceee0f9ac628bd341312f87d7b42043060",
  "handleSave:data": "b5ea67eaaffb1014249e21335cd1bed66983dc154b6c63a25e377f18b7d137c9",
  "handleSave:update": "f61db84e09549c57898b0d4ca0874427c7243970867e679f11a1d08f2cb4e3ae",
  "handleConfirm:now": "c3b9a00586a0c69c38799a013a999abea28ca2bccd7793a4b699be0ca103b3c4",
  "handleConfirm:userName": "0faa609927b8d86194cd0c310b0d8cf5329e005e92fec4062807ecf2cca6eeb9",
  "handleConfirm:update": "4deb4496d1b0f3e670d1083dc93acd788992bb997061212ce9395ca08be03b9e",
  "resultBadge": "670f274a2bbca8ecbaa6dffad6143e09c667dd9740bcc476c2a59f3cfa6a9cf7",
  "pastRecords": "b9157a091fb0263dadfc9e216d1ff38a140c3ba6da32eced796c1cb7e5aae5d0",
  "currentRecord": "dccc1afd84f3fd7d9f779b0e3008b1fe5f1310e3c670f1113f84dbf64131c05a",
  "PDF:printRef": "4ce0e5df9cea4ba44a6d6b4308a14544576e7d765d7077235f7e7970eeb221ef"
});});
it.each(['ACK전','ACK후'])('자기 ID를 목록에서 관측한 뒤 삭제되면 fallback을 끝낸다: %s',async timing=>{
 const d=pending<string>();m.add.mockReturnValue(d.promise);renderForm();open();fireEvent.click(screen.getByRole('button',{name:'저장'}));const saved={...m.add.mock.calls[0][1],id:'observed-id'};
 if(timing==='ACK전')deliver([saved]);await act(async()=>d.resolve('observed-id'));if(timing==='ACK후')deliver([saved]);deliver([]);
 fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(m.update).not.toHaveBeenCalled();expect(m.add).toHaveBeenCalledOnce();expect(screen.getByRole('alert')).toHaveTextContent('현재 목록에서 선택 기록을 확인하지 못했습니다');
});
it('신규 ACK ID는 조회오류·빈결과 재조회 뒤에도 같은 선택에서만 유지한다',async()=>{
 const d=pending<string>();m.add.mockReturnValue(d.promise);renderForm();open();fireEvent.click(screen.getByRole('button',{name:'저장'}));act(()=>latestSub('haccp_sanitation').error({code:'unavailable'}));await act(async()=>d.resolve('retained-id'));
 fireEvent.click(screen.getByRole('button',{name:'다시 조회'}));fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_sanitation','retained-id',expect.any(Object)));
 fireEvent.click(screen.getByRole('button',{name:/오후 15:00/}));fireEvent.click(screen.getByRole('button',{name:/오전 08:30/}));m.add.mockResolvedValue('fresh-id');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledTimes(2));
});
it('관측 후 소실된 ID는 늦은 정상 ACK로 미관측 예외가 부활하지 않는다',async()=>{
 const d=pending<string>();m.add.mockReturnValue(d.promise);renderForm();open();for(const box of screen.getAllByRole('checkbox').filter((_,index)=>index%2===0))fireEvent.click(box);
 fireEvent.change(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요'),{target:{value:'관측소실초안'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));deliver([{...m.add.mock.calls[0][1],id:'seen-before-ack'}]);deliver([]);await act(async()=>d.resolve('seen-before-ack'));
 fireEvent.click(screen.getByRole('button',{name:'저장'}));fireEvent.click(screen.getByRole('button',{name:'관리자 확인'}));expect(m.update).not.toHaveBeenCalled();expect(m.add).toHaveBeenCalledOnce();expect(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요')).toHaveValue('관측소실초안');expect(screen.getByRole('alert')).toHaveTextContent('현재 목록에서 선택 기록을 확인하지 못했습니다');
});
it('같은 현재 슬롯을 재선택해도 미관측 정상 ACK ID와 초안을 버리지 않는다',async()=>{
 renderForm();open();fireEvent.change(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요'),{target:{value:'현재슬롯초안'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.add).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());open();
 expect(screen.getByPlaceholderText('특이사항 및 개선조치 내용을 입력하세요')).toHaveValue('현재슬롯초안');fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_sanitation','new-id',expect.any(Object)));expect(m.add).toHaveBeenCalledOnce();
});

it.each(['records','template'])('현재cache격하%s는Reactflush전saveconfirm송신을막고server복귀한다',async kind=>{
 m.rows=[fixture()];renderForm();open();const save=screen.getByRole('button',{name:'저장'}),confirm=screen.getByRole('button',{name:'관리자 확인'});const target=latestSub(kind==='records'?'haccp_sanitation':'haccp_templates');const snapshot=(cache:boolean)=>kind==='records'?{docs:m.rows.map(row=>({id:row.id,data:()=>row})),metadata:{fromCache:cache}}:{exists:()=>true,data:()=>({items:[{item:'항목A',standard:'기준A'},{item:'항목B',standard:'기준B'}]}),metadata:{fromCache:cache}};
 act(()=>{target.next(snapshot(true));expect(save).toBeEnabled();fireEvent.click(save);fireEvent.click(confirm);});expect(m.update).not.toHaveBeenCalled();expect(m.add).not.toHaveBeenCalled();expect(save).toBeDisabled();
 act(()=>target.next(snapshot(false)));fireEvent.click(save);await waitFor(()=>expect(m.update).toHaveBeenCalledOnce());
});

it('기록cache는삭제를막고양식cache는기존삭제를막지않는다',async()=>{m.rows=[fixture()];const view=renderForm();open();const row=m.rows[0];fireEvent.click(screen.getByRole('button',{name:/점검 기록 조회/}));const remove=view.container.querySelector('[role=button]')!;const recordSub=latestSub('haccp_sanitation'),tpl=latestSub('haccp_templates');m.confirm.mockResolvedValue(true);act(()=>recordSub.next({docs:[{id:row.id,data:()=>row}],metadata:{fromCache:true}}));fireEvent.click(remove);expect(m.confirm).not.toHaveBeenCalled();expect(m.remove).not.toHaveBeenCalled();act(()=>recordSub.next({docs:[{id:row.id,data:()=>row}],metadata:{fromCache:false,hasPendingWrites:true}}));act(()=>tpl.next({exists:()=>false,metadata:{fromCache:true}}));fireEvent.click(remove);await waitFor(()=>expect(m.remove).toHaveBeenCalledOnce());});
it('송신중cache의정상ACKID는보존하고metadata누락은미준비이며pendingwrite는기존정책이다',async()=>{let resolve!:(id:string)=>void;m.add.mockReturnValue(new Promise<string>(r=>{resolve=r;}));renderForm();open();const recordSub=latestSub('haccp_sanitation'),tpl=latestSub('haccp_templates');fireEvent.click(screen.getByRole('button',{name:'저장'}));act(()=>{recordSub.next({docs:[],metadata:{fromCache:true}});tpl.next({exists:()=>false,metadata:{fromCache:true}});});await act(async()=>resolve('cache-ack'));expect(m.add).toHaveBeenCalledOnce();act(()=>{recordSub.next({docs:[],metadata:{fromCache:false,hasPendingWrites:true}});tpl.next({exists:()=>false,metadata:{fromCache:false,hasPendingWrites:true}});});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(m.update).toHaveBeenCalledWith('haccp_sanitation','cache-ack',expect.any(Object)));act(()=>tpl.next({exists:()=>false}));expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();act(()=>{tpl.next({exists:()=>false,metadata:{fromCache:false}});recordSub.next({docs:[]});});expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(m.add).toHaveBeenCalledOnce();});
