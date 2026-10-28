import {Timestamp,DocumentReference,GeoPoint,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {encodeCatalogValue,type CatalogValueAdapter} from './catalogOrderReferenceProof';

export const PRODUCTION_CATALOG_COLLECTIONS=['items','item_bom','item_pack','item_formula'] as const;
export type ProductionCatalogCollection=typeof PRODUCTION_CATALOG_COLLECTIONS[number];
export const PRODUCTION_CATALOG_LIMITS={perCollection:2000,total:5000,bytes:8*1024*1024} as const;
export interface CatalogObservedDocument {id:string;data:Record<string,unknown>;updateTime:Timestamp}
export interface CatalogObservedCollection {name:ProductionCatalogCollection;where:readonly ['companyId','==','taebaek'|'punghoe'];documents:CatalogObservedDocument[];documentIds:string[];count:number;readTime:Timestamp}
export type CatalogObservation={status:'observed';plannerReady:false;companyId:'taebaek'|'punghoe';collections:CatalogObservedCollection[];count:number;encodedBytes:number}|{status:'blocked';plannerReady:false;reason:'invalid-input'|'read-failed'|'collection-limit'|'total-limit'|'bytes-limit'|'invalid-document'|'reference-missing'|'snapshot-mismatch';collection?:ProductionCatalogCollection};
const adapter:Pick<CatalogValueAdapter,'special'>={special:value=>{
 if(value instanceof Timestamp)return ['timestamp',value.seconds,value.nanoseconds];
 if(value instanceof DocumentReference)return ['reference',value.path];
 if(value instanceof GeoPoint)return ['geo',value.latitude,value.longitude];
 if(Buffer.isBuffer(value))return ['bytes',[...value]];
 return undefined;
}};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=(value:unknown):value is string=>typeof value==='string'&&!!value&&value!=='.'&&value!=='..'&&!value.includes('/')&&Buffer.byteLength(value,'utf8')<=1500;
const text=(value:unknown):value is string=>typeof value==='string'&&!!value;
const stamp=(value:unknown):value is Timestamp=>value instanceof Timestamp&&Number.isSafeInteger(value.seconds)&&Number.isSafeInteger(value.nanoseconds)&&value.nanoseconds>=0&&value.nanoseconds<1e9;
// 계산에 쓰이지 않는 native 값도 원문 그대로 돌려준다. codec의 정렬은 크기 측정에만 쓰며 행 순서를 바꾸지 않는다.
function measurable(value:unknown,seen=new Set<object>(),depth=0):void{
 if(depth>40)throw Error('depth');
 if(value===null||typeof value!=='object')return;
 if(adapter.special(value)||value instanceof Date)return;
 if(seen.has(value))throw Error('cycle');seen.add(value);
 if(!Array.isArray(value)&&!object(value))throw Error('shape');
 for(const child of Object.values(value))measurable(child,seen,depth+1);
 seen.delete(value);
}
function validCalculationFields(name:ProductionCatalogCollection,data:Record<string,unknown>):boolean{
 const numbers=name==='items'?['stock','density']:name==='item_bom'?['quantity']:name==='item_pack'?['units_per_box']:['ratio','yield_rate'];
 // 옛 생략·null 기본값과 수치 문자열은 바꾸지 않는다. 숫자로 저장된 비유한 계산값은 관측 성공으로 내보내지 않는다.
 if(numbers.some(key=>data[key]!==undefined&&data[key]!==null&&(typeof data[key]==='number'?!Number.isFinite(data[key]):typeof data[key]!=='string'||!Number.isFinite(Number(data[key])))))return false;
 if(name==='items')return text(data.name)&&text(data.type)&&['unit','subtype','category','procureType','품목','spec'].every(key=>data[key]===undefined||data[key]===null||typeof data[key]==='string');
 if(name==='item_bom')return id(data.parent_id)&&id(data.child_id);
 if(name==='item_pack')return id(data.item_id);
 return text(data.parent_key)&&text(data.child_name);
}
/** 호출자가 가진 같은 거래의 원문 관측만 맡는다. 읽기 결과는 계획 실행권이나 미래 변경 차단 증거가 아니다. */
export async function readOrderProductionCatalog(tx:Pick<Transaction,'get'>,db:Pick<Firestore,'collection'>,input:unknown):Promise<CatalogObservation>{
 const blocked=(reason:Extract<CatalogObservation,{status:'blocked'}>['reason'],collection?:ProductionCatalogCollection):CatalogObservation=>({status:'blocked',plannerReady:false,reason,...(collection?{collection}:{})});
 if(!object(input)||Object.keys(input).length!==1||typeof input.companyId!=='string'||!['taebaek','punghoe'].includes(input.companyId))return blocked('invalid-input');
 const companyId=input.companyId as 'taebaek'|'punghoe',collections:CatalogObservedCollection[]=[];let count=0,encodedBytes=0,readTime:Timestamp|undefined;
 for(const name of PRODUCTION_CATALOG_COLLECTIONS){
  let snapshot;
  try{snapshot=await tx.get(db.collection(name).where('companyId','==',companyId).limit(PRODUCTION_CATALOG_LIMITS.perCollection+1));}catch{return blocked('read-failed',name);}
  if(!snapshot||!Array.isArray(snapshot.docs)||snapshot.size!==snapshot.docs.length||!stamp(snapshot.readTime))return blocked('invalid-document',name);
  if(snapshot.size>PRODUCTION_CATALOG_LIMITS.perCollection)return blocked('collection-limit',name);
  count+=snapshot.size;if(count>PRODUCTION_CATALOG_LIMITS.total)return blocked('total-limit',name);
  if(readTime&&!readTime.isEqual(snapshot.readTime))return blocked('snapshot-mismatch',name);readTime=snapshot.readTime;
  const documents:CatalogObservedDocument[]=[],ids=new Set<string>();
  for(const document of snapshot.docs){
   const data=document.data();
   if(!document.exists||!id(document.id)||ids.has(document.id)||!object(data)||data.companyId!==companyId||data.id!==undefined&&data.id!==document.id||!stamp(document.updateTime)||!validCalculationFields(name,data))return blocked('invalid-document',name);
   try{measurable(data);encodedBytes+=Buffer.byteLength(JSON.stringify(encodeCatalogValue({id:document.id,data,updateTime:document.updateTime},adapter)),'utf8');}catch{return blocked('invalid-document',name);}
   if(encodedBytes>PRODUCTION_CATALOG_LIMITS.bytes)return blocked('bytes-limit',name);
   ids.add(document.id);documents.push({id:document.id,data,updateTime:document.updateTime});
  }
  collections.push({name,where:['companyId','==',companyId],documents,documentIds:documents.map(row=>row.id),count:documents.length,readTime:snapshot.readTime});
 }
 const itemIds=new Set(collections[0].documentIds);
 // 다른 회사나 legacy 문서를 전역 조회해 참조를 보충하지 않는다. 이름 기반 배합식은 ID 참조로 바꾸지 않는다.
 if(collections[1].documents.some(({data})=>!itemIds.has(data.parent_id as string)||!itemIds.has(data.child_id as string))||collections[2].documents.some(({data})=>!itemIds.has(data.item_id as string)))return blocked('reference-missing');
 return {status:'observed',plannerReady:false,companyId,collections,count,encodedBytes};
}
