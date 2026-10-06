# 현재 코드 필드 사전

COL 67개, 선언 필드 724개, 운영 소스 317개를 분석했다.

TypeScript가 shared/types.ts 선언으로 해석한 속성 접근만 사용처로 집계한다. any·동적 인덱스·객체 전개·별도 모델은 포함하지 않으며, 사용처 0은 삭제 근거가 아니다. JSON에 정확한 파일·행별 사용처가 있다. 현재 DB의 실제 필드나 지향 설계를 뜻하지 않는다.

## Firestore 경로 보완

SDK import·선언·수신 객체 타입으로 확인한 collection/doc/collectionGroup 호출 187건. 동적 문서 ID도 미해석으로 보존하며, 미해석 139건은 컬렉션 이름 누락과 같은 의미가 아니다. 서버 호출·중첩 경로·직접 const 별칭을 포함한다. 동적 문자열 안의 슬래시 수는 알 수 없어 깊이를 확정하지 않으며, JSON의 argumentDepthCandidate/pathKind는 인수 형태에 따른 후보이다. 함수 반환·분기·객체 전개로 구성한 경로는 해석하지 않는다. scripts·rules·테스트·JS 및 공용 래퍼 호출부의 경로 문자열은 이 운영 TS 소스 범위 밖이다. SDK 근거 없는 같은 이름 호출 0건은 JSON의 candidateCalls에 집계 밖 후보로 남긴다.

COL 밖 정적 컬렉션 이름: `appMeta`, `authLoginAttempts`, `itemUnpackMovements`, `voucherMutationOperations`. 이 목록은 운영 DB 존재/삭제 대상이 아니라 코드에 나타난 이름이다. 부모를 해석하지 못한 호출은 COL 대조에서 제외한다.

