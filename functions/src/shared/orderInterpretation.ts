export type OrderInterpretationJson = null | boolean | number | string | OrderInterpretationJson[] | OrderInterpretationJsonObject;
export type OrderInterpretationJsonObject = { [key: string]: OrderInterpretationJson };
export type OrderInterpretationScope = { companyId: 'taebaek' | 'punghoe'; actorUid: string };
export interface OrderExpressionConfirmation {sourceStart:number;sourceEnd:number;sourceText:string;scope:'partner'|'company';target:'note';value:string}
export interface OrderExpressionRule {kind?:'alias'|'expression';partnerId:string;alias:string;itemId:string;status:string;scope?:'partner'|'company';target?:'note';value?:string}
export interface OrderInterpretationRequest extends OrderInterpretationScope {
  version: 1;
  requestId: string;
  createdAt: string;
  sourceText: string;
  firstAnalysis: OrderInterpretationJsonObject;
  confirmed: { inputLines: OrderInterpretationJsonObject[]; orderDraft: OrderInterpretationJsonObject; expressionConfirmations?: OrderExpressionConfirmation[] };
}

export class OrderInterpretationValidationError extends Error {}
function fail(message: string): never { throw new OrderInterpretationValidationError(message); }
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** JSON에서 조용히 사라지는 값은 최초 증거로 사용할 수 없어 누락시키지 않고 거절한다. */
function cloneJson(value: unknown, ancestors = new Set<object>()): OrderInterpretationJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('보관할 숫자가 JSON 원문으로 보존되지 않습니다.');
    return value;
  }
  if (!Array.isArray(value) && !plain(value)) fail('보관할 값은 누락 없는 JSON 값이어야 합니다.');
  if (ancestors.has(value as object)) fail('순환 참조는 주문 판독 증거로 보관할 수 없습니다.');
  ancestors.add(value as object);
  try {
    if (Object.getOwnPropertySymbols(value).length) fail('기호 속성은 주문 판독 증거로 보관할 수 없습니다.');
    const names = Object.getOwnPropertyNames(value);
    if (Array.isArray(value)) {
      if (names.length !== value.length + 1) fail('빈 칸이나 추가 속성이 있는 배열은 보관할 수 없습니다.');
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('배열 원문을 누락 없이 읽을 수 없습니다.');
        return cloneJson(descriptor.value, ancestors);
      });
    }
    return Object.fromEntries(names.sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor) || !descriptor.enumerable) fail('숨겨진 속성이나 접근자는 보관할 수 없습니다.');
      return [key, cloneJson(descriptor.value, ancestors)];
    }));
  } finally { ancestors.delete(value as object); }
}

function exactKeys(value: OrderInterpretationJsonObject, keys: string[]) {
  if (Object.keys(value).sort().join('\u0000') !== [...keys].sort().join('\u0000')) fail('주문 판독 증거의 필수 필드나 허용 범위가 다릅니다.');
}
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export function validOrderInterpretationIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const calendar = new Date(0); calendar.setUTCFullYear(+year, +month - 1, +day);
  return calendar.getUTCFullYear() === +year && calendar.getUTCMonth() === +month - 1 && calendar.getUTCDate() === +day
    && +hour < 24 && +minute < 60 && +second < 60 && (!offsetHour || +offsetHour < 24 && +offsetMinute < 60);
}

/** 증거 보관용이다. 이 객체를 DB 주문 필드로 그대로 펼칠 권한을 부여하지 않는다.
 * 선택 필드의 undefined도 거절한다. 후속 capture adapter가 실제 필드를 명시적으로 JSON 값으로 구성해야 한다.
 */
