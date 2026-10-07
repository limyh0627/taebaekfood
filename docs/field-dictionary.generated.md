# 현재 코드 필드 사전

COL 69개, 선언 필드 705개, 운영 소스 366개를 분석했다.

TypeScript가 shared/types.ts 선언으로 해석한 속성 접근만 사용처로 집계한다. any·동적 인덱스·객체 전개·별도 모델은 포함하지 않으며, 사용처 0은 삭제 근거가 아니다. JSON에 정확한 파일·행별 사용처가 있다. 현재 DB의 실제 필드나 지향 설계를 뜻하지 않는다. 현재 checkout의 미배포 후보가 포함될 수 있으므로 배포 경계는 erd-current-and-target-20261007.md에서 별도로 확인한다.

## Firestore 경로 보완

SDK import·선언·수신 객체 타입으로 확인한 collection/doc/collectionGroup 호출 462건. 동적 문서 ID도 미해석으로 보존하며, 미해석 254건은 컬렉션 이름 누락과 같은 의미가 아니다. 서버 호출·중첩 경로·직접 const 별칭을 포함한다. 동적 문자열 안의 슬래시 수는 알 수 없어 깊이를 확정하지 않으며, JSON의 argumentDepthCandidate/pathKind는 인수 형태에 따른 후보이다. 함수 반환·분기·객체 전개로 구성한 경로는 해석하지 않는다. scripts·rules·테스트·JS 및 공용 래퍼 호출부의 경로 문자열은 이 운영 TS 소스 범위 밖이다. SDK 근거 없는 같은 이름 호출 0건은 JSON의 candidateCalls에 집계 밖 후보로 남긴다.

COL 밖 정적 컬렉션 이름: `appMeta`, `authLoginAttempts`, `companyTransferGrants`, `companyTransferOperations`, `itemUnpackMovements`, `loanMovementOperations`, `manualSettlementBatchOperations`, `manualSettlementOperations`, `oemReceiptOperations`, `partnerPaymentOperations`, `returnApplications`, `returnOperations`, `voucherMutationOperations`. 이 목록은 운영 DB 존재/삭제 대상이 아니라 코드에 나타난 이름이다. 부모를 해석하지 못한 호출은 COL 대조에서 제외한다.

동적 컬렉션 호출 36건과 정적 컬렉션의 동적 문서 경로 218건을 구분한다. 후자는 컬렉션 자체의 누락이 아니다. JSON dynamicWrappers는 SDK 호출의 명명 함수와 타입 검사기로 연결된 실제 소비자 위치/인수식을 기록한다. 인수식은 240자까지 표시하고 잘린 경우 truncated=true를 남기며, 런타임 컬렉션 전체 집합을 보장하지 않는다. 익명 고차 함수·객체 DTO·동적 분기는 원문 소스를 함께 대조한다.