| 위치 | 실행 | API | 문맥 | 깊이 | 경로 (중괄호는 동적식) | COL 밖 |
| --- | --- | --- | --- | --- | --- | --- |
| src/shared/services/rawInventoryService.ts:167 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(command.operationId)} |  |
| src/shared/services/rawInventoryService.ts:168 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(command.operationId)} |  |
| src/shared/services/rawInventoryService.ts:169 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(command.companyId, command.rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:170 | client | doc | root / top-level-candidate | 미해석 | items/{command.rawItemId} |  |
| src/shared/services/rawInventoryService.ts:172 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:173 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:174 | client | doc | root / top-level-candidate | 미해석 | rawInventoryReversalGuards/{operationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:324 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(companyId, rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:341 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(input.companyId, input.rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:342 | client | doc | root / top-level-candidate | 미해석 | items/{input.rawItemId} |  |
| src/shared/services/firebaseService.ts:77 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/shared/services/firebaseService.ts:111 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:118 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:125 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:173 | client | doc | root / top-level-candidate | 미해석 | partners/{partnerId} |  |
| src/shared/services/firebaseService.ts:174 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:176 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-partner-${companyId}-${date}-${partnerId}-${code}`} |  |
| src/shared/services/firebaseService.ts:215 | client | doc | root / top-level-candidate | 미해석 | loanContracts/{loan.id} |  |
| src/shared/services/firebaseService.ts:216 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:217 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-loan-${companyId}-${loan.id}`} |  |
| src/shared/services/firebaseService.ts:218 | client | doc | root / top-level-candidate | 미해석 | partners/{loan.partnerId} |  |
| src/shared/services/firebaseService.ts:260 | client | collection | root / top-level | 1 | cashAccounts |  |
| src/shared/services/firebaseService.ts:262 | client | doc | root / top-level-candidate | 미해석 | cashAccounts/{account.id} |  |
| src/shared/services/firebaseService.ts:263 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:264 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-cash-${companyId}-${account.id}`} |  |
| src/shared/services/firebaseService.ts:314 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/firebaseService.ts:315 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:316 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-inventory-${companyId}-${itemId}`} |  |
| src/shared/services/firebaseService.ts:388 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:409 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:444 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:484 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:487 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:493 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:503 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:516 | client | doc | root / top-level-candidate | 미해석 | notifications/{id} |  |
| src/shared/services/firebaseService.ts:546 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{itemId} |  |
| src/shared/services/firebaseService.ts:576 | client | doc | root / top-level-candidate | 미해석 | items/{rawItemId} |  |
| src/shared/services/firebaseService.ts:596 | client | collection | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName} |  |
| src/shared/services/firebaseService.ts:615 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:618 | client | collection | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName} |  |
| src/shared/services/firebaseService.ts:630 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:640 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:655 | client | collection | root / top-level | 1 | partner_item |  |
| src/shared/services/firebaseService.ts:688 | client | collection | root / top-level | 1 | partner_item |  |
| src/shared/services/firebaseService.ts:735 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:749 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:769 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:782 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:802 | client | doc | root / top-level-candidate | 미해석 | {op.collection}/{op.id} |  |
| src/shared/services/firebaseService.ts:819 | client | doc | root / top-level-candidate | 미해석 | items/{receipt.itemId} |  |
| src/shared/services/firebaseService.ts:820 | client | doc | root / top-level-candidate | 미해석 | itemReceipts/{receipt.id} |  |
| src/shared/services/firebaseService.ts:858 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/firebaseService.ts:861 | client | collection | root / top-level | 1 | itemReceipts |  |
| src/shared/services/firebaseService.ts:863 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/firebaseService.ts:876 | client | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| src/shared/services/firebaseService.ts:876 | client | doc | root / top-level-candidate | 미해석 | itemReceipts/{`rcv-po-${encodeURIComponent(poId)}-${encodeURIComponent(line.itemId)}`} |  |
| src/shared/services/firebaseService.ts:974 | client | collection | root / top-level | 1 | itemReceipts |  |
| src/shared/services/firebaseService.ts:976 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/firebaseService.ts:979 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/firebaseService.ts:989 | client | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| src/shared/services/firebaseService.ts:1012 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:1029 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/shared/services/unpackService.ts:60 | client | doc | root / top-level-candidate | 미해석 | items/{plan.canItemId} |  |
| src/shared/services/unpackService.ts:61 | client | doc | root / top-level-candidate | 미해석 | items/{plan.bulkItemId} |  |
| src/shared/services/unpackService.ts:62 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(operationId)} |  |
| src/shared/services/unpackService.ts:80 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(bulkCompany, plan.bulkItemId)} |  |
| src/shared/services/unpackService.ts:223 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/unpackService.ts:291 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| components/AddItemModal.tsx:357 | client | doc | root / top-level-candidate | 미해석 | items/{finalProduct.id} |  |
| components/AddItemModal.tsx:372 | client | doc | root / top-level-candidate | 미해석 | items/{finalProduct.id} |  |
| src/features/admin/oemReceiptInventory.ts:53 | client | collection | root / top-level | 1 | adjustmentRequests |  |
| src/features/admin/oemReceiptInventory.ts:57 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.poId} |  |
| src/features/admin/oemReceiptInventory.ts:58 | client | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${input.poId}`} |  |
| src/features/admin/oemReceiptInventory.ts:59 | client | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| src/shared/services/rawInventoryJob.ts:54 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{input.jobId} |  |
| src/shared/services/rawInventoryJob.ts:119 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{jobId} |  |
| src/shared/services/rawInventoryJob.ts:126 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(opId)} |  |
| src/shared/services/rawInventoryJob.ts:127 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(opId)} |  |
| src/features/admin/oemIssueJob.ts:87 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.jobId} |  |
| src/features/admin/oemIssueJob.ts:129 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{draft.id} |  |
| src/features/admin/oemIssueJob.ts:141 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{draft.id} |  |
| src/shared/services/boxUnpackService.ts:20 | client | doc | root / top-level-candidate | 미해석 | items/{boxItemId} |  |
| src/shared/services/boxUnpackService.ts:21 | client | doc | root / top-level-candidate | 미해석 | items/{unitItemId} |  |
| src/shared/services/boxUnpackService.ts:22 | client | doc | root / top-level-candidate | 미해석 | itemUnpackMovements/{operationId} | itemUnpackMovements |
| src/shared/push.ts:92 | client | doc | root / top-level-candidate | 미해석 | employees/{employeeId} |  |
| src/shared/push.ts:120 | client | doc | root / top-level-candidate | 미해석 | employees/{employeeId} |  |
| src/features/admin/orderItemStock.ts:114 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/features/admin/orderItemStock.ts:204 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/features/admin/orderItemStock.ts:252 | client | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| src/features/admin/orderItemStock.ts:313 | client | doc | root / top-level-candidate | 미해석 | orders/{orderMutation.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:128 | client | doc | root / top-level-candidate | 미해석 | orderStatusAudits/{ticket.operationId} |  |
| src/features/admin/orderInventoryCancellation.ts:140 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:164 | client | doc | root / top-level-candidate | 미해석 | orders/{ticket.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:175 | client | doc | root / top-level-candidate | 미해석 | orders/{ticket.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:229 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/features/admin/orderInventoryCancellation.ts:277 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/features/admin/orderStockEngine.ts:355 | client | doc | root / top-level-candidate | 미해석 | orders/{order.id} |  |
| src/features/admin/orderStockEngine.ts:613 | client | doc | root / top-level-candidate | 미해석 | orders/{id} |  |
| src/shared/ledgerLotCheck.ts:66 | client | doc | root / top-level-candidate | 미해석 | items/{rawItemId} |  |
| src/shared/ledgerLotCheck.ts:67 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/ledgerLotCheck.ts:68 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| components/OfficeTalk.tsx:202 | client | collection | root / top-level | 1 | chatMessages |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:21 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:34 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:51 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:74 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:89 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} | appMeta |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:13 | client | doc | root / top-level-candidate | 미해석 | {write.collection}/{write.id} |  |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:16 | client | doc | root / top-level-candidate | 미해석 | {write.collection}/{write.id} |  |
| components/HaccpChecklist.tsx:509 | client | collection | root / top-level | 1 | haccp_temp |  |
| components/HaccpChecklist.tsx:514 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'temp_zones')} |  |
| components/HaccpChecklist.tsx:559 | client | doc | root / top-level-candidate | 미해석 | haccp_temp/{selected.id} |  |
| components/HaccpChecklist.tsx:570 | client | doc | root / top-level-candidate | 미해석 | haccp_temp/{selected.id} |  |
| components/HaccpChecklist.tsx:577 | client | doc | root / top-level-candidate | 미해석 | haccp_temp/{id} |  |
| components/HaccpChecklist.tsx:1069 | client | collection | root / top-level | 1 | haccp_incoming |  |
| components/HaccpChecklist.tsx:1352 | client | collection | root / top-level | 1 | haccp_cleaning |  |
| components/HaccpChecklist.tsx:1386 | client | doc | root / top-level-candidate | 미해석 | haccp_cleaning/{currentRecord.id} |  |
| components/HaccpChecklist.tsx:1395 | client | doc | root / top-level-candidate | 미해석 | haccp_cleaning/{currentRecord.id} |  |
| components/HaccpChecklist.tsx:1839 | client | collection | root / top-level | 1 | haccp_sanitation |  |
| components/HaccpChecklist.tsx:1846 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'sanitation')} |  |
| components/HaccpChecklist.tsx:1990 | client | doc | root / top-level-candidate | 미해석 | haccp_sanitation/{selected.id} |  |
| components/HaccpChecklist.tsx:2013 | client | doc | root / top-level-candidate | 미해석 | haccp_sanitation/{selected.id} |  |
| components/HaccpChecklist.tsx:2026 | client | doc | root / top-level-candidate | 미해석 | haccp_sanitation/{id} |  |
| components/HaccpChecklist.tsx:2514 | client | collection | root / top-level | 1 | haccp_personal_hygiene |  |
| components/HaccpChecklist.tsx:2521 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'personal_hygiene')} |  |
| components/HaccpChecklist.tsx:2593 | client | doc | root / top-level-candidate | 미해석 | haccp_personal_hygiene/{selected.id} |  |
| components/HaccpChecklist.tsx:2607 | client | doc | root / top-level-candidate | 미해석 | haccp_personal_hygiene/{selected.id} |  |
| components/HaccpChecklist.tsx:2614 | client | doc | root / top-level-candidate | 미해석 | haccp_personal_hygiene/{id} |  |
| components/HaccpChecklist.tsx:2865 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'personal_hygiene')} |  |
| components/HaccpChecklist.tsx:2992 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'temp_zones')} |  |
| components/HaccpChecklist.tsx:3128 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'sanitation')} |  |
| components/HaccpChecklist.tsx:3293 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'staff_tab_order')} |  |
| components/HaccpChecklist.tsx:3443 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, templateKey)} |  |
| components/HaccpChecklist.tsx:3558 | client | collection | root / top-level | 1 | haccp_periodic_sanitation |  |
| components/HaccpChecklist.tsx:3565 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'weekly_sanitation')} |  |
| components/HaccpChecklist.tsx:3574 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'monthly_sanitation')} |  |
| components/HaccpChecklist.tsx:3650 | client | doc | root / top-level-candidate | 미해석 | haccp_periodic_sanitation/{selected.id} |  |
| components/HaccpChecklist.tsx:3664 | client | doc | root / top-level-candidate | 미해석 | haccp_periodic_sanitation/{selected.id} |  |
| components/HaccpChecklist.tsx:3675 | client | doc | root / top-level-candidate | 미해석 | haccp_periodic_sanitation/{id} |  |
| components/HaccpChecklist.tsx:4003 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'closing_checklist')} |  |
| components/HaccpChecklist.tsx:4106 | client | collection | root / top-level | 1 | haccp_closing_checklist |  |
| components/HaccpChecklist.tsx:4113 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'closing_checklist')} |  |
| components/HaccpChecklist.tsx:4178 | client | doc | root / top-level-candidate | 미해석 | haccp_closing_checklist/{selected.id} |  |
| components/HaccpChecklist.tsx:4192 | client | doc | root / top-level-candidate | 미해석 | haccp_closing_checklist/{selected.id} |  |
| components/HaccpChecklist.tsx:4203 | client | doc | root / top-level-candidate | 미해석 | haccp_closing_checklist/{id} |  |
| components/HaccpChecklist.tsx:4466 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'haccp_tab_order')} |  |
| components/BenzopyreneLog.tsx:47 | client | collection | root / top-level | 1 | benzopyreneTests |  |
| components/BenzopyreneLog.tsx:77 | client | doc | root / top-level-candidate | 미해석 | benzopyreneTests/{id} |  |
| components/BenzopyreneLog.tsx:87 | client | doc | root / top-level-candidate | 미해석 | benzopyreneTests/{id} |  |
| src/features/admin/AdminApp.tsx:478 | client | collection | root / top-level | 1 | users |  |
| src/features/admin/AdminApp.tsx:547 | client | collection | root / top-level | 1 | rawInventories |  |
| src/features/admin/AdminApp.tsx:548 | client | collection | root / top-level | 1 | items |  |
| src/features/admin/AdminApp.tsx:959 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`workOrderReset_${companyId}`} | appMeta |
| src/features/admin/AdminApp.tsx:969 | client | collection | root / top-level | 1 | workOrderItems |  |
| src/features/admin/AdminApp.tsx:2070 | client | collection | root / top-level | 1 | docSheetTitles |  |
| src/features/admin/AdminApp.tsx:2726 | client | doc | root / top-level-candidate | 미해석 | {type === '입고' ? 'purchaseOrders' : 'returnRequests'}/{id} |  |
| src/features/admin/AdminApp.tsx:5059 | client | collection | root / top-level | 1 | partner_item |  |
| src/features/admin/AdminApp.tsx:5088 | client | doc | root / top-level-candidate | 미해석 | partner_item/{id} |  |
| src/shared/employeeAuth.ts:19 | client | doc | root / top-level-candidate | 미해석 | employees/{credential.user.uid} |  |
| functions/src/editIssuedStatementCommand.ts:36 | server | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| functions/src/editIssuedStatementCommand.ts:37 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{statementId} |  |
| functions/src/editIssuedStatementCommand.ts:37 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/editIssuedStatementCommand.ts:38 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{operationId} | voucherMutationOperations |
| functions/src/editIssuedStatementCommand.ts:38 | server | collection | root / top-level | 1 | voucherMutationOperations | voucherMutationOperations |
| functions/src/editIssuedStatementCommand.ts:39 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/employeeLogin.ts:32 | server | doc | root / top-level-candidate | 미해석 | authLoginAttempts/{loginKey(username, request.rawRequest.ip ?? 'unknown')} | authLoginAttempts |
| functions/src/employeeLogin.ts:32 | server | collection | root / top-level | 1 | authLoginAttempts | authLoginAttempts |
| functions/src/employeeLogin.ts:39 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:32 | server | collection | root / top-level | 1 | users |  |
| functions/src/index.ts:53 | server | collection | root / top-level | 1 | users |  |
| functions/src/index.ts:110 | server | collection | root / top-level | 1 | items |  |
| functions/src/index.ts:127 | server | doc | root / top-level-candidate | 미해석 | inventorySnapshots/{co === 'taebaek' ? `inv-snap-${yearMonth}` : `inv-snap-${co}-${yearMonth}`} |  |
| functions/src/index.ts:127 | server | collection | root / top-level | 1 | inventorySnapshots |  |
| functions/src/index.ts:162 | server | collection | root / top-level | 1 | fixedCostTemplates |  |
| functions/src/index.ts:193 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`AUTO-${id}-${ym}`} |  |
| functions/src/index.ts:193 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/index.ts:212 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/index.ts:241 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{`AUTO-${id}-${ym}`} |  |
| functions/src/index.ts:241 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/index.ts:306 | server | doc | root / top-level-candidate | 미해석 | employees/{empId} |  |
| functions/src/index.ts:306 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:333 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:376 | server | doc | root / top-level-candidate | 미해석 | chatRooms/{String(msg.roomId)} |  |
| functions/src/index.ts:376 | server | collection | root / top-level | 1 | chatRooms |  |
| functions/src/index.ts:384 | server | doc | root / top-level-candidate | 미해석 | employees/{id} |  |
| functions/src/index.ts:384 | server | collection | root / top-level | 1 | employees |  |

## 별도 모델 보완

shared/types.ts 외 interface/type alias 490개를 별도 목록에 기록한다. 직접 property만 나열하며 상속·교차/공용체·mapped type·객체 전개는 펼치지 않는다. UI 상태/요청/응답 모델도 있으므로 DB 필드로 단정하지 않는다. 이 목록의 필드는 기존 shared 선언 필드 통계와 사용처 집계에 합치지 않는다. shared/types.ts 안의 type alias도 기존 interface 전용 집계에서는 제외된다.

| 모델 | 선언 위치 | 종류 | 범위 | 직접 필드 |
| --- | --- | --- | --- | --- |
| RawUnit | src/constants/formula.ts:57 | type-alias | non-object-alias-not-expanded |  |
| AppConfirmOptions | src/shared/components/appDialog.ts:1 | interface | direct-properties-only | title, message, confirmText, cancelText, tone |
| AppPromptOptions | src/shared/components/appDialog.ts:9 | interface | direct-properties-only | title, message, defaultValue, placeholder, confirmText |
| ConfirmRequest | src/shared/components/appDialog.ts:17 | type-alias | non-object-alias-not-expanded |  |
| NoticeRequest | src/shared/components/appDialog.ts:18 | type-alias | direct-properties-only | kind, title, message, resolve |
| PromptRequest | src/shared/components/appDialog.ts:19 | type-alias | non-object-alias-not-expanded |  |
| AppDialogRequest | src/shared/components/appDialog.ts:20 | type-alias | non-object-alias-not-expanded |  |
| AlertTone | src/shared/components/AlertModalShell.tsx:21 | type-alias | non-object-alias-not-expanded |  |
| Props | src/shared/components/AlertModalShell.tsx:36 | interface | direct-properties-only | title, tone, icon, onClose, wide, children, footer |
| ConfirmModalProps | src/shared/components/ConfirmModal.tsx:13 | interface | direct-properties-only | title, tone, icon, message, subMessage, body, confirmDisabled, footerNote, confirmText, cancelText, confirmOnly, onConfirm, onCancel |
| KstDateRangeUtc | src/shared/day.ts:17 | interface | direct-properties-only | startInclusive, endExclusive |
| LineAmount | src/shared/lineAmount.ts:43 | interface | direct-properties-only | gross, supply, tax |
| Margin | src/shared/margin.ts:26 | interface | direct-properties-only | supply, cost, margin, marginRate, markupRate |
| PrintableLine | src/shared/docName.ts:44 | interface | direct-properties-only | name, spec |
| BomCostCtx | src/shared/bomCost.ts:19 | interface | direct-properties-only | allItems, formulaOf, formulaRowsOf, processingFeeOf, itemBoms |
| CostFn | src/shared/bomCost.ts:48 | interface | direct-properties-only | effective, rollup |
| CostCalcRow | src/features/admin/costCalc.ts:18 | interface | direct-properties-only | itemId, qty |
| CostCalcLine | src/features/admin/costCalc.ts:24 | interface | direct-properties-only | itemId, name, spec, unit, qty, unitCost, amount |
| CostCalcResult | src/features/admin/costCalc.ts:37 | interface | direct-properties-only | lines, cost, fee, price, margin, marginRate, markupRate |
| CategoryKey | src/shared/taxonomy.ts:19 | type-alias | non-object-alias-not-expanded |  |
| TaxonomyRow | src/shared/taxonomy.ts:47 | interface | direct-properties-only | id, kind, key, parent, label, order, hidden |
| Taxonomy | src/shared/taxonomy.ts:58 | interface | direct-properties-only | types, allTypes, labelOf, subtypesOf, categoriesOf, seeded |
| TypeKey | src/shared/itemTaxonomy.ts:88 | type-alias | non-object-alias-not-expanded |  |
| BomLine | src/shared/bomIndex.ts:19 | interface | direct-properties-only | childId, qty, child |
| BomDraftLine | src/shared/bomIndex.ts:36 | interface | direct-properties-only | childId, qty |
| BomParentLine | src/shared/bomIndex.ts:42 | interface | direct-properties-only | parentId, qty, parent |
| BomIndex | src/shared/bomIndex.ts:48 | interface | direct-properties-only |  |
| RawUsersDeps | src/shared/rawUsers.ts:28 | interface | direct-properties-only | allItems, bomOf, buildFormula, baseRawName |
| LotMixSetting | src/shared/lotUtils.ts:3 | interface | direct-properties-only | topPercent, ratios |
| ProductLotTake | src/shared/lotUtils.ts:320 | interface | direct-properties-only | lotId, lotNo, receivedDate, supplierName, qty |
| PackRow | src/shared/packIndex.ts:26 | interface | direct-properties-only | item_id, units_per_box |
| PackIndex | src/shared/packIndex.ts:31 | interface | direct-properties-only | of, size |
| BoxLike | src/shared/orderUnits.ts:7 | type-alias | non-object-alias-not-expanded |  |
| 묶음갈래 | src/shared/orderUnits.ts:37 | type-alias | non-object-alias-not-expanded |  |
| AnchorResult | src/shared/lotAnchor.ts:40 | interface | direct-properties-only | lots, deltaQty, beforeQty |
| CollectionName | src/shared/collections.ts:99 | type-alias | non-object-alias-not-expanded |  |
| StocktakeAnchor | src/shared/rawInventoryCore.ts:35 | interface | direct-properties-only | effectiveAt, operationId, sequence |
| RawInventoryState | src/shared/rawInventoryCore.ts:49 | interface | direct-properties-only | id, companyId, rawItemId, materialSnapshot, stockKg, activeLots, recentDepletedLots, stocktakeAnchor, revision, lastProcessedAt |
| LotChange | src/shared/rawInventoryCore.ts:81 | interface | direct-properties-only | lotId, supplierName, lotNo, receivedDate, deltaKg, beforeKg, afterKg, lotSnapshot |
| RawMovementKind | src/shared/rawInventoryCore.ts:98 | type-alias | non-object-alias-not-expanded |  |
| RawInventoryMovement | src/shared/rawInventoryCore.ts:109 | interface | direct-properties-only | id, operationId, commandHash, companyId, rawItemId, materialSnapshot, effectiveAt, recordedAt, sequence, kind, reportedDeltaKg, appliedDeltaKg, balanceAfterKg, targetKg, targetLotId, targetLotKg, lotChanges, source, reversalOf, stocktakeAnchorBefore, backdatedBeforeStocktake, actorId, actorName |
| ReversalGuard | src/shared/rawInventoryCore.ts:150 | interface | direct-properties-only | id, originalOperationId, reverseOperationId, companyId, rawItemId, createdAt |
| RawInventoryJob | src/shared/rawInventoryCore.ts:160 | interface | direct-properties-only | id, companyId, source, expectedOperationIds, status, lastError, createdAt, completedAt |
| RawSourceType | src/shared/rawInventoryCore.ts:176 | type-alias | non-object-alias-not-expanded |  |
| CommandBase | src/shared/rawInventoryCore.ts:182 | interface | direct-properties-only | operationId, companyId, rawItemId, materialSnapshot, effectiveAt, source, actorId, actorName, backdatedIntent |
| ReceiveLotInput | src/shared/rawInventoryCore.ts:203 | interface | direct-properties-only | supplierId, supplierName, packageType, packageKg, qtyIn, poId |
| RawInventoryCommand | src/shared/rawInventoryCore.ts:212 | type-alias | non-object-alias-not-expanded |  |
| RawRejectCode | src/shared/rawInventoryCore.ts:227 | type-alias | non-object-alias-not-expanded |  |
| RawApplyResult | src/shared/rawInventoryCore.ts:251 | type-alias | non-object-alias-not-expanded |  |
| ApplyDeterministic | src/shared/rawInventoryCore.ts:258 | interface | direct-properties-only | now, newLotId, carryOverLotId |
| LegacyLedgerFields | src/shared/services/rawInventoryService.ts:38 | interface | direct-properties-only | note, type, addedBy, orderId, canSize, canCount, canSizeTag, originalAmount, originalUnit |
| RawCommandOptions | src/shared/services/rawInventoryService.ts:144 | interface | direct-properties-only | now, newLotId, carryOverLotId, db, mirrorToItem, legacy |
| ItemReceipt | src/shared/receipt.ts:27 | interface | direct-properties-only | id, itemId, itemName, quantity, unit, partnerId, partnerName, date, poId, companyId, addedBy, createdAt |
| ReceiptResult | src/shared/receipt.ts:46 | interface | direct-properties-only | kind, baseName, kgIn |
| AutoJournalOptions | src/shared/autoJournal.ts:95 | interface | direct-properties-only | cashAccountCode |
| OpeningBalance | src/shared/autoJournal.ts:338 | interface | direct-properties-only | date, lines, capitalAccount |
| CompanyClaim | src/shared/companyWriteBoundary.ts:14 | type-alias | direct-properties-only | companyId |
| OpeningPartnerCode | src/shared/openingPartnerBalance.ts:5 | type-alias | non-object-alias-not-expanded |  |
| LoanContract | src/shared/loanLedger.ts:6 | interface | direct-properties-only | id, companyId, name, lenderName, partnerId, accountCode, openingDate, openingPrincipal, maturityDate, note, createdAt |
| LoanMovement | src/shared/loanLedger.ts:20 | interface | direct-properties-only | entry, principalDelta |
| CompanyWriteOperation | src/shared/services/firebaseService.ts:791 | type-alias | non-object-alias-not-expanded |  |
| CreateCommand | src/shared/services/employeeCommand.ts:5 | type-alias | direct-properties-only | kind, collection, data |
| ReceiveCommand | src/shared/services/employeeCommand.ts:9 | type-alias | direct-properties-only | kind, poId, actorName, items |
| UnpackPlan | src/shared/canUnpack.ts:36 | interface | direct-properties-only | canItemId, canName, cans, bulkItemId, bulkName, bulkUnit, perCan, bulkQty, discarded |
| UnpackReject | src/shared/canUnpack.ts:60 | type-alias | non-object-alias-not-expanded |  |
| UnpackResult | src/shared/canUnpack.ts:68 | type-alias | non-object-alias-not-expanded |  |
| UnpackLotMove | src/shared/unpackLots.ts:36 | interface | direct-properties-only | canLotId, lotNo, supplierName, receivedDate, cans, bulkQty |
| UnpackLotResult | src/shared/unpackLots.ts:48 | interface | direct-properties-only | canLots, bulkLots, moves, shortageQty |
| UnpackOutcome | src/shared/services/unpackService.ts:44 | interface | direct-properties-only | ok, message, moves |
| PageHeaderProps | src/shared/components/PageHeader.tsx:3 | interface | direct-properties-only | title, subtitle, right |
| OrderCreationModalHeaderProps | src/shared/components/OrderCreationModalHeader.tsx:4 | interface | direct-properties-only | currentLabel, description, onBack, onClose |
| ModalShellProps | src/shared/components/ModalShell.tsx:4 | interface | direct-properties-only | title, subtitle, onClose, children, footer, className, bodyClassName, layer, size |
| LargeModalShellProps | src/shared/components/LargeModalShell.tsx:4 | type-alias | non-object-alias-not-expanded |  |
| Line | src/shared/orderLine.ts:26 | type-alias | non-object-alias-not-expanded |  |
| GroupMark | src/shared/rowGroup.ts:19 | interface | direct-properties-only | groupId, groupName, groupFirst, groupLast |
| GroupOf | src/shared/rowGroup.ts:27 | interface | direct-properties-only | id, name |
| PriceRange | src/shared/partnerPrice.ts:40 | interface | direct-properties-only | min, max, count |
| ChannelKey | src/shared/channelStyle.ts:15 | type-alias | non-object-alias-not-expanded |  |
| ChannelStyle | src/shared/channelStyle.ts:17 | interface | direct-properties-only | icon, label, short, chip, fg, bg |
| SearchableSelectOption | src/shared/components/SearchableSelect.tsx:24 | interface | direct-properties-only | value, label |
| SearchableSelectProps | src/shared/components/SearchableSelect.tsx:29 | interface | direct-properties-only | value, onChange, options, disabled, className, searchThreshold, ariaLabel |
| CompanySettingKind | src/shared/companySettings.ts:10 | type-alias | non-object-alias-not-expanded |  |
| DeliveryTimeSlot | src/shared/deliveryTimeSlot.ts:16 | type-alias | non-object-alias-not-expanded |  |
| DeliveryOrderingDoc | src/shared/deliveryTimeSlot.ts:18 | interface | direct-properties-only | ordering, timeSlots |
| OrderActivityRow | src/shared/orderActivityLog.ts:24 | interface | direct-properties-only | at, who, what, detail, kind |
| LegacyNoteItem | src/shared/orderNote.ts:18 | type-alias | direct-properties-only | name, note, noteImportant, noteBy, noteAt |
| NoteOrder | src/shared/orderNote.ts:19 | type-alias | direct-properties-only | note, noteImportant, items |
| MigratedNoteOrder | src/shared/orderNote.ts:20 | type-alias | non-object-alias-not-expanded |  |
| ShipDeductionRow | src/shared/shipDeduction.ts:41 | interface | direct-properties-only | itemId, name, unit, qty, before, after |
| OrderListSortKey | src/shared/orderListSort.ts:21 | type-alias | non-object-alias-not-expanded |  |
| OrderListHeadSort | src/shared/orderListSort.ts:22 | interface | direct-properties-only | key, dir |
| ListFilterState | src/shared/orderListFilterChips.ts:15 | interface | direct-properties-only | dateFrom, dateTo, defaultFrom, defaultTo, filterFieldLabel, filterValue, partnerName, searchTerm, statusLabel, sortLabel, defaultSortLabel, headSort |
| ListFilterChip | src/shared/orderListFilterChips.ts:32 | interface | direct-properties-only | key, name, value |
| Props | components/OrderActivityLogModal.tsx:12 | interface | direct-properties-only | partnerName, rows, loading, error, onClose |
| StatusColumnStyle | src/shared/orderStatusStyle.ts:190 | interface | direct-properties-only | color, bgColor, borderColor, textColor |
| CalendarDayCountBadgeProps | components/CalendarDayCountBadge.tsx:3 | interface | direct-properties-only | count |
| CalendarViewProps | components/CalendarView.tsx:7 | interface | direct-properties-only | orders, onUpdateDeliveryDate, onOrderClick |
| BadgeVariant | src/shared/components/Badge.tsx:7 | type-alias | non-object-alias-not-expanded |  |
| BadgeProps | src/shared/components/Badge.tsx:17 | interface | direct-properties-only | variant, children, className |
| CompletionStatusControlProps | src/shared/components/CompletionStatusControl.tsx:4 | interface | direct-properties-only | completed, onChange, disabled, ariaLabel, title |
| ModalActionFooterProps | src/shared/components/ModalActionFooter.tsx:3 | interface | direct-properties-only | onCancel, onPrimary, primaryLabel, primaryDisabled, cancelLabel |
| OrderEditModalShellProps | components/OrderEditModalShell.tsx:5 | interface | direct-properties-only | title, partnerName, context, onClose, onSave, saveDisabled, headerAction, children |
| Props | src/shared/components/DateChipButton.tsx:17 | interface | direct-properties-only | label, value, onChange, text, disabled, block |
| CardDatePickerButtonProps | components/OrdersList.tsx:118 | interface | direct-properties-only | label, value, onChange, className, children, disabled |
| OrdersListProps | components/OrdersList.tsx:231 | interface | direct-properties-only | companyId, title, employees, subtitle, groupBy, allowedStatuses, orders, partners, items, partnerItems, palletStocks, itemBoms, onUpdateStatus, onUpdateDeliveryDate, onUpdateReceivedDate, onUpdatePallets, onUpdateItems, onUpdateNote, onUpdateDeliveryBoxes, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleShipmentComplete, onToggleItemChecked, onDeleteOrder, onAddClick, onPasteClick, currentUserName, highlightOrderId, onHighlightClear, newOrderId, onNewOrderIdClear, workOrderItems, onSetWorkOrderItems, onLoadHistoricalOrders, isLoadingHistoricalOrders, ordersMonths, onChangeOrdersMonths, embeddedListOnly, calendarSlot |
| OrderCardProps | components/OrdersList.tsx:296 | interface | direct-properties-only | order, partners, items, partnerItems, palletStocks, itemBoms, editingOrderId, setEditingOrderId, showAddProductSelect, setShowAddProductSelect, onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onUpdatePallets, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleItemChecked, onDeleteOrder, currentUserName, gridCols, isListView, tintedHeader, isHighlighted, highlightOrderId, readOnly, onEditOrder, onRequestShip |
| OrderSourceGroupProps | components/OrdersList.tsx:336 | interface | direct-properties-only | colId, source, orders, gridCols, collapsedCategories, onToggleCategory, partners, items, partnerItems, editingOrderId, setEditingOrderId, showAddProductSelect, setShowAddProductSelect, onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onToggleInvoicePrinted, onToggleItemChecked, onDeleteOrder, currentUserName, isListView, highlightOrderId, onCardClick, onEditOrder, tintedHeader |
| DeliveryRowProps | components/OrdersList.tsx:369 | interface | direct-properties-only | order, partnerName, items, onToggleInvoicePrinted, onUpdateDeliveryBoxes |
| TabType | components/OrdersList.tsx:377 | type-alias | non-object-alias-not-expanded |  |
| WorkItem | components/OrdersList.tsx:1695 | type-alias | direct-properties-only | key, orderId, itemId, lineKey, itemName, partnerName, qty, category, workGroup, groupId, groupName |
| RoleLike | src/shared/partnerRole.ts:17 | type-alias | non-object-alias-not-expanded |  |
| ProductModalProps | components/AddItemModal.tsx:19 | interface | direct-properties-only | companyId, initialData, allSubmaterials, items, partners, partnerItems, onClose, onSave, onUpsertPartnerItem, onDeletePartnerItem, onAddSubmaterial, rawItems, itemFormulas, onSaveItemFormula, rollupCostOf |
| SpecUnit | components/AddItemModal.tsx:64 | type-alias | non-object-alias-not-expanded |  |
| Props | components/RawMaterialEntryModal.tsx:8 | interface | direct-properties-only | open, mode, materials, defaultMaterial, currentUserName, lotsForMaterial, onClose, onSubmit |
| NamedItem | src/shared/itemSummary.ts:7 | interface | direct-properties-only | name |
| LedgerTrace | src/shared/ledgerTrace.ts:36 | interface | direct-properties-only | who, where, cardNo, note |
| ItemLedgerKind | src/features/admin/itemLedger.ts:29 | type-alias | non-object-alias-not-expanded |  |
| ItemInventoryEntry | src/features/admin/itemLedger.ts:32 | type-alias | non-object-alias-not-expanded |  |
| ItemLedgerRow | src/features/admin/itemLedger.ts:52 | interface | direct-properties-only | date, kind, qty, partnerName, orderId, note, balance, occurredAt, targetBalance |
| ItemLedger | src/features/admin/itemLedger.ts:66 | interface | direct-properties-only | rows, inSum, outSum, net, gap, opening, independentlyVerified, verifiedFrom |
| FilterType | components/RawLedgerList.tsx:10 | type-alias | non-object-alias-not-expanded |  |
| Props | components/RawLedgerList.tsx:13 | interface | direct-properties-only | stockMovements, entries, isAdmin, currentUserName, onDelete, showMaterial, pageSize, emptyText, allEntries, orders, linesUsingRaw |
| DayRow | components/RawLedgerList.tsx:53 | type-alias | direct-properties-only | key, date, material, received, used, adj, prev, cur, notes, who, wheres, cards, types, delIds, mine, anchor, rows, seq |
| Props | components/RawMaterialLotPanel.tsx:12 | interface | direct-properties-only | linesUsingRaw, showLedger, product, isAdmin, linkedNote, ledgerEntries, orders, 박스로트, onDeleteEntry, currentUserName, onLotChanged, focusLotId |
| LotShipment | components/ProductLotPanel.tsx:5 | interface | direct-properties-only | orderId, partnerName, date, qty |
| Props | components/ProductLotPanel.tsx:12 | interface | direct-properties-only | material, items, shipmentsByLot, emptyHint |
| TimelineRow | components/LotTimeline.tsx:9 | type-alias | direct-properties-only | id, date, title, note, businessDate, sequence, delta, balance, details, kind |
| ProcessingFee | src/features/admin/oem.ts:33 | interface | direct-properties-only | supply, tax, total |
| OemReceiptItemChange | src/features/admin/oemReceiptInventory.ts:5 | interface | direct-properties-only | itemId, qty, lot, material, unitKg |
| OemReceiptInventoryInput | src/features/admin/oemReceiptInventory.ts:13 | interface | direct-properties-only | companyId, poId, operationId, date, items, poPatch, feeRequest |
| JobCommandInput | src/shared/services/rawInventoryJob.ts:18 | interface | direct-properties-only | command, options |
| JobCommandResult | src/shared/services/rawInventoryJob.ts:23 | type-alias | direct-properties-only | input, result |
| RunJobOptions | src/shared/services/rawInventoryJob.ts:25 | interface | direct-properties-only | now, db |
| RunJobOutcome | src/shared/services/rawInventoryJob.ts:30 | interface | direct-properties-only | job, results |
| OemIssueLine | src/features/admin/oemIssueJob.ts:7 | type-alias | direct-properties-only | material, rawItemId, kg |
| OemIssueInput | src/features/admin/oemIssueJob.ts:8 | interface | direct-properties-only | jobId, companyId, partnerId, partnerName, sent, date, note, addedBy |
| OemIssueDraft | src/features/admin/oemIssueJob.ts:19 | type-alias | non-object-alias-not-expanded |  |
| OemIssuePorts | src/features/admin/oemIssueJob.ts:39 | interface | direct-properties-only | prepareDraft, runRawSteps, missingRawSteps, finalizeDraft, markFailed |
| OemFeeStatementWrite | src/features/admin/oemFeeStatement.ts:4 | interface | direct-properties-only | companyId, poId, perKg, statement |
| OemEngineDeps | src/features/admin/oemEngine.ts:31 | interface | direct-properties-only | companyId, items, partners, issueOemBatchJob, adjustRawLots, updateItem, addItem, applyOemReceiptInventory, applyOemFeeStatement, buildFormula, processingFeeCode |
| Props | components/OemManager.tsx:15 | interface | direct-properties-only | companyId, items, partners, rawStockKg, issueDrafts, issueOpen, receiveTarget, feeTarget, onClose, onIssue, onReceive, onIssueFee |
| IssueInput | components/OemManager.tsx:30 | type-alias | non-object-alias-not-expanded |  |
| Props | components/CategoryManager.tsx:14 | interface | direct-properties-only | onClose, onSaved, usage, companyId |
| StockClosingRow | components/ItemList.tsx:177 | interface | direct-properties-only | itemId, name, spec, boxSize, boxes, loose, total |
| StockClosing | components/ItemList.tsx:178 | interface | direct-properties-only | id, date, closedBy, createdAt, items, totalStock |
| ItemListProps | components/ItemList.tsx:189 | interface | direct-properties-only | mode, companyId, items, orderRequests, confirmedOrders, dispatchedQtyByItem, onUpdateItem, onAddItem, onAddOrderRequest, onRemoveOrderRequest, onUpdateOrderRequestQty, onUpdatePoItemQty, onRemovePoItem, onRequestPoEdit, onToggleConfirmRequestQty, onConfirmRequest, onConfirmRequests, onBulkAddConfirmedOrders, onConfirmAllRequests, onFinishConfirmedOrder, onUpdateConfirmedQty, onUpdatePendingFlowQty, onRemoveConfirmedOrder, onEditProduct, onDeleteItem, onAddAdjustmentRequest, inboundPartners, partners, partnerItems, rawMaterialLedger, linesUsingRaw, orders, onRequestPurchaseInvoice, onOpenVoucher, issuedStatements, onAddRawMaterialEntry, onDeleteRawMaterialEntry, onLedgerChanged, currentUser, isAdmin, onUpdateSubmaterial, receivedOrders, returnRequests, returnContent, returnBadge, oemEnabled, oemIssueDrafts, rawStockKg, onOemIssue, onOemReceive, onOemIssueFee |
| MainTab | components/ItemList.tsx:261 | type-alias | non-object-alias-not-expanded |  |
| FlowTypeFilter | components/ItemList.tsx:301 | type-alias | non-object-alias-not-expanded |  |
| FlowStatusFilter | components/ItemList.tsx:302 | type-alias | non-object-alias-not-expanded |  |
| InboundSubTab | components/ItemList.tsx:303 | type-alias | non-object-alias-not-expanded |  |
| TopTab | components/ItemList.tsx:306 | type-alias | non-object-alias-not-expanded |  |
| GroupRow | components/ItemList.tsx:1168 | type-alias | direct-properties-only | p, isChild, parentId, boxCount |
| FlowRow | components/ItemList.tsx:1480 | type-alias | direct-properties-only | key, id, type, status, date, partnerName, itemSummary, quantitySummary, source |
| GridRow | components/ItemList.tsx:3458 | type-alias | direct-properties-only | itemId, label, spec, editable, isChild, group |
| Vouchered | src/shared/statementOrders.ts:23 | type-alias | non-object-alias-not-expanded |  |
| PartnerOrdersInput | src/shared/statementOrders.ts:38 | interface | direct-properties-only | orders, partnerId, isVouchered, onlyActive, dateFrom, dateTo |
| OrderStatusDotProps | src/shared/components/OrderStatusDot.tsx:4 | interface | direct-properties-only | status, className |
| OrderItemLinesProps | src/shared/components/OrderItemLines.tsx:5 | interface | direct-properties-only | orderItems, itemById, className |
| NewOrderLineInput | src/shared/newOrderDraft.ts:6 | interface | direct-properties-only | itemId, quantity, isBoxUnit, unitsPerBox, boxType, boxSubId, displaySize, orderedAs |
| AddOrderModalProps | components/AddOrderModal.tsx:26 | interface | direct-properties-only | items, orders, partners, partnerItems, palletStocks, submaterials, onClose, onBack, onSave |
| RawExtracted | src/shared/orderExtract.ts:24 | interface | direct-properties-only | partnerId, deliveryDate, lines, note |
| ExtractedLine | src/shared/orderExtract.ts:31 | interface | direct-properties-only | itemId, name, qty, isBox, source |
| ExtractResult | src/shared/orderExtract.ts:42 | interface | direct-properties-only | partnerId, partnerName, deliveryDate, note, lines, rejected |
| CatalogItem | src/shared/orderExtract.ts:52 | interface | direct-properties-only | id, name, spec |
| CatalogPartner | src/shared/orderExtract.ts:53 | interface | direct-properties-only | id, name |
| HistoryOrder | src/shared/orderExtract.ts:172 | interface | direct-properties-only | partnerId, createdAt, items |
| ParsedLine | components/PasteOrderModal.tsx:52 | type-alias | direct-properties-only | rawText, rawName, qty, isBox, selectedProductId |
| PasteOrderModalProps | components/PasteOrderModal.tsx:102 | interface | direct-properties-only | items, partners, orders, partnerItems, palletStocks, initialText, onClose, onBack, onSave |
| Step | components/PasteOrderModal.tsx:120 | type-alias | non-object-alias-not-expanded |  |
| DeliveryGroup | src/shared/deliveryPlan.ts:33 | interface | direct-properties-only | id, name, orderIds |
| DayPlan | src/shared/deliveryPlan.ts:41 | interface | direct-properties-only | ordering, timeSlots, done, by, groups |
| DeliveryPlanDoc | src/shared/deliveryPlan.ts:55 | interface | direct-properties-only | byDate, ordering, timeSlots |
| DayRow | src/shared/deliveryPlan.ts:99 | interface | direct-properties-only | orderId, auto, slot, done, groupId, groupName, groupFirst, groupLast |
| DayListHandlers | components/DeliveryDayList.tsx:24 | interface | direct-properties-only | open, toggleDone, toggleSlot, remove, reorder, select |
| Props | components/DeliveryDayList.tsx:39 | interface | direct-properties-only | rows, orders, partners, on, compact, selected, dateStr, positionOffset |
| DeliveryManagerProps | components/DeliveryManager.tsx:44 | interface | direct-properties-only | companyId, calendarOnly, sortMode, orders, partners, items, itemBoms, partnerItems, palletStocks, currentUserName, onUpdateDeliveryDate, onUpdateStatus, onUpdateItems, onUpdateNote, onUpdatePallets, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleShipmentComplete, onToggleItemChecked, onDeleteOrder |
| PalletManagerProps | components/PalletManager.tsx:29 | interface | direct-properties-only | pallets, orders, partners, palletTransactions, onUpdatePallet, onAddPalletTransaction |
| Row | components/PalletManager.tsx:324 | type-alias | direct-properties-only | id, date, partner, pallet, type, quantity, status, note, txId |
| AdminAuthModalProps | components/AdminAuthModal.tsx:6 | interface | direct-properties-only | onClose, onSuccess, correctPassword |
| AnnualGrantInfo | src/shared/leave.ts:80 | interface | direct-properties-only | underOneYear, granted, anniversary, days |
| LeaveBalance | src/shared/leave.ts:160 | interface | direct-properties-only | monthly, annual, carryOver, bonus, granted, usedTotal, usedThisMonth, scheduled, remaining, grant |
| LeaveActor | src/shared/leave.ts:218 | interface | direct-properties-only | id, name |
| LeaveManagerProps | components/LeaveManager.tsx:41 | interface | direct-properties-only | companyId, currentUser, employees, leaveRequests, onAddLeaveRequest, onUpdateLeaveStatus, onUpdateLeave, isAdmin |
| LeaveTab | components/LeaveManager.tsx:53 | type-alias | non-object-alias-not-expanded |  |
| OrgDept | components/LeaveManager.tsx:56 | interface | direct-properties-only | id, keys, name, headId, memo, tier |
| OrgChartConfig | components/LeaveManager.tsx:64 | interface | direct-properties-only | top, departments, updatedAt |
| AdjustmentType | src/shared/adjustmentStyle.ts:9 | type-alias | non-object-alias-not-expanded |  |
| 딱지 | src/shared/adjustmentStyle.ts:12 | interface | direct-properties-only | label, cls |
| ConfirmationItemsProps | components/ConfirmationItems.tsx:12 | interface | direct-properties-only | requests, isAdmin, items, onUpdateStatus, onProcessAdjustment, onDelete |
| JournalOilRow | src/shared/salesJournal.ts:18 | interface | direct-properties-only | groupLabel, spec, 수량, 소비기한, 비고 |
| JournalSeedRow | src/shared/salesJournal.ts:27 | interface | direct-properties-only | 품목, 용량, 수량, 소비기한, 비고 |
| JournalSalesRow | src/shared/salesJournal.ts:36 | interface | direct-properties-only | 상호, 품목, 용량, 수량, 소비기한 |
| JournalExtraRow | src/shared/salesJournal.ts:45 | interface | direct-properties-only | 품목, 용량, 수량, 거래처 |
| SalesJournalData | src/shared/salesJournal.ts:52 | interface | direct-properties-only | date, oilRows, seedRows, salesRows, extraRows |
| 줄 | src/shared/orderEditGuard.ts:55 | type-alias | non-object-alias-not-expanded |  |
| OrderEditVerdict | src/shared/orderEditGuard.ts:149 | type-alias | non-object-alias-not-expanded |  |
| OrderItemChange | src/shared/orderItemDiff.ts:15 | interface | direct-properties-only | kind, name, text |
| DeviceHint | src/shared/deviceLabel.ts:16 | interface | direct-properties-only | userAgent, standalone |
| PushResult | src/shared/push.ts:27 | interface | direct-properties-only | ok, token, reason |
| RawUsageKg | src/features/admin/orderRawInventory.ts:12 | type-alias | non-object-alias-not-expanded |  |
| OrderRawInventoryDeps | src/features/admin/orderRawInventory.ts:14 | interface | direct-properties-only | actorName, allItems, partners, db, addNotification, runRawInventoryJob |
| OrderProductLotMutationResult | src/features/admin/orderProductLots.ts:4 | interface | direct-properties-only | lots, consumedLots |
| OrderProductLotMutation | src/features/admin/orderProductLots.ts:9 | interface | direct-properties-only | itemId, apply |
| OrderProductLotDeps | src/features/admin/orderProductLots.ts:14 | interface | direct-properties-only | allItems, shipQtyOf |
| OrderItemStockDeps | src/features/admin/orderItemStock.ts:7 | interface | direct-properties-only | db, allItems |
| OrderStockReservation | src/features/admin/orderItemStock.ts:16 | interface | direct-properties-only | operationId, orderId, itemIds, quantities, stockSnapshot, previousReservations, allocationQuantities, active |
| CancellationAction | src/features/admin/orderInventoryCancellation.ts:9 | type-alias | non-object-alias-not-expanded |  |
| CancellationTicket | src/features/admin/orderInventoryCancellation.ts:110 | interface | direct-properties-only | orderId, companyId, action, evidence, operationId |
| CancellationReceipt | src/features/admin/orderInventoryCancellation.ts:114 | interface | direct-properties-only | id, companyId, orderId, state, cancellation |
| CancellationResult | src/features/admin/orderInventoryCancellation.ts:118 | interface | direct-properties-only | status, operationId, code, affectedItemIds, inventoryApplied, retryable, deleted, nextStatus |
| RollbackPlan | src/features/admin/rollbackSummary.ts:15 | interface | direct-properties-only | needed, lines, text, adjustments, legacyEvidenceWarning, warnings |
| OrderDeleteAction | src/features/admin/rollbackSummary.ts:234 | type-alias | non-object-alias-not-expanded |  |
| OrderDeleteStage | src/features/admin/rollbackSummary.ts:235 | type-alias | non-object-alias-not-expanded |  |
| OrderDeleteProgress | src/features/admin/rollbackSummary.ts:238 | interface | direct-properties-only | action, state, completedStages, inventoryApplied, error, retryable |
| OrderDeletePlan | src/features/admin/rollbackSummary.ts:247 | interface | direct-properties-only | action, allowed, nextStatus, state, message, subMessage, confirmText, blockedReasons, adjustments, completedStages, inventoryApplied, retryable |
| StockUseChoice | src/features/admin/orderStockEngine.ts:24 | interface | direct-properties-only | own, loose |
| StockUsePlan | src/features/admin/orderStockEngine.ts:30 | type-alias | non-object-alias-not-expanded |  |
| OrderStatusChangeContext | src/features/admin/orderStockEngine.ts:32 | interface | direct-properties-only | approvedBy, approvedAt, approvedPlan, approvedFromStatus, orderPatch |
| PreparedOrderStatusChange | src/features/admin/orderStockEngine.ts:40 | interface | direct-properties-only | order, plan |
| OrderStockEngineDeps | src/features/admin/orderStockEngine.ts:58 | interface | direct-properties-only | actorName, allItems, submaterials, partners, allOrders, orders, db, buildFormula, createProductionRecordsForOrder, updateItem, addItem, claimOrderOperation, runRawInventoryJob |
| StockUseRow | src/features/admin/stockUseRows.ts:18 | interface | direct-properties-only | idx, itemId, name, unitLabel, ordered, stock, loose |
| StockUseRowState | src/features/admin/stockUseRows.ts:62 | interface | direct-properties-only | row, ownMax, own, shortUnits, loose |
| Props | src/features/admin/StockUseModal.tsx:18 | interface | direct-properties-only | partnerName, rows, completionLabel, onConfirm, onCancel |
| CatalogItemDeleteBlocker | src/features/admin/catalogItemDelete.ts:12 | interface | direct-properties-only | id, partnerName, status |
| CatalogItemDeletePlan | src/features/admin/catalogItemDelete.ts:18 | interface | direct-properties-only | bomIds, partnerItemIds, parentNames, ownBomCount, subMessage |
| OrderCreationIdentity | src/features/admin/orderCreation.ts:1 | interface | direct-properties-only | id, cardNo |
| OrderCreationSession | src/features/admin/orderCreation.ts:6 | interface | direct-properties-only | identity, busy |
| OrderCreationFollowUp | src/features/admin/orderCreation.ts:11 | interface | direct-properties-only | label, run |
| OrderCreationResult | src/features/admin/orderCreation.ts:16 | type-alias | non-object-alias-not-expanded |  |
| LedgerLotGap | src/shared/ledgerLotCheck.ts:19 | interface | direct-properties-only | material, ledgerKg, lotKg, gapKg |
| NoticeBoardProps | components/NoticeBoard.tsx:20 | interface | direct-properties-only | posts, companyId, onAddPost, onUpdatePost, onDeletePost |
| MonthPL | src/features/admin/financials.ts:87 | interface | direct-properties-only | sales, cogs, sgna, grossProfit, operatingProfit, otherIncome, otherExpense, netIncome |
| CashFlowDirectLine | src/features/admin/financials.ts:216 | interface | direct-properties-only | accountCode, section, inflow, outflow |
| CashFlowDirect | src/features/admin/financials.ts:222 | interface | direct-properties-only | op, inv, fin, net, opIn, opOut, invIn, invOut, finIn, finOut, lines |
| ItemManagerProps | components/ItemManager.tsx:29 | interface | direct-properties-only | companyId, items, partners, partnerItems, accountCodes, accountGroups, itemBoms, onEditProduct, onAddItem, onDeleteItem, onLinkItem, onUnlinkItem, onLinkSupplier, onUnlinkSupplier, onMergeItems, onSaveItemCustomer, onUpsertPartnerItem, onSaveServiceTerms, onCreateBoxItem, onCalcCost, costOf, isAdmin |
| ChatAttachment | src/shared/chatUpload.ts:14 | interface | direct-properties-only | url, path, name, size, type, isImage |
| PasteLike | src/shared/chatUpload.ts:57 | interface | direct-properties-only | items, files |
| SharedFileDraft | src/shared/shareInbox.ts:8 | interface | direct-properties-only | id, file, text |
| RoomNameLike | src/shared/roomName.ts:13 | interface | direct-properties-only | participantIds, name, nameBy, createdBy |
| Person | src/shared/roomName.ts:23 | interface | direct-properties-only | id, name |
| NotifyMode | src/shared/notify.ts:6 | type-alias | non-object-alias-not-expanded |  |
| NotifyVolume | src/shared/notify.ts:57 | type-alias | non-object-alias-not-expanded |  |
| NotifyOpts | src/shared/notify.ts:107 | interface | direct-properties-only | title, body, tag, mode, whenFocused, onClick, view |
| MessageAction | src/shared/messageActions.ts:9 | type-alias | non-object-alias-not-expanded |  |
| ActionCtx | src/shared/messageActions.ts:11 | interface | direct-properties-only | msg, me, isAdmin, pinned |
| Reactions | src/shared/messageReactions.ts:21 | type-alias | non-object-alias-not-expanded |  |
| TimestampLike | src/shared/officeTalkTime.ts:1 | type-alias | direct-properties-only | toDate, seconds, _seconds |
| OfficeTalkProps | components/OfficeTalk.tsx:49 | interface | direct-properties-only | currentUser, employees, chatRooms, chatMessages, initialRoomId, onRoomOpened, onAddRoom, onUpdateRoom, onDeleteRoom, onSendMessage, onUpdateMessage, isAdmin, onExtractOrder, extractedMessageIds |
| OrderLike | src/shared/newOrderAlert.ts:6 | interface | direct-properties-only | id, createdAt |
| PickOpts | src/shared/newOrderAlert.ts:8 | interface | direct-properties-only | seeded, since, mine |
| RoomLike | src/shared/newChatAlert.ts:6 | interface | direct-properties-only | id, name, nameBy, participantIds, lastMessage, lastUpdatedAt, lastReadBy |
| ChatPickOpts | src/shared/newChatAlert.ts:16 | interface | direct-properties-only | userId, openRoomId, focused |
| DocMismatch | src/shared/docOil.ts:304 | interface | direct-properties-only | date, saleKg, rawKg, diffKg, unmapped |
| DocDropReason | src/shared/docOil.ts:325 | type-alias | non-object-alias-not-expanded |  |
| DocDrop | src/shared/docOil.ts:326 | interface | direct-properties-only | date, partnerName, itemName, qty, reason |
| DropOrder | src/shared/docOil.ts:334 | interface | direct-properties-only | status, deliveredAt, partnerName, items |
| RawDocEntry | src/shared/docOil.ts:422 | interface | direct-properties-only | id, material, date, targetKg, type, note, createdAt |
| RawDocRow | src/shared/docOil.ts:434 | interface | direct-properties-only | date, received, used, adj, prevBalance, currentBalance, note, kind |
| RawDocSheet | src/shared/docOil.ts:445 | interface | direct-properties-only | rows, opening, closing, totalIn, totalOut |
| Ev | src/shared/docOil.ts:472 | type-alias | direct-properties-only | date, received, used, targetKg, note, kind, createdAt |
| PaymentInput | src/shared/payment.ts:21 | interface | direct-properties-only | partnerId, partnerName, type, amount, date, note, reverse, id, docNo, cashAccountId |
| WorkOrderItem | src/shared/hooks/useAppData.ts:22 | interface | direct-properties-only | id, key, orderId, itemId, itemName, partnerName, qty, category, sortIndex, date, lineKey, groupId, groupName |
| AppData | src/shared/hooks/useAppData.ts:46 | interface | direct-properties-only | orders, purchaseOrders, items, partnerItems, setPartnerItems, partners, employees, leaveRequests, pallets, palletTransactions, adjustmentRequests, noticePosts, chatRooms, chatMessages, rawMaterialLedger, sesameInputLedger, appNotifications, workOrderItems, issuedStatements, itemFormulas, itemBoms, itemPacks, returnRequests, itemReceipts, companyInfo, accountGroups, accountCodes, fixedCostTemplates, expensePresets, cashFlowManual, cashAccounts, cashEntries, settlements, inventorySnapshots, productionSalesLogs, pendingStatementEdits, isDataLoading, refreshStaticData, historicalOrders, loadHistoricalOrders, isLoadingHistoricalOrders, ordersMonths, setOrdersMonths |
| AdminData | src/hooks/useAdminData.ts:28 | interface | direct-properties-only | fixedCosts, productionRecords |
| StatementType | src/shared/statementLines.ts:18 | type-alias | non-object-alias-not-expanded |  |
| ManualRow | src/shared/statementLines.ts:21 | interface | direct-properties-only | itemId, name, spec, qty, price, isTaxExempt, note, accountCode, side |
| LineItem | src/shared/statementLines.ts:28 | interface | direct-properties-only | itemId, lineKind, key, no, name, spec, qty, price, supply, tax, total, isTaxExempt, accountCode, side, unknownItem, taxUnknown |
| ResolvedOrderItem | src/shared/statementLines.ts:134 | interface | direct-properties-only | product, qty, perBox, unknownItem |
| OrderLinesInput | src/shared/statementLines.ts:194 | interface | direct-properties-only | order, stmtType, allItems, partnerItems, partnerId, editablePrices, taxExemptOverrides, accountCodeOverrides |
| LineTotals | src/shared/statementLines.ts:276 | interface | direct-properties-only | isTwoSided, supply, tax, amount |
| TradeStatementIssueInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:7 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, newPo, costUpdates |
| PartnerPaymentInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:64 | type-alias | direct-properties-only | tradeDate, partnerId, direction, amount, cashAccountId, pin, allocations, note |
| StatementCommandKind | src/features/statements/domain/statementCommand.ts:21 | type-alias | non-object-alias-not-expanded |  |
| StatementCommand | src/features/statements/domain/statementCommand.ts:23 | interface | direct-properties-only | operationId, kind, statementId, expectedVersion, companyId, partnerId, partnerName, tradeDate, type, docNo, memo, orderIds, lines, partySnapshot, totals |
| StatementRejectionCode | src/features/statements/domain/statementCommand.ts:53 | type-alias | non-object-alias-not-expanded |  |
| StatementRejection | src/features/statements/domain/statementCommand.ts:60 | interface | direct-properties-only | code, lineIndexes, lineNames |
| StatementWarningCode | src/features/statements/domain/statementCommand.ts:69 | type-alias | non-object-alias-not-expanded |  |
| StatementWarning | src/features/statements/domain/statementCommand.ts:73 | interface | direct-properties-only | code, lineIndexes, lineNames |
| StatementCheck | src/features/statements/domain/statementCommand.ts:79 | interface | direct-properties-only | ok, rejections, warnings |
| BuildInput | src/features/statements/domain/statementCommand.ts:86 | interface | direct-properties-only | kind, statementId, partnerId, partnerName, tradeDate, type, docNo, memo, orderIds, lines, companyId, expectedVersion, partySnapshot |
| StatementWrite | src/features/statements/domain/statementWrites.ts:17 | interface | direct-properties-only | collection, id, data, merge |
| StatementWritePlan | src/features/statements/domain/statementWrites.ts:25 | interface | direct-properties-only | writes, afterCommit |
| PlanInput | src/features/statements/domain/statementWrites.ts:36 | interface | direct-properties-only | command, statement, costUpdates, recordedAt, actorId, poLinks, newPo |
| TaxIssueScope | src/features/tax-documents/domain/taxIssue.ts:5 | type-alias | non-object-alias-not-expanded |  |
| TaxIssuePlan | src/features/tax-documents/domain/taxIssue.ts:7 | interface | direct-properties-only | writes, statementPatches |
| CrossCompanyBom | src/shared/itemCompany.ts:7 | interface | direct-properties-only | bomId, parentId, childId, parentCompanyId, childCompanyId |
| IntegrityArea | src/features/admin/dataIntegrityAudit.ts:17 | type-alias | non-object-alias-not-expanded |  |
| IntegritySeverity | src/features/admin/dataIntegrityAudit.ts:18 | type-alias | non-object-alias-not-expanded |  |
| IntegrityIssue | src/features/admin/dataIntegrityAudit.ts:19 | interface | direct-properties-only | id, area, severity, title, detail, date, reference |
| IntegrityAuditInput | src/features/admin/dataIntegrityAudit.ts:28 | interface | direct-properties-only | companyId, dateFrom, dateTo, orders, items, itemBoms, purchaseOrders, itemReceipts, rawMaterialLedger, rawInventories, issuedStatements, productionSalesLogs |
| LedgerMovement | src/features/admin/dataIntegrityAudit.ts:53 | type-alias | non-object-alias-not-expanded |  |
| LinePOClassify | src/features/admin/dataIntegrityAudit.ts:114 | interface | direct-properties-only | isRaw, holder, baseName, expectedKg |
| RawLedgerExcelSheet | src/features/admin/rawLedgerExcel.ts:1 | interface | direct-properties-only | opening, closing, totalIn, totalOut, totalAdj, rows |
| FormulaCell | src/features/admin/rawLedgerExcel.ts:18 | type-alias | direct-properties-only | formula, result |
| RawLedgerExcelValue | src/features/admin/rawLedgerExcel.ts:19 | type-alias | non-object-alias-not-expanded |  |
| DashboardLink | components/DashboardLinks.tsx:12 | interface | direct-properties-only | id, label, url, order |
| DashboardProps | components/Dashboard.tsx:26 | interface | direct-properties-only | orders, isAdmin, items, partners, partnerItems, onNavigate, onCreatePurchaseOrder |
| StatCardProps | components/Dashboard.tsx:37 | interface | direct-properties-only | title, value, icon, trend, color, sub, onClick |
| FormulaRow | components/BomIntegrityPanel.tsx:9 | interface | direct-properties-only | parent_key, child_name, ratio, yield_rate |
| Props | components/BomIntegrityPanel.tsx:10 | interface | direct-properties-only | items, itemFormulas |
| AIConsultantProps | components/AIConsultant.tsx:6 | interface | direct-properties-only | orders, items |
| RegionSelectProps | src/shared/components/RegionSelect.tsx:33 | interface | direct-properties-only | value, onChange, className, compact |
| Window | components/AddPartnerModal.tsx:9 | interface | direct-properties-only | daum |
| AddPartnerModalProps | components/AddPartnerModal.tsx:14 | interface | direct-properties-only | onClose, onSave |
| PartnerManagerProps | components/PartnerManager.tsx:29 | interface | direct-properties-only | partners, onUpdateClient, onAddClient, onDeleteClient |
| HRManagerProps | components/HRManager.tsx:42 | interface | direct-properties-only | companyId, employees, leaveRequests, onUpdateEmployee, onAddEmployee, onDeleteEmployee, onUpdateLeaveStatus, onUpdateLeave, onDeleteLeaveRequest, onAddLeaveRequests, onCreatePayrollEntry, onCreatePayrollAccrual |
| ItemPriceManagerProps | components/ItemPriceManager.tsx:11 | interface | direct-properties-only | items, onEditProduct, onAddItem, onDeleteItem, onUpdateCost, partnerItems |
| MergedItem | src/shared/mergeStatementItems.ts:15 | interface | direct-properties-only | name, spec, qty, supply, tax, total, isTaxExempt |
| SplitMerged | src/shared/mergeStatementItems.ts:51 | interface | direct-properties-only | taxable, exempt |
| DocParty | src/shared/docParty.ts:21 | interface | direct-properties-only | name, bizNo, ceo, addr, bizType, bizItem, tel, fax |
| DocPartiesByIdInput | src/shared/docParty.ts:89 | interface | direct-properties-only | isSale, companyInfo, partners, partnerId, partnerName |
| TaxStatementProps | components/TaxStatement.tsx:19 | interface | direct-properties-only | companyId, issuedStatements, partners, companyInfo, onApplyTaxIssue |
| AdminAccessLike | src/shared/adminAccess.ts:9 | interface | direct-properties-only | id, adminAccess |
| AdminChecklistProps | components/AdminChecklist.tsx:19 | interface | direct-properties-only | leaveRequests, adjustmentRequests, employees, returnRequests, receivedOrders, partners, issuedStatements, onUpdateLeaveStatus, onUpdateAdjustmentStatus, onDeleteAdjustmentRequest, onProcessAdjustment, pendingStatementEdits, onApproveStatementEdit, onRejectStatementEdit, orderRequests, items, partnerItems, onCreatePurchaseStatement |
| TabType | components/AdminChecklist.tsx:40 | type-alias | non-object-alias-not-expanded |  |
| StatementDraftItem | components/AdminChecklist.tsx:42 | interface | direct-properties-only | name, qty, price, unit, isTaxExempt |
| ReturnStatementDraft | components/AdminChecklist.tsx:43 | interface | direct-properties-only | returnReq, partnerId, tradeDate, items |
| PartnerSignupUser | components/PartnerSignupApproval.tsx:9 | interface | direct-properties-only | id, uid, username, name, phone, email, type, status, linkedPartnerId, createdAt |
| Props | components/PartnerSignupApproval.tsx:22 | interface | direct-properties-only | partners |
| DocumentManagerProps | components/DocumentManager.tsx:17 | interface | direct-properties-only | currentUser, seed, onSelect, hideDocs |
| QuoteLineLike | src/shared/quoteTotals.ts:14 | interface | direct-properties-only | name, qty, price, cost, isTaxExempt |
| QuoteTotals | src/shared/quoteTotals.ts:31 | interface | direct-properties-only | supply, tax, total, cost, margin, marginRate, markupRate, undecided |
| ItemLike | src/shared/itemFilter.ts:8 | interface | direct-properties-only | name, spec, type, category, archived |
| FilterOption | src/shared/itemFilter.ts:16 | interface | direct-properties-only | key, label, count |
| ItemFilter | src/shared/itemFilter.ts:52 | interface | direct-properties-only | type, category, q |
| QuotationLine | components/QuotationManager.tsx:31 | interface | direct-properties-only | itemId, name, spec, unit, qty, price, cost, isTaxExempt, note |
| Quotation | components/QuotationManager.tsx:50 | interface | direct-properties-only | id, companyId, quoteNo, date, validUntil, partnerId, partnerName, recipientPhone, attention, deliveryTerms, paymentTerms, lines, totalSupply, totalTax, totalAmount, totalCost, note, createdAt, createdBy |
| Props | components/QuotationManager.tsx:80 | interface | direct-properties-only | items, partners, partnerItems, companyId, currentUser, companyInfo, costOf |
| QrLabelPrintProps | components/QrLabelPrint.tsx:7 | interface | direct-properties-only | submaterials, onClose |
| Props | components/SmartStoreAnalytics.tsx:7 | interface | direct-properties-only | orders, partners, items, onUpdateItem |
| Tab | components/SmartStoreAnalytics.tsx:14 | type-alias | non-object-alias-not-expanded |  |
| TabId | components/HaccpChecklist.tsx:111 | type-alias | non-object-alias-not-expanded |  |
| OverviewRow | components/HaccpChecklist.tsx:116 | interface | direct-properties-only | no, category, item, isOneStrike, result, note |
| DailyCheckResult | components/HaccpChecklist.tsx:247 | type-alias | non-object-alias-not-expanded |  |
| DailyCheckItem | components/HaccpChecklist.tsx:249 | interface | direct-properties-only | id, cycle, category, item, standard |
| PestRow | components/HaccpChecklist.tsx:368 | interface | direct-properties-only | date, season, location, checks, corrective, inspector |
| StorageZone | components/HaccpChecklist.tsx:473 | type-alias | direct-properties-only | name, standard |
| TempRow | components/HaccpChecklist.tsx:475 | interface | direct-properties-only | zone, temp, result, corrective, inspector |
| TempRecord | components/HaccpChecklist.tsx:483 | interface | direct-properties-only | id, date, measureTime, rows, createdBy, createdAt, updatedBy, updatedAt, revisionCount, confirmedBy, confirmedAt |
| CCPHeatRow | components/HaccpChecklist.tsx:789 | interface | direct-properties-only | date, product, batch, startTime, endTime, setTemp, measuredTemp, duration, coreTemp, result, corrective, operator, verifier |
| CCPMetalRow | components/HaccpChecklist.tsx:901 | interface | direct-properties-only | date, time, product, batch, fe, sus, feResult, susResult, productResult, corrective, operator, verifier |
| IncomingRow | components/HaccpChecklist.tsx:1029 | interface | direct-properties-only | date, inboundPartner, material, materialType, quantity, unit, lotNo, expDate, appearance, packaging, label, certAvail, result, corrective, inspector |
| IncomingRecord | components/HaccpChecklist.tsx:1047 | interface | direct-properties-only | id, month, rows, createdBy, createdAt, updatedBy, updatedAt, revisionCount, confirmedBy, confirmedAt |
| MachineCleanRow | components/HaccpChecklist.tsx:1302 | interface | direct-properties-only | date, machine, used, cleanMethod, sanitizer, result, cleaner, verifier, note |
| AreaCleanRow | components/HaccpChecklist.tsx:1314 | interface | direct-properties-only | date, area, result, sanitized, sanitizer, cleaner, note |
| CleaningRecord | components/HaccpChecklist.tsx:1324 | interface | direct-properties-only | id, month, machineRows, areaRows, createdBy, createdAt, updatedBy, updatedAt, revisionCount, confirmedBy, confirmedAt |
| SlotTime | components/HaccpChecklist.tsx:1635 | type-alias | non-object-alias-not-expanded |  |
| SanitationRow | components/HaccpChecklist.tsx:1637 | interface | direct-properties-only | result, note, inspector |
| SanitationRecord | components/HaccpChecklist.tsx:1643 | interface | direct-properties-only | id, checkDate, checkZone, checkTime, rows, specialNotes, createdBy, createdAt, updatedBy, updatedAt, revisionCount, confirmedBy, confirmedAt |
| PersonalHygieneRow | components/HaccpChecklist.tsx:2468 | interface | direct-properties-only | name, checks, note |
| PersonalHygieneRecord | components/HaccpChecklist.tsx:2473 | interface | direct-properties-only | id, checkDate, rows, inspector, createdBy, createdAt, updatedBy, updatedAt, revisionCount, confirmedBy, confirmedAt |
| PeriodCycle | components/HaccpChecklist.tsx:3395 | type-alias | non-object-alias-not-expanded |  |
| PeriodRow | components/HaccpChecklist.tsx:3397 | interface | direct-properties-only | result, note, inspector |
| PeriodRecord | components/HaccpChecklist.tsx:3403 | interface | direct-properties-only | id, cycle, period, checkZone, rows, specialNotes, createdBy, createdAt, updatedBy, updatedAt, confirmedBy, confirmedAt |
| ClosingRecord | components/HaccpChecklist.tsx:3974 | interface | direct-properties-only | id, checkDate, checkZone, rows, specialNotes, createdBy, createdAt, updatedBy, updatedAt, confirmedBy, confirmedAt |
| BenzopyreneTest | components/BenzopyreneLog.tsx:10 | interface | direct-properties-only | id, productName, receivedDate, completedDate, testItem, criteria, result, judgment, lotNo, createdAt, addedBy |
| Props | components/BenzopyreneLog.tsx:27 | interface | direct-properties-only | currentUserName, isAdmin |
| DateRangeQuick | src/shared/components/DateRangeFilter.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| ReturnManagerProps | components/ReturnManager.tsx:28 | interface | direct-properties-only | companyId, items, partners, orders, issuedStatements, currentUser, isAdmin, onProcessReturn |
| Tab | components/ReturnManager.tsx:39 | type-alias | non-object-alias-not-expanded |  |
| ReturnCardProps | components/ReturnManager.tsx:432 | interface | direct-properties-only | req, isAdmin, isProcessing, onProcess |
| ReturnTab | components/ReceivingReturnsManager.tsx:15 | type-alias | non-object-alias-not-expanded |  |
| ReceivingReturnsManagerProps | components/ReceivingReturnsManager.tsx:17 | interface | direct-properties-only | companyId, items, partnerItems, partners, orders, currentUser, isAdmin, onProcessReturn, onLinkInbound |
| ReturnCardProps | components/ReceivingReturnsManager.tsx:593 | interface | direct-properties-only | req, isAdmin, isProcessing, onProcess |
| ItemFormulaRow | components/ProductionManager.tsx:10 | type-alias | direct-properties-only | parent_key, child_name, ratio, yield_rate |
| ProductionManagerProps | components/ProductionManager.tsx:28 | interface | direct-properties-only | records, items, orders, ledger, itemFormulas, onAdd, onDelete, onUpdate, currentUserName |
| LedgerRow | src/features/admin/cashLedger.ts:13 | interface | direct-properties-only | entry, balance |
| AccountLedger | src/features/admin/cashLedger.ts:19 | interface | direct-properties-only | account, opening, rows, totalIn, totalOut, closing |
| PartnerHistorySource | src/features/admin/cashLedger.ts:155 | type-alias | non-object-alias-not-expanded |  |
| PartnerLedgerRow | src/features/admin/cashLedger.ts:258 | interface | direct-properties-only | kind, id, date, label, docNo, sourceId, time, amount, balance, source, opening |
| PartnerLedger | src/features/admin/cashLedger.ts:282 | interface | direct-properties-only | rows, opening, accrued, paid, balance |
| Ev | src/features/admin/cashLedger.ts:320 | type-alias | direct-properties-only | row, ts, order |
| PartnerCashPart | src/features/admin/cashLedger.ts:589 | interface | direct-properties-only | code, reduce, note |
| SettleState | src/features/admin/voucherMerge.ts:101 | type-alias | non-object-alias-not-expanded |  |
| SettleStatus | src/features/admin/voucherMerge.ts:103 | interface | direct-properties-only | state, label |
| EvidenceType | src/features/statements/domain/evidence.ts:18 | type-alias | non-object-alias-not-expanded |  |
| VoucherKind | src/shared/timelineRows.ts:16 | type-alias | non-object-alias-not-expanded |  |
| StmtRow | src/shared/timelineRows.ts:19 | type-alias | direct-properties-only | kind, data, cumul, dateKey, ts |
| PayRow | src/shared/timelineRows.ts:21 | type-alias | direct-properties-only | kind, partnerId, partnerName, stmtType, offset, date, amount, method, note, paymentId, cumul, dateKey, ts, src, entry |
| CashRow | src/shared/timelineRows.ts:32 | type-alias | direct-properties-only | kind, entry, dir, amount, accountCode, note, partnerName, cumul, date, ts, dateKey |
| TimelineRow | src/shared/timelineRows.ts:40 | type-alias | non-object-alias-not-expanded |  |
| TimelineFilter | src/shared/timelineRows.ts:122 | interface | direct-properties-only | from, to, kind, partner, search |
| TimelineDeps | src/shared/timelineRows.ts:133 | interface | direct-properties-only | matchAccount, codeName |
| CodeType | src/shared/timelineRows.ts:195 | type-alias | non-object-alias-not-expanded |  |
| RowClass | src/shared/timelineRows.ts:197 | interface | direct-properties-only | pl, plAmount, cash, transfer |
| TimelineTotals | src/shared/timelineRows.ts:229 | interface | direct-properties-only | stmtSum, stmtCnt, saleSum, buySum, receiveSum, receiveCnt, paySum, payCnt |
| TimelineSortColumn | src/shared/timelineColumnSort.ts:18 | type-alias | non-object-alias-not-expanded |  |
| TimelineSort | src/shared/timelineColumnSort.ts:20 | interface | direct-properties-only | column, dir |
| SortOptions | src/shared/timelineColumnSort.ts:67 | interface | direct-properties-only | textOf, signOf |
| PriceSyncLine | src/shared/partnerPriceSync.ts:25 | interface | direct-properties-only | itemId, name, price, accountCode, isTaxExempt, qty, supply |
| PriceSyncInput | src/shared/partnerPriceSync.ts:38 | interface | direct-properties-only | type, partnerId, lines, items, partnerItems, noLinkIds, isLatest |
| PriceSyncResult | src/shared/partnerPriceSync.ts:62 | interface | direct-properties-only | upserts, costUpdates |
| StatementLike | src/shared/latestStatement.ts:24 | interface | direct-properties-only | id, partnerId, type, tradeDate |
| LatestInput | src/shared/latestStatement.ts:31 | interface | direct-properties-only | this, all |
| MonthGroup | src/shared/groupByMonth.ts:10 | interface | direct-properties-only | month, rows |
| OrderPickerProps | components/OrderPicker.tsx:29 | interface | direct-properties-only | mode, pick, filter, data, on |
| PickRow | src/shared/itemPick.ts:15 | interface | direct-properties-only | product, pc |
| PickedLine | src/shared/itemPick.ts:22 | interface | direct-properties-only | itemId, name, spec, qty, price, isTaxExempt, note, accountCode |
| PickResult | src/shared/itemPick.ts:33 | interface | direct-properties-only | toAdd, unlinked |
| BuildJournalsInput | src/shared/buildJournals.ts:10 | interface | direct-properties-only | statements, cashEntries, accounts, opening, cashAccountMap, inventorySnapshots |
| BuildJournalsResult | src/shared/buildJournals.ts:20 | interface | direct-properties-only | entries, skipped |
| PartnerAnchorOpenStmt | src/features/admin/partnerAnchor.ts:34 | interface | direct-properties-only | id, date, type, remaining |
| PartnerAnchorRow | src/features/admin/partnerAnchor.ts:43 | interface | direct-properties-only | partnerId, partnerName, receivable, payable, openStmts |
| PartnerAnchor | src/features/admin/partnerAnchor.ts:54 | interface | direct-properties-only | id, companyId, year, asOf, rows, recordedAt |
| AnchorInput | src/features/admin/partnerAnchor.ts:67 | interface | direct-properties-only | journals, statements, cashEntries, settlements, nameOf |
| VoucherLedgerInput | src/features/admin/useVoucherLedger.ts:31 | interface | direct-properties-only | companyId, issuedStatements, cashEntries, settlements, accountCodes, histFrom, histTo |
| CashEditLineDraft | src/shared/cashEntryEdit.ts:15 | interface | direct-properties-only | accountCode, amount, note |
| CashEditForm | src/shared/cashEntryEdit.ts:21 | interface | direct-properties-only | amount, date, dir, accountCode, note, partnerId |
| CashModalMode | components/voucher/CashEntryModal.tsx:29 | type-alias | non-object-alias-not-expanded |  |
| SettleInput | components/voucher/CashEntryModal.tsx:34 | interface | direct-properties-only | amount, date, method, note, scope |
| Props | components/voucher/CashEntryModal.tsx:43 | interface | direct-properties-only | mode, partners, companyId, accountCodes, cashAccounts, accountId, onAccountId, partnerBalances, getBalance, latestStatement, onClose, onSettle, onSaveEdit, onDeleteEntry |
| VoucherDir | src/shared/cashTemplates.tsx:25 | type-alias | non-object-alias-not-expanded |  |
| CashTemplate | src/shared/cashTemplates.tsx:55 | interface | direct-properties-only | id, label, dir, mode, accountCode, note, wantsPartner, hint, amount, partnerId, taxExempt, partnerName, builtin, group, favorite, itemName, loanCode, loanId, vat, incomeTax, transferLines, unavailableCodes, insCorp, insEmp, principal, interest, gross, deduction |
| SplitMode | src/shared/cashTemplates.tsx:141 | type-alias | non-object-alias-not-expanded |  |
| Props | components/voucher/RecurringModal.tsx:20 | interface | direct-properties-only | companyId, templates, accountCodes, partners, isIssued, onClose, onGenerate, onCreateTemplate, onUpdateTemplate, onDeleteTemplate |
| OverKind | src/shared/interCompany.ts:33 | type-alias | non-object-alias-not-expanded |  |
| TransferInput | src/shared/interCompany.ts:35 | interface | direct-properties-only | from, to, date, amount, payableToTarget, overKind, fromAccountId, toAccountId, fromPartnerId, fromPartnerName, toPartnerId, toPartnerName, note |
| TransferSplit | src/shared/interCompany.ts:54 | interface | direct-properties-only | offset, over, overKind |
| TransferResult | src/shared/interCompany.ts:68 | interface | direct-properties-only | out, in, split |
| SplitLine | src/shared/splitEntry.ts:24 | interface | direct-properties-only | accountCode, amount, note |
| EntryBase | src/shared/splitEntry.ts:27 | type-alias | non-object-alias-not-expanded |  |
| SplitInput | src/shared/splitEntry.ts:29 | interface | direct-properties-only | lines, note, fallbackNote, base, now |
| PayrollInput | src/shared/splitEntry.ts:68 | interface | direct-properties-only | gross, deduction, salaryCode, withholdCode, note, base, now |
| Props | components/voucher/VoucherComposer.tsx:49 | interface | direct-properties-only | companyId, initialDir, initialDate, partners, accountCodes, accountGroups, cashAccounts, fixedCostTemplates, cashEntries, statements, partnerBalances, getBalance, cashAccountId, onCashAccountId, onClose, onAddCashEntry, onIssueCashEntry, onAddIssuedStatement, onAddFixedCostTemplate, onAddForCompany, recordPayment, renderJournal |
| StatementHistoryKind | src/features/statements/ui/StatementHistoryFilters.tsx:4 | type-alias | non-object-alias-not-expanded |  |
| StatementQuickRange | src/features/statements/ui/StatementHistoryFilters.tsx:5 | type-alias | non-object-alias-not-expanded |  |
| StatementOrderDateQuick | src/features/statements/ui/StatementOrderDateFilter.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| StatementAccountChoice | src/features/statements/ui/StatementHistorySearchFields.tsx:3 | type-alias | direct-properties-only | value, label, path, axis, branch, isGroup, groupId |
| StatementHistoryRowView | src/features/statements/domain/statementHistoryRowView.ts:4 | type-alias | direct-properties-only | key, kind, label, date, createdAt, owner, partner, shipTo, detail, note, amount, cumulative, isReturn |
| ExcelListColumn | src/shared/listExcel.ts:1 | type-alias | direct-properties-only | header, width, number |
| ExcelListValue | src/shared/listExcel.ts:2 | type-alias | non-object-alias-not-expanded |  |
| StatementQuickItemResult | src/features/statements/ui/StatementQuickItemBar.tsx:6 | interface | direct-properties-only | pc, product |
| Props | src/features/statements/ui/StatementQuickItemBar.tsx:11 | interface | direct-properties-only | name, spec, quantity, price, note, searchOpen, results, productCost, salePrice, unitSupply, supply, tax, marginRate, showUnitSupply, formatAmount, onNameChange, onNameFocus, onNameBlur, onSpecChange, onQuantityChange, onPriceChange, onNoteChange, onSelect, onAdd, onOpenPicker |
| StatementItemPickerRow | src/features/statements/ui/StatementItemPicker.tsx:5 | interface | direct-properties-only | pc, product |
| Props | src/features/statements/ui/StatementItemPicker.tsx:10 | interface | direct-properties-only | rows, search, quantities, priceEdits, linkedItemIds, priceSaveState, onSearchChange, onToggleItem, onQuantityChange, onPriceChange, onSavePrice, onSetTax, onClose, onConfirm |
| Props | src/features/statements/ui/StatementOrderItemRows.tsx:5 | interface | direct-properties-only | items, selectedIndex, editablePrices, accountCodes, formatAmount, onSelect, onPriceChange, onTaxChange, onAccountChange |
| StatementManualSearchResult | src/features/statements/ui/StatementManualItemRows.tsx:8 | interface | direct-properties-only | pc, product |
| Props | src/features/statements/ui/StatementManualItemRows.tsx:13 | interface | direct-properties-only | rows, readOnly, selectedIndex, activeSearchIndex, statementType, accountCodes, items, linked, formatAmount, searchResults, onSelect, onChange, onSearchFocus, onSearchBlur, onChooseProduct, onRemove |
| Props | src/features/statements/ui/StatementActionBar.tsx:4 | interface | direct-properties-only | editing, editMode, canIssue, saving, mode, issuePay, issuePayAmount, totalAmount, onIssuePayChange, onIssuePayAmountChange, onSaveEdit, onDelete, onEdit, onPrint, onIssue, onExcel |
| Props | src/features/statements/ui/StatementSettlementSummary.tsx:4 | interface | direct-properties-only | type, totalAmount, balance, formatAmount, overLabel, onSettle |
| Props | src/features/statements/ui/StatementExpensePresetRow.tsx:5 | interface | direct-properties-only | presets, managing, canAdd, canDelete, onAddRow, onCreatePreset, onDeletePreset, onToggleManaging, onAddBlankRow |
| Props | src/features/statements/ui/StatementDuplicateWarning.tsx:6 | interface | direct-properties-only | statement, formatAmount, onOpenExisting, onReissue, onClose |
| VoucherKind | src/shared/vouchers.ts:23 | type-alias | non-object-alias-not-expanded |  |
| VoucherLine | src/shared/vouchers.ts:25 | interface | direct-properties-only | accountCode, name, amount |
| Voucher | src/shared/vouchers.ts:31 | interface | direct-properties-only | id, companyId, kind, date, ts, docNo, partnerId, partnerName, memo, amount, lines, source |
| ArApSide | src/shared/timelineBuild.ts:18 | interface | direct-properties-only | side, delta |
| BuildTimelineInput | src/shared/timelineBuild.ts:20 | interface | direct-properties-only | statements, cashEntries, arapOf |
| Ev | src/shared/timelineBuild.ts:34 | type-alias | non-object-alias-not-expanded |  |
| Input | src/features/statements/hooks/useStatementTimeline.ts:15 | interface | direct-properties-only | statements, cashEntries, arapOf, from, to, kind, account, partner, search, matchAccount, codeName, sort, sortText, balanceSign, page, setPage, partnerQuery, journalBySource, accountCodes, codeType, partnerBalances |
| VoucherSlipProps | src/shared/VoucherSlip.tsx:23 | interface | direct-properties-only | je, kind, docNo, date, codeName, partnerName, headPartner, emptyMessage, className |
| Meta | src/features/statements/hooks/useStatementJournal.tsx:8 | type-alias | direct-properties-only | kind, docNo, date, headPartner |
| StatementPrintDeps | src/features/statements/infrastructure/statementPrint.ts:7 | interface | direct-properties-only | companyInfo, partners, allItems, balance |
| Input | src/features/statements/domain/statementDraft.ts:5 | interface | direct-properties-only | identity, tradeDate, type, partnerId, partnerName, orderIds, memo, totals, partySnapshot, lines, allItems |
| Input | src/features/statements/infrastructure/statementExcel.ts:4 | interface | direct-properties-only | type, docNo, dateLabel, tradeDate, partnerName, items, totals |
| QuickItemMetrics | src/features/statements/domain/quickItemModel.ts:4 | type-alias | direct-properties-only | supply, tax, marginRate, unitSupply, showUnitSupply |
| Props | components/CashLedger.tsx:19 | interface | direct-properties-only | companyId, cashAccounts, cashEntries, accountCodes, fixedCostTemplates, partners, issuedStatements, settlements, currentUser, onAddCashAccount, onUpdateCashAccount, onAddCashEntry, onDeleteCashEntry, onAddSettlement, onDeleteSettlement |
| TradeStatementProps | components/TradeStatement.tsx:88 | interface | direct-properties-only | orders, allItems, partners, partnerItems, accountCodes, accountGroups, cashAccounts, cashEntries, settlements, onAddCashEntry, onIssueCashEntry, onUpdateCashEntry, onAddSettlement, onUpdateSettlement, onDeleteCashEntry, onDeleteSettlement, onAddCashAccount, onUpdateCashAccount, fixedCostTemplates, onGenerateRecurringCosts, onAddFixedCostTemplate, onUpdateFixedCostTemplate, onDeleteFixedCostTemplate, voucherMode, embedded, issuedStatements, onUpdateStatus, onUpsertPartnerItem, onAddIssuedStatement, onApplyStatement, companyId, onAddForCompany, onUpdateIssuedStatement, onProposeEdit, focusDocNo, onFocusHandled, onDeleteIssuedStatement, pendingInvoice, onClearPendingInvoice, composerOnly, onComposerClose, confirmedOrders, orderRequests, onAddConfirmedOrder, onRemoveConfirmedOrder, onRemoveOrderRequest, companyInfo, onSaveCompanyInfo, onUpdateItemCost, onUpdateOrder, defaultTab, expensePresets, onAddExpensePreset, onDeleteExpensePreset |
| StatementType | components/TradeStatement.tsx:166 | type-alias | non-object-alias-not-expanded |  |
| Period | src/shared/ui/PeriodPicker.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| PeriodPickerProps | src/shared/ui/PeriodPicker.tsx:20 | interface | direct-properties-only | period, setPeriod, years, selectedYear, setSelectedYear, selectedQuarter, setSelectedQuarter, selectedHalf, setSelectedHalf, customStart, setCustomStart, customEnd, setCustomEnd, quarterAvailable, halfAvailable, yearlyAvailable, 당월, alwaysShowDates |
| LedgerTone | src/shared/ui/LedgerCard.tsx:22 | type-alias | non-object-alias-not-expanded |  |
| CostManagerProps | components/CostManager.tsx:6 | interface | direct-properties-only | fixedCosts, fixedCostTemplates, issuedStatements, accountCodes, onAdd, onDelete, onAddTemplate, onUpdateTemplate, onDeleteTemplate, onGenerateRecurringCosts |
| PartnerMonthlyRow | src/features/admin/partnerMonthlySettlement.ts:5 | interface | direct-properties-only | partnerId, opening, sales, cashReceived, cashRefunded, nonCashDecrease, receivableIncrease, closing, discrepancy |
| NamedSettlementRow | src/features/admin/partnerMonthlyPdf.ts:11 | type-alias | non-object-alias-not-expanded |  |
| MainTab | components/ProfitAnalysis.tsx:29 | type-alias | non-object-alias-not-expanded |  |
| ProfitAnalysisProps | components/ProfitAnalysis.tsx:31 | interface | direct-properties-only | issuedStatements, fixedCostTemplates, onAddTemplate, onUpdateTemplate, onDeleteTemplate, partners, items, costOf, onUpdateIssuedStatement, accountGroups, accountCodes, onUpdateAccountCode, onAddAccountCode, onDeleteAccountCode, onAddAccountGroup, onUpdateAccountGroup, onDeleteAccountGroup, inventorySnapshots, onSaveInventorySnapshot, onGenerateRecurringCosts, cashFlowManual, onSaveCashFlowManual, cashEntries, onAddCashEntry, settlements, companyId, initialTab |
| AccountTally | src/shared/journal.ts:35 | interface | direct-properties-only | accountCode, debit, credit |
| TrialBalanceRow | src/shared/journal.ts:60 | interface | direct-properties-only | accountCode, name, type, debit, credit, balance |
| TrialBalance | src/shared/journal.ts:65 | interface | direct-properties-only | rows, totalDebit, totalCredit, balanced |
| IncomeStatement | src/shared/journal.ts:112 | interface | direct-properties-only | revenue, expense, netIncome |
| BalanceSheet | src/shared/journal.ts:122 | interface | direct-properties-only | asset, liability, equity, netIncome, balanced |
| OpeningDoc | components/FinancialReports.tsx:17 | interface | direct-properties-only | id, date, amounts, hasLoanOpening, hasCashOpening, hasInventoryOpening |
| Props | components/FinancialReports.tsx:19 | interface | direct-properties-only | companyId, statements, cashEntries, accounts, cashAccounts, partners, items, inventorySnapshots |
| Props | components/LoanManager.tsx:16 | interface | direct-properties-only | companyId, cashEntries, cashAccounts, partners, currentUserName, onAddCashEntry |
| Props | components/PartnerLedger.tsx:14 | interface | direct-properties-only | companyId, issuedStatements, cashEntries, cashAccounts, accountCodes, settlements, onOpenVoucher |
| AdminAppProps | src/features/admin/AdminApp.tsx:240 | interface | direct-properties-only | currentUser, companyId, isAdmin, isAdminAuthenticated, onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData, onPreviewStaff, onExitPreview |
| NewOrderDraft | src/features/admin/AdminApp.tsx:1475 | type-alias | non-object-alias-not-expanded |  |
| RightRow | src/features/admin/AdminApp.tsx:3261 | type-alias | direct-properties-only | 상호, 품목, spec, 수량, 소비기한, 제조일자, orderItems |
| WRow | src/features/admin/AdminApp.tsx:3667 | type-alias | direct-properties-only | spec, 수량, mfgDate |
| UsageRow | src/features/admin/AdminApp.tsx:3971 | type-alias | direct-properties-only | date, received, used, note, type, id, createdAt, targetKg, addedBy, orderId |
| WRow | src/features/admin/AdminApp.tsx:4413 | type-alias | direct-properties-only | spec, 수량, mfgDate |
| StaffAppProps | src/features/staff/StaffApp.tsx:23 | interface | direct-properties-only | currentUser, companyId, isAdminAuthenticated, onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData, onExitPreview |
| Window | src/global.d.ts:3 | interface | direct-properties-only | __chunkErrorHandled |
| AppAlert | src/shared/components/AppAlertHost.tsx:5 | interface | direct-properties-only | id, title, message, tone |
| LoginResponse | src/shared/employeeAuth.ts:7 | type-alias | direct-properties-only | customToken, employee |
| LoginApp | src/shared/employeeAuth.ts:9 | type-alias | non-object-alias-not-expanded |  |
| AuthPageProps | src/shared/components/AuthPage.tsx:6 | interface | direct-properties-only | onLogin, app |
| PartnerPortalProps | components/PartnerPortal.tsx:18 | interface | direct-properties-only | partners, items, partnerItems, onOrderSubmit, onExit |
| Attempt | functions/src/employeeLogin.ts:12 | type-alias | direct-properties-only | failures, windowStartedAt, blockedUntil |
| 들어온것 | functions/src/extractOrder.ts:36 | interface | direct-properties-only | text, catalog, partners, history, today |

## 기존 shared 선언 필드

| 모델 | 필드 | 입력 | 선언 타입 | 선언 위치 | 정적 사용처 |
| --- | --- | --- | --- | --- | --- |
| OrderItem | lineId | 선택 | string | src/shared/types.ts:20 | 38 |
| OrderItem | itemId | 필수 | string | src/shared/types.ts:21 | 116 |
| OrderItem | name | 필수 | string | src/shared/types.ts:22 | 61 |
| OrderItem | orderedAs | 선택 | string | src/shared/types.ts:36 | 0 |
| OrderItem | quantity | 필수 | number | src/shared/types.ts:37 | 42 |
| OrderItem | price | 필수 | number | src/shared/types.ts:38 | 7 |
| OrderItem | checked | 선택 | boolean | src/shared/types.ts:39 | 37 |
| OrderItem | checkedBy | 선택 | string | src/shared/types.ts:40 | 6 |
| OrderItem | checkedAt | 선택 | string | src/shared/types.ts:41 | 5 |
| OrderItem | mfgDate | 선택 | string | src/shared/types.ts:42 | 20 |
| OrderItem | mfgBy | 선택 | string | src/shared/types.ts:43 | 2 |
| OrderItem | mfgAt | 선택 | string | src/shared/types.ts:44 | 2 |
| OrderItem | labelType | 선택 | '대기' \| '날인' \| '부착' | src/shared/types.ts:45 | 13 |
| OrderItem | labelBy | 선택 | string | src/shared/types.ts:52 | 2 |
| OrderItem | labelAt | 선택 | string | src/shared/types.ts:53 | 2 |
| OrderItem | isBoxUnit | 선택 | boolean | src/shared/types.ts:54 | 26 |
| OrderItem | boxQuantity | 선택 | number | src/shared/types.ts:55 | 24 |
| OrderItem | unitsPerBox | 선택 | number | src/shared/types.ts:56 | 7 |
| OrderItem | boxType | 선택 | string | src/shared/types.ts:57 | 2 |
| OrderItem | boxSubId | 선택 | string | src/shared/types.ts:58 | 1 |
| OrderItem | displaySize | 선택 | string | src/shared/types.ts:59 | 5 |
| OrderPallet | type | 필수 | string | src/shared/types.ts:63 | 16 |
| OrderPallet | quantity | 필수 | number | src/shared/types.ts:64 | 17 |
| OrderPallet | isExchange | 선택 | boolean | src/shared/types.ts:65 | 7 |
| DeliveryBox | itemId | 필수 | string | src/shared/types.ts:69 | 3 |
| DeliveryBox | name | 필수 | string | src/shared/types.ts:70 | 1 |
| DeliveryBox | quantity | 필수 | number | src/shared/types.ts:71 | 2 |
| PurchaseItem | id | 필수 | string | src/shared/types.ts:90 | 0 |
| PurchaseItem | name | 필수 | string | src/shared/types.ts:91 | 0 |
| ShipTo | id | 필수 | string | src/shared/types.ts:102 | 17 |
| ShipTo | name | 필수 | string | src/shared/types.ts:103 | 12 |
| ShipTo | archived | 선택 | boolean | src/shared/types.ts:105 | 11 |
| PartnerItem | id | 필수 | string | src/shared/types.ts:109 | 25 |
| PartnerItem | itemId | 필수 | string | src/shared/types.ts:110 | 68 |
| PartnerItem | partnerId | 필수 | string | src/shared/types.ts:111 | 60 |
| PartnerItem | Direction | 필수 | 'in' \| 'out' | src/shared/types.ts:112 | 26 |
| PartnerItem | price | 선택 | number | src/shared/types.ts:113 | 29 |
| PartnerItem | Account_Code | 선택 | string | src/shared/types.ts:114 | 13 |
| PartnerItem | taxType | 선택 | '과세' \| '면세' \| null | src/shared/types.ts:123 | 21 |
| PartnerItem | shipToIds | 선택 | string[] | src/shared/types.ts:137 | 1 |
| PartnerItem | isSmartStore | 선택 | boolean | src/shared/types.ts:138 | 0 |
| PartnerItem | boxTypeId | 선택 | string | src/shared/types.ts:140 | 4 |
| PartnerItem | qtyPerBox | 선택 | number | src/shared/types.ts:141 | 2 |
| PartnerItem | qty_per_box | 선택 | number | src/shared/types.ts:142 | 0 |
| PartnerItem | tapeTypeId | 선택 | string | src/shared/types.ts:143 | 2 |
| PartnerItem | displaySize | 선택 | string | src/shared/types.ts:144 | 0 |
| PartnerItem | packageType | 선택 | string | src/shared/types.ts:145 | 0 |
| PartnerItem | containerTypeId | 선택 | string | src/shared/types.ts:146 | 0 |
| PartnerItem | labelId | 선택 | string | src/shared/types.ts:147 | 0 |
| PartnerItem | weightInKg | 선택 | number | src/shared/types.ts:148 | 0 |
| Partner | shipTos | 선택 | ShipTo[] | src/shared/types.ts:160 | 5 |
| Partner | id | 필수 | string | src/shared/types.ts:161 | 195 |
| Partner | name | 필수 | string | src/shared/types.ts:162 | 183 |
| Partner | email | 선택 | string | src/shared/types.ts:163 | 4 |
| Partner | phone | 선택 | string | src/shared/types.ts:164 | 6 |
| Partner | type | 필수 | PartnerChannel | src/shared/types.ts:165 | 28 |
| Partner | region | 선택 | string | src/shared/types.ts:166 | 8 |
| Partner | address | 선택 | string | src/shared/types.ts:167 | 10 |
| Partner | addressDetail | 선택 | string | src/shared/types.ts:168 | 8 |
| Partner | ownerName | 선택 | string | src/shared/types.ts:169 | 6 |
| Partner | bizNo | 선택 | string | src/shared/types.ts:170 | 6 |
| Partner | tel | 선택 | string | src/shared/types.ts:171 | 7 |
| Partner | mobile | 선택 | string | src/shared/types.ts:172 | 7 |
| Partner | fax | 선택 | string | src/shared/types.ts:173 | 2 |
| Partner | note | 선택 | string | src/shared/types.ts:174 | 3 |
| Partner | partnerType | 선택 | PartnerType | src/shared/types.ts:175 | 7 |
| Partner | companyId | 선택 | CompanyId | src/shared/types.ts:182 | 1 |
| Partner | isOemFactory | 선택 | boolean | src/shared/types.ts:183 | 1 |
| Partner | purchaseItems | 선택 | PurchaseItem[] | src/shared/types.ts:184 | 0 |
| OrderRawInventoryTrace | material | 필수 | string | src/shared/types.ts:217 | 8 |
| OrderRawInventoryTrace | rawItemId | 선택 | string | src/shared/types.ts:219 | 8 |
| OrderRawInventoryTrace | operationId | 선택 | string | src/shared/types.ts:221 | 14 |
| OrderRawInventoryTrace | ledgerId | 선택 | string | src/shared/types.ts:223 | 1 |
| OrderRawInventoryTrace | ledgerOnly | 선택 | boolean | src/shared/types.ts:225 | 5 |
| OrderRawInventoryTrace | lotId | 선택 | string | src/shared/types.ts:226 | 1 |
| OrderRawInventoryTrace | lotNo | 선택 | string | src/shared/types.ts:227 | 3 |
| OrderRawInventoryTrace | supplierName | 필수 | string | src/shared/types.ts:228 | 3 |
| OrderRawInventoryTrace | receivedDate | 선택 | string | src/shared/types.ts:229 | 3 |
| OrderRawInventoryTrace | kg | 필수 | number | src/shared/types.ts:230 | 9 |
| Order | id | 필수 | string | src/shared/types.ts:234 | 249 |
| Order | companyId | 선택 | CompanyId | src/shared/types.ts:236 | 0 |
| Order | cardNo | 선택 | string | src/shared/types.ts:247 | 4 |
| Order | createdBy | 선택 | string | src/shared/types.ts:252 | 1 |
| Order | sourceChatMessageId | 선택 | string | src/shared/types.ts:254 | 1 |
| Order | partnerId | 선택 | string | src/shared/types.ts:255 | 57 |
| Order | partnerName | 필수 | string | src/shared/types.ts:256 | 89 |
| Order | items | 필수 | OrderItem[] | src/shared/types.ts:257 | 144 |
| Order | note | 선택 | string | src/shared/types.ts:259 | 14 |
| Order | noteImportant | 선택 | boolean | src/shared/types.ts:260 | 4 |
| Order | noteBy | 선택 | string | src/shared/types.ts:261 | 2 |
| Order | noteAt | 선택 | string | src/shared/types.ts:262 | 2 |
| Order | totalAmount | 필수 | number | src/shared/types.ts:263 | 0 |
| Order | status | 필수 | OrderStatus | src/shared/types.ts:264 | 129 |
| Order | createdAt | 필수 | string | src/shared/types.ts:265 | 54 |
| Order | deliveryDate | 필수 | string | src/shared/types.ts:266 | 58 |
| Order | email | 필수 | string | src/shared/types.ts:267 | 0 |
| Order | source | 필수 | OrderSource | src/shared/types.ts:268 | 33 |
| Order | pallets | 선택 | OrderPallet[] | src/shared/types.ts:269 | 20 |
| Order | region | 선택 | string | src/shared/types.ts:270 | 0 |
| Order | shipToId | 선택 | string | src/shared/types.ts:278 | 5 |
| Order | deliveryBoxes | 선택 | DeliveryBox[] | src/shared/types.ts:279 | 10 |
| Order | shipMethod | 선택 | ShipMethod \| '직접수령' | src/shared/types.ts:281 | 0 |
| Order | invoicePrinted | 선택 | boolean | src/shared/types.ts:282 | 16 |
| Order | invoiceStage | 선택 | 'printed' \| 'attached' | src/shared/types.ts:291 | 2 |
| Order | invoiceType | 선택 | InvoiceType | src/shared/types.ts:293 | 2 |
| Order | shipmentConfirmedBy | 선택 | string \| null | src/shared/types.ts:294 | 3 |
| Order | shipmentConfirmedAt | 선택 | string \| null | src/shared/types.ts:295 | 5 |
| Order | deliveredAt | 선택 | string | src/shared/types.ts:296 | 13 |
| Order | documentDate | 선택 | string | src/shared/types.ts:297 | 0 |
| Order | accountingExcluded | 선택 | boolean | src/shared/types.ts:303 | 3 |
| Order | accountingExclusionReason | 선택 | string | src/shared/types.ts:304 | 2 |
| Order | accountingExcludedAt | 선택 | string | src/shared/types.ts:305 | 0 |
| Order | accountingExcludedBy | 선택 | string | src/shared/types.ts:306 | 0 |
| Order | rawLotsDeducted | 선택 | boolean | src/shared/types.ts:307 | 3 |
| Order | rawConsumedLots | 선택 | OrderRawInventoryTrace[] | src/shared/types.ts:308 | 17 |
| Order | rawInventoryAttempt | 선택 | number | src/shared/types.ts:310 | 4 |
| Order | productConsumedLots | 선택 | { itemId: string; material?: string; lotId?: string; lotNo?: string; receivedDate?: string; qty: number }[] | src/shared/types.ts:316 | 8 |
| Order | autoBuilt | 선택 | { itemId: string; qty: number }[] | src/shared/types.ts:317 | 11 |
| Order | producedUnits | 선택 | { itemId: string; qty: number }[] | src/shared/types.ts:318 | 13 |
| Order | producedAt | 선택 | string | src/shared/types.ts:320 | 20 |
| Order | shippedOut | 선택 | boolean | src/shared/types.ts:321 | 15 |
| Order | inventorySnapshots | 선택 | {     version: 1;     production?: OrderInventorySnapshot;     shipment?: OrderInventorySnapshot;   } | src/shared/types.ts:326 | 25 |
| Order | itemInventory | 선택 | Record<string, OrderItemInventoryState> | src/shared/types.ts:336 | 15 |
| Order | inventoryOperation | 선택 | {     id: string;     /** 품목 한 줄은 결정적 원료 작업번호로 중단 지점부터 재개할 수 있다. */     kind?: 'line' \| 'status';     lineId?: string;     stage?: 'claim' \| 'reservation' \| 'raw-inventory' \| 'production-record' \| 'final-stock';     targetStatus: OrderStatus;     state: 'processing' \| 'failed';     startedAt: string;     actor: string;     error?: string;   } \| null | src/shared/types.ts:338 | 12 |
| OrderItemInventoryState | version | 필수 | 1 | src/shared/types.ts:353 | 0 |
| OrderItemInventoryState | lineId | 필수 | string | src/shared/types.ts:354 | 0 |
| OrderItemInventoryState | itemId | 필수 | string | src/shared/types.ts:355 | 1 |
| OrderItemInventoryState | applied | 필수 | boolean | src/shared/types.ts:356 | 11 |
| OrderItemInventoryState | attempt | 필수 | number | src/shared/types.ts:357 | 3 |
| OrderItemInventoryState | completedAt | 선택 | string | src/shared/types.ts:358 | 6 |
| OrderItemInventoryState | reversedAt | 선택 | string | src/shared/types.ts:359 | 0 |
| OrderItemInventoryState | rawConsumedLots | 필수 | OrderRawInventoryTrace[] | src/shared/types.ts:360 | 8 |
| OrderItemInventoryState | autoBuilt | 필수 | { itemId: string; qty: number }[] | src/shared/types.ts:361 | 4 |
| OrderItemInventoryState | producedUnits | 필수 | { itemId: string; qty: number }[] | src/shared/types.ts:362 | 4 |
| OrderItemInventoryState | production | 필수 | OrderInventorySnapshot | src/shared/types.ts:363 | 13 |
| OrderInventoryAdjustment | itemId | 필수 | string | src/shared/types.ts:367 | 18 |
| OrderInventoryAdjustment | delta | 필수 | number | src/shared/types.ts:368 | 14 |
| OrderInventorySnapshot | capturedAt | 필수 | string | src/shared/types.ts:372 | 13 |
| OrderInventorySnapshot | stockDeltas | 필수 | OrderInventoryAdjustment[] | src/shared/types.ts:373 | 19 |
| OrderInventorySnapshot | bomLines | 필수 | { parentItemId: string; childItemId: string; quantity: number }[] | src/shared/types.ts:374 | 3 |
| OrderInventorySnapshot | rawConsumedLots | 선택 | Order['rawConsumedLots'] | src/shared/types.ts:375 | 10 |
| OrderInventorySnapshot | productConsumedLots | 선택 | Order['productConsumedLots'] | src/shared/types.ts:376 | 2 |
| OrderInventorySnapshot | rawLedgerIds | 선택 | string[] | src/shared/types.ts:377 | 4 |
| OrderStatusAudit | id | 필수 | string | src/shared/types.ts:381 | 0 |
| OrderStatusAudit | orderId | 필수 | string | src/shared/types.ts:382 | 0 |
| OrderStatusAudit | partnerName | 필수 | string | src/shared/types.ts:383 | 0 |
| OrderStatusAudit | previousStatus | 필수 | OrderStatus | src/shared/types.ts:384 | 1 |
| OrderStatusAudit | nextStatus | 필수 | OrderStatus | src/shared/types.ts:385 | 1 |
| OrderStatusAudit | approvedBy | 필수 | string | src/shared/types.ts:386 | 1 |
| OrderStatusAudit | approvedAt | 필수 | string | src/shared/types.ts:387 | 1 |
| OrderStatusAudit | completedAt | 선택 | string | src/shared/types.ts:388 | 1 |
| OrderStatusAudit | state | 필수 | 'processing' \| 'completed' \| 'failed' | src/shared/types.ts:389 | 3 |
| OrderStatusAudit | legacyEvidenceWarning | 필수 | boolean | src/shared/types.ts:390 | 1 |
| OrderStatusAudit | stockAdjustments | 필수 | Array<OrderInventoryAdjustment & { name: string; unit: string }> | src/shared/types.ts:391 | 1 |
| OrderStatusAudit | error | 선택 | string | src/shared/types.ts:392 | 1 |
| OrderItemEdit | id | 필수 | string | src/shared/types.ts:402 | 0 |
| OrderItemEdit | orderId | 필수 | string | src/shared/types.ts:403 | 0 |
| OrderItemEdit | at | 필수 | string | src/shared/types.ts:404 | 1 |
| OrderItemEdit | by | 필수 | string | src/shared/types.ts:405 | 1 |
| OrderItemEdit | changes | 필수 | string[] | src/shared/types.ts:407 | 1 |
| BoxConfig | boxType | 필수 | string | src/shared/types.ts:411 | 0 |
| BoxConfig | unitsPerBox | 필수 | number | src/shared/types.ts:412 | 0 |
| BoxConfig | boxSubId | 선택 | string | src/shared/types.ts:413 | 0 |
| ClientBoxConfig | partnerId | 필수 | string | src/shared/types.ts:417 | 0 |
| ClientBoxConfig | configs | 필수 | BoxConfig[] | src/shared/types.ts:418 | 0 |
| SubmaterialComponent | id | 필수 | string | src/shared/types.ts:422 | 13 |
| SubmaterialComponent | name | 필수 | string | src/shared/types.ts:423 | 2 |
| SubmaterialComponent | category | 필수 | InventoryCategory \| string | src/shared/types.ts:424 | 0 |
| SubmaterialComponent | stock | 필수 | number | src/shared/types.ts:425 | 8 |
| SubmaterialComponent | unit | 필수 | string | src/shared/types.ts:426 | 1 |
| SubmaterialComponent | spec | 선택 | string | src/shared/types.ts:427 | 0 |
| SubmaterialComponent | cost | 선택 | number | src/shared/types.ts:428 | 0 |
| SubmaterialComponent | qrCode | 선택 | string | src/shared/types.ts:429 | 0 |
| ItemInventoryReservation | operationId | 필수 | string | src/shared/types.ts:477 | 2 |
| ItemInventoryReservation | orderId | 필수 | string | src/shared/types.ts:478 | 9 |
| ItemInventoryReservation | qty | 필수 | number | src/shared/types.ts:479 | 7 |
| ItemInventoryReservation | createdAt | 필수 | string | src/shared/types.ts:480 | 1 |
| ItemInventoryReservation | state | 필수 | 'processing' \| 'allocated' | src/shared/types.ts:482 | 3 |
| ItemStocktakeAnchor | id | 필수 | string | src/shared/types.ts:486 | 4 |
| ItemStocktakeAnchor | date | 필수 | string | src/shared/types.ts:487 | 3 |
| ItemStocktakeAnchor | createdAt | 필수 | string | src/shared/types.ts:488 | 2 |
| ItemStocktakeAnchor | targetQty | 필수 | number | src/shared/types.ts:489 | 1 |
| ItemStocktakeAnchor | beforeQty | 필수 | number | src/shared/types.ts:490 | 1 |
| ItemStocktakeAnchor | deltaQty | 필수 | number | src/shared/types.ts:491 | 0 |
| ItemStocktakeAnchor | note | 선택 | string | src/shared/types.ts:492 | 1 |
| Item | id | 필수 | string | src/shared/types.ts:497 | 669 |
| Item | companyId | 선택 | CompanyId | src/shared/types.ts:509 | 0 |
| Item | name | 필수 | string | src/shared/types.ts:510 | 295 |
| Item | sku | 선택 | string | src/shared/types.ts:511 | 1 |
| Item | type | 필수 | InventoryCategory \| string | src/shared/types.ts:513 | 130 |
| Item | category | 선택 | ItemSubtype \| string | src/shared/types.ts:514 | 37 |
| Item | subtype | 선택 | string | src/shared/types.ts:515 | 20 |
| Item | itemType | 선택 | ProductStage | src/shared/types.ts:516 | 0 |
| Item | cost | 선택 | number | src/shared/types.ts:517 | 23 |
| Item | costSource | 선택 | 'rollup' \| 'manual' | src/shared/types.ts:526 | 2 |
| Item | lotsAreTotal | 선택 | never | src/shared/types.ts:555 | 0 |
| Item | stock | 필수 | number | src/shared/types.ts:557 | 67 |
| Item | inventoryReservations | 선택 | ItemInventoryReservation[] | src/shared/types.ts:559 | 4 |
| Item | stocktakeAnchors | 선택 | ItemStocktakeAnchor[] | src/shared/types.ts:561 | 5 |
| Item | density | 선택 | number | src/shared/types.ts:567 | 15 |
| Item | wipStock | 선택 | number | src/shared/types.ts:568 | 0 |
| Item | finishedStock | 선택 | number | src/shared/types.ts:569 | 0 |
| Item | minStock | 필수 | number | src/shared/types.ts:570 | 22 |
| Item | unit | 필수 | string | src/shared/types.ts:571 | 106 |
| Item | image | 필수 | string | src/shared/types.ts:572 | 3 |
| Item | imagePath | 선택 | string | src/shared/types.ts:574 | 5 |
| Item | oil | 선택 | string | src/shared/types.ts:575 | 4 |
| Item | partnerId | 선택 | string | src/shared/types.ts:576 | 1 |
| Item | partnerIds | 선택 | string[] | src/shared/types.ts:577 | 1 |
| Item | freightType | 선택 | 's' \| 'a' \| 'b' \| 'c' \| 'd' \| 'e' | src/shared/types.ts:578 | 3 |
| Item | partnerBoxConfigs | 선택 | ClientBoxConfig[] | src/shared/types.ts:581 | 0 |
| Item | 품목 | 선택 | string | src/shared/types.ts:582 | 14 |
| Item | spec | 선택 | string | src/shared/types.ts:583 | 94 |
| Item | 용량 | 선택 | string | src/shared/types.ts:585 | 1 |
| Item | isSmartStore | 선택 | boolean | src/shared/types.ts:586 | 1 |
| Item | smartStorePrice | 선택 | number | src/shared/types.ts:587 | 4 |
| Item | procureType | 선택 | '완사입' \| '임가공' | src/shared/types.ts:590 | 5 |
| Item | unpackable | 선택 | boolean | src/shared/types.ts:600 | 2 |
| Item | isRawMaterial | 선택 | boolean | src/shared/types.ts:601 | 0 |
| Item | rawMaterialName | 선택 | string | src/shared/types.ts:602 | 8 |
| Item | packageType | 선택 | string | src/shared/types.ts:603 | 3 |
| Item | packageKg | 선택 | number | src/shared/types.ts:604 | 3 |
| Item | lots | 선택 | RawMaterialLot[] | src/shared/types.ts:605 | 36 |
| Item | mixEnabled | 선택 | boolean | src/shared/types.ts:606 | 4 |
| Item | mixTopPercent | 선택 | number | src/shared/types.ts:607 | 3 |
| Item | mixLotRatios | 선택 | { lotId: string; percent: number }[] | src/shared/types.ts:608 | 8 |
| Item | phantom | 선택 | boolean | src/shared/types.ts:609 | 13 |
| Item | variantStocks | 선택 | Record<string, number> | src/shared/types.ts:611 | 0 |
| Item | netContent | 선택 | string | src/shared/types.ts:612 | 0 |
| Item | weightInKg | 선택 | number | src/shared/types.ts:613 | 0 |
| Item | archived | 선택 | boolean | src/shared/types.ts:614 | 38 |
| PalletStock | id | 필수 | string | src/shared/types.ts:619 | 35 |
| PalletStock | name | 필수 | string | src/shared/types.ts:620 | 25 |
| PalletStock | total | 필수 | number | src/shared/types.ts:621 | 10 |
| PalletStock | inUse | 필수 | number | src/shared/types.ts:623 | 0 |
| PalletStock | damaged | 필수 | number | src/shared/types.ts:624 | 6 |
| PalletStock | hidden | 선택 | boolean | src/shared/types.ts:625 | 9 |
| PalletTransaction | id | 필수 | string | src/shared/types.ts:629 | 12 |
| PalletTransaction | partnerId | 필수 | string | src/shared/types.ts:630 | 6 |
| PalletTransaction | palletId | 필수 | string | src/shared/types.ts:631 | 6 |
| PalletTransaction | type | 필수 | 'in' \| 'out' | src/shared/types.ts:632 | 9 |
| PalletTransaction | quantity | 필수 | number | src/shared/types.ts:633 | 13 |
| PalletTransaction | date | 필수 | string | src/shared/types.ts:634 | 6 |
| PalletTransaction | note | 선택 | string | src/shared/types.ts:635 | 2 |
| PalletTransaction | status | 선택 | '교체중' \| '교체완료' | src/shared/types.ts:636 | 3 |
| PalletTransaction | exchangeReturnQty | 선택 | number | src/shared/types.ts:637 | 2 |
| PalletTransaction | isTransfer | 선택 | boolean | src/shared/types.ts:638 | 5 |
| Post | id | 필수 | string | src/shared/types.ts:643 | 3 |
| Post | title | 필수 | string | src/shared/types.ts:644 | 3 |
| Post | author | 필수 | string | src/shared/types.ts:645 | 2 |
| Post | content | 필수 | string | src/shared/types.ts:646 | 2 |
| Post | date | 필수 | string | src/shared/types.ts:647 | 3 |
| Post | tag | 필수 | '공지' \| '긴급' \| '매뉴얼' \| '업무' | src/shared/types.ts:648 | 6 |
| Post | pinned | 선택 | boolean | src/shared/types.ts:649 | 4 |
| Post | blocks | 선택 | ({ type: 'text'; text: string } \| { type: 'image'; url: string; path: string; caption: string })[] | src/shared/types.ts:650 | 2 |
| FileItem | id | 필수 | string | src/shared/types.ts:654 | 0 |
| FileItem | name | 필수 | string | src/shared/types.ts:655 | 0 |
| FileItem | type | 필수 | 'pdf' \| 'excel' \| 'image' \| 'word' | src/shared/types.ts:656 | 0 |
| FileItem | size | 필수 | string | src/shared/types.ts:657 | 0 |
| FileItem | date | 필수 | string | src/shared/types.ts:658 | 0 |
| FileItem | uploader | 필수 | string | src/shared/types.ts:659 | 0 |
| CabinetCategory | id | 필수 | string | src/shared/types.ts:665 | 2 |
| CabinetCategory | companyId | 선택 | CompanyId | src/shared/types.ts:666 | 0 |
| CabinetCategory | name | 필수 | string | src/shared/types.ts:667 | 12 |
| CabinetCategory | order | 필수 | number | src/shared/types.ts:668 | 1 |
| CabinetCategory | createdAt | 필수 | string | src/shared/types.ts:669 | 0 |
| CabinetSubCategory | id | 필수 | string | src/shared/types.ts:673 | 2 |
| CabinetSubCategory | companyId | 선택 | CompanyId | src/shared/types.ts:674 | 0 |
| CabinetSubCategory | category | 필수 | string | src/shared/types.ts:675 | 6 |
| CabinetSubCategory | name | 필수 | string | src/shared/types.ts:676 | 11 |
| CabinetSubCategory | order | 필수 | number | src/shared/types.ts:677 | 1 |
| CabinetSubCategory | createdAt | 필수 | string | src/shared/types.ts:678 | 0 |
| CabinetDoc | id | 필수 | string | src/shared/types.ts:682 | 3 |
| CabinetDoc | companyId | 선택 | CompanyId | src/shared/types.ts:683 | 0 |
| CabinetDoc | category | 필수 | string | src/shared/types.ts:684 | 3 |
| CabinetDoc | subCategory | 필수 | string | src/shared/types.ts:685 | 3 |
| CabinetDoc | fileName | 필수 | string | src/shared/types.ts:686 | 5 |
| CabinetDoc | storagePath | 필수 | string | src/shared/types.ts:687 | 1 |
| CabinetDoc | downloadUrl | 필수 | string | src/shared/types.ts:688 | 1 |
| CabinetDoc | size | 필수 | number | src/shared/types.ts:689 | 1 |
| CabinetDoc | contentType | 필수 | string | src/shared/types.ts:690 | 1 |
| CabinetDoc | note | 선택 | string | src/shared/types.ts:691 | 3 |
| CabinetDoc | uploadedBy | 필수 | string | src/shared/types.ts:692 | 1 |
| CabinetDoc | uploadedAt | 필수 | string | src/shared/types.ts:693 | 2 |
| AnnualLeave | carryOverLeave | 필수 | number | src/shared/types.ts:700 | 7 |
| AnnualLeave | bonusLeave | 필수 | number | src/shared/types.ts:701 | 7 |
| Employee | id | 필수 | string | src/shared/types.ts:705 | 129 |
| Employee | companyId | 선택 | CompanyId | src/shared/types.ts:707 | 2 |
| Employee | name | 필수 | string | src/shared/types.ts:708 | 101 |
| Employee | username | 선택 | string | src/shared/types.ts:709 | 1 |
| Employee | position | 필수 | string | src/shared/types.ts:710 | 25 |
| Employee | department | 필수 | string | src/shared/types.ts:711 | 21 |
| Employee | joinDate | 필수 | string | src/shared/types.ts:712 | 12 |
| Employee | status | 필수 | EmployeeStatus | src/shared/types.ts:713 | 5 |
| Employee | phone | 필수 | string | src/shared/types.ts:714 | 9 |
| Employee | birthDate | 선택 | string | src/shared/types.ts:715 | 1 |
| Employee | annualLeave | 선택 | AnnualLeave | src/shared/types.ts:716 | 12 |
| Employee | healthCertDate | 선택 | string | src/shared/types.ts:717 | 7 |
| Employee | adminAccess | 선택 | boolean | src/shared/types.ts:722 | 2 |
| Employee | fcmTokens | 선택 | string[] | src/shared/types.ts:727 | 1 |
| Employee | fcmDevices | 선택 | Record<string, { name: string; at: string }> | src/shared/types.ts:738 | 1 |
| PayrollLine | employeeId | 필수 | string | src/shared/types.ts:746 | 4 |
| PayrollLine | employeeName | 필수 | string | src/shared/types.ts:747 | 3 |
| PayrollLine | department | 선택 | string | src/shared/types.ts:748 | 3 |
| PayrollLine | position | 선택 | string | src/shared/types.ts:749 | 2 |
| PayrollLine | base | 필수 | number | src/shared/types.ts:750 | 2 |
| PayrollLine | overtime | 선택 | number | src/shared/types.ts:751 | 2 |
| PayrollLine | allowance | 선택 | number | src/shared/types.ts:752 | 2 |
| PayrollLine | incomeTax | 선택 | number | src/shared/types.ts:753 | 2 |
| PayrollLine | localTax | 선택 | number | src/shared/types.ts:754 | 2 |
| PayrollLine | pension | 선택 | number | src/shared/types.ts:755 | 2 |
| PayrollLine | health | 선택 | number | src/shared/types.ts:756 | 2 |
| PayrollLine | employment | 선택 | number | src/shared/types.ts:757 | 2 |
| PayrollLine | otherDeduct | 선택 | number | src/shared/types.ts:758 | 2 |
| PayrollLine | note | 선택 | string | src/shared/types.ts:759 | 0 |
| Payroll | id | 필수 | string | src/shared/types.ts:763 | 3 |
| Payroll | companyId | 선택 | CompanyId | src/shared/types.ts:765 | 0 |
| Payroll | yearMonth | 필수 | string | src/shared/types.ts:766 | 0 |
| Payroll | payDate | 필수 | string | src/shared/types.ts:767 | 1 |
| Payroll | lines | 필수 | PayrollLine[] | src/shared/types.ts:768 | 2 |
| Payroll | cashEntryId | 선택 | string | src/shared/types.ts:769 | 4 |
| Payroll | note | 선택 | string | src/shared/types.ts:770 | 0 |
| Payroll | createdAt | 선택 | string | src/shared/types.ts:771 | 3 |
| Payroll | updatedAt | 선택 | string | src/shared/types.ts:772 | 0 |
| LeaveModifyRequest | startDate | 필수 | string | src/shared/types.ts:807 | 3 |
| LeaveModifyRequest | endDate | 필수 | string | src/shared/types.ts:808 | 3 |
| LeaveModifyRequest | reason | 필수 | string | src/shared/types.ts:809 | 3 |
| LeaveModifyRequest | daysUsed | 필수 | number | src/shared/types.ts:810 | 3 |
| LeaveModifyRequest | status | 필수 | 'pending' \| 'approved' \| 'rejected' | src/shared/types.ts:811 | 7 |
| LeaveRequest | id | 필수 | string | src/shared/types.ts:815 | 19 |
| LeaveRequest | employeeId | 필수 | string | src/shared/types.ts:816 | 8 |
| LeaveRequest | employeeName | 필수 | string | src/shared/types.ts:817 | 6 |
| LeaveRequest | type | 필수 | LeaveType | src/shared/types.ts:818 | 10 |
| LeaveRequest | startDate | 필수 | string | src/shared/types.ts:819 | 17 |
| LeaveRequest | endDate | 필수 | string | src/shared/types.ts:820 | 11 |
| LeaveRequest | reason | 필수 | string | src/shared/types.ts:821 | 6 |
| LeaveRequest | status | 필수 | LeaveStatus | src/shared/types.ts:822 | 24 |
| LeaveRequest | requestedAt | 필수 | string | src/shared/types.ts:823 | 4 |
| LeaveRequest | daysUsed | 필수 | number | src/shared/types.ts:824 | 10 |
| LeaveRequest | deductsLeave | 선택 | boolean | src/shared/types.ts:830 | 1 |
| LeaveRequest | modifyRequest | 선택 | LeaveModifyRequest | src/shared/types.ts:831 | 19 |
| LeaveRequest | cancelledAt | 선택 | string | src/shared/types.ts:837 | 2 |
| LeaveRequest | cancelledBy | 선택 | string | src/shared/types.ts:838 | 0 |
| LeaveRequest | cancelledByName | 선택 | string | src/shared/types.ts:839 | 1 |
| LeaveRequest | cancelReason | 선택 | string | src/shared/types.ts:840 | 2 |
| ChatMessage | id | 필수 | string | src/shared/types.ts:844 | 15 |
| ChatMessage | companyId | 선택 | CompanyId | src/shared/types.ts:845 | 0 |
| ChatMessage | roomId | 필수 | string | src/shared/types.ts:846 | 4 |
| ChatMessage | senderId | 필수 | string | src/shared/types.ts:847 | 6 |
| ChatMessage | senderName | 필수 | string | src/shared/types.ts:848 | 7 |
| ChatMessage | text | 필수 | string | src/shared/types.ts:849 | 18 |
| ChatMessage | imageUrl | 선택 | string | src/shared/types.ts:850 | 2 |
| ChatMessage | images | 선택 | string[] | src/shared/types.ts:857 | 2 |
| ChatMessage | createdAt | 필수 | string | src/shared/types.ts:858 | 4 |
| ChatMessage | mentions | 선택 | string[] | src/shared/types.ts:859 | 0 |
| ChatMessage | fileUrl | 선택 | string | src/shared/types.ts:861 | 2 |
| ChatMessage | fileName | 선택 | string | src/shared/types.ts:862 | 1 |
| ChatMessage | fileSize | 선택 | number | src/shared/types.ts:863 | 2 |
| ChatMessage | replyTo | 선택 | { id: string; senderName: string; text: string } | src/shared/types.ts:868 | 3 |
| ChatMessage | deletedAt | 선택 | string | src/shared/types.ts:873 | 4 |
| ChatMessage | deletedBy | 선택 | string | src/shared/types.ts:874 | 0 |
| ChatMessage | reactions | 선택 | Record<string, string[]> | src/shared/types.ts:880 | 6 |
| ChatRoom | id | 필수 | string | src/shared/types.ts:884 | 26 |
| ChatRoom | companyId | 선택 | CompanyId | src/shared/types.ts:885 | 0 |
| ChatRoom | name | 선택 | string | src/shared/types.ts:887 | 3 |
| ChatRoom | nameBy | 선택 | Record<string, string> | src/shared/types.ts:889 | 1 |
| ChatRoom | createdBy | 선택 | string | src/shared/types.ts:891 | 0 |
| ChatRoom | participantIds | 필수 | string[] | src/shared/types.ts:892 | 12 |
| ChatRoom | participantCompanies | 선택 | Record<string, CompanyId> | src/shared/types.ts:894 | 0 |
| ChatRoom | lastMessage | 선택 | string | src/shared/types.ts:895 | 1 |
| ChatRoom | lastUpdatedAt | 필수 | string | src/shared/types.ts:896 | 5 |
| ChatRoom | isGroup | 필수 | boolean | src/shared/types.ts:897 | 7 |
| ChatRoom | lastReadBy | 선택 | Record<string, string> | src/shared/types.ts:898 | 5 |
| ChatRoom | pinnedBy | 선택 | Record<string, string> | src/shared/types.ts:906 | 3 |
| ChatRoom | notice | 선택 | RoomNotice \| null | src/shared/types.ts:914 | 2 |
| RoomNotice | messageId | 필수 | string | src/shared/types.ts:920 | 1 |
| RoomNotice | text | 필수 | string | src/shared/types.ts:921 | 2 |
| RoomNotice | by | 필수 | string | src/shared/types.ts:923 | 0 |
| RoomNotice | byName | 필수 | string | src/shared/types.ts:924 | 1 |
| RoomNotice | at | 필수 | string | src/shared/types.ts:926 | 1 |
| ProductionRecord | id | 필수 | string | src/shared/types.ts:934 | 9 |
| ProductionRecord | date | 필수 | string | src/shared/types.ts:935 | 4 |
| ProductionRecord | itemId | 필수 | string | src/shared/types.ts:936 | 8 |
| ProductionRecord | itemName | 필수 | string | src/shared/types.ts:937 | 3 |
| ProductionRecord | finishedQty | 필수 | number | src/shared/types.ts:938 | 3 |
| ProductionRecord | wipUsed | 선택 | number | src/shared/types.ts:939 | 1 |
| ProductionRecord | wipItemId | 선택 | string | src/shared/types.ts:940 | 0 |
| ProductionRecord | wipItemName | 선택 | string | src/shared/types.ts:941 | 2 |
| ProductionRecord | cost | 선택 | number | src/shared/types.ts:942 | 0 |
| ProductionRecord | note | 선택 | string | src/shared/types.ts:943 | 2 |
| ProductionRecord | createdBy | 선택 | string | src/shared/types.ts:944 | 0 |
| ProductionRecord | createdAt | 필수 | string | src/shared/types.ts:945 | 0 |
| FixedCostEntry | id | 필수 | string | src/shared/types.ts:952 | 0 |
| FixedCostEntry | yearMonth | 필수 | string | src/shared/types.ts:953 | 1 |
| FixedCostEntry | category | 필수 | FixedCostCategory | src/shared/types.ts:954 | 0 |
| FixedCostEntry | label | 필수 | string | src/shared/types.ts:955 | 0 |
| FixedCostEntry | amount | 필수 | number | src/shared/types.ts:956 | 1 |
| FixedCostEntry | accountCode | 선택 | string | src/shared/types.ts:957 | 0 |
| FixedCostEntry | note | 선택 | string | src/shared/types.ts:958 | 0 |
| FixedCostEntry | createdAt | 필수 | string | src/shared/types.ts:959 | 0 |
| FixedCostTemplate | companyId | 선택 | CompanyId | src/shared/types.ts:972 | 1 |
| FixedCostTemplate | transferLines | 선택 | { accountCode: string; side: '차변' \| '대변'; name?: string }[] | src/shared/types.ts:974 | 5 |
| FixedCostTemplate | id | 필수 | string | src/shared/types.ts:975 | 16 |
| FixedCostTemplate | name | 필수 | string | src/shared/types.ts:976 | 20 |
| FixedCostTemplate | amount | 필수 | number | src/shared/types.ts:977 | 14 |
| FixedCostTemplate | category | 필수 | FixedCostCategory | src/shared/types.ts:978 | 1 |
| FixedCostTemplate | active | 필수 | boolean | src/shared/types.ts:979 | 1 |
| FixedCostTemplate | note | 선택 | string | src/shared/types.ts:980 | 1 |
| FixedCostTemplate | accountCode | 선택 | string | src/shared/types.ts:982 | 16 |
| FixedCostTemplate | partnerId | 선택 | string | src/shared/types.ts:983 | 7 |
| FixedCostTemplate | partnerName | 선택 | string | src/shared/types.ts:984 | 11 |
| FixedCostTemplate | startYm | 선택 | string | src/shared/types.ts:985 | 1 |
| FixedCostTemplate | endYm | 선택 | string | src/shared/types.ts:986 | 1 |
| FixedCostTemplate | kind | 선택 | 'recurring' \| 'voucher' | src/shared/types.ts:991 | 3 |
| FixedCostTemplate | dir | 선택 | '입금' \| '출금' \| '줄돈' \| '받을돈' \| '대체' \| '회사이체' | src/shared/types.ts:1004 | 3 |
| FixedCostTemplate | mode | 선택 | '일반' \| '상환' \| '급여' \| '보험' \| '세금' | src/shared/types.ts:1005 | 22 |
| FixedCostTemplate | insCorp | 선택 | number | src/shared/types.ts:1017 | 1 |
| FixedCostTemplate | insEmp | 선택 | number | src/shared/types.ts:1017 | 1 |
| FixedCostTemplate | principal | 선택 | number | src/shared/types.ts:1018 | 3 |
| FixedCostTemplate | interest | 선택 | number | src/shared/types.ts:1018 | 3 |
| FixedCostTemplate | gross | 선택 | number | src/shared/types.ts:1019 | 1 |
| FixedCostTemplate | deduction | 선택 | number | src/shared/types.ts:1019 | 1 |
| FixedCostTemplate | loanCode | 선택 | string | src/shared/types.ts:1021 | 3 |
| FixedCostTemplate | loanId | 선택 | string | src/shared/types.ts:1023 | 6 |
| FixedCostTemplate | vat | 선택 | number | src/shared/types.ts:1025 | 0 |
| FixedCostTemplate | incomeTax | 선택 | number | src/shared/types.ts:1025 | 0 |
| FixedCostTemplate | builtin | 선택 | string | src/shared/types.ts:1027 | 8 |
| FixedCostTemplate | hidden | 선택 | boolean | src/shared/types.ts:1029 | 6 |
| FixedCostTemplate | group | 선택 | string | src/shared/types.ts:1031 | 10 |
| FixedCostTemplate | favorite | 선택 | boolean | src/shared/types.ts:1033 | 6 |
| FixedCostTemplate | postMode | 선택 | '합침' \| '분리' | src/shared/types.ts:1036 | 3 |
| FixedCostTemplate | autoIssue | 선택 | boolean | src/shared/types.ts:1038 | 12 |
| FixedCostTemplate | issueDay | 선택 | number | src/shared/types.ts:1040 | 10 |
| FixedCostTemplate | taxExempt | 선택 | boolean | src/shared/types.ts:1042 | 3 |
| FixedCostTemplate | itemName | 선택 | string | src/shared/types.ts:1047 | 3 |
| IssuedStatementItem | itemId | 선택 | string | src/shared/types.ts:1069 | 5 |
| IssuedStatementItem | lineKind | 선택 | StatementLineKind | src/shared/types.ts:1071 | 1 |
| IssuedStatementItem | name | 필수 | string | src/shared/types.ts:1072 | 22 |
| IssuedStatementItem | spec | 필수 | string | src/shared/types.ts:1073 | 4 |
| IssuedStatementItem | qty | 필수 | number | src/shared/types.ts:1074 | 10 |
| IssuedStatementItem | price | 필수 | number | src/shared/types.ts:1075 | 2 |
| IssuedStatementItem | supply | 필수 | number | src/shared/types.ts:1076 | 11 |
| IssuedStatementItem | tax | 필수 | number | src/shared/types.ts:1077 | 10 |
| IssuedStatementItem | total | 필수 | number | src/shared/types.ts:1078 | 16 |
| IssuedStatementItem | isTaxExempt | 필수 | boolean | src/shared/types.ts:1079 | 6 |
| IssuedStatementItem | accountCode | 선택 | string | src/shared/types.ts:1084 | 15 |
| IssuedStatementItem | side | 선택 | '차변' \| '대변' | src/shared/types.ts:1097 | 10 |
| StatementParty | name | 필수 | string | src/shared/types.ts:1102 | 0 |
| StatementParty | bizNo | 필수 | string | src/shared/types.ts:1103 | 0 |
| StatementParty | ceo | 필수 | string | src/shared/types.ts:1104 | 0 |
| StatementParty | addr | 필수 | string | src/shared/types.ts:1105 | 0 |
| StatementParty | bizType | 필수 | string | src/shared/types.ts:1106 | 0 |
| StatementParty | bizItem | 필수 | string | src/shared/types.ts:1107 | 0 |
| StatementParty | tel | 필수 | string | src/shared/types.ts:1108 | 0 |
| StatementParty | fax | 필수 | string | src/shared/types.ts:1109 | 0 |
| StatementPartySnapshot | supplier | 필수 | StatementParty | src/shared/types.ts:1113 | 1 |
| StatementPartySnapshot | buyer | 필수 | StatementParty | src/shared/types.ts:1114 | 1 |
| IssuedStatement | id | 필수 | string | src/shared/types.ts:1118 | 109 |
| IssuedStatement | openingItemId | 선택 | string | src/shared/types.ts:1120 | 0 |
| IssuedStatement | openingQuantity | 선택 | number | src/shared/types.ts:1121 | 0 |
| IssuedStatement | companyId | 선택 | CompanyId | src/shared/types.ts:1123 | 1 |
| IssuedStatement | issuedAt | 필수 | string | src/shared/types.ts:1124 | 17 |
| IssuedStatement | tradeDate | 필수 | string | src/shared/types.ts:1125 | 80 |
| IssuedStatement | type | 필수 | '매출' \| '매입' \| '비용' | src/shared/types.ts:1126 | 67 |
| IssuedStatement | partnerId | 필수 | string | src/shared/types.ts:1127 | 60 |
| IssuedStatement | partnerName | 필수 | string | src/shared/types.ts:1128 | 29 |
| IssuedStatement | orderId | 필수 | string | src/shared/types.ts:1129 | 7 |
| IssuedStatement | docNo | 필수 | string | src/shared/types.ts:1130 | 40 |
| IssuedStatement | totalSupply | 필수 | number | src/shared/types.ts:1131 | 3 |
| IssuedStatement | totalTax | 필수 | number | src/shared/types.ts:1132 | 4 |
| IssuedStatement | totalAmount | 필수 | number | src/shared/types.ts:1133 | 47 |
| IssuedStatement | items | 필수 | IssuedStatementItem[] | src/shared/types.ts:1134 | 39 |
| IssuedStatement | partySnapshot | 선택 | StatementPartySnapshot | src/shared/types.ts:1136 | 3 |
| IssuedStatement | memo | 선택 | string | src/shared/types.ts:1141 | 3 |
| IssuedStatement | createdBy | 선택 | string | src/shared/types.ts:1149 | 3 |
| IssuedStatement | evidence | 선택 | string | src/shared/types.ts:1157 | 0 |
| IssuedStatement | taxIssuedAt | 선택 | string | src/shared/types.ts:1158 | 11 |
| IssuedStatement | exemptIssuedAt | 선택 | string | src/shared/types.ts:1164 | 1 |
| IssuedStatement | cashDir | 선택 | '입금' \| '출금' | src/shared/types.ts:1165 | 0 |
| PurchaseOrderItem | itemId | 필수 | string | src/shared/types.ts:1182 | 39 |
| PurchaseOrderItem | name | 필수 | string | src/shared/types.ts:1183 | 21 |
| PurchaseOrderItem | quantity | 필수 | number | src/shared/types.ts:1185 | 25 |
| PurchaseOrderItem | unit | 필수 | string | src/shared/types.ts:1186 | 10 |
| PurchaseOrderItem | boxQuantity | 선택 | number | src/shared/types.ts:1192 | 0 |
| PurchaseOrder | id | 필수 | string | src/shared/types.ts:1196 | 76 |
| PurchaseOrder | companyId | 선택 | CompanyId | src/shared/types.ts:1198 | 5 |
| PurchaseOrder | itemId | 필수 | string | src/shared/types.ts:1199 | 5 |
| PurchaseOrder | itemName | 필수 | string | src/shared/types.ts:1200 | 1 |
| PurchaseOrder | partnerId | 선택 | string | src/shared/types.ts:1201 | 16 |
| PurchaseOrder | partnerName | 선택 | string | src/shared/types.ts:1202 | 21 |
| PurchaseOrder | quantity | 필수 | number | src/shared/types.ts:1203 | 11 |
| PurchaseOrder | unit | 선택 | string | src/shared/types.ts:1204 | 1 |
| PurchaseOrder | boxQuantity | 선택 | number | src/shared/types.ts:1206 | 1 |
| PurchaseOrder | status | 필수 | 'pending' \| 'invoiced' \| 'received' | src/shared/types.ts:1207 | 22 |
| PurchaseOrder | confirmedByUser | 선택 | boolean | src/shared/types.ts:1208 | 1 |
| PurchaseOrder | linkedStatementId | 선택 | string | src/shared/types.ts:1209 | 20 |
| PurchaseOrder | cardNo | 선택 | string | src/shared/types.ts:1214 | 2 |
| PurchaseOrder | linkedStatementAt | 선택 | string | src/shared/types.ts:1215 | 1 |
| PurchaseOrder | createdAt | 필수 | string | src/shared/types.ts:1216 | 11 |
| PurchaseOrder | invoicedAt | 선택 | string | src/shared/types.ts:1217 | 1 |
| PurchaseOrder | receivedAt | 선택 | string | src/shared/types.ts:1218 | 6 |
| PurchaseOrder | items | 선택 | PurchaseOrderItem[] | src/shared/types.ts:1219 | 12 |
| PurchaseOrder | photoUrl | 선택 | string | src/shared/types.ts:1220 | 0 |
| PurchaseOrder | note | 선택 | string | src/shared/types.ts:1221 | 1 |
| PurchaseOrder | poType | 선택 | 'oem' | src/shared/types.ts:1225 | 13 |
| PurchaseOrder | oemPartnerId | 선택 | string | src/shared/types.ts:1226 | 4 |
| PurchaseOrder | oemSent | 선택 | { material: string; kg: number; rawItemId?: string }[] | src/shared/types.ts:1227 | 10 |
| PurchaseOrder | oemSentAt | 선택 | string | src/shared/types.ts:1228 | 1 |
| PurchaseOrder | oemIssueStatus | 선택 | 'processing' \| 'failed' \| 'complete' | src/shared/types.ts:1230 | 3 |
| PurchaseOrder | oemIssueFingerprint | 선택 | string | src/shared/types.ts:1231 | 3 |
| PurchaseOrder | oemIssueDate | 선택 | string | src/shared/types.ts:1232 | 3 |
| PurchaseOrder | oemIssuedBy | 선택 | string | src/shared/types.ts:1233 | 1 |
| PurchaseOrder | oemIssueError | 선택 | string | src/shared/types.ts:1234 | 0 |
| PurchaseOrder | oemReceivedKg | 선택 | number | src/shared/types.ts:1235 | 2 |
| PurchaseOrder | oemReceivedBulk | 선택 | { material: string; kg: number }[] | src/shared/types.ts:1236 | 1 |
| PurchaseOrder | oemFeePerKg | 선택 | number | src/shared/types.ts:1237 | 3 |
| PurchaseOrder | oemReceiptOperationId | 선택 | string | src/shared/types.ts:1239 | 2 |
| CompanyInfo | name | 필수 | string | src/shared/types.ts:1273 | 4 |
| CompanyInfo | ceoName | 필수 | string | src/shared/types.ts:1274 | 3 |
| CompanyInfo | bizNo | 필수 | string | src/shared/types.ts:1275 | 3 |
| CompanyInfo | bizType | 필수 | string | src/shared/types.ts:1276 | 2 |
| CompanyInfo | bizItem | 필수 | string | src/shared/types.ts:1277 | 2 |
| CompanyInfo | address | 필수 | string | src/shared/types.ts:1278 | 3 |
| CompanyInfo | phone | 선택 | string | src/shared/types.ts:1279 | 2 |
| CompanyInfo | fax | 선택 | string | src/shared/types.ts:1280 | 2 |
| CompanyInfo | email | 선택 | string | src/shared/types.ts:1281 | 0 |
| CompanyInfo | bankAccount | 선택 | string | src/shared/types.ts:1282 | 3 |
| CompanyInfo | adminPassword | 선택 | string | src/shared/types.ts:1283 | 2 |
| ExpensePreset | id | 필수 | string | src/shared/types.ts:1288 | 2 |
| ExpensePreset | name | 필수 | string | src/shared/types.ts:1289 | 2 |
| ExpensePreset | price | 선택 | number | src/shared/types.ts:1290 | 2 |
| ExpensePreset | taxType | 선택 | '과세' \| '면세' | src/shared/types.ts:1291 | 1 |
| ExpensePreset | createdAt | 선택 | string | src/shared/types.ts:1292 | 0 |
| AppNotification | id | 필수 | string | src/shared/types.ts:1296 | 5 |
| AppNotification | type | 필수 | 'new_order' \| 'confirmation' \| 'mention' \| 'leave_request' \| 'inventory_shortage' | src/shared/types.ts:1297 | 8 |
| AppNotification | title | 필수 | string | src/shared/types.ts:1298 | 1 |
| AppNotification | body | 필수 | string | src/shared/types.ts:1299 | 3 |
| AppNotification | readBy | 필수 | string[] | src/shared/types.ts:1300 | 4 |
| AppNotification | dismissedBy | 선택 | string[] | src/shared/types.ts:1301 | 1 |
| AppNotification | createdAt | 필수 | string | src/shared/types.ts:1302 | 3 |
| AppNotification | linkedId | 선택 | string | src/shared/types.ts:1303 | 4 |
| AppNotification | senderId | 선택 | string | src/shared/types.ts:1304 | 0 |
| AppNotification | targetId | 선택 | string | src/shared/types.ts:1305 | 2 |
| RawMaterialLot | id | 필수 | string | src/shared/types.ts:1314 | 91 |
| RawMaterialLot | supplierId | 선택 | string | src/shared/types.ts:1315 | 0 |
| RawMaterialLot | supplierName | 필수 | string | src/shared/types.ts:1316 | 28 |
| RawMaterialLot | packageType | 선택 | string | src/shared/types.ts:1317 | 2 |
| RawMaterialLot | packageKg | 선택 | number | src/shared/types.ts:1318 | 6 |
| RawMaterialLot | qtyIn | 선택 | number | src/shared/types.ts:1319 | 4 |
| RawMaterialLot | kgIn | 필수 | number | src/shared/types.ts:1320 | 3 |
| RawMaterialLot | kgRemaining | 필수 | number | src/shared/types.ts:1321 | 65 |
| RawMaterialLot | receivedDate | 필수 | string | src/shared/types.ts:1322 | 17 |
| RawMaterialLot | lotNo | 선택 | string | src/shared/types.ts:1323 | 31 |
| RawMaterialLot | status | 필수 | 'active' \| 'depleted' | src/shared/types.ts:1324 | 41 |
| RawMaterialLot | poId | 선택 | string | src/shared/types.ts:1325 | 0 |
| RawMaterialLot | createdAt | 필수 | string | src/shared/types.ts:1326 | 2 |
| RawMaterialLot | material | 선택 | string | src/shared/types.ts:1337 | 2 |
| RawMaterialLot | qtyRemaining | 선택 | number | src/shared/types.ts:1339 | 34 |
| RawMaterialLot | unitKg | 선택 | number | src/shared/types.ts:1341 | 7 |
| RawMaterialEntry | id | 필수 | string | src/shared/types.ts:1352 | 29 |
| RawMaterialEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1354 | 4 |
| RawMaterialEntry | rawItemId | 선택 | string | src/shared/types.ts:1365 | 10 |
| RawMaterialEntry | material | 필수 | string | src/shared/types.ts:1367 | 36 |
| RawMaterialEntry | date | 필수 | string | src/shared/types.ts:1368 | 22 |
| RawMaterialEntry | received | 필수 | number | src/shared/types.ts:1369 | 18 |
| RawMaterialEntry | used | 필수 | number | src/shared/types.ts:1370 | 17 |
| RawMaterialEntry | note | 필수 | string | src/shared/types.ts:1371 | 13 |
| RawMaterialEntry | createdAt | 필수 | string | src/shared/types.ts:1372 | 10 |
| RawMaterialEntry | recordedAt | 선택 | string | src/shared/types.ts:1374 | 5 |
| RawMaterialEntry | sequence | 선택 | number | src/shared/types.ts:1376 | 3 |
| RawMaterialEntry | effectiveAt | 선택 | string | src/shared/types.ts:1378 | 7 |
| RawMaterialEntry | balanceAfterKg | 선택 | number | src/shared/types.ts:1380 | 3 |
| RawMaterialEntry | addedBy | 선택 | string | src/shared/types.ts:1381 | 8 |
| RawMaterialEntry | type | 선택 | 'auto' \| 'manual' \| 'correction' \| 'stocktake_unit' | src/shared/types.ts:1382 | 13 |
| RawMaterialEntry | orderId | 선택 | string | src/shared/types.ts:1383 | 2 |
| RawMaterialEntry | canSize | 선택 | number | src/shared/types.ts:1384 | 2 |
| RawMaterialEntry | canSizeTag | 선택 | string | src/shared/types.ts:1385 | 2 |
| RawMaterialEntry | canCount | 선택 | number | src/shared/types.ts:1386 | 4 |
| RawMaterialEntry | unit | 선택 | 'kg' \| 'L' | src/shared/types.ts:1387 | 7 |
| RawMaterialEntry | originalAmount | 선택 | number | src/shared/types.ts:1389 | 1 |
| RawMaterialEntry | originalUnit | 선택 | 'kg' \| 'L' | src/shared/types.ts:1390 | 1 |
| RawMaterialEntry | targetKg | 선택 | number | src/shared/types.ts:1391 | 14 |
| RawMaterialEntry | targetLotId | 선택 | string | src/shared/types.ts:1393 | 4 |
| ItemFormula | id | 필수 | string | src/shared/types.ts:1401 | 1 |
| ItemFormula | parent_key | 필수 | string | src/shared/types.ts:1402 | 9 |
| ItemFormula | child_name | 필수 | string | src/shared/types.ts:1403 | 6 |
| ItemFormula | ratio | 필수 | number | src/shared/types.ts:1404 | 5 |
| ItemFormula | yield_rate | 필수 | number | src/shared/types.ts:1405 | 4 |
| ItemBom | id | 필수 | string | src/shared/types.ts:1410 | 4 |
| ItemBom | parent_id | 필수 | string | src/shared/types.ts:1411 | 13 |
| ItemBom | child_id | 필수 | string | src/shared/types.ts:1412 | 11 |
| ItemBom | quantity | 필수 | number | src/shared/types.ts:1413 | 3 |
| ReturnItem | itemId | 필수 | string | src/shared/types.ts:1421 | 10 |
| ReturnItem | name | 필수 | string | src/shared/types.ts:1422 | 9 |
| ReturnItem | quantity | 필수 | number | src/shared/types.ts:1423 | 15 |
| ReturnItem | price | 필수 | number | src/shared/types.ts:1424 | 5 |
| ReturnItem | reason | 필수 | ReturnReason | src/shared/types.ts:1425 | 3 |
| ReturnItem | isResellable | 필수 | boolean | src/shared/types.ts:1426 | 9 |
| ReturnRequest | id | 필수 | string | src/shared/types.ts:1430 | 14 |
| ReturnRequest | orderId | 선택 | string | src/shared/types.ts:1431 | 3 |
| ReturnRequest | partnerId | 필수 | string | src/shared/types.ts:1432 | 2 |
| ReturnRequest | partnerName | 필수 | string | src/shared/types.ts:1433 | 9 |
| ReturnRequest | items | 필수 | ReturnItem[] | src/shared/types.ts:1434 | 16 |
| ReturnRequest | totalAmount | 필수 | number | src/shared/types.ts:1435 | 4 |
| ReturnRequest | status | 필수 | 'pending' \| 'processed' | src/shared/types.ts:1436 | 17 |
| ReturnRequest | returnType | 선택 | '매출' \| '매입' | src/shared/types.ts:1437 | 2 |
| ReturnRequest | createdAt | 필수 | string | src/shared/types.ts:1438 | 11 |
| ReturnRequest | createdBy | 선택 | string | src/shared/types.ts:1439 | 1 |
| ReturnRequest | processedAt | 선택 | string | src/shared/types.ts:1440 | 5 |
| ReturnRequest | processedBy | 선택 | string | src/shared/types.ts:1441 | 2 |
| ReturnRequest | linkedStatementId | 선택 | string | src/shared/types.ts:1442 | 7 |
| ReturnRequest | note | 선택 | string | src/shared/types.ts:1443 | 5 |
| PendingStatementEdit | id | 필수 | string | src/shared/types.ts:1447 | 3 |
| PendingStatementEdit | statementId | 필수 | string | src/shared/types.ts:1448 | 1 |
| PendingStatementEdit | statementDocNo | 필수 | string | src/shared/types.ts:1449 | 1 |
| PendingStatementEdit | statementType | 필수 | '매출' \| '매입' | src/shared/types.ts:1450 | 1 |
| PendingStatementEdit | partnerName | 필수 | string | src/shared/types.ts:1451 | 1 |
| PendingStatementEdit | proposedData | 필수 | {     tradeDate: string;     partnerId: string;     partnerName: string;     totalSupply: number;     totalTax: number;     totalAmount: number;     items: IssuedStatementItem[];   } | src/shared/types.ts:1452 | 3 |
| PendingStatementEdit | createdAt | 필수 | string | src/shared/types.ts:1461 | 2 |
| PendingStatementEdit | createdBy | 필수 | string | src/shared/types.ts:1462 | 1 |
| PendingStatementEdit | status | 필수 | 'pending' \| 'approved' \| 'rejected' | src/shared/types.ts:1463 | 1 |
| PendingStatementEdit | reason | 선택 | string | src/shared/types.ts:1464 | 1 |
| PendingStatementEdit | changes | 선택 | { name: string; oldQty: number; newQty: number }[] | src/shared/types.ts:1465 | 2 |
| PendingStatementEdit | sourcePoId | 선택 | string | src/shared/types.ts:1466 | 0 |
| AccountCode | id | 필수 | string | src/shared/types.ts:1473 | 25 |
| AccountCode | code | 필수 | string | src/shared/types.ts:1474 | 98 |
| AccountCode | name | 필수 | string | src/shared/types.ts:1475 | 59 |
| AccountCode | groupId | 선택 | string | src/shared/types.ts:1476 | 11 |
| AccountCode | type | 선택 | AccountType | src/shared/types.ts:1478 | 17 |
| AccountCode | normalBalance | 선택 | 'debit' \| 'credit' | src/shared/types.ts:1479 | 9 |
| AccountCode | isCash | 선택 | boolean | src/shared/types.ts:1480 | 1 |
| AccountCode | noncash | 선택 | boolean | src/shared/types.ts:1485 | 0 |
| AccountCode | note | 선택 | string | src/shared/types.ts:1486 | 0 |
| JournalLine | accountCode | 필수 | string | src/shared/types.ts:1491 | 35 |
| JournalLine | debit | 필수 | number | src/shared/types.ts:1492 | 34 |
| JournalLine | credit | 필수 | number | src/shared/types.ts:1493 | 30 |
| JournalLine | partnerId | 선택 | string | src/shared/types.ts:1494 | 12 |
| JournalLine | note | 선택 | string | src/shared/types.ts:1495 | 1 |
| JournalEntry | id | 필수 | string | src/shared/types.ts:1499 | 10 |
| JournalEntry | date | 필수 | string | src/shared/types.ts:1500 | 15 |
| JournalEntry | lines | 필수 | JournalLine[] | src/shared/types.ts:1501 | 32 |
| JournalEntry | memo | 선택 | string | src/shared/types.ts:1502 | 3 |
| JournalEntry | sourceType | 필수 | '매출' \| '매입' \| '대체' \| '자금' \| '수동' | src/shared/types.ts:1503 | 9 |
| JournalEntry | sourceId | 선택 | string | src/shared/types.ts:1504 | 14 |
| JournalEntry | createdAt | 필수 | string | src/shared/types.ts:1505 | 0 |
| JournalEntry | createdBy | 선택 | string | src/shared/types.ts:1506 | 0 |
| AccountGroup | id | 필수 | string | src/shared/types.ts:1514 | 24 |
| AccountGroup | name | 필수 | string | src/shared/types.ts:1515 | 9 |
| AccountGroup | type | 필수 | '수익' \| '비용' \| '자산' \| '부채' \| '자본' | src/shared/types.ts:1516 | 6 |
| AccountGroup | plLine | 선택 | AccountGroupPlLine | src/shared/types.ts:1517 | 4 |
| AccountGroup | cfSection | 선택 | AccountGroupCfSection | src/shared/types.ts:1520 | 1 |
| AccountGroup | note | 선택 | string | src/shared/types.ts:1521 | 0 |
| CashAccount | id | 필수 | string | src/shared/types.ts:1529 | 30 |
| CashAccount | companyId | 선택 | CompanyId | src/shared/types.ts:1531 | 3 |
| CashAccount | name | 필수 | string | src/shared/types.ts:1532 | 10 |
| CashAccount | type | 필수 | '통장' \| '카드' \| '현금' | src/shared/types.ts:1533 | 16 |
| CashAccount | openingBalance | 필수 | number | src/shared/types.ts:1534 | 14 |
| CashAccount | openingDate | 필수 | string | src/shared/types.ts:1535 | 9 |
| CashAccount | active | 필수 | boolean | src/shared/types.ts:1536 | 12 |
| CashAccount | note | 선택 | string | src/shared/types.ts:1537 | 0 |
| CashAccount | createdAt | 필수 | string | src/shared/types.ts:1538 | 0 |
| CashEntry | id | 필수 | string | src/shared/types.ts:1542 | 48 |
| CashEntry | linkedAccrualStatementId | 선택 | string | src/shared/types.ts:1544 | 2 |
| CashEntry | loanId | 선택 | string | src/shared/types.ts:1546 | 1 |
| CashEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1548 | 0 |
| CashEntry | docNo | 선택 | string | src/shared/types.ts:1554 | 10 |
| CashEntry | date | 필수 | string | src/shared/types.ts:1555 | 41 |
| CashEntry | cashAccountId | 필수 | string | src/shared/types.ts:1556 | 3 |
| CashEntry | dir | 필수 | '입금' \| '출금' \| '대체' | src/shared/types.ts:1567 | 45 |
| CashEntry | amount | 필수 | number | src/shared/types.ts:1568 | 24 |
| CashEntry | partnerId | 선택 | string | src/shared/types.ts:1569 | 36 |
| CashEntry | partnerName | 선택 | string | src/shared/types.ts:1570 | 16 |
| CashEntry | accountCode | 선택 | string | src/shared/types.ts:1571 | 23 |
| CashEntry | lines | 선택 | {     accountCode: string;     /**      * **언제나 양수로 적는다.** 차·대는 `side`가 말한다.      *      * `side`가 없는 옛 줄은 **부호가 곧 차·대**였다 — 양수면 통장 반대편, 음수면      * 통장과 같은 편(급여 원천공제가 그 길). 그 규칙은 `dir`에 매달려 있어서      * 입금·출금을 바꾸면 모든 줄의 뜻이 조용히 뒤집혔다. 읽는 쪽은 아직 그 줄도      * 받아 주지만(옛 데이터 호환), **새로 쓸 땐 `side`를 넣는다.**      */     amount: number;     /** 차변이냐 대변이냐. 대체전표 줄(`IssuedStatementItem.side`)과 같은 모양이다. */     side?: '차변' \| '대변';     note?: string;   }[] | src/shared/types.ts:1578 | 23 |
| CashEntry | offsetOf | 선택 | { ar: string; ap: string } | src/shared/types.ts:1594 | 0 |
| CashEntry | note | 선택 | string | src/shared/types.ts:1595 | 17 |
| CashEntry | createdAt | 필수 | string | src/shared/types.ts:1596 | 14 |
| CashEntry | createdBy | 선택 | string | src/shared/types.ts:1597 | 5 |
| Settlement | id | 필수 | string | src/shared/types.ts:1603 | 9 |
| Settlement | cashEntryId | 필수 | string | src/shared/types.ts:1604 | 11 |
| Settlement | statementId | 필수 | string | src/shared/types.ts:1605 | 10 |
| Settlement | amount | 필수 | number | src/shared/types.ts:1606 | 9 |
| Settlement | createdAt | 필수 | string | src/shared/types.ts:1607 | 0 |
| InventorySnapshot | id | 필수 | string | src/shared/types.ts:1611 | 5 |
| InventorySnapshot | companyId | 선택 | CompanyId | src/shared/types.ts:1614 | 0 |
| InventorySnapshot | yearMonth | 필수 | string | src/shared/types.ts:1615 | 9 |
| InventorySnapshot | value | 필수 | number | src/shared/types.ts:1616 | 5 |
| InventorySnapshot | recordedAt | 필수 | string | src/shared/types.ts:1617 | 1 |
| InventorySnapshot | items | 선택 | { itemId: string; name: string; category?: string; spec?: string; qty: number; value: number }[] | src/shared/types.ts:1620 | 3 |
| CashFlowManual | id | 필수 | string | src/shared/types.ts:1625 | 0 |
| CashFlowManual | month | 필수 | string | src/shared/types.ts:1626 | 3 |
| CashFlowManual | depreciation | 선택 | number | src/shared/types.ts:1627 | 1 |
| CashFlowManual | prepaidInc | 선택 | number | src/shared/types.ts:1628 | 1 |
| CashFlowManual | assetBuy | 선택 | number | src/shared/types.ts:1629 | 1 |
| CashFlowManual | assetSell | 선택 | number | src/shared/types.ts:1630 | 1 |
| CashFlowManual | financeIn | 선택 | number | src/shared/types.ts:1631 | 1 |
| CashFlowManual | debtRepay | 선택 | number | src/shared/types.ts:1632 | 1 |
| CashFlowManual | openingCash | 선택 | number | src/shared/types.ts:1633 | 4 |
| CashFlowManual | closingCash | 선택 | number | src/shared/types.ts:1634 | 4 |
| ProductionSalesLog | id | 필수 | string | src/shared/types.ts:1638 | 10 |
| ProductionSalesLog | date | 필수 | string | src/shared/types.ts:1639 | 12 |
| ProductionSalesLog | createdAt | 필수 | string | src/shared/types.ts:1640 | 2 |
| ProductionSalesLog | createdBy | 필수 | string | src/shared/types.ts:1641 | 2 |
| ProductionSalesLog | orderCount | 필수 | number | src/shared/types.ts:1642 | 3 |
| ProductionSalesLog | productionRows | 필수 | { groupLabel: string; spec: string; 수량: number; 소비기한: string; 비고: string }[] | src/shared/types.ts:1644 | 2 |
| ProductionSalesLog | seedRows | 선택 | { 품목: string; 용량: string; 수량: number; 소비기한: string; 비고: string }[] | src/shared/types.ts:1646 | 2 |
| ProductionSalesLog | salesRows | 선택 | { 상호: string; 품목: string; 용량: string; 수량: number; 소비기한: string }[] | src/shared/types.ts:1648 | 5 |
| ProductionSalesLog | extraRows | 선택 | { 품목: string; 용량: string; 수량: number; 거래처: string }[] | src/shared/types.ts:1650 | 1 |
| ProductionSalesLog | orderSummaries | 필수 | { partnerName: string; items: { name: string; qty: number }[] }[] | src/shared/types.ts:1652 | 1 |
| AdjustmentRequest | id | 필수 | string | src/shared/types.ts:1660 | 19 |
| AdjustmentRequest | companyId | 선택 | CompanyId | src/shared/types.ts:1661 | 1 |
| AdjustmentRequest | itemId | 필수 | string | src/shared/types.ts:1662 | 9 |
| AdjustmentRequest | itemName | 필수 | string | src/shared/types.ts:1663 | 3 |
| AdjustmentRequest | originalQuantity | 필수 | number | src/shared/types.ts:1664 | 6 |
| AdjustmentRequest | requestedQuantity | 선택 | number | src/shared/types.ts:1665 | 9 |
| AdjustmentRequest | type | 필수 | AdjustmentType | src/shared/types.ts:1666 | 31 |
| AdjustmentRequest | reason | 필수 | string | src/shared/types.ts:1667 | 4 |
| AdjustmentRequest | status | 필수 | AdjustmentStatus | src/shared/types.ts:1668 | 11 |
| AdjustmentRequest | requestedAt | 필수 | string | src/shared/types.ts:1669 | 4 |
| AdjustmentRequest | processedAt | 선택 | string | src/shared/types.ts:1670 | 3 |
| AdjustmentRequest | unit | 선택 | string | src/shared/types.ts:1671 | 4 |
| AdjustmentRequest | oemPoId | 선택 | string | src/shared/types.ts:1673 | 3 |
| AdjustmentRequest | oemFeePerKg | 선택 | number | src/shared/types.ts:1674 | 5 |
| AdjustmentRequest | oemTotal | 선택 | number | src/shared/types.ts:1675 | 2 |
