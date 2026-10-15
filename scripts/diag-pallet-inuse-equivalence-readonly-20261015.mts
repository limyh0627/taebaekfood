import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {compileFunction} from 'node:vm';
import ts from 'typescript';
import {OrderStatus} from '../src/shared/types.ts';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {decodeRestValue,timestamp} from './prepare-zero-item-price-dry-20261015.mts';
const dateExecutors=new Map<string,(value:string)=>string>();
export function localDay(now:Date,providedSource?:string,expectedHash='1F99CDD8F50906F7B165D505DD8C2BF53826B62F05E4052890B3E30227A671EB'){
 // 공용 날짜 모듈의 재수출은 실행 형식이 달라, 해시로 확인한 실제 순수 함수만 읽는다.
 const source=providedSource??readFileSync(resolve('src/shared/day.ts'),'utf8');check(createHash('sha256').update(source).digest('hex').toUpperCase()===expectedHash);
 const cached=dateExecutors.get(expectedHash);if(cached)return cached(now.toISOString());
 const file=ts.createSourceFile('day.ts',source,ts.ScriptTarget.Latest,true),nodes=file.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='dateOfLocal');check(nodes.length===1);
 const host=ts.createCompilerHost({}),old=host.getSourceFile.bind(host),virtual='/day-check.ts';host.getSourceFile=(name,target,...rest)=>name===virtual?ts.createSourceFile(name,source,target,true):old(name,target,...rest);
 const program=ts.createProgram([virtual],{target:ts.ScriptTarget.ES2022},host),checkedFile=program.getSourceFile(virtual)!,checker=program.getTypeChecker(),fn=checkedFile.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='dateOfLocal')!;
 const inspect=(node:ts.Node)=>{
  check(!ts.isImportDeclaration(node)&&!(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword));
  if(ts.isNewExpression(node))check(ts.isIdentifier(node.expression)&&node.expression.text==='Date');
  if(ts.isIdentifier(node)){
   check(!['fetch','process','require','eval','Function','globalThis','constructor','__proto__','prototype'].includes(node.text));
   const parent=node.parent,property=ts.isPropertyAccessExpression(parent)&&parent.name===node;
   if(!property){const symbol=checker.getSymbolAtLocation(node),local=symbol?.declarations?.some(item=>item.pos>=fn.pos&&item.end<=fn.end);check(local||['Date','String','Number'].includes(node.text)&&symbol?.declarations?.every(item=>/[/\\]lib\.[^/\\]+\.d\.ts$/.test(item.getSourceFile().fileName)));}
  }ts.forEachChild(node,inspect);
 };inspect(fn);
 const code=nodes[0].getText(file).replace(/^export\s+/,'')+';return dateOfLocal(value);';const execute=compileFunction(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,['value']) as (value:string)=>string;dateExecutors.set(expectedHash,execute);return execute(now.toISOString());
}