export function validateOrderInterpretation(value: unknown, scope: OrderInterpretationScope): OrderInterpretationRequest {
  if (!scope || !['taebaek', 'punghoe'].includes(scope.companyId) || !nonblank(scope.actorUid)) fail('실제 회사와 사용자 범위가 필요합니다.');
  const copy = cloneJson(value);
  if (!plain(copy)) fail('주문 판독 증거는 객체여야 합니다.');
  exactKeys(copy as OrderInterpretationJsonObject, ['version', 'requestId', 'companyId', 'actorUid', 'createdAt', 'sourceText', 'firstAnalysis', 'confirmed']);
  if (copy.version !== 1 || !nonblank(copy.requestId) || copy.companyId !== scope.companyId || copy.actorUid !== scope.actorUid
    || !validOrderInterpretationIso(copy.createdAt) || typeof copy.sourceText !== 'string') fail('주문 판독 요청의 버전·회사·사용자·시각이 맞지 않습니다.');
  if (!plain(copy.firstAnalysis) || !plain(copy.confirmed)) fail('최초 분석과 확정 입력 전체가 필요합니다.');
  exactKeys(copy.confirmed as OrderInterpretationJsonObject, ['inputLines', 'orderDraft', ...(Object.prototype.hasOwnProperty.call(copy.confirmed,'expressionConfirmations')?['expressionConfirmations']:[])]);
  if (!Array.isArray(copy.confirmed.inputLines) || !copy.confirmed.inputLines.every(plain) || !plain(copy.confirmed.orderDraft)) fail('확정 주문줄과 주문 초안 원문이 필요합니다.');
  validateOrderExpressionConfirmations(copy as unknown as OrderInterpretationRequest);
  return copy as unknown as OrderInterpretationRequest;
}
export function canonicalOrderInterpretation(value: unknown, scope: OrderInterpretationScope): string {
  return JSON.stringify(validateOrderInterpretation(value, scope));
}
export function sameOrderInterpretationRequest(first: unknown, next: unknown, scope: OrderInterpretationScope): boolean {
  return canonicalOrderInterpretation(first, scope) === canonicalOrderInterpretation(next, scope);
}
/** 거래처 표현의 숫자·규격·문장 의미는 추정하지 않고 공백만 통일한다. */
export const normalizeOrderInterpretationAlias=(value:string):string=>value.trim().replace(/\s+/g,' ');
export interface OrderInterpretationAliasCandidate{partnerId:string;alias:string;itemId:string}
export function orderInterpretationAliasCandidates(request:OrderInterpretationRequest):OrderInterpretationAliasCandidate[]{
 if(!['rules','ai'].includes(String(request.firstAnalysis.kind)))return [];
 const draft=request.confirmed.orderDraft;if(typeof draft.partnerId!=='string'||!Array.isArray(draft.items))return [];
 const result:OrderInterpretationAliasCandidate[]=[];
 for(const final of draft.items){
  if(!final||Array.isArray(final)||typeof final!=='object'||typeof final.itemId!=='string'||typeof final.orderedAs!=='string')continue;
  const inputs=request.confirmed.inputLines.filter(row=>row.itemId===final.itemId&&row.orderedAs===final.orderedAs);
  if(inputs.length!==1)continue;const input=inputs[0];if(typeof input.quantity!=='number'||!Number.isFinite(input.quantity)||input.quantity<=0||typeof input.isBoxUnit!=='boolean')continue;
  if(input.isBoxUnit?final.isBoxUnit!==true||final.boxQuantity!==input.quantity:final.isBoxUnit===true||final.quantity!==input.quantity)continue;
  let alias=normalizeOrderInterpretationAlias(final.orderedAs);
  if(!alias||alias.length>=80||/[\r\n,;:+/]/.test(final.orderedAs)||/(부탁|주세요|주문|보내|배송|추가|그리고|및)/.test(alias))continue;
  const suffix=/^(.*?)\s*(\d+(?:\.\d+)?)\s*(개|병|박스|캔|포)$/.exec(alias);
  if(suffix){if(Number(suffix[2])!==input.quantity||input.isBoxUnit&&suffix[3]!=='박스'||!input.isBoxUnit&&suffix[3]==='박스')continue;alias=normalizeOrderInterpretationAlias(suffix[1]);}
  // 수량 없는 여러 품목 문장이나 끝에 남은 수량은 별칭으로 승격하지 않는다.
  if(!alias||/\d\s*(개|병|박스|캔|포)$/.test(alias)||/[!?]/.test(alias))continue;
  result.push({partnerId:draft.partnerId,alias,itemId:final.itemId});
 }
 return result.filter((row,index)=>result.findIndex(other=>other.partnerId===row.partnerId&&other.alias===row.alias&&other.itemId===row.itemId)===index);
}
export type OrderInterpretationAliasResolution = {status:'none'} | {status:'matched';itemId:string} | {status:'conflict'};
export function resolveOrderInterpretationAlias(expression:string,rules:readonly {alias:string;itemId:string;partnerId:string;status:string;kind?:string}[],partnerId:string):OrderInterpretationAliasResolution{
 const normalized=normalizeOrderInterpretationAlias(expression),matches=rules.filter(row=>(row.kind===undefined||row.kind==='alias')&&row.status==='approved'&&row.partnerId===partnerId&&normalizeOrderInterpretationAlias(row.alias)===normalized);
 const ids=new Set(matches.map(row=>row.itemId));
 return ids.size===0?{status:'none'}:ids.size===1?{status:'matched',itemId:[...ids][0]}:{status:'conflict'};
}
export function matchOrderInterpretationAlias(expression:string,rules:readonly {alias:string;itemId:string;partnerId:string;status:string;kind?:string}[],partnerId:string):string|null{
 const result=resolveOrderInterpretationAlias(expression,rules,partnerId);
 return result.status==='matched'?result.itemId:null;
}
/** 원문은 보존하며 판독 사본에만 명시 숫자 단위를 적용한다. */
export const normalizeOrderInterpretationUnits=(text:string):string=>text.replace(/(\d+(?:\.\d+)?)\s*미리(?=\s|$|\d|[개병박스캔포])/g,'$1ml');
export function validateOrderExpressionConfirmations(request:OrderInterpretationRequest):void {
 const rows=request.confirmed.expressionConfirmations;if(rows===undefined)return;
 if(!Array.isArray(rows)||rows.length>50)fail('확정 표현 목록을 확인해 주세요.');
 const seen=new Set<string>();
 for(const row of rows){
  if(!plain(row))fail('확정 표현은 객체여야 합니다.');
  exactKeys(row as unknown as OrderInterpretationJsonObject,['sourceStart','sourceEnd','sourceText','scope','target','value']);
  if(!Number.isSafeInteger(row.sourceStart)||!Number.isSafeInteger(row.sourceEnd)||row.sourceStart<0||row.sourceEnd<=row.sourceStart||row.sourceEnd>request.sourceText.length||typeof row.sourceText!=='string'||request.sourceText.slice(row.sourceStart,row.sourceEnd)!==row.sourceText||!row.sourceText.trim()||row.sourceText.length>200||/[\r\n]/.test(row.sourceText)||!['partner','company'].includes(row.scope)||row.target!=='note'||typeof row.value!=='string'||!row.value.trim()||row.value.length>500||/[\r\n]/.test(row.value))fail('최초 원문 구간과 확정 표현이 다릅니다.');
  const draft=request.confirmed.orderDraft;
  if(typeof draft.note!=='string'||!draft.note.split(/\r?\n/).includes(row.value))fail('최종 비고와 확정 표현이 다릅니다.');
  const key=JSON.stringify([row.sourceStart,row.sourceEnd,row.target]);if(seen.has(key))fail('같은 원문 표현을 중복 확정할 수 없습니다.');seen.add(key);
 }
}
export interface OrderExpressionCandidate {kind:'expression';partnerId:string;alias:string;itemId:string;scope:'partner'|'company';target:'note';value:string}
export function orderInterpretationExpressionCandidates(request:OrderInterpretationRequest):OrderExpressionCandidate[]{
 validateOrderExpressionConfirmations(request);const partnerId=request.confirmed.orderDraft.partnerId;if(typeof partnerId!=='string'||!partnerId)return [];
 return (request.confirmed.expressionConfirmations??[]).map(row=>({kind:'expression' as const,partnerId:row.scope==='company'?'':partnerId,alias:normalizeOrderInterpretationAlias(row.sourceText),itemId:'',scope:row.scope,target:row.target,value:row.value})).filter((row,index,rows)=>rows.findIndex(other=>JSON.stringify(other)===JSON.stringify(row))===index);
}
export function matchOrderInterpretationExpressions(sourceText:string,rules:readonly OrderExpressionRule[],partnerId:string):{notes:string[];conflicted:boolean}{
 const lines=new Set(sourceText.split(/\r?\n/).map(normalizeOrderInterpretationAlias));
 const eligible=rules.filter(row=>row.kind==='expression'&&row.status==='approved'&&((row.scope==='company'&&row.partnerId==='')||(row.scope==='partner'&&row.partnerId===partnerId))&&lines.has(normalizeOrderInterpretationAlias(row.alias))&&row.target==='note'&&typeof row.value==='string');
 const groups=new Map<string,OrderExpressionRule[]>();for(const row of eligible){const key=normalizeOrderInterpretationAlias(row.alias);groups.set(key,[...(groups.get(key)??[]),row]);}
 const notes=new Set<string>();let conflicted=false;
 for(const rows of groups.values()){const values=new Set(rows.map(row=>row.value!));if(values.size!==1){conflicted=true;continue;}notes.add([...values][0]);}
 return {notes:[...notes],conflicted};
}
