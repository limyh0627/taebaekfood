import type { CompanyId } from './types';
export type ProductStocktakeRequest = {version:1;operationId:string;companyId:CompanyId;uid:string;itemId:string;itemName:string;targetQty:number;minStock?:number;unitKg:number;capturedAt:string};
export type ProductStocktakeAttempt = ProductStocktakeRequest & {state:'prepared'|'submitted'};
const key=(companyId:CompanyId,uid:string,itemId:string)=>{
 if(!['taebaek','punghoe'].includes(companyId)||!uid||!itemId)throw Error('실사 요청의 회사·로그인·품목을 확인해 주세요.');
 return `product-stocktake:${companyId}:${encodeURIComponent(uid)}:${encodeURIComponent(itemId)}`;
};
export function validateProductStocktakeRequest(request:ProductStocktakeRequest):void {
 key(request.companyId,request.uid,request.itemId);
 if(request.version!==1||!request.operationId||!request.itemName||!Number.isFinite(request.targetQty)||request.targetQty<0
 || !Number.isFinite(request.unitKg)||request.unitKg<0||request.minStock!==undefined&&(!Number.isFinite(request.minStock)||request.minStock<0)
 ||typeof request.capturedAt!=='string'||!Number.isFinite(Date.parse(request.capturedAt)))throw Error('보존된 제품 실사 원문을 확인할 수 없습니다.');
}
export function productStocktakeRequest(attempt:ProductStocktakeAttempt):ProductStocktakeRequest {
 const {state:_state,...request}=attempt;validateProductStocktakeRequest(request);return request;
}
export function readProductStocktakeAttempt(companyId:CompanyId,uid:string,itemId:string):ProductStocktakeAttempt|null {
 const raw=localStorage.getItem(key(companyId,uid,itemId));if(raw===null)return null;
 let attempt:ProductStocktakeAttempt;try{attempt=JSON.parse(raw);validateProductStocktakeRequest(attempt);if(!['prepared','submitted'].includes(attempt.state))throw Error('state');}catch{throw Error('보존된 실사 원문이 손상됐습니다. 임의로 다시 실사하지 않았습니다.');}
 if(attempt.companyId!==companyId||attempt.uid!==uid||attempt.itemId!==itemId)throw Error('보존된 실사 요청의 회사·로그인·품목이 다릅니다.');return attempt;
}
export function beginProductStocktakeAttempt(input:Omit<ProductStocktakeRequest,'version'|'operationId'|'capturedAt'> & {operationId?:string}):ProductStocktakeAttempt {
 const previous=readProductStocktakeAttempt(input.companyId,input.uid,input.itemId);if(previous)return previous;
 const attempt:ProductStocktakeAttempt={...input,version:1,operationId:input.operationId||`stocktake-${input.itemId}-${crypto.randomUUID()}`,capturedAt:new Date().toISOString(),state:'prepared'};
 validateProductStocktakeRequest(attempt);localStorage.setItem(key(input.companyId,input.uid,input.itemId),JSON.stringify(attempt));return attempt;
}
export function submitProductStocktakeAttempt(attempt:ProductStocktakeAttempt):ProductStocktakeAttempt {
 const current=readProductStocktakeAttempt(attempt.companyId,attempt.uid,attempt.itemId);
 if(!current||JSON.stringify(current)!==JSON.stringify(attempt))throw Error('보존된 실사 요청이 변경되었습니다.');
 if(attempt.state==='submitted')return attempt;
 const submitted:ProductStocktakeAttempt={...attempt,state:'submitted'};localStorage.setItem(key(attempt.companyId,attempt.uid,attempt.itemId),JSON.stringify(submitted));return submitted;
}
export function clearProductStocktakeAttempt(attempt:ProductStocktakeAttempt):void {
 const current=readProductStocktakeAttempt(attempt.companyId,attempt.uid,attempt.itemId);if(!current)return;
 if(JSON.stringify(current)!==JSON.stringify(attempt))throw Error('다른 실사 요청은 정리하지 않았습니다.');localStorage.removeItem(key(attempt.companyId,attempt.uid,attempt.itemId));
}
export function discardProductStocktakeAttempt(companyId:CompanyId,uid:string,itemId:string,expected:string|null):void {
 const target=key(companyId,uid,itemId);if(localStorage.getItem(target)!==expected)throw Error('실사 원문이 변경되어 폐기하지 않았습니다.');localStorage.removeItem(target);
}
export function productStocktakeAttemptText(companyId:CompanyId,uid:string,itemId:string):string|null{return localStorage.getItem(key(companyId,uid,itemId));}

export function sameProductStocktakeRequest(left: unknown, right: ProductStocktakeRequest): boolean {
 if(!left || typeof left!=='object' || Array.isArray(left))return false;
 const keys=['version','operationId','companyId','uid','itemId','itemName','targetQty','minStock','unitKg','capturedAt'] as const;
 const source=left as Record<string,unknown>;
 return Object.keys(source).every(key=>keys.includes(key as typeof keys[number])) && keys.every(key=>source[key]===right[key]);
}
