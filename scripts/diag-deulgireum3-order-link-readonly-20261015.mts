import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import ts from 'typescript';
import {require as loadTs} from 'tsx/cjs/api';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {decodeRestValue,timestamp} from './prepare-zero-item-price-dry-20261015.mts';
export const ROOT='projects/taebaek-3abe4/databases/(default)/documents';
export const BACKUP_SHA='E4E85D16156F9349570B25668AB7456DBB61FD062D5D367A95D1B00689F99B61';
export const DAY='2026-09-28';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex').toUpperCase();
function check(v:unknown):asserts v{if(!v)throw Error('검증 실패');}
function obj(v:unknown):asserts v is Record<string,any>{check(v!==null&&typeof v==='object'&&!Array.isArray(v));}
function preserve(v:unknown){check(isDeepStrictEqual(v,JSON.parse(JSON.stringify(v))));}
export function checkDocumentId(id:unknown):asserts id is string{check(typeof id==='string'&&id.length>0&&id!=='.'&&id!=='..'&&!id.includes('/')&&!/^__.*__$/.test(id)&&Buffer.byteLength(id,'utf8')<=1500);}
function safe(v:unknown):void{if(v&&typeof v==='object')for(const[k,c]of Object.entries(v)){check(!['__proto__','constructor','prototype'].includes(k));safe(c);}}
export const SOURCE_MANIFEST:Readonly<Record<string,string>>=Object.freeze({
  "functions/src/shared/calculation.ts": "70DAEF46F158D42658B9906BD6BD6F959C0B86DE6D02960544A415E6719C9794",
  "functions/src/shared/formula.ts": "8DB011CD4A22E2EF4A1F4D0F5CA4882D419588048DCD5D926703E026ECC9090A",
  "functions/src/shared/rawInventoryCore.ts": "424FB40B47BF7C03E9BFB1375B0B14D01F56519D29FCEA15629B6EF34CF65CBD",
  "functions/src/shared/rawInventoryDocument.ts": "90C7853D143340BE5B4C7843A77FA2335E82DC3F32560C237BAA5DB2D83631CF",
  "functions/src/shared/rawLot.ts": "3C635419351BA2DB33D3B2A4C2F9053C1F4F5D891A40A923953182B520B09DF0",
  "functions/src/shared/stockUnitMeasure.ts": "C85A01020E673B740242CC14B758E6747D92B499A8E33E6DEBF4222A4067E651",
  "scripts/diag-zero-item-price-20261015.mts": "CD4DF28228563932DAADEAF973EEB648F1F716FE112E91C47C4A0B7CE2A37AB2",
  "scripts/prepare-zero-item-price-dry-20261015.mts": "DA4245008D1CDF72F75218ED13B864EE113CD369E23C79180598DF62AC764A86",
  "scripts/shared/zeroItemPriceBackup.ts": "0F1F9A8EC366444E7F6D3D8D83CBCB1F30024C698BF2851FD6A55ED28BF8F4DE",
  "scripts/shared/zeroItemPriceMigration.ts": "86507F891DDABAA5126B2AC3F7EBEE9AB1360E90FEF14181E71C1CFC0FAEDCAA",
  "src/constants/formula.ts": "1FF98A5B1403AD775092E94F9E79E8B19C49C6DD1ED4443723D98020D07A23AE",
  "src/features/admin/orderRawInventory.ts": "FC3183D4015625ACDF453C033FD43E112B33DA524CC9133D1CE173B71E98D947",
  "src/shared/bomIndex.ts": "18F22E1199679E2F1289E84CB603FC302F8F7EC09223EE65DBCD301FCC2A3091",
  "src/shared/day.ts": "1F99CDD8F50906F7B165D505DD8C2BF53826B62F05E4052890B3E30227A671EB",
  "src/shared/docOil.ts": "1B60507B40EDBF51AB006FBE80F15DFE9F5F10A183D15CF25160F143413BEDED",
  "src/shared/orderUnits.ts": "FCCC4398377B66D82802765A610F3CE863171E5A35F0940DE8C41CEE7EF1D148",
  "src/shared/packIndex.ts": "CB308CD8985631DD7AE39E3DB62F5BB1D29928D6F997C0A85A70C762ED5A03AD",
  "src/shared/types.ts": "FDE692A9ED4192B21220913D2CE2AFEE4865E8678B634190347280A3A2488FF5"
});
export function verifySources(read:(p:string)=>Buffer=p=>readFileSync(p)){check(Object.keys(SOURCE_MANIFEST).length>5);for(const[p,h]of Object.entries(SOURCE_MANIFEST))check(sha(read(resolve(p)))===h);return SOURCE_MANIFEST;}
export function extractTraceHelper(source:string,operationDocId:(s:string)=>string){
 const ast=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true);
 const nodes=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='rawLedgerDocIds');check(nodes.length===1);const node=nodes[0];check(ts.isFunctionDeclaration(node)&&node.body);
 check(node.parameters.length===1&&node.parameters[0].getText(ast)==='traces: readonly OrderRawInventoryTrace[]'&&node.type?.getText(ast)==='string[]'&&!node.asteriskToken&&!node.typeParameters&&node.modifiers?.length===1&&node.modifiers[0].kind===ts.SyntaxKind.ExportKeyword);
 const expected='return [...new Set(traces.flatMap(trace => trace.ledgerId ? [trace.ledgerId] : trace.operationId ? [operationDocId(trace.operationId)] : [], ))];';
 check(node.body.statements.length===1&&ts.isReturnStatement(node.body.statements[0]));
 check(node.body.statements[0].getText(ast).replace(/\s/g,'')===expected.replace(/\s/g,''));
 const js=ts.transpileModule(node.getText(ast).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 return Function('operationDocId',js+';return rawLedgerDocIds;')(operationDocId) as (traces:any[])=>string[];
}
export function helpers(){
 verifySources();
 const core=loadTs('../functions/src/shared/rawInventoryCore.ts',import.meta.url) as typeof import('../functions/src/shared/rawInventoryCore.ts');
 const document=loadTs('../functions/src/shared/rawInventoryDocument.ts',import.meta.url) as typeof import('../functions/src/shared/rawInventoryDocument.ts');
 const types=loadTs('../src/shared/types.ts',import.meta.url) as typeof import('../src/shared/types.ts');
 const oil=loadTs('../src/shared/docOil.ts',import.meta.url) as typeof import('../src/shared/docOil.ts');
 // 서비스 import가 인증을 초기화하지 않도록 순수 함수 한 개의 AST만 재사용한다.
 const rawLedgerDocIds=extractTraceHelper(readFileSync('src/features/admin/orderRawInventory.ts','utf8'),core.operationDocId);
 return {...core,...document,companyOf:types.companyOf,docDateOf:oil.docDateOf,rawLedgerDocIds};
}
export function parseDocument(original:unknown,collection:string,id?:string){obj(original);safe(original);preserve(original);check(Object.keys(original).every(k=>['name','fields','createTime','updateTime'].includes(k)));const prefix=ROOT+'/'+collection+'/';check(typeof original.name==='string'&&original.name.startsWith(prefix));const found=original.name.slice(prefix.length);checkDocumentId(found);check(found&&!found.includes('/')&&(!id||found===id));timestamp(original.updateTime);if(original.createTime!==undefined)timestamp(original.createTime);const fields=original.fields??{};obj(fields);const data:Record<string,any>=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decodeRestValue(v)]));safe(data);check(!Object.hasOwn(data,'id')||data.id===found);return {id:found,data,original};}
export function loadBackup(bytes:Buffer=readFileSync('work/deulgireum3-readonly-plan-20261015.json'),expected=BACKUP_SHA){check(sha(bytes)===expected);const backup=JSON.parse(bytes.toString('utf8'));obj(backup.originals);check(Array.isArray(backup.originals.items));const ids=backup.originals.items.map((d:any)=>parseDocument(d,'items')).filter((r:any)=>r.data.companyId==='taebaek'&&r.data.품목==='시골향들기름3').map((r:any)=>r.id);check(ids.length===32&&new Set(ids).size===32);return {ids,backupSha:expected};}
export function parseQuery(body:unknown){check(Array.isArray(body)&&body.length>0);const rows:ReturnType<typeof parseDocument>[]=[],readTimes:string[]=[];for(const[rindex,r]of body.entries()){obj(r);check(Object.keys(r).every(k=>['document','readTime','done','skippedResults'].includes(k)));check(r.skippedResults===undefined||r.skippedResults===0);check(r.done===undefined||typeof r.done==='boolean');if(r.done===true)check(rindex===body.length-1);if(r.readTime!==undefined){timestamp(r.readTime);readTimes.push(r.readTime);}if(r.document)rows.push(parseDocument(r.document,'orders'));else check(r.readTime!==undefined||r.done===true);}check(rows.length<=500&&readTimes.length>0&&new Set(rows.map(r=>r.id)).size===rows.length);return {rows,readTimes};}
export function selectOrder(rows:ReturnType<typeof parseDocument>[],ids:string[],h=helpers()){
 const candidates=rows.filter(r=>h.companyOf(r.data)==='taebaek'&&['SHIPPED','DELIVERED'].includes(r.data.status)&&h.docDateOf(r.data)===DAY&&Array.isArray(r.data.items)&&r.data.items.some((i:any)=>typeof i.itemId==='string'&&ids.includes(i.itemId)));
 const traced=candidates.filter(r=>Array.isArray(r.data.rawConsumedLots)&&r.data.rawConsumedLots.length>0).sort((a,b)=>a.id.localeCompare(b.id,'en'));
 return {candidateCount:candidates.length,selected:traced[0]??null};
}
export function tracePaths(traces:any[],h=helpers()){
 check(traces.length>0&&traces.length<=100);const paths=new Set<string>();
 for(const id of h.rawLedgerDocIds(traces)){checkDocumentId(id);paths.add('rawMaterialLedger/'+id);}
 for(const t of traces){check(typeof t.operationId==='string'&&t.operationId&&typeof t.rawItemId==='string'&&t.rawItemId&&Number.isFinite(t.kg)&&t.kg>=0);paths.add('rawMaterialLedger/'+h.operationDocId(t.operationId));paths.add('rawMaterialLedger/'+h.legacyOperationDocId(t.operationId));paths.add('rawInventoryReversalGuards/'+h.operationDocId(t.operationId));}
 return [...paths].sort();
}
export function inspectLinks(order:ReturnType<typeof parseDocument>,gets:GetResult[],h=helpers()){
 const traces=order.data.rawConsumedLots as any[],groups=new Map<string,any[]>();for(const t of traces)groups.set(t.operationId,[...(groups.get(t.operationId)??[]),t]);
 return [...groups].map(([op,ts])=>{const ids=new Set([h.operationDocId(op),h.legacyOperationDocId(op),...ts.map(t=>t.ledgerId).filter(Boolean)]);const found=gets.filter(g=>g.collection==='rawMaterialLedger'&&ids.has(g.id)&&g.document!==null);const guard=gets.some(g=>g.collection==='rawInventoryReversalGuards'&&g.id===h.operationDocId(op)&&g.document!==null);if(found.length!==1)return {operationId:op,status:'unconfirmed',reason:found.length?'multiple-receipts':'missing-receipt',guardObserved:guard};const row=parseDocument(found[0].document,'rawMaterialLedger',found[0].id),raw=row.data,m=h.normalizeRawMovement(raw);const sameRaw=ts.every(t=>t.rawItemId===raw.rawItemId);const identity=h.companyOf(raw)==='taebaek'&&raw.operationId===op&&sameRaw&&raw.source?.id===order.id&&((raw.source?.type==='production'&&raw.kind==='consume'&&ts.every(t=>!t.ledgerOnly))||(raw.source?.type==='oem'&&raw.kind==='ledger-consume'&&ts.every(t=>t.ledgerOnly===true)))&&raw.id===row.id;
 const quantityPresent=Number.isFinite(raw.reportedDeltaKg)&&Number.isFinite(raw.appliedDeltaKg)&&raw.reportedDeltaKg<=0&&raw.appliedDeltaKg<=0;
 const traceKg=Math.round(ts.reduce((n,t)=>n+t.kg,0)*1000)/1000;
 const reference=raw.kind==='ledger-consume'?Math.abs(raw.reportedDeltaKg):Math.abs(raw.appliedDeltaKg);
 const quantityLinked=quantityPresent&&Math.abs(traceKg-reference)<0.0005;
 return {operationId:op,status:identity&&quantityLinked&&!guard?'linked':'unconfirmed',identityLinked:identity,storedTraceQuantityLinked:quantityLinked,guardObserved:guard,normalized:m,commandFingerprintVerified:false};});
}
type GetResult={collection:string;id:string;document:Record<string,any>|null;observedAt:string;serverReadTime:null;notFound?:unknown};
export async function readCurrent(token:string,ids:string[],transport:typeof fetch=fetch){const h=helpers(),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const response=await transport('https://firestore.googleapis.com/v1/'+ROOT+':runQuery',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify({structuredQuery:{from:[{collectionId:'orders',allDescendants:false}],where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'deliveredAt'},op:'GREATER_THAN_OR_EQUAL',value:{stringValue:DAY}}},{fieldFilter:{field:{fieldPath:'deliveredAt'},op:'LESS_THAN',value:{stringValue:'2026-09-29'}}}]}},limit:501}})});check(response.ok);const queryOriginal=await response.json(),query=parseQuery(queryOriginal),selection=selectOrder(query.rows,ids,h),observedAt=new Date().toISOString();
 const get=async(path:string):Promise<GetResult>=>{const[collection,id]=path.split('/');checkDocumentId(id);check(!path.split('/')[2]);check(['orders','rawMaterialLedger','rawInventoryReversalGuards'].includes(collection));const r=await transport('https://firestore.googleapis.com/v1/'+ROOT+'/'+collection+'/'+encodeURIComponent(id),{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(60000)});const body=await r.json(),observedAt=new Date().toISOString();if(r.status===404){obj(body);check(body.error?.code===404&&body.error?.status==='NOT_FOUND');preserve(body);return {collection,id,document:null,notFound:body,observedAt,serverReadTime:null};}check(r.ok);parseDocument(body,collection,id);return {collection,id,document:body,observedAt,serverReadTime:null};};
 const gets:GetResult[]=[];let finalOrder:GetResult|null=null,orderUnchanged=false,links:Record<string,any>[]=[];
 if(selection.selected){const traces=selection.selected.data.rawConsumedLots as any[];check(traces.length<=100);for(const trace of traces){obj(trace);if(trace.ledgerId!==undefined)checkDocumentId(trace.ledgerId);}const missing=traces.some(t=>!t.operationId||!t.rawItemId);
  if(missing)links=[{status:'unconfirmed',reason:'trace-link-fields-missing',guardObserved:false,commandFingerprintVerified:false}];else{for(const path of tracePaths(traces,h))gets.push(await get(path));links=inspectLinks(selection.selected,gets,h);}finalOrder=await get('orders/'+selection.selected.id);orderUnchanged=finalOrder.document!==null&&isDeepStrictEqual(selection.selected.original,finalOrder.document);}
 return {queryOriginal,queryReadTimes:query.readTimes,observedAt,candidateCount:selection.candidateCount,selectedOrder:selection.selected?.original??null,gets,finalOrder,orderUnchanged,links:orderUnchanged?links:links.map(l=>({...l,status:'unconfirmed',reason:'order-changed-or-missing'}))};
}
export function outputPath(input:string,workspace=resolve('.')){const work=resolve(workspace,'work'),path=resolve(input);check(dirname(path)===work&&/^deulgireum3-order-link-readonly-20261015(?:-v[2-9]\d*)?\.json$/.test(basename(path)));check(!existsSync(path));for(const dir of[workspace,work])check(!lstatSync(dir).isSymbolicLink()&&realpathSync(dir).toLowerCase()===resolve(dir).toLowerCase());try{lstatSync(path);throw Error();}catch(e){check((e as NodeJS.ErrnoException).code==='ENOENT');}return path;}
export function options(args:string[]){check(resolve('.')===resolve(fileURLToPath(new URL('../',import.meta.url))));check(args.length===2&&args[0]==='--auth=firebase-cli'&&args[1].startsWith('--output=')&&!process.env.FIRESTORE_EMULATOR_HOST);return outputPath(args[1].slice(9));}
export function selfCheck(){const h=helpers();check(h.operationDocId('self-check')&&h.rawLedgerDocIds([{operationId:'self-check'}]).length===1);return {selfCheck:'passed',productionRead:false,productionOutputWritten:false};}
export async function run(args:string[],deps={source:selfCheck,options,backup:loadBackup,token:cliToken,read:readCurrent,write:(p:string,t:string)=>writeFileSync(p,t,{flag:'wx'})}){deps.source();const path=deps.options(args),backup=deps.backup(),token=await deps.token(),observations=await deps.read(token,backup.ids);const summary={queried:parseQuery(observations.queryOriginal).rows.length,candidates:observations.candidateCount,selected:observations.selectedOrder?1:0,linked:observations.links.filter(l=>l.status==='linked').length,unconfirmed:observations.links.filter(l=>l.status!=='linked').length};const payload={readOnly:true,currentOnly:true,atomicSnapshot:false,commandFingerprintVerified:false,sourceManifest:SOURCE_MANIFEST,ownSourceSha:sha(readFileSync(fileURLToPath(import.meta.url))),backupSha:backup.backupSha,scope:{day:DAY,maxOrders:500,selectedOrders:1},limitations:['stored-date-range-only','no-original-command-job','no-physical-stock-verification','no-before-migration-evidence','document-kg-not-compared','guard-absence-does-not-establish-uncancelled-validity'],summary,observations,originalHash:sha(JSON.stringify(observations))};preserve(payload);deps.write(path,JSON.stringify(payload,null,2));return {readOnly:true,currentOnly:true,atomicSnapshot:false,commandFingerprintVerified:false,summary};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(process.argv.slice(2).join(' ')==='--self-check'?selfCheck():await run(process.argv.slice(2))));}catch{console.error(JSON.stringify({failed:true,code:'validation-failed'}));process.exitCode=1;}}
