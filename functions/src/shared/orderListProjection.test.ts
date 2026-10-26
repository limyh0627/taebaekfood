import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import {ORDER_LIST_CANONICAL_UTC_PATTERN,isCanonicalOrderListUtc,deriveOrderListProjection,orderListCandidateFloor,isOrderListServerCandidate} from '../../../src/shared/orderListProjection';
const stamp='2026-10-15T00:00:00.000Z';
const complete=(overrides:Record<string,unknown>={})=>({status:'DELIVERED',deliveredAt:stamp,deliveryDate:stamp,createdAt:stamp,...overrides});
it('명세의 정규식은 실제 UTC subset과 같고 이중 이스케이프가 없다',()=>{
 expect(new RegExp(ORDER_LIST_CANONICAL_UTC_PATTERN).source).toBe(ORDER_LIST_CANONICAL_UTC_PATTERN);
 expect(deriveOrderListProjection(Object.freeze({}))).toEqual({version:1,candidateDay:'9999-12-31'});expect(isCanonicalOrderListUtc(stamp)).toBe(true);expect(isCanonicalOrderListUtc('1000-01-01T00:00:00.000Z')).toBe(true);expect(isCanonicalOrderListUtc('9999-12-28T23:59:59.999Z')).toBe(true);
});
it.each([undefined,null,'','PENDING','PROCESSING','ON_HOLD','DISPATCHED','unknown',0])('완료 아닌 상태 %s는 원 날짜가 없어도 후보에서 빠지지 않는다',status=>{
 const order=Object.freeze({status}),projection=deriveOrderListProjection(order);
 expect(projection).toEqual({version:1,candidateDay:'9999-12-31'});expect(isOrderListServerCandidate(order,projection,orderListCandidateFloor('2026-10-15'))).toBe(true);
});
it('세 날짜 모두 canonical일 때 다른 두 날짜 순서와 관계없이 deliveredAt UTC일만 쓴다',()=>{
 expect(deriveOrderListProjection(complete({createdAt:'9999-12-28T23:59:59.999Z',deliveryDate:'1000-01-01T00:00:00.000Z'}))).toEqual({version:1,candidateDay:'2026-10-15'});
});
it.each(['2026-01-29T00:00:00.000Z','2026-04-30T00:00:00.000Z','2026-12-31T00:00:00.000Z','2024-02-29T00:00:00.000Z','2026-02-30T00:00:00.000Z','2026-13-01T00:00:00.000Z','2026-01-01T24:00:00.000Z','2026-01-01T23:59:60.000Z','2026-01-01T00:00:00+09:00','2026-01-01T00:00:00Z','2026-01-01T00:00:00.0000Z','2026-01-01',' 2026-01-01T00:00:00.000Z','0999-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z\n',{},null,1])('비정형/말일 %s가 세 날짜 어느 곳에 있어도 sentinel로 남는다',value=>{
 expect(isCanonicalOrderListUtc(value)).toBe(false);
 for(const field of ['deliveredAt','deliveryDate','createdAt'])expect(deriveOrderListProjection(complete({[field]:value})).candidateDay).toBe('9999-12-31');
});
it('날짜 누락 fallback과 불변 원문을 유지한다',()=>{
 const order=Object.freeze({status:'DELIVERED',deliveryDate:'2026-10-15',receipt:Object.freeze({requestId:'original'})});const before=JSON.stringify(order);
 expect(deriveOrderListProjection(order)).toEqual({version:1,candidateDay:'9999-12-31'});expect(JSON.stringify(order)).toBe(before);expect(Object.keys(order)).toEqual(['status','deliveryDate','receipt']);
});
it.each([['2026-03-01','2026-02-27'],['2024-03-01','2024-02-28'],['2024-03-02','2024-02-29'],['2026-01-01','2025-12-30'],['2026-12-31','2026-12-29'],['1000-01-03','1000-01-01'],['9999-12-31','9999-12-29']])('실달력 cutoff %s의 후보 하한은 %s다',(input,expected)=>expect(orderListCandidateFloor(input)).toBe(expected));
it.each(['','2026-02-29','2026-02-30','2026-13-01','2026-00-01','2026-01-00','2026-1-01','2026-01-01T00:00:00.000Z','0999-12-31','1000-01-01','1000-01-02','10000-01-01'])('무효/지원범위밖 cutoff %s는 throw한다',value=>expect(()=>orderListCandidateFloor(value)).toThrow());
it('candidate는 projection 형태를 검증하고 상한 없이 미래와 sentinel을 포함한다',()=>{
 const order=complete();expect(isOrderListServerCandidate(order,{version:1,candidateDay:'2026-10-12'},'2026-10-13')).toBe(false);
 expect(isOrderListServerCandidate(order,{version:1,candidateDay:'9999-12-31'},'9999-12-31')).toBe(true);
 for(const projection of [{version:2,candidateDay:'9999-12-31'},{version:1,candidateDay:'2026-02-30'},{version:1,candidateDay:'bad'},null])expect(isOrderListServerCandidate(order,projection as any,'2026-10-13')).toBe(false);
 expect(()=>isOrderListServerCandidate(order,deriveOrderListProjection(order),'invalid')).toThrow();
});
const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function actualCode(){
 const day=ts.createSourceFile('day.ts',readFileSync('src/shared/day.ts','utf8'),ts.ScriptTarget.Latest,true);const fn=day.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='dateOfLocal');if(!fn)throw Error('실 dateOfLocal 없음');
 const hook=ts.createSourceFile('hook.ts',readFileSync('src/shared/hooks/useAppData.ts','utf8'),ts.ScriptTarget.Latest,true);const matches:ts.ArrowFunction[]=[];function visit(node:ts.Node){if(ts.isArrowFunction(node)&&node.getText(hook).startsWith('order => order.status !== OrderStatus.DELIVERED'))matches.push(node);ts.forEachChild(node,visit);}visit(hook);if(matches.length!==1)throw Error('실 predicate 유일성');
 return {projection:compile(readFileSync('functions/src/shared/orderListProjection.ts','utf8')),day:compile(fn.getText(day)),predicate:compile('const predicate='+matches[0].getText(hook))};
}
it.each([['UTC',0,0],['Asia/Seoul',-540,-540],['Pacific/Kiritimati',-840,-840],['Etc/GMT+12',720,720],['America/Los_Angeles',480,420]] as const)('실제 자식 Date TZ=%s에서 원 predicate 참이면 query 후보에 포함된다',(zone,winter,summer)=>{
 const code=actualCode();const program=`const code=${JSON.stringify(code)};const p={};new Function('exports',code.projection)(p);const d={};new Function('exports',code.day)(d);const offsets=[new Date('2026-01-15T12:00:00.000Z').getTimezoneOffset(),new Date('2026-07-15T12:00:00.000Z').getTimezoneOffset()];let checked=0,included=0,filtered=0;const dates=['2025-12-28','2026-01-01','2026-03-08','2026-03-09','2026-10-15','2026-11-01','2026-11-02','2026-12-28'];const cutoffs=['2025-12-31','2026-01-01','2026-03-08','2026-03-09','2026-10-15','2026-11-01','2026-11-02','2026-12-31'];`;
 // 원래 arrow의 lexical cutoff를 각 사례에 주입하고 실제 Date getter가 바뀌었는지도 함께 확인한다.
 const worker=program+`for(const date of dates)for(const clock of ['00:00:00.000','00:01:00.000','11:59:59.999','14:59:59.999','15:00:00.000','23:59:59.999'])for(const status of [undefined,null,'unknown','PENDING','DELIVERED'])for(const cutoff of cutoffs){const original=new Function('dateOfLocal','OrderStatus','cutoff',code.predicate+';return predicate;')(d.dateOfLocal,{DELIVERED:'DELIVERED'},cutoff);for(const deliveredAt of [date+'T'+clock+'Z',undefined,'',date,date+'T'+clock+'+09:00']){const order={status,deliveredAt,deliveryDate:'2026-01-01T00:00:00.000Z',createdAt:'2026-01-01T00:00:00.000Z'};const expected=original(order);const candidate=p.isOrderListServerCandidate(order,p.deriveOrderListProjection(order),p.orderListCandidateFloor(cutoff));if(expected&&!candidate)throw Error('누락 '+JSON.stringify({date,clock,status,cutoff,deliveredAt}));if(expected)included++;else filtered++;if((candidate&&original(order))!==expected)throw Error('후필터 불일치');checked++;}}console.log(JSON.stringify({offsets,checked,included,filtered}));`;
 const run=spawnSync(process.execPath,['-e',worker],{env:{...process.env,TZ:zone},encoding:'utf8'});expect(run.status,run.stderr).toBe(0);const result=JSON.parse(run.stdout);expect(result.offsets).toEqual([winter,summer]);expect(result.checked).toBe(9600);expect(result.included).toBeGreaterThan(0);expect(result.filtered).toBeGreaterThan(0);
});
