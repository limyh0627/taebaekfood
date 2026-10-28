import {createHash} from 'node:crypto';
import {Timestamp,DocumentReference,GeoPoint,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {readOrderProductionCatalog,type CatalogObservation,type ProductionCatalogCollection} from './orderProductionCatalogRead';
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
const adapter:Pick<CatalogValueAdapter,'special'>={special:value=>{
 if(value instanceof Timestamp)return ['timestamp',value.seconds,value.nanoseconds];
 if(value instanceof DocumentReference)return ['reference',value.path];
 if(value instanceof GeoPoint)return ['geo',value.latitude,value.longitude];
 if(Buffer.isBuffer(value))return ['bytes',[...value]];
 return undefined;
}};
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
 const allItems=ordered[0].documents.map(row=>({...row.data,id:row.id})) as unknown as ProductionItem[];
 const packs=ordered[2].documents.map(row=>({...row.data,id:row.id}));
 const packValues=new Map<string,number>();
 for(const row of packs){
  const data=row as Record<string,unknown>,count=Number(data.units_per_box);
  if(!Number.isFinite(count)||count<=1)continue;
  const itemId=data.item_id as string,previous=packValues.get(itemId);
  if(previous!==undefined&&previous!==count)return blocked('ambiguous-pack','item_pack');
  packValues.set(itemId,count);
 }
 const rawNames=new Set<string>();
 for(const item of allItems){
  if(!isRawHolder(item as RawHolderItem))continue;
  const name=baseRawName(item.name);if(!name)continue;
  if(rawNames.has(name))return blocked('ambiguous-raw-holder','items');
  rawNames.add(name);
 }
 const boms=ordered[1].documents.map(row=>({...row.data,id:row.id})) as unknown as EditorBom[];
 const formulas=ordered[3].documents.map(row=>({...row.data,id:row.id})) as unknown as EditorFormula[];
 const inputs={bom:buildBomIndex(allItems,boms),pack:buildPackIndex(packs as unknown as Parameters<typeof buildPackIndex>[0])};
 // readTime은 관측 시각일 뿐 내용 버전이 아니다. updateTime과 native 원문은 버전에 포함한다.
 const digestBody={version:1,policyVersion:SERVER_PREVIEW_POLICY,companyId:observation.companyId,collections:ordered.map(row=>({name:row.name,documents:row.documents.map(document=>({id:document.id,data:document.data,updateTime:document.updateTime}))}))};
 const referenceDigest=createHash('sha256').update(JSON.stringify(encodeCatalogValue(digestBody,adapter))).digest('hex');
 // assembled도 실행권은 아니다. 호출자는 쓰기 전에 이 결과를 확인하고 blocked면 거래를 중단해야 한다.
 const queryReadTimes={} as Record<ProductionCatalogCollection,Timestamp>;
 observation.collections.forEach(row=>{queryReadTimes[row.name]=row.readTime;});
 return {status:'assembled',executionAllowed:false,policyVersion:SERVER_PREVIEW_POLICY,companyId:observation.companyId,queryReadTimes,
  referenceDigest,orderedDocumentIds,observation,allItems,inputs,buildFormula:prodKey=>formulaFor(prodKey,formulas,allItems)};
}
