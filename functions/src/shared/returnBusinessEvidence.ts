/** 최초 반품 승인과 서버 TX가 공유하는 업무 원문. 상태/처리시각은 포함하지 않는다. */
export function returnBusinessEvidence(request: Record<string, any>): Record<string, unknown> {
 const standalone=!request.linkedStatementId;
 return {companyId:request.companyId,linkedStatementId:request.linkedStatementId,partnerId:request.partnerId,returnType:request.returnType??null,totalAmount:request.totalAmount,items:request.items,...(standalone?{payableAccountCode:request.payableAccountCode??null}:{})};
}
export const canonicalReturnEvidence=(value:unknown):unknown=>Array.isArray(value)?value.map(canonicalReturnEvidence):value&&typeof value==='object'?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>[key,canonicalReturnEvidence(val)])):value;
export const returnBusinessText=(request:Record<string,any>):string=>JSON.stringify(canonicalReturnEvidence(returnBusinessEvidence(request)));
