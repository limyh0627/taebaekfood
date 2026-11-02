import {createHash} from 'node:crypto';
import {Timestamp,DocumentReference,GeoPoint,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {readOrderProductionCatalog,PRODUCTION_CATALOG_COLLECTIONS,type CatalogObservation,type ProductionCatalogCollection} from './orderProductionCatalogRead';
import {encodeCatalogValue,type CatalogValueAdapter} from './catalogOrderReferenceProof';
import {buildBomIndex} from './bomIndex';
import {buildPackIndex} from './orderPackIndex';
import {buildFormula as formulaFor} from './itemFormula';
import {baseRawName} from './formula';
import {isRawHolder,type RawHolderItem} from './rawHolder';
import type {EditorBom,EditorFormula} from './itemEditorDomain';
import type {ProductionItem,ProductionInputs} from './orderProductionDomain';

export const SERVER_PREVIEW_POLICY='server-preview-v1' as const;
type Observation=Extract<CatalogObservation,{status:'observed'}>;
type BlockedReason=Extract<CatalogObservation,{status:'blocked'}>['reason']|'ambiguous-pack'|'ambiguous-raw-holder';
export type CatalogInputsResult={status:'blocked';executionAllowed:false;reason:BlockedReason;collection?:ProductionCatalogCollection}|{
 status:'assembled';executionAllowed:false;policyVersion:typeof SERVER_PREVIEW_POLICY;companyId:'taebaek'|'punghoe';queryReadTimes:Record<ProductionCatalogCollection,Timestamp>;
 referenceDigest:string;orderedDocumentIds:Record<ProductionCatalogCollection,string[]>;observation:Observation;
 allItems:ProductionItem[];inputs:ProductionInputs<ProductionItem>&{pack:ReturnType<typeof buildPackIndex>};buildFormula:(prodKey:string)=>{raw:string;ratio:number}[];
};
export type CatalogDomainResult = {status:'blocked';executionAllowed:false;reason:'invalid-input'|'ambiguous-pack'|'ambiguous-raw-holder';collection?:ProductionCatalogCollection} | {
 status:'assembled';executionAllowed:false;allItems:ProductionItem[];inputs:ProductionInputs<ProductionItem>&{pack:ReturnType<typeof buildPackIndex>};buildFormula:(prodKey:string)=>{raw:string;ratio:number}[];
};
export type CatalogDomainRows = readonly {name:ProductionCatalogCollection;documents:readonly {id:string;data:Record<string,unknown>}[]}[];
const adapter:Pick<CatalogValueAdapter,'special'>={special:value=>{
 if(value instanceof Timestamp)return ['timestamp',value.seconds,value.nanoseconds];
 if(value instanceof DocumentReference)return ['reference',value.path];
 if(value instanceof GeoPoint)return ['geo',value.latitude,value.longitude];
 if(Buffer.isBuffer(value))return ['bytes',[...value]];
 return undefined;
}};
/** 호출자가 검증한 저장 원문으로 동일한 도메인 계산만 재구성한다. 관측 시각이나 실행 권위는 만들지 않는다. */
export function assembleOrderProductionCatalogDomain(companyId:'taebaek'|'punghoe',ordered:CatalogDomainRows):CatalogDomainResult {
 if(!['taebaek','punghoe'].includes(companyId)||!Array.isArray(ordered as unknown)||ordered.length!==4||ordered.some((row,index)=>row.name!==PRODUCTION_CATALOG_COLLECTIONS[index]||!Array.isArray(row.documents as unknown)||row.documents.length>2000))return {status:'blocked',executionAllowed:false,reason:'invalid-input'};
 let count=0;for(const row of ordered){let previous:string|undefined;for(const document of row.documents){const id=document?.id,data=document?.data;if(typeof id!=='string'||!id||id==='.'||id==='..'||id.includes('/')||Buffer.byteLength(id,'utf8')>1500||previous!==undefined&&id<=previous||!data||typeof data!=='object'||Array.isArray(data)||data.companyId!==companyId||data.id!==undefined&&data.id!==id)return {status:'blocked',executionAllowed:false,reason:'invalid-input'};previous=id;if(++count>5000)return {status:'blocked',executionAllowed:false,reason:'invalid-input'};}}
 const itemIds=new Set(ordered[0].documents.map(row=>row.id));if(ordered[1].documents.some(row=>!itemIds.has(row.data.parent_id as string)||!itemIds.has(row.data.child_id as string))||ordered[2].documents.some(row=>!itemIds.has(row.data.item_id as string)))return {status:'blocked',executionAllowed:false,reason:'invalid-input'};
 const allItems=ordered[0].documents.map(row=>({...row.data,id:row.id})) as unknown as ProductionItem[];
 const packs=ordered[2].documents.map(row=>({...row.data,id:row.id}));
 const packValues=new Map<string,number>();
 for(const row of packs){
  const data=row as Record<string,unknown>,count=Number(data.units_per_box);
  if(!Number.isFinite(count)||count<=1)continue;
  const itemId=data.item_id as string,previous=packValues.get(itemId);
  if(previous!==undefined&&previous!==count)return {status:'blocked',executionAllowed:false,reason:'ambiguous-pack',collection:'item_pack'};
  packValues.set(itemId,count);
 }
 const rawNames=new Set<string>();
 for(const item of allItems){
  if(!isRawHolder(item as RawHolderItem))continue;
  const name=baseRawName(item.name);if(!name)continue;
  if(rawNames.has(name))return {status:'blocked',executionAllowed:false,reason:'ambiguous-raw-holder',collection:'items'};
  rawNames.add(name);
 }
 const boms=ordered[1].documents.map(row=>({...row.data,id:row.id})) as unknown as EditorBom[];
 const formulas=ordered[3].documents.map(row=>({...row.data,id:row.id})) as unknown as EditorFormula[];
 const inputs={bom:buildBomIndex(allItems,boms),pack:buildPackIndex(packs as unknown as Parameters<typeof buildPackIndex>[0])};
 return {status:'assembled',executionAllowed:false,allItems,inputs,buildFormula:prodKey=>formulaFor(prodKey,formulas,allItems)};
}
/** 새 미리보기만 서버 순서를 사용한다. 보관된 계획의 배열과 해시는 다시 만들지 않는다. */
export async function assembleOrderProductionCatalogInputs(tx:Pick<Transaction,'get'>,db:Pick<Firestore,'collection'>,input:unknown):Promise<CatalogInputsResult>{
 const blocked=(reason:BlockedReason,collection?:ProductionCatalogCollection):CatalogInputsResult=>({status:'blocked',executionAllowed:false,reason,...(collection?{collection}:{})});
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return blocked('invalid-input');
 const request=input as Record<string,unknown>;
 if(Object.keys(request).sort().join(',')!=='companyId,policyVersion'||typeof request.companyId!=='string'||!['taebaek','punghoe'].includes(request.companyId)||request.policyVersion!==SERVER_PREVIEW_POLICY)return blocked('invalid-input');
 const observation=await readOrderProductionCatalog(tx,db,{companyId:request.companyId});
 if(observation.status==='blocked')return blocked(observation.reason,observation.collection);
 const ordered=observation.collections.map(row=>({...row,documents:[...row.documents].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)}));
 const orderedDocumentIds={} as Record<ProductionCatalogCollection,string[]>;
 ordered.forEach(row=>{orderedDocumentIds[row.name]=row.documents.map(document=>document.id);});
 const domain=assembleOrderProductionCatalogDomain(observation.companyId,ordered);if(domain.status==='blocked')return domain;
 // readTime은 관측 시각일 뿐 내용 버전이 아니다. updateTime과 native 원문은 버전에 포함한다.
 const digestBody={version:1,policyVersion:SERVER_PREVIEW_POLICY,companyId:observation.companyId,collections:ordered.map(row=>({name:row.name,documents:row.documents.map(document=>({id:document.id,data:document.data,updateTime:document.updateTime}))}))};
 const referenceDigest=createHash('sha256').update(JSON.stringify(encodeCatalogValue(digestBody,adapter))).digest('hex');
 // assembled도 실행권은 아니다. 호출자는 쓰기 전에 이 결과를 확인하고 blocked면 거래를 중단해야 한다.
 const queryReadTimes={} as Record<ProductionCatalogCollection,Timestamp>;
 observation.collections.forEach(row=>{queryReadTimes[row.name]=row.readTime;});
 return {status:'assembled',executionAllowed:false,policyVersion:SERVER_PREVIEW_POLICY,companyId:observation.companyId,queryReadTimes,
  referenceDigest,orderedDocumentIds,observation,allItems:domain.allItems,inputs:domain.inputs,buildFormula:domain.buildFormula};
}
