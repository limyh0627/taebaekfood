import { normalizeBatchCommand, normalizeBatchIntent, normalizeBatchOpenResult, normalizeBatchReversalOpenResult, normalizeBatchListResult, normalizeBatchResult, serializeBatchIntent, type BatchCommand, type BatchIntent, type BatchLocator, type BatchResult } from '../../../functions/src/shared/orderProductionBatchContract';

export interface BatchScope { companyId: BatchLocator['reference']['companyId']; actorUid: string; generation: number; employeeId?: string }
export interface RetainedBatch { key: string; original: string; intent: BatchIntent; locator: BatchLocator; requestHash: string }
export interface BatchPorts {
  storage: Storage;
  current(scope: BatchScope): boolean;
  authorize(scope: BatchScope): Promise<void>;
  command(command: BatchCommand): Promise<unknown>;
  digest(text: string): Promise<string>;
  exclusive<T>(key: string, action: () => Promise<T>): Promise<T>;
}
const prefix = (scope: BatchScope) => `order-production-batch-v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const assertCurrent = (ports: BatchPorts, scope: BatchScope) => { if (!scope.actorUid || !ports.current(scope)) throw Error('회사 또는 로그인 정보가 바뀌었습니다.'); };
const keyOf = (scope: BatchScope, locator: BatchLocator) => prefix(scope) + encodeURIComponent(JSON.stringify([locator.reference.orderId, locator.reference.requestId]));

/** 요청 원문을 송신 전에 보존하며, 응답을 확인할 수 없으면 같은 요청을 확인한다. */
export function createOrderProductionBatchWrites(ports: BatchPorts) {
  const checked = async (scope: BatchScope) => { assertCurrent(ports, scope); await ports.authorize(scope); assertCurrent(ports, scope); };
  const run = <T>(scope: BatchScope, work: () => Promise<T>) => ports.exclusive(prefix(scope), async () => { await checked(scope); return work(); });
  const validateEntry = async (scope: BatchScope, entry: RetainedBatch) => {
    if (entry.key !== keyOf(scope, entry.locator) || entry.locator.originalOwnerUid !== scope.actorUid || entry.locator.reference.companyId !== scope.companyId || ports.storage.getItem(entry.key) !== entry.original) throw Error('보관된 요청이 현재 계정이나 원문과 다릅니다.');
    const intent = normalizeBatchIntent(entry.intent), canonical = serializeBatchIntent(intent);
    if (JSON.stringify(intent.reference) !== JSON.stringify(entry.locator.reference)) throw Error('보관 요청의 식별자가 다릅니다.');
    const digest = await ports.digest(canonical); assertCurrent(ports, scope);
    if (digest !== entry.requestHash || entry.original !== JSON.stringify({intent, locator:entry.locator, requestHash:digest})) throw Error('보관 요청 원문을 확인할 수 없습니다.');
  };
  const send = async (scope: BatchScope, command: BatchCommand, entry: RetainedBatch, planHash?: string): Promise<BatchResult> => {
    await validateEntry(scope, entry); await checked(scope);
    const raw = await ports.command(normalizeBatchCommand(command)); assertCurrent(ports, scope);
    const result = normalizeBatchResult(raw, entry.locator);
    if (result.preview && result.preview.action !== entry.intent.action) throw Error('서버가 확인한 작업 종류가 보관 원문과 다릅니다.');
    if (result.canApply && (result.state !== 'reserved' || !result.planHash || !result.preview)) throw Error('적용할 서버 확인 내용을 검증할 수 없습니다.');
    const claimed = result.state === 'reserved' || result.state === 'applied' || result.state === 'cancelled';
    if ((claimed && result.requestHash !== entry.requestHash) || (result.requestHash !== null && result.requestHash !== entry.requestHash)) throw Error('서버 요청 원문을 확인하지 못했습니다.');
    if (planHash && ((result.state === 'applied' && result.planHash !== planHash) || (result.planHash !== null && result.planHash !== planHash))) throw Error('서버 계획이 확인한 계획과 다릅니다.');
    return result;
  };
  return {
    async open(scope: BatchScope, orderId: string, stockOnlyItemIds: string[]) { return run(scope, async () => { const command = normalizeBatchCommand({version:1,mode:'open',companyId:scope.companyId,orderId,stockOnlyItemIds}) as Extract<BatchCommand,{mode:'open'}>; const raw = await ports.command(command); assertCurrent(ports,scope); return normalizeBatchOpenResult(raw,command); }); },
    async openReversal(scope:BatchScope,source:BatchLocator) {return run(scope,async()=>{const command=normalizeBatchCommand({version:1,mode:'open-reversal',companyId:scope.companyId,source}) as Extract<BatchCommand,{mode:'open-reversal'}>;const raw=await ports.command(command);assertCurrent(ports,scope);return normalizeBatchReversalOpenResult(raw,command);});},
    async list(scope: BatchScope, cursor?: string) { return run(scope, async () => { const command = normalizeBatchCommand({version:1,mode:'list',companyId:scope.companyId,...(cursor===undefined?{}:{cursor})}); const raw=await ports.command(command);assertCurrent(ports,scope);const result=normalizeBatchListResult(raw,scope.companyId);if(result.entries.some(entry=>entry.locator.originalOwnerUid!==scope.actorUid))throw Error('다른 계정의 요청 목록을 받을 수 없습니다.');return result; }); },
    async inspectActive(scope:BatchScope,locator:BatchLocator) {return run(scope,async()=>{if(locator.reference.companyId!==scope.companyId)throw Error('다른 회사의 요청입니다.');const command=normalizeBatchCommand({version:1,mode:'open',companyId:scope.companyId,orderId:locator.reference.orderId,stockOnlyItemIds:[]}) as Extract<BatchCommand,{mode:'open'}>;const opening=normalizeBatchOpenResult(await ports.command(command),command);assertCurrent(ports,scope);if(!opening.activeRequest||JSON.stringify(opening.activeRequest)!==JSON.stringify(locator))throw Error('이 주문의 진행 중인 요청이 바뀌었습니다.');const result=normalizeBatchResult(await ports.command(normalizeBatchCommand({version:1,mode:'inspect',locator:opening.activeRequest})),opening.activeRequest);assertCurrent(ports,scope);return result;});},
    async cancelActive(scope:BatchScope,orderId:string,observed:BatchResult) {return run(scope,async()=>{if(observed.locator.reference.companyId!==scope.companyId||observed.locator.reference.orderId!==orderId||observed.state!=='reserved'||!observed.canCancel||!observed.requestHash)throw Error('중단할 서버 요청을 먼저 확인해 주세요.');const command=normalizeBatchCommand({version:1,mode:'open',companyId:scope.companyId,orderId,stockOnlyItemIds:[]}) as Extract<BatchCommand,{mode:'open'}>;const opening=normalizeBatchOpenResult(await ports.command(command),command);assertCurrent(ports,scope);if(!opening.activeRequest||JSON.stringify(opening.activeRequest)!==JSON.stringify(observed.locator))throw Error('진행 중인 요청이 바뀌었습니다. 다시 확인해 주세요.');const check=normalizeBatchResult(await ports.command(normalizeBatchCommand({version:1,mode:'inspect',locator:opening.activeRequest})),opening.activeRequest);assertCurrent(ports,scope);if(check.state!=='reserved'||!check.canCancel||check.requestHash!==observed.requestHash)throw Error('서버 요청이 바뀌었습니다. 다시 확인해 주세요.');await checked(scope);const result=normalizeBatchResult(await ports.command(normalizeBatchCommand({version:1,mode:'cancel',locator:opening.activeRequest,expectedRequestHash:observed.requestHash})),opening.activeRequest);assertCurrent(ports,scope);if(result.requestHash!==observed.requestHash)throw Error('서버 요청 원문을 확인하지 못했습니다.');return result;});},
    async inspectRemote(scope:BatchScope,locator:BatchLocator) {return run(scope,async()=>{if(locator.originalOwnerUid!==scope.actorUid||locator.reference.companyId!==scope.companyId)throw Error('다른 계정의 요청입니다.');const command=normalizeBatchCommand({version:1,mode:'inspect',locator});const raw=await ports.command(command);assertCurrent(ports,scope);return normalizeBatchResult(raw,locator);});},
    async cancelRemote(scope:BatchScope,observed:BatchResult) {return run(scope,async()=>{const locator=observed.locator;if(locator.originalOwnerUid!==scope.actorUid||locator.reference.companyId!==scope.companyId||observed.state!=='reserved'||!observed.canCancel||!observed.requestHash)throw Error('중단할 서버 요청을 먼저 확인해 주세요.');const check=normalizeBatchResult(await ports.command(normalizeBatchCommand({version:1,mode:'inspect',locator})),locator);assertCurrent(ports,scope);if(check.state!=='reserved'||!check.canCancel||check.requestHash!==observed.requestHash)throw Error('서버 요청이 바뀌었습니다. 다시 확인해 주세요.');await checked(scope);const result=normalizeBatchResult(await ports.command(normalizeBatchCommand({version:1,mode:'cancel',locator,expectedRequestHash:observed.requestHash})),locator);assertCurrent(ports,scope);if(result.requestHash!==observed.requestHash)throw Error('서버 요청 원문을 확인하지 못했습니다.');return result;});},
    async retain(scope: BatchScope, value: BatchIntent): Promise<RetainedBatch> { return run(scope, async () => { const intent=normalizeBatchIntent(value);if(intent.reference.companyId!==scope.companyId)throw Error('다른 회사의 요청입니다.');const locator:BatchLocator={reference:intent.reference,originalOwnerUid:scope.actorUid};for(let i=0;i<ports.storage.length;i++){const existing=ports.storage.key(i);if(!existing?.startsWith(prefix(scope)))continue;let parts:unknown;try{parts=JSON.parse(decodeURIComponent(existing.slice(prefix(scope).length)))}catch{continue;}if(!Array.isArray(parts)||parts.length!==2||parts.some(part=>typeof part!=='string'))continue;if(parts[0]===intent.reference.orderId)throw Error('이 주문의 이전 요청을 먼저 확인해 주세요.');}const key=keyOf(scope,locator),requestHash=await ports.digest(serializeBatchIntent(intent));await checked(scope);if(!/^[a-f0-9]{64}$/.test(requestHash))throw Error('요청 원문 확인에 실패했습니다.');const original=JSON.stringify({intent,locator,requestHash});if(ports.storage.getItem(key)!==null)throw Error('같은 요청의 보관 원문이 이미 있습니다.');ports.storage.setItem(key,original);if(ports.storage.getItem(key)!==original)throw Error('요청 원문을 기기에 보관하지 못했습니다.');return {key,original,intent,locator,requestHash}; }); },
    async readRetained(scope: BatchScope) { return run(scope, async () => { const entries:RetainedBatch[]=[]; const issues:string[]=[]; for(let i=0;i<ports.storage.length;i++){const key=ports.storage.key(i);if(!key?.startsWith(prefix(scope)))continue;const original=ports.storage.getItem(key);if(original===null)continue;try{const parsed=JSON.parse(original);const entry:RetainedBatch={key,original,intent:parsed.intent,locator:parsed.locator,requestHash:parsed.requestHash};await validateEntry(scope,entry);entries.push(entry);}catch{assertCurrent(ports,scope);issues.push(key);}}return {entries,issues}; }); },
    async clearVerified(scope: BatchScope, entry: RetainedBatch) { return run(scope, async () => { const result=await send(scope,{version:1,mode:'inspect',locator:entry.locator},entry);if(result.state!=='applied'&&result.state!=='cancelled')throw Error('완료 또는 중단이 확인되지 않아 원문을 보존합니다.');await validateEntry(scope,entry);await checked(scope);ports.storage.removeItem(entry.key);if(ports.storage.getItem(entry.key)!==null)throw Error('보관 원문 정리를 확인하지 못했습니다.');return result; }); },
    async prepare(scope: BatchScope, entry: RetainedBatch) { return run(scope,()=>send(scope,{version:1,mode:'prepare-reserve',intent:entry.intent},entry)); },
    async apply(scope: BatchScope, entry: RetainedBatch, planHash: string) { return run(scope,()=>send(scope,{version:1,mode:'apply',locator:entry.locator,expectedPlanHash:planHash},entry,planHash)); },
    async inspect(scope: BatchScope, entry: RetainedBatch) { return run(scope,()=>send(scope,{version:1,mode:'inspect',locator:entry.locator},entry)); },
    async cancel(scope: BatchScope, entry: RetainedBatch) { return run(scope,()=>send(scope,{version:1,mode:'cancel',locator:entry.locator,expectedRequestHash:entry.requestHash},entry)); },
  };
}
export const batchDigest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))), value=>value.toString(16).padStart(2,'0')).join('');

/** 브라우저에서는 원문 잠금과 현재 로그인 권한을 매 송신마다 확인한다. */
export async function createBrowserOrderProductionBatchWrites(current:(scope:BatchScope)=>boolean) {
  const [{auth,authReady,functions},{httpsCallable}]=await Promise.all([import('../firebase'),import('firebase/functions')]);
  return createOrderProductionBatchWrites({
    storage:window.localStorage,
    current,
    async authorize(scope) {
      await authReady;
      if(!current(scope)||auth.currentUser?.uid!==scope.actorUid)throw Error('로그인 계정이 바뀌었습니다.');
      const claims=(await auth.currentUser.getIdTokenResult()).claims;
      if(!current(scope)||auth.currentUser?.uid!==scope.actorUid||claims.companyId!==scope.companyId||typeof claims.employeeId!=='string'||!claims.employeeId||(scope.employeeId!==undefined&&claims.employeeId!==scope.employeeId))throw Error('현재 회사의 직원 권한을 확인해 주세요.');
    },
    async command(command) {return (await httpsCallable(functions,'orderProductionBatchCommand')(command)).data;},
    digest:batchDigest,
    async exclusive(key,action) {if(!navigator.locks)throw Error('이 브라우저에서 보관 요청 잠금을 사용할 수 없습니다.');return navigator.locks.request(key,{mode:'exclusive'},action);},
  });
}
