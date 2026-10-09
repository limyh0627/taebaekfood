type Row = Record<string, any>;
export function advanceStatementBusiness(row: Row): Row {
 const {docNo,id,issuedAt,createdBy,issueOperationId,issuePayloadHash,issueStatementHash,issueVoucherNo,issuePrefix,...business}=row;
 return business;
}
export function assertAdvanceOperationProof(statement: Row, operation: Row, hashes: {commandHash:string;requestHash:string;statementHash:string}) {
 const meta=statement.noncashApplication as Row|undefined;
 if(!meta || operation.status!=='applied' || !['apply','cancel'].includes(String(operation.action))
  || operation.companyId!==statement.companyId || operation.partnerId!==statement.partnerId
  || operation.createdBy!==statement.createdBy || operation.statementId!==statement.id
  || operation.id!==meta.operationId || statement.issueOperationId!==operation.id
  || operation.commandHash!==hashes.commandHash
  || operation.requestHash!==hashes.requestHash
  || operation.requestHash!==statement.issuePayloadHash || operation.statementHash!==statement.issueStatementHash
  || operation.statementHash!==hashes.statementHash || operation.docNo!==statement.docNo
  || operation.issuePrefix!=='대체' || statement.issuePrefix!=='대체'
  || (meta.kind==='advance-application' ? operation.action!=='apply' : operation.action!=='cancel'))
  throw new Error('선급·선수 적용 원문과 변경 감사가 다릅니다.');
 const command=operation.command as Row;
 if(command.operationId!==operation.id||command.partnerId!==operation.partnerId||command.date!==statement.tradeDate
  ||!Number.isSafeInteger(operation.amount)||(operation.amount as number)<=0||operation.amount!==statement.totalAmount)
  throw new Error('적용 선택 요청과 저장 금액·날짜가 다릅니다.');
 if(meta.kind==='advance-application') {
  const allocations=meta.allocations as Row[];
  const allocation=allocations?.[0];
  const sourceId=(source:any)=>JSON.stringify([source?.collection,source?.id,source?.lineKey]);
  if(allocations.length!==1||!allocation||sourceId(operation.source)!==sourceId(allocation.source)
   ||sourceId(command.source)!==sourceId(allocation.source)||operation.targetStatementId!==allocation.statementId
   ||command.statementId!==allocation.statementId||command.amount!==allocation.amount||operation.amount!==allocation.amount
   ||command.accountCode!==allocation.accountCode||command.expectedSourceFingerprint!==(meta.sourceFingerprints as Row)?.[sourceId(allocation.source)]
   ||command.expectedTargetFingerprint!==(meta.targetFingerprints as Row)?.[allocation.statementId]
   ||meta.purpose!==JSON.stringify([sourceId(allocation.source),allocation.statementId]))
   throw new Error('선택한 원천·대상과 적용 감사가 다릅니다.');
 } else if(command.applicationStatementId!==meta.applicationStatementId||operation.applicationStatementId!==meta.applicationStatementId||typeof command.reason!=='string'||command.reason.trim()!==meta.reason)
  throw new Error('취소 요청과 원 적용 연결이 다릅니다.');
}
