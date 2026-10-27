import {collection,getDocsFromServer,query,where} from 'firebase/firestore';
import {db} from '../firebase';
import type {CompanyId} from '../types';
export type StaticReferenceCollection='partner_item'|'item_bom'|'item_pack'|'item_formula'|'accountGroups'|'accountCodes'|'fixedCostTemplates'|'expensePresets'|'cashFlowManual';
const names:readonly string[]=['partner_item','item_bom','item_pack','item_formula','accountGroups','accountCodes','fixedCostTemplates','expensePresets','cashFlowManual'];
export interface StaticReferenceSnapshot<T>{rows:T[];metadata:{fromCache:boolean|undefined;hasPendingWrites:boolean|undefined}}
/** 회사 조건과 서버 관측을 정적 기준정보 읽기 한 곳에 고정한다. */
export async function readStaticReferenceCollection<T>(name:StaticReferenceCollection,companyId:CompanyId):Promise<StaticReferenceSnapshot<T>>{
 if(!names.includes(name)||!['taebaek','punghoe'].includes(companyId))throw Error('기준정보 조회 범위를 확인해 주세요.');
 const snapshot=await getDocsFromServer(query(collection(db,name),where('companyId','==',companyId)));
 return {rows:snapshot.docs.map(row=>({id:row.id,...row.data()} as T)),metadata:{fromCache:typeof snapshot.metadata?.fromCache==='boolean'?snapshot.metadata.fromCache:undefined,hasPendingWrites:typeof snapshot.metadata?.hasPendingWrites==='boolean'?snapshot.metadata.hasPendingWrites:undefined}};
}
export async function staticReferenceServerRows<T>(request:Promise<StaticReferenceSnapshot<T>>):Promise<T[]>{
 const snapshot=await request;
 if(snapshot.metadata.fromCache!==false||snapshot.metadata.hasPendingWrites!==false)throw Object.assign(Error('기준정보를 서버에서 확인하지 못했습니다.'),{code:'unconfirmed'});
 return snapshot.rows;
}