const PROJECT='projects/taebaek-3abe4/databases/(default)/documents';
const SOURCE_SHA='BF3CA8999798D680264C9D9DC0525739396703435FD50A44F7764A8FA284899D';
const sourcePath=resolve('components/PalletManager.tsx');
const collections=['pallets','partners','orders','palletTransactions'] as const;
type Row=Record<string,any>;
type Inputs={pallets:Row[];partners:Row[];orders:Row[];palletTransactions:Row[]};
const stages=['source','paths','auth','query','restshape','input','calculation','output'] as const;
const codes=['validation','failed','http','json','pallet','partner','order','transaction','structure'] as const;
class DiagnosticError extends Error{
 constructor(readonly stage:typeof stages[number],readonly code:typeof codes[number],readonly collection?:typeof collections[number]){super('팔레트 진단 단계 실패');}
}
function observed<T>(stage:typeof stages[number],code:typeof codes[number],task:()=>T,collection?:typeof collections[number]):T{
 try{return task();}catch(error){if(error instanceof DiagnosticError)throw error;throw new DiagnosticError(stage,code,collection);}
}
async function observedAsync<T>(stage:typeof stages[number],code:typeof codes[number],task:()=>Promise<T>,collection?:typeof collections[number]):Promise<T>{
 try{return await task();}catch(error){if(error instanceof DiagnosticError)throw error;throw new DiagnosticError(stage,code,collection);}
}
export function diagnosticFailure(error:unknown){
 if(error instanceof DiagnosticError&&stages.includes(error.stage)&&codes.includes(error.code)&&(error.collection===undefined||collections.includes(error.collection)))return {stage:error.stage,code:error.code,...(error.collection?{collection:error.collection}:{})};
 return {stage:'source',code:'failed'};
}
function check(value:unknown):asserts value{if(!value)throw Error('팔레트 읽기 진단 검증 실패');}
export function safeData(value:unknown,finiteNumbers=true):void{
 if(value===null||value===undefined)return;
 if(typeof value==='string'){check(!['__proto__','prototype','constructor'].includes(value));return;}
 if(typeof value==='number'){if(finiteNumbers)check(Number.isFinite(value));return;}
 if(typeof value!=='object')return;
 for(const [key,child]of Object.entries(value)){check(!['__proto__','prototype','constructor'].includes(key));safeData(child,finiteNumbers);}
}
/** 검증한 실제 계산만 실행한다. 응답 자료는 코드 문자열에 넣지 않는다. */
export function extractCalculation(source=readFileSync(sourcePath,'utf8'),expectedHash=SOURCE_SHA){
 localDay(new Date(0));check(createHash('sha256').update(readFileSync(resolve('src/shared/types.ts'))).digest('hex').toUpperCase()==='6511C7EB1081C8FC911600A79201C48A71866DB47652EC8B13B7ED98A8A328E1');
 check(createHash('sha256').update(source).digest('hex').toUpperCase()===expectedHash);
 const virtual='/pallet.tsx',host=ts.createCompilerHost({jsx:ts.JsxEmit.ReactJSX}),old=host.getSourceFile.bind(host);
 host.getSourceFile=(name,target,...rest)=>name===virtual?ts.createSourceFile(name,source,target,true,ts.ScriptKind.TSX):old(name,target,...rest);
 const program=ts.createProgram([virtual],{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},host),file=program.getSourceFile(virtual)!,checker=program.getTypeChecker();
 const names=['palletNameOf','partnerPalletStatsRaw','outstandingByPallet'],nodes:ts.VariableDeclaration[]=[];
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&names.includes(node.name.text))nodes.push(node);ts.forEachChild(node,visit);};visit(file);
 check(nodes.length===3&&names.every(name=>nodes.filter(node=>node.name.getText(file)===name).length===1));
 const expressions=nodes.map(node=>{
  check(node.initializer);const initializer=node.initializer;
  if(node.name.getText(file)==='palletNameOf'){check(ts.isArrowFunction(initializer));return initializer;}
  check(ts.isCallExpression(initializer)&&initializer.expression.getText(file)==='useMemo'&&initializer.arguments.length===2&&ts.isArrowFunction(initializer.arguments[0]));return initializer.arguments[0];
 });
 const allowed=new Set(['orders','partners','palletTransactions','pallets','OrderStatus','Map','Object',...names]);
 const forbidden=new Set(['fetch','process','require','eval','Function','globalThis','window','document','constructor','__proto__','prototype']);
 expressions.forEach(expression=>{
  const inspect=(node:ts.Node)=>{
   check(!ts.isImportDeclaration(node)&&!(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)&&!ts.isFunctionDeclaration(node));
   if(ts.isNewExpression(node))check(ts.isIdentifier(node.expression)&&node.expression.text==='Map');
   if(ts.isIdentifier(node)){
    check(!forbidden.has(node.text));
    const parent=node.parent;
    const property=ts.isPropertyAccessExpression(parent)&&parent.name===node||ts.isPropertyAssignment(parent)&&parent.name===node;
    const declaration=ts.isVariableDeclaration(parent)&&parent.name===node||ts.isParameter(parent)&&parent.name===node||ts.isBindingElement(parent)&&parent.name===node;
    const typePosition=ts.isTypeReferenceNode(parent)||ts.isPropertySignature(parent)||ts.isTypeAliasDeclaration(parent);
    if(!property&&!declaration&&!typePosition){
     const symbol=checker.getSymbolAtLocation(node),local=symbol?.declarations?.some(item=>item.pos>=expression.pos&&item.end<=expression.end);
     if(node.text==='Map'||node.text==='Object')check(symbol?.declarations?.length&&symbol.declarations.every(item=>/[/\\]lib\.[^/\\]+\.d\.ts$/.test(item.getSourceFile().fileName)));
     check(local||allowed.has(node.text));
    }
   }
   ts.forEachChild(node,inspect);
  };inspect(expression);
 });
 const code=expressions.map((expression,index)=>`const ${names[index]} = (${expression.getText(file)})${index?'()':''};`).join('\n')+'\nreturn {stats:partnerPalletStatsRaw,outstanding:[...outstandingByPallet]};';
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const execute=compileFunction(js,['orders','partners','palletTransactions','pallets','OrderStatus']);
 const predicates:ts.ArrowFunction[]=[];const findPredicate=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='filter'&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='orders'){check(node.arguments.length===1&&ts.isArrowFunction(node.arguments[0]));predicates.push(node.arguments[0]);}ts.forEachChild(node,findPredicate);};findPredicate(expressions[1]);check(predicates.length===1);
 const predicateCode=ts.transpileModule(`return (${predicates[0].getText(file)})(order);`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const predicate=compileFunction(predicateCode,['order','OrderStatus']);
 return Object.assign((input:Inputs)=>{safeData(input,false);return execute(input.orders,input.partners,input.palletTransactions,input.pallets,OrderStatus) as {stats:Row[];outstanding:[string,number][]};},{includesOrder:(order:Row)=>Boolean(predicate(order,OrderStatus))});
}
export function parseResponse(body:unknown,collection:typeof collections[number]){
 check(Array.isArray(body)&&body.length>0);const rows:Row[]=[],originals:unknown[]=[],readTimes:string[]=[],ids=new Set<string>();
 for(const [index,row]of body.entries()){
  check(row&&typeof row==='object'&&!Array.isArray(row));check(Object.keys(row).every(key=>['document','readTime','done','skippedResults'].includes(key)));
  check(row.skippedResults===undefined||row.skippedResults===0);check(row.done===undefined||typeof row.done==='boolean');if(row.done===true)check(index===body.length-1);
  if(row.readTime!==undefined){timestamp(row.readTime);readTimes.push(row.readTime);}
  if(row.document===undefined){check(row.readTime!==undefined||row.done===true);continue;}
  const doc=row.document;safeData(doc);check(doc&&typeof doc==='object'&&Object.keys(doc).every(key=>['name','fields','createTime','updateTime'].includes(key)));
  const prefix=PROJECT+'/'+collection+'/';check(typeof doc.name==='string'&&doc.name.startsWith(prefix));const id=doc.name.slice(prefix.length);check(id&&!id.includes('/')&&!ids.has(id));ids.add(id);timestamp(doc.updateTime);if(doc.createTime!==undefined)timestamp(doc.createTime);
  const fields=doc.fields??{};check(fields&&typeof fields==='object'&&!Array.isArray(fields));const data=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,decodeRestValue(value)]));safeData(data,false);check(!Object.hasOwn(data,'id')||data.id===id);check(data.companyId===undefined||typeof data.companyId==='string'&&['taebaek','punghoe'].includes(data.companyId));
  rows.push({...data,id});if(collection==='pallets')originals.push(doc);
 }
 check(readTimes.length>0);return {rows,originals,readTimes:[...new Set(readTimes)]};
}
const projections={pallets:undefined,partners:['companyId','name'],orders:['companyId','status','partnerId','partnerName','pallets','deliveredAt','deliveryDate','createdAt'],palletTransactions:['companyId','partnerId','palletId','type','quantity','isTransfer','date']};
export async function readAll(token:string,transport:typeof fetch=fetch){
 const result={} as Record<typeof collections[number],ReturnType<typeof parseResponse>>;
 for(const collection of collections){
  const fields=projections[collection];const response=await observedAsync('query','failed',()=>transport(`https://firestore.googleapis.com/v1/${PROJECT}:runQuery`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:collection,allDescendants:false}],...(fields?{select:{fields:fields.map(fieldPath=>({fieldPath}))}}:{})}})}),collection);
  observed('query','http',()=>check(response.ok),collection);const body=await observedAsync('restshape','json',()=>response.json(),collection);result[collection]=observed('restshape','validation',()=>parseResponse(body,collection),collection);
 }
 return result;
}
export function orderConsumption(orders:Row[],includesOrder:(order:Row)=>boolean){
 const counts={noPallets:0,missingStatus:0,wrongTypeStatus:0,otherStatus:0,malformedPalletContainer:0,consumed:0};
 for(const order of orders){check(order&&typeof order==='object'&&!Array.isArray(order));const value=order.pallets;
  if(value===undefined||value===null||Array.isArray(value)&&value.length===0){counts.noPallets++;continue;}
  if(!Array.isArray(value))counts.malformedPalletContainer++;
  if(includesOrder(order)){counts.consumed++;continue;}
  if(order.status===undefined)counts.missingStatus++;else if(typeof order.status!=='string')counts.wrongTypeStatus++;else if(order.status!==OrderStatus.SHIPPED&&order.status!==OrderStatus.DELIVERED)counts.otherStatus++;
 }return counts;
}
function validateInputs(input:Inputs,includesOrder:(order:Row)=>boolean){
 observed('input','structure',()=>safeData(input,false));
 observed('input','pallet',()=>{for(const p of input.pallets){check(typeof p.name==='string');if(p.inUse!==undefined)check(typeof p.inUse==='number'&&Number.isFinite(p.inUse));}});
 observed('input','partner',()=>{for(const p of input.partners)check(typeof p.name==='string');});
 observed('input','order',()=>{orderConsumption(input.orders,includesOrder);for(const o of input.orders){if(!includesOrder(o))continue;check(Array.isArray(o.pallets));check(typeof(o.partnerId||'unknown')==='string');for(const p of o.pallets){check(p&&typeof p==='object'&&!Array.isArray(p));if(p.isExchange)continue;check(typeof(p.type||'')==='string');if(typeof p.quantity==='number')check(Number.isFinite(p.quantity));const quantity=p.quantity||0;check(typeof quantity==='number'&&Number.isFinite(quantity));}}});
 observed('input','transaction',()=>{for(const t of input.palletTransactions){check(typeof t.partnerId==='string'&&typeof t.palletId==='string'&&['in','out'].includes(t.type)&&typeof t.quantity==='number'&&Number.isFinite(t.quantity)&&typeof t.date==='string');check(t.isTransfer===undefined||typeof t.isTransfer==='boolean');}});
}
export function classify(input:Inputs,calculate=extractCalculation(),now=new Date()){
 const includesOrder=calculate.includesOrder??extractCalculation().includesOrder;validateInputs(input,includesOrder);const companies:Record<string,unknown>={};
 for(const company of ['taebaek','punghoe']){
  const scope=Object.fromEntries(collections.map(name=>[name,input[name].filter(row=>(row.companyId??'taebaek')===company)])) as Inputs;
  const without={...scope,pallets:scope.pallets.map(({inUse:_removed,...rest})=>rest)};
  const from=new Date(now);from.setMonth(from.getMonth()-24);const live=new Date(now);live.setDate(live.getDate()-7);
  const fresh={...scope,palletTransactions:scope.palletTransactions.filter(t=>t.date>=from.toISOString().slice(0,10)&&t.date<=localDay(now)||String(t.date)>=live.toISOString().slice(0,10))};
  const before=calculate(scope),after=calculate(without),freshBefore=calculate(fresh),freshAfter=calculate({...fresh,pallets:without.pallets});
  [before,after,freshBefore,freshAfter].forEach(value=>safeData(value));
  check(JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(freshBefore)===JSON.stringify(freshAfter));
  const outstanding=new Map(before.outstanding),freshOutstanding=new Map(freshBefore.outstanding);
  const present=scope.pallets.filter(p=>Object.hasOwn(p,'inUse')).length,fullDifferent=scope.pallets.filter(p=>typeof p.inUse==='number'&&p.inUse!==(outstanding.get(p.name)??0)).length,windowDifferent=scope.pallets.filter(p=>typeof p.inUse==='number'&&p.inUse!==(freshOutstanding.get(p.name)??0)).length;
  const counts=new Map<string,number>();scope.pallets.forEach(p=>counts.set(p.name,(counts.get(p.name)??0)+1));
  companies[company]={orderInputCategories:orderConsumption(scope.orders,includesOrder),palletDocuments:scope.pallets.length,inUsePresent:present,inUseTypes:{number:present,missing:scope.pallets.length-present},fullHistoryEquivalent:true,transactionWindowEquivalent:true,indeterminate:false,storedValueDifferentFromFull:fullDifferent,storedValueMatchesFull:present-fullDifferent,storedValueDifferentFromWindow:windowDifferent,storedValueMatchesWindow:present-windowDifferent,duplicatePalletNameGroups:[...counts.values()].filter(n=>n>1).length,unknownOrderPalletReferences:scope.orders.filter(includesOrder).flatMap(o=>o.pallets).filter(p=>!p.isExchange&&!scope.pallets.some(item=>item.id===p.type||item.name===p.type)).length,unknownTransactionPalletReferences:scope.palletTransactions.filter(t=>!scope.pallets.some(item=>item.id===t.palletId)).length};
 }
 return {readOnly:true,deletionReady:false,sourceSha:SOURCE_SHA,atomicSnapshot:false,scope:'주결과는 조회한 전체 이력이다. 보조결과는 같은 전체 주문 입력에 거래의 화면 24개월+라이브7일 조건만 적용한다. 개인 브라우저 캐시·ordersMonths 설정의 현재 화면 재현이 아니다. writer의 객체 보존 경로는 남아 있다.',inputRanges:{orders:'양사 전체 조회, 화면 ordersMonths 기간은 재현하지 않음',transactionsFull:'전체 조회',transactionsWindow:{from: new Date(new Date(now).setMonth(now.getMonth()-24)).toISOString().slice(0,10),to:localDay(now),liveDays:7}},companies};
}
export function paths(args:string[]){
 check(resolve('.')===resolve(fileURLToPath(new URL('../',import.meta.url))));check(args.length===1&&args[0]==='--auth=firebase-cli');const output=resolve('../pallet-inuse-equivalence-readonly-20261015.json'),originals=resolve('work/pallet-inuse-originals-20261015.json');check(!existsSync(output)&&!existsSync(originals));return {output,originals};
}
export async function run(args:string[],dependencies={calculate:extractCalculation,paths,token:cliToken,read:readAll}){
 const calculate=observed('source','validation',()=>dependencies.calculate()),outputs=observed('paths','validation',()=>dependencies.paths(args)),token=await observedAsync('auth','failed',()=>dependencies.token()),data=await observedAsync('query','failed',()=>dependencies.read(token));
 const input=Object.fromEntries(collections.map(name=>[name,data[name].rows])) as Inputs;const result={...observed('calculation','failed',()=>classify(input,calculate)),readTimes:Object.fromEntries(collections.map(name=>[name,data[name].readTimes]))};
 const backup=JSON.stringify({readOnly:true,collection:'pallets',documents:data.pallets.originals,readTimes:data.pallets.readTimes},null,2),text=JSON.stringify(result,null,2);
 observed('output','failed',()=>{let written=false;try{writeFileSync(outputs.originals,backup,{flag:'wx'});written=true;writeFileSync(outputs.output,text,{flag:'wx'});}catch(error){if(written&&readFileSync(outputs.originals,'utf8')===backup)unlinkSync(outputs.originals);throw error;}});
 return {readOnly:true,deletionReady:false};
}
export function selfCheck(){assert.throws(()=>safeData(JSON.parse('{"__proto__":1}')));extractCalculation();return {selfCheck:'passed',productionRead:false,productionOutputWritten:false};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(process.argv.slice(2).join(' ')==='--self-check'?selfCheck():await run(process.argv.slice(2))));}catch(error){console.error(JSON.stringify({failed:true,...diagnosticFailure(error)}));process.exitCode=1;}}