| 동적 컬렉션 공용 함수 | 선언 | SDK 위치 | 실제 연결된 소비자 위치 |
| --- | --- | --- | --- |
| subscribeToDocument | src/shared/services/firebaseService.ts:108 | src/shared/services/firebaseService.ts:113 | src/shared/deliveryTimeSlot.ts:24, components/OrdersList.tsx:1717, components/DeliveryManager.tsx:138, components/LeaveManager.tsx:181, src/shared/hooks/useAppData.ts:300 |
| setDocument | src/shared/services/firebaseService.ts:118 | src/shared/services/firebaseService.ts:120 | src/shared/deliveryTimeSlot.ts:34, components/OrdersList.tsx:1723, components/DeliveryManager.tsx:300, components/DeliveryManager.tsx:302, components/DeliveryManager.tsx:303, components/DeliveryManager.tsx:309, components/DeliveryManager.tsx:480, components/DeliveryManager.tsx:486, components/DeliveryManager.tsx:1201, components/LeaveManager.tsx:215, components/PartnerSignupApproval.tsx:59, components/PartnerSignupApproval.tsx:74, components/HaccpChecklist.tsx:2881, components/HaccpChecklist.tsx:3008, components/HaccpChecklist.tsx:3144, components/HaccpChecklist.tsx:3316, components/HaccpChecklist.tsx:3459, components/HaccpChecklist.tsx:4019, components/HaccpChecklist.tsx:4489, src/features/admin/AdminApp.tsx:388, src/features/admin/AdminApp.tsx:2061, src/features/admin/AdminApp.tsx:4608, src/features/admin/AdminApp.tsx:4764 |
| subscribeToCollection | src/shared/services/firebaseService.ts:445 | src/shared/services/firebaseService.ts:451 | src/shared/services/firebaseService.ts:491, components/ItemList.tsx:523, src/shared/hooks/useAppData.ts:230, src/shared/hooks/useAppData.ts:236, src/shared/hooks/useAppData.ts:250, src/shared/hooks/useAppData.ts:251, src/shared/hooks/useAppData.ts:252, src/shared/hooks/useAppData.ts:253, src/shared/hooks/useAppData.ts:272, src/shared/hooks/useAppData.ts:281, src/shared/hooks/useAppData.ts:282, src/shared/hooks/useAppData.ts:284, src/shared/hooks/useAppData.ts:285, src/shared/hooks/useAppData.ts:286, src/shared/hooks/useAppData.ts:287, src/shared/hooks/useAppData.ts:288, src/shared/hooks/useAppData.ts:289, src/shared/hooks/useAppData.ts:290, src/shared/hooks/useAppData.ts:295, src/shared/hooks/useAppData.ts:296, src/shared/hooks/useAppData.ts:298, src/shared/hooks/useAppData.ts:318, src/hooks/useAdminData.ts:56, src/hooks/useAdminData.ts:61, components/HRManager.tsx:128, components/PartnerSignupApproval.tsx:40, components/DocumentManager.tsx:78, components/DocumentManager.tsx:79, components/DocumentManager.tsx:80, components/QuotationManager.tsx:116, components/ReturnManager.tsx:72, components/ReceivingReturnsManager.tsx:51 |
| fetchCollection | src/shared/services/firebaseService.ts:468 | src/shared/services/firebaseService.ts:472 | components/AddItemModal.tsx:134, components/CategoryManager.tsx:39, components/ItemList.tsx:499, components/ItemList.tsx:554, components/ItemList.tsx:556, components/ItemManager.tsx:315, src/shared/hooks/useAppData.ts:201, src/shared/hooks/useAppData.ts:351, src/shared/hooks/useAppData.ts:352, src/shared/hooks/useAppData.ts:353, src/shared/hooks/useAppData.ts:354, src/shared/hooks/useAppData.ts:358, src/shared/hooks/useAppData.ts:359, src/shared/hooks/useAppData.ts:360, src/shared/hooks/useAppData.ts:361, src/shared/hooks/useAppData.ts:362, components/DashboardLinks.tsx:53, components/DocumentManager.tsx:82, components/DocumentManager.tsx:114, components/DocumentManager.tsx:115, src/features/statements/hooks/useStatementHistoryFilters.ts:29, src/features/admin/AdminApp.tsx:526, src/features/admin/AdminApp.tsx:539 |
| fetchDateRange | src/shared/services/firebaseService.ts:499 | src/shared/services/firebaseService.ts:507 | src/features/admin/useProductionSalesHistory.ts:14, components/PalletManager.tsx:65, components/TaxStatement.tsx:56, src/features/admin/useVoucherLedger.ts:150, src/features/admin/useVoucherLedger.ts:167 |
| addItem | src/shared/services/firebaseService.ts:534 | src/shared/services/firebaseService.ts:547, src/shared/services/firebaseService.ts:547, src/shared/services/firebaseService.ts:547, src/shared/services/firebaseService.ts:570, src/shared/services/firebaseService.ts:573 | src/shared/receipt.ts:95, src/shared/services/firebaseService.ts:800, src/shared/services/employeeCommand.ts:30, components/CategoryManager.tsx:45, components/CategoryManager.tsx:88, components/CategoryManager.tsx:106, components/CategoryManager.tsx:124, components/CategoryManager.tsx:149, components/ItemList.tsx:555, components/ItemList.tsx:558, components/DashboardLinks.tsx:64, components/DashboardLinks.tsx:93, components/AdminChecklist.tsx:191, components/DocumentManager.tsx:86, components/DocumentManager.tsx:119, components/DocumentManager.tsx:121, components/DocumentManager.tsx:206, components/DocumentManager.tsx:254, components/DocumentManager.tsx:274, components/QuotationManager.tsx:265, components/HaccpChecklist.tsx:555, components/HaccpChecklist.tsx:1095, components/HaccpChecklist.tsx:1386, components/HaccpChecklist.tsx:1982, components/HaccpChecklist.tsx:2591, components/HaccpChecklist.tsx:3648, components/HaccpChecklist.tsx:4176, components/BenzopyreneLog.tsx:62, src/features/admin/AdminApp.tsx:758, src/features/admin/AdminApp.tsx:1072, src/features/admin/AdminApp.tsx:1084, src/features/admin/AdminApp.tsx:1099, src/features/admin/AdminApp.tsx:1111, src/features/admin/AdminApp.tsx:1248, src/features/admin/AdminApp.tsx:1486, src/features/admin/AdminApp.tsx:1782, src/features/admin/AdminApp.tsx:2043, src/features/admin/AdminApp.tsx:2635, src/features/admin/AdminApp.tsx:2671, src/features/admin/AdminApp.tsx:2692, src/features/admin/AdminApp.tsx:3038, src/features/admin/AdminApp.tsx:3063, src/features/admin/AdminApp.tsx:3073, src/features/admin/AdminApp.tsx:3083, src/features/admin/AdminApp.tsx:3091, src/features/admin/AdminApp.tsx:3398, src/features/admin/AdminApp.tsx:4510, src/features/admin/AdminApp.tsx:4514, src/features/admin/AdminApp.tsx:4524, src/features/admin/AdminApp.tsx:4568, src/features/admin/AdminApp.tsx:4635, src/features/admin/AdminApp.tsx:4645, src/features/admin/AdminApp.tsx:4647, src/features/admin/AdminApp.tsx:4652, src/features/admin/AdminApp.tsx:4736, src/features/admin/AdminApp.tsx:4830, src/features/admin/AdminApp.tsx:4904, src/features/admin/AdminApp.tsx:4906, src/features/admin/AdminApp.tsx:5054, src/features/admin/AdminApp.tsx:5070, src/features/admin/AdminApp.tsx:5090, src/features/admin/AdminApp.tsx:5099, src/features/admin/AdminApp.tsx:5206, src/features/admin/AdminApp.tsx:5261 |
| updateItem | src/shared/services/firebaseService.ts:578 | src/shared/services/firebaseService.ts:579 | components/RawMaterialLotPanel.tsx:80, components/RawMaterialLotPanel.tsx:94, components/CategoryManager.tsx:91, components/CategoryManager.tsx:105, components/CategoryManager.tsx:120, components/CategoryManager.tsx:135, components/CategoryManager.tsx:159, components/CategoryManager.tsx:180, components/PalletManager.tsx:360, components/DashboardLinks.tsx:103, components/AdminChecklist.tsx:204, components/DocumentManager.tsx:246, components/HaccpChecklist.tsx:559, components/HaccpChecklist.tsx:570, components/HaccpChecklist.tsx:1097, components/HaccpChecklist.tsx:1106, components/HaccpChecklist.tsx:1388, components/HaccpChecklist.tsx:1397, components/HaccpChecklist.tsx:1992, components/HaccpChecklist.tsx:2015, components/HaccpChecklist.tsx:2595, components/HaccpChecklist.tsx:2609, components/HaccpChecklist.tsx:3652, components/HaccpChecklist.tsx:3666, components/HaccpChecklist.tsx:4180, components/HaccpChecklist.tsx:4194, components/BenzopyreneLog.tsx:81, src/features/admin/AdminApp.tsx:363, src/features/admin/AdminApp.tsx:727, src/features/admin/AdminApp.tsx:779, src/features/admin/AdminApp.tsx:1144, src/features/admin/AdminApp.tsx:1152, src/features/admin/AdminApp.tsx:1154, src/features/admin/AdminApp.tsx:1163, src/features/admin/AdminApp.tsx:1171, src/features/admin/AdminApp.tsx:1214, src/features/admin/AdminApp.tsx:1288, src/features/admin/AdminApp.tsx:2037, src/features/admin/AdminApp.tsx:2547, src/features/admin/AdminApp.tsx:2550, src/features/admin/AdminApp.tsx:2551, src/features/admin/AdminApp.tsx:2552, src/features/admin/AdminApp.tsx:2553, src/features/admin/AdminApp.tsx:2580, src/features/admin/AdminApp.tsx:2583, src/features/admin/AdminApp.tsx:2584, src/features/admin/AdminApp.tsx:2585, src/features/admin/AdminApp.tsx:2586, src/features/admin/AdminApp.tsx:2607, src/features/admin/AdminApp.tsx:2608, src/features/admin/AdminApp.tsx:2612, src/features/admin/AdminApp.tsx:2613, src/features/admin/AdminApp.tsx:2614, src/features/admin/AdminApp.tsx:2615, src/features/admin/AdminApp.tsx:2653, src/features/admin/AdminApp.tsx:2669, src/features/admin/AdminApp.tsx:2687, src/features/admin/AdminApp.tsx:2842, src/features/admin/AdminApp.tsx:3038, src/features/admin/AdminApp.tsx:3063, src/features/admin/AdminApp.tsx:3072, src/features/admin/AdminApp.tsx:3082, src/features/admin/AdminApp.tsx:3086, src/features/admin/AdminApp.tsx:3088, src/features/admin/AdminApp.tsx:3108, src/features/admin/AdminApp.tsx:3110, src/features/admin/AdminApp.tsx:3119, src/features/admin/AdminApp.tsx:3142, src/features/admin/AdminApp.tsx:3147, src/features/admin/AdminApp.tsx:3148, src/features/admin/AdminApp.tsx:3151, src/features/admin/AdminApp.tsx:3791, src/features/admin/AdminApp.tsx:4504, src/features/admin/AdminApp.tsx:4507, src/features/admin/AdminApp.tsx:4511, src/features/admin/AdminApp.tsx:4519, src/features/admin/AdminApp.tsx:4588, src/features/admin/AdminApp.tsx:4636, src/features/admin/AdminApp.tsx:4644, src/features/admin/AdminApp.tsx:4648, src/features/admin/AdminApp.tsx:4727, src/features/admin/AdminApp.tsx:4800, src/features/admin/AdminApp.tsx:4832, src/features/admin/AdminApp.tsx:4842, src/features/admin/AdminApp.tsx:4851, src/features/admin/AdminApp.tsx:4885, src/features/admin/AdminApp.tsx:4918, src/features/admin/AdminApp.tsx:4920, src/features/admin/AdminApp.tsx:5035, src/features/admin/AdminApp.tsx:5055, src/features/admin/AdminApp.tsx:5058, src/features/admin/AdminApp.tsx:5078, src/features/admin/AdminApp.tsx:5244, src/features/admin/AdminApp.tsx:5256 |
| deleteItem | src/shared/services/firebaseService.ts:588 | src/shared/services/firebaseService.ts:589 | src/shared/services/workOrderResetService.ts:21, components/CategoryManager.tsx:169, components/PalletManager.tsx:379, components/DashboardLinks.tsx:109, components/DocumentManager.tsx:235, components/DocumentManager.tsx:265, components/DocumentManager.tsx:284, components/QuotationManager.tsx:361, components/HaccpChecklist.tsx:577, components/HaccpChecklist.tsx:2028, components/HaccpChecklist.tsx:2616, components/HaccpChecklist.tsx:3677, components/HaccpChecklist.tsx:4205, components/BenzopyreneLog.tsx:91, src/features/admin/AdminApp.tsx:446, src/features/admin/AdminApp.tsx:448, src/features/admin/AdminApp.tsx:1010, src/features/admin/AdminApp.tsx:1140, src/features/admin/AdminApp.tsx:1162, src/features/admin/AdminApp.tsx:1165, src/features/admin/AdminApp.tsx:2631, src/features/admin/AdminApp.tsx:3038, src/features/admin/AdminApp.tsx:3063, src/features/admin/AdminApp.tsx:3084, src/features/admin/AdminApp.tsx:3089, src/features/admin/AdminApp.tsx:3111, src/features/admin/AdminApp.tsx:4512, src/features/admin/AdminApp.tsx:4515, src/features/admin/AdminApp.tsx:4637, src/features/admin/AdminApp.tsx:4646, src/features/admin/AdminApp.tsx:4649, src/features/admin/AdminApp.tsx:4737, src/features/admin/AdminApp.tsx:4831, src/features/admin/AdminApp.tsx:4883, src/features/admin/AdminApp.tsx:4888, src/features/admin/AdminApp.tsx:5056, src/features/admin/AdminApp.tsx:5203, src/features/admin/AdminApp.tsx:5231 |
| adjustItemStock | src/shared/services/firebaseService.ts:625 | src/shared/services/firebaseService.ts:632 | src/shared/receipt.ts:94 |
| subscribeToSubcollection | src/shared/services/firebaseService.ts:676 | src/shared/services/firebaseService.ts:682 | 정적 호출 연결 없음 |
| addSubItem | src/shared/services/firebaseService.ts:692 | src/shared/services/firebaseService.ts:701, src/shared/services/firebaseService.ts:704 | 정적 호출 연결 없음 |
| updateSubItem | src/shared/services/firebaseService.ts:709 | src/shared/services/firebaseService.ts:716 | 정적 호출 연결 없음 |
| deleteSubItem | src/shared/services/firebaseService.ts:720 | src/shared/services/firebaseService.ts:726 | 정적 호출 연결 없음 |
| fetchWhere | src/shared/services/firebaseService.ts:816 | src/shared/services/firebaseService.ts:821 | src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:16, src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:17, src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:129, src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:130, src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:131, components/OrdersList.tsx:1637, components/OrdersList.tsx:1638, src/features/admin/useVoucherLedger.ts:100, src/features/admin/useVoucherLedger.ts:112, src/shared/useLoanContracts.ts:12, components/ProfitAnalysis.tsx:94, components/FinancialReports.tsx:79, components/LoanManager.tsx:76 |
| fetchWhereIn | src/shared/services/firebaseService.ts:826 | src/shared/services/firebaseService.ts:836 | src/features/admin/AdminApp.tsx:1382 |
| fetchByIds | src/shared/services/firebaseService.ts:849 | src/shared/services/firebaseService.ts:857 | src/features/admin/useVoucherLedger.ts:134 |
| subscribeWhere | src/shared/services/firebaseService.ts:863 | src/shared/services/firebaseService.ts:870 | 정적 호출 연결 없음 |
| commitCompanyWrites | src/shared/services/firebaseService.ts:884 | src/shared/services/firebaseService.ts:890 | src/shared/services/firebaseService.ts:763, src/shared/services/firebaseService.ts:794, src/shared/services/firebaseService.ts:1097, src/features/admin/AdminApp.tsx:1432, src/features/admin/AdminApp.tsx:5007, src/features/admin/AdminApp.tsx:5189, src/features/admin/AdminApp.tsx:5279 |
| mutateDoc | src/shared/services/firebaseService.ts:1106 | src/shared/services/firebaseService.ts:1111 | 정적 호출 연결 없음 |
| updatePendingFlowQuantity | src/shared/services/pendingFlowQuantityService.ts:7 | src/shared/services/pendingFlowQuantityService.ts:13 | src/features/admin/AdminApp.tsx:2688 |
| deleteIssuedStatement | src/shared/services/deleteIssuedStatementService.ts:12 | src/shared/services/deleteIssuedStatementService.ts:32, src/shared/services/deleteIssuedStatementService.ts:36 | src/features/admin/AdminApp.tsx:4580 |
| applyTaxIssueWrites | src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:6 | src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:13, src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:16 | src/features/admin/AdminApp.tsx:4624 |
| readVoucherCounter | functions/src/newScopeCounter.ts:23 | functions/src/newScopeCounter.ts:30 | functions/src/voucherIssue.ts:91, functions/src/tradeStatementIssue.ts:197, functions/src/oemFeeVoucher.ts:176, functions/src/partnerPaymentCommand.ts:144, functions/src/loanMovementCommand.ts:86, functions/src/processReturnCommand.ts:124, functions/src/payrollVoucher.ts:184, functions/src/interCompanyTransferCommand.ts:132 |
| issueVoucher | functions/src/voucherIssue.ts:29 | functions/src/voucherIssue.ts:70, functions/src/voucherIssue.ts:70, functions/src/voucherIssue.ts:71, functions/src/voucherIssue.ts:71 | functions/src/voucherIssue.ts:112, functions/src/autoVoucherCommand.ts:35 |
| mutateVoucher | functions/src/voucherMutationCommand.ts:14 | functions/src/voucherMutationCommand.ts:26, functions/src/voucherMutationCommand.ts:26 | functions/src/voucherMutationCommand.ts:96 |

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
| src/shared/services/firebaseService.ts:79 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/shared/services/firebaseService.ts:113 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:120 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:127 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:175 | client | doc | root / top-level-candidate | 미해석 | partners/{partnerId} |  |
| src/shared/services/firebaseService.ts:176 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:178 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-partner-${companyId}-${date}-${partnerId}-${code}`} |  |
| src/shared/services/firebaseService.ts:217 | client | doc | root / top-level-candidate | 미해석 | loanContracts/{loan.id} |  |
| src/shared/services/firebaseService.ts:218 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:219 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-loan-${companyId}-${loan.id}`} |  |
| src/shared/services/firebaseService.ts:220 | client | doc | root / top-level-candidate | 미해석 | partners/{loan.partnerId} |  |
| src/shared/services/firebaseService.ts:263 | client | collection | root / top-level | 1 | cashEntries |  |
| src/shared/services/firebaseService.ts:264 | client | doc | root / top-level-candidate | 미해석 | loanContracts/{originalLoan.id} |  |
| src/shared/services/firebaseService.ts:265 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-loan-${companyId}-${originalLoan.id}`} |  |
| src/shared/services/firebaseService.ts:320 | client | collection | root / top-level | 1 | cashAccounts |  |
| src/shared/services/firebaseService.ts:322 | client | doc | root / top-level-candidate | 미해석 | cashAccounts/{account.id} |  |
| src/shared/services/firebaseService.ts:323 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:324 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-cash-${companyId}-${account.id}`} |  |
| src/shared/services/firebaseService.ts:376 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/firebaseService.ts:377 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:378 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-inventory-${companyId}-${itemId}`} |  |
| src/shared/services/firebaseService.ts:451 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:472 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:507 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:547 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:547 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{<auto-id>} |  |
| src/shared/services/firebaseService.ts:547 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:550 | client | doc | root / top-level-candidate | 미해석 | cashEntries/{String(data.cashEntryId \|\| 'missing')} |  |
| src/shared/services/firebaseService.ts:551 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{String(data.statementId \|\| 'missing')} |  |
| src/shared/services/firebaseService.ts:558 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${data.companyId}_${partnerId}`} | appMeta |
| src/shared/services/firebaseService.ts:570 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:573 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:579 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:589 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:602 | client | doc | root / top-level-candidate | 미해석 | notifications/{id} |  |
| src/shared/services/firebaseService.ts:632 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{itemId} |  |
| src/shared/services/firebaseService.ts:662 | client | doc | root / top-level-candidate | 미해석 | items/{rawItemId} |  |
| src/shared/services/firebaseService.ts:682 | client | collection | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName} |  |
| src/shared/services/firebaseService.ts:701 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:704 | client | collection | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName} |  |
| src/shared/services/firebaseService.ts:716 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:726 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:741 | client | collection | root / top-level | 1 | partner_item |  |
| src/shared/services/firebaseService.ts:774 | client | collection | root / top-level | 1 | partner_item |  |
| src/shared/services/firebaseService.ts:821 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:836 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:857 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:870 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:890 | client | doc | root / top-level-candidate | 미해석 | {op.collection}/{op.id} |  |
| src/shared/services/firebaseService.ts:915 | client | doc | root / top-level-candidate | 미해석 | items/{receipt.itemId} |  |
| src/shared/services/firebaseService.ts:916 | client | doc | root / top-level-candidate | 미해석 | itemReceipts/{receipt.id} |  |
| src/shared/services/firebaseService.ts:957 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/firebaseService.ts:960 | client | collection | root / top-level | 1 | itemReceipts |  |
| src/shared/services/firebaseService.ts:962 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/firebaseService.ts:975 | client | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| src/shared/services/firebaseService.ts:975 | client | doc | root / top-level-candidate | 미해석 | itemReceipts/{`rcv-po-${encodeURIComponent(poId)}-${encodeURIComponent(line.itemId)}`} |  |
| src/shared/services/firebaseService.ts:1073 | client | collection | root / top-level | 1 | itemReceipts |  |
| src/shared/services/firebaseService.ts:1075 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/firebaseService.ts:1078 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/firebaseService.ts:1088 | client | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| src/shared/services/firebaseService.ts:1111 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:1128 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/shared/services/productionWorkDocumentService.ts:59 | client | collection | root / top-level | 1 | productionWorkDocumentLines |  |
| src/shared/services/productionWorkDocumentService.ts:66 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocuments/{header.id} |  |
| src/shared/services/productionWorkDocumentService.ts:73 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocumentLines/{id} |  |
| src/shared/services/productionWorkDocumentService.ts:87 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocumentLines/{line.id} |  |
| src/features/admin/useDocSheetTitles.ts:12 | client | collection | root / top-level | 1 | docSheetTitles |  |
| src/shared/services/cashAccountOpeningUpdate.ts:10 | client | collection | root / top-level | 1 | cashEntries |  |
| src/shared/services/cashAccountOpeningUpdate.ts:11 | client | doc | root / top-level-candidate | 미해석 | cashAccounts/{original.id} |  |
| src/shared/services/cashAccountOpeningUpdate.ts:12 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-cash-${companyId}-${original.id}`} |  |
| src/shared/services/unpackService.ts:60 | client | doc | root / top-level-candidate | 미해석 | items/{plan.canItemId} |  |
| src/shared/services/unpackService.ts:61 | client | doc | root / top-level-candidate | 미해석 | items/{plan.bulkItemId} |  |
| src/shared/services/unpackService.ts:62 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(operationId)} |  |
| src/shared/services/unpackService.ts:80 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(bulkCompany, plan.bulkItemId)} |  |
| src/shared/services/unpackService.ts:223 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/unpackService.ts:291 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/pendingFlowQuantityService.ts:13 | client | doc | root / top-level-candidate | 미해석 | {type === '입고' ? 'purchaseOrders' : 'returnRequests'}/{id} |  |
| src/shared/services/workOrderResetService.ts:9 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`workOrderReset_${companyId}`} | appMeta |
| src/shared/services/workOrderResetService.ts:20 | client | collection | root / top-level | 1 | workOrderItems |  |
| src/shared/services/deleteIssuedStatementService.ts:16 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{id} |  |
| src/shared/services/deleteIssuedStatementService.ts:22 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${partnerId}`} | appMeta |
| src/shared/services/deleteIssuedStatementService.ts:32 | client | collection | root / top-level-candidate | 미해석 | {name} |  |
| src/shared/services/deleteIssuedStatementService.ts:36 | client | doc | root / top-level-candidate | 미해석 | {name}/{value} |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:21 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:34 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:51 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:74 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:89 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} | appMeta |
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
| src/shared/services/boxUnpackService.ts:23 | client | doc | root / top-level-candidate | 미해석 | items/{boxItemId} |  |
| src/shared/services/boxUnpackService.ts:24 | client | doc | root / top-level-candidate | 미해석 | items/{unitItemId} |  |
| src/shared/services/boxUnpackService.ts:25 | client | doc | root / top-level-candidate | 미해석 | itemUnpackMovements/{operationId} | itemUnpackMovements |
| src/shared/services/pushTokenService.ts:12 | client | doc | root / top-level-candidate | 미해석 | employees/{employeeId} |  |
| src/features/admin/orderItemStock.ts:115 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/features/admin/orderItemStock.ts:205 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/features/admin/orderItemStock.ts:247 | client | doc | root / top-level-candidate | 미해석 | orders/{orderMutation.orderId} |  |
| src/features/admin/orderItemStock.ts:258 | client | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| src/features/admin/orderItemStock.ts:319 | client | doc | root / top-level-candidate | 미해석 | orders/{orderMutation.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:135 | client | doc | root / top-level-candidate | 미해석 | orderStatusAudits/{ticket.operationId} |  |
| src/features/admin/orderInventoryCancellation.ts:147 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:171 | client | doc | root / top-level-candidate | 미해석 | orders/{ticket.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:182 | client | doc | root / top-level-candidate | 미해석 | orders/{ticket.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:236 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/features/admin/orderInventoryCancellation.ts:284 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/features/admin/orderStockEngine.ts:360 | client | doc | root / top-level-candidate | 미해석 | orders/{order.id} |  |
| src/features/admin/orderStockEngine.ts:640 | client | doc | root / top-level-candidate | 미해석 | orders/{id} |  |
| src/shared/ledgerLotCheck.ts:66 | client | doc | root / top-level-candidate | 미해석 | items/{rawItemId} |  |
| src/shared/ledgerLotCheck.ts:67 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/ledgerLotCheck.ts:68 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| components/OfficeTalk.tsx:202 | client | collection | root / top-level | 1 | chatMessages |  |
| src/shared/services/recordLoanMovement.ts:54 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| src/shared/services/recordLoanMovement.ts:54 | client | doc | root / top-level-candidate | 미해석 | loanContracts/{input.loanId} |  |
| src/shared/services/recordLoanCashEntry.ts:11 | client | doc | root / top-level-candidate | 미해석 | loanContracts/{entry.loanId} |  |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:13 | client | doc | root / top-level-candidate | 미해석 | {write.collection}/{write.id} |  |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:16 | client | doc | root / top-level-candidate | 미해석 | {write.collection}/{write.id} |  |
| src/shared/services/payrollCommands.ts:16 | client | doc | root / top-level-candidate | 미해석 | payrolls/{payrollDocId(companyId,input.yearMonth)} |  |
| src/shared/services/payrollCommands.ts:31 | client | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| components/HaccpChecklist.tsx:509 | client | collection | root / top-level | 1 | haccp_temp |  |
| components/HaccpChecklist.tsx:514 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'temp_zones')} |  |
| components/HaccpChecklist.tsx:1070 | client | collection | root / top-level | 1 | haccp_incoming |  |
| components/HaccpChecklist.tsx:1354 | client | collection | root / top-level | 1 | haccp_cleaning |  |
| components/HaccpChecklist.tsx:1841 | client | collection | root / top-level | 1 | haccp_sanitation |  |
| components/HaccpChecklist.tsx:1848 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'sanitation')} |  |
| components/HaccpChecklist.tsx:2516 | client | collection | root / top-level | 1 | haccp_personal_hygiene |  |
| components/HaccpChecklist.tsx:2523 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'personal_hygiene')} |  |
| components/HaccpChecklist.tsx:2867 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'personal_hygiene')} |  |
| components/HaccpChecklist.tsx:2994 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'temp_zones')} |  |
| components/HaccpChecklist.tsx:3130 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'sanitation')} |  |
| components/HaccpChecklist.tsx:3295 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'staff_tab_order')} |  |
| components/HaccpChecklist.tsx:3445 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, templateKey)} |  |
| components/HaccpChecklist.tsx:3560 | client | collection | root / top-level | 1 | haccp_periodic_sanitation |  |
| components/HaccpChecklist.tsx:3567 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'weekly_sanitation')} |  |
| components/HaccpChecklist.tsx:3576 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'monthly_sanitation')} |  |
| components/HaccpChecklist.tsx:4005 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'closing_checklist')} |  |
| components/HaccpChecklist.tsx:4108 | client | collection | root / top-level | 1 | haccp_closing_checklist |  |
| components/HaccpChecklist.tsx:4115 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'closing_checklist')} |  |
| components/HaccpChecklist.tsx:4468 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'haccp_tab_order')} |  |
| components/BenzopyreneLog.tsx:49 | client | collection | root / top-level | 1 | benzopyreneTests |  |
| src/shared/services/confirmedCashBalance.ts:9 | client | doc | root / top-level-candidate | 미해석 | cashAccounts/{original.id} |  |
| src/features/admin/AdminApp.tsx:486 | client | collection | root / top-level | 1 | users |  |
| src/features/admin/AdminApp.tsx:540 | client | collection | root / top-level | 1 | rawInventories |  |
| src/features/admin/AdminApp.tsx:541 | client | collection | root / top-level | 1 | items |  |
| src/features/admin/AdminApp.tsx:4992 | client | collection | root / top-level | 1 | partner_item |  |
| src/features/admin/AdminApp.tsx:5021 | client | doc | root / top-level-candidate | 미해석 | partner_item/{id} |  |
| src/shared/employeeAuth.ts:19 | client | doc | root / top-level-candidate | 미해석 | employees/{credential.user.uid} |  |
| functions/src/releaseGate.ts:5 | server | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| functions/src/releaseGate.ts:5 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/newScopeCounter.ts:30 | server | collection | root / top-level-candidate | 미해석 | {name} |  |
| functions/src/newScopeCounter.ts:56 | server | collection | root / top-level | 1 | items |  |
| functions/src/newScopeCounter.ts:56 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/newScopeCounter.ts:56 | server | collection | root / top-level | 1 | oemReceiptOperations | oemReceiptOperations |
| functions/src/voucherIssue.ts:70 | server | doc | root / top-level-candidate | 미해석 | {kind}/{operationId} |  |
| functions/src/voucherIssue.ts:70 | server | collection | root / top-level-candidate | 미해석 | {kind} |  |
| functions/src/voucherIssue.ts:71 | server | doc | root / top-level-candidate | 미해석 | {kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries'}/{operationId} |  |
| functions/src/voucherIssue.ts:71 | server | collection | root / top-level-candidate | 미해석 | {kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries'} |  |
| functions/src/voucherIssue.ts:72 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, tradeDate, prefix)} | appMeta |
| functions/src/voucherIssue.ts:72 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/voucherIssue.ts:73 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, tradeDate, '추가')} | appMeta |
| functions/src/voucherIssue.ts:73 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/autoVoucherCommand.ts:16 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/autoVoucherCommand.ts:21 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/editIssuedStatementCommand.ts:36 | server | doc | root / top-level | 1 | appMeta/releaseCutover | appMeta |
| functions/src/editIssuedStatementCommand.ts:37 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{statementId} |  |
| functions/src/editIssuedStatementCommand.ts:37 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/editIssuedStatementCommand.ts:38 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{operationId} | voucherMutationOperations |
| functions/src/editIssuedStatementCommand.ts:38 | server | collection | root / top-level | 1 | voucherMutationOperations | voucherMutationOperations |
| functions/src/editIssuedStatementCommand.ts:39 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/employeeLogin.ts:32 | server | doc | root / top-level-candidate | 미해석 | authLoginAttempts/{loginKey(username, request.rawRequest.ip ?? 'unknown')} | authLoginAttempts |
| functions/src/employeeLogin.ts:32 | server | collection | root / top-level | 1 | authLoginAttempts | authLoginAttempts |
| functions/src/employeeLogin.ts:39 | server | collection | root / top-level | 1 | employees |  |
| functions/src/tradeStatementIssue.ts:93 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{raw.id} |  |
| functions/src/tradeStatementIssue.ts:93 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/tradeStatementIssue.ts:94 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{raw.id} |  |
| functions/src/tradeStatementIssue.ts:94 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/tradeStatementIssue.ts:95 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '')} | appMeta |
| functions/src/tradeStatementIssue.ts:95 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/tradeStatementIssue.ts:96 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '추가')} | appMeta |
| functions/src/tradeStatementIssue.ts:96 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/tradeStatementIssue.ts:97 | server | doc | root / top-level-candidate | 미해석 | partners/{raw.partnerId} |  |
| functions/src/tradeStatementIssue.ts:97 | server | collection | root / top-level | 1 | partners |  |
| functions/src/tradeStatementIssue.ts:98 | server | doc | root / top-level-candidate | 미해석 | orders/{id} |  |
| functions/src/tradeStatementIssue.ts:98 | server | collection | root / top-level | 1 | orders |  |
| functions/src/tradeStatementIssue.ts:99 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{id} |  |
| functions/src/tradeStatementIssue.ts:99 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:100 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{newPo.id} |  |
| functions/src/tradeStatementIssue.ts:100 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:101 | server | doc | root / top-level-candidate | 미해석 | items/{c.itemId} |  |
| functions/src/tradeStatementIssue.ts:101 | server | collection | root / top-level | 1 | items |  |
| functions/src/tradeStatementIssue.ts:103 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/tradeStatementIssue.ts:103 | server | collection | root / top-level | 1 | items |  |
| functions/src/tradeStatementIssue.ts:105 | server | doc | root / top-level-candidate | 미해석 | itemCostHistory/{`${raw.id}_${c.itemId}_${c.sourceLineIndex}`} |  |
| functions/src/tradeStatementIssue.ts:105 | server | collection | root / top-level | 1 | itemCostHistory |  |
| functions/src/tradeStatementIssue.ts:106 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:107 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`poCardNo_${companyId}_${cardNo}`} | appMeta |
| functions/src/tradeStatementIssue.ts:107 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/tradeStatementIssue.ts:109 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/tradeStatementIssue.ts:111 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/tradeStatementIssue.ts:217 | server | doc | root / top-level-candidate | 미해석 | itemCostHistory/{`${raw.id}_${cost.itemId}_${cost.sourceLineIndex}`} |  |
| functions/src/tradeStatementIssue.ts:217 | server | collection | root / top-level | 1 | itemCostHistory |  |
| functions/src/oemFeeVoucher.ts:70 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| functions/src/oemFeeVoucher.ts:70 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemFeeVoucher.ts:71 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`OEMFEE-${poId}`} |  |
| functions/src/oemFeeVoucher.ts:71 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/oemFeeVoucher.ts:72 | server | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${poId}`} |  |
| functions/src/oemFeeVoucher.ts:72 | server | collection | root / top-level | 1 | adjustmentRequests |  |
| functions/src/oemFeeVoucher.ts:73 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '가공')} | appMeta |
| functions/src/oemFeeVoucher.ts:73 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/oemFeeVoucher.ts:74 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/oemFeeVoucher.ts:75 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/oemFeeVoucher.ts:95 | server | doc | root / top-level-candidate | 미해석 | partners/{po.oemPartnerId ?? po.partnerId} |  |
| functions/src/oemFeeVoucher.ts:95 | server | collection | root / top-level | 1 | partners |  |
| functions/src/oemFeeVoucher.ts:105 | server | doc | root / top-level-candidate | 미해석 | items/{item.itemId} |  |
| functions/src/oemFeeVoucher.ts:105 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemFeeVoucher.ts:106 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/oemFeeVoucher.ts:109 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemFeeVoucher.ts:109 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:61 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.poId} |  |
| functions/src/oemReceiptCommand.ts:61 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemReceiptCommand.ts:62 | server | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${input.poId}`} |  |
| functions/src/oemReceiptCommand.ts:62 | server | collection | root / top-level | 1 | adjustmentRequests |  |
| functions/src/oemReceiptCommand.ts:63 | server | doc | root / top-level-candidate | 미해석 | oemReceiptOperations/{input.operationId} | oemReceiptOperations |
| functions/src/oemReceiptCommand.ts:63 | server | collection | root / top-level | 1 | oemReceiptOperations | oemReceiptOperations |
| functions/src/oemReceiptCommand.ts:64 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemReceiptCommand.ts:64 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:79 | server | doc | root / top-level-candidate | 미해석 | partners/{po.oemPartnerId ?? po.partnerId} |  |
| functions/src/oemReceiptCommand.ts:79 | server | collection | root / top-level | 1 | partners |  |
| functions/src/oemReceiptCommand.ts:85 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/oemReceiptCommand.ts:87 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemReceiptCommand.ts:87 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:94 | server | collection | root / top-level | 1 | item_formula |  |
| functions/src/oemReceiptCommand.ts:95 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:133 | server | doc | root / top-level-candidate | 미해석 | appMeta/{lotCounterId(companyId, input.date, material)} | appMeta |
| functions/src/oemReceiptCommand.ts:133 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/partnerPaymentCommand.ts:95 | server | doc | root / top-level-candidate | 미해석 | partnerPaymentOperations/{input.operationId} | partnerPaymentOperations |
| functions/src/partnerPaymentCommand.ts:95 | server | collection | root / top-level | 1 | partnerPaymentOperations | partnerPaymentOperations |
| functions/src/partnerPaymentCommand.ts:96 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.operationId} |  |
| functions/src/partnerPaymentCommand.ts:96 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/partnerPaymentCommand.ts:97 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.operationId} |  |
| functions/src/partnerPaymentCommand.ts:97 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerPaymentCommand.ts:98 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate)} | appMeta |
| functions/src/partnerPaymentCommand.ts:98 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/partnerPaymentCommand.ts:99 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate, '추가')} | appMeta |
| functions/src/partnerPaymentCommand.ts:99 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/partnerPaymentCommand.ts:100 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} | appMeta |
| functions/src/partnerPaymentCommand.ts:100 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/partnerPaymentCommand.ts:101 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} | appMeta |
| functions/src/partnerPaymentCommand.ts:101 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/partnerPaymentCommand.ts:102 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.cashAccountId} |  |
| functions/src/partnerPaymentCommand.ts:102 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/partnerPaymentCommand.ts:103 | server | doc | root / top-level-candidate | 미해석 | partners/{input.partnerId} |  |
| functions/src/partnerPaymentCommand.ts:103 | server | collection | root / top-level | 1 | partners |  |
| functions/src/partnerPaymentCommand.ts:109 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerPaymentCommand.ts:110 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/partnerPaymentCommand.ts:111 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/partnerPaymentCommand.ts:112 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/partnerPaymentCommand.ts:173 | server | doc | root / top-level-candidate | 미해석 | settlements/{`st-${input.operationId}-${row.statementId}`} |  |
| functions/src/partnerPaymentCommand.ts:173 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/loanMovementCommand.ts:37 | server | doc | root / top-level-candidate | 미해석 | loanMovementOperations/{input.operationId} | loanMovementOperations |
| functions/src/loanMovementCommand.ts:37 | server | collection | root / top-level | 1 | loanMovementOperations | loanMovementOperations |
| functions/src/loanMovementCommand.ts:38 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.operationId} |  |
| functions/src/loanMovementCommand.ts:38 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/loanMovementCommand.ts:39 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.operationId} |  |
| functions/src/loanMovementCommand.ts:39 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/loanMovementCommand.ts:40 | server | doc | root / top-level-candidate | 미해석 | loanContracts/{input.loanId} |  |
| functions/src/loanMovementCommand.ts:40 | server | collection | root / top-level | 1 | loanContracts |  |
| functions/src/loanMovementCommand.ts:41 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.cashAccountId} |  |
| functions/src/loanMovementCommand.ts:41 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/loanMovementCommand.ts:42 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate)} | appMeta |
| functions/src/loanMovementCommand.ts:42 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/loanMovementCommand.ts:43 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`loanMovementCutover_${companyId}`} | appMeta |
| functions/src/loanMovementCommand.ts:43 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/loanMovementCommand.ts:48 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/voucherMutationCommand.ts:26 | server | doc | root / top-level-candidate | 미해석 | {input.kind}/{input.voucherId} |  |
| functions/src/voucherMutationCommand.ts:26 | server | collection | root / top-level-candidate | 미해석 | {input.kind} |  |
| functions/src/voucherMutationCommand.ts:27 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{input.operationId} | voucherMutationOperations |
| functions/src/voucherMutationCommand.ts:27 | server | collection | root / top-level | 1 | voucherMutationOperations | voucherMutationOperations |
| functions/src/voucherMutationCommand.ts:32 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/voucherMutationCommand.ts:33 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/voucherMutationCommand.ts:34 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/voucherMutationCommand.ts:35 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/voucherMutationCommand.ts:36 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/voucherMutationCommand.ts:37 | server | collection | root / top-level | 1 | orders |  |
| functions/src/voucherMutationCommand.ts:38 | server | collection | root / top-level | 1 | pendingStatementEdits |  |
| functions/src/voucherMutationCommand.ts:39 | server | collection | root / top-level | 1 | itemCostHistory |  |
| functions/src/voucherMutationCommand.ts:40 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/voucherMutationCommand.ts:41 | server | doc | root / top-level-candidate | 미해석 | partnerPaymentOperations/{input.voucherId} | partnerPaymentOperations |
| functions/src/voucherMutationCommand.ts:41 | server | collection | root / top-level | 1 | partnerPaymentOperations | partnerPaymentOperations |
| functions/src/voucherMutationCommand.ts:42 | server | doc | root / top-level-candidate | 미해석 | loanMovementOperations/{input.voucherId} | loanMovementOperations |
| functions/src/voucherMutationCommand.ts:42 | server | collection | root / top-level | 1 | loanMovementOperations | loanMovementOperations |
| functions/src/voucherMutationCommand.ts:43 | server | doc | root / top-level-candidate | 미해석 | companyTransferOperations/{input.voucherId} | companyTransferOperations |
| functions/src/voucherMutationCommand.ts:43 | server | collection | root / top-level | 1 | companyTransferOperations | companyTransferOperations |
| functions/src/manualSettlementCommand.ts:37 | server | doc | root / top-level-candidate | 미해석 | manualSettlementOperations/{input.operationId} | manualSettlementOperations |
| functions/src/manualSettlementCommand.ts:37 | server | collection | root / top-level | 1 | manualSettlementOperations | manualSettlementOperations |
| functions/src/manualSettlementCommand.ts:38 | server | doc | root / top-level-candidate | 미해석 | settlements/{input.action === 'add' ? `manual-${input.operationId}` : input.settlementId!} |  |
| functions/src/manualSettlementCommand.ts:38 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/manualSettlementCommand.ts:39 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.statementId} |  |
| functions/src/manualSettlementCommand.ts:39 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/manualSettlementCommand.ts:40 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.cashEntryId} |  |
| functions/src/manualSettlementCommand.ts:40 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/manualSettlementCommand.ts:41 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} | appMeta |
| functions/src/manualSettlementCommand.ts:41 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/manualSettlementCommand.ts:42 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} | appMeta |
| functions/src/manualSettlementCommand.ts:42 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/manualSettlementCommand.ts:48 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/manualSettlementCommand.ts:49 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/manualSettlementCommand.ts:50 | server | doc | root / top-level-candidate | 미해석 | partners/{input.partnerId} |  |
| functions/src/manualSettlementCommand.ts:50 | server | collection | root / top-level | 1 | partners |  |
| functions/src/manualSettlementCommand.ts:114 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{row.cashEntryId} |  |
| functions/src/manualSettlementCommand.ts:114 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/manualSettlementCommand.ts:121 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{row.statementId} |  |
| functions/src/manualSettlementCommand.ts:121 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:38 | server | doc | root / top-level-candidate | 미해석 | returnOperations/{input.operationId} | returnOperations |
| functions/src/processReturnCommand.ts:38 | server | collection | root / top-level | 1 | returnOperations | returnOperations |
| functions/src/processReturnCommand.ts:39 | server | doc | root / top-level-candidate | 미해석 | returnRequests/{input.returnRequestId} |  |
| functions/src/processReturnCommand.ts:39 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/processReturnCommand.ts:40 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`return-${input.operationId}`} |  |
| functions/src/processReturnCommand.ts:40 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:41 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{`return-${input.operationId}`} | returnApplications |
| functions/src/processReturnCommand.ts:41 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/processReturnCommand.ts:42 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate, '반품')} | appMeta |
| functions/src/processReturnCommand.ts:42 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/processReturnCommand.ts:43 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`returnCutover_${companyId}`} | appMeta |
| functions/src/processReturnCommand.ts:43 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/processReturnCommand.ts:44 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} | appMeta |
| functions/src/processReturnCommand.ts:44 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/processReturnCommand.ts:64 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{request.linkedStatementId} |  |
| functions/src/processReturnCommand.ts:64 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:65 | server | doc | root / top-level-candidate | 미해석 | partners/{request.partnerId} |  |
| functions/src/processReturnCommand.ts:65 | server | collection | root / top-level | 1 | partners |  |
| functions/src/processReturnCommand.ts:66 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${request.partnerId}`} | appMeta |
| functions/src/processReturnCommand.ts:66 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/processReturnCommand.ts:70 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/processReturnCommand.ts:71 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:72 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/processReturnCommand.ts:73 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/processReturnCommand.ts:74 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/processReturnCommand.ts:75 | server | collection | root / top-level | 1 | items |  |
| functions/src/processReturnCommand.ts:76 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/processReturnCommand.ts:82 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} | returnApplications |
| functions/src/processReturnCommand.ts:82 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/processReturnCommand.ts:96 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{expected.id} |  |
| functions/src/processReturnCommand.ts:96 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:180 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} | returnApplications |
| functions/src/processReturnCommand.ts:180 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/processReturnCommand.ts:200 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{row.receiptId} |  |
| functions/src/processReturnCommand.ts:200 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:215 | server | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| functions/src/processReturnCommand.ts:215 | server | collection | root / top-level | 1 | items |  |
| functions/src/processReturnCommand.ts:216 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{row.receiptId} |  |
| functions/src/processReturnCommand.ts:216 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:219 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} | returnApplications |
| functions/src/processReturnCommand.ts:219 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/payrollVoucher.ts:80 | server | doc | root / top-level-candidate | 미해석 | employees/{line.employeeId} |  |
| functions/src/payrollVoucher.ts:80 | server | collection | root / top-level | 1 | employees |  |
| functions/src/payrollVoucher.ts:91 | server | doc | root / top-level-candidate | 미해석 | payrolls/{id} |  |
| functions/src/payrollVoucher.ts:91 | server | collection | root / top-level | 1 | payrolls |  |
| functions/src/payrollVoucher.ts:122 | server | doc | root / top-level-candidate | 미해석 | payrolls/{id} |  |
| functions/src/payrollVoucher.ts:122 | server | collection | root / top-level | 1 | payrolls |  |
| functions/src/payrollVoucher.ts:123 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{operationId(companyId, input.yearMonth)} |  |
| functions/src/payrollVoucher.ts:123 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/payrollVoucher.ts:124 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{operationId(companyId, input.yearMonth)} |  |
| functions/src/payrollVoucher.ts:124 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/payrollVoucher.ts:125 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '급여')} | appMeta |
| functions/src/payrollVoucher.ts:125 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/payrollVoucher.ts:126 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`payrollIssueCutover_${companyId}`} | appMeta |
| functions/src/payrollVoucher.ts:126 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/payrollVoucher.ts:131 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/payrollVoucher.ts:132 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/payrollVoucher.ts:134 | server | doc | root / top-level-candidate | 미해석 | employees/{line.employeeId} |  |
| functions/src/payrollVoucher.ts:134 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:45 | server | collection | root / top-level | 1 | users |  |
| functions/src/index.ts:66 | server | collection | root / top-level | 1 | users |  |
| functions/src/index.ts:126 | server | collection | root / top-level | 1 | items |  |
| functions/src/index.ts:132 | server | doc | root / top-level-candidate | 미해석 | inventorySnapshots/{co === 'taebaek' ? `inv-snap-${yearMonth}` : `inv-snap-${co}-${yearMonth}`} |  |
| functions/src/index.ts:132 | server | collection | root / top-level | 1 | inventorySnapshots |  |
| functions/src/index.ts:174 | server | collection | root / top-level | 1 | fixedCostTemplates |  |
| functions/src/index.ts:237 | server | doc | root / top-level-candidate | 미해석 | employees/{empId} |  |
| functions/src/index.ts:237 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:264 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:307 | server | doc | root / top-level-candidate | 미해석 | chatRooms/{String(msg.roomId)} |  |
| functions/src/index.ts:307 | server | collection | root / top-level | 1 | chatRooms |  |
| functions/src/index.ts:315 | server | doc | root / top-level-candidate | 미해석 | employees/{id} |  |
| functions/src/index.ts:315 | server | collection | root / top-level | 1 | employees |  |
| functions/src/interCompanyTransferCommand.ts:44 | server | doc | root / top-level-candidate | 미해석 | companyTransferOperations/{input.operationId} | companyTransferOperations |
| functions/src/interCompanyTransferCommand.ts:44 | server | collection | root / top-level | 1 | companyTransferOperations | companyTransferOperations |
| functions/src/interCompanyTransferCommand.ts:45 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{`${input.operationId}-out`} |  |
| functions/src/interCompanyTransferCommand.ts:45 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferCommand.ts:46 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{`${input.operationId}-in`} |  |
| functions/src/interCompanyTransferCommand.ts:46 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferCommand.ts:47 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{out.id} |  |
| functions/src/interCompanyTransferCommand.ts:47 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferCommand.ts:48 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{incoming.id} |  |
| functions/src/interCompanyTransferCommand.ts:48 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferCommand.ts:49 | server | doc | root / top-level-candidate | 미해석 | companyTransferGrants/{authUid} | companyTransferGrants |
| functions/src/interCompanyTransferCommand.ts:49 | server | collection | root / top-level | 1 | companyTransferGrants | companyTransferGrants |
| functions/src/interCompanyTransferCommand.ts:50 | server | doc | root / top-level-candidate | 미해석 | employees/{claims.employeeId as string} |  |
| functions/src/interCompanyTransferCommand.ts:50 | server | collection | root / top-level | 1 | employees |  |
| functions/src/interCompanyTransferCommand.ts:51 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.fromAccountId} |  |
| functions/src/interCompanyTransferCommand.ts:51 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/interCompanyTransferCommand.ts:52 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.toAccountId} |  |
| functions/src/interCompanyTransferCommand.ts:52 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/interCompanyTransferCommand.ts:53 | server | doc | root / top-level-candidate | 미해석 | partners/{input.fromPartnerId} |  |
| functions/src/interCompanyTransferCommand.ts:53 | server | collection | root / top-level | 1 | partners |  |
| functions/src/interCompanyTransferCommand.ts:54 | server | doc | root / top-level-candidate | 미해석 | partners/{input.toPartnerId} |  |
| functions/src/interCompanyTransferCommand.ts:54 | server | collection | root / top-level | 1 | partners |  |
| functions/src/interCompanyTransferCommand.ts:55 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(input.from, input.tradeDate)} | appMeta |
| functions/src/interCompanyTransferCommand.ts:55 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/interCompanyTransferCommand.ts:56 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(input.to, input.tradeDate)} | appMeta |
| functions/src/interCompanyTransferCommand.ts:56 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/interCompanyTransferCommand.ts:57 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${input.from}_${input.fromPartnerId}`} | appMeta |
| functions/src/interCompanyTransferCommand.ts:57 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/interCompanyTransferCommand.ts:58 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${input.to}_${input.toPartnerId}`} | appMeta |
| functions/src/interCompanyTransferCommand.ts:58 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/interCompanyTransferCommand.ts:59 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`companyTransferCutover_${input.from}`} | appMeta |
| functions/src/interCompanyTransferCommand.ts:59 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/interCompanyTransferCommand.ts:60 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`companyTransferCutover_${input.to}`} | appMeta |
| functions/src/interCompanyTransferCommand.ts:60 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/interCompanyTransferCommand.ts:81 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/interCompanyTransferCommand.ts:109 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferCommand.ts:110 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferCommand.ts:111 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferCommand.ts:112 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferCommand.ts:113 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/interCompanyTransferCommand.ts:190 | server | doc | root / top-level-candidate | 미해석 | settlements/{`st-${input.operationId}-${side}-${row.statementId}`} |  |
| functions/src/interCompanyTransferCommand.ts:190 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/manualSettlementBatchCommand.ts:38 | server | doc | root / top-level-candidate | 미해석 | manualSettlementBatchOperations/{input.operationId} | manualSettlementBatchOperations |
| functions/src/manualSettlementBatchCommand.ts:38 | server | collection | root / top-level | 1 | manualSettlementBatchOperations | manualSettlementBatchOperations |
| functions/src/manualSettlementBatchCommand.ts:39 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.cashEntryId} |  |
| functions/src/manualSettlementBatchCommand.ts:39 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/manualSettlementBatchCommand.ts:40 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} | appMeta |
| functions/src/manualSettlementBatchCommand.ts:40 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/manualSettlementBatchCommand.ts:41 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} | appMeta |
| functions/src/manualSettlementBatchCommand.ts:41 | server | collection | root / top-level | 1 | appMeta | appMeta |
| functions/src/manualSettlementBatchCommand.ts:46 | server | doc | root / top-level-candidate | 미해석 | partners/{input.partnerId} |  |
| functions/src/manualSettlementBatchCommand.ts:46 | server | collection | root / top-level | 1 | partners |  |
| functions/src/manualSettlementBatchCommand.ts:47 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/manualSettlementBatchCommand.ts:48 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/manualSettlementBatchCommand.ts:49 | server | collection | root / top-level | 1 | returnApplications | returnApplications |
| functions/src/manualSettlementBatchCommand.ts:129 | server | doc | root / top-level-candidate | 미해석 | settlements/{`manual-${input.operationId}-${row.statementId}`} |  |
| functions/src/manualSettlementBatchCommand.ts:129 | server | collection | root / top-level | 1 | settlements |  |

## 별도 모델 보완

shared/types.ts 외 interface/type alias 566개를 별도 목록에 기록한다. 직접 property만 나열하며 상속·교차/공용체·mapped type·객체 전개는 펼치지 않는다. UI 상태/요청/응답 모델도 있으므로 DB 필드로 단정하지 않는다. 이 목록의 필드는 기존 shared 선언 필드 통계와 사용처 집계에 합치지 않는다. shared/types.ts 안의 type alias도 기존 interface 전용 집계에서는 제외된다.

| 모델 | 선언 위치 | 종류 | 범위 | 직접 필드 |
| --- | --- | --- | --- | --- |
| RawUnit | src/constants/formula.ts:57 | type-alias | non-object-alias-not-expanded |  |
| AppConfirmOptions | src/shared/components/appDialog.ts:1 | interface | direct-properties-only | title, message, confirmText, cancelText, tone |
| AppPromptOptions | src/shared/components/appDialog.ts:9 | interface | direct-properties-only | title, message, defaultValue, placeholder, confirmText |
| ConfirmRequest | src/shared/components/appDialog.ts:17 | type-alias | non-object-alias-not-expanded |  |
| NoticeRequest | src/shared/components/appDialog.ts:18 | type-alias | direct-properties-only | kind, title, message, resolve |
| PromptRequest | src/shared/components/appDialog.ts:19 | type-alias | non-object-alias-not-expanded |  |
| AppDialogRequest | src/shared/components/appDialog.ts:20 | type-alias | non-object-alias-not-expanded |  |
| ModalShellProps | src/shared/components/ModalShell.tsx:4 | interface | direct-properties-only | title, subtitle, onClose, children, footer, className, bodyClassName, layer, size |
| LargeModalShellProps | src/shared/components/LargeModalShell.tsx:4 | type-alias | non-object-alias-not-expanded |  |
| KstDateRangeUtc | src/shared/day.ts:17 | interface | direct-properties-only | startInclusive, endExclusive |
| ProductionWorkDocument | src/features/production-documents/domain/productionWorkDocument.ts:5 | interface | direct-properties-only | id, companyId, documentDate, templateVersion, specialNotes, preparedByName, reviewedByName, approvedByName, revision, rowCount, createdAt, createdBy, updatedAt, updatedBy |
| ProductionWorkFields | src/features/production-documents/domain/productionWorkDocument.ts:22 | interface | direct-properties-only | manufacturedDate, itemId, itemNameSnapshot, specSnapshot, manufacturingLotNo, expiryDate, productionQty, productionUnit, rawItemId, rawNameSnapshot, rawUsedKg, rawLotId, rawLotNoSnapshot, workerNameSnapshot, note |
| ProductionWorkSource | src/features/production-documents/domain/productionWorkDocument.ts:40 | interface | direct-properties-only | kind, sourceId, operationId, ledgerId, lotId, recordedAt, importedAt |
| ProductionWorkDocumentLine | src/features/production-documents/domain/productionWorkDocument.ts:50 | interface | direct-properties-only | id, companyId, documentId, batchKey, sortOrder, documentRevision, source, sourceState, sourceSnapshot, manualFields |
| ProductionWorkEvidence | src/features/production-documents/domain/productionWorkDocument.ts:64 | interface | direct-properties-only | companyId, key, batchKey, fields, source, reversed |
| ProductionWorkPrintRow | src/features/production-documents/domain/productionWorkDocument.ts:158 | interface | direct-properties-only | line, showProduction, issues |
| ProductionWorkDocumentPrintProps | src/features/production-documents/ui/ProductionWorkDocumentPrint.tsx:8 | interface | direct-properties-only | document, lines |
| ProductionWorkDocumentEditorProps | src/features/production-documents/ui/ProductionWorkDocumentEditor.tsx:12 | interface | direct-properties-only | initialDocument, initialLines, loadEvidence, onSave |
| CollectionName | src/shared/collections.ts:101 | type-alias | non-object-alias-not-expanded |  |
| LotMixSetting | src/shared/lotUtils.ts:3 | interface | direct-properties-only | topPercent, ratios |
| ProductLotTake | src/shared/lotUtils.ts:320 | interface | direct-properties-only | lotId, lotNo, receivedDate, supplierName, qty |
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
| CategoryKey | src/shared/taxonomy.ts:19 | type-alias | non-object-alias-not-expanded |  |
| TaxonomyRow | src/shared/taxonomy.ts:47 | interface | direct-properties-only | id, kind, key, parent, label, order, hidden |
| Taxonomy | src/shared/taxonomy.ts:58 | interface | direct-properties-only | types, allTypes, labelOf, subtypesOf, categoriesOf, seeded |
| TypeKey | src/shared/itemTaxonomy.ts:88 | type-alias | non-object-alias-not-expanded |  |
| BomLine | src/shared/bomIndex.ts:19 | interface | direct-properties-only | childId, qty, child |
| BomDraftLine | src/shared/bomIndex.ts:36 | interface | direct-properties-only | childId, qty |
| BomParentLine | src/shared/bomIndex.ts:42 | interface | direct-properties-only | parentId, qty, parent |
| BomIndex | src/shared/bomIndex.ts:48 | interface | direct-properties-only |  |
| PackRow | src/shared/packIndex.ts:26 | interface | direct-properties-only | item_id, units_per_box |
| PackIndex | src/shared/packIndex.ts:31 | interface | direct-properties-only | of, size |
| BoxLike | src/shared/orderUnits.ts:7 | type-alias | non-object-alias-not-expanded |  |
| OrderUnitInputs | src/shared/orderUnits.ts:9 | interface | direct-properties-only | bom, pack |
| 묶음갈래 | src/shared/orderUnits.ts:39 | type-alias | non-object-alias-not-expanded |  |
| AnchorResult | src/shared/lotAnchor.ts:40 | interface | direct-properties-only | lots, deltaQty, beforeQty |
| LegacyLedgerFields | src/shared/services/rawInventoryService.ts:38 | interface | direct-properties-only | note, type, addedBy, orderId, canSize, canCount, canSizeTag, originalAmount, originalUnit |
| RawCommandOptions | src/shared/services/rawInventoryService.ts:144 | interface | direct-properties-only | now, newLotId, carryOverLotId, db, mirrorToItem, legacy |
| ItemReceipt | src/shared/receipt.ts:27 | interface | direct-properties-only | id, itemId, itemName, quantity, unit, partnerId, partnerName, date, poId, companyId, addedBy, createdAt |
| ReceiptResult | src/shared/receipt.ts:46 | interface | direct-properties-only | kind, baseName, kgIn |
| AutoJournalOptions | src/shared/autoJournal.ts:95 | interface | direct-properties-only | cashAccountCode |
| OpeningBalance | src/shared/autoJournal.ts:338 | interface | direct-properties-only | date, lines, capitalAccount |
| CompanyClaim | src/shared/companyWriteBoundary.ts:14 | type-alias | direct-properties-only | companyId |
| OpeningPartnerCode | src/shared/openingPartnerBalance.ts:5 | type-alias | non-object-alias-not-expanded |  |
| LoanContract | src/shared/loanLedger.ts:7 | interface | direct-properties-only | id, companyId, name, lenderName, partnerId, accountCode, openingDate, openingPrincipal, maturityDate, note, createdAt |
| LoanMovement | src/shared/loanLedger.ts:21 | interface | direct-properties-only | entry, principalDelta |
| LedgerRow | src/features/admin/cashLedger.ts:13 | interface | direct-properties-only | entry, balance, confirmedAccountBalance, adjustmentDelta |
| AccountLedger | src/features/admin/cashLedger.ts:21 | interface | direct-properties-only | account, opening, rows, totalIn, totalOut, totalAdjustment, closing |
| PartnerHistorySource | src/features/admin/cashLedger.ts:174 | type-alias | non-object-alias-not-expanded |  |
| PartnerLedgerRow | src/features/admin/cashLedger.ts:277 | interface | direct-properties-only | kind, id, date, label, docNo, sourceId, time, amount, balance, source, opening |
| PartnerLedger | src/features/admin/cashLedger.ts:301 | interface | direct-properties-only | rows, opening, accrued, paid, balance |
| Ev | src/features/admin/cashLedger.ts:339 | type-alias | direct-properties-only | row, ts, order |
| PartnerCashPart | src/features/admin/cashLedger.ts:608 | interface | direct-properties-only | code, reduce, note |
| CompanyWriteOperation | src/shared/services/firebaseService.ts:879 | type-alias | non-object-alias-not-expanded |  |
| ProductionDocumentWrite | src/shared/services/productionWorkDocumentService.ts:9 | interface | direct-properties-only | id, companyId, revision |
| ProductionDocumentLineWrite | src/shared/services/productionWorkDocumentService.ts:14 | interface | direct-properties-only | id, companyId, documentId |
| LedgerEvidence | src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:40 | type-alias | non-object-alias-not-expanded |  |
| AlertTone | src/shared/components/AlertModalShell.tsx:21 | type-alias | non-object-alias-not-expanded |  |
| Props | src/shared/components/AlertModalShell.tsx:36 | interface | direct-properties-only | title, tone, icon, onClose, wide, children, footer |
| ConfirmModalProps | src/shared/components/ConfirmModal.tsx:13 | interface | direct-properties-only | title, tone, icon, message, subMessage, body, confirmDisabled, footerNote, confirmText, cancelText, confirmOnly, onConfirm, onCancel |
| LineAmount | src/shared/lineAmount.ts:43 | interface | direct-properties-only | gross, supply, tax |
| Margin | src/shared/margin.ts:26 | interface | direct-properties-only | supply, cost, margin, marginRate, markupRate |
| PrintableLine | src/shared/docName.ts:44 | interface | direct-properties-only | name, spec |
| BomCostCtx | src/shared/bomCost.ts:19 | interface | direct-properties-only | allItems, formulaOf, formulaRowsOf, processingFeeOf, itemBoms |
| CostFn | src/shared/bomCost.ts:48 | interface | direct-properties-only | effective, rollup |
| CostCalcRow | src/features/admin/costCalc.ts:18 | interface | direct-properties-only | itemId, qty |
| CostCalcLine | src/features/admin/costCalc.ts:24 | interface | direct-properties-only | itemId, name, spec, unit, qty, unitCost, amount |
| CostCalcResult | src/features/admin/costCalc.ts:37 | interface | direct-properties-only | lines, cost, fee, price, margin, marginRate, markupRate |
| RawUsersDeps | src/shared/rawUsers.ts:28 | interface | direct-properties-only | allItems, bomOf, buildFormula, baseRawName |
| CreateCommand | src/shared/services/employeeCommand.ts:6 | type-alias | direct-properties-only | kind, collection, data |
| ReceiveCommand | src/shared/services/employeeCommand.ts:10 | type-alias | direct-properties-only | kind, poId, actorName, items, orderUnitInputs |
| UnpackPlan | src/shared/canUnpack.ts:36 | interface | direct-properties-only | canItemId, canName, cans, bulkItemId, bulkName, bulkUnit, perCan, bulkQty, discarded |
| UnpackReject | src/shared/canUnpack.ts:60 | type-alias | non-object-alias-not-expanded |  |
| UnpackResult | src/shared/canUnpack.ts:68 | type-alias | non-object-alias-not-expanded |  |
| UnpackLotMove | src/shared/unpackLots.ts:36 | interface | direct-properties-only | canLotId, lotNo, supplierName, receivedDate, cans, bulkQty |
| UnpackLotResult | src/shared/unpackLots.ts:48 | interface | direct-properties-only | canLots, bulkLots, moves, shortageQty |
| UnpackOutcome | src/shared/services/unpackService.ts:44 | interface | direct-properties-only | ok, message, moves |
| TemplateStatementType | src/shared/templateStatementType.ts:1 | type-alias | non-object-alias-not-expanded |  |
| TemplateSource | src/shared/templateStatementType.ts:3 | interface | direct-properties-only | statementType, dir, postMode, partnerId, transferLines |
| TradeStatementIssueInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:7 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, newPo, costUpdates |
| PartnerPaymentInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:64 | type-alias | direct-properties-only | tradeDate, partnerId, direction, amount, cashAccountId, pin, allocations, note |
| PageHeaderProps | src/shared/components/PageHeader.tsx:3 | interface | direct-properties-only | title, subtitle, right |
| OrderCreationModalHeaderProps | src/shared/components/OrderCreationModalHeader.tsx:4 | interface | direct-properties-only | currentLabel, description, onBack, onClose |
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
| ShipDeductionRow | src/shared/shipDeduction.ts:41 | interface | direct-properties-only | itemId, name, unit, qty, before, after, lotBefore, lotAfter |
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
| OrdersListProps | components/OrdersList.tsx:237 | interface | direct-properties-only | companyId, title, employees, subtitle, groupBy, allowedStatuses, orders, partners, items, partnerItems, palletStocks, itemBoms, onUpdateStatus, onUpdateDeliveryDate, onUpdateReceivedDate, onUpdatePallets, onUpdateItems, onUpdateNote, onUpdateDeliveryBoxes, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleShipmentComplete, onToggleItemChecked, onDeleteOrder, onAddClick, onPasteClick, currentUserName, highlightOrderId, onHighlightClear, newOrderId, onNewOrderIdClear, workOrderItems, onSetWorkOrderItems, onLoadHistoricalOrders, isLoadingHistoricalOrders, ordersMonths, onChangeOrdersMonths, embeddedListOnly, calendarSlot |
| OrderCardProps | components/OrdersList.tsx:302 | interface | direct-properties-only | order, partners, items, partnerItems, palletStocks, itemBoms, editingOrderId, setEditingOrderId, showAddProductSelect, setShowAddProductSelect, onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onUpdatePallets, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleItemChecked, onDeleteOrder, currentUserName, gridCols, isListView, tintedHeader, isHighlighted, highlightOrderId, readOnly, onEditOrder, onRequestShip |
| OrderSourceGroupProps | components/OrdersList.tsx:342 | interface | direct-properties-only | colId, source, orders, gridCols, collapsedCategories, onToggleCategory, partners, items, partnerItems, editingOrderId, setEditingOrderId, showAddProductSelect, setShowAddProductSelect, onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onToggleInvoicePrinted, onToggleItemChecked, onDeleteOrder, currentUserName, isListView, highlightOrderId, onCardClick, onEditOrder, tintedHeader |
| DeliveryRowProps | components/OrdersList.tsx:375 | interface | direct-properties-only | order, partnerName, items, onToggleInvoicePrinted, onUpdateDeliveryBoxes |
| TabType | components/OrdersList.tsx:383 | type-alias | non-object-alias-not-expanded |  |
| WorkItem | components/OrdersList.tsx:1701 | type-alias | direct-properties-only | key, orderId, itemId, lineKey, itemName, partnerName, qty, category, workGroup, groupId, groupName |
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
| Props | components/OemManager.tsx:17 | interface | direct-properties-only | orderUnitInputs, companyId, items, partners, rawStockKg, issueDrafts, issueOpen, receiveTarget, feeTarget, onClose, onIssue, onReceive, onIssueFee |
| IssueInput | components/OemManager.tsx:33 | type-alias | non-object-alias-not-expanded |  |
| Props | components/CategoryManager.tsx:14 | interface | direct-properties-only | onClose, onSaved, usage, companyId |
| StockClosingRow | components/ItemList.tsx:177 | interface | direct-properties-only | itemId, name, spec, boxSize, boxes, loose, total |
| StockClosing | components/ItemList.tsx:178 | interface | direct-properties-only | id, date, closedBy, createdAt, items, totalStock |
| ItemListProps | components/ItemList.tsx:189 | interface | direct-properties-only | orderUnitInputs, mode, companyId, items, orderRequests, confirmedOrders, dispatchedQtyByItem, onUpdateItem, onAddItem, onAddOrderRequest, onRemoveOrderRequest, onUpdateOrderRequestQty, onUpdatePoItemQty, onRemovePoItem, onRequestPoEdit, onToggleConfirmRequestQty, onConfirmRequest, onConfirmRequests, onBulkAddConfirmedOrders, onConfirmAllRequests, onFinishConfirmedOrder, onUpdateConfirmedQty, onUpdatePendingFlowQty, onRemoveConfirmedOrder, onEditProduct, onDeleteItem, onAddAdjustmentRequest, inboundPartners, partners, partnerItems, rawMaterialLedger, linesUsingRaw, orders, onRequestPurchaseInvoice, onOpenVoucher, issuedStatements, onAddRawMaterialEntry, onDeleteRawMaterialEntry, onLedgerChanged, currentUser, isAdmin, onUpdateSubmaterial, receivedOrders, returnRequests, returnContent, returnBadge, oemEnabled, oemIssueDrafts, rawStockKg, onOemIssue, onOemReceive, onOemIssueFee |
| MainTab | components/ItemList.tsx:262 | type-alias | non-object-alias-not-expanded |  |
| FlowTypeFilter | components/ItemList.tsx:302 | type-alias | non-object-alias-not-expanded |  |
| FlowStatusFilter | components/ItemList.tsx:303 | type-alias | non-object-alias-not-expanded |  |
| InboundSubTab | components/ItemList.tsx:304 | type-alias | non-object-alias-not-expanded |  |
| TopTab | components/ItemList.tsx:307 | type-alias | non-object-alias-not-expanded |  |
| GroupRow | components/ItemList.tsx:1192 | type-alias | direct-properties-only | p, isChild, parentId, boxCount |
| FlowRow | components/ItemList.tsx:1504 | type-alias | direct-properties-only | key, id, type, status, date, partnerName, itemSummary, quantitySummary, source |
| GridRow | components/ItemList.tsx:3484 | type-alias | direct-properties-only | itemId, label, spec, editable, isChild, group |
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
| PalletManagerProps | components/PalletManager.tsx:30 | interface | direct-properties-only | companyId, pallets, orders, partners, palletTransactions, onUpdatePallet, onAddPalletTransaction |
| Row | components/PalletManager.tsx:332 | type-alias | direct-properties-only | id, date, partner, pallet, type, quantity, status, note, txId |
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
| PushResult | src/shared/push.ts:26 | interface | direct-properties-only | ok, token, reason |
| RawUsageKg | src/features/admin/orderRawInventory.ts:12 | type-alias | non-object-alias-not-expanded |  |
| OrderRawInventoryDeps | src/features/admin/orderRawInventory.ts:14 | interface | direct-properties-only | actorName, allItems, partners, db, addNotification, runRawInventoryJob |
| OrderProductLotMutationResult | src/features/admin/orderProductLots.ts:6 | interface | direct-properties-only | lots, consumedLots |
| OrderProductLotMutation | src/features/admin/orderProductLots.ts:11 | interface | direct-properties-only | itemId, apply |
| OrderProductLotDeps | src/features/admin/orderProductLots.ts:78 | interface | direct-properties-only | allItems, shipQtyOf |
| OrderItemStockDeps | src/features/admin/orderItemStock.ts:7 | interface | direct-properties-only | db, allItems, bomIndex |
| OrderStockReservation | src/features/admin/orderItemStock.ts:17 | interface | direct-properties-only | operationId, orderId, itemIds, quantities, stockSnapshot, previousReservations, allocationQuantities, active |
| CancellationAction | src/features/admin/orderInventoryCancellation.ts:10 | type-alias | non-object-alias-not-expanded |  |
| CancellationTicket | src/features/admin/orderInventoryCancellation.ts:117 | interface | direct-properties-only | orderId, companyId, action, evidence, operationId |
| CancellationReceipt | src/features/admin/orderInventoryCancellation.ts:121 | interface | direct-properties-only | id, companyId, orderId, state, cancellation |
| CancellationResult | src/features/admin/orderInventoryCancellation.ts:125 | interface | direct-properties-only | status, operationId, code, affectedItemIds, inventoryApplied, retryable, deleted, nextStatus |
| RollbackPlan | src/features/admin/rollbackSummary.ts:15 | interface | direct-properties-only | needed, lines, text, adjustments, legacyEvidenceWarning, warnings |
| OrderDeleteAction | src/features/admin/rollbackSummary.ts:235 | type-alias | non-object-alias-not-expanded |  |
| OrderDeleteStage | src/features/admin/rollbackSummary.ts:236 | type-alias | non-object-alias-not-expanded |  |
| OrderDeleteProgress | src/features/admin/rollbackSummary.ts:239 | interface | direct-properties-only | action, state, completedStages, inventoryApplied, error, retryable |
| OrderDeletePlan | src/features/admin/rollbackSummary.ts:248 | interface | direct-properties-only | action, allowed, nextStatus, state, message, subMessage, confirmText, blockedReasons, adjustments, completedStages, inventoryApplied, retryable |
| StockUseChoice | src/features/admin/orderStockEngine.ts:25 | interface | direct-properties-only | own, loose |
| StockUsePlan | src/features/admin/orderStockEngine.ts:31 | type-alias | non-object-alias-not-expanded |  |
| OrderStatusChangeContext | src/features/admin/orderStockEngine.ts:33 | interface | direct-properties-only | approvedBy, approvedAt, approvedPlan, approvedFromStatus, orderPatch |
| PreparedOrderStatusChange | src/features/admin/orderStockEngine.ts:41 | interface | direct-properties-only | order, plan |
| OrderStockEngineDeps | src/features/admin/orderStockEngine.ts:59 | interface | direct-properties-only | orderUnitInputs, actorName, allItems, submaterials, partners, allOrders, orders, db, buildFormula, createProductionRecordsForOrder, updateItem, addItem, claimOrderOperation, runRawInventoryJob |
| Engine | src/features/admin/orderStockEngine.ts:983 | type-alias | non-object-alias-not-expanded |  |
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
| DocMismatch | src/shared/docOil.ts:309 | interface | direct-properties-only | date, saleKg, rawKg, diffKg, unmapped |
| DocDropReason | src/shared/docOil.ts:330 | type-alias | non-object-alias-not-expanded |  |
| DocDrop | src/shared/docOil.ts:331 | interface | direct-properties-only | date, partnerName, itemName, qty, reason |
| DropOrder | src/shared/docOil.ts:339 | interface | direct-properties-only | status, deliveredAt, partnerName, items |
| RawDocEntry | src/shared/docOil.ts:427 | interface | direct-properties-only | id, material, date, targetKg, type, note, createdAt |
| RawDocRow | src/shared/docOil.ts:439 | interface | direct-properties-only | date, received, used, adj, prevBalance, currentBalance, note, kind |
| RawDocSheet | src/shared/docOil.ts:450 | interface | direct-properties-only | rows, opening, closing, totalIn, totalOut |
| Ev | src/shared/docOil.ts:477 | type-alias | direct-properties-only | date, received, used, targetKg, note, kind, createdAt |
| PaymentInput | src/shared/payment.ts:21 | interface | direct-properties-only | partnerId, partnerName, type, amount, date, note, reverse, id, docNo, cashAccountId |
| WorkOrderItem | src/shared/hooks/useAppData.ts:23 | interface | direct-properties-only | id, key, orderId, itemId, itemName, partnerName, qty, category, sortIndex, date, lineKey, groupId, groupName |
| AppData | src/shared/hooks/useAppData.ts:47 | interface | direct-properties-only | orderUnitInputs, orders, purchaseOrders, items, partnerItems, setPartnerItems, partners, employees, leaveRequests, pallets, palletTransactions, adjustmentRequests, noticePosts, chatRooms, chatMessages, rawMaterialLedger, sesameInputLedger, appNotifications, workOrderItems, issuedStatements, itemFormulas, itemBoms, itemPacks, returnRequests, itemReceipts, companyInfo, accountGroups, accountCodes, fixedCostTemplates, expensePresets, cashFlowManual, cashAccounts, cashEntries, settlements, inventorySnapshots, productionSalesLogs, pendingStatementEdits, isDataLoading, refreshStaticData, historicalOrders, loadHistoricalOrders, isLoadingHistoricalOrders, ordersMonths, setOrdersMonths |
| AdminData | src/hooks/useAdminData.ts:28 | interface | direct-properties-only | fixedCosts, productionRecords |
| StatementType | src/shared/statementLines.ts:18 | type-alias | non-object-alias-not-expanded |  |
| ManualRow | src/shared/statementLines.ts:21 | interface | direct-properties-only | itemId, name, spec, qty, price, isTaxExempt, note, accountCode, side |
| LineItem | src/shared/statementLines.ts:28 | interface | direct-properties-only | itemId, lineKind, key, no, name, spec, qty, price, supply, tax, total, isTaxExempt, accountCode, side, unknownItem, taxUnknown |
| ResolvedOrderItem | src/shared/statementLines.ts:134 | interface | direct-properties-only | product, qty, perBox, unknownItem |
| OrderLinesInput | src/shared/statementLines.ts:194 | interface | direct-properties-only | order, stmtType, allItems, partnerItems, partnerId, editablePrices, taxExemptOverrides, accountCodeOverrides |
| LineTotals | src/shared/statementLines.ts:276 | interface | direct-properties-only | isTwoSided, supply, tax, amount |
| LoanMovementInput | src/shared/services/recordLoanMovement.ts:5 | type-alias | direct-properties-only | loanId, tradeDate, cashAccountId, action, principal, interest, note |
| Request | src/shared/services/recordLoanMovement.ts:9 | type-alias | non-object-alias-not-expanded |  |
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
| IntegrityArea | src/features/admin/dataIntegrityAudit.ts:19 | type-alias | non-object-alias-not-expanded |  |
| IntegritySeverity | src/features/admin/dataIntegrityAudit.ts:20 | type-alias | non-object-alias-not-expanded |  |
| IntegrityIssue | src/features/admin/dataIntegrityAudit.ts:21 | interface | direct-properties-only | id, area, severity, title, detail, date, reference |
| IntegrityAuditInput | src/features/admin/dataIntegrityAudit.ts:30 | interface | direct-properties-only | companyId, dateFrom, dateTo, orders, items, itemBoms, purchaseOrders, itemReceipts, rawMaterialLedger, rawInventories, issuedStatements, productionSalesLogs |
| LedgerMovement | src/features/admin/dataIntegrityAudit.ts:55 | type-alias | non-object-alias-not-expanded |  |
| LinePOClassify | src/features/admin/dataIntegrityAudit.ts:116 | interface | direct-properties-only | isRaw, holder, baseName, expectedKg |
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
| PayrollCommandInput | src/shared/services/payrollCommands.ts:6 | type-alias | direct-properties-only | yearMonth, payDate, lines, expectedRevision |
| HRManagerProps | components/HRManager.tsx:45 | interface | direct-properties-only | companyId, cashAccounts, employees, leaveRequests, onUpdateEmployee, onAddEmployee, onDeleteEmployee, onUpdateLeaveStatus, onUpdateLeave, onDeleteLeaveRequest, onAddLeaveRequests |
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
| MachineCleanRow | components/HaccpChecklist.tsx:1303 | interface | direct-properties-only | date, machine, used, cleanMethod, sanitizer, result, cleaner, verifier, note |
| AreaCleanRow | components/HaccpChecklist.tsx:1315 | interface | direct-properties-only | date, area, result, sanitized, sanitizer, cleaner, note |
| CleaningRecord | components/HaccpChecklist.tsx:1325 | interface | direct-properties-only | id, month, machineRows, areaRows, createdBy, createdAt, updatedBy, updatedAt, revisionCount, confirmedBy, confirmedAt |
| SlotTime | components/HaccpChecklist.tsx:1637 | type-alias | non-object-alias-not-expanded |  |
| SanitationRow | components/HaccpChecklist.tsx:1639 | interface | direct-properties-only | result, note, inspector |
| SanitationRecord | components/HaccpChecklist.tsx:1645 | interface | direct-properties-only | id, checkDate, checkZone, checkTime, rows, specialNotes, createdBy, createdAt, updatedBy, updatedAt, revisionCount, confirmedBy, confirmedAt |
| PersonalHygieneRow | components/HaccpChecklist.tsx:2470 | interface | direct-properties-only | name, checks, note |
| PersonalHygieneRecord | components/HaccpChecklist.tsx:2475 | interface | direct-properties-only | id, checkDate, rows, inspector, createdBy, createdAt, updatedBy, updatedAt, revisionCount, confirmedBy, confirmedAt |
| PeriodCycle | components/HaccpChecklist.tsx:3397 | type-alias | non-object-alias-not-expanded |  |
| PeriodRow | components/HaccpChecklist.tsx:3399 | interface | direct-properties-only | result, note, inspector |
| PeriodRecord | components/HaccpChecklist.tsx:3405 | interface | direct-properties-only | id, cycle, period, checkZone, rows, specialNotes, createdBy, createdAt, updatedBy, updatedAt, confirmedBy, confirmedAt |
| ClosingRecord | components/HaccpChecklist.tsx:3976 | interface | direct-properties-only | id, checkDate, checkZone, rows, specialNotes, createdBy, createdAt, updatedBy, updatedAt, confirmedBy, confirmedAt |
| BenzopyreneTest | components/BenzopyreneLog.tsx:11 | interface | direct-properties-only | id, productName, receivedDate, completedDate, testItem, criteria, result, judgment, lotNo, createdAt, addedBy |
| Props | components/BenzopyreneLog.tsx:28 | interface | direct-properties-only | companyId, currentUserName, isAdmin |
| DateRangeQuick | src/shared/components/DateRangeFilter.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| ReturnManagerProps | components/ReturnManager.tsx:28 | interface | direct-properties-only | companyId, items, partners, orders, issuedStatements, currentUser, isAdmin, onProcessReturn |
| Tab | components/ReturnManager.tsx:39 | type-alias | non-object-alias-not-expanded |  |
| ReturnCardProps | components/ReturnManager.tsx:432 | interface | direct-properties-only | req, isAdmin, isProcessing, onProcess |
| ReturnTab | components/ReceivingReturnsManager.tsx:15 | type-alias | non-object-alias-not-expanded |  |
| ReceivingReturnsManagerProps | components/ReceivingReturnsManager.tsx:17 | interface | direct-properties-only | companyId, items, partnerItems, partners, orders, currentUser, isAdmin, onProcessReturn, onLinkInbound |
| ReturnCardProps | components/ReceivingReturnsManager.tsx:593 | interface | direct-properties-only | req, isAdmin, isProcessing, onProcess |
| ItemFormulaRow | components/ProductionManager.tsx:10 | type-alias | direct-properties-only | parent_key, child_name, ratio, yield_rate |
| ProductionManagerProps | components/ProductionManager.tsx:28 | interface | direct-properties-only | records, items, orders, ledger, itemFormulas, onAdd, onDelete, onUpdate, currentUserName |
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
| VoucherLedgerInput | src/features/admin/useVoucherLedger.ts:32 | interface | direct-properties-only | companyId, issuedStatements, cashEntries, settlements, accountCodes, histFrom, histTo |
| CashEditLineDraft | src/shared/cashEntryEdit.ts:15 | interface | direct-properties-only | accountCode, amount, note |
| CashEditForm | src/shared/cashEntryEdit.ts:21 | interface | direct-properties-only | amount, date, dir, accountCode, note, partnerId |
| CashModalMode | components/voucher/CashEntryModal.tsx:29 | type-alias | non-object-alias-not-expanded |  |
| SettleInput | components/voucher/CashEntryModal.tsx:34 | interface | direct-properties-only | amount, date, method, note, scope |
| Props | components/voucher/CashEntryModal.tsx:43 | interface | direct-properties-only | mode, partners, companyId, accountCodes, cashAccounts, accountId, onAccountId, partnerBalances, getBalance, latestStatement, onClose, onSettle, onSaveEdit, onDeleteEntry |
| VoucherDir | src/shared/cashTemplates.tsx:26 | type-alias | non-object-alias-not-expanded |  |
| CashTemplate | src/shared/cashTemplates.tsx:56 | interface | direct-properties-only | statementType, id, label, dir, mode, accountCode, note, wantsPartner, hint, amount, partnerId, taxExempt, partnerName, builtin, group, favorite, itemName, loanCode, loanId, vat, incomeTax, transferLines, unavailableCodes, insCorp, insEmp, principal, interest, gross, deduction |
| SplitMode | src/shared/cashTemplates.tsx:143 | type-alias | non-object-alias-not-expanded |  |
| Props | components/voucher/RecurringModal.tsx:20 | interface | direct-properties-only | companyId, templates, accountCodes, partners, isIssued, onClose, onGenerate, onCreateTemplate, onUpdateTemplate, onDeleteTemplate |
| OverKind | src/shared/interCompany.ts:33 | type-alias | non-object-alias-not-expanded |  |
| TransferInput | src/shared/interCompany.ts:35 | interface | direct-properties-only | from, to, date, amount, payableToTarget, overKind, fromAccountId, toAccountId, fromPartnerId, fromPartnerName, toPartnerId, toPartnerName, note |
| TransferSplit | src/shared/interCompany.ts:54 | interface | direct-properties-only | offset, over, overKind |
| TransferResult | src/shared/interCompany.ts:68 | interface | direct-properties-only | out, in, split |
| SplitLine | src/shared/splitEntry.ts:24 | interface | direct-properties-only | accountCode, amount, note |
| EntryBase | src/shared/splitEntry.ts:27 | type-alias | non-object-alias-not-expanded |  |
| SplitInput | src/shared/splitEntry.ts:29 | interface | direct-properties-only | lines, note, fallbackNote, base, now |
| PayrollInput | src/shared/splitEntry.ts:68 | interface | direct-properties-only | gross, deduction, salaryCode, withholdCode, note, base, now |
| Props | components/voucher/VoucherComposer.tsx:50 | interface | direct-properties-only | companyId, initialDir, initialDate, partners, accountCodes, accountGroups, cashAccounts, fixedCostTemplates, cashEntries, statements, partnerBalances, getBalance, cashAccountId, onCashAccountId, onClose, onAddCashEntry, onIssueCashEntry, onAddIssuedStatement, onAddFixedCostTemplate, onAddForCompany, recordPayment, renderJournal |
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
| Props | components/CashLedger.tsx:22 | interface | direct-properties-only | companyId, cashAccounts, cashEntries, accountCodes, fixedCostTemplates, partners, issuedStatements, settlements, currentUser, onAddCashAccount, onUpdateCashAccount, onCorrectCashAccount, onAddCashEntry, onDeleteCashEntry, onAddSettlement, onDeleteSettlement |
| AccountModalProps | components/CashLedger.tsx:858 | interface | direct-properties-only | companyId, accounts, cashEntries, onClose, onAdd, onUpdate, onCorrect, onAddEntry |
| TradeStatementProps | components/TradeStatement.tsx:89 | interface | direct-properties-only | orders, allItems, partners, partnerItems, accountCodes, accountGroups, cashAccounts, cashEntries, settlements, onAddCashEntry, onIssueCashEntry, onUpdateCashEntry, onAddSettlement, onUpdateSettlement, onDeleteCashEntry, onDeleteSettlement, onAddCashAccount, onUpdateCashAccount, fixedCostTemplates, onGenerateRecurringCosts, onAddFixedCostTemplate, onUpdateFixedCostTemplate, onDeleteFixedCostTemplate, voucherMode, embedded, issuedStatements, onUpdateStatus, onUpsertPartnerItem, onAddIssuedStatement, onApplyStatement, companyId, onAddForCompany, onUpdateIssuedStatement, onProposeEdit, focusDocNo, onFocusHandled, onDeleteIssuedStatement, pendingInvoice, onClearPendingInvoice, composerOnly, onComposerClose, confirmedOrders, orderRequests, onAddConfirmedOrder, onRemoveConfirmedOrder, onRemoveOrderRequest, companyInfo, onSaveCompanyInfo, onUpdateItemCost, onUpdateOrder, currentUserId, defaultTab, expensePresets, onAddExpensePreset, onDeleteExpensePreset |
| StatementType | components/TradeStatement.tsx:168 | type-alias | non-object-alias-not-expanded |  |
| Period | src/shared/ui/PeriodPicker.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| PeriodPickerProps | src/shared/ui/PeriodPicker.tsx:20 | interface | direct-properties-only | period, setPeriod, years, selectedYear, setSelectedYear, selectedQuarter, setSelectedQuarter, selectedHalf, setSelectedHalf, customStart, setCustomStart, customEnd, setCustomEnd, quarterAvailable, halfAvailable, yearlyAvailable, 당월, alwaysShowDates |
| LedgerTone | src/shared/ui/LedgerCard.tsx:22 | type-alias | non-object-alias-not-expanded |  |
| CostManagerProps | components/CostManager.tsx:6 | interface | direct-properties-only | fixedCosts, fixedCostTemplates, issuedStatements, accountCodes, onAdd, onDelete, onAddTemplate, onUpdateTemplate, onDeleteTemplate, onGenerateRecurringCosts |
| PartnerMonthlyRow | src/features/admin/partnerMonthlySettlement.ts:5 | interface | direct-properties-only | partnerId, opening, sales, cashReceived, cashRefunded, nonCashDecrease, receivableIncrease, closing, discrepancy |
| NamedSettlementRow | src/features/admin/partnerMonthlyPdf.ts:11 | type-alias | non-object-alias-not-expanded |  |
| InventoryValuationItem | functions/src/shared/inventoryValuation.ts:1 | interface | direct-properties-only | id, companyId, type, stock, cost |
| InventoryValuationLine | functions/src/shared/inventoryValuation.ts:9 | interface | direct-properties-only | id, stock, cost, value |
| CompanyInventoryValuation | functions/src/shared/inventoryValuation.ts:16 | interface | direct-properties-only | basis, companyId, rawValue, value, lines |
| MainTab | components/ProfitAnalysis.tsx:30 | type-alias | non-object-alias-not-expanded |  |
| ProfitAnalysisProps | components/ProfitAnalysis.tsx:32 | interface | direct-properties-only | issuedStatements, fixedCostTemplates, onAddTemplate, onUpdateTemplate, onDeleteTemplate, partners, items, costOf, onUpdateIssuedStatement, accountGroups, accountCodes, onUpdateAccountCode, onAddAccountCode, onDeleteAccountCode, onAddAccountGroup, onUpdateAccountGroup, onDeleteAccountGroup, inventorySnapshots, onSaveInventorySnapshot, onGenerateRecurringCosts, cashFlowManual, onSaveCashFlowManual, cashEntries, onAddCashEntry, settlements, companyId, initialTab |
| AccountTally | src/shared/journal.ts:35 | interface | direct-properties-only | accountCode, debit, credit |
| TrialBalanceRow | src/shared/journal.ts:60 | interface | direct-properties-only | accountCode, name, type, debit, credit, balance |
| TrialBalance | src/shared/journal.ts:65 | interface | direct-properties-only | rows, totalDebit, totalCredit, balanced |
| IncomeStatement | src/shared/journal.ts:112 | interface | direct-properties-only | revenue, expense, netIncome |
| BalanceSheet | src/shared/journal.ts:122 | interface | direct-properties-only | asset, liability, equity, netIncome, balanced |
| OpeningDoc | components/FinancialReports.tsx:17 | interface | direct-properties-only | id, date, amounts, hasLoanOpening, hasCashOpening, hasInventoryOpening |
| Props | components/FinancialReports.tsx:19 | interface | direct-properties-only | companyId, statements, cashEntries, accounts, cashAccounts, partners, items, inventorySnapshots |
| Props | components/LoanManager.tsx:17 | interface | direct-properties-only | companyId, cashEntries, cashAccounts, partners, currentUserName, onAddCashEntry |
| Props | components/PartnerLedger.tsx:14 | interface | direct-properties-only | companyId, issuedStatements, cashEntries, cashAccounts, accountCodes, settlements, onOpenVoucher |
| AdminAppProps | src/features/admin/AdminApp.tsx:247 | interface | direct-properties-only | currentUser, companyId, isAdmin, isAdminAuthenticated, onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData, onPreviewStaff, onExitPreview |
| NewOrderDraft | src/features/admin/AdminApp.tsx:1450 | type-alias | non-object-alias-not-expanded |  |
| RightRow | src/features/admin/AdminApp.tsx:3179 | type-alias | direct-properties-only | 상호, 품목, spec, 수량, 소비기한, 제조일자, orderItems |
| WRow | src/features/admin/AdminApp.tsx:3586 | type-alias | direct-properties-only | spec, 수량, mfgDate |
| UsageRow | src/features/admin/AdminApp.tsx:3891 | type-alias | direct-properties-only | date, received, used, note, type, id, createdAt, targetKg, addedBy, orderId |
| WRow | src/features/admin/AdminApp.tsx:4338 | type-alias | direct-properties-only | spec, 수량, mfgDate |
| StaffAppProps | src/features/staff/StaffApp.tsx:23 | interface | direct-properties-only | currentUser, companyId, isAdminAuthenticated, onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData, onExitPreview |
| Window | src/global.d.ts:3 | interface | direct-properties-only | __chunkErrorHandled |
| AppAlert | src/shared/components/AppAlertHost.tsx:5 | interface | direct-properties-only | id, title, message, tone |
| LoginResponse | src/shared/employeeAuth.ts:7 | type-alias | direct-properties-only | customToken, employee |
| LoginApp | src/shared/employeeAuth.ts:9 | type-alias | non-object-alias-not-expanded |  |
| AuthPageProps | src/shared/components/AuthPage.tsx:6 | interface | direct-properties-only | onLogin, app |
| PartnerPortalProps | components/PartnerPortal.tsx:18 | interface | direct-properties-only | partners, items, partnerItems, onOrderSubmit, onExit |
| Company | functions/src/autoVoucherDraft.ts:1 | type-alias | non-object-alias-not-expanded |  |
| Template | functions/src/autoVoucherDraft.ts:2 | type-alias | direct-properties-only | id, companyId, autoIssue, kind, name, itemName, amount, accountCode, issueDay, startYm, endYm, statementType, dir, postMode, mode, loanId, principal, interest, transferLines, partnerId, partnerName, taxExempt |
| Draft | functions/src/autoVoucherDraft.ts:11 | type-alias | direct-properties-only | kind, companyId, operationId, tradeDate, document |
| AutoVoucherDecision | functions/src/autoVoucherDraft.ts:12 | type-alias | non-object-alias-not-expanded |  |
| Kind | functions/src/voucherIssue.ts:7 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/voucherIssue.ts:8 | type-alias | direct-properties-only | kind, operationId, tradeDate, prefix, document, releaseId |
| Attempt | functions/src/employeeLogin.ts:12 | type-alias | direct-properties-only | failures, windowStartedAt, blockedUntil |
| 들어온것 | functions/src/extractOrder.ts:36 | interface | direct-properties-only | text, catalog, partners, history, today |
| Row | functions/src/tradeStatementIssue.ts:8 | type-alias | non-object-alias-not-expanded |  |
| Cost | functions/src/tradeStatementIssue.ts:9 | type-alias | direct-properties-only | itemId, price, beforeCost, sourceLineIndex |
| Input | functions/src/tradeStatementIssue.ts:10 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, newPo, costUpdates, releaseId |
| Row | functions/src/oemFeeVoucher.ts:8 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/oemFeeVoucher.ts:9 | type-alias | direct-properties-only | poId, perKg, statement, releaseId |
| Row | functions/src/oemReceiptCommand.ts:7 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/oemReceiptCommand.ts:8 | type-alias | direct-properties-only | poId, operationId, date, returns, bulk, unitPricePerKg, releaseId |
| Result | functions/src/oemReceiptCommand.ts:17 | type-alias | direct-properties-only | status, receivedKg, loss, lotNos |
| Claim | functions/src/partnerPaymentPlan.ts:2 | type-alias | direct-properties-only | id, companyId, partnerId, tradeDate, amount, accountCode |
| PaymentCash | functions/src/partnerPaymentPlan.ts:6 | type-alias | direct-properties-only | id, companyId, partnerId, parts |
| PaymentSettlement | functions/src/partnerPaymentPlan.ts:10 | type-alias | direct-properties-only | id, statementId, cashEntryId, amount |
| ReturnApplication | functions/src/partnerPaymentPlan.ts:11 | type-alias | direct-properties-only | id, companyId, partnerId, statementId, amount |
| PaymentPlanInput | functions/src/partnerPaymentPlan.ts:12 | type-alias | direct-properties-only | companyId, partnerId, direction, amount, pin, allocations, claims, cashEntries, settlements |
| PaymentPlan | functions/src/partnerPaymentPlan.ts:17 | type-alias | direct-properties-only | lines, applications, settlements, ignoredOrphanSettlementIds |
| Row | functions/src/partnerPaymentCommand.ts:11 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/partnerPaymentCommand.ts:12 | type-alias | direct-properties-only | operationId, tradeDate, partnerId, direction, amount, cashAccountId, pin, allocations, expectedRevision, releaseId, note |
| LoanSnapshot | functions/src/loanMovementPlan.ts:2 | type-alias | direct-properties-only | id, companyId, accountCode, openingDate, openingPrincipal |
| LoanCash | functions/src/loanMovementPlan.ts:6 | type-alias | direct-properties-only | id, companyId, loanId, date, createdAt, dir, amount, accountCode, lines |
| LoanMovementRequest | functions/src/loanMovementPlan.ts:12 | type-alias | direct-properties-only | action, principal, interest |
| LoanMovementPlan | functions/src/loanMovementPlan.ts:13 | type-alias | direct-properties-only | balanceBefore, balanceAfter, principalDelta, dir, amount, accountCode, lines |
| Row | functions/src/loanMovementCommand.ts:9 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/loanMovementCommand.ts:10 | type-alias | direct-properties-only | operationId, loanId, tradeDate, cashAccountId, action, principal, interest, expectedRevision, releaseId, note |
| Kind | functions/src/voucherMutationCommand.ts:6 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/voucherMutationCommand.ts:7 | type-alias | direct-properties-only | operationId, kind, voucherId, action, expectedRevision, releaseId, note |
| Row | functions/src/voucherMutationCommand.ts:9 | type-alias | non-object-alias-not-expanded |  |
| Action | functions/src/manualSettlementCommand.ts:9 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/manualSettlementCommand.ts:10 | type-alias | direct-properties-only | operationId, action, partnerId, cashEntryId, statementId, amount, expectedAmount, settlementId, expectedRevision, releaseId |
| Line | functions/src/returnReversalPlan.ts:2 | type-alias | direct-properties-only | itemId, accountCode, qty, supply, tax, total |
| ReturnItem | functions/src/returnReversalPlan.ts:3 | type-alias | direct-properties-only | itemId, quantity, isResellable |
| ReturnRow | functions/src/returnReversalPlan.ts:4 | type-alias | direct-properties-only | id, companyId, linkedStatementId, partnerId, status, returnType, totalAmount, items |
| Source | functions/src/returnReversalPlan.ts:6 | type-alias | direct-properties-only | id, companyId, type, partnerId, totalSupply, totalTax, totalAmount, items |
| JournalLine | functions/src/returnReversalPlan.ts:8 | type-alias | direct-properties-only | accountCode, side, amount |
| Item | functions/src/returnGeneralStockPlan.ts:3 | type-alias | direct-properties-only | id, companyId, type, subtype, rawMaterialName, name, unit, stock, lots |
| Input | functions/src/returnGeneralStockPlan.ts:5 | type-alias | direct-properties-only | operationId, companyId, date, createdAt, partnerId, partnerName, item, quantityDelta, rawTargetExists |
| ReturnClaim | functions/src/returnAllocationPlan.ts:2 | type-alias | direct-properties-only | id, companyId, partnerId, direction, tradeDate, amount, cashApplied |
| PriorReturnAllocation | functions/src/returnAllocationPlan.ts:6 | type-alias | direct-properties-only | returnId, statementId, amount |
| ReturnAllocationInput | functions/src/returnAllocationPlan.ts:9 | type-alias | direct-properties-only | returnId, companyId, partnerId, direction, amount, linkedStatementId, claims, priorAllocations |
| Row | functions/src/processReturnCommand.ts:14 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/processReturnCommand.ts:15 | type-alias | direct-properties-only | operationId, returnRequestId, tradeDate, expectedPartnerRevision, releaseId |
| Mode | functions/src/payrollVoucher.ts:8 | type-alias | non-object-alias-not-expanded |  |
| Line | functions/src/payrollVoucher.ts:9 | type-alias | direct-properties-only | employeeId, employeeName, base, overtime, allowance, incomeTax, localTax, pension, health, employment, otherDeduct, department, position, note |
| Input | functions/src/payrollVoucher.ts:12 | type-alias | direct-properties-only | yearMonth, payDate, lines, expectedRevision, mode, releaseId, cashAccountId |
| DraftInput | functions/src/payrollVoucher.ts:14 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/interCompanyTransferCommand.ts:11 | type-alias | non-object-alias-not-expanded |  |
| Claims | functions/src/interCompanyTransferCommand.ts:12 | type-alias | direct-properties-only | employeeId, companyId, isAdmin |
| Input | functions/src/interCompanyTransferCommand.ts:13 | type-alias | direct-properties-only | operationId, from, to, tradeDate, amount, overKind, fromAccountId, toAccountId, fromPartnerId, toPartnerId, expectedFromRevision, expectedToRevision, releaseId, note |
| Allocation | functions/src/manualSettlementBatchCommand.ts:9 | type-alias | direct-properties-only | statementId, amount |
| Input | functions/src/manualSettlementBatchCommand.ts:10 | type-alias | direct-properties-only | operationId, cashEntryId, partnerId, allocations, expectedPartnerRevision, releaseId |

## 미해석 속성 접근 조사 목록

이 목록은 속성 선언을 해석하지 못한 위치와 수신 객체 타입이다. DB 필드 목록이 아니며 any/unknown·동적/런타임 접근을 실제 소스에서 분류해야 한다. 미해석 숫자 0을 완료 조건으로 바꾸지 않는다.

| 위치 | 식 | 수신 타입 | 미해석 이유 |
| --- | --- | --- | --- |
| src/shared/releaseGate.ts:2 | gate?.status | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/shared/releaseGate.ts:2 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/releaseGate.ts:3 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/releaseGate.ts:5 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:91 | data.lastStocktakeDate | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:91 | data.lastStocktakeDate | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:92 | data.stocktakeAnchor | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:96 | data.lastStocktakeOperationId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:97 | data.version | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:100 | data.id | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:101 | data.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:102 | data.rawItemId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:103 | data.materialSnapshot | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:104 | data.stockKg | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:105 | data.activeLots | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:105 | data.activeLots | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:106 | data.recentDepletedLots | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:106 | data.recentDepletedLots | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:108 | data.revision | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:108 | data.version | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:109 | data.lastProcessedAt | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:109 | data.updatedAt | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:117 | data.commandHash | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:118 | data.effectiveAt | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:118 | data.date | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:119 | data.lotChanges | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:119 | data.lotChanges | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:120 | ch.afterKg | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:120 | ch.kgAfter | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:121 | ch.deltaKg | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:125 | ch.beforeKg | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:127 | ch.lotSnapshot | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:128 | ch.lotId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:128 | data.materialSnapshot | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:128 | data.material | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:129 | ch.supplierName | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:130 | ch.receivedDate | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:130 | data.date | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:133 | data.recordedAt | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:133 | data.createdAt | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:221 | itemData.rawMaterialName | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:221 | itemData.name | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:235 | itemData?.lots | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:250 | itemData?.stock | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:285 | patch.stock | Record<string, unknown> | property-symbol-unresolved |
| src/shared/companyWriteBoundary.ts:28 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/companyWriteBoundary.ts:28 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:131 | snap.data()?.hasPartnerOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:131 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:131 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:131 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:131 | snap.data()?.date | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:135 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:139 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:140 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:144 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:145 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:149 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:149 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:157 | snap.data()?.hasPartnerOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:158 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:159 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:160 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:167 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:196 | saved.items?.find((i: { accountCode: string }) => i.accountCode === code)?.total | any | any-receiver |
| src/shared/services/firebaseService.ts:196 | saved.items?.find | any | any-receiver |
| src/shared/services/firebaseService.ts:208 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:231 | openingData?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:252 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:273 | latest?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:310 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:338 | openingData?.date | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:364 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:441 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:550 | data.cashEntryId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:551 | data.statementId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:553 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:554 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:558 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:561 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:564 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:737 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:771 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:920 | data.companyId | any | any-receiver |
| src/shared/services/firebaseService.ts:958 | (await getDoc(poRef)).data()?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:27 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:29 | header.documentDate | ProductionDocumentWrite | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:30 | header.documentDate | ProductionDocumentWrite | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:30 | header.documentDate | ProductionDocumentWrite | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:31 | header.documentDate | ProductionDocumentWrite | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:70 | current?.revision | DocumentData \| null | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:82 | current?.createdAt | DocumentData \| null | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:83 | current?.createdBy | DocumentData \| null | property-symbol-unresolved |
| src/shared/services/cashAccountOpeningUpdate.ts:41 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:22 | data.items | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:22 | data.items | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:23 | data.items | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:24 | row.itemId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:25 | row.quantity | Record<string, any> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:25 | row.quantity | Record<string, any> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:25 | row.quantity | Record<string, any> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:28 | data.partnerId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:33 | data.createdAt | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/unpackService.ts:233 | previous.targetQty | any | any-receiver |
| src/shared/services/deleteIssuedStatementService.ts:6 | row.orderId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/deleteIssuedStatementService.ts:7 | row.purchaseOrderIds | Record<string, any> | property-symbol-unresolved |
| src/shared/services/deleteIssuedStatementService.ts:7 | row.purchaseOrderIds | Record<string, any> | property-symbol-unresolved |
| src/shared/services/deleteIssuedStatementService.ts:7 | row.confirmedProductIds | Record<string, any> | property-symbol-unresolved |
| src/shared/services/deleteIssuedStatementService.ts:7 | row.confirmedProductIds | Record<string, any> | property-symbol-unresolved |
| src/shared/services/deleteIssuedStatementService.ts:7 | row.sourcePoId | Record<string, any> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:22 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:35 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:52 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:75 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| components/AddItemModal.tsx:94 | pi.Direction | any | any-receiver |
| components/AddItemModal.tsx:95 | pi.Direction | any | any-receiver |
| components/AddItemModal.tsx:705 | (s as any).spec | any | any-receiver |
| components/AddItemModal.tsx:705 | (s as any).spec | any | any-receiver |
| components/AddItemModal.tsx:758 | cs.name | any | any-receiver |
| components/AddItemModal.tsx:759 | cs.stock | any | any-receiver |
| components/AddItemModal.tsx:827 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:827 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:830 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:830 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:837 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:838 | (p as any).spec | any | any-receiver |
| components/LotTimeline.tsx:35 | parts.year | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.month | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.day | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.hour | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.minute | { [k: string]: string; } | property-symbol-unresolved |
| components/ItemList.tsx:317 | (p?.lots ?? []).length | any | any-receiver |
| components/ItemList.tsx:317 | p?.lots | any | any-receiver |
| components/ItemList.tsx:318 | p.lots | any | any-receiver |
| components/ItemList.tsx:319 | p?.stock | any | any-receiver |
| components/ItemList.tsx:320 | p?.density | any | any-receiver |
| components/ItemList.tsx:320 | p.density | any | any-receiver |
| components/ItemList.tsx:548 | canvas.toBlob | any | any-receiver |
| components/ItemList.tsx:577 | (e as any)?.message | any | any-receiver |
| components/ItemList.tsx:589 | nav.canShare | any | any-receiver |
| components/ItemList.tsx:589 | nav.canShare | any | any-receiver |
| components/ItemList.tsx:590 | nav.share | any | any-receiver |
| components/ItemList.tsx:1877 | (e as any).lotChanges?.some | any | any-receiver |
| components/ItemList.tsx:1877 | (e as any).lotChanges | any | any-receiver |
| components/ItemList.tsx:1877 | change.lotId | any | any-receiver |
| components/ItemList.tsx:1879 | (e as any).source?.type | any | any-receiver |
| components/ItemList.tsx:1879 | (e as any).source | any | any-receiver |
| components/ItemList.tsx:1879 | (e as any).source?.id | any | any-receiver |
| components/ItemList.tsx:1879 | (e as any).source | any | any-receiver |
| components/AddOrderModal.tsx:62 | pi.Direction | any | any-receiver |
| components/AddOrderModal.tsx:253 | pi.partnerId | any | any-receiver |
| components/AddOrderModal.tsx:254 | pi.itemId | any | any-receiver |
| src/shared/orderExtract.ts:87 | row.source | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:87 | row.name | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:88 | row.itemId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:95 | row.qty | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:105 | row.isBox | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:105 | row.isBox | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:106 | row.source | Record<string, unknown> | property-symbol-unresolved |
| components/PasteOrderModal.tsx:126 | pi.Direction | any | any-receiver |
| components/PasteOrderModal.tsx:201 | r.partnerId | any | any-receiver |
| components/PasteOrderModal.tsx:201 | r.Direction | any | any-receiver |
| components/PasteOrderModal.tsx:203 | r.itemId | any | any-receiver |
| src/shared/push.ts:97 | e?.message | any | any-receiver |
| src/features/admin/orderItemStock.ts:152 | snapshots[index]!.data()?.stock | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:104 | patch.lots | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:111 | patch.lots | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:136 | value?.state | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:137 | value.id | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:137 | value.orderId | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:137 | value.companyId | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:138 | value.cancellation?.action | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:138 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:138 | value.cancellation?.evidence | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:138 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:139 | value.cancellation?.deleted | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:139 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:215 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:215 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:216 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:277 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:279 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:280 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:296 | write.ref.path | any | any-receiver |
| src/shared/noticeImage.ts:18 | error.code | any | any-receiver |
| components/ItemManager.tsx:430 | (pc as any).partnerId | any | any-receiver |
| components/ItemManager.tsx:431 | (pc as any).itemId | any | any-receiver |
| src/shared/notify.ts:86 | (window as any).webkitAudioContext | any | any-receiver |
| src/shared/officeTalkTime.ts:34 | parts.year | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/officeTalkTime.ts:34 | parts.month | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/officeTalkTime.ts:34 | parts.day | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/officeTalkTime.ts:35 | parts.hour | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/officeTalkTime.ts:35 | parts.minute | { [k: string]: string; } | property-symbol-unresolved |
| components/OfficeTalk.tsx:140 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:312 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:335 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:375 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:425 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:448 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:1214 | user.id | any | any-receiver |
| components/OfficeTalk.tsx:1215 | user.name | any | any-receiver |
| components/OfficeTalk.tsx:1222 | user.name | any | any-receiver |
| components/OfficeTalk.tsx:1223 | user.position | any | any-receiver |
| components/OfficeTalk.tsx:1223 | user.department | any | any-receiver |
| components/OfficeTalk.tsx:1384 | err?.message | any | any-receiver |
| src/shared/services/recordLoanMovement.ts:57 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:58 | contract?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:59 | contract?.movementRevision | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:72 | failure?.version | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:72 | failure.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:72 | failure.loanId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:73 | failure.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:73 | failure.operationRejected | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:74 | failure.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| components/DashboardLinks.tsx:68 | e?.message | any | any-receiver |
| components/DashboardLinks.tsx:96 | e?.message | any | any-receiver |
| components/Dashboard.tsx:74 | pi.Direction | any | any-receiver |
| src/shared/services/payrollCommands.ts:19 | row?.revision | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/payrollCommands.ts:32 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/payrollCommands.ts:33 | row?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/payrollCommands.ts:35 | row?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| components/MyPage.tsx:141 | (currentUser as any).username | any | any-receiver |
| components/AdminChecklist.tsx:76 | pi.Direction | any | any-receiver |
| components/DocumentManager.tsx:222 | e?.code | any | any-receiver |
| components/DocumentManager.tsx:222 | e?.message | any | any-receiver |
| components/DocumentManager.tsx:233 | e?.code | any | any-receiver |
| components/HaccpChecklist.tsx:27 | canvas.height | any | any-receiver |
| components/HaccpChecklist.tsx:27 | canvas.width | any | any-receiver |
| components/HaccpChecklist.tsx:32 | pdf.addPage | any | any-receiver |
| components/HaccpChecklist.tsx:33 | pdf.addImage | any | any-receiver |
| components/HaccpChecklist.tsx:33 | canvas.toDataURL | any | any-receiver |
| components/HaccpChecklist.tsx:38 | pdf.save | any | any-receiver |
| components/HaccpChecklist.tsx:1892 | canvas.height | any | any-receiver |
| components/HaccpChecklist.tsx:1892 | canvas.width | any | any-receiver |
| components/HaccpChecklist.tsx:1893 | canvas.width | any | any-receiver |
| components/HaccpChecklist.tsx:1893 | canvas.height | any | any-receiver |
| components/HaccpChecklist.tsx:1894 | pdf.addPage | any | any-receiver |
| components/HaccpChecklist.tsx:1895 | pdf.addImage | any | any-receiver |
| components/HaccpChecklist.tsx:1895 | canvas.toDataURL | any | any-receiver |
| components/HaccpChecklist.tsx:1897 | pdf.save | any | any-receiver |
| components/BenzopyreneLog.tsx:101 | canvas.height | any | any-receiver |
| components/BenzopyreneLog.tsx:101 | canvas.width | any | any-receiver |
| components/BenzopyreneLog.tsx:102 | pdf.addImage | any | any-receiver |
| components/BenzopyreneLog.tsx:102 | canvas.toDataURL | any | any-receiver |
| components/BenzopyreneLog.tsx:103 | pdf.save | any | any-receiver |
| components/VoucherTemplateManager.tsx:138 | (t as any).loanCode | any | any-receiver |
| components/VoucherTemplateManager.tsx:392 | (S as any).pick | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:51 | i.qty | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:117 | item.name | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:118 | item.spec | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:119 | (item as any).unit | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:120 | item.qty | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:121 | item.price | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:122 | item.total | any | any-receiver |
| src/shared/services/confirmedCashBalance.ts:23 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| components/TradeStatement.tsx:194 | (item as any).itemId | any | any-receiver |
| components/TradeStatement.tsx:196 | (item as any).partnerId | any | any-receiver |
| components/TradeStatement.tsx:256 | pi.Direction | any | any-receiver |
| components/TradeStatement.tsx:257 | pi.Direction | any | any-receiver |
| components/TradeStatement.tsx:342 | s.Direction | any | any-receiver |
| components/TradeStatement.tsx:342 | s.itemId | any | any-receiver |
| components/TradeStatement.tsx:342 | s.partnerId | any | any-receiver |
| components/TradeStatement.tsx:344 | s.Direction | any | any-receiver |
| components/TradeStatement.tsx:344 | s.itemId | any | any-receiver |
| components/TradeStatement.tsx:344 | s.partnerId | any | any-receiver |
| components/TradeStatement.tsx:359 | error?.message | any | any-receiver |
| components/TradeStatement.tsx:360 | error?.code | any | any-receiver |
| components/TradeStatement.tsx:1139 | ((st as any).purchaseOrderIds ?? (st as any).confirmedProductIds ?? []).forEach | any | any-receiver |
| components/TradeStatement.tsx:1139 | (st as any).purchaseOrderIds | any | any-receiver |
| components/TradeStatement.tsx:1139 | (st as any).confirmedProductIds | any | any-receiver |
| components/TradeStatement.tsx:1170 | (s as any).itemId | any | any-receiver |
| components/TradeStatement.tsx:1172 | (ps as any).partnerId | any | any-receiver |
| components/TradeStatement.tsx:1732 | e?.message | any | any-receiver |
| components/TradeStatement.tsx:1750 | e?.message | any | any-receiver |
| components/TradeStatement.tsx:2533 | error?.message | any | any-receiver |
| components/TradeStatement.tsx:2707 | (purchaseOrder as any).id | any | any-receiver |
| components/ProfitAnalysis.tsx:438 | payload?.length | any | any-receiver |
| components/ProfitAnalysis.tsx:442 | payload.map | any | any-receiver |
| components/ProfitAnalysis.tsx:443 | p.name | any | any-receiver |
| components/ProfitAnalysis.tsx:444 | p.color | any | any-receiver |
| components/ProfitAnalysis.tsx:445 | p.name | any | any-receiver |
| components/ProfitAnalysis.tsx:446 | p.value | any | any-receiver |
| components/ProfitAnalysis.tsx:637 | d.sales | any | any-receiver |
| components/ProfitAnalysis.tsx:637 | d.operatingProfit | any | any-receiver |
| components/ProfitAnalysis.tsx:637 | d.sales | any | any-receiver |
| components/LoanManager.tsx:106 | amountErrors.editBalance | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:106 | amountErrors.editOpening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:123 | amountErrors.opening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:145 | amountErrors.principal | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:145 | amountErrors.interest | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:203 | amountErrors.opening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:203 | amountErrors.opening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:203 | amountErrors.opening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:219 | amountErrors.editOpening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:220 | amountErrors.editOpening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:220 | amountErrors.editOpening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:222 | amountErrors.editBalance | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:223 | amountErrors.editBalance | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:223 | amountErrors.editBalance | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:227 | amountErrors.editBalance | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:227 | amountErrors.editOpening | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:233 | amountErrors.principal | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:233 | amountErrors.principal | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:233 | amountErrors.principal | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:234 | amountErrors.interest | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:234 | amountErrors.interest | Record<string, string> | property-symbol-unresolved |
| components/LoanManager.tsx:234 | amountErrors.interest | Record<string, string> | property-symbol-unresolved |
| components/PartnerLedger.tsx:468 | it.name | any | any-receiver |
| components/PartnerLedger.tsx:469 | it.spec | any | any-receiver |
| components/PartnerLedger.tsx:470 | it.qty | any | any-receiver |
| components/PartnerLedger.tsx:471 | it.price | any | any-receiver |
| components/PartnerLedger.tsx:472 | it.supply | any | any-receiver |
| components/PartnerLedger.tsx:473 | it.tax | any | any-receiver |
| components/PartnerLedger.tsx:474 | it.total | any | any-receiver |
| components/PartnerLedger.tsx:494 | i.name | any | any-receiver |
| src/features/admin/AdminApp.tsx:417 | e?.message | any | any-receiver |
| src/features/admin/AdminApp.tsx:599 | (pc as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:600 | (pc as any).partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:999 | e.data?.type | any | any-receiver |
| src/features/admin/AdminApp.tsx:999 | e.data.view | any | any-receiver |
| src/features/admin/AdminApp.tsx:999 | e.data.view | any | any-receiver |
| src/features/admin/AdminApp.tsx:1120 | (s as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1121 | (ps as any)?.partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1182 | (s as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1183 | (ps as any)?.partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1211 | (s as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1212 | (ps as any)?.partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:2646 | patch.sortIndex | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/AdminApp.tsx:4961 | error?.message | any | any-receiver |
| src/features/admin/AdminApp.tsx:4971 | error?.message | any | any-receiver |
| src/shared/components/AuthPage.tsx:34 | cause?.code | any | any-receiver |
| functions/src/releaseGate.ts:9 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/releaseGate.ts:16 | gate?.voucherNotBefore | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/releaseGate.ts:23 | gate?.catchUp | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/releaseGate.ts:25 | catchUp?.tradeDate | any | any-receiver |
| functions/src/releaseGate.ts:26 | catchUp?.fromDate | any | any-receiver |
| functions/src/releaseGate.ts:26 | catchUp.fromDate | any | any-receiver |
| functions/src/releaseGate.ts:27 | catchUp?.companyId | any | any-receiver |
| functions/src/releaseGate.ts:27 | catchUp?.status | any | any-receiver |
| functions/src/newScopeCounter.ts:11 | gate.data()?.oemLotCutoverDate | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/newScopeCounter.ts:17 | row?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/newScopeCounter.ts:65 | lot.receivedDate | any | any-receiver |
| functions/src/newScopeCounter.ts:65 | lot.lotNo | any | any-receiver |
| functions/src/newScopeCounter.ts:66 | lot.material | any | any-receiver |
| functions/src/newScopeCounter.ts:66 | lot.material | any | any-receiver |
| functions/src/voucherIssue.ts:40 | document.companyId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:40 | document.companyId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:43 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:43 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:43 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:48 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:48 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:49 | document.accountCode | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:49 | line.accountCode | any | any-receiver |
| functions/src/voucherIssue.ts:105 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:110 | request.data?.releaseId | any | any-receiver |
| functions/src/autoVoucherCommand.ts:22 | decision.draft.document.type | Record<string, unknown> | property-symbol-unresolved |
| functions/src/autoVoucherCommand.ts:35 | document.type | Record<string, unknown> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:13 | claims?.isAdmin | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:26 | patch.tradeDate | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:26 | patch.tradeDate | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:27 | patch.tradeDate | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:31 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:31 | patch.items.length | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:31 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:31 | patch.items.length | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:31 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:32 | patch.items.some | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:32 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:33 | line.name | Record<string, unknown> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:58 | patch.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:62 | patch.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:68 | next.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:69 | next.totalSupply | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:69 | next.totalTax | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:70 | next.totalAmount | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:75 | next.totalAmount | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:75 | next.totalAmount | any | any-receiver |
| functions/src/employeeLogin.ts:23 | request.data?.username | any | any-receiver |
| functions/src/employeeLogin.ts:24 | request.data?.password | any | any-receiver |
| functions/src/employeeLogin.ts:25 | request.data?.app | any | any-receiver |
| functions/src/employeeLogin.ts:26 | request.data?.companyId | any | any-receiver |
| functions/src/employeeLogin.ts:46 | employee?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:48 | employee?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:50 | employee?.adminAccess | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:51 | employee?.passwordHash | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:80 | error?.code | any | any-receiver |
| functions/src/tradeStatementIssue.ts:23 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:24 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:24 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:25 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:25 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:25 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:25 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:26 | row.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:51 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:51 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:52 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:53 | raw.tradeDate | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:57 | raw.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:57 | raw.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:58 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:58 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:59 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:59 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:61 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:63 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:66 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:66 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:66 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:67 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:67 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:68 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:68 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:68 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:68 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:69 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:69 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:70 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:70 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:71 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:72 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:72 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:72 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:74 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:75 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:75 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:75 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:75 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:75 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:75 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:76 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:76 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:76 | item.isBox | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:77 | raw.items.reduce | any | any-receiver |
| functions/src/tradeStatementIssue.ts:77 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:77 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:77 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:77 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:78 | raw.totalSupply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:78 | raw.totalTax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:78 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:79 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:79 | sums.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:79 | raw.totalSupply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:79 | raw.totalTax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:79 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:80 | raw.orderId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:81 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:83 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:84 | line.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:85 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:85 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:85 | candidate.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:93 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:94 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:97 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:102 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:105 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:111 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:139 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:140 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:144 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:146 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:154 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:158 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:164 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:167 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:167 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:167 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:170 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:174 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:179 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:189 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:190 | item.itemName | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:190 | item.unit | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:204 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:206 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:207 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:210 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:210 | raw.partnerName | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:212 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:214 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:217 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:220 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:223 | raw.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:12 | row.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:49 | stmt.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:49 | stmt.orderId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:49 | stmt.type | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:50 | stmt.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:50 | stmt.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:51 | stmt.tradeDate | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.qty | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.qty | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.price | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.price | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:60 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:60 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | stmt.items.reduce | any | any-receiver |
| functions/src/oemFeeVoucher.ts:62 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:63 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:63 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:63 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:64 | sums.some | any | any-receiver |
| functions/src/oemFeeVoucher.ts:64 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:64 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:64 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:65 | stmt.items.every | any | any-receiver |
| functions/src/oemFeeVoucher.ts:65 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:65 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:66 | stmt.items.every | any | any-receiver |
| functions/src/oemFeeVoucher.ts:66 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:66 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:94 | stmt.partnerId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:101 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:102 | (po.items ?? []).filter | any | any-receiver |
| functions/src/oemFeeVoucher.ts:102 | item.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:103 | (po.oemReceivedBulk ?? []).filter | any | any-receiver |
| functions/src/oemFeeVoucher.ts:103 | item.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:105 | item.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:106 | item.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:117 | children.get(row.child_id)?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:119 | item.unpackTo?.count | any | any-receiver |
| functions/src/oemFeeVoucher.ts:122 | poItem.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:124 | poItem.name | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:124 | poItem.unit | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:124 | poItem.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:129 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:130 | row.material | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:130 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:135 | (po.oemSent ?? []).reduce | any | any-receiver |
| functions/src/oemFeeVoucher.ts:135 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:140 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:143 | last.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:145 | last.qty | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:147 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:148 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:148 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:149 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:149 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:153 | stmt.items.some | any | any-receiver |
| functions/src/oemFeeVoucher.ts:153 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:153 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:20 | row.companyId | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:39 | item.packageKg | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:39 | item.spec | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:39 | item.name | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:39 | item.spec | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:42 | lot.qtyRemaining | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:42 | lot.status | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:72 | gate.data()?.oemLotCutoverDate | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:105 | children.get(row.child_id)?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:107 | item.unpackTo?.count | any | any-receiver |
| functions/src/oemReceiptCommand.ts:129 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:150 | candidate.id | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:151 | lot.lotNo | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:151 | lot.qtyIn | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:152 | lot.material | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:180 | existing.id | Row | property-symbol-unresolved |
| functions/src/partnerCutover.ts:3 | gate?.auditScope | Record<string, unknown> \| undefined | property-symbol-unresolved |
| functions/src/partnerCutover.ts:4 | gate.blockedPartnerIds | Record<string, unknown> | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:20 | row.companyId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:34 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:35 | row.items | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:35 | row.items | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:36 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:36 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:37 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:37 | item.supply | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:38 | item.tax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:38 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:39 | item.supply | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:40 | row.totalTax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:40 | row.totalTax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:40 | item.tax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:41 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:44 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:46 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:47 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:52 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:53 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:53 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:54 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:54 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:55 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:55 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:56 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:56 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:58 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:58 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:59 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:59 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:60 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:64 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:64 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:64 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:65 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:65 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:66 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:70 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:71 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:71 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:71 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:72 | row.lines | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:72 | row.lines | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:72 | row.lines | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:73 | row.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:73 | row.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:73 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:74 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:75 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:75 | line.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:75 | line.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:76 | line.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:76 | line.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:77 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:77 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:77 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:77 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:78 | line.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:78 | line.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:79 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:81 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:128 | currentEntry?.issuePrefix | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:140 | cutoverSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:141 | cutoverSnap.data()?.enabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:141 | cutoverSnap.data()?.legacyWritersBlocked | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:142 | cutoverSnap.data()?.auditPassed | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:147 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:149 | accountSnap.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:170 | partnerSnap.data()?.name | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:17 | row.companyId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:52 | prior?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:69 | stored?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:69 | stored?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:75 | cutoverSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:76 | cutoverSnap.data()?.enabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:76 | cutoverSnap.data()?.legacyWritersBlocked | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:77 | cutoverSnap.data()?.auditPassed | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:85 | accountSnap.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:85 | accountSnap.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:96 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:96 | line.amount | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:96 | line.side | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:49 | current.data()?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:50 | current.data()?.note | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:53 | current.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:55 | data.mutationRevision | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:56 | data.date | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:56 | data.tradeDate | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:57 | data.docNo | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:57 | data.docNo | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:64 | data.amount | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:64 | data.amount | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:65 | data.totalAmount | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:65 | data.totalAmount | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:66 | data.totalSupply | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:66 | data.totalTax | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:67 | data.totalSupply | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:67 | data.totalTax | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:67 | data.totalAmount | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:70 | data.accountCode | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:70 | data.lines | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:70 | data.lines | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:70 | line?.accountCode | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:72 | data.issueOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:72 | data.issueOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:73 | data.issueOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:73 | data.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:73 | data.issuePrefix | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:74 | data.partnerPaymentOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:74 | data.loanMovementOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:74 | data.transferOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:75 | data.payrollOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:75 | data.oemFeeOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:75 | data.oemReceiptOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:76 | data.loanId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:76 | data.orderId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:76 | data.returnOperationId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:76 | data.reverseOfStatementId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:77 | data.payrollId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:77 | data.oemPoId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:77 | data.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/voucherMutationCommand.ts:77 | data.sourceStatementId | Row | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:15 | row.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:59 | current?.cashEntryId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:65 | cutover?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:69 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:75 | statementSnap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:75 | cashSnap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:77 | cashSnap.data()?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:77 | cashSnap.data()?.transferOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:78 | cashSnap.data()?.loanMovementOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:78 | cashSnap.data()?.partnerPaymentOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:86 | line.accountCode | Record<string, unknown> | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:86 | line.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:101 | prior?.cashEntryId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:115 | linked.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:57 | requestSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:87 | saved?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:88 | saved?.returnOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:90 | snap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:91 | snap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:91 | snap.data()?.statementId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:92 | snap.data()?.amount | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:92 | snap.data()?.operationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:96 | expected.id | any | any-receiver |
| functions/src/processReturnCommand.ts:97 | receipt.data()?.returnOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:98 | receipt.data()?.returnReceiptFingerprint | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:98 | expected.fingerprint | any | any-receiver |
| functions/src/processReturnCommand.ts:99 | receipt.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:99 | receipt.data()?.itemId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:99 | expected.itemId | any | any-receiver |
| functions/src/processReturnCommand.ts:100 | receipt.data()?.quantity | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:100 | expected.quantity | any | any-receiver |
| functions/src/processReturnCommand.ts:101 | expected.receiptHash | any | any-receiver |
| functions/src/processReturnCommand.ts:103 | sourceSnap.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:104 | request.items.length | any | any-receiver |
| functions/src/processReturnCommand.ts:106 | row.companyId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:107 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:107 | row.operationId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:108 | row.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:108 | request.items[index].itemId | any | any-receiver |
| functions/src/processReturnCommand.ts:108 | row.quantityDelta | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:108 | request.items[index].quantity | any | any-receiver |
| functions/src/processReturnCommand.ts:109 | row.date | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:114 | sourceSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:114 | sourceSnap.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:115 | partnerSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:119 | gate?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:128 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:133 | cutoverSnap.data()?.purchaseGeneralStockEnabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:139 | request.items.length | any | any-receiver |
| functions/src/processReturnCommand.ts:164 | (app as Row).returnRequestId | Row | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:28 | row.id | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:28 | row.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:28 | row.payrollId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:29 | row.payrollRequestHash | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:29 | row.payrollFingerprint | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:29 | row.docNo | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:31 | row.date | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:31 | row.dir | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:31 | row.amount | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:31 | row.cashAccountId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:32 | row.accountCode | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:32 | row.lines | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:32 | row.note | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:33 | row.issuedAt | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:33 | row.tradeDate | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:33 | row.type | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:34 | row.partnerId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:34 | row.partnerName | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:34 | row.orderId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:35 | row.totalSupply | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:35 | row.totalTax | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:35 | row.totalAmount | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:35 | row.items | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:95 | old?.cashEntryId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:95 | old?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:97 | old?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:102 | old?.createdAt | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:159 | old?.cashEntryId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:159 | old?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:161 | old?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:219 | old?.createdAt | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:227 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:234 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/index.ts:39 | request.data?.name | any | any-receiver |
| functions/src/index.ts:40 | request.data?.phone | any | any-receiver |
| functions/src/index.ts:59 | request.data?.username | any | any-receiver |
| functions/src/index.ts:60 | request.data?.name | any | any-receiver |
| functions/src/index.ts:61 | request.data?.phone | any | any-receiver |
| functions/src/index.ts:102 | startingRelease.data()?.releaseId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:166 | releaseSnap.data()?.releaseId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:310 | (room.participantIds ?? []).filter | any | any-receiver |
| functions/src/index.ts:324 | d.data()?.fcmTokens | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:327 | room.nameBy?.[d.id]?.trim | any | any-receiver |
| functions/src/index.ts:327 | room.name?.trim | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:79 | employee?.authUid | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:90 | (prior.outApplications ?? []).map | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:91 | (prior.inApplications ?? []).map | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:95 | storedOut?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:95 | storedIn?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:96 | storedOut?.issuePayloadHash | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:96 | storedIn?.issuePayloadHash | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:100 | row.side | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:100 | row.statementId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:101 | row.companyId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:101 | row.cashId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:102 | row.statementId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:102 | row.amount | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:116 | gate?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:121 | row?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:127 | row?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:139 | snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:14 | row.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:16 | row.manual | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:16 | row.operationId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:17 | row.returnOperationId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:17 | row.transferOperationId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:17 | row.issueOperationId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:18 | row.serverOwned | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:65 | cutover?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:69 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:83 | line.accountCode | Record<string, unknown> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:83 | line.amount | Record<string, unknown> | property-symbol-unresolved |

## 기존 shared 선언 필드

| 모델 | 필드 | 입력 | 선언 타입 | 선언 위치 | 정적 사용처 |
| --- | --- | --- | --- | --- | --- |
| OrderItem | lineId | 선택 | string | src/shared/types.ts:20 | 39 |
| OrderItem | itemId | 필수 | string | src/shared/types.ts:21 | 117 |
| OrderItem | name | 필수 | string | src/shared/types.ts:22 | 61 |
| OrderItem | orderedAs | 선택 | string | src/shared/types.ts:36 | 0 |
| OrderItem | quantity | 필수 | number | src/shared/types.ts:37 | 41 |
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
| OrderItem | displaySize | 선택 | string | src/shared/types.ts:59 | 4 |
| OrderPallet | type | 필수 | string | src/shared/types.ts:63 | 16 |
| OrderPallet | quantity | 필수 | number | src/shared/types.ts:64 | 17 |
| OrderPallet | isExchange | 선택 | boolean | src/shared/types.ts:65 | 7 |
| DeliveryBox | itemId | 필수 | string | src/shared/types.ts:69 | 3 |
| DeliveryBox | name | 필수 | string | src/shared/types.ts:70 | 1 |
| DeliveryBox | quantity | 필수 | number | src/shared/types.ts:71 | 2 |
| PurchaseItem | id | 필수 | string | src/shared/types.ts:90 | 0 |
| PurchaseItem | name | 필수 | string | src/shared/types.ts:91 | 0 |
| ShipTo | id | 필수 | string | src/shared/types.ts:102 | 19 |
| ShipTo | name | 필수 | string | src/shared/types.ts:103 | 12 |
| ShipTo | archived | 선택 | boolean | src/shared/types.ts:105 | 11 |
| PartnerItem | id | 필수 | string | src/shared/types.ts:109 | 25 |
| PartnerItem | itemId | 필수 | string | src/shared/types.ts:110 | 66 |
| PartnerItem | partnerId | 필수 | string | src/shared/types.ts:111 | 58 |
| PartnerItem | Direction | 필수 | 'in' \| 'out' | src/shared/types.ts:112 | 26 |
| PartnerItem | price | 선택 | number | src/shared/types.ts:113 | 29 |
| PartnerItem | Account_Code | 선택 | string | src/shared/types.ts:114 | 13 |
| PartnerItem | taxType | 선택 | '과세' \| '면세' \| null | src/shared/types.ts:123 | 21 |
| PartnerItem | shipToIds | 선택 | string[] | src/shared/types.ts:137 | 1 |
| PartnerItem | isSmartStore | 선택 | boolean | src/shared/types.ts:138 | 0 |
| Partner | shipTos | 선택 | ShipTo[] | src/shared/types.ts:150 | 5 |
| Partner | id | 필수 | string | src/shared/types.ts:151 | 195 |
| Partner | name | 필수 | string | src/shared/types.ts:152 | 183 |
| Partner | email | 선택 | string | src/shared/types.ts:153 | 4 |
| Partner | phone | 선택 | string | src/shared/types.ts:154 | 6 |
| Partner | type | 필수 | PartnerChannel | src/shared/types.ts:155 | 28 |
| Partner | region | 선택 | string | src/shared/types.ts:156 | 8 |
| Partner | address | 선택 | string | src/shared/types.ts:157 | 10 |
| Partner | addressDetail | 선택 | string | src/shared/types.ts:158 | 8 |
| Partner | ownerName | 선택 | string | src/shared/types.ts:159 | 6 |
| Partner | bizNo | 선택 | string | src/shared/types.ts:160 | 6 |
| Partner | tel | 선택 | string | src/shared/types.ts:161 | 7 |
| Partner | mobile | 선택 | string | src/shared/types.ts:162 | 7 |
| Partner | fax | 선택 | string | src/shared/types.ts:163 | 2 |
| Partner | note | 선택 | string | src/shared/types.ts:164 | 3 |
| Partner | partnerType | 선택 | PartnerType | src/shared/types.ts:165 | 7 |
| Partner | companyId | 선택 | CompanyId | src/shared/types.ts:172 | 1 |
| Partner | isOemFactory | 선택 | boolean | src/shared/types.ts:173 | 1 |
| Partner | purchaseItems | 선택 | PurchaseItem[] | src/shared/types.ts:174 | 0 |
| OrderRawInventoryTrace | material | 필수 | string | src/shared/types.ts:207 | 8 |
| OrderRawInventoryTrace | rawItemId | 선택 | string | src/shared/types.ts:209 | 10 |
| OrderRawInventoryTrace | operationId | 선택 | string | src/shared/types.ts:211 | 17 |
| OrderRawInventoryTrace | ledgerId | 선택 | string | src/shared/types.ts:213 | 2 |
| OrderRawInventoryTrace | ledgerOnly | 선택 | boolean | src/shared/types.ts:215 | 6 |
| OrderRawInventoryTrace | lotId | 선택 | string | src/shared/types.ts:216 | 8 |
| OrderRawInventoryTrace | lotNo | 선택 | string | src/shared/types.ts:217 | 3 |
| OrderRawInventoryTrace | supplierName | 필수 | string | src/shared/types.ts:218 | 3 |
| OrderRawInventoryTrace | receivedDate | 선택 | string | src/shared/types.ts:219 | 3 |
| OrderRawInventoryTrace | kg | 필수 | number | src/shared/types.ts:220 | 10 |
| Order | id | 필수 | string | src/shared/types.ts:224 | 254 |
| Order | companyId | 선택 | CompanyId | src/shared/types.ts:226 | 1 |
| Order | cardNo | 선택 | string | src/shared/types.ts:237 | 4 |
| Order | createdBy | 선택 | string | src/shared/types.ts:242 | 1 |
| Order | sourceChatMessageId | 선택 | string | src/shared/types.ts:244 | 1 |
| Order | partnerId | 선택 | string | src/shared/types.ts:245 | 57 |
| Order | partnerName | 필수 | string | src/shared/types.ts:246 | 89 |
| Order | items | 필수 | OrderItem[] | src/shared/types.ts:247 | 145 |
| Order | note | 선택 | string | src/shared/types.ts:249 | 14 |
| Order | noteImportant | 선택 | boolean | src/shared/types.ts:250 | 4 |
| Order | noteBy | 선택 | string | src/shared/types.ts:251 | 2 |
| Order | noteAt | 선택 | string | src/shared/types.ts:252 | 2 |
| Order | totalAmount | 필수 | number | src/shared/types.ts:253 | 0 |
| Order | status | 필수 | OrderStatus | src/shared/types.ts:254 | 133 |
| Order | createdAt | 필수 | string | src/shared/types.ts:255 | 55 |
| Order | deliveryDate | 필수 | string | src/shared/types.ts:256 | 58 |
| Order | email | 필수 | string | src/shared/types.ts:257 | 0 |
| Order | source | 필수 | OrderSource | src/shared/types.ts:258 | 33 |
| Order | pallets | 선택 | OrderPallet[] | src/shared/types.ts:259 | 20 |
| Order | region | 선택 | string | src/shared/types.ts:260 | 0 |
| Order | shipToId | 선택 | string | src/shared/types.ts:268 | 5 |
| Order | deliveryBoxes | 선택 | DeliveryBox[] | src/shared/types.ts:269 | 10 |
| Order | shipMethod | 선택 | ShipMethod \| '직접수령' | src/shared/types.ts:271 | 0 |
| Order | invoicePrinted | 선택 | boolean | src/shared/types.ts:272 | 16 |
| Order | invoiceStage | 선택 | 'printed' \| 'attached' | src/shared/types.ts:281 | 2 |
| Order | invoiceType | 선택 | InvoiceType | src/shared/types.ts:283 | 2 |
| Order | shipmentConfirmedBy | 선택 | string \| null | src/shared/types.ts:284 | 3 |
| Order | shipmentConfirmedAt | 선택 | string \| null | src/shared/types.ts:285 | 5 |
| Order | deliveredAt | 선택 | string | src/shared/types.ts:286 | 13 |
| Order | documentDate | 선택 | string | src/shared/types.ts:287 | 0 |
| Order | accountingExcluded | 선택 | boolean | src/shared/types.ts:293 | 3 |
| Order | accountingExclusionReason | 선택 | string | src/shared/types.ts:294 | 2 |
| Order | accountingExcludedAt | 선택 | string | src/shared/types.ts:295 | 0 |
| Order | accountingExcludedBy | 선택 | string | src/shared/types.ts:296 | 0 |
| Order | rawLotsDeducted | 선택 | boolean | src/shared/types.ts:297 | 3 |
| Order | rawConsumedLots | 선택 | OrderRawInventoryTrace[] | src/shared/types.ts:298 | 18 |
| Order | rawInventoryAttempt | 선택 | number | src/shared/types.ts:300 | 5 |
| Order | productConsumedLots | 선택 | { itemId: string; material?: string; lotId?: string; lotNo?: string; receivedDate?: string; qty: number }[] | src/shared/types.ts:306 | 8 |
| Order | autoBuilt | 선택 | { itemId: string; qty: number }[] | src/shared/types.ts:307 | 12 |
| Order | producedUnits | 선택 | { itemId: string; qty: number }[] | src/shared/types.ts:308 | 15 |
| Order | producedAt | 선택 | string | src/shared/types.ts:310 | 22 |
| Order | shippedOut | 선택 | boolean | src/shared/types.ts:311 | 15 |
| Order | inventorySnapshots | 선택 | {     version: 1;     production?: OrderInventorySnapshot;     shipment?: OrderInventorySnapshot;   } | src/shared/types.ts:316 | 28 |
| Order | itemInventory | 선택 | Record<string, OrderItemInventoryState> | src/shared/types.ts:326 | 17 |
| Order | inventoryOperation | 선택 | {     id: string;     /** 품목 한 줄은 결정적 원료 작업번호로 중단 지점부터 재개할 수 있다. */     kind?: 'line' \| 'status';     lineId?: string;     stage?: 'claim' \| 'reservation' \| 'raw-inventory' \| 'production-record' \| 'final-stock';     targetStatus: OrderStatus;     state: 'processing' \| 'failed';     startedAt: string;     actor: string;     error?: string;   } \| null | src/shared/types.ts:328 | 13 |
| OrderItemInventoryState | version | 필수 | 1 | src/shared/types.ts:343 | 0 |
| OrderItemInventoryState | lineId | 필수 | string | src/shared/types.ts:344 | 3 |
| OrderItemInventoryState | itemId | 필수 | string | src/shared/types.ts:345 | 1 |
| OrderItemInventoryState | applied | 필수 | boolean | src/shared/types.ts:346 | 13 |
| OrderItemInventoryState | attempt | 필수 | number | src/shared/types.ts:347 | 5 |
| OrderItemInventoryState | completedAt | 선택 | string | src/shared/types.ts:348 | 8 |
| OrderItemInventoryState | reversedAt | 선택 | string | src/shared/types.ts:349 | 0 |
| OrderItemInventoryState | rawConsumedLots | 필수 | OrderRawInventoryTrace[] | src/shared/types.ts:350 | 9 |
| OrderItemInventoryState | autoBuilt | 필수 | { itemId: string; qty: number }[] | src/shared/types.ts:351 | 4 |
| OrderItemInventoryState | producedUnits | 필수 | { itemId: string; qty: number }[] | src/shared/types.ts:352 | 5 |
| OrderItemInventoryState | production | 필수 | OrderInventorySnapshot | src/shared/types.ts:353 | 19 |
| OrderInventoryAdjustment | itemId | 필수 | string | src/shared/types.ts:357 | 18 |
| OrderInventoryAdjustment | delta | 필수 | number | src/shared/types.ts:358 | 14 |
| OrderInventorySnapshot | capturedAt | 필수 | string | src/shared/types.ts:362 | 13 |
| OrderInventorySnapshot | stockDeltas | 필수 | OrderInventoryAdjustment[] | src/shared/types.ts:363 | 19 |
| OrderInventorySnapshot | bomLines | 필수 | { parentItemId: string; childItemId: string; quantity: number }[] | src/shared/types.ts:364 | 3 |
| OrderInventorySnapshot | rawConsumedLots | 선택 | Order['rawConsumedLots'] | src/shared/types.ts:365 | 10 |
| OrderInventorySnapshot | productConsumedLots | 선택 | Order['productConsumedLots'] | src/shared/types.ts:366 | 6 |
| OrderInventorySnapshot | productProducedLots | 선택 | { itemId: string; lotId: string; qty: number }[] | src/shared/types.ts:367 | 6 |
| OrderInventorySnapshot | rawLedgerIds | 선택 | string[] | src/shared/types.ts:368 | 4 |
| OrderStatusAudit | id | 필수 | string | src/shared/types.ts:372 | 0 |
| OrderStatusAudit | orderId | 필수 | string | src/shared/types.ts:373 | 0 |
| OrderStatusAudit | partnerName | 필수 | string | src/shared/types.ts:374 | 0 |
| OrderStatusAudit | previousStatus | 필수 | OrderStatus | src/shared/types.ts:375 | 1 |
| OrderStatusAudit | nextStatus | 필수 | OrderStatus | src/shared/types.ts:376 | 1 |
| OrderStatusAudit | approvedBy | 필수 | string | src/shared/types.ts:377 | 1 |
| OrderStatusAudit | approvedAt | 필수 | string | src/shared/types.ts:378 | 1 |
| OrderStatusAudit | completedAt | 선택 | string | src/shared/types.ts:379 | 1 |
| OrderStatusAudit | state | 필수 | 'processing' \| 'completed' \| 'failed' | src/shared/types.ts:380 | 3 |
| OrderStatusAudit | legacyEvidenceWarning | 필수 | boolean | src/shared/types.ts:381 | 1 |
| OrderStatusAudit | stockAdjustments | 필수 | Array<OrderInventoryAdjustment & { name: string; unit: string }> | src/shared/types.ts:382 | 1 |
| OrderStatusAudit | error | 선택 | string | src/shared/types.ts:383 | 1 |
| OrderItemEdit | id | 필수 | string | src/shared/types.ts:393 | 0 |
| OrderItemEdit | orderId | 필수 | string | src/shared/types.ts:394 | 0 |
| OrderItemEdit | at | 필수 | string | src/shared/types.ts:395 | 1 |
| OrderItemEdit | by | 필수 | string | src/shared/types.ts:396 | 1 |
| OrderItemEdit | changes | 필수 | string[] | src/shared/types.ts:398 | 1 |
| SubmaterialComponent | id | 필수 | string | src/shared/types.ts:402 | 13 |
| SubmaterialComponent | name | 필수 | string | src/shared/types.ts:403 | 2 |
| SubmaterialComponent | category | 필수 | InventoryCategory \| string | src/shared/types.ts:404 | 0 |
| SubmaterialComponent | stock | 필수 | number | src/shared/types.ts:405 | 8 |
| SubmaterialComponent | unit | 필수 | string | src/shared/types.ts:406 | 1 |
| SubmaterialComponent | spec | 선택 | string | src/shared/types.ts:407 | 0 |
| SubmaterialComponent | cost | 선택 | number | src/shared/types.ts:408 | 0 |
| SubmaterialComponent | qrCode | 선택 | string | src/shared/types.ts:409 | 0 |
| ItemInventoryReservation | operationId | 필수 | string | src/shared/types.ts:455 | 2 |
| ItemInventoryReservation | orderId | 필수 | string | src/shared/types.ts:456 | 9 |
| ItemInventoryReservation | qty | 필수 | number | src/shared/types.ts:457 | 7 |
| ItemInventoryReservation | createdAt | 필수 | string | src/shared/types.ts:458 | 1 |
| ItemInventoryReservation | state | 필수 | 'processing' \| 'allocated' | src/shared/types.ts:460 | 3 |
| ItemStocktakeAnchor | id | 필수 | string | src/shared/types.ts:464 | 4 |
| ItemStocktakeAnchor | date | 필수 | string | src/shared/types.ts:465 | 3 |
| ItemStocktakeAnchor | createdAt | 필수 | string | src/shared/types.ts:466 | 2 |
| ItemStocktakeAnchor | targetQty | 필수 | number | src/shared/types.ts:467 | 1 |
| ItemStocktakeAnchor | beforeQty | 필수 | number | src/shared/types.ts:468 | 1 |
| ItemStocktakeAnchor | deltaQty | 필수 | number | src/shared/types.ts:469 | 0 |
| ItemStocktakeAnchor | note | 선택 | string | src/shared/types.ts:470 | 1 |
| Item | id | 필수 | string | src/shared/types.ts:475 | 667 |
| Item | companyId | 선택 | CompanyId | src/shared/types.ts:487 | 1 |
| Item | name | 필수 | string | src/shared/types.ts:488 | 294 |
| Item | sku | 선택 | string | src/shared/types.ts:489 | 1 |
| Item | type | 필수 | InventoryCategory \| string | src/shared/types.ts:491 | 130 |
| Item | category | 선택 | ItemSubtype \| string | src/shared/types.ts:492 | 37 |
| Item | subtype | 선택 | string | src/shared/types.ts:493 | 20 |
| Item | cost | 선택 | number | src/shared/types.ts:494 | 20 |
| Item | costSource | 선택 | 'rollup' \| 'manual' | src/shared/types.ts:503 | 2 |
| Item | lotsAreTotal | 선택 | never | src/shared/types.ts:532 | 0 |
| Item | stock | 필수 | number | src/shared/types.ts:534 | 63 |
| Item | inventoryReservations | 선택 | ItemInventoryReservation[] | src/shared/types.ts:536 | 4 |
| Item | stocktakeAnchors | 선택 | ItemStocktakeAnchor[] | src/shared/types.ts:538 | 5 |
| Item | density | 선택 | number | src/shared/types.ts:544 | 15 |
| Item | minStock | 필수 | number | src/shared/types.ts:545 | 22 |
| Item | unit | 필수 | string | src/shared/types.ts:546 | 108 |
| Item | image | 필수 | string | src/shared/types.ts:547 | 3 |
| Item | imagePath | 선택 | string | src/shared/types.ts:549 | 5 |
| Item | oil | 선택 | string | src/shared/types.ts:550 | 4 |
| Item | partnerIds | 선택 | string[] | src/shared/types.ts:551 | 1 |
| Item | freightType | 선택 | 's' \| 'a' \| 'b' \| 'c' \| 'd' \| 'e' | src/shared/types.ts:552 | 3 |
| Item | 품목 | 선택 | string | src/shared/types.ts:555 | 14 |
| Item | spec | 선택 | string | src/shared/types.ts:556 | 95 |
| Item | isSmartStore | 선택 | boolean | src/shared/types.ts:557 | 1 |
| Item | smartStorePrice | 선택 | number | src/shared/types.ts:558 | 4 |
| Item | procureType | 선택 | '완사입' \| '임가공' | src/shared/types.ts:561 | 5 |
| Item | unpackable | 선택 | boolean | src/shared/types.ts:571 | 2 |
| Item | rawMaterialName | 선택 | string | src/shared/types.ts:572 | 8 |
| Item | packageType | 선택 | string | src/shared/types.ts:573 | 3 |
| Item | packageKg | 선택 | number | src/shared/types.ts:574 | 3 |
| Item | lots | 선택 | RawMaterialLot[] | src/shared/types.ts:575 | 40 |
| Item | mixEnabled | 선택 | boolean | src/shared/types.ts:576 | 4 |
| Item | mixTopPercent | 선택 | number | src/shared/types.ts:577 | 3 |
| Item | mixLotRatios | 선택 | { lotId: string; percent: number }[] | src/shared/types.ts:578 | 8 |
| Item | phantom | 선택 | boolean | src/shared/types.ts:579 | 13 |
| Item | archived | 선택 | boolean | src/shared/types.ts:581 | 38 |
| PalletStock | id | 필수 | string | src/shared/types.ts:586 | 35 |
| PalletStock | name | 필수 | string | src/shared/types.ts:587 | 25 |
| PalletStock | total | 필수 | number | src/shared/types.ts:588 | 10 |
| PalletStock | inUse | 필수 | number | src/shared/types.ts:590 | 0 |
| PalletStock | damaged | 필수 | number | src/shared/types.ts:591 | 6 |
| PalletStock | hidden | 선택 | boolean | src/shared/types.ts:592 | 9 |
| PalletTransaction | id | 필수 | string | src/shared/types.ts:596 | 12 |
| PalletTransaction | partnerId | 필수 | string | src/shared/types.ts:597 | 6 |
| PalletTransaction | palletId | 필수 | string | src/shared/types.ts:598 | 6 |
| PalletTransaction | type | 필수 | 'in' \| 'out' | src/shared/types.ts:599 | 9 |
| PalletTransaction | quantity | 필수 | number | src/shared/types.ts:600 | 13 |
| PalletTransaction | date | 필수 | string | src/shared/types.ts:601 | 6 |
| PalletTransaction | note | 선택 | string | src/shared/types.ts:602 | 2 |
| PalletTransaction | status | 선택 | '교체중' \| '교체완료' | src/shared/types.ts:603 | 3 |
| PalletTransaction | exchangeReturnQty | 선택 | number | src/shared/types.ts:604 | 2 |
| PalletTransaction | isTransfer | 선택 | boolean | src/shared/types.ts:605 | 5 |
| Post | id | 필수 | string | src/shared/types.ts:610 | 3 |
| Post | title | 필수 | string | src/shared/types.ts:611 | 3 |
| Post | author | 필수 | string | src/shared/types.ts:612 | 2 |
| Post | content | 필수 | string | src/shared/types.ts:613 | 2 |
| Post | date | 필수 | string | src/shared/types.ts:614 | 3 |
| Post | tag | 필수 | '공지' \| '긴급' \| '매뉴얼' \| '업무' | src/shared/types.ts:615 | 6 |
| Post | pinned | 선택 | boolean | src/shared/types.ts:616 | 4 |
| Post | blocks | 선택 | ({ type: 'text'; text: string } \| { type: 'image'; url: string; path: string; caption: string })[] | src/shared/types.ts:617 | 2 |
| FileItem | id | 필수 | string | src/shared/types.ts:621 | 0 |
| FileItem | name | 필수 | string | src/shared/types.ts:622 | 0 |
| FileItem | type | 필수 | 'pdf' \| 'excel' \| 'image' \| 'word' | src/shared/types.ts:623 | 0 |
| FileItem | size | 필수 | string | src/shared/types.ts:624 | 0 |
| FileItem | date | 필수 | string | src/shared/types.ts:625 | 0 |
| FileItem | uploader | 필수 | string | src/shared/types.ts:626 | 0 |
| CabinetCategory | id | 필수 | string | src/shared/types.ts:632 | 2 |
| CabinetCategory | companyId | 선택 | CompanyId | src/shared/types.ts:633 | 0 |
| CabinetCategory | name | 필수 | string | src/shared/types.ts:634 | 12 |
| CabinetCategory | order | 필수 | number | src/shared/types.ts:635 | 1 |
| CabinetCategory | createdAt | 필수 | string | src/shared/types.ts:636 | 0 |
| CabinetSubCategory | id | 필수 | string | src/shared/types.ts:640 | 2 |
| CabinetSubCategory | companyId | 선택 | CompanyId | src/shared/types.ts:641 | 0 |
| CabinetSubCategory | category | 필수 | string | src/shared/types.ts:642 | 6 |
| CabinetSubCategory | name | 필수 | string | src/shared/types.ts:643 | 11 |
| CabinetSubCategory | order | 필수 | number | src/shared/types.ts:644 | 1 |
| CabinetSubCategory | createdAt | 필수 | string | src/shared/types.ts:645 | 0 |
| CabinetDoc | id | 필수 | string | src/shared/types.ts:649 | 3 |
| CabinetDoc | companyId | 선택 | CompanyId | src/shared/types.ts:650 | 0 |
| CabinetDoc | category | 필수 | string | src/shared/types.ts:651 | 3 |
| CabinetDoc | subCategory | 필수 | string | src/shared/types.ts:652 | 3 |
| CabinetDoc | fileName | 필수 | string | src/shared/types.ts:653 | 5 |
| CabinetDoc | storagePath | 필수 | string | src/shared/types.ts:654 | 1 |
| CabinetDoc | downloadUrl | 필수 | string | src/shared/types.ts:655 | 1 |
| CabinetDoc | size | 필수 | number | src/shared/types.ts:656 | 1 |
| CabinetDoc | contentType | 필수 | string | src/shared/types.ts:657 | 1 |
| CabinetDoc | note | 선택 | string | src/shared/types.ts:658 | 3 |
| CabinetDoc | uploadedBy | 필수 | string | src/shared/types.ts:659 | 1 |
| CabinetDoc | uploadedAt | 필수 | string | src/shared/types.ts:660 | 2 |
| AnnualLeave | carryOverLeave | 필수 | number | src/shared/types.ts:667 | 7 |
| AnnualLeave | bonusLeave | 필수 | number | src/shared/types.ts:668 | 7 |
| Employee | id | 필수 | string | src/shared/types.ts:672 | 131 |
| Employee | companyId | 선택 | CompanyId | src/shared/types.ts:674 | 2 |
| Employee | name | 필수 | string | src/shared/types.ts:675 | 100 |
| Employee | username | 선택 | string | src/shared/types.ts:676 | 1 |
| Employee | position | 필수 | string | src/shared/types.ts:677 | 25 |
| Employee | department | 필수 | string | src/shared/types.ts:678 | 21 |
| Employee | joinDate | 필수 | string | src/shared/types.ts:679 | 12 |
| Employee | status | 필수 | EmployeeStatus | src/shared/types.ts:680 | 5 |
| Employee | phone | 필수 | string | src/shared/types.ts:681 | 9 |
| Employee | birthDate | 선택 | string | src/shared/types.ts:682 | 1 |
| Employee | annualLeave | 선택 | AnnualLeave | src/shared/types.ts:683 | 12 |
| Employee | healthCertDate | 선택 | string | src/shared/types.ts:684 | 7 |
| Employee | adminAccess | 선택 | boolean | src/shared/types.ts:689 | 2 |
| Employee | fcmTokens | 선택 | string[] | src/shared/types.ts:694 | 1 |
| Employee | fcmDevices | 선택 | Record<string, { name: string; at: string }> | src/shared/types.ts:705 | 1 |
| PayrollLine | employeeId | 필수 | string | src/shared/types.ts:713 | 4 |
| PayrollLine | employeeName | 필수 | string | src/shared/types.ts:714 | 3 |
| PayrollLine | department | 선택 | string | src/shared/types.ts:715 | 3 |
| PayrollLine | position | 선택 | string | src/shared/types.ts:716 | 2 |
| PayrollLine | base | 필수 | number | src/shared/types.ts:717 | 2 |
| PayrollLine | overtime | 선택 | number | src/shared/types.ts:718 | 2 |
| PayrollLine | allowance | 선택 | number | src/shared/types.ts:719 | 2 |
| PayrollLine | incomeTax | 선택 | number | src/shared/types.ts:720 | 2 |
| PayrollLine | localTax | 선택 | number | src/shared/types.ts:721 | 2 |
| PayrollLine | pension | 선택 | number | src/shared/types.ts:722 | 2 |
| PayrollLine | health | 선택 | number | src/shared/types.ts:723 | 2 |
| PayrollLine | employment | 선택 | number | src/shared/types.ts:724 | 2 |
| PayrollLine | otherDeduct | 선택 | number | src/shared/types.ts:725 | 2 |
| PayrollLine | note | 선택 | string | src/shared/types.ts:726 | 0 |
| Payroll | id | 필수 | string | src/shared/types.ts:730 | 3 |
| Payroll | companyId | 선택 | CompanyId | src/shared/types.ts:732 | 0 |
| Payroll | yearMonth | 필수 | string | src/shared/types.ts:733 | 0 |
| Payroll | payDate | 필수 | string | src/shared/types.ts:734 | 1 |
| Payroll | lines | 필수 | PayrollLine[] | src/shared/types.ts:735 | 2 |
| Payroll | cashEntryId | 선택 | string | src/shared/types.ts:736 | 1 |
| Payroll | note | 선택 | string | src/shared/types.ts:737 | 0 |
| Payroll | createdAt | 선택 | string | src/shared/types.ts:738 | 0 |
| Payroll | updatedAt | 선택 | string | src/shared/types.ts:739 | 0 |
| LeaveModifyRequest | startDate | 필수 | string | src/shared/types.ts:774 | 3 |
| LeaveModifyRequest | endDate | 필수 | string | src/shared/types.ts:775 | 3 |
| LeaveModifyRequest | reason | 필수 | string | src/shared/types.ts:776 | 3 |
| LeaveModifyRequest | daysUsed | 필수 | number | src/shared/types.ts:777 | 3 |
| LeaveModifyRequest | status | 필수 | 'pending' \| 'approved' \| 'rejected' | src/shared/types.ts:778 | 7 |
| LeaveRequest | id | 필수 | string | src/shared/types.ts:782 | 19 |
| LeaveRequest | employeeId | 필수 | string | src/shared/types.ts:783 | 8 |
| LeaveRequest | employeeName | 필수 | string | src/shared/types.ts:784 | 6 |
| LeaveRequest | type | 필수 | LeaveType | src/shared/types.ts:785 | 10 |
| LeaveRequest | startDate | 필수 | string | src/shared/types.ts:786 | 17 |
| LeaveRequest | endDate | 필수 | string | src/shared/types.ts:787 | 11 |
| LeaveRequest | reason | 필수 | string | src/shared/types.ts:788 | 6 |
| LeaveRequest | status | 필수 | LeaveStatus | src/shared/types.ts:789 | 24 |
| LeaveRequest | requestedAt | 필수 | string | src/shared/types.ts:790 | 4 |
| LeaveRequest | daysUsed | 필수 | number | src/shared/types.ts:791 | 10 |
| LeaveRequest | deductsLeave | 선택 | boolean | src/shared/types.ts:797 | 1 |
| LeaveRequest | modifyRequest | 선택 | LeaveModifyRequest | src/shared/types.ts:798 | 19 |
| LeaveRequest | cancelledAt | 선택 | string | src/shared/types.ts:804 | 2 |
| LeaveRequest | cancelledBy | 선택 | string | src/shared/types.ts:805 | 0 |
| LeaveRequest | cancelledByName | 선택 | string | src/shared/types.ts:806 | 1 |
| LeaveRequest | cancelReason | 선택 | string | src/shared/types.ts:807 | 2 |
| ChatMessage | id | 필수 | string | src/shared/types.ts:811 | 15 |
| ChatMessage | companyId | 선택 | CompanyId | src/shared/types.ts:812 | 0 |
| ChatMessage | roomId | 필수 | string | src/shared/types.ts:813 | 4 |
| ChatMessage | senderId | 필수 | string | src/shared/types.ts:814 | 6 |
| ChatMessage | senderName | 필수 | string | src/shared/types.ts:815 | 7 |
| ChatMessage | text | 필수 | string | src/shared/types.ts:816 | 18 |
| ChatMessage | imageUrl | 선택 | string | src/shared/types.ts:817 | 2 |
| ChatMessage | images | 선택 | string[] | src/shared/types.ts:824 | 2 |
| ChatMessage | createdAt | 필수 | string | src/shared/types.ts:825 | 4 |
| ChatMessage | mentions | 선택 | string[] | src/shared/types.ts:826 | 0 |
| ChatMessage | fileUrl | 선택 | string | src/shared/types.ts:828 | 2 |
| ChatMessage | fileName | 선택 | string | src/shared/types.ts:829 | 1 |
| ChatMessage | fileSize | 선택 | number | src/shared/types.ts:830 | 2 |
| ChatMessage | replyTo | 선택 | { id: string; senderName: string; text: string } | src/shared/types.ts:835 | 3 |
| ChatMessage | deletedAt | 선택 | string | src/shared/types.ts:840 | 4 |
| ChatMessage | deletedBy | 선택 | string | src/shared/types.ts:841 | 0 |
| ChatMessage | reactions | 선택 | Record<string, string[]> | src/shared/types.ts:847 | 6 |
| ChatRoom | id | 필수 | string | src/shared/types.ts:851 | 26 |
| ChatRoom | companyId | 선택 | CompanyId | src/shared/types.ts:852 | 0 |
| ChatRoom | name | 선택 | string | src/shared/types.ts:854 | 3 |
| ChatRoom | nameBy | 선택 | Record<string, string> | src/shared/types.ts:856 | 1 |
| ChatRoom | createdBy | 선택 | string | src/shared/types.ts:858 | 0 |
| ChatRoom | participantIds | 필수 | string[] | src/shared/types.ts:859 | 12 |
| ChatRoom | participantCompanies | 선택 | Record<string, CompanyId> | src/shared/types.ts:861 | 0 |
| ChatRoom | lastMessage | 선택 | string | src/shared/types.ts:862 | 1 |
| ChatRoom | lastUpdatedAt | 필수 | string | src/shared/types.ts:863 | 5 |
| ChatRoom | isGroup | 필수 | boolean | src/shared/types.ts:864 | 7 |
| ChatRoom | lastReadBy | 선택 | Record<string, string> | src/shared/types.ts:865 | 5 |
| ChatRoom | pinnedBy | 선택 | Record<string, string> | src/shared/types.ts:873 | 3 |
| ChatRoom | notice | 선택 | RoomNotice \| null | src/shared/types.ts:881 | 2 |
| RoomNotice | messageId | 필수 | string | src/shared/types.ts:887 | 1 |
| RoomNotice | text | 필수 | string | src/shared/types.ts:888 | 2 |
| RoomNotice | by | 필수 | string | src/shared/types.ts:890 | 0 |
| RoomNotice | byName | 필수 | string | src/shared/types.ts:891 | 1 |
| RoomNotice | at | 필수 | string | src/shared/types.ts:893 | 1 |
| ProductionRecord | id | 필수 | string | src/shared/types.ts:901 | 9 |
| ProductionRecord | date | 필수 | string | src/shared/types.ts:902 | 4 |
| ProductionRecord | itemId | 필수 | string | src/shared/types.ts:903 | 8 |
| ProductionRecord | itemName | 필수 | string | src/shared/types.ts:904 | 3 |
| ProductionRecord | finishedQty | 필수 | number | src/shared/types.ts:905 | 3 |
| ProductionRecord | wipUsed | 선택 | number | src/shared/types.ts:906 | 1 |
| ProductionRecord | wipItemId | 선택 | string | src/shared/types.ts:907 | 0 |
| ProductionRecord | wipItemName | 선택 | string | src/shared/types.ts:908 | 2 |
| ProductionRecord | cost | 선택 | number | src/shared/types.ts:909 | 0 |
| ProductionRecord | note | 선택 | string | src/shared/types.ts:910 | 2 |
| ProductionRecord | createdBy | 선택 | string | src/shared/types.ts:911 | 0 |
| ProductionRecord | createdAt | 필수 | string | src/shared/types.ts:912 | 0 |
| FixedCostEntry | id | 필수 | string | src/shared/types.ts:919 | 0 |
| FixedCostEntry | yearMonth | 필수 | string | src/shared/types.ts:920 | 1 |
| FixedCostEntry | category | 필수 | FixedCostCategory | src/shared/types.ts:921 | 0 |
| FixedCostEntry | label | 필수 | string | src/shared/types.ts:922 | 0 |
| FixedCostEntry | amount | 필수 | number | src/shared/types.ts:923 | 1 |
| FixedCostEntry | accountCode | 선택 | string | src/shared/types.ts:924 | 0 |
| FixedCostEntry | note | 선택 | string | src/shared/types.ts:925 | 0 |
| FixedCostEntry | createdAt | 필수 | string | src/shared/types.ts:926 | 0 |
| FixedCostTemplate | statementType | 선택 | '매출' \| '매입' \| '비용' | src/shared/types.ts:930 | 2 |
| FixedCostTemplate | companyId | 선택 | CompanyId | src/shared/types.ts:940 | 1 |
| FixedCostTemplate | transferLines | 선택 | { accountCode: string; side: '차변' \| '대변'; name?: string }[] | src/shared/types.ts:942 | 7 |
| FixedCostTemplate | id | 필수 | string | src/shared/types.ts:943 | 16 |
| FixedCostTemplate | name | 필수 | string | src/shared/types.ts:944 | 20 |
| FixedCostTemplate | amount | 필수 | number | src/shared/types.ts:945 | 14 |
| FixedCostTemplate | category | 필수 | FixedCostCategory | src/shared/types.ts:946 | 1 |
| FixedCostTemplate | active | 필수 | boolean | src/shared/types.ts:947 | 1 |
| FixedCostTemplate | note | 선택 | string | src/shared/types.ts:948 | 1 |
| FixedCostTemplate | accountCode | 선택 | string | src/shared/types.ts:950 | 16 |
| FixedCostTemplate | partnerId | 선택 | string | src/shared/types.ts:951 | 4 |
| FixedCostTemplate | partnerName | 선택 | string | src/shared/types.ts:952 | 11 |
| FixedCostTemplate | startYm | 선택 | string | src/shared/types.ts:953 | 1 |
| FixedCostTemplate | endYm | 선택 | string | src/shared/types.ts:954 | 1 |
| FixedCostTemplate | kind | 선택 | 'recurring' \| 'voucher' | src/shared/types.ts:959 | 3 |
| FixedCostTemplate | dir | 선택 | '입금' \| '출금' \| '줄돈' \| '받을돈' \| '대체' \| '회사이체' | src/shared/types.ts:972 | 3 |
| FixedCostTemplate | mode | 선택 | '일반' \| '상환' \| '급여' \| '보험' \| '세금' | src/shared/types.ts:973 | 22 |
| FixedCostTemplate | insCorp | 선택 | number | src/shared/types.ts:985 | 1 |
| FixedCostTemplate | insEmp | 선택 | number | src/shared/types.ts:985 | 1 |
| FixedCostTemplate | principal | 선택 | number | src/shared/types.ts:986 | 3 |
| FixedCostTemplate | interest | 선택 | number | src/shared/types.ts:986 | 3 |
| FixedCostTemplate | gross | 선택 | number | src/shared/types.ts:987 | 1 |
| FixedCostTemplate | deduction | 선택 | number | src/shared/types.ts:987 | 1 |
| FixedCostTemplate | loanCode | 선택 | string | src/shared/types.ts:989 | 3 |
| FixedCostTemplate | loanId | 선택 | string | src/shared/types.ts:991 | 6 |
| FixedCostTemplate | vat | 선택 | number | src/shared/types.ts:993 | 0 |
| FixedCostTemplate | incomeTax | 선택 | number | src/shared/types.ts:993 | 0 |
| FixedCostTemplate | builtin | 선택 | string | src/shared/types.ts:995 | 8 |
| FixedCostTemplate | hidden | 선택 | boolean | src/shared/types.ts:997 | 6 |
| FixedCostTemplate | group | 선택 | string | src/shared/types.ts:999 | 10 |
| FixedCostTemplate | favorite | 선택 | boolean | src/shared/types.ts:1001 | 6 |
| FixedCostTemplate | postMode | 선택 | '합침' \| '분리' | src/shared/types.ts:1004 | 3 |
| FixedCostTemplate | autoIssue | 선택 | boolean | src/shared/types.ts:1006 | 12 |
| FixedCostTemplate | issueDay | 선택 | number | src/shared/types.ts:1008 | 10 |
| FixedCostTemplate | taxExempt | 선택 | boolean | src/shared/types.ts:1010 | 3 |
| FixedCostTemplate | itemName | 선택 | string | src/shared/types.ts:1015 | 3 |
| IssuedStatementItem | itemId | 선택 | string | src/shared/types.ts:1037 | 5 |
| IssuedStatementItem | lineKind | 선택 | StatementLineKind | src/shared/types.ts:1039 | 3 |
| IssuedStatementItem | name | 필수 | string | src/shared/types.ts:1040 | 22 |
| IssuedStatementItem | spec | 필수 | string | src/shared/types.ts:1041 | 4 |
| IssuedStatementItem | qty | 필수 | number | src/shared/types.ts:1042 | 12 |
| IssuedStatementItem | price | 필수 | number | src/shared/types.ts:1043 | 4 |
| IssuedStatementItem | supply | 필수 | number | src/shared/types.ts:1044 | 13 |
| IssuedStatementItem | tax | 필수 | number | src/shared/types.ts:1045 | 12 |
| IssuedStatementItem | total | 필수 | number | src/shared/types.ts:1046 | 18 |
| IssuedStatementItem | isTaxExempt | 필수 | boolean | src/shared/types.ts:1047 | 6 |
| IssuedStatementItem | accountCode | 선택 | string | src/shared/types.ts:1052 | 18 |
| IssuedStatementItem | side | 선택 | '차변' \| '대변' | src/shared/types.ts:1065 | 13 |
| StatementParty | name | 필수 | string | src/shared/types.ts:1070 | 0 |
| StatementParty | bizNo | 필수 | string | src/shared/types.ts:1071 | 0 |
| StatementParty | ceo | 필수 | string | src/shared/types.ts:1072 | 0 |
| StatementParty | addr | 필수 | string | src/shared/types.ts:1073 | 0 |
| StatementParty | bizType | 필수 | string | src/shared/types.ts:1074 | 0 |
| StatementParty | bizItem | 필수 | string | src/shared/types.ts:1075 | 0 |
| StatementParty | tel | 필수 | string | src/shared/types.ts:1076 | 0 |
| StatementParty | fax | 필수 | string | src/shared/types.ts:1077 | 0 |
| StatementPartySnapshot | supplier | 필수 | StatementParty | src/shared/types.ts:1081 | 1 |
| StatementPartySnapshot | buyer | 필수 | StatementParty | src/shared/types.ts:1082 | 1 |
| IssuedStatement | id | 필수 | string | src/shared/types.ts:1086 | 112 |
| IssuedStatement | openingItemId | 선택 | string | src/shared/types.ts:1088 | 0 |
| IssuedStatement | openingQuantity | 선택 | number | src/shared/types.ts:1089 | 0 |
| IssuedStatement | companyId | 선택 | CompanyId | src/shared/types.ts:1091 | 3 |
| IssuedStatement | issuedAt | 필수 | string | src/shared/types.ts:1092 | 19 |
| IssuedStatement | tradeDate | 필수 | string | src/shared/types.ts:1093 | 81 |
| IssuedStatement | type | 필수 | '매출' \| '매입' \| '비용' | src/shared/types.ts:1094 | 69 |
| IssuedStatement | partnerId | 필수 | string | src/shared/types.ts:1095 | 61 |
| IssuedStatement | partnerName | 필수 | string | src/shared/types.ts:1096 | 30 |
| IssuedStatement | orderId | 필수 | string | src/shared/types.ts:1097 | 10 |
| IssuedStatement | docNo | 필수 | string | src/shared/types.ts:1098 | 42 |
| IssuedStatement | totalSupply | 필수 | number | src/shared/types.ts:1099 | 5 |
| IssuedStatement | totalTax | 필수 | number | src/shared/types.ts:1100 | 6 |
| IssuedStatement | totalAmount | 필수 | number | src/shared/types.ts:1101 | 50 |
| IssuedStatement | items | 필수 | IssuedStatementItem[] | src/shared/types.ts:1102 | 48 |
| IssuedStatement | partySnapshot | 선택 | StatementPartySnapshot | src/shared/types.ts:1104 | 3 |
| IssuedStatement | memo | 선택 | string | src/shared/types.ts:1109 | 3 |
| IssuedStatement | createdBy | 선택 | string | src/shared/types.ts:1117 | 3 |
| IssuedStatement | evidence | 선택 | string | src/shared/types.ts:1125 | 0 |
| IssuedStatement | taxIssuedAt | 선택 | string | src/shared/types.ts:1126 | 11 |
| IssuedStatement | exemptIssuedAt | 선택 | string | src/shared/types.ts:1132 | 1 |
| IssuedStatement | cashDir | 선택 | '입금' \| '출금' | src/shared/types.ts:1133 | 0 |
| PurchaseOrderItem | itemId | 필수 | string | src/shared/types.ts:1150 | 43 |
| PurchaseOrderItem | name | 필수 | string | src/shared/types.ts:1151 | 22 |
| PurchaseOrderItem | quantity | 필수 | number | src/shared/types.ts:1153 | 26 |
| PurchaseOrderItem | unit | 필수 | string | src/shared/types.ts:1154 | 11 |
| PurchaseOrderItem | boxQuantity | 선택 | number | src/shared/types.ts:1160 | 0 |
| PurchaseOrder | id | 필수 | string | src/shared/types.ts:1164 | 77 |
| PurchaseOrder | companyId | 선택 | CompanyId | src/shared/types.ts:1166 | 5 |
| PurchaseOrder | itemId | 필수 | string | src/shared/types.ts:1167 | 5 |
| PurchaseOrder | itemName | 필수 | string | src/shared/types.ts:1168 | 1 |
| PurchaseOrder | partnerId | 선택 | string | src/shared/types.ts:1169 | 16 |
| PurchaseOrder | partnerName | 선택 | string | src/shared/types.ts:1170 | 21 |
| PurchaseOrder | quantity | 필수 | number | src/shared/types.ts:1171 | 11 |
| PurchaseOrder | unit | 선택 | string | src/shared/types.ts:1172 | 1 |
| PurchaseOrder | boxQuantity | 선택 | number | src/shared/types.ts:1174 | 1 |
| PurchaseOrder | status | 필수 | 'pending' \| 'invoiced' \| 'received' | src/shared/types.ts:1175 | 32 |
| PurchaseOrder | confirmedByUser | 선택 | boolean | src/shared/types.ts:1176 | 1 |
| PurchaseOrder | linkedStatementId | 선택 | string | src/shared/types.ts:1177 | 22 |
| PurchaseOrder | cardNo | 선택 | string | src/shared/types.ts:1182 | 2 |
| PurchaseOrder | linkedStatementAt | 선택 | string | src/shared/types.ts:1183 | 1 |
| PurchaseOrder | createdAt | 필수 | string | src/shared/types.ts:1184 | 11 |
| PurchaseOrder | invoicedAt | 선택 | string | src/shared/types.ts:1185 | 3 |
| PurchaseOrder | receivedAt | 선택 | string | src/shared/types.ts:1186 | 7 |
| PurchaseOrder | items | 선택 | PurchaseOrderItem[] | src/shared/types.ts:1187 | 14 |
| PurchaseOrder | photoUrl | 선택 | string | src/shared/types.ts:1188 | 0 |
| PurchaseOrder | note | 선택 | string | src/shared/types.ts:1189 | 1 |
| PurchaseOrder | poType | 선택 | 'oem' | src/shared/types.ts:1193 | 15 |
| PurchaseOrder | oemPartnerId | 선택 | string | src/shared/types.ts:1194 | 4 |
| PurchaseOrder | oemSent | 선택 | { material: string; kg: number; rawItemId?: string }[] | src/shared/types.ts:1195 | 10 |
| PurchaseOrder | oemSentAt | 선택 | string | src/shared/types.ts:1196 | 1 |
| PurchaseOrder | oemIssueStatus | 선택 | 'processing' \| 'failed' \| 'complete' | src/shared/types.ts:1198 | 3 |
| PurchaseOrder | oemIssueFingerprint | 선택 | string | src/shared/types.ts:1199 | 3 |
| PurchaseOrder | oemIssueDate | 선택 | string | src/shared/types.ts:1200 | 3 |
| PurchaseOrder | oemIssuedBy | 선택 | string | src/shared/types.ts:1201 | 1 |
| PurchaseOrder | oemIssueError | 선택 | string | src/shared/types.ts:1202 | 0 |
| PurchaseOrder | oemReceivedKg | 선택 | number | src/shared/types.ts:1203 | 5 |
| PurchaseOrder | oemReceivedBulk | 선택 | { material: string; kg: number }[] | src/shared/types.ts:1204 | 4 |
| PurchaseOrder | oemFeePerKg | 선택 | number | src/shared/types.ts:1205 | 3 |
| PurchaseOrder | oemReceiptOperationId | 선택 | string | src/shared/types.ts:1207 | 3 |
| CompanyInfo | name | 필수 | string | src/shared/types.ts:1241 | 4 |
| CompanyInfo | ceoName | 필수 | string | src/shared/types.ts:1242 | 3 |
| CompanyInfo | bizNo | 필수 | string | src/shared/types.ts:1243 | 3 |
| CompanyInfo | bizType | 필수 | string | src/shared/types.ts:1244 | 2 |
| CompanyInfo | bizItem | 필수 | string | src/shared/types.ts:1245 | 2 |
| CompanyInfo | address | 필수 | string | src/shared/types.ts:1246 | 3 |
| CompanyInfo | phone | 선택 | string | src/shared/types.ts:1247 | 2 |
| CompanyInfo | fax | 선택 | string | src/shared/types.ts:1248 | 2 |
| CompanyInfo | email | 선택 | string | src/shared/types.ts:1249 | 0 |
| CompanyInfo | bankAccount | 선택 | string | src/shared/types.ts:1250 | 3 |
| CompanyInfo | adminPassword | 선택 | string | src/shared/types.ts:1251 | 2 |
| ExpensePreset | id | 필수 | string | src/shared/types.ts:1256 | 2 |
| ExpensePreset | name | 필수 | string | src/shared/types.ts:1257 | 2 |
| ExpensePreset | price | 선택 | number | src/shared/types.ts:1258 | 2 |
| ExpensePreset | taxType | 선택 | '과세' \| '면세' | src/shared/types.ts:1259 | 1 |
| ExpensePreset | createdAt | 선택 | string | src/shared/types.ts:1260 | 0 |
| AppNotification | id | 필수 | string | src/shared/types.ts:1264 | 5 |
| AppNotification | type | 필수 | 'new_order' \| 'confirmation' \| 'mention' \| 'leave_request' \| 'inventory_shortage' | src/shared/types.ts:1265 | 8 |
| AppNotification | title | 필수 | string | src/shared/types.ts:1266 | 1 |
| AppNotification | body | 필수 | string | src/shared/types.ts:1267 | 3 |
| AppNotification | readBy | 필수 | string[] | src/shared/types.ts:1268 | 4 |
| AppNotification | dismissedBy | 선택 | string[] | src/shared/types.ts:1269 | 1 |
| AppNotification | createdAt | 필수 | string | src/shared/types.ts:1270 | 3 |
| AppNotification | linkedId | 선택 | string | src/shared/types.ts:1271 | 4 |
| AppNotification | senderId | 선택 | string | src/shared/types.ts:1272 | 0 |
| AppNotification | targetId | 선택 | string | src/shared/types.ts:1273 | 2 |
| RawMaterialLot | id | 필수 | string | src/shared/types.ts:1282 | 97 |
| RawMaterialLot | supplierId | 선택 | string | src/shared/types.ts:1283 | 0 |
| RawMaterialLot | supplierName | 필수 | string | src/shared/types.ts:1284 | 28 |
| RawMaterialLot | packageType | 선택 | string | src/shared/types.ts:1285 | 2 |
| RawMaterialLot | packageKg | 선택 | number | src/shared/types.ts:1286 | 6 |
| RawMaterialLot | qtyIn | 선택 | number | src/shared/types.ts:1287 | 4 |
| RawMaterialLot | kgIn | 필수 | number | src/shared/types.ts:1288 | 3 |
| RawMaterialLot | kgRemaining | 필수 | number | src/shared/types.ts:1289 | 65 |
| RawMaterialLot | receivedDate | 필수 | string | src/shared/types.ts:1290 | 18 |
| RawMaterialLot | lotNo | 선택 | string | src/shared/types.ts:1291 | 33 |
| RawMaterialLot | status | 필수 | 'active' \| 'depleted' | src/shared/types.ts:1292 | 42 |
| RawMaterialLot | poId | 선택 | string | src/shared/types.ts:1293 | 1 |
| RawMaterialLot | createdAt | 필수 | string | src/shared/types.ts:1294 | 3 |
| RawMaterialLot | material | 선택 | string | src/shared/types.ts:1305 | 2 |
| RawMaterialLot | qtyRemaining | 선택 | number | src/shared/types.ts:1307 | 39 |
| RawMaterialLot | unitKg | 선택 | number | src/shared/types.ts:1309 | 8 |
| RawMaterialEntry | id | 필수 | string | src/shared/types.ts:1320 | 40 |
| RawMaterialEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1322 | 5 |
| RawMaterialEntry | rawItemId | 선택 | string | src/shared/types.ts:1333 | 13 |
| RawMaterialEntry | material | 필수 | string | src/shared/types.ts:1335 | 38 |
| RawMaterialEntry | date | 필수 | string | src/shared/types.ts:1336 | 23 |
| RawMaterialEntry | received | 필수 | number | src/shared/types.ts:1337 | 18 |
| RawMaterialEntry | used | 필수 | number | src/shared/types.ts:1338 | 17 |
| RawMaterialEntry | note | 필수 | string | src/shared/types.ts:1339 | 13 |
| RawMaterialEntry | createdAt | 필수 | string | src/shared/types.ts:1340 | 12 |
| RawMaterialEntry | recordedAt | 선택 | string | src/shared/types.ts:1342 | 7 |
| RawMaterialEntry | sequence | 선택 | number | src/shared/types.ts:1344 | 3 |
| RawMaterialEntry | effectiveAt | 선택 | string | src/shared/types.ts:1346 | 8 |
| RawMaterialEntry | balanceAfterKg | 선택 | number | src/shared/types.ts:1348 | 3 |
| RawMaterialEntry | addedBy | 선택 | string | src/shared/types.ts:1349 | 8 |
| RawMaterialEntry | type | 선택 | 'auto' \| 'manual' \| 'correction' \| 'stocktake_unit' | src/shared/types.ts:1350 | 13 |
| RawMaterialEntry | orderId | 선택 | string | src/shared/types.ts:1351 | 2 |
| RawMaterialEntry | canSize | 선택 | number | src/shared/types.ts:1352 | 2 |
| RawMaterialEntry | canSizeTag | 선택 | string | src/shared/types.ts:1353 | 2 |
| RawMaterialEntry | canCount | 선택 | number | src/shared/types.ts:1354 | 4 |
| RawMaterialEntry | unit | 선택 | 'kg' \| 'L' | src/shared/types.ts:1355 | 7 |
| RawMaterialEntry | originalAmount | 선택 | number | src/shared/types.ts:1357 | 1 |
| RawMaterialEntry | originalUnit | 선택 | 'kg' \| 'L' | src/shared/types.ts:1358 | 1 |
| RawMaterialEntry | targetKg | 선택 | number | src/shared/types.ts:1359 | 14 |
| RawMaterialEntry | targetLotId | 선택 | string | src/shared/types.ts:1361 | 4 |
| ItemFormula | id | 필수 | string | src/shared/types.ts:1369 | 1 |
| ItemFormula | parent_key | 필수 | string | src/shared/types.ts:1370 | 9 |
| ItemFormula | child_name | 필수 | string | src/shared/types.ts:1371 | 6 |
| ItemFormula | ratio | 필수 | number | src/shared/types.ts:1372 | 5 |
| ItemFormula | yield_rate | 필수 | number | src/shared/types.ts:1373 | 4 |
| ItemBom | id | 필수 | string | src/shared/types.ts:1378 | 4 |
| ItemBom | parent_id | 필수 | string | src/shared/types.ts:1379 | 14 |
| ItemBom | child_id | 필수 | string | src/shared/types.ts:1380 | 11 |
| ItemBom | quantity | 필수 | number | src/shared/types.ts:1381 | 3 |
| ReturnItem | itemId | 필수 | string | src/shared/types.ts:1389 | 10 |
| ReturnItem | name | 필수 | string | src/shared/types.ts:1390 | 9 |
| ReturnItem | quantity | 필수 | number | src/shared/types.ts:1391 | 14 |
| ReturnItem | price | 필수 | number | src/shared/types.ts:1392 | 5 |
| ReturnItem | reason | 필수 | ReturnReason | src/shared/types.ts:1393 | 3 |
| ReturnItem | isResellable | 필수 | boolean | src/shared/types.ts:1394 | 9 |
| ReturnRequest | id | 필수 | string | src/shared/types.ts:1398 | 14 |
| ReturnRequest | orderId | 선택 | string | src/shared/types.ts:1399 | 3 |
| ReturnRequest | partnerId | 필수 | string | src/shared/types.ts:1400 | 2 |
| ReturnRequest | partnerName | 필수 | string | src/shared/types.ts:1401 | 9 |
| ReturnRequest | items | 필수 | ReturnItem[] | src/shared/types.ts:1402 | 18 |
| ReturnRequest | totalAmount | 필수 | number | src/shared/types.ts:1403 | 4 |
| ReturnRequest | status | 필수 | 'pending' \| 'processed' | src/shared/types.ts:1404 | 18 |
| ReturnRequest | returnType | 선택 | '매출' \| '매입' | src/shared/types.ts:1405 | 2 |
| ReturnRequest | createdAt | 필수 | string | src/shared/types.ts:1406 | 12 |
| ReturnRequest | createdBy | 선택 | string | src/shared/types.ts:1407 | 1 |
| ReturnRequest | processedAt | 선택 | string | src/shared/types.ts:1408 | 6 |
| ReturnRequest | processedBy | 선택 | string | src/shared/types.ts:1409 | 2 |
| ReturnRequest | linkedStatementId | 선택 | string | src/shared/types.ts:1410 | 8 |
| ReturnRequest | note | 선택 | string | src/shared/types.ts:1411 | 5 |
| PendingStatementEdit | id | 필수 | string | src/shared/types.ts:1415 | 3 |
| PendingStatementEdit | statementId | 필수 | string | src/shared/types.ts:1416 | 1 |
| PendingStatementEdit | statementDocNo | 필수 | string | src/shared/types.ts:1417 | 1 |
| PendingStatementEdit | statementType | 필수 | '매출' \| '매입' | src/shared/types.ts:1418 | 1 |
| PendingStatementEdit | partnerName | 필수 | string | src/shared/types.ts:1419 | 1 |
| PendingStatementEdit | proposedData | 필수 | {     tradeDate: string;     partnerId: string;     partnerName: string;     totalSupply: number;     totalTax: number;     totalAmount: number;     items: IssuedStatementItem[];   } | src/shared/types.ts:1420 | 3 |
| PendingStatementEdit | createdAt | 필수 | string | src/shared/types.ts:1429 | 2 |
| PendingStatementEdit | createdBy | 필수 | string | src/shared/types.ts:1430 | 1 |
| PendingStatementEdit | status | 필수 | 'pending' \| 'approved' \| 'rejected' | src/shared/types.ts:1431 | 1 |
| PendingStatementEdit | reason | 선택 | string | src/shared/types.ts:1432 | 1 |
| PendingStatementEdit | changes | 선택 | { name: string; oldQty: number; newQty: number }[] | src/shared/types.ts:1433 | 2 |
| PendingStatementEdit | sourcePoId | 선택 | string | src/shared/types.ts:1434 | 0 |
| AccountCode | id | 필수 | string | src/shared/types.ts:1441 | 25 |
| AccountCode | code | 필수 | string | src/shared/types.ts:1442 | 95 |
| AccountCode | name | 필수 | string | src/shared/types.ts:1443 | 56 |
| AccountCode | groupId | 선택 | string | src/shared/types.ts:1444 | 11 |
| AccountCode | type | 선택 | AccountType | src/shared/types.ts:1446 | 17 |
| AccountCode | normalBalance | 선택 | 'debit' \| 'credit' | src/shared/types.ts:1447 | 9 |
| AccountCode | isCash | 선택 | boolean | src/shared/types.ts:1448 | 1 |
| AccountCode | noncash | 선택 | boolean | src/shared/types.ts:1453 | 0 |
| AccountCode | note | 선택 | string | src/shared/types.ts:1454 | 0 |
| JournalLine | accountCode | 필수 | string | src/shared/types.ts:1459 | 35 |
| JournalLine | debit | 필수 | number | src/shared/types.ts:1460 | 34 |
| JournalLine | credit | 필수 | number | src/shared/types.ts:1461 | 30 |
| JournalLine | partnerId | 선택 | string | src/shared/types.ts:1462 | 12 |
| JournalLine | note | 선택 | string | src/shared/types.ts:1463 | 1 |
| JournalEntry | id | 필수 | string | src/shared/types.ts:1467 | 10 |
| JournalEntry | date | 필수 | string | src/shared/types.ts:1468 | 15 |
| JournalEntry | lines | 필수 | JournalLine[] | src/shared/types.ts:1469 | 32 |
| JournalEntry | memo | 선택 | string | src/shared/types.ts:1470 | 3 |
| JournalEntry | sourceType | 필수 | '매출' \| '매입' \| '대체' \| '자금' \| '수동' | src/shared/types.ts:1471 | 9 |
| JournalEntry | sourceId | 선택 | string | src/shared/types.ts:1472 | 14 |
| JournalEntry | createdAt | 필수 | string | src/shared/types.ts:1473 | 0 |
| JournalEntry | createdBy | 선택 | string | src/shared/types.ts:1474 | 0 |
| AccountGroup | id | 필수 | string | src/shared/types.ts:1482 | 24 |
| AccountGroup | name | 필수 | string | src/shared/types.ts:1483 | 9 |
| AccountGroup | type | 필수 | '수익' \| '비용' \| '자산' \| '부채' \| '자본' | src/shared/types.ts:1484 | 6 |
| AccountGroup | plLine | 선택 | AccountGroupPlLine | src/shared/types.ts:1485 | 4 |
| AccountGroup | cfSection | 선택 | AccountGroupCfSection | src/shared/types.ts:1488 | 1 |
| AccountGroup | note | 선택 | string | src/shared/types.ts:1489 | 0 |
| CashAccount | id | 필수 | string | src/shared/types.ts:1497 | 43 |
| CashAccount | companyId | 선택 | CompanyId | src/shared/types.ts:1499 | 5 |
| CashAccount | name | 필수 | string | src/shared/types.ts:1500 | 12 |
| CashAccount | type | 필수 | '통장' \| '카드' \| '현금' | src/shared/types.ts:1501 | 21 |
| CashAccount | openingBalance | 필수 | number | src/shared/types.ts:1502 | 13 |
| CashAccount | openingDate | 필수 | string | src/shared/types.ts:1503 | 14 |
| CashAccount | active | 필수 | boolean | src/shared/types.ts:1504 | 15 |
| CashAccount | note | 선택 | string | src/shared/types.ts:1505 | 0 |
| CashAccount | confirmedBalances | 선택 | Array<{ date: string; balance: number; recordedAt: string; reason: string }> | src/shared/types.ts:1506 | 4 |
| CashAccount | createdAt | 필수 | string | src/shared/types.ts:1507 | 0 |
| CashEntry | id | 필수 | string | src/shared/types.ts:1511 | 52 |
| CashEntry | balanceAdjustment | 선택 | { before: number; target: number; delta: number; reason: string; confirmedBalance?: boolean } | src/shared/types.ts:1513 | 20 |
| CashEntry | linkedAccrualStatementId | 선택 | string | src/shared/types.ts:1515 | 2 |
| CashEntry | loanId | 선택 | string | src/shared/types.ts:1517 | 7 |
| CashEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1519 | 1 |
| CashEntry | docNo | 선택 | string | src/shared/types.ts:1525 | 9 |
| CashEntry | date | 필수 | string | src/shared/types.ts:1526 | 44 |
| CashEntry | cashAccountId | 필수 | string | src/shared/types.ts:1527 | 9 |
| CashEntry | dir | 필수 | '입금' \| '출금' \| '대체' | src/shared/types.ts:1538 | 51 |
| CashEntry | amount | 필수 | number | src/shared/types.ts:1539 | 29 |
| CashEntry | partnerId | 선택 | string | src/shared/types.ts:1540 | 36 |
| CashEntry | partnerName | 선택 | string | src/shared/types.ts:1541 | 16 |
| CashEntry | accountCode | 선택 | string | src/shared/types.ts:1542 | 24 |
| CashEntry | lines | 선택 | {     accountCode: string;     /**      * **언제나 양수로 적는다.** 차·대는 `side`가 말한다.      *      * `side`가 없는 옛 줄은 **부호가 곧 차·대**였다 — 양수면 통장 반대편, 음수면      * 통장과 같은 편(급여 원천공제가 그 길). 그 규칙은 `dir`에 매달려 있어서      * 입금·출금을 바꾸면 모든 줄의 뜻이 조용히 뒤집혔다. 읽는 쪽은 아직 그 줄도      * 받아 주지만(옛 데이터 호환), **새로 쓸 땐 `side`를 넣는다.**      */     amount: number;     /** 차변이냐 대변이냐. 대체전표 줄(`IssuedStatementItem.side`)과 같은 모양이다. */     side?: '차변' \| '대변';     note?: string;   }[] | src/shared/types.ts:1549 | 24 |
| CashEntry | offsetOf | 선택 | { ar: string; ap: string } | src/shared/types.ts:1565 | 0 |
| CashEntry | note | 선택 | string | src/shared/types.ts:1566 | 19 |
| CashEntry | createdAt | 필수 | string | src/shared/types.ts:1567 | 15 |
| CashEntry | createdBy | 선택 | string | src/shared/types.ts:1568 | 5 |
| Settlement | id | 필수 | string | src/shared/types.ts:1574 | 8 |
| Settlement | cashEntryId | 필수 | string | src/shared/types.ts:1575 | 11 |
| Settlement | statementId | 필수 | string | src/shared/types.ts:1576 | 9 |
| Settlement | amount | 필수 | number | src/shared/types.ts:1577 | 9 |
| Settlement | createdAt | 필수 | string | src/shared/types.ts:1578 | 0 |
| InventorySnapshot | id | 필수 | string | src/shared/types.ts:1582 | 5 |
| InventorySnapshot | companyId | 선택 | CompanyId | src/shared/types.ts:1585 | 0 |
| InventorySnapshot | yearMonth | 필수 | string | src/shared/types.ts:1586 | 8 |
| InventorySnapshot | value | 필수 | number | src/shared/types.ts:1587 | 5 |
| InventorySnapshot | recordedAt | 필수 | string | src/shared/types.ts:1588 | 1 |
| InventorySnapshot | items | 선택 | { itemId: string; name: string; category?: string; spec?: string; qty: number; value: number }[] | src/shared/types.ts:1591 | 3 |
| CashFlowManual | id | 필수 | string | src/shared/types.ts:1596 | 0 |
| CashFlowManual | month | 필수 | string | src/shared/types.ts:1597 | 3 |
| CashFlowManual | depreciation | 선택 | number | src/shared/types.ts:1598 | 1 |
| CashFlowManual | prepaidInc | 선택 | number | src/shared/types.ts:1599 | 1 |
| CashFlowManual | assetBuy | 선택 | number | src/shared/types.ts:1600 | 1 |
| CashFlowManual | assetSell | 선택 | number | src/shared/types.ts:1601 | 1 |
| CashFlowManual | financeIn | 선택 | number | src/shared/types.ts:1602 | 1 |
| CashFlowManual | debtRepay | 선택 | number | src/shared/types.ts:1603 | 1 |
| CashFlowManual | openingCash | 선택 | number | src/shared/types.ts:1604 | 4 |
| CashFlowManual | closingCash | 선택 | number | src/shared/types.ts:1605 | 4 |
| ProductionSalesLog | id | 필수 | string | src/shared/types.ts:1609 | 10 |
| ProductionSalesLog | companyId | 선택 | CompanyId | src/shared/types.ts:1610 | 1 |
| ProductionSalesLog | date | 필수 | string | src/shared/types.ts:1611 | 12 |
| ProductionSalesLog | createdAt | 필수 | string | src/shared/types.ts:1612 | 2 |
| ProductionSalesLog | createdBy | 필수 | string | src/shared/types.ts:1613 | 2 |
| ProductionSalesLog | orderCount | 필수 | number | src/shared/types.ts:1614 | 3 |
| ProductionSalesLog | productionRows | 필수 | { groupLabel: string; spec: string; 수량: number; 소비기한: string; 비고: string }[] | src/shared/types.ts:1616 | 2 |
| ProductionSalesLog | seedRows | 선택 | { 품목: string; 용량: string; 수량: number; 소비기한: string; 비고: string }[] | src/shared/types.ts:1618 | 2 |
| ProductionSalesLog | salesRows | 선택 | { 상호: string; 품목: string; 용량: string; 수량: number; 소비기한: string }[] | src/shared/types.ts:1620 | 5 |
| ProductionSalesLog | extraRows | 선택 | { 품목: string; 용량: string; 수량: number; 거래처: string }[] | src/shared/types.ts:1622 | 1 |
| ProductionSalesLog | orderSummaries | 필수 | { partnerName: string; items: { name: string; qty: number }[] }[] | src/shared/types.ts:1624 | 1 |
| AdjustmentRequest | id | 필수 | string | src/shared/types.ts:1632 | 19 |
| AdjustmentRequest | companyId | 선택 | CompanyId | src/shared/types.ts:1633 | 1 |
| AdjustmentRequest | itemId | 필수 | string | src/shared/types.ts:1634 | 9 |
| AdjustmentRequest | itemName | 필수 | string | src/shared/types.ts:1635 | 3 |
| AdjustmentRequest | originalQuantity | 필수 | number | src/shared/types.ts:1636 | 6 |
| AdjustmentRequest | requestedQuantity | 선택 | number | src/shared/types.ts:1637 | 9 |
| AdjustmentRequest | type | 필수 | AdjustmentType | src/shared/types.ts:1638 | 31 |
| AdjustmentRequest | reason | 필수 | string | src/shared/types.ts:1639 | 4 |
| AdjustmentRequest | status | 필수 | AdjustmentStatus | src/shared/types.ts:1640 | 11 |
| AdjustmentRequest | requestedAt | 필수 | string | src/shared/types.ts:1641 | 4 |
| AdjustmentRequest | processedAt | 선택 | string | src/shared/types.ts:1642 | 3 |
| AdjustmentRequest | unit | 선택 | string | src/shared/types.ts:1643 | 4 |
| AdjustmentRequest | oemPoId | 선택 | string | src/shared/types.ts:1645 | 3 |
| AdjustmentRequest | oemFeePerKg | 선택 | number | src/shared/types.ts:1646 | 5 |
| AdjustmentRequest | oemTotal | 선택 | number | src/shared/types.ts:1647 | 2 |
