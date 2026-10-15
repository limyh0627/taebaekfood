/** 퇴직금 수기 장부다. 급여·법정 예상액·회계 전표를 자동으로 만들지 않는다. */
export type RetirementCompany='taebaek'|'punghoe';
export const RETIREMENT_COLLECTIONS={profiles:'retirementProfiles',events:'retirementEvents',receipts:'retirementCommandReceipts'} as const;
export interface RetirementProfileInput{eligible:boolean;managementDay:string;targetStartDay:string;targetEndDay:string|null;closedThroughDay:string|null}
export interface RetirementProfile extends RetirementProfileInput{id:string;companyId:RetirementCompany;employeeId:string;revision:number;regime:'retirement';createdAt:string;updatedAt:string;updatedBy:string}
interface EventBase{id:string;effectiveDay:string;reason:string;evidence:string}
export type RetirementEventInput=(EventBase&{kind:'opening';amount:number;allocationEvidence:string})|(EventBase&{kind:'accrual';amount:number;yearMonth:string})|(EventBase&{kind:'interim'|'final';periodStartDay:string;periodEndDay:string;gross:number;incomeTax:number;localTax:number;otherDeduct:number;net:number;reserveUsed:number;employeeRequest:string;overdrawAcknowledgement:string});
export interface RetirementCancellationInput extends EventBase{kind:'cancellation';targetEventId:string}
export interface RetirementEvent{id:string;companyId:RetirementCompany;employeeId:string;status:'draft'|'confirmed';input:RetirementEventInput|RetirementCancellationInput;createdAt:string;createdBy:string;updatedAt:string;confirmedAt:string|null;confirmedBy:string|null;sourceRevision:number}
export type RetirementAction={kind:'configure';profile:RetirementProfileInput}|{kind:'save-draft';event:RetirementEventInput}|{kind:'confirm';eventId:string}|{kind:'cancel';eventId:string;cancellationId:string;effectiveDay:string;reason:string;evidence:string}|{kind:'replace';eventId:string;cancellationId:string;effectiveDay:string;reason:string;evidence:string;replacement:RetirementEventInput};
export interface RetirementRequest{version:1;operationId:string;companyId:RetirementCompany;employeeId:string;expectedRevision:number;releaseId:string;action:RetirementAction}
export interface RetirementSummary{asOfDay:string;openingConfirmed:boolean;balance:number|null;knownMovement:number;accrual:number;reserveUsed:number;lastSettlementEndDay:string|null;legalEstimate:null;reconciliation:'unavailable';overdrawn:boolean|null}
export interface RetirementReadDTO{releaseId:string|null;companyId:RetirementCompany;employeeId:string;asOfDay:string;profile:RetirementProfile|null;events:RetirementEvent[];summary:RetirementSummary}
export type RetirementReceiptStatus='applied'|'rejected'|'discarded'|'unknown';
export interface RetirementCommandResult{status:RetirementReceiptStatus;companyId:RetirementCompany;employeeId:string;operationId:string;requestHash:string|null;requestText:string|null;opaqueFence:boolean;actorUid:string;revision:number|null;errorCode:string|null;message:string}
export interface RetirementRequestReference{companyId:RetirementCompany;employeeId:string;operationId:string}
export type RetirementCommand={mode:'read';companyId:RetirementCompany;employeeId:string;asOfDay:string}|{mode:'apply';request:RetirementRequest}|({mode:'inspect-request'|'discard-request'}&({request:RetirementRequest;reference?:never}|{reference:RetirementRequestReference;request?:never}));
export class RetirementValidationError extends Error{constructor(readonly code:string,message:string){super(message);this.name='RetirementValidationError';}}
function requireValue(value:unknown,message:string):asserts value{if(!value)throw new RetirementValidationError('invalid-input',message);}
export const retirementProfileId=(companyId:RetirementCompany,employeeId:string)=>companyId+'__'+employeeId;
export function retirementValidId(v:unknown):v is string{return typeof v==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(v)&&!/^__.*__$/.test(v);}
export function retirementCalendarDay(v:unknown):v is string{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
function record(v:unknown,keys:readonly string[],optional:readonly string[]=[]):asserts v is Record<string,any>{requireValue(v&&typeof v==='object'&&!Array.isArray(v),'입력 형식을 확인하세요.');const r=v as Record<string,unknown>;requireValue(Object.keys(r).every(k=>keys.includes(k))&&keys.every(k=>optional.includes(k)||Object.prototype.hasOwnProperty.call(r,k)),'허용된 입력 항목을 확인하세요.');}
function text(v:unknown,required=false,max=2000):asserts v is string{requireValue(typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0),'사유와 근거를 확인하세요.');}
function money(v:unknown):asserts v is number{requireValue(Number.isSafeInteger(v)&&(v as number)>=0,'금액은 0 이상의 정수로 입력하세요.');}
export function normalizeRetirementProfile(v:unknown):RetirementProfileInput{record(v,['eligible','managementDay','targetStartDay','targetEndDay','closedThroughDay']);requireValue(typeof v.eligible==='boolean'&&retirementCalendarDay(v.managementDay)&&retirementCalendarDay(v.targetStartDay)&&(v.targetEndDay===null||retirementCalendarDay(v.targetEndDay))&&(v.closedThroughDay===null||retirementCalendarDay(v.closedThroughDay)),'관리 기준일·대상기간·마감일을 확인하세요.');requireValue(v.targetEndDay===null||v.targetEndDay>=v.targetStartDay,'대상기간 종료일이 시작일보다 빠릅니다.');return {...v} as RetirementProfileInput;}
export function normalizeRetirementEvent(v:unknown):RetirementEventInput{
 const common=['id','kind','effectiveDay','reason','evidence'];requireValue(v&&typeof v==='object','이벤트 입력을 확인하세요.');const kind=(v as any).kind;
 const specific=kind==='opening'?['amount','allocationEvidence']:kind==='accrual'?['amount','yearMonth']:['periodStartDay','periodEndDay','gross','incomeTax','localTax','otherDeduct','net','reserveUsed','employeeRequest','overdrawAcknowledgement'];
 requireValue(['opening','accrual','interim','final'].includes(kind),'이벤트 종류를 확인하세요.');record(v,[...common,...specific]);requireValue(retirementValidId(v.id)&&retirementCalendarDay(v.effectiveDay),'이벤트 번호와 효력일을 확인하세요.');text(v.reason,true);text(v.evidence);
 if(kind==='opening'||kind==='accrual'){money(v.amount);if(kind==='opening')text(v.allocationEvidence,true);else requireValue(typeof v.yearMonth==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(v.yearMonth),'적립 귀속 월을 확인하세요.');}
 else{requireValue(retirementCalendarDay(v.periodStartDay)&&retirementCalendarDay(v.periodEndDay)&&v.periodEndDay>=v.periodStartDay,'정산 대상기간을 확인하세요.');for(const k of['gross','incomeTax','localTax','otherDeduct','net','reserveUsed'])money(v[k]);requireValue(Number.isSafeInteger(v.incomeTax+v.localTax+v.otherDeduct+v.net)&&v.gross===v.incomeTax+v.localTax+v.otherDeduct+v.net,'총액과 세액·공제·실지급액이 일치하지 않습니다.');text(v.employeeRequest,true);text(v.overdrawAcknowledgement);}
 return {...v} as RetirementEventInput;
}
export function normalizeRetirementRequest(v:unknown):RetirementRequest{
 record(v,['version','operationId','companyId','employeeId','expectedRevision','releaseId','action']);requireValue(v.version===1&&['taebaek','punghoe'].includes(v.companyId)&&retirementValidId(v.operationId)&&retirementValidId(v.employeeId)&&retirementValidId(v.releaseId)&&Number.isSafeInteger(v.expectedRevision)&&v.expectedRevision>=0,'회사·직원·작업 번호·원본 버전을 확인하세요.');
 const a=v.action;requireValue(a&&typeof a==='object','작업을 확인하세요.');let action:RetirementAction;
 if(a.kind==='configure'){record(a,['kind','profile']);action={kind:'configure',profile:normalizeRetirementProfile(a.profile)};}
 else if(a.kind==='save-draft'){record(a,['kind','event']);action={kind:'save-draft',event:normalizeRetirementEvent(a.event)};}
 else if(a.kind==='confirm'){record(a,['kind','eventId']);requireValue(retirementValidId(a.eventId),'원 이벤트를 확인하세요.');action={kind:'confirm',eventId:a.eventId};}
 else{requireValue(a.kind==='cancel'||a.kind==='replace','작업 종류를 확인하세요.');record(a,['kind','eventId','cancellationId','effectiveDay','reason','evidence',...(a.kind==='replace'?['replacement']:[])]);requireValue(retirementValidId(a.eventId)&&retirementValidId(a.cancellationId)&&a.eventId!==a.cancellationId&&retirementCalendarDay(a.effectiveDay),'취소 번호와 효력일을 확인하세요.');text(a.reason,true);text(a.evidence);const base={eventId:a.eventId,cancellationId:a.cancellationId,effectiveDay:a.effectiveDay,reason:a.reason,evidence:a.evidence};action=a.kind==='replace'?{kind:'replace',...base,replacement:normalizeRetirementEvent(a.replacement)}:{kind:'cancel',...base};}
 return {version:1,operationId:v.operationId,companyId:v.companyId,employeeId:v.employeeId,expectedRevision:v.expectedRevision,releaseId:v.releaseId,action};
}
function canonical(v:any):any{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
/** 누락·null을 임의로 보정하지 않는다. 클라이언트와 서버가 같은 최초 원문을 보관한다. */
export const serializeRetirementRequest=(v:unknown):string=>JSON.stringify(canonical(normalizeRetirementRequest(v)));
export function activeRetirementEvents(events:readonly RetirementEvent[],asOfDay='9999-12-31'){
 const confirmed=events.filter(e=>e.status==='confirmed'&&e.input.effectiveDay<=asOfDay),canceled=new Set(confirmed.filter(e=>e.input.kind==='cancellation').map(e=>(e.input as RetirementCancellationInput).targetEventId));return confirmed.filter(e=>e.input.kind!=='cancellation'&&!canceled.has(e.id));
}
export function summarizeRetirement(events:readonly RetirementEvent[],asOfDay:string):RetirementSummary{
 const active=activeRetirementEvents(events,asOfDay);let opening=0,accrual=0,reserveUsed=0;const starts=active.filter(e=>e.input.kind==='opening');for(const e of active){const v=e.input;if(v.kind==='opening')opening+=v.amount;else if(v.kind==='accrual')accrual+=v.amount;else if(v.kind==='interim'||v.kind==='final')reserveUsed+=v.reserveUsed;}
 const knownMovement=accrual-reserveUsed,balance=starts.length===1?opening+knownMovement:null;requireValue([opening,accrual,reserveUsed,knownMovement,...(balance===null?[]:[balance])].every(Number.isSafeInteger),'장부 합계가 정수 범위를 넘었습니다.');
 const ends=active.flatMap(e=>e.input.kind==='interim'||e.input.kind==='final'?[e.input.periodEndDay]:[]).sort();return {asOfDay,openingConfirmed:starts.length===1,balance,knownMovement,accrual,reserveUsed,lastSettlementEndDay:ends.length?ends[ends.length-1]:null,legalEstimate:null,reconciliation:'unavailable',overdrawn:balance===null?null:balance<0};
}
export function validateRetirementConfirmation(profile:RetirementProfile,event:RetirementEventInput,events:readonly RetirementEvent[]){
 const fail=(code:string,message:string):never=>{throw new RetirementValidationError(code,message);};
 // 현재 취소됐더라도 새 이벤트의 효력일 당시 살아 있던 원본과 이중 계상하지 않는다.
 const active=[...new Map([...activeRetirementEvents(events),...activeRetirementEvents(events,event.effectiveDay)].map(e=>[e.id,e])).values()];if(profile.closedThroughDay&&event.effectiveDay<=profile.closedThroughDay)fail('period-closed','관리 마감일 이전 이벤트는 확정할 수 없습니다.');
 if(!profile.eligible)fail('not-eligible','퇴직금 관리 대상 여부를 확인하세요.');if(event.effectiveDay<profile.managementDay)fail('before-management','관리 기준일 이전 이벤트입니다.');
 if(event.kind==='opening'&&active.some(e=>e.input.kind==='opening'))fail('opening-exists','확정 기초는 하나만 등록할 수 있습니다.');
 if(event.kind==='accrual'&&active.some(e=>e.input.kind==='accrual'&&e.input.yearMonth===event.yearMonth))fail('month-exists','같은 귀속 월의 적립이 이미 확정됐습니다.');
 if(event.kind==='interim'||event.kind==='final'){
  if(event.periodStartDay<profile.targetStartDay||profile.targetEndDay&&event.periodEndDay>profile.targetEndDay)fail('period-outside','정산 대상기간이 설정 범위를 벗어납니다.');
  if(active.some(e=>(e.input.kind==='interim'||e.input.kind==='final')&&event.periodStartDay<=e.input.periodEndDay&&event.periodEndDay>=e.input.periodStartDay))fail('period-overlap','이미 확정한 정산 대상기간과 겹칩니다.');
  const before=summarizeRetirement(events,event.effectiveDay);if(event.reserveUsed>0&&(before.balance===null||event.reserveUsed>before.balance)&&!event.overdrawAcknowledgement.trim())fail('balance-ack-required','기초 미확인 또는 충당 잔액 초과 사용을 확인한 사유가 필요합니다.');
 }
}
