import {cleanupValidId} from './partnerItemCleanup';
import {retirementCalendarDay} from './retirementBenefit';
import {encodeCatalogValue,type CatalogValue,type CatalogValueAdapter} from './catalogOrderReferenceProof';
export type {CatalogValueAdapter,CatalogValue} from './catalogOrderReferenceProof';
import type {OrderEditItem} from './orderEditUnits';
export type {OrderEditItem} from './orderEditUnits';

export const ORDER_EDIT_OPERATIONS = 'orderEditOperations';
export const ORDER_EDIT_MAX_BYTES = 256 * 1024;
export interface OrderEditReference {companyId:'taebaek'|'punghoe';planId:string;targetId:string}
export interface OrderEditDraft {deliveryDate:string;items:OrderEditItem[];note:string;noteImportant:boolean}
export type OrderEdit = {kind:'draft';draft:OrderEditDraft}|{kind:'items';items:OrderEditItem[]};
export interface OrderEditRequest extends OrderEditReference {
  version:1;
  expected:CatalogValue;
  edit:OrderEdit;
  confirmedAddedToDispatched:boolean;
}
export type OrderEditCommand = {mode:'apply';request:OrderEditRequest}
  | {mode:'inspect'|'cancel';reference:OrderEditReference;requestHash?:string};
export interface OrderEditResult extends OrderEditReference {
  actorUid:string;
  status:'applied'|'duplicate'|'rejected'|'cancelled'|'unknown';
  requestHash:string|null;
  message:string;
}
export const ORDER_EDIT_EXPECTED_FIELDS = ['companyId','items','status','itemInventory','producedAt','shippedOut','inventoryOperation','retirementClaimPending','retirementId','deliveryDate','note','noteImportant','noteBy','noteAt','inventoryWriterProtocolVersion','inventoryWriteRevision'] as const;
const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function exact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown> {
  if (!record(value) || Object.keys(value).some(key=>!keys.includes(key))) throw Error('주문 수정 요청 형식을 확인해 주세요.');
}
/** UI를 열 때 본 원문을 보관한다. 누락/null과 SDK Timestamp를 임의로 같은 값으로 만들지 않는다. */
export function orderEditExpected(row:Record<string,unknown>,adapter?:Pick<CatalogValueAdapter,'special'>):CatalogValue {
  return encodeCatalogValue(Object.fromEntries(ORDER_EDIT_EXPECTED_FIELDS.filter(key=>Object.prototype.hasOwnProperty.call(row,key)).map(key=>[key,row[key]])),adapter);
}
export function normalizeOrderEditReference(value:unknown):OrderEditReference {
  exact(value,['companyId','planId','targetId']);
  if (!['taebaek','punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId) || !cleanupValidId(value.targetId)) throw Error('주문 수정의 회사·작업·대상 번호를 확인해 주세요.');
  return {companyId:value.companyId as OrderEditReference['companyId'],planId:value.planId,targetId:value.targetId};
}
function jsonInput(value:unknown):unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonInput);
  if (record(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value))) return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,jsonInput(value[key])]));
  throw Error('주문 수정 입력에 저장할 수 없는 값이 있습니다.');
}
export function normalizeOrderEditRequest(value:unknown):OrderEditRequest {
  exact(value,['version','companyId','planId','targetId','expected','edit','confirmedAddedToDispatched']);
  const reference = normalizeOrderEditReference({companyId:value.companyId,planId:value.planId,targetId:value.targetId});
  if (value.version !== 1 || typeof value.confirmedAddedToDispatched !== 'boolean' || !Array.isArray(value.expected) || value.expected[0] !== 'map') throw Error('주문 수정 원문과 확인 여부를 확인해 주세요.');
  const expected = jsonInput(value.expected) as CatalogValue;
  exact(value.edit,['kind',...(record(value.edit) && value.edit.kind==='draft'?['draft']:['items'])]);
  let edit:OrderEdit;
  if (value.edit.kind === 'draft') {
    exact(value.edit.draft,['deliveryDate','items','note','noteImportant']);
    const draft = value.edit.draft;
    if (typeof draft.deliveryDate !== 'string' || !retirementCalendarDay(draft.deliveryDate.split('T')[0]) || typeof draft.note !== 'string' || typeof draft.noteImportant !== 'boolean') throw Error('출고예정일과 주문 비고를 확인해 주세요.');
    edit = {kind:'draft',draft:{deliveryDate:draft.deliveryDate,items:normalizeItems(draft.items,true),note:draft.note,noteImportant:draft.noteImportant}};
  } else if (value.edit.kind === 'items') edit = {kind:'items',items:normalizeItems(value.edit.items,false)};
  else throw Error('주문 수정 종류를 확인해 주세요.');
  const request:OrderEditRequest = {version:1,...reference,expected,edit,confirmedAddedToDispatched:value.confirmedAddedToDispatched};
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > ORDER_EDIT_MAX_BYTES) throw Error('주문 수정 원문이 너무 큽니다.');
  return request;
}
function normalizeItems(value:unknown,positive:boolean):OrderEditItem[] {
  if (!Array.isArray(value) || positive && !value.length) throw Error('주문 품목을 확인해 주세요.');
  return value.map(raw=>{
    const row = jsonInput(raw) as Record<string,unknown>;
    if (!record(row) || typeof row.itemId !== 'string' || !row.itemId.trim() || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity)) throw Error('주문 품목과 수량을 확인해 주세요.');
    const quantity = row.isBoxUnit ? row.boxQuantity ?? row.quantity : row.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || positive && quantity <= 0) throw Error('주문 수량을 확인해 주세요.');
    return row as unknown as OrderEditItem;
  });
}
export const serializeOrderEditRequest = (value:unknown):string => JSON.stringify(normalizeOrderEditRequest(value));
export function normalizeOrderEditResult(value:unknown,reference:OrderEditReference,actorUid:string,expectedHash?:string):OrderEditResult {
  exact(value,['companyId','planId','targetId','actorUid','status','requestHash','message']);
  if (value.companyId !== reference.companyId || value.planId !== reference.planId || value.targetId !== reference.targetId || value.actorUid !== actorUid || !['applied','duplicate','rejected','cancelled','unknown'].includes(String(value.status)) || typeof value.message !== 'string') throw Error('주문 수정 응답의 회사·계정·대상을 확인해 주세요.');
  const hash = value.requestHash;
  if (!(hash === null || typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) || hash === null && !['cancelled','unknown'].includes(String(value.status)) || value.status === 'unknown' && hash !== null || expectedHash !== undefined && hash !== null && hash !== expectedHash) throw Error('최초 주문 수정 원문과 응답이 다릅니다.');
  return {...reference,actorUid,status:value.status as OrderEditResult['status'],requestHash:hash as string|null,message:value.message};
}
