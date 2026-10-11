# 현재 코드 필드 사전

COL 86개, 선언 필드 725개, 운영 소스 453개를 분석했다.

TypeScript가 shared/types.ts 선언으로 해석한 속성 접근만 사용처로 집계한다. any·동적 인덱스·객체 전개·별도 모델은 포함하지 않으며, 사용처 0은 삭제 근거가 아니다. JSON에 정확한 파일·행별 사용처가 있다. 현재 DB의 실제 필드나 지향 설계를 뜻하지 않는다. 현재 checkout의 미배포 후보가 포함될 수 있으므로 배포 경계는 erd-current-and-target-20261007.md에서 별도로 확인한다.

## Firestore 경로 보완

SDK import·선언·수신 객체 타입으로 확인한 collection/doc/collectionGroup 호출 672건. 동적 문서 ID도 미해석으로 보존하며, 미해석 341건은 컬렉션 이름 누락과 같은 의미가 아니다. 서버 호출·중첩 경로·직접 const 별칭을 포함한다. 동적 문자열 안의 슬래시 수는 알 수 없어 깊이를 확정하지 않으며, JSON의 argumentDepthCandidate/pathKind는 인수 형태에 따른 후보이다. 함수 반환·분기·객체 전개로 구성한 경로는 해석하지 않는다. scripts·rules·테스트·JS 및 공용 래퍼 호출부의 경로 문자열은 이 운영 TS 소스 범위 밖이다. SDK 근거 없는 같은 이름 호출 19건은 JSON의 candidateCalls에 집계 밖 후보로 남긴다.

COL 밖 정적 컬렉션 이름: `itemUnpackMovements`. 이 목록은 운영 DB 존재/삭제 대상이 아니라 코드에 나타난 이름이다. 부모를 해석하지 못한 호출은 COL 대조에서 제외한다.

동적 컬렉션 호출 38건과 정적 컬렉션의 동적 문서 경로 302건을 구분한다. 후자는 컬렉션 자체의 누락이 아니다. JSON dynamicWrappers는 SDK 호출의 명명 함수와 타입 검사기로 연결된 실제 소비자 위치/인수식을 기록한다. 인수식은 240자까지 표시하고 잘린 경우 truncated=true를 남기며, resolvedPaths는 실제 선언의 인수 대입으로 확인된 첫 컬렉션만 기록하며 회사 조건·문서 ID·런타임 컬렉션 전체 집합을 보장하지 않는다. 익명 고차 함수·객체 DTO·동적 분기는 원문 소스를 함께 대조한다.

| 동적 컬렉션 공용 함수 | 선언 | SDK 위치 | 실제 연결된 소비자 위치 |
| --- | --- | --- | --- |
| doc | functions/src/financialOpeningCommand.ts:19 | functions/src/financialOpeningCommand.ts:19 | functions/src/financialOpeningCommand.ts:27: 미해석; functions/src/financialOpeningCommand.ts:28: 미해석; functions/src/financialOpeningCommand.ts:30: 미해석; functions/src/financialOpeningCommand.ts:61: 미해석; functions/src/financialOpeningCommand.ts:62: 미해석; functions/src/financialOpeningCommand.ts:63: 미해석; functions/src/financialOpeningCommand.ts:64: 미해석; functions/src/financialOpeningCommand.ts:100: 미해석; functions/src/financialOpeningCommand.ts:101: 미해석; functions/src/financialOpeningCommand.ts:150: 미해석; functions/src/financialOpeningCommand.ts:151: 미해석; functions/src/financialOpeningCommand.ts:152: 미해석; functions/src/financialOpeningCommand.ts:194: 미해석; functions/src/financialOpeningCommand.ts:195: 미해석 |
| subscribeToDocument | src/shared/services/firebaseService.ts:148 | src/shared/services/firebaseService.ts:153 | src/shared/deliveryTimeSlot.ts:24: settings; components/OrdersList.tsx:1712: settings; components/DeliveryManager.tsx:138: settings; components/LeaveManager.tsx:181: settings; src/shared/hooks/useAppData.ts:326: settings |
| setDocument | src/shared/services/firebaseService.ts:158 | src/shared/services/firebaseService.ts:160 | src/shared/deliveryTimeSlot.ts:34: settings; components/OrdersList.tsx:1718: settings; components/DeliveryManager.tsx:300: deliveryScheduleAudits; components/DeliveryManager.tsx:302: settings; components/DeliveryManager.tsx:303: deliveryScheduleAudits; components/DeliveryManager.tsx:309: deliveryScheduleAudits; components/DeliveryManager.tsx:480: settings; components/DeliveryManager.tsx:486: settings; components/DeliveryManager.tsx:1201: settings; components/LeaveManager.tsx:215: settings; components/PartnerSignupApproval.tsx:59: users; components/PartnerSignupApproval.tsx:74: users; components/HaccpChecklist.tsx:2881: haccp_templates; components/HaccpChecklist.tsx:3008: haccp_templates; components/HaccpChecklist.tsx:3144: haccp_templates; components/HaccpChecklist.tsx:3316: haccp_templates; components/HaccpChecklist.tsx:3459: haccp_templates; components/HaccpChecklist.tsx:4019: haccp_templates; components/HaccpChecklist.tsx:4489: haccp_templates; src/features/admin/AdminApp.tsx:398: partner_item; src/features/admin/AdminApp.tsx:4320: settings; src/features/admin/AdminApp.tsx:4504: cashFlowManual |
| subscribeToCollection | src/shared/services/firebaseService.ts:244 | src/shared/services/firebaseService.ts:250 | src/shared/services/firebaseService.ts:290: 미해석; components/ItemList.tsx:535: stockClosings; src/shared/hooks/useAppData.ts:252: 미해석; src/shared/hooks/useAppData.ts:258: issuedStatements; src/shared/hooks/useAppData.ts:272: cashAccounts; src/shared/hooks/useAppData.ts:273: returnOperations; src/shared/hooks/useAppData.ts:276: cashEntries; src/shared/hooks/useAppData.ts:277: settlements; src/shared/hooks/useAppData.ts:278: partnerAdvanceOperations; src/shared/hooks/useAppData.ts:279: inventorySnapshots; src/shared/hooks/useAppData.ts:298: 미해석; src/shared/hooks/useAppData.ts:307: notices; src/shared/hooks/useAppData.ts:308: pallets; src/shared/hooks/useAppData.ts:310: employees; src/shared/hooks/useAppData.ts:311: leaveRequests; src/shared/hooks/useAppData.ts:312: adjustmentRequests; src/shared/hooks/useAppData.ts:313: purchaseOrders; src/shared/hooks/useAppData.ts:314: items; src/shared/hooks/useAppData.ts:315: partners; src/shared/hooks/useAppData.ts:316: chatRooms; src/shared/hooks/useAppData.ts:321: notifications; src/shared/hooks/useAppData.ts:322: workOrderItems; src/shared/hooks/useAppData.ts:324: itemReceipts; src/shared/hooks/useAppData.ts:344: orders; src/hooks/useAdminData.ts:56: fixedCosts; src/hooks/useAdminData.ts:61: productionRecords; components/HRManager.tsx:128: payrolls; components/PartnerSignupApproval.tsx:40: users; components/DocumentManager.tsx:78: fileCabinetCategories; components/DocumentManager.tsx:79: fileCabinetSubCategories; components/DocumentManager.tsx:80: fileCabinetDocs; components/QuotationManager.tsx:117: quotations; components/ReturnManager.tsx:104: returnRequests; components/ReceivingReturnsManager.tsx:56: returnRequests |
| fetchCollection | src/shared/services/firebaseService.ts:267 | src/shared/services/firebaseService.ts:271 | components/AddItemModal.tsx:136: itemTaxonomy; components/CategoryManager.tsx:39: itemTaxonomy; components/ItemList.tsx:511: itemTaxonomy; components/ItemList.tsx:566: fileCabinetCategories; components/ItemList.tsx:568: fileCabinetSubCategories; components/ItemManager.tsx:320: itemTaxonomy; src/shared/hooks/useAppData.ts:222: orders; src/shared/hooks/useAppData.ts:377: partner_item; src/shared/hooks/useAppData.ts:378: item_bom; src/shared/hooks/useAppData.ts:379: item_pack; src/shared/hooks/useAppData.ts:380: item_formula; src/shared/hooks/useAppData.ts:384: accountGroups; src/shared/hooks/useAppData.ts:385: accountCodes; src/shared/hooks/useAppData.ts:386: fixedCostTemplates; src/shared/hooks/useAppData.ts:387: expensePresets; src/shared/hooks/useAppData.ts:388: cashFlowManual; components/DashboardLinks.tsx:53: dashboardLinks; components/DocumentManager.tsx:82: fileCabinetCategories; components/DocumentManager.tsx:114: fileCabinetCategories; components/DocumentManager.tsx:115: fileCabinetSubCategories; src/features/statements/hooks/useStatementHistoryFilters.ts:29: itemTaxonomy; src/features/admin/AdminApp.tsx:528: rawMaterialLedger; src/features/admin/AdminApp.tsx:541: rawMaterialLedger |
| fetchDateRange | src/shared/services/firebaseService.ts:298 | src/shared/services/firebaseService.ts:306 | src/features/admin/useProductionSalesHistory.ts:14: productionSalesLogs; components/PalletManager.tsx:65: palletTransactions; components/TaxStatement.tsx:58: issuedStatements; src/features/admin/useVoucherLedger.ts:152: issuedStatements; src/features/admin/useVoucherLedger.ts:169: issuedStatements |
| addItem | src/shared/services/firebaseService.ts:333 | src/shared/services/firebaseService.ts:346, src/shared/services/firebaseService.ts:346, src/shared/services/firebaseService.ts:346, src/shared/services/firebaseService.ts:369, src/shared/services/firebaseService.ts:372 | src/shared/services/employeeCommand.ts:36: 미해석, 미해석, 미해석, 미해석, 미해석; components/CategoryManager.tsx:45: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/CategoryManager.tsx:88: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/CategoryManager.tsx:106: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/CategoryManager.tsx:124: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/CategoryManager.tsx:149: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/ItemList.tsx:567: fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories; components/ItemList.tsx:570: fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories; components/DashboardLinks.tsx:64: dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks; components/DashboardLinks.tsx:93: dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks; components/DocumentManager.tsx:86: fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories; components/DocumentManager.tsx:119: fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories; components/DocumentManager.tsx:121: fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories; components/DocumentManager.tsx:206: fileCabinetDocs, fileCabinetDocs, fileCabinetDocs, fileCabinetDocs, fileCabinetDocs; components/DocumentManager.tsx:254: fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories; components/DocumentManager.tsx:274: fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories; components/QuotationManager.tsx:266: quotations, quotations, quotations, quotations, quotations; components/HaccpChecklist.tsx:555: haccp_temp, haccp_temp, haccp_temp, haccp_temp, haccp_temp; components/HaccpChecklist.tsx:1095: haccp_incoming, haccp_incoming, haccp_incoming, haccp_incoming, haccp_incoming; components/HaccpChecklist.tsx:1386: haccp_cleaning, haccp_cleaning, haccp_cleaning, haccp_cleaning, haccp_cleaning; components/HaccpChecklist.tsx:1982: haccp_sanitation, haccp_sanitation, haccp_sanitation, haccp_sanitation, haccp_sanitation; components/HaccpChecklist.tsx:2591: haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene; components/HaccpChecklist.tsx:3648: haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation; components/HaccpChecklist.tsx:4176: haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist; components/BenzopyreneLog.tsx:62: benzopyreneTests, benzopyreneTests, benzopyreneTests, benzopyreneTests, benzopyreneTests; src/features/admin/AdminApp.tsx:760: items, items, items, items, items; src/features/admin/AdminApp.tsx:1073: adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests; src/features/admin/AdminApp.tsx:1085: notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:1100: adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests; src/features/admin/AdminApp.tsx:1112: notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:1253: productionRecords, productionRecords, productionRecords, productionRecords, productionRecords; src/features/admin/AdminApp.tsx:1463: notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:1764: pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits; src/features/admin/AdminApp.tsx:2025: orderItemEdits, orderItemEdits, orderItemEdits, orderItemEdits, orderItemEdits; src/features/admin/AdminApp.tsx:2614: workOrderItems, workOrderItems, workOrderItems, workOrderItems, workOrderItems; src/features/admin/AdminApp.tsx:2650: items, items, items, items, items; src/features/admin/AdminApp.tsx:2671: adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests; src/features/admin/AdminApp.tsx:3024: partners, partners, partners, partners, partners; src/features/admin/AdminApp.tsx:3050: notices, notices, notices, notices, notices; src/features/admin/AdminApp.tsx:3060: palletTransactions, palletTransactions, palletTransactions, palletTransactions, palletTransactions; src/features/admin/AdminApp.tsx:3070: employees, employees, employees, employees, employees; src/features/admin/AdminApp.tsx:3078: leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests; src/features/admin/AdminApp.tsx:3389: productionSalesLogs, productionSalesLogs, productionSalesLogs, productionSalesLogs, productionSalesLogs; src/features/admin/AdminApp.tsx:4226: fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates; src/features/admin/AdminApp.tsx:4230: expensePresets, expensePresets, expensePresets, expensePresets, expensePresets; src/features/admin/AdminApp.tsx:4279: pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits; src/features/admin/AdminApp.tsx:4347: fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates; src/features/admin/AdminApp.tsx:4357: accountCodes, accountCodes, accountCodes, accountCodes, accountCodes; src/features/admin/AdminApp.tsx:4359: accountGroups, accountGroups, accountGroups, accountGroups, accountGroups; src/features/admin/AdminApp.tsx:4364: inventorySnapshots, inventorySnapshots, inventorySnapshots, inventorySnapshots, inventorySnapshots; src/features/admin/AdminApp.tsx:4426: fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates; src/features/admin/AdminApp.tsx:4575: productionRecords, productionRecords, productionRecords, productionRecords, productionRecords; src/features/admin/AdminApp.tsx:4649: leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests; src/features/admin/AdminApp.tsx:4651: notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:4785: chatRooms, chatRooms, chatRooms, chatRooms, chatRooms; src/features/admin/AdminApp.tsx:4804: chatMessages, chatMessages, chatMessages, chatMessages, chatMessages; src/features/admin/AdminApp.tsx:4826: notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:4835: adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests; src/features/admin/AdminApp.tsx:4947: items, items, items, items, items; src/features/admin/AdminApp.tsx:5002: items, items, items, items, items |
| updateItem | src/shared/services/firebaseService.ts:377 | src/shared/services/firebaseService.ts:378 | components/RawMaterialLotPanel.tsx:80: items; components/RawMaterialLotPanel.tsx:94: items; components/CategoryManager.tsx:91: itemTaxonomy; components/CategoryManager.tsx:105: itemTaxonomy; components/CategoryManager.tsx:120: itemTaxonomy; components/CategoryManager.tsx:135: itemTaxonomy; components/CategoryManager.tsx:159: itemTaxonomy; components/CategoryManager.tsx:180: itemTaxonomy; components/PalletManager.tsx:360: palletTransactions; components/DashboardLinks.tsx:103: dashboardLinks; components/DocumentManager.tsx:246: fileCabinetDocs; components/HaccpChecklist.tsx:559: haccp_temp; components/HaccpChecklist.tsx:570: haccp_temp; components/HaccpChecklist.tsx:1097: haccp_incoming; components/HaccpChecklist.tsx:1106: haccp_incoming; components/HaccpChecklist.tsx:1388: haccp_cleaning; components/HaccpChecklist.tsx:1397: haccp_cleaning; components/HaccpChecklist.tsx:1992: haccp_sanitation; components/HaccpChecklist.tsx:2015: haccp_sanitation; components/HaccpChecklist.tsx:2595: haccp_personal_hygiene; components/HaccpChecklist.tsx:2609: haccp_personal_hygiene; components/HaccpChecklist.tsx:3652: haccp_periodic_sanitation; components/HaccpChecklist.tsx:3666: haccp_periodic_sanitation; components/HaccpChecklist.tsx:4180: haccp_closing_checklist; components/HaccpChecklist.tsx:4194: haccp_closing_checklist; components/BenzopyreneLog.tsx:81: benzopyreneTests; src/features/admin/AdminApp.tsx:729: items; src/features/admin/AdminApp.tsx:781: items; src/features/admin/AdminApp.tsx:1145: purchaseOrders; src/features/admin/AdminApp.tsx:1153: purchaseOrders; src/features/admin/AdminApp.tsx:1155: purchaseOrders; src/features/admin/AdminApp.tsx:1164: purchaseOrders; src/features/admin/AdminApp.tsx:1172: purchaseOrders; src/features/admin/AdminApp.tsx:2019: orders; src/features/admin/AdminApp.tsx:2525: orders; src/features/admin/AdminApp.tsx:2528: orders; src/features/admin/AdminApp.tsx:2529: orders; src/features/admin/AdminApp.tsx:2530: orders; src/features/admin/AdminApp.tsx:2531: orders; src/features/admin/AdminApp.tsx:2559: orders; src/features/admin/AdminApp.tsx:2562: orders; src/features/admin/AdminApp.tsx:2563: orders; src/features/admin/AdminApp.tsx:2564: orders; src/features/admin/AdminApp.tsx:2565: orders; src/features/admin/AdminApp.tsx:2586: orders; src/features/admin/AdminApp.tsx:2587: orders; src/features/admin/AdminApp.tsx:2591: orders; src/features/admin/AdminApp.tsx:2592: orders; src/features/admin/AdminApp.tsx:2593: orders; src/features/admin/AdminApp.tsx:2594: orders; src/features/admin/AdminApp.tsx:2632: workOrderItems; src/features/admin/AdminApp.tsx:2648: items; src/features/admin/AdminApp.tsx:2666: purchaseOrders; src/features/admin/AdminApp.tsx:2821: items; src/features/admin/AdminApp.tsx:3024: partners; src/features/admin/AdminApp.tsx:3050: notices; src/features/admin/AdminApp.tsx:3059: pallets; src/features/admin/AdminApp.tsx:3069: employees; src/features/admin/AdminApp.tsx:3073: leaveRequests; src/features/admin/AdminApp.tsx:3075: leaveRequests; src/features/admin/AdminApp.tsx:3096: leaveRequests; src/features/admin/AdminApp.tsx:3098: adjustmentRequests; src/features/admin/AdminApp.tsx:3107: adjustmentRequests; src/features/admin/AdminApp.tsx:3131: adjustmentRequests; src/features/admin/AdminApp.tsx:3142: pendingStatementEdits; src/features/admin/AdminApp.tsx:3650: orders; src/features/admin/AdminApp.tsx:4223: cashAccounts; src/features/admin/AdminApp.tsx:4227: fixedCostTemplates; src/features/admin/AdminApp.tsx:4235: orders; src/features/admin/AdminApp.tsx:4300: purchaseOrders; src/features/admin/AdminApp.tsx:4348: fixedCostTemplates; src/features/admin/AdminApp.tsx:4356: accountCodes; src/features/admin/AdminApp.tsx:4360: accountGroups; src/features/admin/AdminApp.tsx:4452: cashAccounts; src/features/admin/AdminApp.tsx:4545: items; src/features/admin/AdminApp.tsx:4577: productionRecords; src/features/admin/AdminApp.tsx:4587: adjustmentRequests; src/features/admin/AdminApp.tsx:4596: adjustmentRequests; src/features/admin/AdminApp.tsx:4630: adjustmentRequests; src/features/admin/AdminApp.tsx:4663: leaveRequests; src/features/admin/AdminApp.tsx:4665: leaveRequests; src/features/admin/AdminApp.tsx:4786: chatRooms; src/features/admin/AdminApp.tsx:4789: chatMessages; src/features/admin/AdminApp.tsx:4814: chatRooms; src/features/admin/AdminApp.tsx:4985: items; src/features/admin/AdminApp.tsx:4997: items |
| deleteItem | src/shared/services/firebaseService.ts:387 | src/shared/services/firebaseService.ts:388 | src/shared/services/workOrderResetService.ts:21: workOrderItems; components/CategoryManager.tsx:169: itemTaxonomy; components/PalletManager.tsx:379: palletTransactions; components/DashboardLinks.tsx:109: dashboardLinks; components/DocumentManager.tsx:235: fileCabinetDocs; components/DocumentManager.tsx:265: fileCabinetCategories; components/DocumentManager.tsx:284: fileCabinetSubCategories; components/QuotationManager.tsx:362: quotations; components/HaccpChecklist.tsx:577: haccp_temp; components/HaccpChecklist.tsx:2028: haccp_sanitation; components/HaccpChecklist.tsx:2616: haccp_personal_hygiene; components/HaccpChecklist.tsx:3677: haccp_periodic_sanitation; components/HaccpChecklist.tsx:4205: haccp_closing_checklist; components/BenzopyreneLog.tsx:91: benzopyreneTests; src/features/admin/AdminApp.tsx:1011: notifications; src/features/admin/AdminApp.tsx:1141: purchaseOrders; src/features/admin/AdminApp.tsx:1163: purchaseOrders; src/features/admin/AdminApp.tsx:1166: purchaseOrders; src/features/admin/AdminApp.tsx:2610: workOrderItems; src/features/admin/AdminApp.tsx:3024: partners; src/features/admin/AdminApp.tsx:3050: notices; src/features/admin/AdminApp.tsx:3071: employees; src/features/admin/AdminApp.tsx:3076: leaveRequests; src/features/admin/AdminApp.tsx:3099: adjustmentRequests; src/features/admin/AdminApp.tsx:4228: fixedCostTemplates; src/features/admin/AdminApp.tsx:4231: expensePresets; src/features/admin/AdminApp.tsx:4349: fixedCostTemplates; src/features/admin/AdminApp.tsx:4358: accountCodes; src/features/admin/AdminApp.tsx:4361: accountGroups; src/features/admin/AdminApp.tsx:4576: productionRecords; src/features/admin/AdminApp.tsx:4628: purchaseOrders; src/features/admin/AdminApp.tsx:4633: adjustmentRequests; src/features/admin/AdminApp.tsx:4787: chatRooms; src/features/admin/AdminApp.tsx:4944: partner_item; src/features/admin/AdminApp.tsx:4972: items |
| subscribeToSubcollection | src/shared/services/firebaseService.ts:404 | src/shared/services/firebaseService.ts:410 | 정적 호출 연결 없음 |
| addSubItem | src/shared/services/firebaseService.ts:420 | src/shared/services/firebaseService.ts:429, src/shared/services/firebaseService.ts:432 | 정적 호출 연결 없음 |
| updateSubItem | src/shared/services/firebaseService.ts:437 | src/shared/services/firebaseService.ts:444 | 정적 호출 연결 없음 |
| deleteSubItem | src/shared/services/firebaseService.ts:448 | src/shared/services/firebaseService.ts:454 | 정적 호출 연결 없음 |
| fetchWhere | src/shared/services/firebaseService.ts:537 | src/shared/services/firebaseService.ts:542 | src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:16: productionWorkDocuments; src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:17: productionWorkDocumentLines; src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:129: orders; src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:130: rawMaterialLedger; src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:131: items; components/OrdersList.tsx:1632: orderStatusAudits; components/OrdersList.tsx:1633: orderItemEdits; src/features/admin/useVoucherLedger.ts:102: openingBalances; src/features/admin/useVoucherLedger.ts:114: partnerBalanceSnapshots; src/shared/useLoanContracts.ts:12: loanContracts; components/ProfitAnalysis.tsx:99: openingBalances; components/FinancialReports.tsx:111: openingBalances; components/LoanManager.tsx:76: loanContracts |
| fetchWhereIn | src/shared/services/firebaseService.ts:547 | src/shared/services/firebaseService.ts:557 | src/features/admin/AdminApp.tsx:1359: orders |
| fetchByIds | src/shared/services/firebaseService.ts:570 | src/shared/services/firebaseService.ts:578 | src/features/admin/useVoucherLedger.ts:136: issuedStatements |
| subscribeWhere | src/shared/services/firebaseService.ts:584 | src/shared/services/firebaseService.ts:591 | 정적 호출 연결 없음 |
| commitCompanyWrites | src/shared/services/firebaseService.ts:605 | src/shared/services/firebaseService.ts:611 | src/shared/services/firebaseService.ts:491: 미해석; src/shared/services/firebaseService.ts:522: 미해석; src/shared/services/firebaseService.ts:832: 미해석; src/features/admin/AdminApp.tsx:1409: 미해석; src/features/admin/AdminApp.tsx:4749: 미해석; src/features/admin/AdminApp.tsx:4930: 미해석; src/features/admin/AdminApp.tsx:5020: 미해석 |
| readPartnerAdvanceSnapshot | functions/src/partnerAdvanceReader.ts:11 | functions/src/partnerAdvanceReader.ts:15 | functions/src/partnerAdvanceCommand.ts:98: 미해석; functions/src/partnerAdvanceCommand.ts:128: 미해석; functions/src/deleteIssuedStatementCommand.ts:100: 미해석; functions/src/cashMutationCommand.ts:198: 미해석; functions/src/editIssuedStatementCommand.ts:196: 미해석; functions/src/processReturnCommand.ts:208: 미해석 |
| deleteIssuedStatement | functions/src/deleteIssuedStatementCommand.ts:55 | functions/src/deleteIssuedStatementCommand.ts:79, functions/src/deleteIssuedStatementCommand.ts:94, functions/src/deleteIssuedStatementCommand.ts:94, functions/src/deleteIssuedStatementCommand.ts:113, functions/src/deleteIssuedStatementCommand.ts:113 | functions/src/deleteIssuedStatementCommand.ts:135: 미해석, 미해석, 미해석, 미해석, 미해석 |
| issueVoucher | functions/src/voucherIssue.ts:33 | functions/src/voucherIssue.ts:74, functions/src/voucherIssue.ts:74, functions/src/voucherIssue.ts:75, functions/src/voucherIssue.ts:75 | functions/src/voucherIssue.ts:187: 미해석, 미해석, 미해석, 미해석; functions/src/autoVoucherCommand.ts:39: 미해석, 미해석, 미해석, 미해석 |
| recordTaxIssue | functions/src/taxIssueCommand.ts:12 | functions/src/taxIssueCommand.ts:35, functions/src/taxIssueCommand.ts:35, functions/src/taxIssueCommand.ts:62, functions/src/taxIssueCommand.ts:62, functions/src/taxIssueCommand.ts:76, functions/src/taxIssueCommand.ts:76 | functions/src/taxIssueCommand.ts:92: 미해석, 미해석, 미해석, 미해석, 미해석, 미해석 |

| 위치 | 실행 | API | 문맥 | 깊이 | 경로 (중괄호는 동적식) | COL 밖 |
| --- | --- | --- | --- | --- | --- | --- |
| src/shared/services/confirmPendingPurchaseOrderService.ts:36 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{expected.id} |  |
| src/shared/services/sharedChatMessageService.ts:34 | client | doc | root / top-level-candidate | 미해석 | chatMessages/{message.id} |  |
| src/shared/services/sharedChatMessageService.ts:35 | client | doc | root / top-level-candidate | 미해석 | chatRooms/{message.roomId} |  |
| src/shared/services/orderInventoryRecoveryService.ts:12 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| functions/src/cashMutationReceipt.ts:19 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/releaseGate.ts:5 | server | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| functions/src/releaseGate.ts:5 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/financialOpeningCommand.ts:19 | server | doc | unresolved-parent / unresolved-parent | 미해석 | {id} |  |
| functions/src/financialOpeningCommand.ts:225 | server | doc | root / top-level-candidate | 미해석 | financialOpeningOperations/{input.operationId} |  |
| functions/src/financialOpeningCommand.ts:225 | server | collection | root / top-level | 1 | financialOpeningOperations |  |
| src/shared/services/financialOpeningCommands.ts:34 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/rawInventoryService.ts:64 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(command.operationId)} |  |
| src/shared/services/rawInventoryService.ts:65 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(command.operationId)} |  |
| src/shared/services/rawInventoryService.ts:66 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(command.companyId, command.rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:67 | client | doc | root / top-level-candidate | 미해석 | items/{command.rawItemId} |  |
| src/shared/services/rawInventoryService.ts:69 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:70 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:71 | client | doc | root / top-level-candidate | 미해석 | rawInventoryReversalGuards/{operationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:144 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(companyId, rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:161 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(input.companyId, input.rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:162 | client | doc | root / top-level-candidate | 미해석 | items/{input.rawItemId} |  |
| src/shared/services/oemCancelService.ts:12 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/oemCancelService.ts:18 | client | doc | root / top-level-candidate | 미해석 | oemReceiptOperations/{`oem-receive:${poId}`} |  |
| src/shared/services/oemCancelService.ts:19 | client | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${poId}`} |  |
| src/shared/services/oemCancelService.ts:20 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{`OEMFEE-${poId}`} |  |
| src/features/admin/returnCommands.ts:47 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/admin/returnCommands.ts:48 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${request.partnerId}`} |  |
| src/features/admin/returnCommands.ts:73 | client | doc | root / top-level-candidate | 미해석 | returnOperations/{pending.command.operationId} |  |
| src/features/admin/manualSettlementCommands.ts:58 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/admin/manualSettlementCommands.ts:59 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} |  |
| src/features/admin/cashMutationCommands.ts:19 | client | doc | root / top-level-candidate | 미해석 | payrolls/{(original as CashEntry & { payrollId?: string }).payrollId} |  |
| src/features/admin/cashMutationCommands.ts:105 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/admin/cashMutationCommands.ts:133 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/admin/cashMutationCommands.ts:206 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/admin/cashMutationCommands.ts:207 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${entry.partnerId}`} |  |
| src/shared/services/firebaseService.ts:89 | client | doc | root / top-level-candidate | 미해석 | accountCodes/{account.id} |  |
| src/shared/services/firebaseService.ts:111 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/firebaseService.ts:153 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:160 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:167 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:250 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:271 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:306 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:346 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:346 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{<auto-id>} |  |
| src/shared/services/firebaseService.ts:346 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:349 | client | doc | root / top-level-candidate | 미해석 | cashEntries/{String(data.cashEntryId \|\| 'missing')} |  |
| src/shared/services/firebaseService.ts:350 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{String(data.statementId \|\| 'missing')} |  |
| src/shared/services/firebaseService.ts:357 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${data.companyId}_${partnerId}`} |  |
| src/shared/services/firebaseService.ts:369 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:372 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:378 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:388 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:401 | client | doc | root / top-level-candidate | 미해석 | notifications/{id} |  |
| src/shared/services/firebaseService.ts:410 | client | collection | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName} |  |
| src/shared/services/firebaseService.ts:429 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:432 | client | collection | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName} |  |
| src/shared/services/firebaseService.ts:444 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:454 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:469 | client | collection | root / top-level | 1 | partner_item |  |
| src/shared/services/firebaseService.ts:502 | client | collection | root / top-level | 1 | partner_item |  |
| src/shared/services/firebaseService.ts:542 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:557 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:578 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:591 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:611 | client | doc | root / top-level-candidate | 미해석 | {op.collection}/{op.id} |  |
| src/shared/services/firebaseService.ts:636 | client | doc | root / top-level-candidate | 미해석 | items/{receipt.itemId} |  |
| src/shared/services/firebaseService.ts:637 | client | doc | root / top-level-candidate | 미해석 | itemReceipts/{receipt.id} |  |
| src/shared/services/firebaseService.ts:678 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/firebaseService.ts:683 | client | collection | root / top-level | 1 | itemReceipts |  |
| src/shared/services/firebaseService.ts:685 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/firebaseService.ts:706 | client | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| src/shared/services/firebaseService.ts:706 | client | doc | root / top-level-candidate | 미해석 | itemReceipts/{`rcv-po-${encodeURIComponent(poId)}-${encodeURIComponent(line.itemId)}`} |  |
| src/shared/services/firebaseService.ts:808 | client | collection | root / top-level | 1 | itemReceipts |  |
| src/shared/services/firebaseService.ts:810 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/firebaseService.ts:813 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/firebaseService.ts:823 | client | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| src/shared/services/firebaseService.ts:843 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/shared/services/productionWorkDocumentService.ts:59 | client | collection | root / top-level | 1 | productionWorkDocumentLines |  |
| src/shared/services/productionWorkDocumentService.ts:66 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocuments/{header.id} |  |
| src/shared/services/productionWorkDocumentService.ts:73 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocumentLines/{id} |  |
| src/shared/services/productionWorkDocumentService.ts:87 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocumentLines/{line.id} |  |
| src/shared/services/unpackService.ts:63 | client | doc | root / top-level-candidate | 미해석 | items/{plan.canItemId} |  |
| src/shared/services/unpackService.ts:64 | client | doc | root / top-level-candidate | 미해석 | items/{plan.bulkItemId} |  |
| src/shared/services/unpackService.ts:65 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(operationId)} |  |
| src/shared/services/unpackService.ts:83 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(bulkCompany, plan.bulkItemId)} |  |
| src/shared/services/unpackService.ts:237 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/unpackService.ts:315 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/pendingFlowQuantityService.ts:15 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{id} |  |
| src/shared/services/workOrderResetService.ts:9 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`workOrderReset_${companyId}`} |  |
| src/shared/services/workOrderResetService.ts:20 | client | collection | root / top-level | 1 | workOrderItems |  |
| src/shared/services/deleteIssuedStatementService.ts:21 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{id} |  |
| src/shared/services/deleteIssuedStatementService.ts:30 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/deleteIssuedStatementService.ts:32 | client | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{input.operationId} |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:27 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:59 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:88 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:160 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:175 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:176 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} |  |
| components/AddItemModal.tsx:359 | client | doc | root / top-level-candidate | 미해석 | items/{finalProduct.id} |  |
| components/AddItemModal.tsx:374 | client | doc | root / top-level-candidate | 미해석 | items/{finalProduct.id} |  |
| src/features/admin/oemReceiptInventory.ts:55 | client | collection | root / top-level | 1 | adjustmentRequests |  |
| src/features/admin/oemReceiptInventory.ts:59 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.poId} |  |
| src/features/admin/oemReceiptInventory.ts:60 | client | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${input.poId}`} |  |
| src/features/admin/oemReceiptInventory.ts:61 | client | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| src/shared/services/rawInventoryJob.ts:54 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{input.jobId} |  |
| src/shared/services/rawInventoryJob.ts:119 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{jobId} |  |
| src/shared/services/rawInventoryJob.ts:126 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(opId)} |  |
| src/shared/services/rawInventoryJob.ts:127 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(opId)} |  |
| src/features/admin/oemIssueJob.ts:91 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.jobId} |  |
| src/features/admin/oemIssueJob.ts:135 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{draft.id} |  |
| src/features/admin/oemIssueJob.ts:148 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{draft.id} |  |
| src/shared/services/boxUnpackService.ts:23 | client | doc | root / top-level-candidate | 미해석 | items/{boxItemId} |  |
| src/shared/services/boxUnpackService.ts:24 | client | doc | root / top-level-candidate | 미해석 | items/{unitItemId} |  |
| src/shared/services/boxUnpackService.ts:25 | client | doc | root / top-level-candidate | 미해석 | itemUnpackMovements/{operationId} | itemUnpackMovements |
| src/shared/services/pushTokenService.ts:12 | client | doc | root / top-level-candidate | 미해석 | employees/{employeeId} |  |
| src/features/admin/orderItemStock.ts:115 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/features/admin/orderItemStock.ts:205 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/features/admin/orderItemStock.ts:247 | client | doc | root / top-level-candidate | 미해석 | orders/{orderMutation.orderId} |  |
| src/features/admin/orderItemStock.ts:258 | client | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| src/features/admin/orderItemStock.ts:319 | client | doc | root / top-level-candidate | 미해석 | orders/{orderMutation.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:127 | client | doc | root / top-level-candidate | 미해석 | orderStatusAudits/{ticket.operationId} |  |
| src/features/admin/orderInventoryCancellation.ts:139 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:164 | client | doc | root / top-level-candidate | 미해석 | orders/{ticket.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:175 | client | doc | root / top-level-candidate | 미해석 | orders/{ticket.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:232 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/features/admin/orderInventoryCancellation.ts:280 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/features/admin/orderStockEngine.ts:380 | client | doc | root / top-level-candidate | 미해석 | orders/{order.id} |  |
| src/features/admin/orderStockEngine.ts:662 | client | doc | root / top-level-candidate | 미해석 | orders/{id} |  |
| src/shared/ledgerLotCheck.ts:66 | client | doc | root / top-level-candidate | 미해석 | items/{rawItemId} |  |
| src/shared/ledgerLotCheck.ts:67 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/ledgerLotCheck.ts:68 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/itemPurchaseUnitService.ts:9 | client | collection | root / top-level | 1 | item_purchase_unit |  |
| src/shared/services/itemPurchaseUnitService.ts:20 | client | doc | root / top-level-candidate | 미해석 | item_purchase_unit/{unit.id} |  |
| components/OfficeTalk.tsx:229 | client | collection | root / top-level | 1 | chatMessages |  |
| src/shared/hooks/useAppData.ts:420 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{id} |  |
| src/shared/services/recordLoanMovement.ts:55 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/recordLoanMovement.ts:55 | client | doc | root / top-level-candidate | 미해석 | loanContracts/{input.loanId} |  |
| src/shared/services/recordLoanCashEntry.ts:11 | client | doc | root / top-level-candidate | 미해석 | loanContracts/{entry.loanId} |  |
| src/shared/services/payrollCommands.ts:17 | client | doc | root / top-level-candidate | 미해석 | payrolls/{payrollDocId(companyId,input.yearMonth)} |  |
| src/shared/services/payrollCommands.ts:32 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
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
| src/shared/services/interCompanyTransferService.ts:14 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/interCompanyTransferService.ts:21 | client | doc | root / top-level-candidate | 미해석 | companyTransferOperations/{command.operationId} |  |
| src/shared/services/confirmedCashBalance.ts:9 | client | doc | root / top-level-candidate | 미해석 | cashAccounts/{original.id} |  |
| src/features/admin/AdminApp.tsx:488 | client | collection | root / top-level | 1 | users |  |
| src/features/admin/AdminApp.tsx:542 | client | collection | root / top-level | 1 | rawInventories |  |
| src/features/admin/AdminApp.tsx:543 | client | collection | root / top-level | 1 | items |  |
| src/features/admin/AdminApp.tsx:4734 | client | collection | root / top-level | 1 | partner_item |  |
| src/features/admin/AdminApp.tsx:4763 | client | doc | root / top-level-candidate | 미해석 | partner_item/{id} |  |
| src/shared/employeeAuth.ts:19 | client | doc | root / top-level-candidate | 미해석 | employees/{credential.user.uid} |  |
| functions/src/newScopeCounter.ts:30 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/newScopeCounter.ts:31 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/newScopeCounter.ts:58 | server | collection | root / top-level | 1 | items |  |
| functions/src/newScopeCounter.ts:58 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/newScopeCounter.ts:58 | server | collection | root / top-level | 1 | oemReceiptOperations |  |
| functions/src/oemBatchCostInvalidation.ts:12 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemBatchCostInvalidation.ts:13 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{statementId.slice('OEMFEE-'.length)} |  |
| functions/src/oemBatchCostInvalidation.ts:13 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemBatchCostInvalidation.ts:30 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemBatchCostInvalidation.ts:30 | server | collection | root / top-level | 1 | items |  |
| functions/src/statementCreationReceipt.ts:9 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/returnClaimReader.ts:20 | server | doc | root / top-level-candidate | 미해석 | returnOperations/{id} |  |
| functions/src/returnClaimReader.ts:20 | server | collection | root / top-level | 1 | returnOperations |  |
| functions/src/partnerAdvanceClaimReader.ts:46 | server | doc | root / top-level-candidate | 미해석 | partnerAdvanceOperations/{row.noncashApplication?.operationId} |  |
| functions/src/partnerAdvanceClaimReader.ts:46 | server | collection | root / top-level | 1 | partnerAdvanceOperations |  |
| functions/src/partnerPaymentCommand.ts:103 | server | doc | root / top-level-candidate | 미해석 | partnerPaymentOperations/{input.operationId} |  |
| functions/src/partnerPaymentCommand.ts:103 | server | collection | root / top-level | 1 | partnerPaymentOperations |  |
| functions/src/partnerPaymentCommand.ts:104 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.operationId} |  |
| functions/src/partnerPaymentCommand.ts:104 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/partnerPaymentCommand.ts:105 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.operationId} |  |
| functions/src/partnerPaymentCommand.ts:105 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerPaymentCommand.ts:106 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate)} |  |
| functions/src/partnerPaymentCommand.ts:106 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerPaymentCommand.ts:107 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate, '추가')} |  |
| functions/src/partnerPaymentCommand.ts:107 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerPaymentCommand.ts:108 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/partnerPaymentCommand.ts:108 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerPaymentCommand.ts:109 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} |  |
| functions/src/partnerPaymentCommand.ts:109 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerPaymentCommand.ts:110 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.cashAccountId} |  |
| functions/src/partnerPaymentCommand.ts:110 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/partnerPaymentCommand.ts:111 | server | doc | root / top-level-candidate | 미해석 | partners/{input.partnerId} |  |
| functions/src/partnerPaymentCommand.ts:111 | server | collection | root / top-level | 1 | partners |  |
| functions/src/partnerPaymentCommand.ts:117 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerPaymentCommand.ts:118 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/partnerPaymentCommand.ts:119 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/partnerPaymentCommand.ts:120 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/partnerPaymentCommand.ts:202 | server | doc | root / top-level-candidate | 미해석 | settlements/{`st-${input.operationId}-${row.statementId}`} |  |
| functions/src/partnerPaymentCommand.ts:202 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/partnerAdvanceReader.ts:15 | server | collection | root / top-level-candidate | 미해석 | {name} |  |
| functions/src/partnerAdvanceReader.ts:16 | server | doc | root / top-level-candidate | 미해석 | partners/{partnerId} |  |
| functions/src/partnerAdvanceReader.ts:16 | server | collection | root / top-level | 1 | partners |  |
| functions/src/partnerAdvanceReader.ts:17 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${partnerId}`} |  |
| functions/src/partnerAdvanceReader.ts:17 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerAdvanceReader.ts:18 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/partnerAdvanceReader.ts:18 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerAdvanceReader.ts:19 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerAdvanceCutover_${companyId}`} |  |
| functions/src/partnerAdvanceReader.ts:19 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerAdvanceReader.ts:74 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{source.id} |  |
| functions/src/partnerAdvanceReader.ts:74 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/partnerAdvanceReader.ts:127 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{target.id} |  |
| functions/src/partnerAdvanceReader.ts:127 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerAdvanceReader.ts:130 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/partnerAdvanceCommand.ts:37 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(snapshot.companyId,date,'대체')} |  |
| functions/src/partnerAdvanceCommand.ts:37 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerAdvanceCommand.ts:44 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`advance-${command.operationId}`} |  |
| functions/src/partnerAdvanceCommand.ts:44 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerAdvanceCommand.ts:44 | server | doc | root / top-level-candidate | 미해석 | partnerAdvanceOperations/{command.operationId} |  |
| functions/src/partnerAdvanceCommand.ts:44 | server | collection | root / top-level | 1 | partnerAdvanceOperations |  |
| functions/src/partnerAdvanceCommand.ts:45 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{statementRef.id} |  |
| functions/src/partnerAdvanceCommand.ts:45 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/partnerAdvanceCommand.ts:92 | server | doc | root / top-level-candidate | 미해석 | partnerAdvanceOperations/{input.operationId} |  |
| functions/src/partnerAdvanceCommand.ts:92 | server | collection | root / top-level | 1 | partnerAdvanceOperations |  |
| functions/src/partnerAdvanceCommand.ts:95 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{op.statementId} |  |
| functions/src/partnerAdvanceCommand.ts:95 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerAdvanceCommand.ts:127 | server | doc | root / top-level-candidate | 미해석 | partners/{partnerId} |  |
| functions/src/partnerAdvanceCommand.ts:127 | server | collection | root / top-level | 1 | partners |  |
| functions/src/deleteIssuedStatementCommand.ts:44 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/deleteIssuedStatementCommand.ts:60 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.statementId} |  |
| functions/src/deleteIssuedStatementCommand.ts:60 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/deleteIssuedStatementCommand.ts:60 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{input.operationId} |  |
| functions/src/deleteIssuedStatementCommand.ts:60 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/deleteIssuedStatementCommand.ts:76 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${partnerAtRead}`} |  |
| functions/src/deleteIssuedStatementCommand.ts:76 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/deleteIssuedStatementCommand.ts:79 | server | collection | root / top-level-candidate | 미해석 | {kind} |  |
| functions/src/deleteIssuedStatementCommand.ts:94 | server | doc | root / top-level-candidate | 미해석 | {kind}/{id} |  |
| functions/src/deleteIssuedStatementCommand.ts:94 | server | collection | root / top-level-candidate | 미해석 | {kind} |  |
| functions/src/deleteIssuedStatementCommand.ts:113 | server | doc | root / top-level-candidate | 미해석 | {row.kind}/{row.id} |  |
| functions/src/deleteIssuedStatementCommand.ts:113 | server | collection | root / top-level-candidate | 미해석 | {row.kind} |  |
| functions/src/deleteIssuedStatementCommand.ts:114 | server | doc | root / top-level-candidate | 미해석 | settlements/{row.id} |  |
| functions/src/deleteIssuedStatementCommand.ts:114 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/voucherIssue.ts:74 | server | doc | root / top-level-candidate | 미해석 | {kind}/{operationId} |  |
| functions/src/voucherIssue.ts:74 | server | collection | root / top-level-candidate | 미해석 | {kind} |  |
| functions/src/voucherIssue.ts:75 | server | doc | root / top-level-candidate | 미해석 | {kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries'}/{operationId} |  |
| functions/src/voucherIssue.ts:75 | server | collection | root / top-level-candidate | 미해석 | {kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries'} |  |
| functions/src/voucherIssue.ts:76 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, tradeDate, prefix)} |  |
| functions/src/voucherIssue.ts:76 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/voucherIssue.ts:77 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, tradeDate, '추가')} |  |
| functions/src/voucherIssue.ts:77 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/voucherIssue.ts:130 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/voucherIssue.ts:131 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{document.cashAccountId} |  |
| functions/src/voucherIssue.ts:131 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/voucherIssue.ts:132 | server | doc | root / top-level-candidate | 미해석 | partners/{document.partnerId as string} |  |
| functions/src/voucherIssue.ts:132 | server | collection | root / top-level | 1 | partners |  |
| functions/src/voucherIssue.ts:133 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${document.partnerId}`} |  |
| functions/src/voucherIssue.ts:133 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/voucherIssue.ts:134 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/voucherIssue.ts:134 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/loanMovementCommand.ts:46 | server | doc | root / top-level-candidate | 미해석 | loanMovementOperations/{input.operationId} |  |
| functions/src/loanMovementCommand.ts:46 | server | collection | root / top-level | 1 | loanMovementOperations |  |
| functions/src/loanMovementCommand.ts:47 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.operationId} |  |
| functions/src/loanMovementCommand.ts:47 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/loanMovementCommand.ts:48 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.operationId} |  |
| functions/src/loanMovementCommand.ts:48 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/loanMovementCommand.ts:49 | server | doc | root / top-level-candidate | 미해석 | loanContracts/{input.loanId} |  |
| functions/src/loanMovementCommand.ts:49 | server | collection | root / top-level | 1 | loanContracts |  |
| functions/src/loanMovementCommand.ts:50 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.cashAccountId} |  |
| functions/src/loanMovementCommand.ts:50 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/loanMovementCommand.ts:51 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate)} |  |
| functions/src/loanMovementCommand.ts:51 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/loanMovementCommand.ts:52 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`loanMovementCutover_${companyId}`} |  |
| functions/src/loanMovementCommand.ts:52 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/loanMovementCommand.ts:57 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/loanMovementCommand.ts:177 | server | doc | root / top-level-candidate | 미해석 | loanMovementOperations/{recurringId(templateId, yearMonth)} |  |
| functions/src/loanMovementCommand.ts:177 | server | collection | root / top-level | 1 | loanMovementOperations |  |
| functions/src/loanMovementCommand.ts:188 | server | doc | root / top-level-candidate | 미해석 | fixedCostTemplates/{templateId} |  |
| functions/src/loanMovementCommand.ts:188 | server | collection | root / top-level | 1 | fixedCostTemplates |  |
| functions/src/loanMovementCommand.ts:194 | server | doc | root / top-level-candidate | 미해석 | loanContracts/{draft.loanId} |  |
| functions/src/loanMovementCommand.ts:194 | server | collection | root / top-level | 1 | loanContracts |  |
| functions/src/loanMovementCommand.ts:195 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/autoVoucherCommand.ts:20 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/autoVoucherCommand.ts:25 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/cancelPendingReturnCommand.ts:27 | server | doc | root / top-level-candidate | 미해석 | returnRequests/{input.requestId} |  |
| functions/src/cancelPendingReturnCommand.ts:27 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/cancelPendingReturnCommand.ts:32 | server | doc | root / top-level-candidate | 미해석 | returnSubmissionOperations/{input.requestId} |  |
| functions/src/cancelPendingReturnCommand.ts:32 | server | collection | root / top-level | 1 | returnSubmissionOperations |  |
| functions/src/cancelPendingReturnCommand.ts:81 | server | collection | root / top-level | 1 | returnOperations |  |
| functions/src/cancelPendingReturnCommand.ts:82 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/payrollVoucher.ts:81 | server | doc | root / top-level-candidate | 미해석 | employees/{line.employeeId} |  |
| functions/src/payrollVoucher.ts:81 | server | collection | root / top-level | 1 | employees |  |
| functions/src/payrollVoucher.ts:92 | server | doc | root / top-level-candidate | 미해석 | payrolls/{id} |  |
| functions/src/payrollVoucher.ts:92 | server | collection | root / top-level | 1 | payrolls |  |
| functions/src/payrollVoucher.ts:123 | server | doc | root / top-level-candidate | 미해석 | payrolls/{id} |  |
| functions/src/payrollVoucher.ts:123 | server | collection | root / top-level | 1 | payrolls |  |
| functions/src/payrollVoucher.ts:124 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{operationId(companyId, input.yearMonth)} |  |
| functions/src/payrollVoucher.ts:124 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/payrollVoucher.ts:125 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{operationId(companyId, input.yearMonth)} |  |
| functions/src/payrollVoucher.ts:125 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/payrollVoucher.ts:126 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '급여')} |  |
| functions/src/payrollVoucher.ts:126 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/payrollVoucher.ts:127 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`payrollIssueCutover_${companyId}`} |  |
| functions/src/payrollVoucher.ts:127 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/payrollVoucher.ts:132 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/payrollVoucher.ts:133 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/payrollVoucher.ts:135 | server | doc | root / top-level-candidate | 미해석 | employees/{line.employeeId} |  |
| functions/src/payrollVoucher.ts:135 | server | collection | root / top-level | 1 | employees |  |
| functions/src/cashMutationCommand.ts:31 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{input.operationId} |  |
| functions/src/cashMutationCommand.ts:31 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/cashMutationCommand.ts:32 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.cashEntryId} |  |
| functions/src/cashMutationCommand.ts:32 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/cashMutationCommand.ts:37 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/cashMutationCommand.ts:38 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/cashMutationCommand.ts:39 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/cashMutationCommand.ts:39 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/cashMutationCommand.ts:40 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/cashMutationCommand.ts:40 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/cashMutationCommand.ts:64 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.patch!.cashAccountId} |  |
| functions/src/cashMutationCommand.ts:64 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/cashMutationCommand.ts:94 | server | doc | root / top-level-candidate | 미해석 | loanContracts/{current.loanId} |  |
| functions/src/cashMutationCommand.ts:94 | server | collection | root / top-level | 1 | loanContracts |  |
| functions/src/cashMutationCommand.ts:95 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/cashMutationCommand.ts:96 | server | doc | root / top-level-candidate | 미해석 | payrolls/{current.payrollId} |  |
| functions/src/cashMutationCommand.ts:96 | server | collection | root / top-level | 1 | payrolls |  |
| functions/src/cashMutationCommand.ts:98 | server | doc | root / top-level-candidate | 미해석 | partners/{input.patch?.partnerId === undefined ? current.partnerId : input.patch.partnerId} |  |
| functions/src/cashMutationCommand.ts:98 | server | collection | root / top-level | 1 | partners |  |
| functions/src/cashMutationCommand.ts:99 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{current.cashAccountId} |  |
| functions/src/cashMutationCommand.ts:99 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/cashMutationCommand.ts:153 | server | doc | root / top-level-candidate | 미해석 | employees/{line.employeeId} |  |
| functions/src/cashMutationCommand.ts:153 | server | collection | root / top-level | 1 | employees |  |
| functions/src/cashMutationCommand.ts:191 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${id}`} |  |
| functions/src/cashMutationCommand.ts:191 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/cashMutationCommand.ts:261 | server | doc | root / top-level-candidate | 미해석 | companyTransferOperations/{current.transferOperationId} |  |
| functions/src/cashMutationCommand.ts:261 | server | collection | root / top-level | 1 | companyTransferOperations |  |
| functions/src/cashMutationCommand.ts:269 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{transfer.outCashEntryId} |  |
| functions/src/cashMutationCommand.ts:269 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/cashMutationCommand.ts:269 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{transfer.inCashEntryId} |  |
| functions/src/cashMutationCommand.ts:269 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/cashMutationCommand.ts:270 | server | doc | root / top-level-candidate | 미해석 | companyTransferGrants/{actorId} |  |
| functions/src/cashMutationCommand.ts:270 | server | collection | root / top-level | 1 | companyTransferGrants |  |
| functions/src/cashMutationCommand.ts:270 | server | doc | root / top-level-candidate | 미해석 | employees/{claims.employeeId} |  |
| functions/src/cashMutationCommand.ts:270 | server | collection | root / top-level | 1 | employees |  |
| functions/src/cashMutationCommand.ts:282 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{transfer.latestCashMutationId} |  |
| functions/src/cashMutationCommand.ts:282 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/cashMutationCommand.ts:298 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.cashEntryId} |  |
| functions/src/cashMutationCommand.ts:298 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/cashMutationCommand.ts:316 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/cashMutationCommand.ts:316 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/cashMutationCommand.ts:316 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/cashMutationCommand.ts:317 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/cashMutationCommand.ts:317 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/cashMutationCommand.ts:325 | server | doc | root / top-level-candidate | 미해석 | partners/{original.row.partnerId} |  |
| functions/src/cashMutationCommand.ts:325 | server | collection | root / top-level | 1 | partners |  |
| functions/src/cashMutationCommand.ts:325 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${company}_${partnerId}`} |  |
| functions/src/cashMutationCommand.ts:325 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/cashMutationCommand.ts:365 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{original.id} |  |
| functions/src/cashMutationCommand.ts:365 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/editIssuedStatementCommand.ts:56 | server | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| functions/src/editIssuedStatementCommand.ts:57 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{statementId} |  |
| functions/src/editIssuedStatementCommand.ts:57 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/editIssuedStatementCommand.ts:58 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{operationId} |  |
| functions/src/editIssuedStatementCommand.ts:58 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/editIssuedStatementCommand.ts:59 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/editIssuedStatementCommand.ts:64 | server | doc | root / top-level-candidate | 미해석 | pendingStatementEdits/{approval.pendingEditRequestId} |  |
| functions/src/editIssuedStatementCommand.ts:64 | server | collection | root / top-level | 1 | pendingStatementEdits |  |
| functions/src/editIssuedStatementCommand.ts:143 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/editIssuedStatementCommand.ts:144 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/editIssuedStatementCommand.ts:145 | server | doc | root / top-level-candidate | 미해석 | item_purchase_unit/{line.purchaseUnitId} |  |
| functions/src/editIssuedStatementCommand.ts:145 | server | collection | root / top-level | 1 | item_purchase_unit |  |
| functions/src/editIssuedStatementCommand.ts:146 | server | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| functions/src/editIssuedStatementCommand.ts:146 | server | collection | root / top-level | 1 | items |  |
| functions/src/employeeLogin.ts:32 | server | doc | root / top-level-candidate | 미해석 | authLoginAttempts/{loginKey(username, request.rawRequest.ip ?? 'unknown')} |  |
| functions/src/employeeLogin.ts:32 | server | collection | root / top-level | 1 | authLoginAttempts |  |
| functions/src/employeeLogin.ts:39 | server | collection | root / top-level | 1 | employees |  |
| functions/src/tradeStatementIssue.ts:124 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{raw.id} |  |
| functions/src/tradeStatementIssue.ts:124 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/tradeStatementIssue.ts:125 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{raw.id} |  |
| functions/src/tradeStatementIssue.ts:125 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/tradeStatementIssue.ts:126 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '')} |  |
| functions/src/tradeStatementIssue.ts:126 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/tradeStatementIssue.ts:127 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '추가')} |  |
| functions/src/tradeStatementIssue.ts:127 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/tradeStatementIssue.ts:128 | server | doc | root / top-level-candidate | 미해석 | partners/{raw.partnerId} |  |
| functions/src/tradeStatementIssue.ts:128 | server | collection | root / top-level | 1 | partners |  |
| functions/src/tradeStatementIssue.ts:129 | server | doc | root / top-level-candidate | 미해석 | orders/{id} |  |
| functions/src/tradeStatementIssue.ts:129 | server | collection | root / top-level | 1 | orders |  |
| functions/src/tradeStatementIssue.ts:130 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{id} |  |
| functions/src/tradeStatementIssue.ts:130 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:131 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{newPo.id} |  |
| functions/src/tradeStatementIssue.ts:131 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:133 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/tradeStatementIssue.ts:133 | server | collection | root / top-level | 1 | items |  |
| functions/src/tradeStatementIssue.ts:134 | server | doc | root / top-level-candidate | 미해석 | item_purchase_unit/{line.purchaseUnitId} |  |
| functions/src/tradeStatementIssue.ts:134 | server | collection | root / top-level | 1 | item_purchase_unit |  |
| functions/src/tradeStatementIssue.ts:135 | server | doc | root / top-level-candidate | 미해석 | items/{c.itemId} |  |
| functions/src/tradeStatementIssue.ts:135 | server | collection | root / top-level | 1 | items |  |
| functions/src/tradeStatementIssue.ts:137 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/tradeStatementIssue.ts:137 | server | collection | root / top-level | 1 | items |  |
| functions/src/tradeStatementIssue.ts:139 | server | doc | root / top-level-candidate | 미해석 | itemCostHistory/{`${raw.id}_${c.itemId}_${c.sourceLineIndex}`} |  |
| functions/src/tradeStatementIssue.ts:139 | server | collection | root / top-level | 1 | itemCostHistory |  |
| functions/src/tradeStatementIssue.ts:140 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:141 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`poCardNo_${companyId}_${cardNo}`} |  |
| functions/src/tradeStatementIssue.ts:141 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/tradeStatementIssue.ts:143 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/tradeStatementIssue.ts:145 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/tradeStatementIssue.ts:302 | server | doc | root / top-level-candidate | 미해석 | itemCostHistory/{`${raw.id}_${cost.itemId}_${cost.sourceLineIndex}`} |  |
| functions/src/tradeStatementIssue.ts:302 | server | collection | root / top-level | 1 | itemCostHistory |  |
| functions/src/oemFeeVoucher.ts:67 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| functions/src/oemFeeVoucher.ts:67 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemFeeVoucher.ts:68 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`OEMFEE-${poId}`} |  |
| functions/src/oemFeeVoucher.ts:68 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/oemFeeVoucher.ts:69 | server | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${poId}`} |  |
| functions/src/oemFeeVoucher.ts:69 | server | collection | root / top-level | 1 | adjustmentRequests |  |
| functions/src/oemFeeVoucher.ts:70 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '가공')} |  |
| functions/src/oemFeeVoucher.ts:70 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/oemFeeVoucher.ts:71 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/oemFeeVoucher.ts:72 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/oemFeeVoucher.ts:85 | server | doc | root / top-level-candidate | 미해석 | oemReceiptOperations/{po.oemReceiptOperationId} |  |
| functions/src/oemFeeVoucher.ts:85 | server | collection | root / top-level | 1 | oemReceiptOperations |  |
| functions/src/oemFeeVoucher.ts:102 | server | doc | root / top-level-candidate | 미해석 | partners/{po.oemPartnerId ?? po.partnerId} |  |
| functions/src/oemFeeVoucher.ts:102 | server | collection | root / top-level | 1 | partners |  |
| functions/src/oemFeeVoucher.ts:111 | server | doc | root / top-level-candidate | 미해석 | items/{item.itemId} |  |
| functions/src/oemFeeVoucher.ts:111 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemFeeVoucher.ts:112 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/oemFeeVoucher.ts:115 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemFeeVoucher.ts:115 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:65 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.poId} |  |
| functions/src/oemReceiptCommand.ts:65 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemReceiptCommand.ts:66 | server | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${input.poId}`} |  |
| functions/src/oemReceiptCommand.ts:66 | server | collection | root / top-level | 1 | adjustmentRequests |  |
| functions/src/oemReceiptCommand.ts:67 | server | doc | root / top-level-candidate | 미해석 | oemReceiptOperations/{input.operationId} |  |
| functions/src/oemReceiptCommand.ts:67 | server | collection | root / top-level | 1 | oemReceiptOperations |  |
| functions/src/oemReceiptCommand.ts:68 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemReceiptCommand.ts:68 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:95 | server | doc | root / top-level-candidate | 미해석 | partners/{po.oemPartnerId ?? po.partnerId} |  |
| functions/src/oemReceiptCommand.ts:95 | server | collection | root / top-level | 1 | partners |  |
| functions/src/oemReceiptCommand.ts:101 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/oemReceiptCommand.ts:103 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemReceiptCommand.ts:103 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:110 | server | collection | root / top-level | 1 | item_formula |  |
| functions/src/oemReceiptCommand.ts:111 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:150 | server | doc | root / top-level-candidate | 미해석 | appMeta/{lotCounterId(companyId, input.date, material)} |  |
| functions/src/oemReceiptCommand.ts:150 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/oemReceiptCommand.ts:175 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{po.oemBatchCost.feeStatementId} |  |
| functions/src/oemReceiptCommand.ts:175 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/manualSettlementCommand.ts:38 | server | doc | root / top-level-candidate | 미해석 | manualSettlementOperations/{input.operationId} |  |
| functions/src/manualSettlementCommand.ts:38 | server | collection | root / top-level | 1 | manualSettlementOperations |  |
| functions/src/manualSettlementCommand.ts:39 | server | doc | root / top-level-candidate | 미해석 | settlements/{input.action === 'add' ? `manual-${input.operationId}` : input.settlementId!} |  |
| functions/src/manualSettlementCommand.ts:39 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/manualSettlementCommand.ts:40 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.statementId} |  |
| functions/src/manualSettlementCommand.ts:40 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/manualSettlementCommand.ts:41 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.cashEntryId} |  |
| functions/src/manualSettlementCommand.ts:41 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/manualSettlementCommand.ts:42 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} |  |
| functions/src/manualSettlementCommand.ts:42 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/manualSettlementCommand.ts:43 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/manualSettlementCommand.ts:43 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/manualSettlementCommand.ts:49 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/manualSettlementCommand.ts:50 | server | doc | root / top-level-candidate | 미해석 | partners/{input.partnerId} |  |
| functions/src/manualSettlementCommand.ts:50 | server | collection | root / top-level | 1 | partners |  |
| functions/src/manualSettlementCommand.ts:101 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/manualSettlementCommand.ts:102 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/manualSettlementCommand.ts:129 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{row.cashEntryId} |  |
| functions/src/manualSettlementCommand.ts:129 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/manualSettlementCommand.ts:136 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{row.statementId} |  |
| functions/src/manualSettlementCommand.ts:136 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/returnRawStockPlan.ts:49 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(operationId)} |  |
| functions/src/returnRawStockPlan.ts:49 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/returnRawStockPlan.ts:51 | server | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(input.companyId, target.rawItem.id)} |  |
| functions/src/returnRawStockPlan.ts:51 | server | collection | root / top-level | 1 | rawInventories |  |
| functions/src/returnRawStockPlan.ts:52 | server | doc | root / top-level-candidate | 미해석 | items/{target.rawItem.id} |  |
| functions/src/returnRawStockPlan.ts:52 | server | collection | root / top-level | 1 | items |  |
| functions/src/returnRawStockPlan.ts:54 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(operationId)} |  |
| functions/src/returnRawStockPlan.ts:54 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/processReturnCommand.ts:52 | server | doc | root / top-level-candidate | 미해석 | returnOperations/{input.operationId} |  |
| functions/src/processReturnCommand.ts:52 | server | collection | root / top-level | 1 | returnOperations |  |
| functions/src/processReturnCommand.ts:53 | server | doc | root / top-level-candidate | 미해석 | returnRequests/{input.returnRequestId} |  |
| functions/src/processReturnCommand.ts:53 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/processReturnCommand.ts:54 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`return-${input.operationId}`} |  |
| functions/src/processReturnCommand.ts:54 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:55 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{`return-${input.operationId}`} |  |
| functions/src/processReturnCommand.ts:55 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:56 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate, '반품')} |  |
| functions/src/processReturnCommand.ts:56 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/processReturnCommand.ts:57 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`returnCutover_${companyId}`} |  |
| functions/src/processReturnCommand.ts:57 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/processReturnCommand.ts:58 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/processReturnCommand.ts:58 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/processReturnCommand.ts:63 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:64 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:65 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:66 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/processReturnCommand.ts:100 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{request.linkedStatementId} |  |
| functions/src/processReturnCommand.ts:100 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:101 | server | doc | root / top-level-candidate | 미해석 | partners/{request.partnerId} |  |
| functions/src/processReturnCommand.ts:101 | server | collection | root / top-level | 1 | partners |  |
| functions/src/processReturnCommand.ts:102 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${request.partnerId}`} |  |
| functions/src/processReturnCommand.ts:102 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/processReturnCommand.ts:106 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/processReturnCommand.ts:107 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:108 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/processReturnCommand.ts:109 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/processReturnCommand.ts:110 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:111 | server | collection | root / top-level | 1 | items |  |
| functions/src/processReturnCommand.ts:112 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/processReturnCommand.ts:113 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/processReturnCommand.ts:119 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} |  |
| functions/src/processReturnCommand.ts:119 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:133 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{expected.id} |  |
| functions/src/processReturnCommand.ts:133 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:145 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{expected.id} |  |
| functions/src/processReturnCommand.ts:145 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/processReturnCommand.ts:249 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} |  |
| functions/src/processReturnCommand.ts:249 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:302 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{row.receiptId} |  |
| functions/src/processReturnCommand.ts:302 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:351 | server | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| functions/src/processReturnCommand.ts:351 | server | collection | root / top-level | 1 | items |  |
| functions/src/processReturnCommand.ts:353 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{row.receiptId} |  |
| functions/src/processReturnCommand.ts:353 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:357 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} |  |
| functions/src/processReturnCommand.ts:357 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/manualSettlementBatchCommand.ts:39 | server | doc | root / top-level-candidate | 미해석 | manualSettlementBatchOperations/{input.operationId} |  |
| functions/src/manualSettlementBatchCommand.ts:39 | server | collection | root / top-level | 1 | manualSettlementBatchOperations |  |
| functions/src/manualSettlementBatchCommand.ts:40 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.cashEntryId} |  |
| functions/src/manualSettlementBatchCommand.ts:40 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/manualSettlementBatchCommand.ts:41 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} |  |
| functions/src/manualSettlementBatchCommand.ts:41 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/manualSettlementBatchCommand.ts:42 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/manualSettlementBatchCommand.ts:42 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/manualSettlementBatchCommand.ts:47 | server | doc | root / top-level-candidate | 미해석 | partners/{input.partnerId} |  |
| functions/src/manualSettlementBatchCommand.ts:47 | server | collection | root / top-level | 1 | partners |  |
| functions/src/manualSettlementBatchCommand.ts:48 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/manualSettlementBatchCommand.ts:49 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/manualSettlementBatchCommand.ts:50 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/manualSettlementBatchCommand.ts:99 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{row.cashEntryId} |  |
| functions/src/manualSettlementBatchCommand.ts:99 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/manualSettlementBatchCommand.ts:129 | server | doc | root / top-level-candidate | 미해석 | settlements/{`manual-${input.operationId}-${row.statementId}`} |  |
| functions/src/manualSettlementBatchCommand.ts:129 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/interCompanyTransferPreparation.ts:16 | server | doc | root / top-level-candidate | 미해석 | companyTransferGrants/{uid} |  |
| functions/src/interCompanyTransferPreparation.ts:16 | server | collection | root / top-level | 1 | companyTransferGrants |  |
| functions/src/interCompanyTransferPreparation.ts:16 | server | doc | root / top-level-candidate | 미해석 | employees/{claims.employeeId as string} |  |
| functions/src/interCompanyTransferPreparation.ts:16 | server | collection | root / top-level | 1 | employees |  |
| functions/src/interCompanyTransferPreparation.ts:16 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`companyTransferCutover_${company}`} |  |
| functions/src/interCompanyTransferPreparation.ts:16 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/interCompanyTransferPreparation.ts:21 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/interCompanyTransferPreparation.ts:22 | server | collection | root / top-level | 1 | partners |  |
| functions/src/interCompanyTransferPreparation.ts:27 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${company}_${partner.id}`} |  |
| functions/src/interCompanyTransferPreparation.ts:27 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/interCompanyTransferPreparation.ts:27 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferPreparation.ts:27 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferPreparation.ts:27 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/interCompanyTransferPreparation.ts:27 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/interCompanyTransferCommand.ts:46 | server | doc | root / top-level-candidate | 미해석 | companyTransferOperations/{input.operationId} |  |
| functions/src/interCompanyTransferCommand.ts:46 | server | collection | root / top-level | 1 | companyTransferOperations |  |
| functions/src/interCompanyTransferCommand.ts:47 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{`${input.operationId}-out`} |  |
| functions/src/interCompanyTransferCommand.ts:47 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferCommand.ts:48 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{`${input.operationId}-in`} |  |
| functions/src/interCompanyTransferCommand.ts:48 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferCommand.ts:49 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{out.id} |  |
| functions/src/interCompanyTransferCommand.ts:49 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferCommand.ts:50 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{incoming.id} |  |
| functions/src/interCompanyTransferCommand.ts:50 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferCommand.ts:51 | server | doc | root / top-level-candidate | 미해석 | companyTransferGrants/{authUid} |  |
| functions/src/interCompanyTransferCommand.ts:51 | server | collection | root / top-level | 1 | companyTransferGrants |  |
| functions/src/interCompanyTransferCommand.ts:52 | server | doc | root / top-level-candidate | 미해석 | employees/{claims.employeeId as string} |  |
| functions/src/interCompanyTransferCommand.ts:52 | server | collection | root / top-level | 1 | employees |  |
| functions/src/interCompanyTransferCommand.ts:53 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.fromAccountId} |  |
| functions/src/interCompanyTransferCommand.ts:53 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/interCompanyTransferCommand.ts:54 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.toAccountId} |  |
| functions/src/interCompanyTransferCommand.ts:54 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/interCompanyTransferCommand.ts:55 | server | doc | root / top-level-candidate | 미해석 | partners/{input.fromPartnerId} |  |
| functions/src/interCompanyTransferCommand.ts:55 | server | collection | root / top-level | 1 | partners |  |
| functions/src/interCompanyTransferCommand.ts:56 | server | doc | root / top-level-candidate | 미해석 | partners/{input.toPartnerId} |  |
| functions/src/interCompanyTransferCommand.ts:56 | server | collection | root / top-level | 1 | partners |  |
| functions/src/interCompanyTransferCommand.ts:57 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(input.from, input.tradeDate)} |  |
| functions/src/interCompanyTransferCommand.ts:57 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/interCompanyTransferCommand.ts:58 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(input.to, input.tradeDate)} |  |
| functions/src/interCompanyTransferCommand.ts:58 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/interCompanyTransferCommand.ts:59 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${input.from}_${input.fromPartnerId}`} |  |
| functions/src/interCompanyTransferCommand.ts:59 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/interCompanyTransferCommand.ts:60 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${input.to}_${input.toPartnerId}`} |  |
| functions/src/interCompanyTransferCommand.ts:60 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/interCompanyTransferCommand.ts:61 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`companyTransferCutover_${input.from}`} |  |
| functions/src/interCompanyTransferCommand.ts:61 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/interCompanyTransferCommand.ts:62 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`companyTransferCutover_${input.to}`} |  |
| functions/src/interCompanyTransferCommand.ts:62 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/interCompanyTransferCommand.ts:73 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/interCompanyTransferCommand.ts:135 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferCommand.ts:136 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/interCompanyTransferCommand.ts:137 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferCommand.ts:138 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/interCompanyTransferCommand.ts:139 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/interCompanyTransferCommand.ts:140 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/interCompanyTransferCommand.ts:220 | server | doc | root / top-level-candidate | 미해석 | settlements/{`st-${input.operationId}-${side}-${row.statementId}`} |  |
| functions/src/interCompanyTransferCommand.ts:220 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/inventoryOpeningCommand.ts:27 | server | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| functions/src/inventoryOpeningCommand.ts:27 | server | collection | root / top-level | 1 | items |  |
| functions/src/inventoryOpeningCommand.ts:27 | server | doc | root / top-level-candidate | 미해석 | openingBalances/{companyId === 'taebaek' ? 'main' : 'main-punghoe'} |  |
| functions/src/inventoryOpeningCommand.ts:27 | server | collection | root / top-level | 1 | openingBalances |  |
| functions/src/inventoryOpeningCommand.ts:28 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-inventory-${companyId}-${itemId}`} |  |
| functions/src/inventoryOpeningCommand.ts:28 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/inventoryOpeningCommand.ts:52 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(operationId)} |  |
| functions/src/inventoryOpeningCommand.ts:52 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/inventoryOpeningCommand.ts:53 | server | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(companyId,itemId)} |  |
| functions/src/inventoryOpeningCommand.ts:53 | server | collection | root / top-level | 1 | rawInventories |  |
| functions/src/inventoryOpeningCommand.ts:54 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(operationId)} |  |
| functions/src/inventoryOpeningCommand.ts:54 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/inventoryOpeningCommand.ts:62 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/inventoryOpeningCommand.ts:64 | server | doc | root / top-level-candidate | 미해석 | items/{String(row.data().child_id)} |  |
| functions/src/inventoryOpeningCommand.ts:64 | server | collection | root / top-level | 1 | items |  |
| functions/src/submitReturnRequestCommand.ts:15 | server | doc | root / top-level-candidate | 미해석 | returnRequests/{input.requestId} |  |
| functions/src/submitReturnRequestCommand.ts:15 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/submitReturnRequestCommand.ts:15 | server | doc | root / top-level-candidate | 미해석 | returnSubmissionOperations/{input.requestId} |  |
| functions/src/submitReturnRequestCommand.ts:15 | server | collection | root / top-level | 1 | returnSubmissionOperations |  |
| functions/src/submitReturnRequestCommand.ts:28 | server | doc | root / top-level-candidate | 미해석 | partners/{body.partnerId} |  |
| functions/src/submitReturnRequestCommand.ts:28 | server | collection | root / top-level | 1 | partners |  |
| functions/src/submitReturnRequestCommand.ts:31 | server | doc | root / top-level-candidate | 미해석 | items/{item.itemId} |  |
| functions/src/submitReturnRequestCommand.ts:31 | server | collection | root / top-level | 1 | items |  |
| functions/src/submitReturnRequestCommand.ts:34 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{body.linkedStatementId} |  |
| functions/src/submitReturnRequestCommand.ts:34 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/submitReturnRequestCommand.ts:36 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/updatePendingReturnQuantityCommand.ts:15 | server | doc | root / top-level-candidate | 미해석 | returnRequests/{input.requestId} |  |
| functions/src/updatePendingReturnQuantityCommand.ts:15 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/updatePendingReturnQuantityCommand.ts:19 | server | doc | root / top-level-candidate | 미해석 | returnSubmissionOperations/{input.requestId} |  |
| functions/src/updatePendingReturnQuantityCommand.ts:19 | server | collection | root / top-level | 1 | returnSubmissionOperations |  |
| functions/src/taxIssueCommand.ts:18 | server | doc | root / top-level-candidate | 미해석 | taxIssueOperations/{input.operationId} |  |
| functions/src/taxIssueCommand.ts:18 | server | collection | root / top-level | 1 | taxIssueOperations |  |
| functions/src/taxIssueCommand.ts:35 | server | doc | root / top-level-candidate | 미해석 | {write.collection}/{write.id} |  |
| functions/src/taxIssueCommand.ts:35 | server | collection | root / top-level-candidate | 미해석 | {write.collection} |  |
| functions/src/taxIssueCommand.ts:36 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{`${input.operationId}_tax_${index}`} |  |
| functions/src/taxIssueCommand.ts:36 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/taxIssueCommand.ts:50 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{row.id} |  |
| functions/src/taxIssueCommand.ts:50 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/taxIssueCommand.ts:62 | server | doc | root / top-level-candidate | 미해석 | {write.collection}/{write.id} |  |
| functions/src/taxIssueCommand.ts:62 | server | collection | root / top-level-candidate | 미해석 | {write.collection} |  |
| functions/src/taxIssueCommand.ts:63 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{`${input.operationId}_tax_${index}`} |  |
| functions/src/taxIssueCommand.ts:63 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/taxIssueCommand.ts:70 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{patch.id} |  |
| functions/src/taxIssueCommand.ts:70 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/taxIssueCommand.ts:76 | server | doc | root / top-level-candidate | 미해석 | {record.collection}/{record.id} |  |
| functions/src/taxIssueCommand.ts:76 | server | collection | root / top-level-candidate | 미해석 | {record.collection} |  |
| functions/src/orderLockRecovery.ts:19 | server | doc | root / top-level-candidate | 미해석 | orders/{input.orderId} |  |
| functions/src/orderLockRecovery.ts:19 | server | collection | root / top-level | 1 | orders |  |
| functions/src/orderLockRecovery.ts:19 | server | doc | root / top-level-candidate | 미해석 | orderStatusAudits/{input.failedOperationId} |  |
| functions/src/orderLockRecovery.ts:19 | server | collection | root / top-level | 1 | orderStatusAudits |  |
| functions/src/orderLockRecovery.ts:20 | server | doc | root / top-level-candidate | 미해석 | orderLockRecoveryOperations/{'order-unlock-'+identity(companyId,input)} |  |
| functions/src/orderLockRecovery.ts:20 | server | collection | root / top-level | 1 | orderLockRecoveryOperations |  |
| functions/src/index.ts:45 | server | collection | root / top-level | 1 | users |  |
| functions/src/index.ts:66 | server | collection | root / top-level | 1 | users |  |
| functions/src/index.ts:121 | server | collection | root / top-level | 1 | items |  |
| functions/src/index.ts:127 | server | doc | root / top-level-candidate | 미해석 | inventorySnapshots/{co === 'taebaek' ? `inv-snap-${yearMonth}` : `inv-snap-${co}-${yearMonth}`} |  |
| functions/src/index.ts:127 | server | collection | root / top-level | 1 | inventorySnapshots |  |
| functions/src/index.ts:165 | server | collection | root / top-level | 1 | fixedCostTemplates |  |
| functions/src/index.ts:228 | server | doc | root / top-level-candidate | 미해석 | employees/{empId} |  |
| functions/src/index.ts:228 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:255 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:298 | server | doc | root / top-level-candidate | 미해석 | chatRooms/{String(msg.roomId)} |  |
| functions/src/index.ts:298 | server | collection | root / top-level | 1 | chatRooms |  |
| functions/src/index.ts:306 | server | doc | root / top-level-candidate | 미해석 | employees/{id} |  |
| functions/src/index.ts:306 | server | collection | root / top-level | 1 | employees |  |

## 별도 모델 보완

shared/types.ts 외 interface/type alias 720개를 별도 목록에 기록한다. 직접 property만 나열하며 상속·교차/공용체·mapped type·객체 전개는 펼치지 않는다. UI 상태/요청/응답 모델도 있으므로 DB 필드로 단정하지 않는다. 이 목록의 필드는 기존 shared 선언 필드 통계와 사용처 집계에 합치지 않는다. shared/types.ts 안의 type alias도 기존 interface 전용 집계에서는 제외된다.

| 모델 | 선언 위치 | 종류 | 범위 | 직접 필드 |
| --- | --- | --- | --- | --- |
| ProductStocktakeRequest | src/shared/productStocktakeAttempt.ts:2 | type-alias | direct-properties-only | version, operationId, companyId, uid, itemId, itemName, targetQty, minStock, unitKg, capturedAt |
| ProductStocktakeAttempt | src/shared/productStocktakeAttempt.ts:3 | type-alias | non-object-alias-not-expanded |  |
| OemCostEvidence | functions/src/shared/oemBatchCost.ts:1 | type-alias | direct-properties-only | version, ownerCompanyId, rawMaterials, packaging, capturedAt |
| OemCostScope | functions/src/shared/oemBatchCost.ts:4 | type-alias | direct-properties-only | companyId, sent |
| OemCostRow | functions/src/shared/oemBatchCost.ts:5 | type-alias | direct-properties-only | itemId, kg |
| OemBatchCostPreview | functions/src/shared/oemBatchCost.ts:6 | type-alias | direct-properties-only | version, status, evidenceSnapshot, ownerCompanyId, sentKg, receivedKg, lossKg, rawSupplyAmount, packagingSupplyAmount, rows |
| OemBatchCostBlocked | functions/src/shared/oemBatchCost.ts:9 | type-alias | direct-properties-only | version, status, reason, previousConfirmed, evidenceSnapshot, ownerCompanyId, sentKg, receivedKg, lossKg, rawSupplyAmount, packagingSupplyAmount, rows |
| OemBatchCost | functions/src/shared/oemBatchCost.ts:10 | type-alias | non-object-alias-not-expanded |  |
| CompanyId | functions/src/shared/rawLot.ts:1 | type-alias | non-object-alias-not-expanded |  |
| RawMaterialLot | functions/src/shared/rawLot.ts:3 | interface | direct-properties-only | id, supplierId, supplierName, packageType, packageKg, qtyIn, kgIn, kgRemaining, receivedDate, lotNo, status, poId, createdAt, oemBatchCost, material, qtyRemaining, unitKg |
| LotMixSetting | functions/src/shared/rawLot.ts:36 | interface | direct-properties-only | topPercent, ratios |
| PurchaseUnitSnapshot | functions/src/shared/purchaseUnit.ts:4 | interface | direct-properties-only | purchaseUnitId, purchaseUnit, purchaseQty, unitKg, inventoryQty |
| ItemPurchaseUnit | functions/src/shared/purchaseUnit.ts:11 | interface | direct-properties-only | id, companyId, itemId, partnerId, purchaseUnit, unitKg, isDefault, active, createdAt, updatedAt |
| CashProjectionInput | functions/src/shared/cashLineProjection.ts:1 | type-alias | direct-properties-only | dir, amount, accountCode, note, lines |
| AutoJournalOptions | src/shared/autoJournal.ts:96 | interface | direct-properties-only | cashAccountCode |
| OpeningBalance | src/shared/autoJournal.ts:329 | interface | direct-properties-only | date, lines, capitalAccount |
| StocktakeAnchor | functions/src/shared/rawInventoryCore.ts:35 | interface | direct-properties-only | effectiveAt, operationId, sequence |
| RawInventoryState | functions/src/shared/rawInventoryCore.ts:49 | interface | direct-properties-only | id, companyId, rawItemId, materialSnapshot, stockKg, activeLots, recentDepletedLots, stocktakeAnchor, revision, lastProcessedAt |
| LotChange | functions/src/shared/rawInventoryCore.ts:81 | interface | direct-properties-only | lotId, supplierName, lotNo, receivedDate, deltaKg, beforeKg, afterKg, lotSnapshot |
| RawMovementKind | functions/src/shared/rawInventoryCore.ts:98 | type-alias | non-object-alias-not-expanded |  |
| RawInventoryMovement | functions/src/shared/rawInventoryCore.ts:109 | interface | direct-properties-only | id, operationId, commandHash, companyId, rawItemId, materialSnapshot, effectiveAt, recordedAt, sequence, kind, reportedDeltaKg, appliedDeltaKg, balanceAfterKg, targetKg, targetLotId, targetLotKg, lotChanges, source, reversalOf, stocktakeAnchorBefore, backdatedBeforeStocktake, actorId, actorName |
| ReversalGuard | functions/src/shared/rawInventoryCore.ts:150 | interface | direct-properties-only | id, originalOperationId, reverseOperationId, companyId, rawItemId, createdAt |
| RawInventoryJob | functions/src/shared/rawInventoryCore.ts:160 | interface | direct-properties-only | id, companyId, source, expectedOperationIds, status, lastError, createdAt, completedAt |
| RawSourceType | functions/src/shared/rawInventoryCore.ts:176 | type-alias | non-object-alias-not-expanded |  |
| CommandBase | functions/src/shared/rawInventoryCore.ts:182 | interface | direct-properties-only | operationId, companyId, rawItemId, materialSnapshot, effectiveAt, source, actorId, actorName, backdatedIntent |
| ReceiveLotInput | functions/src/shared/rawInventoryCore.ts:203 | interface | direct-properties-only | supplierId, supplierName, packageType, packageKg, qtyIn, poId |
| RawInventoryCommand | functions/src/shared/rawInventoryCore.ts:212 | type-alias | non-object-alias-not-expanded |  |
| RawRejectCode | functions/src/shared/rawInventoryCore.ts:227 | type-alias | non-object-alias-not-expanded |  |
| RawApplyResult | functions/src/shared/rawInventoryCore.ts:251 | type-alias | non-object-alias-not-expanded |  |
| ApplyDeterministic | functions/src/shared/rawInventoryCore.ts:258 | interface | direct-properties-only | now, newLotId, carryOverLotId |
| CompanyId | functions/src/shared/partnerAdvance.ts:2 | type-alias | non-object-alias-not-expanded |  |
| AdvancePurpose | functions/src/shared/partnerAdvance.ts:3 | type-alias | direct-properties-only | version, contractId, purpose, operationId |
| IssuedStatementItem | functions/src/shared/partnerAdvance.ts:4 | type-alias | direct-properties-only | name, spec, qty, price, supply, tax, total, isTaxExempt, accountCode, side |
| IssuedStatement | functions/src/shared/partnerAdvance.ts:8 | type-alias | direct-properties-only | id, companyId, partnerId, type, tradeDate, totalAmount, items, noncashApplication |
| AdvanceCode | functions/src/shared/partnerAdvance.ts:13 | type-alias | non-object-alias-not-expanded |  |
| TargetCode | functions/src/shared/partnerAdvance.ts:14 | type-alias | non-object-alias-not-expanded |  |
| SourceKey | functions/src/shared/partnerAdvance.ts:15 | type-alias | direct-properties-only | collection, id, lineKey |
| Allocation | functions/src/shared/partnerAdvance.ts:16 | type-alias | direct-properties-only | source, statementId, accountCode, amount |
| ApplicationMetadata | functions/src/shared/partnerAdvance.ts:17 | type-alias | direct-properties-only | kind, version, operationId, companyId, partnerId, purpose, requestFingerprint, sourceFingerprints, targetFingerprints, allocations |
| CancellationMetadata | functions/src/shared/partnerAdvance.ts:22 | type-alias | direct-properties-only | kind, version, operationId, companyId, partnerId, applicationStatementId, applicationFingerprint, reason |
| AdvanceStatement | functions/src/shared/partnerAdvance.ts:26 | type-alias | non-object-alias-not-expanded |  |
| SourceEvidence | functions/src/shared/partnerAdvance.ts:27 | type-alias | direct-properties-only | key, companyId, partnerId, code, originalAmount, date, fingerprint, purpose |
| TargetEvidence | functions/src/shared/partnerAdvance.ts:32 | type-alias | direct-properties-only | statementId, companyId, partnerId, accountCode, remaining, date, fingerprint, purpose |
| VerifiedContext | functions/src/shared/partnerAdvance.ts:38 | type-alias | direct-properties-only | companyId, partnerId, complete, unattributedReduction, blockedSourceKeys, sources, targets, priorSourceUse |
| Claim | functions/src/shared/partnerAdvance.ts:178 | type-alias | direct-properties-only | id, companyId, partnerId, accountCode, amount |
| ApplyPartnerAdvanceInput | functions/src/shared/partnerAdvance.ts:218 | type-alias | direct-properties-only | operationId, partnerId, date, source, statementId, accountCode, amount, expectedSourceFingerprint, expectedTargetFingerprint, expectedRevision, releaseId |
| CancelPartnerAdvanceInput | functions/src/shared/partnerAdvance.ts:224 | type-alias | direct-properties-only | operationId, partnerId, date, applicationStatementId, reason, expectedRevision, releaseId |
| PreparedPartnerAdvance | functions/src/shared/partnerAdvance.ts:229 | type-alias | direct-properties-only | enabled, blockedReason, revision, releaseId, sources, targets, applications, diagnostics |
| RawUnit | functions/src/shared/formula.ts:57 | type-alias | non-object-alias-not-expanded |  |
| PendingPurchaseOrderConfirmation | src/shared/services/confirmPendingPurchaseOrderService.ts:14 | type-alias | direct-properties-only | status, poId, invoicedAt |
| AppConfirmOptions | src/shared/components/appDialog.ts:1 | interface | direct-properties-only | title, message, confirmText, cancelText, tone |
| AppPromptOptions | src/shared/components/appDialog.ts:9 | interface | direct-properties-only | title, message, defaultValue, placeholder, confirmText |
| ConfirmRequest | src/shared/components/appDialog.ts:17 | type-alias | non-object-alias-not-expanded |  |
| NoticeRequest | src/shared/components/appDialog.ts:18 | type-alias | direct-properties-only | kind, title, message, resolve |
| PromptRequest | src/shared/components/appDialog.ts:19 | type-alias | non-object-alias-not-expanded |  |
| AppDialogRequest | src/shared/components/appDialog.ts:20 | type-alias | non-object-alias-not-expanded |  |
| OrderInventoryRecoveryResult | src/shared/services/orderInventoryRecoveryService.ts:6 | interface | direct-properties-only | status, orderId, failedOperationId, failedStartedAt, inventoryApplied, reason, failureMessage, targetStatus |
| PendingOrderInventoryRecovery | src/shared/services/orderInventoryRecoveryService.ts:27 | interface | direct-properties-only | version, companyId, uid, orderId, failedOperationId, failedStartedAt, expectedSaved |
| Props | components/OrderInventoryRecoveryPanel.tsx:5 | interface | direct-properties-only | companyId, actorUid, orders, pending, onRecovered |
| Entry | components/OrderInventoryRecoveryPanel.tsx:6 | type-alias | direct-properties-only | orderId, partnerName, operationId, startedAt, pending |
| Row | functions/src/cashMutationReceipt.ts:4 | type-alias | non-object-alias-not-expanded |  |
| LedgerCashEntry | functions/src/shared/cashAccountLedger.ts:2 | type-alias | direct-properties-only | id, date, createdAt, cashAccountId, companyId, dir, amount, balanceAdjustment |
| LedgerCashAccount | functions/src/shared/cashAccountLedger.ts:7 | type-alias | direct-properties-only | id, companyId, openingDate, openingBalance, confirmedBalances |
| LedgerRow | functions/src/shared/cashAccountLedger.ts:13 | interface | direct-properties-only | entry, balance, confirmedAccountBalance, adjustmentDelta |
| AccountLedger | functions/src/shared/cashAccountLedger.ts:21 | interface | direct-properties-only | account, opening, rows, totalIn, totalOut, totalAdjustment, closing |
| OpeningCompany | functions/src/shared/financialOpening.ts:4 | type-alias | non-object-alias-not-expanded |  |
| OpeningPartnerCode | functions/src/shared/financialOpening.ts:5 | type-alias | non-object-alias-not-expanded |  |
| FinancialPartner | functions/src/shared/financialOpening.ts:6 | type-alias | direct-properties-only | id, name, companyId |
| FinancialLoan | functions/src/shared/financialOpening.ts:7 | type-alias | direct-properties-only | id, companyId, name, lenderName, partnerId, accountCode, openingDate, openingPrincipal, maturityDate, note, createdAt |
| FinancialAccount | functions/src/shared/financialOpening.ts:8 | type-alias | non-object-alias-not-expanded |  |
| FinancialCash | functions/src/shared/financialOpening.ts:9 | type-alias | non-object-alias-not-expanded |  |
| OpeningStatement | functions/src/shared/financialOpening.ts:10 | type-alias | direct-properties-only | id, companyId, issuedAt, tradeDate, type, partnerId, partnerName, orderId, docNo, totalSupply, totalTax, totalAmount, items |
| FinancialOpeningInput | functions/src/financialOpeningCommand.ts:8 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/financialOpeningCommand.ts:14 | type-alias | non-object-alias-not-expanded |  |
| Snapshot | functions/src/financialOpeningCommand.ts:15 | type-alias | direct-properties-only | id, ref, exists, data |
| QuerySnapshot | functions/src/financialOpeningCommand.ts:16 | type-alias | direct-properties-only | docs |
| OpeningTx | functions/src/financialOpeningCommand.ts:17 | type-alias | non-object-alias-not-expanded |  |
| OpeningStore | functions/src/financialOpeningCommand.ts:18 | type-alias | direct-properties-only | collection, runTransaction |
| FinancialOpeningPending | src/shared/services/financialOpeningCommands.ts:7 | type-alias | direct-properties-only | version, companyId, userId, request |
| FinancialOpeningDraft | src/shared/services/financialOpeningCommands.ts:8 | type-alias | non-object-alias-not-expanded |  |
| LegacyLedgerFields | functions/src/shared/rawInventoryDocument.ts:11 | interface | direct-properties-only | note, type, addedBy, orderId, canSize, canCount, canSizeTag, originalAmount, originalUnit |
| RawReadSnapshot | functions/src/shared/rawInventoryPrepare.ts:6 | interface | direct-properties-only |  |
| RawCommandRead | functions/src/shared/rawInventoryPrepare.ts:7 | interface | direct-properties-only | movementSnap, oldMovementSnap, stateSnap, itemSnap, originalSnap, oldOriginalSnap, guardSnap |
| RawPrepareOptions | functions/src/shared/rawInventoryPrepare.ts:13 | interface | direct-properties-only | now, newLotId, carryOverLotId, mirrorToItem, legacy |
| CollectionName | src/shared/collections.ts:121 | type-alias | non-object-alias-not-expanded |  |
| RawCommandOptions | src/shared/services/rawInventoryService.ts:41 | interface | direct-properties-only | now, newLotId, carryOverLotId, db, mirrorToItem, legacy |
| KstDateRangeUtc | src/shared/day.ts:18 | interface | direct-properties-only | startInclusive, endExclusive |
| Command | src/features/admin/returnCommands.ts:8 | type-alias | direct-properties-only | operationId, returnRequestId, tradeDate, expectedPartnerRevision, releaseId, expectedBusinessHash |
| Result | src/features/admin/returnCommands.ts:9 | type-alias | direct-properties-only | companyId, operationId, returnRequestId, status, docNo, journalId |
| ReturnPending | src/features/admin/returnCommands.ts:98 | type-alias | direct-properties-only | version, fingerprint, command |
| ManualSettlementInput | src/features/admin/manualSettlementCommands.ts:6 | type-alias | direct-properties-only | action, partnerId, cashEntryId, statementId, amount, expectedAmount, settlementId |
| Request | src/features/admin/manualSettlementCommands.ts:8 | type-alias | non-object-alias-not-expanded |  |
| Result | src/features/admin/manualSettlementCommands.ts:9 | type-alias | direct-properties-only | status, settlementId, revision |
| Pending | src/features/admin/manualSettlementCommands.ts:10 | type-alias | direct-properties-only | version, fingerprint, request |
| Patch | src/features/admin/cashMutationCommands.ts:6 | type-alias | non-object-alias-not-expanded |  |
| PayrollCashEdit | src/features/admin/cashMutationCommands.ts:7 | type-alias | direct-properties-only | yearMonth, payDate, lines, expectedRevision |
| TransferCashEdit | src/features/admin/cashMutationCommands.ts:8 | type-alias | direct-properties-only | counterpartId, expectedRevision, expectedCashHash, patch |
| PreparedTransferCashEdit | src/features/admin/cashMutationCommands.ts:9 | type-alias | direct-properties-only | counterpart, expectedRevision, expectedCashHash |
| Command | src/features/admin/cashMutationCommands.ts:27 | type-alias | direct-properties-only | operationId, cashEntryId, action, expectedRevision, expectedCashHash, releaseId, patch, payrollEdit, transferEdit |
| Result | src/features/admin/cashMutationCommands.ts:29 | type-alias | direct-properties-only | status, id, action, revision, docNo |
| ModalShellProps | src/shared/components/ModalShell.tsx:4 | interface | direct-properties-only | title, subtitle, onClose, children, footer, className, bodyClassName, layer, size |
| LargeModalShellProps | src/shared/components/LargeModalShell.tsx:4 | type-alias | non-object-alias-not-expanded |  |
| ProductionWorkDocument | src/features/production-documents/domain/productionWorkDocument.ts:5 | interface | direct-properties-only | id, companyId, documentDate, templateVersion, specialNotes, preparedByName, reviewedByName, approvedByName, revision, rowCount, createdAt, createdBy, updatedAt, updatedBy |
| ProductionWorkFields | src/features/production-documents/domain/productionWorkDocument.ts:22 | interface | direct-properties-only | manufacturedDate, itemId, itemNameSnapshot, specSnapshot, manufacturingLotNo, expiryDate, productionQty, productionUnit, rawItemId, rawNameSnapshot, rawUsedKg, rawLotId, rawLotNoSnapshot, workerNameSnapshot, note |
| ProductionWorkSource | src/features/production-documents/domain/productionWorkDocument.ts:40 | interface | direct-properties-only | kind, sourceId, operationId, ledgerId, lotId, recordedAt, importedAt |
| ProductionWorkDocumentLine | src/features/production-documents/domain/productionWorkDocument.ts:50 | interface | direct-properties-only | id, companyId, documentId, batchKey, sortOrder, documentRevision, source, sourceState, sourceSnapshot, manualFields |
| ProductionWorkEvidence | src/features/production-documents/domain/productionWorkDocument.ts:64 | interface | direct-properties-only | companyId, key, batchKey, fields, source, reversed |
| ProductionWorkPrintRow | src/features/production-documents/domain/productionWorkDocument.ts:158 | interface | direct-properties-only | line, showProduction, issues |
| ProductionWorkDocumentPrintProps | src/features/production-documents/ui/ProductionWorkDocumentPrint.tsx:8 | interface | direct-properties-only | document, lines |
| ProductionWorkDocumentEditorProps | src/features/production-documents/ui/ProductionWorkDocumentEditor.tsx:12 | interface | direct-properties-only | initialDocument, initialLines, loadEvidence, onSave |
| ProductLotClock | functions/src/shared/productLot.ts:4 | type-alias | direct-properties-only | now, date, id |
| ProductLotTake | functions/src/shared/productLot.ts:73 | interface | direct-properties-only | lotId, lotNo, receivedDate, supplierName, qty |
| StockComponent | functions/src/shared/stockUnitMeasure.ts:3 | type-alias | direct-properties-only | childId, qty, child |
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
| AnchorResult | functions/src/shared/lotAnchor.ts:41 | interface | direct-properties-only | lots, deltaQty, beforeQty |
| RawHolderItem | functions/src/shared/rawHolder.ts:4 | type-alias | direct-properties-only | id, name, companyId, subtype, phantom, archived, rawMaterialName |
| ItemReceipt | src/shared/receipt.ts:4 | interface | direct-properties-only | id, itemId, itemName, quantity, unit, partnerId, partnerName, date, poId, companyId, addedBy, createdAt |
| CompanyClaim | src/shared/companyWriteBoundary.ts:14 | type-alias | direct-properties-only | companyId |
| LoanContract | src/shared/loanLedger.ts:6 | interface | direct-properties-only | id, companyId, name, lenderName, partnerId, accountCode, openingDate, openingPrincipal, maturityDate, note, createdAt |
| LoanMovement | src/shared/loanLedger.ts:20 | interface | direct-properties-only | entry, principalDelta |
| CompanyWriteOperation | src/shared/services/firebaseService.ts:600 | type-alias | non-object-alias-not-expanded |  |
| ProductionDocumentWrite | src/shared/services/productionWorkDocumentService.ts:9 | interface | direct-properties-only | id, companyId, revision |
| ProductionDocumentLineWrite | src/shared/services/productionWorkDocumentService.ts:14 | interface | direct-properties-only | id, companyId, documentId |
| LedgerEvidence | src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:40 | type-alias | non-object-alias-not-expanded |  |
| AlertTone | src/shared/components/AlertModalShell.tsx:21 | type-alias | non-object-alias-not-expanded |  |
| Props | src/shared/components/AlertModalShell.tsx:36 | interface | direct-properties-only | title, tone, icon, onClose, wide, children, footer |
| ConfirmModalProps | src/shared/components/ConfirmModal.tsx:13 | interface | direct-properties-only | title, tone, icon, message, subMessage, body, confirmDisabled, footerNote, confirmText, cancelText, confirmOnly, onConfirm, onCancel |
| LineAmount | functions/src/shared/lineAmount.ts:2 | interface | direct-properties-only | gross, supply, tax |
| PurchaseCostFallback | functions/src/shared/purchaseCost.ts:5 | type-alias | non-object-alias-not-expanded |  |
| Margin | src/shared/margin.ts:26 | interface | direct-properties-only | supply, cost, margin, marginRate, markupRate |
| PrintableLine | src/shared/docName.ts:44 | interface | direct-properties-only | name, spec |
| BomCostCtx | src/shared/bomCost.ts:19 | interface | direct-properties-only | allItems, formulaOf, formulaRowsOf, processingFeeOf, itemBoms |
| CostFn | src/shared/bomCost.ts:48 | interface | direct-properties-only | rollup |
| CostCalcRow | src/features/admin/costCalc.ts:18 | interface | direct-properties-only | itemId, qty |
| CostCalcLine | src/features/admin/costCalc.ts:24 | interface | direct-properties-only | itemId, name, spec, unit, qty, unitCost, amount |
| CostCalcResult | src/features/admin/costCalc.ts:37 | interface | direct-properties-only | lines, cost, fee, price, margin, marginRate, markupRate |
| RawUsersDeps | src/shared/rawUsers.ts:28 | interface | direct-properties-only | allItems, bomOf, buildFormula, baseRawName |
| RequestBody | src/shared/services/returnRequestSubmission.ts:4 | type-alias | non-object-alias-not-expanded |  |
| PendingReturnSubmission | src/shared/services/returnRequestSubmission.ts:5 | type-alias | direct-properties-only | version, companyId, userId, requestId, request |
| CreateCommand | src/shared/services/employeeCommand.ts:7 | type-alias | direct-properties-only | kind, collection, data |
| ReceiveCommand | src/shared/services/employeeCommand.ts:11 | type-alias | direct-properties-only | kind, poId, actorName, items, orderUnitInputs |
| UnpackPlan | src/shared/canUnpack.ts:36 | interface | direct-properties-only | canItemId, canName, cans, bulkItemId, bulkName, bulkUnit, perCan, bulkQty, discarded |
| UnpackReject | src/shared/canUnpack.ts:60 | type-alias | non-object-alias-not-expanded |  |
| UnpackResult | src/shared/canUnpack.ts:68 | type-alias | non-object-alias-not-expanded |  |
| UnpackLotMove | src/shared/unpackLots.ts:36 | interface | direct-properties-only | canLotId, lotNo, supplierName, receivedDate, cans, bulkQty |
| UnpackLotResult | src/shared/unpackLots.ts:48 | interface | direct-properties-only | canLots, bulkLots, moves, shortageQty |
| UnpackOutcome | src/shared/services/unpackService.ts:47 | interface | direct-properties-only | ok, message, moves |
| PartnerAdvanceResult | src/features/statements/infrastructure/partnerAdvanceCommands.ts:5 | type-alias | direct-properties-only | status, id, docNo |
| PendingPartnerAdvance | src/features/statements/infrastructure/partnerAdvanceCommands.ts:6 | type-alias | direct-properties-only | version, companyId, actorId, action, input |
| Command | src/shared/services/deleteIssuedStatementService.ts:7 | type-alias | direct-properties-only | operationId, statementId, releaseId, expectedRevision, expectedOriginalHash |
| RecurringStatementType | functions/src/shared/recurringVoucher.ts:1 | type-alias | non-object-alias-not-expanded |  |
| RecurringSource | functions/src/shared/recurringVoucher.ts:2 | type-alias | direct-properties-only | id, dir, statementType, partnerId, name, itemName, amount, accountCode, taxExempt, transferLines |
| Company | functions/src/autoVoucherDraft.ts:2 | type-alias | non-object-alias-not-expanded |  |
| Template | functions/src/autoVoucherDraft.ts:3 | type-alias | direct-properties-only | id, companyId, autoIssue, kind, name, itemName, amount, accountCode, issueDay, startYm, endYm, statementType, dir, mode, loanId, loanCode, principal, interest, transferLines, partnerId, partnerName, taxExempt |
| Draft | functions/src/autoVoucherDraft.ts:12 | type-alias | direct-properties-only | kind, companyId, operationId, tradeDate, document |
| ScheduledLoanDraft | functions/src/autoVoucherDraft.ts:13 | type-alias | direct-properties-only | companyId, operationId, tradeDate, loanId, loanCode, principal, interest, note |
| AutoVoucherDecision | functions/src/autoVoucherDraft.ts:14 | type-alias | non-object-alias-not-expanded |  |
| TemplateStatementType | src/shared/templateStatementType.ts:2 | type-alias | non-object-alias-not-expanded |  |
| TemplateSource | src/shared/templateStatementType.ts:4 | interface | direct-properties-only | statementType, dir, partnerId, transferLines |
| StatementType | src/shared/statementLines.ts:19 | type-alias | non-object-alias-not-expanded |  |
| ManualRow | src/shared/statementLines.ts:22 | interface | direct-properties-only | sourceLineIndex, purchaseQuantityKg, itemId, name, spec, qty, price, isTaxExempt, note, accountCode, side |
| LineItem | src/shared/statementLines.ts:32 | interface | direct-properties-only | sourceLineIndex, purchaseQuantityKg, itemId, lineKind, key, no, name, spec, qty, price, supply, tax, total, isTaxExempt, accountCode, side, unknownItem, taxUnknown |
| ResolvedOrderItem | src/shared/statementLines.ts:143 | interface | direct-properties-only | product, qty, perBox, unknownItem |
| OrderLinesInput | src/shared/statementLines.ts:203 | interface | direct-properties-only | orderUnitInputs, order, stmtType, allItems, partnerItems, partnerId, editablePrices, taxExemptOverrides, accountCodeOverrides |
| LineTotals | src/shared/statementLines.ts:286 | interface | direct-properties-only | isTwoSided, supply, tax, amount |
| StatementCommandKind | src/features/statements/domain/statementCommand.ts:21 | type-alias | non-object-alias-not-expanded |  |
| StatementCommand | src/features/statements/domain/statementCommand.ts:23 | interface | direct-properties-only | operationId, kind, statementId, expectedVersion, companyId, partnerId, partnerName, tradeDate, type, docNo, memo, orderIds, lines, partySnapshot, totals |
| StatementRejectionCode | src/features/statements/domain/statementCommand.ts:53 | type-alias | non-object-alias-not-expanded |  |
| StatementRejection | src/features/statements/domain/statementCommand.ts:60 | interface | direct-properties-only | code, lineIndexes, lineNames |
| StatementWarningCode | src/features/statements/domain/statementCommand.ts:69 | type-alias | non-object-alias-not-expanded |  |
| StatementWarning | src/features/statements/domain/statementCommand.ts:73 | interface | direct-properties-only | code, lineIndexes, lineNames |
| StatementCheck | src/features/statements/domain/statementCommand.ts:79 | interface | direct-properties-only | ok, rejections, warnings |
| BuildInput | src/features/statements/domain/statementCommand.ts:86 | interface | direct-properties-only | kind, statementId, partnerId, partnerName, tradeDate, type, docNo, memo, orderIds, lines, companyId, expectedVersion, partySnapshot |
| TradeStatementDraft | src/features/statements/infrastructure/tradeStatementPending.ts:4 | type-alias | direct-properties-only | command, statement, costUpdates, poIds, newPoItems |
| TradeStatementPending | src/features/statements/infrastructure/tradeStatementPending.ts:5 | type-alias | direct-properties-only | version, companyId, userId, input, payment |
| TradeStatementIssueInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:8 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, newPo, costUpdates |
| PartnerPaymentInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:111 | type-alias | direct-properties-only | tradeDate, partnerId, direction, amount, cashAccountId, pin, allocations, note |
| Request | src/features/statements/infrastructure/issueTradeStatementCommand.ts:143 | type-alias | non-object-alias-not-expanded |  |
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
| Props | components/OrderActivityLogModal.tsx:14 | interface | direct-properties-only | partnerName, order, companyId, rows, loading, error, onClose |
| StatusColumnStyle | src/shared/orderStatusStyle.ts:190 | interface | direct-properties-only | color, bgColor, borderColor, textColor |
| CalendarDayCountBadgeProps | components/CalendarDayCountBadge.tsx:3 | interface | direct-properties-only | count |
| CalendarViewProps | components/CalendarView.tsx:7 | interface | direct-properties-only | orders, onUpdateDeliveryDate, onOrderClick |
| BadgeVariant | src/shared/components/Badge.tsx:7 | type-alias | non-object-alias-not-expanded |  |
| BadgeProps | src/shared/components/Badge.tsx:17 | interface | direct-properties-only | variant, children, className |
| CompletionStatusControlProps | src/shared/components/CompletionStatusControl.tsx:4 | interface | direct-properties-only | completed, onChange, disabled, ariaLabel, title |
| ModalActionFooterProps | src/shared/components/ModalActionFooter.tsx:3 | interface | direct-properties-only | onCancel, onPrimary, primaryLabel, primaryDisabled, cancelLabel |
| OrderEditModalShellProps | components/OrderEditModalShell.tsx:5 | interface | direct-properties-only | title, partnerName, context, onClose, onSave, saveDisabled, headerAction, children |
| Props | src/shared/components/DateChipButton.tsx:17 | interface | direct-properties-only | label, value, onChange, text, disabled, block |
| CardDatePickerButtonProps | components/OrdersList.tsx:119 | interface | direct-properties-only | label, value, onChange, className, children, disabled |
| OrdersListProps | components/OrdersList.tsx:229 | interface | direct-properties-only | orderUnitInputs, companyId, title, employees, subtitle, groupBy, allowedStatuses, orders, partners, items, partnerItems, palletStocks, itemBoms, onUpdateStatus, onUpdateDeliveryDate, onUpdateReceivedDate, onUpdatePallets, onUpdateItems, onUpdateNote, onUpdateDeliveryBoxes, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleShipmentComplete, onToggleItemChecked, onDeleteOrder, onAddClick, onPasteClick, currentUserName, highlightOrderId, onHighlightClear, newOrderId, onNewOrderIdClear, workOrderItems, onSetWorkOrderItems, onLoadHistoricalOrders, isLoadingHistoricalOrders, ordersMonths, onChangeOrdersMonths, embeddedListOnly, calendarSlot |
| OrderCardProps | components/OrdersList.tsx:295 | interface | direct-properties-only | orderUnitInputs, order, partners, items, partnerItems, palletStocks, itemBoms, editingOrderId, setEditingOrderId, showAddProductSelect, setShowAddProductSelect, onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onUpdatePallets, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleItemChecked, onDeleteOrder, currentUserName, gridCols, isListView, tintedHeader, isHighlighted, highlightOrderId, readOnly, onEditOrder, onRequestShip |
| OrderSourceGroupProps | components/OrdersList.tsx:336 | interface | direct-properties-only | orderUnitInputs, colId, source, orders, gridCols, collapsedCategories, onToggleCategory, partners, items, partnerItems, editingOrderId, setEditingOrderId, showAddProductSelect, setShowAddProductSelect, onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onToggleInvoicePrinted, onToggleItemChecked, onDeleteOrder, currentUserName, isListView, highlightOrderId, onCardClick, onEditOrder, tintedHeader |
| DeliveryRowProps | components/OrdersList.tsx:370 | interface | direct-properties-only | order, partnerName, items, onToggleInvoicePrinted, onUpdateDeliveryBoxes |
| TabType | components/OrdersList.tsx:378 | type-alias | non-object-alias-not-expanded |  |
| WorkItem | components/OrdersList.tsx:1696 | type-alias | direct-properties-only | key, orderId, itemId, lineKey, itemName, partnerName, qty, category, workGroup, groupId, groupName |
| Command | src/shared/services/returnRequestCancellation.ts:5 | type-alias | direct-properties-only | companyId, requestId, operationId, expectedRequest |
| Result | src/shared/services/returnRequestCancellation.ts:6 | type-alias | direct-properties-only | status, requestId, operationId, requestHash |
| RoleLike | src/shared/partnerRole.ts:17 | type-alias | non-object-alias-not-expanded |  |
| ProductModalProps | components/AddItemModal.tsx:19 | interface | direct-properties-only | companyId, orderUnitInputs, initialData, allSubmaterials, items, partners, partnerItems, onClose, onSave, onUpsertPartnerItem, onDeletePartnerItem, onAddSubmaterial, rawItems, itemFormulas, onSaveItemFormula, rollupCostOf |
| SpecUnit | components/AddItemModal.tsx:65 | type-alias | non-object-alias-not-expanded |  |
| Props | components/RawMaterialEntryModal.tsx:8 | interface | direct-properties-only | open, mode, materials, defaultMaterial, currentUserName, lotsForMaterial, onClose, onSubmit |
| NamedItem | src/shared/itemSummary.ts:7 | interface | direct-properties-only | name |
| LedgerTrace | src/shared/ledgerTrace.ts:36 | interface | direct-properties-only | who, where, cardNo, note |
| ReturnStockMovement | src/shared/returnStockMovement.ts:3 | type-alias | direct-properties-only | itemId, companyId, partnerId, operationId, quantityDelta, date, createdAt |
| ReturnStockOperation | src/shared/returnStockMovement.ts:7 | type-alias | direct-properties-only | id, companyId, partnerId, sourceStatementId, sourceMode, returnType, amount, applications, returnRequestId, journalId, createdAt, stockMovements |
| ItemLedgerKind | src/features/admin/itemLedger.ts:30 | type-alias | non-object-alias-not-expanded |  |
| ItemInventoryEntry | src/features/admin/itemLedger.ts:33 | type-alias | non-object-alias-not-expanded |  |
| ItemLedgerRow | src/features/admin/itemLedger.ts:53 | interface | direct-properties-only | date, kind, qty, partnerName, orderId, note, balance, occurredAt, targetBalance |
| ItemLedger | src/features/admin/itemLedger.ts:67 | interface | direct-properties-only | rows, inSum, outSum, net, gap, opening, independentlyVerified, verifiedFrom |
| FilterType | components/RawLedgerList.tsx:10 | type-alias | non-object-alias-not-expanded |  |
| Props | components/RawLedgerList.tsx:13 | interface | direct-properties-only | stockMovements, entries, isAdmin, currentUserName, onDelete, showMaterial, pageSize, emptyText, allEntries, orders, linesUsingRaw |
| DayRow | components/RawLedgerList.tsx:53 | type-alias | direct-properties-only | key, date, material, received, used, adj, prev, cur, notes, who, wheres, cards, types, delIds, mine, anchor, rows, seq |
| Props | components/RawMaterialLotPanel.tsx:12 | interface | direct-properties-only | linesUsingRaw, showLedger, product, isAdmin, linkedNote, ledgerEntries, orders, 박스로트, onDeleteEntry, currentUserName, onLotChanged, focusLotId |
| LotShipment | components/ProductLotPanel.tsx:5 | interface | direct-properties-only | orderId, partnerName, date, qty |
| Props | components/ProductLotPanel.tsx:12 | interface | direct-properties-only | material, items, shipmentsByLot, emptyHint |
| TimelineRow | components/LotTimeline.tsx:9 | type-alias | direct-properties-only | id, date, title, note, businessDate, sequence, delta, balance, details, kind |
| OemCostInputRow | src/features/admin/oemCostEvidence.ts:5 | interface | direct-properties-only | rawItemId, kg, supplyAmount |
| ProcessingFee | src/features/admin/oem.ts:33 | interface | direct-properties-only | supply, tax, total |
| OemFeeProductInput | functions/src/shared/oemFeePlan.ts:3 | type-alias | direct-properties-only | name, spec, qty, unitKg |
| OemFeeBulkInput | functions/src/shared/oemFeePlan.ts:4 | type-alias | direct-properties-only | material, kg |
| OemFeeLine | functions/src/shared/oemFeePlan.ts:5 | type-alias | direct-properties-only | name, spec, qty, price, supply, tax, total, isTaxExempt, accountCode |
| OemFeePlanInput | functions/src/shared/oemFeePlan.ts:6 | type-alias | direct-properties-only | receivedKg, sentKg, perKg, exempt, accountCode, products, bulk |
| OemReceiptItemChange | src/features/admin/oemReceiptInventory.ts:6 | interface | direct-properties-only | itemId, qty, lot, material, unitKg |
| OemReceiptInventoryInput | src/features/admin/oemReceiptInventory.ts:14 | interface | direct-properties-only | oemCostEvidence, companyId, poId, operationId, date, items, poPatch, feeRequest |
| JobCommandInput | src/shared/services/rawInventoryJob.ts:18 | interface | direct-properties-only | command, options |
| JobCommandResult | src/shared/services/rawInventoryJob.ts:23 | type-alias | direct-properties-only | input, result |
| RunJobOptions | src/shared/services/rawInventoryJob.ts:25 | interface | direct-properties-only | now, db |
| RunJobOutcome | src/shared/services/rawInventoryJob.ts:30 | interface | direct-properties-only | job, results |
| OemIssueLine | src/features/admin/oemIssueJob.ts:8 | type-alias | direct-properties-only | material, rawItemId, kg |
| OemIssueInput | src/features/admin/oemIssueJob.ts:9 | interface | direct-properties-only | jobId, companyId, partnerId, partnerName, sent, date, note, addedBy, oemCostEvidence |
| OemIssueDraft | src/features/admin/oemIssueJob.ts:21 | type-alias | non-object-alias-not-expanded |  |
| OemIssuePorts | src/features/admin/oemIssueJob.ts:42 | interface | direct-properties-only | prepareDraft, runRawSteps, missingRawSteps, finalizeDraft, markFailed |
| OemFeeStatementWrite | src/features/admin/oemFeeStatement.ts:4 | interface | direct-properties-only | companyId, poId, perKg, statement |
| OemEngineDeps | src/features/admin/oemEngine.ts:33 | interface | direct-properties-only | orderUnitInputs, companyId, items, partners, issueOemBatchJob, adjustRawLots, updateItem, addItem, applyOemReceiptInventory, applyOemFeeStatement, buildFormula, processingFeeCode |
| StoredOemCostDisplay | src/features/admin/oemReconciliation.ts:8 | type-alias | non-object-alias-not-expanded |  |
| Props | components/OemManager.tsx:19 | interface | direct-properties-only | orderUnitInputs, companyId, items, partners, rawStockKg, issueDrafts, issueOpen, receiveTarget, feeTarget, onClose, onIssue, onReceive, onIssueFee |
| IssueInput | components/OemManager.tsx:35 | type-alias | non-object-alias-not-expanded |  |
| ReceiveInput | components/OemManager.tsx:36 | type-alias | non-object-alias-not-expanded |  |
| StoredPending | components/OemManager.tsx:37 | type-alias | direct-properties-only | value, encoded, error |
| Props | components/CategoryManager.tsx:14 | interface | direct-properties-only | onClose, onSaved, usage, companyId |
| StockClosingRow | components/ItemList.tsx:183 | interface | direct-properties-only | itemId, name, spec, boxSize, boxes, loose, total |
| StockClosing | components/ItemList.tsx:184 | interface | direct-properties-only | id, date, closedBy, createdAt, items, totalStock |
| ItemListProps | components/ItemList.tsx:195 | interface | direct-properties-only | orderUnitInputs, mode, companyId, items, orderRequests, confirmedOrders, dispatchedQtyByItem, onUpdateItem, onAddItem, onAddOrderRequest, onRemoveOrderRequest, onUpdateOrderRequestQty, onUpdatePoItemQty, onRemovePoItem, onRequestPoEdit, onToggleConfirmRequestQty, onConfirmRequest, onConfirmRequests, onBulkAddConfirmedOrders, onConfirmAllRequests, onFinishConfirmedOrder, onUpdateConfirmedQty, onUpdatePendingFlowQty, onRemoveConfirmedOrder, onEditProduct, onDeleteItem, onAddAdjustmentRequest, inboundPartners, partners, partnerItems, rawMaterialLedger, linesUsingRaw, orders, onRequestPurchaseInvoice, onOpenVoucher, issuedStatements, onAddRawMaterialEntry, onDeleteRawMaterialEntry, onLedgerChanged, currentUser, isAdmin, onUpdateSubmaterial, receivedOrders, returnRequests, returnContent, onProcessReturn, onResumeReturn, returnBadge, oemEnabled, oemIssueDrafts, rawStockKg, onOemIssue, onOemReceive, onOemCancel, onOemIssueFee |
| MainTab | components/ItemList.tsx:271 | type-alias | non-object-alias-not-expanded |  |
| FlowTypeFilter | components/ItemList.tsx:311 | type-alias | non-object-alias-not-expanded |  |
| FlowStatusFilter | components/ItemList.tsx:312 | type-alias | non-object-alias-not-expanded |  |
| InboundSubTab | components/ItemList.tsx:313 | type-alias | non-object-alias-not-expanded |  |
| TopTab | components/ItemList.tsx:316 | type-alias | non-object-alias-not-expanded |  |
| GroupRow | components/ItemList.tsx:1305 | type-alias | direct-properties-only | p, isChild, parentId, boxCount |
| FlowRow | components/ItemList.tsx:1625 | type-alias | direct-properties-only | key, id, type, status, date, partnerName, itemSummary, quantitySummary, source |
| GridRow | components/ItemList.tsx:3688 | type-alias | direct-properties-only | itemId, label, spec, editable, isChild, group |
| Vouchered | src/shared/statementOrders.ts:24 | type-alias | non-object-alias-not-expanded |  |
| PartnerOrdersInput | src/shared/statementOrders.ts:39 | interface | direct-properties-only | orders, partnerId, isVouchered, onlyActive, dateFrom, dateTo |
| OrderStatusDotProps | src/shared/components/OrderStatusDot.tsx:4 | interface | direct-properties-only | status, className |
| OrderItemLinesProps | src/shared/components/OrderItemLines.tsx:5 | interface | direct-properties-only | orderItems, itemById, className |
| NewOrderLineInput | src/shared/newOrderDraft.ts:7 | interface | direct-properties-only | itemId, quantity, isBoxUnit, unitsPerBox, boxType, boxSubId, displaySize, orderedAs |
| AddOrderModalProps | components/AddOrderModal.tsx:27 | interface | direct-properties-only | mode, orderUnitInputs, items, orders, partners, partnerItems, palletStocks, submaterials, onClose, onBack, onSave |
| RawExtracted | src/shared/orderExtract.ts:26 | interface | direct-properties-only | partnerId, deliveryDate, lines, note |
| ExtractedLine | src/shared/orderExtract.ts:33 | interface | direct-properties-only | itemId, name, qty, isBox, source |
| ExtractResult | src/shared/orderExtract.ts:44 | interface | direct-properties-only | partnerId, partnerName, deliveryDate, note, lines, rejected |
| CatalogItem | src/shared/orderExtract.ts:54 | interface | direct-properties-only | id, name, spec |
| CatalogPartner | src/shared/orderExtract.ts:55 | interface | direct-properties-only | id, name |
| HistoryOrder | src/shared/orderExtract.ts:172 | interface | direct-properties-only | partnerId, createdAt, items |
| ParsedLine | components/PasteOrderModal.tsx:53 | type-alias | direct-properties-only | rawText, rawName, qty, isBox, selectedProductId |
| PasteOrderModalProps | components/PasteOrderModal.tsx:103 | interface | direct-properties-only | orderUnitInputs, items, partners, orders, partnerItems, palletStocks, initialText, onClose, onBack, onSave |
| Step | components/PasteOrderModal.tsx:122 | type-alias | non-object-alias-not-expanded |  |
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
| CancellationEvidenceOrder | functions/src/shared/orderCancellationEvidence.ts:2 | type-alias | direct-properties-only | id, companyId, status, producedAt, shippedOut, items, inventorySnapshots, itemInventory, rawConsumedLots, productConsumedLots |
| LockRecoveryAssessment | functions/src/shared/orderCancellationEvidence.ts:14 | type-alias | direct-properties-only | status, inventoryApplied, reason, action |
| RawUsageKg | src/features/admin/orderRawInventory.ts:12 | type-alias | non-object-alias-not-expanded |  |
| OrderRawInventoryDeps | src/features/admin/orderRawInventory.ts:14 | interface | direct-properties-only | actorName, allItems, partners, db, addNotification, runRawInventoryJob |
| OrderProductLotMutationResult | src/features/admin/orderProductLots.ts:6 | interface | direct-properties-only | lots, consumedLots |
| OrderProductLotMutation | src/features/admin/orderProductLots.ts:11 | interface | direct-properties-only | itemId, apply |
| OrderProductLotDeps | src/features/admin/orderProductLots.ts:78 | interface | direct-properties-only | allItems, shipQtyOf |
| OrderItemStockDeps | src/features/admin/orderItemStock.ts:7 | interface | direct-properties-only | db, allItems, bomIndex |
| OrderStockReservation | src/features/admin/orderItemStock.ts:17 | interface | direct-properties-only | operationId, orderId, itemIds, quantities, stockSnapshot, previousReservations, allocationQuantities, active |
| CancellationAction | src/features/admin/orderInventoryCancellation.ts:11 | type-alias | non-object-alias-not-expanded |  |
| CancellationTicket | src/features/admin/orderInventoryCancellation.ts:109 | interface | direct-properties-only | orderId, companyId, action, evidence, operationId |
| CancellationReceipt | src/features/admin/orderInventoryCancellation.ts:113 | interface | direct-properties-only | id, companyId, orderId, state, cancellation |
| CancellationResult | src/features/admin/orderInventoryCancellation.ts:117 | interface | direct-properties-only | status, operationId, code, affectedItemIds, inventoryApplied, retryable, deleted, nextStatus |
| RollbackPlan | src/features/admin/rollbackSummary.ts:15 | interface | direct-properties-only | needed, lines, text, adjustments, legacyEvidenceWarning, warnings |
| OrderDeleteAction | src/features/admin/rollbackSummary.ts:235 | type-alias | non-object-alias-not-expanded |  |
| OrderDeleteStage | src/features/admin/rollbackSummary.ts:236 | type-alias | non-object-alias-not-expanded |  |
| OrderDeleteProgress | src/features/admin/rollbackSummary.ts:239 | interface | direct-properties-only | action, state, completedStages, inventoryApplied, error, retryable |
| OrderDeletePlan | src/features/admin/rollbackSummary.ts:248 | interface | direct-properties-only | action, allowed, nextStatus, state, message, subMessage, confirmText, blockedReasons, adjustments, completedStages, inventoryApplied, retryable |
| StockUseChoice | src/features/admin/orderStockEngine.ts:26 | interface | direct-properties-only | own, loose |
| StockUsePlan | src/features/admin/orderStockEngine.ts:32 | type-alias | non-object-alias-not-expanded |  |
| OrderStatusChangeContext | src/features/admin/orderStockEngine.ts:34 | interface | direct-properties-only | approvedBy, approvedAt, approvedPlan, approvedFromStatus, orderPatch |
| PreparedOrderStatusChange | src/features/admin/orderStockEngine.ts:42 | interface | direct-properties-only | order, plan |
| OrderStockEngineDeps | src/features/admin/orderStockEngine.ts:60 | interface | direct-properties-only | orderUnitInputs, actorName, allItems, submaterials, partners, allOrders, orders, db, buildFormula, createProductionRecordsForOrder, updateItem, addItem, claimOrderOperation, runRawInventoryJob |
| Engine | src/features/admin/orderStockEngine.ts:1009 | type-alias | non-object-alias-not-expanded |  |
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
| NoticeBoardProps | components/NoticeBoard.tsx:21 | interface | direct-properties-only | posts, companyId, onAddPost, onUpdatePost, onDeletePost |
| NoticeBlocks | components/NoticeBoard.tsx:29 | type-alias | non-object-alias-not-expanded |  |
| MonthPL | src/features/admin/financials.ts:87 | interface | direct-properties-only | sales, cogs, sgna, grossProfit, operatingProfit, otherIncome, otherExpense, netIncome |
| CashFlowDirectLine | src/features/admin/financials.ts:216 | interface | direct-properties-only | accountCode, section, inflow, outflow |
| CashFlowDirect | src/features/admin/financials.ts:222 | interface | direct-properties-only | op, inv, fin, net, opIn, opOut, invIn, invOut, finIn, finOut, lines |
| ItemManagerProps | components/ItemManager.tsx:31 | interface | direct-properties-only | companyId, orderUnitInputs, items, partners, partnerItems, accountCodes, accountGroups, itemBoms, onEditProduct, onAddItem, onDeleteItem, onLinkItem, onUnlinkItem, onLinkSupplier, onUnlinkSupplier, onMergeItems, onSaveItemCustomer, onUpsertPartnerItem, onSaveServiceTerms, onCreateBoxItem, onCalcCost, costOf, isAdmin |
| ChatAttachment | src/shared/chatUpload.ts:14 | interface | direct-properties-only | url, path, name, size, type, isImage |
| PasteLike | src/shared/chatUpload.ts:57 | interface | direct-properties-only | items, files |
| SharedFileDraft | src/shared/shareInbox.ts:8 | interface | direct-properties-only | id, file, text |
| RoomNameLike | src/shared/roomName.ts:13 | interface | direct-properties-only | participantIds, name, nameBy, createdBy |
| Person | src/shared/roomName.ts:23 | interface | direct-properties-only | id, name |
| NotifyMode | src/shared/notify.ts:6 | type-alias | non-object-alias-not-expanded |  |
| NotifyVolume | src/shared/notify.ts:57 | type-alias | non-object-alias-not-expanded |  |
| NotifyOpts | src/shared/notify.ts:107 | interface | direct-properties-only | title, body, tag, mode, whenFocused, onClick, view |
| SharedChatAttempt | src/shared/sharedChatAttempt.ts:4 | interface | direct-properties-only | version, companyId, uid, shareId, roomId, senderId, senderName, text, createdAt, file, message |
| MessageAction | src/shared/messageActions.ts:9 | type-alias | non-object-alias-not-expanded |  |
| ActionCtx | src/shared/messageActions.ts:11 | interface | direct-properties-only | msg, me, isAdmin, pinned |
| Reactions | src/shared/messageReactions.ts:21 | type-alias | non-object-alias-not-expanded |  |
| TimestampLike | src/shared/officeTalkTime.ts:1 | type-alias | direct-properties-only | toDate, seconds, _seconds |
| OfficeTalkProps | components/OfficeTalk.tsx:51 | interface | direct-properties-only | currentUser, employees, chatRooms, chatMessages, initialRoomId, onRoomOpened, onAddRoom, onUpdateRoom, onDeleteRoom, onSendMessage, onUpdateMessage, isAdmin, onExtractOrder, extractedMessageIds |
| OrderLike | src/shared/newOrderAlert.ts:6 | interface | direct-properties-only | id, createdAt |
| PickOpts | src/shared/newOrderAlert.ts:8 | interface | direct-properties-only | seeded, since, mine |
| RoomLike | src/shared/newChatAlert.ts:6 | interface | direct-properties-only | id, name, nameBy, participantIds, lastMessage, lastUpdatedAt, lastReadBy |
| ChatPickOpts | src/shared/newChatAlert.ts:16 | interface | direct-properties-only | userId, openRoomId, focused |
| DocMismatch | src/shared/docOil.ts:319 | interface | direct-properties-only | date, saleKg, rawKg, diffKg, unmapped |
| DocDropReason | src/shared/docOil.ts:340 | type-alias | non-object-alias-not-expanded |  |
| DocDrop | src/shared/docOil.ts:341 | interface | direct-properties-only | date, partnerName, itemName, qty, reason |
| DropOrder | src/shared/docOil.ts:349 | interface | direct-properties-only | status, deliveredAt, partnerName, items |
| RawDocEntry | src/shared/docOil.ts:437 | interface | direct-properties-only | id, material, date, targetKg, type, note, createdAt |
| RawDocRow | src/shared/docOil.ts:449 | interface | direct-properties-only | date, received, used, adj, prevBalance, currentBalance, note, kind |
| RawDocSheet | src/shared/docOil.ts:460 | interface | direct-properties-only | rows, opening, closing, totalIn, totalOut |
| Ev | src/shared/docOil.ts:487 | type-alias | direct-properties-only | date, received, used, targetKg, note, kind, createdAt |
| PaymentInput | src/shared/payment.ts:21 | interface | direct-properties-only | partnerId, partnerName, type, amount, date, note, reverse, id, docNo, cashAccountId |
| Row | functions/src/shared/partnerAdvanceAudit.ts:1 | type-alias | non-object-alias-not-expanded |  |
| ReadonlyAdvanceOperation | src/shared/partnerAdvanceAudit.ts:4 | type-alias | non-object-alias-not-expanded |  |
| ReturnAllocationOperation | src/shared/hooks/useReturnAllocationSources.ts:5 | type-alias | non-object-alias-not-expanded |  |
| WorkOrderItem | src/shared/hooks/useAppData.ts:26 | interface | direct-properties-only | id, key, orderId, itemId, itemName, partnerName, qty, category, sortIndex, date, lineKey, groupId, groupName |
| AppData | src/shared/hooks/useAppData.ts:50 | interface | direct-properties-only | advanceStatements, orderUnitInputs, orders, purchaseOrders, items, partnerItems, setPartnerItems, partners, employees, leaveRequests, pallets, palletTransactions, adjustmentRequests, noticePosts, chatRooms, chatMessages, rawMaterialLedger, sesameInputLedger, appNotifications, workOrderItems, issuedStatements, itemFormulas, itemBoms, itemPacks, returnRequests, returnOperations, returnAllocationOperations, returnAllocationsLoaded, returnOperationsLoaded, itemReceipts, companyInfo, accountGroups, accountCodes, fixedCostTemplates, expensePresets, cashFlowManual, cashAccounts, cashEntries, settlements, inventorySnapshots, productionSalesLogs, pendingStatementEdits, isDataLoading, refreshStaticData, historicalOrders, loadHistoricalOrders, isLoadingHistoricalOrders, ordersMonths, setOrdersMonths |
| AdminData | src/hooks/useAdminData.ts:28 | interface | direct-properties-only | fixedCosts, productionRecords |
| LoanMovementInput | src/shared/services/recordLoanMovement.ts:6 | type-alias | direct-properties-only | loanId, tradeDate, cashAccountId, action, principal, interest, note |
| Request | src/shared/services/recordLoanMovement.ts:10 | type-alias | non-object-alias-not-expanded |  |
| CompanyId | functions/src/shared/taxIssue.ts:1 | type-alias | non-object-alias-not-expanded |  |
| IssuedStatement | functions/src/shared/taxIssue.ts:2 | type-alias | direct-properties-only | id, items, taxIssuedAt, exemptIssuedAt |
| StatementWrite | functions/src/shared/taxIssue.ts:3 | type-alias | direct-properties-only | collection, id, merge, data |
| TaxIssueScope | functions/src/shared/taxIssue.ts:7 | type-alias | non-object-alias-not-expanded |  |
| TaxIssuePlan | functions/src/shared/taxIssue.ts:9 | interface | direct-properties-only | writes, statementPatches |
| TaxIssueCommand | src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:6 | type-alias | direct-properties-only | companyId, operationId, statements, scope, issuedAt |
| Result | src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:7 | type-alias | direct-properties-only | status, companyId, operationId, actorId, requestHash, statementPatches |
| CrossCompanyBom | src/shared/itemCompany.ts:7 | interface | direct-properties-only | bomId, parentId, childId, parentCompanyId, childCompanyId |
| IntegrityArea | src/features/admin/dataIntegrityAudit.ts:23 | type-alias | non-object-alias-not-expanded |  |
| IntegritySeverity | src/features/admin/dataIntegrityAudit.ts:24 | type-alias | non-object-alias-not-expanded |  |
| IntegrityIssue | src/features/admin/dataIntegrityAudit.ts:25 | interface | direct-properties-only | id, area, severity, title, detail, date, reference |
| IntegrityAuditInput | src/features/admin/dataIntegrityAudit.ts:34 | interface | direct-properties-only | companyId, dateFrom, dateTo, orders, items, itemBoms, purchaseOrders, itemReceipts, rawMaterialLedger, rawInventories, issuedStatements, productionSalesLogs, returnOperations |
| LedgerMovement | src/features/admin/dataIntegrityAudit.ts:60 | type-alias | non-object-alias-not-expanded |  |
| LinePOClassify | src/features/admin/dataIntegrityAudit.ts:121 | interface | direct-properties-only | isRaw, holder, baseName, expectedKg |
| RawLedgerExcelSheet | src/features/admin/rawLedgerExcel.ts:1 | interface | direct-properties-only | opening, closing, totalIn, totalOut, totalAdj, rows |
| FormulaCell | src/features/admin/rawLedgerExcel.ts:18 | type-alias | direct-properties-only | formula, result |
| RawLedgerExcelValue | src/features/admin/rawLedgerExcel.ts:19 | type-alias | non-object-alias-not-expanded |  |
| DashboardLink | components/DashboardLinks.tsx:12 | interface | direct-properties-only | id, label, url, order |
| DashboardProps | components/Dashboard.tsx:26 | interface | direct-properties-only | orders, isAdmin, items, partners, partnerItems, onNavigate, onCreatePurchaseOrder |
| StatCardProps | components/Dashboard.tsx:37 | interface | direct-properties-only | title, value, icon, trend, color, sub, onClick |
| Props | components/BomIntegrityPanel.tsx:10 | interface | direct-properties-only | items, itemFormulas, bomIndex |
| AIConsultantProps | components/AIConsultant.tsx:6 | interface | direct-properties-only | orders, items |
| RegionSelectProps | src/shared/components/RegionSelect.tsx:33 | interface | direct-properties-only | value, onChange, className, compact |
| Window | components/AddPartnerModal.tsx:9 | interface | direct-properties-only | daum |
| AddPartnerModalProps | components/AddPartnerModal.tsx:14 | interface | direct-properties-only | onClose, onSave |
| PartnerManagerProps | components/PartnerManager.tsx:29 | interface | direct-properties-only | partners, onUpdateClient, onAddClient, onDeleteClient |
| PayrollCommandInput | src/shared/services/payrollCommands.ts:7 | type-alias | direct-properties-only | yearMonth, payDate, lines, expectedRevision |
| HRManagerProps | components/HRManager.tsx:45 | interface | direct-properties-only | companyId, cashAccounts, employees, leaveRequests, onUpdateEmployee, onAddEmployee, onDeleteEmployee, onUpdateLeaveStatus, onUpdateLeave, onDeleteLeaveRequest, onAddLeaveRequests |
| MergedItem | src/shared/mergeStatementItems.ts:15 | interface | direct-properties-only | name, spec, qty, supply, tax, total, isTaxExempt |
| SplitMerged | src/shared/mergeStatementItems.ts:51 | interface | direct-properties-only | taxable, exempt |
| DocParty | src/shared/docParty.ts:21 | interface | direct-properties-only | name, bizNo, ceo, addr, bizType, bizItem, tel, fax |
| DocPartiesByIdInput | src/shared/docParty.ts:89 | interface | direct-properties-only | isSale, companyInfo, partners, partnerId, partnerName |
| TaxStatementProps | components/TaxStatement.tsx:21 | interface | direct-properties-only | companyId, issuedStatements, partners, companyInfo, onApplyTaxIssue |
| AdminAccessLike | src/shared/adminAccess.ts:9 | interface | direct-properties-only | id, adminAccess |
| AdminChecklistProps | components/AdminChecklist.tsx:15 | interface | direct-properties-only | leaveRequests, adjustmentRequests, employees, returnRequests, onProcessReturn, receivedOrders, partners, issuedStatements, onUpdateLeaveStatus, onUpdateAdjustmentStatus, onDeleteAdjustmentRequest, onProcessAdjustment, pendingStatementEdits, onApproveStatementEdit, onRejectStatementEdit, orderRequests, items, partnerItems, onCreatePurchaseStatement |
| TabType | components/AdminChecklist.tsx:37 | type-alias | non-object-alias-not-expanded |  |
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
| Props | components/QuotationManager.tsx:80 | interface | direct-properties-only | orderUnitInputs, items, partners, partnerItems, companyId, currentUser, companyInfo, costOf |
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
| Line | functions/src/returnReversalPlan.ts:4 | type-alias | non-object-alias-not-expanded |  |
| ReturnItem | functions/src/returnReversalPlan.ts:5 | type-alias | direct-properties-only | itemId, sourceLineIndex, quantity, isResellable |
| ReturnRow | functions/src/returnReversalPlan.ts:6 | type-alias | direct-properties-only | id, companyId, linkedStatementId, partnerId, status, returnType, totalAmount, items |
| Source | functions/src/returnReversalPlan.ts:8 | type-alias | direct-properties-only | id, companyId, type, partnerId, totalSupply, totalTax, totalAmount, items |
| JournalLine | functions/src/returnReversalPlan.ts:10 | type-alias | direct-properties-only | accountCode, side, amount |
| Item | functions/src/shared/returnStockKind.ts:3 | type-alias | non-object-alias-not-expanded |  |
| ExplicitReturnMoney | src/features/admin/purchaseReturnRequest.ts:94 | interface | direct-properties-only | items, payableAccountCode |
| DateRangeQuick | src/shared/components/DateRangeFilter.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| ReturnManagerProps | components/ReturnManager.tsx:31 | interface | direct-properties-only | companyId, items, partners, orders, issuedStatements, currentUser, isAdmin, onProcessReturn |
| Tab | components/ReturnManager.tsx:42 | type-alias | non-object-alias-not-expanded |  |
| ReturnCardProps | components/ReturnManager.tsx:504 | interface | direct-properties-only | req, isAdmin, isProcessing, onProcess |
| PurchaseReturnRow | src/features/admin/purchaseReturnRows.ts:2 | interface | direct-properties-only | itemId, name, qty, unit, sourceLineIndex, unitKg, originalQty, remainingQty |
| ReturnTab | components/ReceivingReturnsManager.tsx:16 | type-alias | non-object-alias-not-expanded |  |
| ReceivingReturnsManagerProps | components/ReceivingReturnsManager.tsx:18 | interface | direct-properties-only | companyId, items, partnerItems, partners, orders, issuedStatements, currentUser, isAdmin, onProcessReturn, onLinkInbound |
| ItemFormulaRow | components/ProductionManager.tsx:10 | type-alias | direct-properties-only | parent_key, child_name, ratio, yield_rate |
| ProductionManagerProps | components/ProductionManager.tsx:28 | interface | direct-properties-only | records, items, orders, ledger, itemFormulas, onAdd, onDelete, onUpdate, currentUserName |
| LedgerRow | src/features/admin/cashLedger.ts:17 | type-alias | non-object-alias-not-expanded |  |
| AccountLedger | src/features/admin/cashLedger.ts:18 | type-alias | non-object-alias-not-expanded |  |
| PartnerHistorySource | src/features/admin/cashLedger.ts:102 | type-alias | non-object-alias-not-expanded |  |
| PartnerLedgerRow | src/features/admin/cashLedger.ts:205 | interface | direct-properties-only | kind, id, date, label, docNo, sourceId, time, amount, balance, source, opening |
| PartnerLedger | src/features/admin/cashLedger.ts:229 | interface | direct-properties-only | rows, opening, accrued, paid, balance |
| Ev | src/features/admin/cashLedger.ts:267 | type-alias | direct-properties-only | row, ts, order |
| ReadonlyReturnOperation | src/features/admin/cashLedger.ts:494 | type-alias | direct-properties-only | id, companyId, journalId, sourcePresence, amount, applications |
| PartnerCashPart | src/features/admin/cashLedger.ts:591 | interface | direct-properties-only | code, reduce, note |
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
| PriceSyncLine | src/shared/partnerPriceSync.ts:27 | interface | direct-properties-only | purchaseQuantityKg, itemId, name, price, accountCode, isTaxExempt, qty, supply |
| PriceSyncInput | src/shared/partnerPriceSync.ts:41 | interface | direct-properties-only | newIssue, type, partnerId, lines, items, partnerItems, noLinkIds, isLatest |
| PriceSyncResult | src/shared/partnerPriceSync.ts:67 | interface | direct-properties-only | upserts, costUpdates |
| StatementLike | src/shared/latestStatement.ts:24 | interface | direct-properties-only | id, partnerId, type, tradeDate |
| LatestInput | src/shared/latestStatement.ts:31 | interface | direct-properties-only | this, all |
| MonthGroup | src/shared/groupByMonth.ts:10 | interface | direct-properties-only | month, rows |
| OrderPickerProps | components/OrderPicker.tsx:29 | interface | direct-properties-only | mode, pick, filter, data, on |
| PickRow | src/shared/itemPick.ts:15 | interface | direct-properties-only | product, pc |
| PickedLine | src/shared/itemPick.ts:22 | interface | direct-properties-only | itemId, name, spec, qty, price, isTaxExempt, note, accountCode |
| PickResult | src/shared/itemPick.ts:33 | interface | direct-properties-only | toAdd, unlinked |
| BuildJournalsInput | src/shared/buildJournals.ts:10 | interface | direct-properties-only | statements, cashEntries, accounts, opening, cashAccountMap, inventorySnapshots |
| BuildJournalsResult | src/shared/buildJournals.ts:20 | interface | direct-properties-only | entries, skipped |
| PartnerAnchorOpenStmt | src/features/admin/partnerAnchor.ts:36 | interface | direct-properties-only | id, date, type, remaining |
| PartnerAnchorRow | src/features/admin/partnerAnchor.ts:45 | interface | direct-properties-only | partnerId, partnerName, receivable, payable, openStmts |
| PartnerAnchor | src/features/admin/partnerAnchor.ts:56 | interface | direct-properties-only | id, companyId, year, asOf, rows, recordedAt |
| AnchorInput | src/features/admin/partnerAnchor.ts:69 | interface | direct-properties-only | advanceStatements, returnOperations, journals, statements, cashEntries, settlements, nameOf |
| VoucherLedgerInput | src/features/admin/useVoucherLedger.ts:32 | interface | direct-properties-only | advanceStatements, returnOperations, companyId, issuedStatements, cashEntries, settlements, accountCodes, histFrom, histTo |
| CashEditLineDraft | src/shared/cashEntryEdit.ts:15 | interface | direct-properties-only | accountCode, amount, note |
| CashEditForm | src/shared/cashEntryEdit.ts:21 | interface | direct-properties-only | amount, date, dir, accountCode, note, partnerId |
| CashModalMode | components/voucher/CashEntryModal.tsx:33 | type-alias | non-object-alias-not-expanded |  |
| SettleInput | components/voucher/CashEntryModal.tsx:38 | interface | direct-properties-only | amount, date, method, note, scope |
| Props | components/voucher/CashEntryModal.tsx:47 | interface | direct-properties-only | mode, partners, companyId, accountCodes, cashAccounts, accountId, onAccountId, partnerBalances, getBalance, latestStatement, onClose, onSettle, payrollEdit, transferEdit, onSaveEdit, onDeleteEntry, hasPendingRequest, onResumeEntry, onAssignCashAccount |
| VoucherDir | src/shared/cashTemplates.tsx:26 | type-alias | non-object-alias-not-expanded |  |
| CashTemplate | src/shared/cashTemplates.tsx:56 | interface | direct-properties-only | statementType, id, label, dir, mode, accountCode, note, wantsPartner, hint, amount, partnerId, taxExempt, partnerName, builtin, group, favorite, itemName, loanCode, loanId, vat, incomeTax, transferLines, unavailableCodes, insCorp, insEmp, principal, interest, gross, deduction |
| SplitMode | src/shared/cashTemplates.tsx:143 | type-alias | non-object-alias-not-expanded |  |
| Props | components/voucher/RecurringModal.tsx:20 | interface | direct-properties-only | companyId, templates, accountCodes, partners, isIssued, onClose, onGenerate, onCreateTemplate, onUpdateTemplate, onDeleteTemplate |
| VoucherIssuePending | src/features/statements/infrastructure/voucherIssuePending.ts:3 | type-alias | non-object-alias-not-expanded |  |
| TransferPartner | src/shared/services/interCompanyTransferService.ts:6 | type-alias | direct-properties-only | id, companyId, name, revision, available |
| TransferOptions | src/shared/services/interCompanyTransferService.ts:7 | type-alias | direct-properties-only | from, to, releaseId |
| TransferDraft | src/shared/services/interCompanyTransferService.ts:8 | type-alias | direct-properties-only | from, to, tradeDate, amount, overKind, fromAccountId, toAccountId, fromPartnerId, toPartnerId, expectedFromRevision, expectedToRevision, note |
| Command | src/shared/services/interCompanyTransferService.ts:9 | type-alias | non-object-alias-not-expanded |  |
| OverKind | src/shared/interCompany.ts:33 | type-alias | non-object-alias-not-expanded |  |
| TransferInput | src/shared/interCompany.ts:35 | interface | direct-properties-only | from, to, date, amount, payableToTarget, overKind, fromAccountId, toAccountId, fromPartnerId, fromPartnerName, toPartnerId, toPartnerName, note |
| TransferSplit | src/shared/interCompany.ts:54 | interface | direct-properties-only | offset, over, overKind |
| TransferResult | src/shared/interCompany.ts:68 | interface | direct-properties-only | out, in, split |
| SplitLine | src/shared/splitEntry.ts:24 | interface | direct-properties-only | accountCode, amount, note |
| EntryBase | src/shared/splitEntry.ts:27 | type-alias | non-object-alias-not-expanded |  |
| SplitInput | src/shared/splitEntry.ts:29 | interface | direct-properties-only | lines, note, fallbackNote, base, now |
| PayrollInput | src/shared/splitEntry.ts:68 | interface | direct-properties-only | gross, deduction, salaryCode, withholdCode, note, base, now |
| Props | components/voucher/VoucherComposer.tsx:54 | interface | direct-properties-only | companyId, initialDir, initialDate, initialPartnerId, partners, accountCodes, accountGroups, cashAccounts, fixedCostTemplates, cashEntries, statements, partnerBalances, getBalance, cashAccountId, onCashAccountId, onClose, onAddCashEntry, onIssueCashEntry, onAddIssuedStatement, onAddFixedCostTemplate, recordPayment, renderJournal |
| StatementHistoryKind | src/features/statements/ui/StatementHistoryFilters.tsx:4 | type-alias | non-object-alias-not-expanded |  |
| StatementQuickRange | src/features/statements/ui/StatementHistoryFilters.tsx:5 | type-alias | non-object-alias-not-expanded |  |
| StatementOrderDateQuick | src/features/statements/ui/StatementOrderDateFilter.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| StatementAccountChoice | src/features/statements/ui/StatementHistorySearchFields.tsx:3 | type-alias | direct-properties-only | value, label, path, axis, branch, isGroup, groupId |
| StatementHistoryRowView | src/features/statements/domain/statementHistoryRowView.ts:4 | type-alias | direct-properties-only | key, kind, label, date, createdAt, owner, partner, shipTo, detail, note, amount, cumulative, isReturn |
| ExcelListColumn | src/shared/listExcel.ts:1 | type-alias | direct-properties-only | header, width, number |
| ExcelListValue | src/shared/listExcel.ts:2 | type-alias | non-object-alias-not-expanded |  |
| StatementQuickItemResult | src/features/statements/ui/StatementQuickItemBar.tsx:6 | interface | direct-properties-only | pc, product |
| Props | src/features/statements/ui/StatementQuickItemBar.tsx:11 | interface | direct-properties-only | bomIndex, name, spec, quantity, price, note, searchOpen, results, productCost, salePrice, unitSupply, supply, tax, marginRate, showUnitSupply, formatAmount, onNameChange, onNameFocus, onNameBlur, onSpecChange, onQuantityChange, onPriceChange, onNoteChange, onSelect, onAdd, onOpenPicker |
| StatementItemPickerRow | src/features/statements/ui/StatementItemPicker.tsx:5 | interface | direct-properties-only | pc, product |
| Props | src/features/statements/ui/StatementItemPicker.tsx:10 | interface | direct-properties-only | rows, search, quantities, priceEdits, linkedItemIds, priceSaveState, onSearchChange, onToggleItem, onQuantityChange, onPriceChange, onSavePrice, onSetTax, onClose, onConfirm |
| Props | src/features/statements/ui/StatementOrderItemRows.tsx:5 | interface | direct-properties-only | items, selectedIndex, editablePrices, accountCodes, formatAmount, onSelect, onPriceChange, onTaxChange, onAccountChange |
| StatementManualSearchResult | src/features/statements/ui/StatementManualItemRows.tsx:12 | interface | direct-properties-only | pc, product |
| Props | src/features/statements/ui/StatementManualItemRows.tsx:17 | interface | direct-properties-only | preservedPurchaseUnitLineIndices, companyId, selectedPartnerId, lockedPurchaseUnitItemIds, purchaseUnits, purchaseUnitLoadError, bomIndex, rows, savedLines, readOnly, selectedIndex, activeSearchIndex, statementType, accountCodes, items, linked, formatAmount, searchResults, onSelect, onChange, onSearchFocus, onSearchBlur, onChooseProduct, onRemove |
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
| StatementPrintDeps | src/features/statements/infrastructure/statementPrint.ts:8 | interface | direct-properties-only | companyInfo, partners, allItems, balance |
| Input | src/features/statements/domain/statementDraft.ts:6 | interface | direct-properties-only | identity, tradeDate, type, partnerId, partnerName, orderIds, memo, totals, partySnapshot, lines, allItems |
| Input | src/features/statements/infrastructure/statementExcel.ts:4 | interface | direct-properties-only | type, docNo, dateLabel, tradeDate, partnerName, items, totals |
| QuickItemMetrics | src/features/statements/domain/quickItemModel.ts:4 | type-alias | direct-properties-only | supply, tax, marginRate, unitSupply, showUnitSupply |
| Props | components/CashLedger.tsx:24 | interface | direct-properties-only | returnOperations, advanceStatements, companyId, cashAccounts, cashEntries, accountCodes, fixedCostTemplates, partners, issuedStatements, settlements, currentUser, onAddCashAccount, onUpdateCashAccount, onCorrectCashAccount, onAddCashEntry, onDeleteCashEntry, onAddSettlement, onDeleteSettlement |
| EntryAttempt | components/CashLedger.tsx:402 | type-alias | direct-properties-only | companyId, userId, entries |
| AccountModalProps | components/CashLedger.tsx:971 | interface | direct-properties-only | companyId, accounts, cashEntries, onClose, onAdd, onUpdate, onCorrect, onAddEntry |
| TradeStatementProps | components/TradeStatement.tsx:99 | interface | direct-properties-only | orderUnitInputs, returnOperations, advanceStatements, orders, allItems, partners, partnerItems, accountCodes, accountGroups, cashAccounts, cashEntries, settlements, onAddCashEntry, onIssueCashEntry, onUpdateCashEntry, onMatchCashAllocations, onResumeCashMutation, onAddSettlement, onUpdateSettlement, onDeleteCashEntry, onDeleteSettlement, onAddCashAccount, onUpdateCashAccount, fixedCostTemplates, onGenerateRecurringCosts, onAddFixedCostTemplate, onUpdateFixedCostTemplate, onDeleteFixedCostTemplate, voucherMode, embedded, issuedStatements, onUpdateStatus, onUpsertPartnerItem, onAddIssuedStatement, onApplyStatement, companyId, onUpdateIssuedStatement, onProposeEdit, focusDocNo, onFocusHandled, detailStatementId, onDetailClose, onDeleteIssuedStatement, pendingInvoice, onClearPendingInvoice, composerOnly, onComposerClose, purchaseUnitOrders, confirmedOrders, orderRequests, onAddConfirmedOrder, onRemoveConfirmedOrder, onRemoveOrderRequest, companyInfo, onSaveCompanyInfo, onUpdateItemCost, onUpdateOrder, currentUserId, defaultTab, expensePresets, onAddExpensePreset, onDeleteExpensePreset |
| StatementType | components/TradeStatement.tsx:184 | type-alias | non-object-alias-not-expanded |  |
| Period | src/shared/ui/PeriodPicker.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| PeriodPickerProps | src/shared/ui/PeriodPicker.tsx:20 | interface | direct-properties-only | period, setPeriod, years, selectedYear, setSelectedYear, selectedQuarter, setSelectedQuarter, selectedHalf, setSelectedHalf, customStart, setCustomStart, customEnd, setCustomEnd, quarterAvailable, halfAvailable, yearlyAvailable, 당월, alwaysShowDates |
| LedgerTone | src/shared/ui/LedgerCard.tsx:22 | type-alias | non-object-alias-not-expanded |  |
| CostManagerProps | components/CostManager.tsx:6 | interface | direct-properties-only | fixedCosts, fixedCostTemplates, issuedStatements, accountCodes, onAdd, onDelete, onAddTemplate, onUpdateTemplate, onDeleteTemplate, onGenerateRecurringCosts |
| PartnerMonthlyRow | src/features/admin/partnerMonthlySettlement.ts:5 | interface | direct-properties-only | partnerId, opening, sales, cashReceived, cashRefunded, nonCashDecrease, receivableIncrease, closing, discrepancy |
| NamedSettlementRow | src/features/admin/partnerMonthlyPdf.ts:11 | type-alias | non-object-alias-not-expanded |  |
| InventoryValuationItem | functions/src/shared/inventoryValuation.ts:1 | interface | direct-properties-only | id, companyId, type, stock, cost |
| InventoryValuationLine | functions/src/shared/inventoryValuation.ts:9 | interface | direct-properties-only | id, stock, cost, value |
| CompanyInventoryValuation | functions/src/shared/inventoryValuation.ts:16 | interface | direct-properties-only | basis, companyId, rawValue, value, lines |
| MainTab | components/ProfitAnalysis.tsx:33 | type-alias | non-object-alias-not-expanded |  |
| ProfitAnalysisProps | components/ProfitAnalysis.tsx:35 | interface | direct-properties-only | returnOperations, advanceStatements, issuedStatements, fixedCostTemplates, onAddTemplate, onUpdateTemplate, onDeleteTemplate, partners, items, costOf, onUpdateIssuedStatement, accountGroups, accountCodes, onUpdateAccountCode, onAddAccountCode, onDeleteAccountCode, onAddAccountGroup, onUpdateAccountGroup, onDeleteAccountGroup, inventorySnapshots, onSaveInventorySnapshot, onGenerateRecurringCosts, cashFlowManual, onSaveCashFlowManual, cashEntries, onAddCashEntry, settlements, companyId, initialTab |
| AccountTally | src/shared/journal.ts:35 | interface | direct-properties-only | accountCode, debit, credit |
| TrialBalanceRow | src/shared/journal.ts:60 | interface | direct-properties-only | accountCode, name, type, debit, credit, balance |
| TrialBalance | src/shared/journal.ts:65 | interface | direct-properties-only | rows, totalDebit, totalCredit, balanced |
| IncomeStatement | src/shared/journal.ts:112 | interface | direct-properties-only | revenue, expense, netIncome |
| BalanceSheet | src/shared/journal.ts:122 | interface | direct-properties-only | asset, liability, equity, netIncome, balanced |
| OpeningDoc | components/FinancialReports.tsx:17 | interface | direct-properties-only | id, date, amounts, hasLoanOpening, hasCashOpening, hasInventoryOpening |
| Props | components/FinancialReports.tsx:19 | interface | direct-properties-only | companyId, statements, cashEntries, accounts, onAddAccountCode, cashAccounts, partners, items, inventorySnapshots |
| Props | components/LoanManager.tsx:17 | interface | direct-properties-only | companyId, cashEntries, cashAccounts, partners, currentUserName, onAddCashEntry |
| Props | components/PartnerAdvanceModal.tsx:11 | type-alias | direct-properties-only | companyId, partnerId, partnerName, onClose |
| ComposerProps | components/PartnerLedger.tsx:19 | type-alias | non-object-alias-not-expanded |  |
| Props | components/PartnerLedger.tsx:21 | interface | direct-properties-only | partners, accountGroups, fixedCostTemplates, onAddCashEntry, onIssueCashEntry, onAddIssuedStatement, onAddFixedCostTemplate, advanceStatements, returnOperations, companyId, issuedStatements, cashEntries, cashAccounts, accountCodes, settlements, onOpenVoucher |
| AdminAppProps | src/features/admin/AdminApp.tsx:254 | interface | direct-properties-only | currentUser, companyId, isAdmin, isAdminAuthenticated, onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData, onPreviewStaff, onExitPreview |
| NewOrderDraft | src/features/admin/AdminApp.tsx:1427 | type-alias | non-object-alias-not-expanded |  |
| RightRow | src/features/admin/AdminApp.tsx:3170 | type-alias | direct-properties-only | 상호, 품목, spec, 수량, 소비기한, 제조일자, orderItems |
| UsageRow | src/features/admin/AdminApp.tsx:3750 | type-alias | direct-properties-only | date, received, used, note, type, id, createdAt, targetKg, addedBy, orderId |
| StaffAppProps | src/features/staff/StaffApp.tsx:23 | interface | direct-properties-only | currentUser, companyId, isAdminAuthenticated, onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData, onExitPreview |
| Window | src/global.d.ts:3 | interface | direct-properties-only | __chunkErrorHandled |
| AppAlert | src/shared/components/AppAlertHost.tsx:5 | interface | direct-properties-only | id, title, message, tone |
| LoginResponse | src/shared/employeeAuth.ts:7 | type-alias | direct-properties-only | customToken, employee |
| LoginApp | src/shared/employeeAuth.ts:9 | type-alias | non-object-alias-not-expanded |  |
| AuthPageProps | src/shared/components/AuthPage.tsx:6 | interface | direct-properties-only | onLogin, app |
| PartnerPortalProps | components/PartnerPortal.tsx:18 | interface | direct-properties-only | partners, items, partnerItems, onOrderSubmit, onExit |
| Row | functions/src/oemBatchCostInvalidation.ts:3 | type-alias | non-object-alias-not-expanded |  |
| OemCostInvalidationWrite | functions/src/oemBatchCostInvalidation.ts:4 | type-alias | direct-properties-only | ref, patch |
| Row | functions/src/statementCreationReceipt.ts:4 | type-alias | non-object-alias-not-expanded |  |
| Claim | functions/src/partnerPaymentPlan.ts:3 | type-alias | direct-properties-only | id, companyId, partnerId, tradeDate, amount, accountCode |
| PaymentCash | functions/src/partnerPaymentPlan.ts:7 | type-alias | direct-properties-only | id, companyId, partnerId, parts |
| PaymentSettlement | functions/src/partnerPaymentPlan.ts:11 | type-alias | direct-properties-only | id, statementId, cashEntryId, amount |
| ReturnApplication | functions/src/partnerPaymentPlan.ts:12 | type-alias | direct-properties-only | id, companyId, partnerId, statementId, amount |
| PaymentPlanInput | functions/src/partnerPaymentPlan.ts:13 | type-alias | direct-properties-only | companyId, partnerId, direction, amount, pin, allocations, claims, cashEntries, settlements |
| PaymentPlan | functions/src/partnerPaymentPlan.ts:18 | type-alias | direct-properties-only | lines, applications, settlements, ignoredOrphanSettlementIds |
| Row | functions/src/shared/returnClaimProjection.ts:3 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/returnClaimReader.ts:4 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/shared/partnerAdvanceReceipt.ts:4 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/partnerAdvanceClaimReader.ts:6 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/partnerPaymentCommand.ts:14 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/partnerPaymentCommand.ts:15 | type-alias | direct-properties-only | operationId, tradeDate, partnerId, direction, amount, cashAccountId, pin, allocations, expectedRevision, releaseId, note |
| Row | functions/src/partnerAdvanceReader.ts:5 | type-alias | non-object-alias-not-expanded |  |
| PartnerAdvanceSnapshot | functions/src/partnerAdvanceReader.ts:28 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/partnerAdvanceCommand.ts:13 | type-alias | non-object-alias-not-expanded |  |
| AdvanceWriteScope | functions/src/partnerAdvanceCommand.ts:19 | type-alias | direct-properties-only | companyId, partnerId, counter, counterState, last, initialLast, revision, revisionAfter, date, releaseId |
| PreparedAdvanceMutation | functions/src/partnerAdvanceCommand.ts:20 | type-alias | direct-properties-only | statement, operation, statementRef, operationRef |
| Row | functions/src/deleteIssuedStatementCommand.ts:11 | type-alias | non-object-alias-not-expanded |  |
| Link | functions/src/deleteIssuedStatementCommand.ts:12 | type-alias | direct-properties-only | kind, id, data |
| Input | functions/src/deleteIssuedStatementCommand.ts:13 | type-alias | direct-properties-only | operationId, statementId, releaseId, expectedRevision, expectedOriginalHash |
| Kind | functions/src/voucherIssue.ts:13 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/voucherIssue.ts:14 | type-alias | direct-properties-only | kind, operationId, tradeDate, prefix, document, releaseId |
| LoanSnapshot | functions/src/loanMovementPlan.ts:2 | type-alias | direct-properties-only | id, companyId, accountCode, openingDate, openingPrincipal |
| LoanCash | functions/src/loanMovementPlan.ts:6 | type-alias | direct-properties-only | id, companyId, loanId, date, createdAt, dir, amount, accountCode, lines |
| LoanMovementRequest | functions/src/loanMovementPlan.ts:12 | type-alias | direct-properties-only | action, principal, interest |
| LoanMovementPlan | functions/src/loanMovementPlan.ts:13 | type-alias | direct-properties-only | balanceBefore, balanceAfter, principalDelta, dir, amount, accountCode, lines |
| Row | functions/src/loanMovementCommand.ts:12 | type-alias | non-object-alias-not-expanded |  |
| LoanMovementInput | functions/src/loanMovementCommand.ts:13 | type-alias | direct-properties-only | operationId, loanId, tradeDate, cashAccountId, action, principal, interest, expectedRevision, releaseId, note |
| ScheduledRequest | functions/src/loanMovementCommand.ts:30 | type-alias | direct-properties-only | templateId, yearMonth, loanCode, input |
| Row | functions/src/cancelPendingReturnCommand.ts:4 | type-alias | non-object-alias-not-expanded |  |
| Actor | functions/src/cancelPendingReturnCommand.ts:5 | type-alias | non-object-alias-not-expanded |  |
| PendingReturnCancellationInput | functions/src/cancelPendingReturnCommand.ts:6 | type-alias | direct-properties-only | companyId, requestId, operationId, expectedRequest, reason |
| PendingReturnCancellationResult | functions/src/cancelPendingReturnCommand.ts:8 | type-alias | direct-properties-only | status, requestId, operationId, requestHash |
| CashRow | functions/src/cashMutationPlan.ts:4 | type-alias | non-object-alias-not-expanded |  |
| CashPatch | functions/src/cashMutationPlan.ts:5 | type-alias | direct-properties-only | cashAccountId, amount, date, dir, accountCode, lines, note, partnerId, partnerName |
| Mode | functions/src/payrollVoucher.ts:9 | type-alias | non-object-alias-not-expanded |  |
| Line | functions/src/payrollVoucher.ts:10 | type-alias | direct-properties-only | employeeId, employeeName, base, overtime, allowance, incomeTax, localTax, pension, health, employment, otherDeduct, department, position, note |
| Input | functions/src/payrollVoucher.ts:13 | type-alias | direct-properties-only | yearMonth, payDate, lines, expectedRevision, mode, releaseId, cashAccountId |
| DraftInput | functions/src/payrollVoucher.ts:15 | type-alias | non-object-alias-not-expanded |  |
| AuthClaims | functions/src/cashMutationCommand.ts:18 | type-alias | direct-properties-only | employeeId, companyId, isAdmin |
| TransferCashEdit | functions/src/cashMutationCommand.ts:19 | type-alias | direct-properties-only | counterpartId, expectedRevision, expectedCashHash, patch |
| CashMutationInput | functions/src/cashMutationCommand.ts:20 | type-alias | direct-properties-only | operationId, cashEntryId, action, expectedRevision, expectedCashHash, releaseId, patch, payrollEdit, transferEdit |
| Approval | functions/src/editIssuedStatementCommand.ts:13 | type-alias | direct-properties-only | pendingEditRequestId, pendingEditRequestHash |
| Attempt | functions/src/employeeLogin.ts:12 | type-alias | direct-properties-only | failures, windowStartedAt, blockedUntil |
| 들어온것 | functions/src/extractOrder.ts:37 | interface | direct-properties-only | text, catalog, partners, history, today |
| Row | functions/src/tradeStatementIssue.ts:12 | type-alias | non-object-alias-not-expanded |  |
| Cost | functions/src/tradeStatementIssue.ts:13 | type-alias | direct-properties-only | itemId, price, beforeCost, sourceLineIndex, sourceLineIndices |
| Input | functions/src/tradeStatementIssue.ts:14 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, newPo, costUpdates, releaseId |
| Row | functions/src/oemFeeVoucher.ts:10 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/oemFeeVoucher.ts:11 | type-alias | direct-properties-only | poId, perKg, statement, releaseId |
| Row | functions/src/oemReceiptCommand.ts:8 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/oemReceiptCommand.ts:9 | type-alias | direct-properties-only | poId, operationId, date, returns, bulk, unitPricePerKg, oemCostEvidence, releaseId |
| Result | functions/src/oemReceiptCommand.ts:19 | type-alias | direct-properties-only | status, receivedKg, loss, lotNos |
| Action | functions/src/manualSettlementCommand.ts:10 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/manualSettlementCommand.ts:11 | type-alias | direct-properties-only | operationId, action, partnerId, cashEntryId, statementId, amount, expectedAmount, settlementId, expectedRevision, releaseId |
| Item | functions/src/returnGeneralStockPlan.ts:4 | type-alias | direct-properties-only | id, companyId, type, subtype, rawMaterialName, name, unit, stock, lots |
| ReturnStockInput | functions/src/returnGeneralStockPlan.ts:6 | type-alias | direct-properties-only | operationId, companyId, date, createdAt, partnerId, partnerName, item, quantityDelta, rawTargetExists |
| Item | functions/src/returnRawStockPlan.ts:12 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/returnRawStockPlan.ts:14 | type-alias | direct-properties-only | operationId, requestId, companyId, date, createdAt, partnerId, partnerName, item, quantityDelta, allItems, bomLines, explicitKg, sourceLineIndex |
| Applied | functions/src/returnRawStockPlan.ts:17 | type-alias | direct-properties-only | state, itemData |
| ReturnClaim | functions/src/returnAllocationPlan.ts:4 | type-alias | direct-properties-only | id, companyId, partnerId, direction, tradeDate, amount, cashApplied |
| PriorReturnAllocation | functions/src/returnAllocationPlan.ts:8 | type-alias | direct-properties-only | returnId, statementId, amount |
| ReturnAllocationInput | functions/src/returnAllocationPlan.ts:11 | type-alias | direct-properties-only | returnId, companyId, partnerId, direction, amount, linkedStatementId, claims, priorAllocations |
| Row | functions/src/processReturnCommand.ts:28 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/processReturnCommand.ts:29 | type-alias | direct-properties-only | operationId, returnRequestId, tradeDate, expectedPartnerRevision, releaseId, expectedBusinessHash |
| Allocation | functions/src/manualSettlementBatchCommand.ts:10 | type-alias | direct-properties-only | statementId, amount |
| Input | functions/src/manualSettlementBatchCommand.ts:11 | type-alias | direct-properties-only | operationId, cashEntryId, partnerId, allocations, expectedPartnerRevision, releaseId |
| Claims | functions/src/interCompanyTransferPreparation.ts:8 | type-alias | direct-properties-only | employeeId, companyId, isAdmin |
| Row | functions/src/interCompanyTransferCommand.ts:13 | type-alias | non-object-alias-not-expanded |  |
| Claims | functions/src/interCompanyTransferCommand.ts:14 | type-alias | direct-properties-only | employeeId, companyId, isAdmin |
| Input | functions/src/interCompanyTransferCommand.ts:15 | type-alias | direct-properties-only | operationId, from, to, tradeDate, amount, overKind, fromAccountId, toAccountId, fromPartnerId, toPartnerId, expectedFromRevision, expectedToRevision, releaseId, note |
| Row | functions/src/inventoryOpeningCommand.ts:13 | type-alias | non-object-alias-not-expanded |  |
| InventoryOpeningInput | functions/src/inventoryOpeningCommand.ts:14 | type-alias | direct-properties-only | companyId, date, itemId, quantity, value, releaseId |
| Actor | functions/src/inventoryOpeningCommand.ts:15 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/submitReturnRequestCommand.ts:6 | type-alias | non-object-alias-not-expanded |  |
| ReturnSubmissionInput | functions/src/submitReturnRequestCommand.ts:7 | type-alias | direct-properties-only | companyId, requestId, request |
| ReturnSubmissionResult | functions/src/submitReturnRequestCommand.ts:8 | type-alias | direct-properties-only | status, requestId, actorId, requestHash |
| Row | functions/src/shared/pendingReturnQuantity.ts:2 | type-alias | non-object-alias-not-expanded |  |
| ReturnQuantityUpdate | functions/src/shared/pendingReturnQuantity.ts:3 | type-alias | direct-properties-only | itemId, previousQuantity, quantity |
| Row | functions/src/updatePendingReturnQuantityCommand.ts:7 | type-alias | non-object-alias-not-expanded |  |
| PendingReturnQuantityInput | functions/src/updatePendingReturnQuantityCommand.ts:8 | type-alias | direct-properties-only | companyId, requestId, operationId, updates |
| Actor | functions/src/updatePendingReturnQuantityCommand.ts:9 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/taxIssueCommand.ts:5 | type-alias | non-object-alias-not-expanded |  |
| TaxIssueInput | functions/src/taxIssueCommand.ts:6 | type-alias | direct-properties-only | companyId, operationId, statements, scope, issuedAt |
| OrderRow | functions/src/orderLockRecovery.ts:6 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/orderLockRecovery.ts:7 | type-alias | direct-properties-only | action, orderId, failedOperationId, failedStartedAt, releaseId |
| OrderLockRecoveryResult | functions/src/orderLockRecovery.ts:8 | type-alias | direct-properties-only | status, orderId, failedOperationId, failedStartedAt, inventoryApplied, reason, failureMessage, targetStatus |

## 상속·공용 모델의 정적 필드 보완

JSON resolvedModels는 TypeScript checker가 해석한 상속·Partial·교차 모델의 속성과 원래 선언 위치를 별도로 기록한다. 기존 직접 선언 필드 통계에 합산하지 않는다. 공용체·any·unknown은 완전한 객체 모델로 펼치지 않고 상태를 남긴다. 정적으로 해석된 모델 역시 실제 DB 필드 전체나 동적 쓰기를 증명하지 않는다.

| 모델 | 선언 | 해석 범위 | 정적 필드 수 |
| --- | --- | --- | --- |
| ProductStocktakeRequest | src/shared/productStocktakeAttempt.ts:2 | checker-resolved-properties-only | 10 |
| ProductStocktakeAttempt | src/shared/productStocktakeAttempt.ts:3 | checker-resolved-properties-only | 11 |
| OemCostEvidence | functions/src/shared/oemBatchCost.ts:1 | checker-resolved-properties-only | 5 |
| OemCostScope | functions/src/shared/oemBatchCost.ts:4 | checker-resolved-properties-only | 2 |
| OemCostRow | functions/src/shared/oemBatchCost.ts:5 | checker-resolved-properties-only | 2 |
| OemBatchCostPreview | functions/src/shared/oemBatchCost.ts:6 | checker-resolved-properties-only | 10 |
| OemBatchCostBlocked | functions/src/shared/oemBatchCost.ts:9 | checker-resolved-properties-only | 12 |
| OemBatchCost | functions/src/shared/oemBatchCost.ts:10 | checker-resolved-properties-only | 15 |
| CompanyId | functions/src/shared/rawLot.ts:1 | non-object-model-not-expanded | 0 |
| RawMaterialLot | functions/src/shared/rawLot.ts:3 | checker-resolved-properties-only | 17 |
| LotMixSetting | functions/src/shared/rawLot.ts:36 | checker-resolved-properties-only | 2 |
| PurchaseUnitSnapshot | functions/src/shared/purchaseUnit.ts:4 | checker-resolved-properties-only | 5 |
| ItemPurchaseUnit | functions/src/shared/purchaseUnit.ts:11 | checker-resolved-properties-only | 10 |
| CashProjectionInput | functions/src/shared/cashLineProjection.ts:1 | checker-resolved-properties-only | 5 |
| AutoJournalOptions | src/shared/autoJournal.ts:96 | checker-resolved-properties-only | 1 |
| OpeningBalance | src/shared/autoJournal.ts:329 | checker-resolved-properties-only | 3 |
| StocktakeAnchor | functions/src/shared/rawInventoryCore.ts:35 | checker-resolved-properties-only | 3 |
| RawInventoryState | functions/src/shared/rawInventoryCore.ts:49 | checker-resolved-properties-only | 10 |
| LotChange | functions/src/shared/rawInventoryCore.ts:81 | checker-resolved-properties-only | 8 |
| RawMovementKind | functions/src/shared/rawInventoryCore.ts:98 | non-object-model-not-expanded | 0 |
| RawInventoryMovement | functions/src/shared/rawInventoryCore.ts:109 | checker-resolved-properties-only | 23 |
| ReversalGuard | functions/src/shared/rawInventoryCore.ts:150 | checker-resolved-properties-only | 6 |
| RawInventoryJob | functions/src/shared/rawInventoryCore.ts:160 | checker-resolved-properties-only | 8 |
| RawSourceType | functions/src/shared/rawInventoryCore.ts:176 | non-object-model-not-expanded | 0 |
| CommandBase | functions/src/shared/rawInventoryCore.ts:182 | checker-resolved-properties-only | 9 |
| ReceiveLotInput | functions/src/shared/rawInventoryCore.ts:203 | checker-resolved-properties-only | 6 |
| RawInventoryCommand | functions/src/shared/rawInventoryCore.ts:212 | non-object-model-not-expanded | 0 |
| RawRejectCode | functions/src/shared/rawInventoryCore.ts:227 | non-object-model-not-expanded | 0 |
| RawApplyResult | functions/src/shared/rawInventoryCore.ts:251 | non-object-model-not-expanded | 0 |
| ApplyDeterministic | functions/src/shared/rawInventoryCore.ts:258 | checker-resolved-properties-only | 3 |
| CompanyId | functions/src/shared/partnerAdvance.ts:2 | non-object-model-not-expanded | 0 |
| AdvancePurpose | functions/src/shared/partnerAdvance.ts:3 | checker-resolved-properties-only | 4 |
| IssuedStatementItem | functions/src/shared/partnerAdvance.ts:4 | checker-resolved-properties-only | 10 |
| IssuedStatement | functions/src/shared/partnerAdvance.ts:8 | checker-resolved-properties-only | 8 |
| AdvanceCode | functions/src/shared/partnerAdvance.ts:13 | non-object-model-not-expanded | 0 |
| TargetCode | functions/src/shared/partnerAdvance.ts:14 | non-object-model-not-expanded | 0 |
| SourceKey | functions/src/shared/partnerAdvance.ts:15 | checker-resolved-properties-only | 3 |
| Allocation | functions/src/shared/partnerAdvance.ts:16 | checker-resolved-properties-only | 4 |
| ApplicationMetadata | functions/src/shared/partnerAdvance.ts:17 | checker-resolved-properties-only | 10 |
| CancellationMetadata | functions/src/shared/partnerAdvance.ts:22 | checker-resolved-properties-only | 8 |
| AdvanceStatement | functions/src/shared/partnerAdvance.ts:26 | checker-resolved-properties-only | 8 |
| SourceEvidence | functions/src/shared/partnerAdvance.ts:27 | checker-resolved-properties-only | 8 |
| TargetEvidence | functions/src/shared/partnerAdvance.ts:32 | checker-resolved-properties-only | 8 |
| VerifiedContext | functions/src/shared/partnerAdvance.ts:38 | checker-resolved-properties-only | 8 |
| Claim | functions/src/shared/partnerAdvance.ts:178 | checker-resolved-properties-only | 5 |
| ApplyPartnerAdvanceInput | functions/src/shared/partnerAdvance.ts:218 | checker-resolved-properties-only | 11 |
| CancelPartnerAdvanceInput | functions/src/shared/partnerAdvance.ts:224 | checker-resolved-properties-only | 7 |
| PreparedPartnerAdvance | functions/src/shared/partnerAdvance.ts:229 | checker-resolved-properties-only | 8 |
| OrderItem | src/shared/types.ts:26 | checker-resolved-properties-only | 21 |
| OrderPallet | src/shared/types.ts:70 | checker-resolved-properties-only | 3 |
| DeliveryBox | src/shared/types.ts:76 | checker-resolved-properties-only | 3 |
| PartnerChannel | src/shared/types.ts:82 | non-object-model-not-expanded | 0 |
| PartnerType | src/shared/types.ts:95 | non-object-model-not-expanded | 0 |
| PurchaseItem | src/shared/types.ts:97 | checker-resolved-properties-only | 2 |
| ShipTo | src/shared/types.ts:108 | checker-resolved-properties-only | 3 |
| PartnerItem | src/shared/types.ts:116 | checker-resolved-properties-only | 9 |
| Partner | src/shared/types.ts:150 | checker-resolved-properties-only | 19 |
| OrderSource | src/shared/types.ts:186 | non-object-model-not-expanded | 0 |
| ShipMethod | src/shared/types.ts:198 | non-object-model-not-expanded | 0 |
| InvoiceType | src/shared/types.ts:205 | non-object-model-not-expanded | 0 |
| OrderRawInventoryTrace | src/shared/types.ts:214 | checker-resolved-properties-only | 10 |
| Order | src/shared/types.ts:231 | checker-resolved-properties-only | 46 |
| OrderItemInventoryState | src/shared/types.ts:352 | checker-resolved-properties-only | 11 |
| OrderInventoryAdjustment | src/shared/types.ts:366 | checker-resolved-properties-only | 2 |
| OrderRawCalculationEvidence | src/shared/types.ts:372 | checker-resolved-properties-only | 11 |
| OrderInventorySnapshot | src/shared/types.ts:386 | checker-resolved-properties-only | 8 |
| OrderStatusAudit | src/shared/types.ts:397 | checker-resolved-properties-only | 12 |
| OrderItemEdit | src/shared/types.ts:418 | checker-resolved-properties-only | 5 |
| SubmaterialComponent | src/shared/types.ts:427 | checker-resolved-properties-only | 8 |
| InventoryCategory | src/shared/types.ts:439 | non-object-model-not-expanded | 0 |
| ItemSubtype | src/shared/types.ts:445 | non-object-model-not-expanded | 0 |
| ItemInventoryReservation | src/shared/types.ts:480 | checker-resolved-properties-only | 5 |
| ItemStocktakeAnchor | src/shared/types.ts:489 | checker-resolved-properties-only | 8 |
| Item | src/shared/types.ts:502 | checker-resolved-properties-only | 37 |
| PalletStock | src/shared/types.ts:615 | checker-resolved-properties-only | 6 |
| PalletTransaction | src/shared/types.ts:625 | checker-resolved-properties-only | 10 |
| Post | src/shared/types.ts:639 | checker-resolved-properties-only | 8 |
| FileItem | src/shared/types.ts:650 | checker-resolved-properties-only | 6 |
| CabinetCategory | src/shared/types.ts:661 | checker-resolved-properties-only | 5 |
| CabinetSubCategory | src/shared/types.ts:669 | checker-resolved-properties-only | 6 |
| CabinetDoc | src/shared/types.ts:678 | checker-resolved-properties-only | 12 |
| EmployeeStatus | src/shared/types.ts:694 | non-object-model-not-expanded | 0 |
| AnnualLeave | src/shared/types.ts:696 | checker-resolved-properties-only | 2 |
| Employee | src/shared/types.ts:701 | checker-resolved-properties-only | 15 |
| PayrollLine | src/shared/types.ts:742 | checker-resolved-properties-only | 14 |
| Payroll | src/shared/types.ts:759 | checker-resolved-properties-only | 9 |
| LeaveType | src/shared/types.ts:800 | non-object-model-not-expanded | 0 |
| LeaveStatus | src/shared/types.ts:801 | non-object-model-not-expanded | 0 |
| LeaveModifyRequest | src/shared/types.ts:803 | checker-resolved-properties-only | 5 |
| LeaveRequest | src/shared/types.ts:811 | checker-resolved-properties-only | 16 |
| ChatMessage | src/shared/types.ts:840 | checker-resolved-properties-only | 17 |
| ChatRoom | src/shared/types.ts:880 | checker-resolved-properties-only | 13 |
| RoomNotice | src/shared/types.ts:915 | checker-resolved-properties-only | 5 |
| ViewType | src/shared/types.ts:927 | non-object-model-not-expanded | 0 |
| ProductionRecord | src/shared/types.ts:930 | checker-resolved-properties-only | 12 |
| FixedCostCategory | src/shared/types.ts:946 | non-object-model-not-expanded | 0 |
| FixedCostEntry | src/shared/types.ts:948 | checker-resolved-properties-only | 8 |
| FixedCostTemplate | src/shared/types.ts:959 | checker-resolved-properties-only | 35 |
| StatementLineKind | src/shared/types.ts:1061 | non-object-model-not-expanded | 0 |
| IssuedStatementItem | src/shared/types.ts:1063 | checker-resolved-properties-only | 19 |
| StatementParty | src/shared/types.ts:1101 | checker-resolved-properties-only | 8 |
| StatementPartySnapshot | src/shared/types.ts:1112 | checker-resolved-properties-only | 2 |
| IssuedStatement | src/shared/types.ts:1117 | checker-resolved-properties-only | 24 |
| PaymentMethod | src/shared/types.ts:1178 | non-object-model-not-expanded | 0 |
| PurchaseOrderItem | src/shared/types.ts:1184 | checker-resolved-properties-only | 11 |
| PurchaseOrder | src/shared/types.ts:1200 | checker-resolved-properties-only | 39 |
| CompanyInfo | src/shared/types.ts:1286 | checker-resolved-properties-only | 11 |
| ExpensePreset | src/shared/types.ts:1301 | checker-resolved-properties-only | 5 |
| AppNotification | src/shared/types.ts:1309 | checker-resolved-properties-only | 10 |
| RawMaterialEntry | src/shared/types.ts:1336 | checker-resolved-properties-only | 26 |
| ItemType | src/shared/types.ts:1385 | non-object-model-not-expanded | 0 |
| ItemFormula | src/shared/types.ts:1387 | checker-resolved-properties-only | 5 |
| ItemBom | src/shared/types.ts:1396 | checker-resolved-properties-only | 4 |
| ReturnReason | src/shared/types.ts:1405 | non-object-model-not-expanded | 0 |
| ReturnItem | src/shared/types.ts:1407 | checker-resolved-properties-only | 10 |
| ReturnRequest | src/shared/types.ts:1421 | checker-resolved-properties-only | 19 |
| PendingStatementEdit | src/shared/types.ts:1443 | checker-resolved-properties-only | 12 |
| AccountType | src/shared/types.ts:1467 | non-object-model-not-expanded | 0 |
| AccountCode | src/shared/types.ts:1469 | checker-resolved-properties-only | 9 |
| JournalLine | src/shared/types.ts:1487 | checker-resolved-properties-only | 5 |
| JournalEntry | src/shared/types.ts:1495 | checker-resolved-properties-only | 8 |
| AccountGroupPlLine | src/shared/types.ts:1506 | non-object-model-not-expanded | 0 |
| AccountGroupCfSection | src/shared/types.ts:1508 | non-object-model-not-expanded | 0 |
| AccountGroup | src/shared/types.ts:1510 | checker-resolved-properties-only | 6 |
| CashAccount | src/shared/types.ts:1525 | checker-resolved-properties-only | 10 |
| CashEntry | src/shared/types.ts:1539 | checker-resolved-properties-only | 18 |
| Settlement | src/shared/types.ts:1602 | checker-resolved-properties-only | 5 |
| InventorySnapshot | src/shared/types.ts:1610 | checker-resolved-properties-only | 6 |
| CashFlowManual | src/shared/types.ts:1624 | checker-resolved-properties-only | 10 |
| ProductionSalesLog | src/shared/types.ts:1637 | checker-resolved-properties-only | 11 |
| AdjustmentType | src/shared/types.ts:1657 | non-object-model-not-expanded | 0 |
| AdjustmentStatus | src/shared/types.ts:1658 | non-object-model-not-expanded | 0 |
| AdjustmentRequest | src/shared/types.ts:1660 | checker-resolved-properties-only | 15 |
| RawUnit | functions/src/shared/formula.ts:57 | non-object-model-not-expanded | 0 |
| PendingPurchaseOrderConfirmation | src/shared/services/confirmPendingPurchaseOrderService.ts:14 | checker-resolved-properties-only | 3 |
| AppConfirmOptions | src/shared/components/appDialog.ts:1 | checker-resolved-properties-only | 5 |
| AppPromptOptions | src/shared/components/appDialog.ts:9 | checker-resolved-properties-only | 5 |
| ConfirmRequest | src/shared/components/appDialog.ts:17 | checker-resolved-properties-only | 7 |
| NoticeRequest | src/shared/components/appDialog.ts:18 | checker-resolved-properties-only | 4 |
| PromptRequest | src/shared/components/appDialog.ts:19 | checker-resolved-properties-only | 7 |
| AppDialogRequest | src/shared/components/appDialog.ts:20 | non-object-model-not-expanded | 0 |
| OrderInventoryRecoveryResult | src/shared/services/orderInventoryRecoveryService.ts:6 | checker-resolved-properties-only | 8 |
| PendingOrderInventoryRecovery | src/shared/services/orderInventoryRecoveryService.ts:27 | checker-resolved-properties-only | 7 |
| Props | components/OrderInventoryRecoveryPanel.tsx:5 | checker-resolved-properties-only | 5 |
| Entry | components/OrderInventoryRecoveryPanel.tsx:6 | checker-resolved-properties-only | 5 |
| Row | functions/src/cashMutationReceipt.ts:4 | checker-resolved-properties-only | 0 |
| LedgerCashEntry | functions/src/shared/cashAccountLedger.ts:2 | checker-resolved-properties-only | 8 |
| LedgerCashAccount | functions/src/shared/cashAccountLedger.ts:7 | checker-resolved-properties-only | 5 |
| LedgerRow | functions/src/shared/cashAccountLedger.ts:13 | checker-resolved-properties-only | 4 |
| AccountLedger | functions/src/shared/cashAccountLedger.ts:21 | checker-resolved-properties-only | 7 |
| OpeningCompany | functions/src/shared/financialOpening.ts:4 | non-object-model-not-expanded | 0 |
| OpeningPartnerCode | functions/src/shared/financialOpening.ts:5 | non-object-model-not-expanded | 0 |
| FinancialPartner | functions/src/shared/financialOpening.ts:6 | checker-resolved-properties-only | 3 |
| FinancialLoan | functions/src/shared/financialOpening.ts:7 | checker-resolved-properties-only | 11 |
| FinancialAccount | functions/src/shared/financialOpening.ts:8 | checker-resolved-properties-only | 9 |
| FinancialCash | functions/src/shared/financialOpening.ts:9 | checker-resolved-properties-only | 12 |
| OpeningStatement | functions/src/shared/financialOpening.ts:10 | checker-resolved-properties-only | 13 |
| FinancialOpeningInput | functions/src/financialOpeningCommand.ts:8 | non-object-model-not-expanded | 0 |
| Row | functions/src/financialOpeningCommand.ts:14 | checker-resolved-properties-only | 0 |
| Snapshot | functions/src/financialOpeningCommand.ts:15 | checker-resolved-properties-only | 4 |
| QuerySnapshot | functions/src/financialOpeningCommand.ts:16 | checker-resolved-properties-only | 1 |
| OpeningTx | functions/src/financialOpeningCommand.ts:17 | checker-resolved-properties-only | 1 |
| OpeningStore | functions/src/financialOpeningCommand.ts:18 | checker-resolved-properties-only | 2 |
| FinancialOpeningPending | src/shared/services/financialOpeningCommands.ts:7 | checker-resolved-properties-only | 4 |
| FinancialOpeningDraft | src/shared/services/financialOpeningCommands.ts:8 | non-object-model-not-expanded | 0 |
| LegacyLedgerFields | functions/src/shared/rawInventoryDocument.ts:11 | checker-resolved-properties-only | 9 |
| RawReadSnapshot | functions/src/shared/rawInventoryPrepare.ts:6 | checker-resolved-properties-only | 0 |
| RawCommandRead | functions/src/shared/rawInventoryPrepare.ts:7 | checker-resolved-properties-only | 7 |
| RawPrepareOptions | functions/src/shared/rawInventoryPrepare.ts:13 | checker-resolved-properties-only | 5 |
| CollectionName | src/shared/collections.ts:121 | non-object-model-not-expanded | 0 |
| RawCommandOptions | src/shared/services/rawInventoryService.ts:41 | checker-resolved-properties-only | 6 |
| KstDateRangeUtc | src/shared/day.ts:18 | checker-resolved-properties-only | 2 |
| Command | src/features/admin/returnCommands.ts:8 | checker-resolved-properties-only | 6 |
| Result | src/features/admin/returnCommands.ts:9 | checker-resolved-properties-only | 6 |
| ReturnPending | src/features/admin/returnCommands.ts:98 | checker-resolved-properties-only | 3 |
| ManualSettlementInput | src/features/admin/manualSettlementCommands.ts:6 | checker-resolved-properties-only | 7 |
| Request | src/features/admin/manualSettlementCommands.ts:8 | checker-resolved-properties-only | 10 |
| Result | src/features/admin/manualSettlementCommands.ts:9 | checker-resolved-properties-only | 3 |
| Pending | src/features/admin/manualSettlementCommands.ts:10 | checker-resolved-properties-only | 3 |
| Patch | src/features/admin/cashMutationCommands.ts:6 | checker-resolved-properties-only | 9 |
| PayrollCashEdit | src/features/admin/cashMutationCommands.ts:7 | checker-resolved-properties-only | 4 |
| TransferCashEdit | src/features/admin/cashMutationCommands.ts:8 | checker-resolved-properties-only | 4 |
| PreparedTransferCashEdit | src/features/admin/cashMutationCommands.ts:9 | checker-resolved-properties-only | 3 |
| Command | src/features/admin/cashMutationCommands.ts:27 | checker-resolved-properties-only | 9 |
| Result | src/features/admin/cashMutationCommands.ts:29 | checker-resolved-properties-only | 5 |
| ModalShellProps | src/shared/components/ModalShell.tsx:4 | checker-resolved-properties-only | 9 |
| LargeModalShellProps | src/shared/components/LargeModalShell.tsx:4 | checker-resolved-properties-only | 8 |
| ProductionWorkDocument | src/features/production-documents/domain/productionWorkDocument.ts:5 | checker-resolved-properties-only | 14 |
| ProductionWorkFields | src/features/production-documents/domain/productionWorkDocument.ts:22 | checker-resolved-properties-only | 15 |
| ProductionWorkSource | src/features/production-documents/domain/productionWorkDocument.ts:40 | checker-resolved-properties-only | 7 |
| ProductionWorkDocumentLine | src/features/production-documents/domain/productionWorkDocument.ts:50 | checker-resolved-properties-only | 25 |
| ProductionWorkEvidence | src/features/production-documents/domain/productionWorkDocument.ts:64 | checker-resolved-properties-only | 6 |
| ProductionWorkPrintRow | src/features/production-documents/domain/productionWorkDocument.ts:158 | checker-resolved-properties-only | 3 |
| ProductionWorkDocumentPrintProps | src/features/production-documents/ui/ProductionWorkDocumentPrint.tsx:8 | checker-resolved-properties-only | 2 |
| ProductionWorkDocumentEditorProps | src/features/production-documents/ui/ProductionWorkDocumentEditor.tsx:12 | checker-resolved-properties-only | 4 |
| ProductLotClock | functions/src/shared/productLot.ts:4 | checker-resolved-properties-only | 3 |
| ProductLotTake | functions/src/shared/productLot.ts:73 | checker-resolved-properties-only | 5 |
| StockComponent | functions/src/shared/stockUnitMeasure.ts:3 | checker-resolved-properties-only | 3 |
| CategoryKey | src/shared/taxonomy.ts:19 | non-object-model-not-expanded | 0 |
| TaxonomyRow | src/shared/taxonomy.ts:47 | checker-resolved-properties-only | 7 |
| Taxonomy | src/shared/taxonomy.ts:58 | checker-resolved-properties-only | 6 |
| TypeKey | src/shared/itemTaxonomy.ts:88 | non-object-model-not-expanded | 0 |
| BomLine | src/shared/bomIndex.ts:19 | checker-resolved-properties-only | 3 |
| BomDraftLine | src/shared/bomIndex.ts:36 | checker-resolved-properties-only | 2 |
| BomParentLine | src/shared/bomIndex.ts:42 | checker-resolved-properties-only | 3 |
| BomIndex | src/shared/bomIndex.ts:48 | checker-resolved-properties-only | 0 |
| PackRow | src/shared/packIndex.ts:26 | checker-resolved-properties-only | 2 |
| PackIndex | src/shared/packIndex.ts:31 | checker-resolved-properties-only | 2 |
| BoxLike | src/shared/orderUnits.ts:7 | checker-resolved-properties-only | 1 |
| OrderUnitInputs | src/shared/orderUnits.ts:9 | checker-resolved-properties-only | 2 |
| 묶음갈래 | src/shared/orderUnits.ts:39 | non-object-model-not-expanded | 0 |
| AnchorResult | functions/src/shared/lotAnchor.ts:41 | checker-resolved-properties-only | 3 |
| RawHolderItem | functions/src/shared/rawHolder.ts:4 | checker-resolved-properties-only | 7 |
| ItemReceipt | src/shared/receipt.ts:4 | checker-resolved-properties-only | 12 |
| CompanyClaim | src/shared/companyWriteBoundary.ts:14 | checker-resolved-properties-only | 1 |
| LoanContract | src/shared/loanLedger.ts:6 | checker-resolved-properties-only | 11 |
| LoanMovement | src/shared/loanLedger.ts:20 | checker-resolved-properties-only | 2 |
| CompanyWriteOperation | src/shared/services/firebaseService.ts:600 | non-object-model-not-expanded | 0 |
| ProductionDocumentWrite | src/shared/services/productionWorkDocumentService.ts:9 | checker-resolved-properties-only | 3 |
| ProductionDocumentLineWrite | src/shared/services/productionWorkDocumentService.ts:14 | checker-resolved-properties-only | 3 |
| LedgerEvidence | src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:40 | checker-resolved-properties-only | 38 |
| AlertTone | src/shared/components/AlertModalShell.tsx:21 | non-object-model-not-expanded | 0 |
| Props | src/shared/components/AlertModalShell.tsx:36 | checker-resolved-properties-only | 7 |
| ConfirmModalProps | src/shared/components/ConfirmModal.tsx:13 | checker-resolved-properties-only | 13 |
| LineAmount | functions/src/shared/lineAmount.ts:2 | checker-resolved-properties-only | 3 |
| PurchaseCostFallback | functions/src/shared/purchaseCost.ts:5 | non-object-model-not-expanded | 0 |
| Margin | src/shared/margin.ts:26 | checker-resolved-properties-only | 5 |
| PrintableLine | src/shared/docName.ts:44 | checker-resolved-properties-only | 2 |
| BomCostCtx | src/shared/bomCost.ts:19 | checker-resolved-properties-only | 5 |
| CostFn | src/shared/bomCost.ts:48 | checker-resolved-properties-only | 1 |
| CostCalcRow | src/features/admin/costCalc.ts:18 | checker-resolved-properties-only | 2 |
| CostCalcLine | src/features/admin/costCalc.ts:24 | checker-resolved-properties-only | 7 |
| CostCalcResult | src/features/admin/costCalc.ts:37 | checker-resolved-properties-only | 7 |
| RawUsersDeps | src/shared/rawUsers.ts:28 | checker-resolved-properties-only | 4 |
| RequestBody | src/shared/services/returnRequestSubmission.ts:4 | checker-resolved-properties-only | 0 |
| PendingReturnSubmission | src/shared/services/returnRequestSubmission.ts:5 | checker-resolved-properties-only | 5 |
| CreateCommand | src/shared/services/employeeCommand.ts:7 | checker-resolved-properties-only | 3 |
| ReceiveCommand | src/shared/services/employeeCommand.ts:11 | checker-resolved-properties-only | 5 |
| UnpackPlan | src/shared/canUnpack.ts:36 | checker-resolved-properties-only | 9 |
| UnpackReject | src/shared/canUnpack.ts:60 | non-object-model-not-expanded | 0 |
| UnpackResult | src/shared/canUnpack.ts:68 | non-object-model-not-expanded | 0 |
| UnpackLotMove | src/shared/unpackLots.ts:36 | checker-resolved-properties-only | 6 |
| UnpackLotResult | src/shared/unpackLots.ts:48 | checker-resolved-properties-only | 4 |
| UnpackOutcome | src/shared/services/unpackService.ts:47 | checker-resolved-properties-only | 3 |
| PartnerAdvanceResult | src/features/statements/infrastructure/partnerAdvanceCommands.ts:5 | checker-resolved-properties-only | 3 |
| PendingPartnerAdvance | src/features/statements/infrastructure/partnerAdvanceCommands.ts:6 | checker-resolved-properties-only | 5 |
| Command | src/shared/services/deleteIssuedStatementService.ts:7 | checker-resolved-properties-only | 5 |
| RecurringStatementType | functions/src/shared/recurringVoucher.ts:1 | non-object-model-not-expanded | 0 |
| RecurringSource | functions/src/shared/recurringVoucher.ts:2 | checker-resolved-properties-only | 10 |
| Company | functions/src/autoVoucherDraft.ts:2 | non-object-model-not-expanded | 0 |
| Template | functions/src/autoVoucherDraft.ts:3 | checker-resolved-properties-only | 22 |
| Draft | functions/src/autoVoucherDraft.ts:12 | checker-resolved-properties-only | 5 |
| ScheduledLoanDraft | functions/src/autoVoucherDraft.ts:13 | checker-resolved-properties-only | 8 |
| AutoVoucherDecision | functions/src/autoVoucherDraft.ts:14 | non-object-model-not-expanded | 0 |
| TemplateStatementType | src/shared/templateStatementType.ts:2 | non-object-model-not-expanded | 0 |
| TemplateSource | src/shared/templateStatementType.ts:4 | checker-resolved-properties-only | 4 |
| StatementType | src/shared/statementLines.ts:19 | non-object-model-not-expanded | 0 |
| ManualRow | src/shared/statementLines.ts:22 | checker-resolved-properties-only | 16 |
| LineItem | src/shared/statementLines.ts:32 | checker-resolved-properties-only | 23 |
| ResolvedOrderItem | src/shared/statementLines.ts:143 | checker-resolved-properties-only | 4 |
| OrderLinesInput | src/shared/statementLines.ts:203 | checker-resolved-properties-only | 9 |
| LineTotals | src/shared/statementLines.ts:286 | checker-resolved-properties-only | 4 |
| StatementCommandKind | src/features/statements/domain/statementCommand.ts:21 | non-object-model-not-expanded | 0 |
| StatementCommand | src/features/statements/domain/statementCommand.ts:23 | checker-resolved-properties-only | 15 |
| StatementRejectionCode | src/features/statements/domain/statementCommand.ts:53 | non-object-model-not-expanded | 0 |
| StatementRejection | src/features/statements/domain/statementCommand.ts:60 | checker-resolved-properties-only | 3 |
| StatementWarningCode | src/features/statements/domain/statementCommand.ts:69 | non-object-model-not-expanded | 0 |
| StatementWarning | src/features/statements/domain/statementCommand.ts:73 | checker-resolved-properties-only | 3 |
| StatementCheck | src/features/statements/domain/statementCommand.ts:79 | checker-resolved-properties-only | 3 |
| BuildInput | src/features/statements/domain/statementCommand.ts:86 | checker-resolved-properties-only | 13 |
| TradeStatementDraft | src/features/statements/infrastructure/tradeStatementPending.ts:4 | checker-resolved-properties-only | 5 |
| TradeStatementPending | src/features/statements/infrastructure/tradeStatementPending.ts:5 | checker-resolved-properties-only | 5 |
| TradeStatementIssueInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:8 | checker-resolved-properties-only | 6 |
| PartnerPaymentInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:111 | checker-resolved-properties-only | 8 |
| Request | src/features/statements/infrastructure/issueTradeStatementCommand.ts:143 | checker-resolved-properties-only | 11 |
| PageHeaderProps | src/shared/components/PageHeader.tsx:3 | checker-resolved-properties-only | 3 |
| OrderCreationModalHeaderProps | src/shared/components/OrderCreationModalHeader.tsx:4 | checker-resolved-properties-only | 4 |
| Line | src/shared/orderLine.ts:26 | checker-resolved-properties-only | 1 |
| GroupMark | src/shared/rowGroup.ts:19 | checker-resolved-properties-only | 4 |
| GroupOf | src/shared/rowGroup.ts:27 | checker-resolved-properties-only | 2 |
| PriceRange | src/shared/partnerPrice.ts:40 | checker-resolved-properties-only | 3 |
| ChannelKey | src/shared/channelStyle.ts:15 | non-object-model-not-expanded | 0 |
| ChannelStyle | src/shared/channelStyle.ts:17 | checker-resolved-properties-only | 6 |
| SearchableSelectOption | src/shared/components/SearchableSelect.tsx:24 | checker-resolved-properties-only | 2 |
| SearchableSelectProps | src/shared/components/SearchableSelect.tsx:29 | checker-resolved-properties-only | 7 |
| CompanySettingKind | src/shared/companySettings.ts:10 | non-object-model-not-expanded | 0 |
| DeliveryTimeSlot | src/shared/deliveryTimeSlot.ts:16 | non-object-model-not-expanded | 0 |
| DeliveryOrderingDoc | src/shared/deliveryTimeSlot.ts:18 | checker-resolved-properties-only | 2 |
| OrderActivityRow | src/shared/orderActivityLog.ts:24 | checker-resolved-properties-only | 5 |
| LegacyNoteItem | src/shared/orderNote.ts:18 | checker-resolved-properties-only | 5 |
| NoteOrder | src/shared/orderNote.ts:19 | checker-resolved-properties-only | 3 |
| MigratedNoteOrder | src/shared/orderNote.ts:20 | checker-resolved-properties-only | 3 |
| ShipDeductionRow | src/shared/shipDeduction.ts:41 | checker-resolved-properties-only | 8 |
| OrderListSortKey | src/shared/orderListSort.ts:21 | non-object-model-not-expanded | 0 |
| OrderListHeadSort | src/shared/orderListSort.ts:22 | checker-resolved-properties-only | 2 |
| ListFilterState | src/shared/orderListFilterChips.ts:15 | checker-resolved-properties-only | 12 |
| ListFilterChip | src/shared/orderListFilterChips.ts:32 | checker-resolved-properties-only | 3 |
| Props | components/OrderActivityLogModal.tsx:14 | checker-resolved-properties-only | 7 |
| StatusColumnStyle | src/shared/orderStatusStyle.ts:190 | checker-resolved-properties-only | 4 |
| CalendarDayCountBadgeProps | components/CalendarDayCountBadge.tsx:3 | checker-resolved-properties-only | 1 |
| CalendarViewProps | components/CalendarView.tsx:7 | checker-resolved-properties-only | 3 |
| BadgeVariant | src/shared/components/Badge.tsx:7 | non-object-model-not-expanded | 0 |
| BadgeProps | src/shared/components/Badge.tsx:17 | checker-resolved-properties-only | 3 |
| CompletionStatusControlProps | src/shared/components/CompletionStatusControl.tsx:4 | checker-resolved-properties-only | 5 |
| ModalActionFooterProps | src/shared/components/ModalActionFooter.tsx:3 | checker-resolved-properties-only | 5 |
| OrderEditModalShellProps | components/OrderEditModalShell.tsx:5 | checker-resolved-properties-only | 8 |
| Props | src/shared/components/DateChipButton.tsx:17 | checker-resolved-properties-only | 6 |
| CardDatePickerButtonProps | components/OrdersList.tsx:119 | checker-resolved-properties-only | 6 |
| OrdersListProps | components/OrdersList.tsx:229 | checker-resolved-properties-only | 40 |
| OrderCardProps | components/OrdersList.tsx:295 | checker-resolved-properties-only | 28 |
| OrderSourceGroupProps | components/OrdersList.tsx:336 | checker-resolved-properties-only | 26 |
| DeliveryRowProps | components/OrdersList.tsx:370 | checker-resolved-properties-only | 5 |
| TabType | components/OrdersList.tsx:378 | non-object-model-not-expanded | 0 |
| WorkItem | components/OrdersList.tsx:1696 | checker-resolved-properties-only | 11 |
| Command | src/shared/services/returnRequestCancellation.ts:5 | checker-resolved-properties-only | 4 |
| Result | src/shared/services/returnRequestCancellation.ts:6 | checker-resolved-properties-only | 4 |
| RoleLike | src/shared/partnerRole.ts:17 | checker-resolved-properties-only | 1 |
| ProductModalProps | components/AddItemModal.tsx:19 | checker-resolved-properties-only | 16 |
| SpecUnit | components/AddItemModal.tsx:65 | non-object-model-not-expanded | 0 |
| Props | components/RawMaterialEntryModal.tsx:8 | checker-resolved-properties-only | 8 |
| NamedItem | src/shared/itemSummary.ts:7 | checker-resolved-properties-only | 1 |
| LedgerTrace | src/shared/ledgerTrace.ts:36 | checker-resolved-properties-only | 4 |
| ReturnStockMovement | src/shared/returnStockMovement.ts:3 | checker-resolved-properties-only | 7 |
| ReturnStockOperation | src/shared/returnStockMovement.ts:7 | checker-resolved-properties-only | 12 |
| ItemLedgerKind | src/features/admin/itemLedger.ts:30 | non-object-model-not-expanded | 0 |
| ItemInventoryEntry | src/features/admin/itemLedger.ts:33 | checker-resolved-properties-only | 30 |
| ItemLedgerRow | src/features/admin/itemLedger.ts:53 | checker-resolved-properties-only | 9 |
| ItemLedger | src/features/admin/itemLedger.ts:67 | checker-resolved-properties-only | 8 |
| FilterType | components/RawLedgerList.tsx:10 | non-object-model-not-expanded | 0 |
| Props | components/RawLedgerList.tsx:13 | checker-resolved-properties-only | 11 |
| DayRow | components/RawLedgerList.tsx:53 | checker-resolved-properties-only | 18 |
| Props | components/RawMaterialLotPanel.tsx:12 | checker-resolved-properties-only | 12 |
| LotShipment | components/ProductLotPanel.tsx:5 | checker-resolved-properties-only | 4 |
| Props | components/ProductLotPanel.tsx:12 | checker-resolved-properties-only | 4 |
| TimelineRow | components/LotTimeline.tsx:9 | checker-resolved-properties-only | 10 |
| OemCostInputRow | src/features/admin/oemCostEvidence.ts:5 | checker-resolved-properties-only | 3 |
| ProcessingFee | src/features/admin/oem.ts:33 | checker-resolved-properties-only | 3 |
| OemFeeProductInput | functions/src/shared/oemFeePlan.ts:3 | checker-resolved-properties-only | 4 |
| OemFeeBulkInput | functions/src/shared/oemFeePlan.ts:4 | checker-resolved-properties-only | 2 |
| OemFeeLine | functions/src/shared/oemFeePlan.ts:5 | checker-resolved-properties-only | 9 |
| OemFeePlanInput | functions/src/shared/oemFeePlan.ts:6 | checker-resolved-properties-only | 7 |
| OemReceiptItemChange | src/features/admin/oemReceiptInventory.ts:6 | checker-resolved-properties-only | 5 |
| OemReceiptInventoryInput | src/features/admin/oemReceiptInventory.ts:14 | checker-resolved-properties-only | 8 |
| JobCommandInput | src/shared/services/rawInventoryJob.ts:18 | checker-resolved-properties-only | 2 |
| JobCommandResult | src/shared/services/rawInventoryJob.ts:23 | checker-resolved-properties-only | 2 |
| RunJobOptions | src/shared/services/rawInventoryJob.ts:25 | checker-resolved-properties-only | 2 |
| RunJobOutcome | src/shared/services/rawInventoryJob.ts:30 | checker-resolved-properties-only | 2 |
| OemIssueLine | src/features/admin/oemIssueJob.ts:8 | checker-resolved-properties-only | 3 |
| OemIssueInput | src/features/admin/oemIssueJob.ts:9 | checker-resolved-properties-only | 9 |
| OemIssueDraft | src/features/admin/oemIssueJob.ts:21 | checker-resolved-properties-only | 39 |
| OemIssuePorts | src/features/admin/oemIssueJob.ts:42 | checker-resolved-properties-only | 5 |
| OemFeeStatementWrite | src/features/admin/oemFeeStatement.ts:4 | checker-resolved-properties-only | 4 |
| OemEngineDeps | src/features/admin/oemEngine.ts:33 | checker-resolved-properties-only | 12 |
| StoredOemCostDisplay | src/features/admin/oemReconciliation.ts:8 | non-object-model-not-expanded | 0 |
| Props | components/OemManager.tsx:19 | checker-resolved-properties-only | 13 |
| IssueInput | components/OemManager.tsx:35 | checker-resolved-properties-only | 7 |
| ReceiveInput | components/OemManager.tsx:36 | checker-resolved-properties-only | 6 |
| StoredPending | components/OemManager.tsx:37 | checker-resolved-properties-only | 3 |
| Props | components/CategoryManager.tsx:14 | checker-resolved-properties-only | 4 |
| StockClosingRow | components/ItemList.tsx:183 | checker-resolved-properties-only | 7 |
| StockClosing | components/ItemList.tsx:184 | checker-resolved-properties-only | 6 |
| ItemListProps | components/ItemList.tsx:195 | checker-resolved-properties-only | 55 |
| MainTab | components/ItemList.tsx:271 | non-object-model-not-expanded | 0 |
| FlowTypeFilter | components/ItemList.tsx:311 | non-object-model-not-expanded | 0 |
| FlowStatusFilter | components/ItemList.tsx:312 | non-object-model-not-expanded | 0 |
| InboundSubTab | components/ItemList.tsx:313 | non-object-model-not-expanded | 0 |
| TopTab | components/ItemList.tsx:316 | non-object-model-not-expanded | 0 |
| GroupRow | components/ItemList.tsx:1305 | checker-resolved-properties-only | 4 |
| FlowRow | components/ItemList.tsx:1625 | checker-resolved-properties-only | 9 |
| GridRow | components/ItemList.tsx:3688 | checker-resolved-properties-only | 6 |
| Vouchered | src/shared/statementOrders.ts:24 | checker-resolved-properties-only | 0 |
| PartnerOrdersInput | src/shared/statementOrders.ts:39 | checker-resolved-properties-only | 6 |
| OrderStatusDotProps | src/shared/components/OrderStatusDot.tsx:4 | checker-resolved-properties-only | 2 |
| OrderItemLinesProps | src/shared/components/OrderItemLines.tsx:5 | checker-resolved-properties-only | 3 |
| NewOrderLineInput | src/shared/newOrderDraft.ts:7 | checker-resolved-properties-only | 8 |
| AddOrderModalProps | components/AddOrderModal.tsx:27 | checker-resolved-properties-only | 11 |
| RawExtracted | src/shared/orderExtract.ts:26 | checker-resolved-properties-only | 4 |
| ExtractedLine | src/shared/orderExtract.ts:33 | checker-resolved-properties-only | 5 |
| ExtractResult | src/shared/orderExtract.ts:44 | checker-resolved-properties-only | 6 |
| CatalogItem | src/shared/orderExtract.ts:54 | checker-resolved-properties-only | 3 |
| CatalogPartner | src/shared/orderExtract.ts:55 | checker-resolved-properties-only | 2 |
| HistoryOrder | src/shared/orderExtract.ts:172 | checker-resolved-properties-only | 3 |
| ParsedLine | components/PasteOrderModal.tsx:53 | checker-resolved-properties-only | 5 |
| PasteOrderModalProps | components/PasteOrderModal.tsx:103 | checker-resolved-properties-only | 10 |
| Step | components/PasteOrderModal.tsx:122 | non-object-model-not-expanded | 0 |
| DeliveryGroup | src/shared/deliveryPlan.ts:33 | checker-resolved-properties-only | 3 |
| DayPlan | src/shared/deliveryPlan.ts:41 | checker-resolved-properties-only | 5 |
| DeliveryPlanDoc | src/shared/deliveryPlan.ts:55 | checker-resolved-properties-only | 3 |
| DayRow | src/shared/deliveryPlan.ts:99 | checker-resolved-properties-only | 8 |
| DayListHandlers | components/DeliveryDayList.tsx:24 | checker-resolved-properties-only | 6 |
| Props | components/DeliveryDayList.tsx:39 | checker-resolved-properties-only | 8 |
| DeliveryManagerProps | components/DeliveryManager.tsx:44 | checker-resolved-properties-only | 20 |
| PalletManagerProps | components/PalletManager.tsx:30 | checker-resolved-properties-only | 7 |
| Row | components/PalletManager.tsx:332 | checker-resolved-properties-only | 9 |
| AdminAuthModalProps | components/AdminAuthModal.tsx:6 | checker-resolved-properties-only | 3 |
| AnnualGrantInfo | src/shared/leave.ts:80 | checker-resolved-properties-only | 4 |
| LeaveBalance | src/shared/leave.ts:160 | checker-resolved-properties-only | 10 |
| LeaveActor | src/shared/leave.ts:218 | checker-resolved-properties-only | 2 |
| LeaveManagerProps | components/LeaveManager.tsx:41 | checker-resolved-properties-only | 8 |
| LeaveTab | components/LeaveManager.tsx:53 | non-object-model-not-expanded | 0 |
| OrgDept | components/LeaveManager.tsx:56 | checker-resolved-properties-only | 6 |
| OrgChartConfig | components/LeaveManager.tsx:64 | checker-resolved-properties-only | 3 |
| AdjustmentType | src/shared/adjustmentStyle.ts:9 | non-object-model-not-expanded | 0 |
| 딱지 | src/shared/adjustmentStyle.ts:12 | checker-resolved-properties-only | 2 |
| ConfirmationItemsProps | components/ConfirmationItems.tsx:12 | checker-resolved-properties-only | 6 |
| JournalOilRow | src/shared/salesJournal.ts:18 | checker-resolved-properties-only | 5 |
| JournalSeedRow | src/shared/salesJournal.ts:27 | checker-resolved-properties-only | 5 |
| JournalSalesRow | src/shared/salesJournal.ts:36 | checker-resolved-properties-only | 5 |
| JournalExtraRow | src/shared/salesJournal.ts:45 | checker-resolved-properties-only | 4 |
| SalesJournalData | src/shared/salesJournal.ts:52 | checker-resolved-properties-only | 5 |
| 줄 | src/shared/orderEditGuard.ts:55 | checker-resolved-properties-only | 21 |
| OrderEditVerdict | src/shared/orderEditGuard.ts:149 | non-object-model-not-expanded | 0 |
| OrderItemChange | src/shared/orderItemDiff.ts:15 | checker-resolved-properties-only | 3 |
| DeviceHint | src/shared/deviceLabel.ts:16 | checker-resolved-properties-only | 2 |
| PushResult | src/shared/push.ts:26 | checker-resolved-properties-only | 3 |
| CancellationEvidenceOrder | functions/src/shared/orderCancellationEvidence.ts:2 | checker-resolved-properties-only | 10 |
| LockRecoveryAssessment | functions/src/shared/orderCancellationEvidence.ts:14 | checker-resolved-properties-only | 4 |
| RawUsageKg | src/features/admin/orderRawInventory.ts:12 | checker-resolved-properties-only | 0 |
| OrderRawInventoryDeps | src/features/admin/orderRawInventory.ts:14 | checker-resolved-properties-only | 6 |
| OrderProductLotMutationResult | src/features/admin/orderProductLots.ts:6 | checker-resolved-properties-only | 2 |
| OrderProductLotMutation | src/features/admin/orderProductLots.ts:11 | checker-resolved-properties-only | 2 |
| OrderProductLotDeps | src/features/admin/orderProductLots.ts:78 | checker-resolved-properties-only | 2 |
| OrderItemStockDeps | src/features/admin/orderItemStock.ts:7 | checker-resolved-properties-only | 3 |
| OrderStockReservation | src/features/admin/orderItemStock.ts:17 | checker-resolved-properties-only | 8 |
| CancellationAction | src/features/admin/orderInventoryCancellation.ts:11 | non-object-model-not-expanded | 0 |
| CancellationTicket | src/features/admin/orderInventoryCancellation.ts:109 | checker-resolved-properties-only | 5 |
| CancellationReceipt | src/features/admin/orderInventoryCancellation.ts:113 | checker-resolved-properties-only | 5 |
| CancellationResult | src/features/admin/orderInventoryCancellation.ts:117 | checker-resolved-properties-only | 8 |
| RollbackPlan | src/features/admin/rollbackSummary.ts:15 | checker-resolved-properties-only | 6 |
| OrderDeleteAction | src/features/admin/rollbackSummary.ts:235 | non-object-model-not-expanded | 0 |
| OrderDeleteStage | src/features/admin/rollbackSummary.ts:236 | non-object-model-not-expanded | 0 |
| OrderDeleteProgress | src/features/admin/rollbackSummary.ts:239 | checker-resolved-properties-only | 6 |
| OrderDeletePlan | src/features/admin/rollbackSummary.ts:248 | checker-resolved-properties-only | 12 |
| StockUseChoice | src/features/admin/orderStockEngine.ts:26 | checker-resolved-properties-only | 2 |
| StockUsePlan | src/features/admin/orderStockEngine.ts:32 | checker-resolved-properties-only | 0 |
| OrderStatusChangeContext | src/features/admin/orderStockEngine.ts:34 | checker-resolved-properties-only | 5 |
| PreparedOrderStatusChange | src/features/admin/orderStockEngine.ts:42 | checker-resolved-properties-only | 2 |
| OrderStockEngineDeps | src/features/admin/orderStockEngine.ts:60 | checker-resolved-properties-only | 14 |
| Engine | src/features/admin/orderStockEngine.ts:1009 | checker-resolved-properties-only | 0 |
| StockUseRow | src/features/admin/stockUseRows.ts:18 | checker-resolved-properties-only | 7 |
| StockUseRowState | src/features/admin/stockUseRows.ts:62 | checker-resolved-properties-only | 5 |
| Props | src/features/admin/StockUseModal.tsx:18 | checker-resolved-properties-only | 5 |
| CatalogItemDeleteBlocker | src/features/admin/catalogItemDelete.ts:12 | checker-resolved-properties-only | 3 |
| CatalogItemDeletePlan | src/features/admin/catalogItemDelete.ts:18 | checker-resolved-properties-only | 5 |
| OrderCreationIdentity | src/features/admin/orderCreation.ts:1 | checker-resolved-properties-only | 2 |
| OrderCreationSession | src/features/admin/orderCreation.ts:6 | checker-resolved-properties-only | 2 |
| OrderCreationFollowUp | src/features/admin/orderCreation.ts:11 | checker-resolved-properties-only | 2 |
| OrderCreationResult | src/features/admin/orderCreation.ts:16 | non-object-model-not-expanded | 0 |
| LedgerLotGap | src/shared/ledgerLotCheck.ts:19 | checker-resolved-properties-only | 4 |
| NoticeBoardProps | components/NoticeBoard.tsx:21 | checker-resolved-properties-only | 5 |
| NoticeBlocks | components/NoticeBoard.tsx:29 | checker-resolved-properties-only | 2 |
| MonthPL | src/features/admin/financials.ts:87 | checker-resolved-properties-only | 8 |
| CashFlowDirectLine | src/features/admin/financials.ts:216 | checker-resolved-properties-only | 4 |
| CashFlowDirect | src/features/admin/financials.ts:222 | checker-resolved-properties-only | 11 |
| ItemManagerProps | components/ItemManager.tsx:31 | checker-resolved-properties-only | 23 |
| ChatAttachment | src/shared/chatUpload.ts:14 | checker-resolved-properties-only | 6 |
| PasteLike | src/shared/chatUpload.ts:57 | checker-resolved-properties-only | 2 |
| SharedFileDraft | src/shared/shareInbox.ts:8 | checker-resolved-properties-only | 3 |
| RoomNameLike | src/shared/roomName.ts:13 | checker-resolved-properties-only | 4 |
| Person | src/shared/roomName.ts:23 | checker-resolved-properties-only | 2 |
| NotifyMode | src/shared/notify.ts:6 | non-object-model-not-expanded | 0 |
| NotifyVolume | src/shared/notify.ts:57 | non-object-model-not-expanded | 0 |
| NotifyOpts | src/shared/notify.ts:107 | checker-resolved-properties-only | 7 |
| SharedChatAttempt | src/shared/sharedChatAttempt.ts:4 | checker-resolved-properties-only | 11 |
| MessageAction | src/shared/messageActions.ts:9 | non-object-model-not-expanded | 0 |
| ActionCtx | src/shared/messageActions.ts:11 | checker-resolved-properties-only | 4 |
| Reactions | src/shared/messageReactions.ts:21 | checker-resolved-properties-only | 0 |
| TimestampLike | src/shared/officeTalkTime.ts:1 | checker-resolved-properties-only | 3 |
| OfficeTalkProps | components/OfficeTalk.tsx:51 | checker-resolved-properties-only | 14 |
| OrderLike | src/shared/newOrderAlert.ts:6 | checker-resolved-properties-only | 2 |
| PickOpts | src/shared/newOrderAlert.ts:8 | checker-resolved-properties-only | 3 |
| RoomLike | src/shared/newChatAlert.ts:6 | checker-resolved-properties-only | 7 |
| ChatPickOpts | src/shared/newChatAlert.ts:16 | checker-resolved-properties-only | 3 |
| DocMismatch | src/shared/docOil.ts:319 | checker-resolved-properties-only | 5 |
| DocDropReason | src/shared/docOil.ts:340 | non-object-model-not-expanded | 0 |
| DocDrop | src/shared/docOil.ts:341 | checker-resolved-properties-only | 5 |
| DropOrder | src/shared/docOil.ts:349 | checker-resolved-properties-only | 4 |
| RawDocEntry | src/shared/docOil.ts:437 | checker-resolved-properties-only | 7 |
| RawDocRow | src/shared/docOil.ts:449 | checker-resolved-properties-only | 8 |
| RawDocSheet | src/shared/docOil.ts:460 | checker-resolved-properties-only | 5 |
| Ev | src/shared/docOil.ts:487 | checker-resolved-properties-only | 7 |
| PaymentInput | src/shared/payment.ts:21 | checker-resolved-properties-only | 10 |
| Row | functions/src/shared/partnerAdvanceAudit.ts:1 | checker-resolved-properties-only | 0 |
| ReadonlyAdvanceOperation | src/shared/partnerAdvanceAudit.ts:4 | checker-resolved-properties-only | 2 |
| ReturnAllocationOperation | src/shared/hooks/useReturnAllocationSources.ts:5 | checker-resolved-properties-only | 13 |
| WorkOrderItem | src/shared/hooks/useAppData.ts:26 | checker-resolved-properties-only | 13 |
| AppData | src/shared/hooks/useAppData.ts:50 | checker-resolved-properties-only | 49 |
| AdminData | src/hooks/useAdminData.ts:28 | checker-resolved-properties-only | 2 |
| LoanMovementInput | src/shared/services/recordLoanMovement.ts:6 | checker-resolved-properties-only | 7 |
| Request | src/shared/services/recordLoanMovement.ts:10 | checker-resolved-properties-only | 10 |
| CompanyId | functions/src/shared/taxIssue.ts:1 | non-object-model-not-expanded | 0 |
| IssuedStatement | functions/src/shared/taxIssue.ts:2 | checker-resolved-properties-only | 4 |
| StatementWrite | functions/src/shared/taxIssue.ts:3 | checker-resolved-properties-only | 4 |
| TaxIssueScope | functions/src/shared/taxIssue.ts:7 | non-object-model-not-expanded | 0 |
| TaxIssuePlan | functions/src/shared/taxIssue.ts:9 | checker-resolved-properties-only | 2 |
| TaxIssueCommand | src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:6 | checker-resolved-properties-only | 5 |
| Result | src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:7 | checker-resolved-properties-only | 6 |
| CrossCompanyBom | src/shared/itemCompany.ts:7 | checker-resolved-properties-only | 5 |
| IntegrityArea | src/features/admin/dataIntegrityAudit.ts:23 | non-object-model-not-expanded | 0 |
| IntegritySeverity | src/features/admin/dataIntegrityAudit.ts:24 | non-object-model-not-expanded | 0 |
| IntegrityIssue | src/features/admin/dataIntegrityAudit.ts:25 | checker-resolved-properties-only | 7 |
| IntegrityAuditInput | src/features/admin/dataIntegrityAudit.ts:34 | checker-resolved-properties-only | 13 |
| LedgerMovement | src/features/admin/dataIntegrityAudit.ts:60 | checker-resolved-properties-only | 32 |
| LinePOClassify | src/features/admin/dataIntegrityAudit.ts:121 | checker-resolved-properties-only | 4 |
| RawLedgerExcelSheet | src/features/admin/rawLedgerExcel.ts:1 | checker-resolved-properties-only | 6 |
| FormulaCell | src/features/admin/rawLedgerExcel.ts:18 | checker-resolved-properties-only | 2 |
| RawLedgerExcelValue | src/features/admin/rawLedgerExcel.ts:19 | non-object-model-not-expanded | 0 |
| DashboardLink | components/DashboardLinks.tsx:12 | checker-resolved-properties-only | 4 |
| DashboardProps | components/Dashboard.tsx:26 | checker-resolved-properties-only | 7 |
| StatCardProps | components/Dashboard.tsx:37 | checker-resolved-properties-only | 7 |
| Props | components/BomIntegrityPanel.tsx:10 | checker-resolved-properties-only | 3 |
| AIConsultantProps | components/AIConsultant.tsx:6 | checker-resolved-properties-only | 2 |
| RegionSelectProps | src/shared/components/RegionSelect.tsx:33 | checker-resolved-properties-only | 4 |
| Window | components/AddPartnerModal.tsx:9 | checker-resolved-properties-only | 186 |
| AddPartnerModalProps | components/AddPartnerModal.tsx:14 | checker-resolved-properties-only | 2 |
| PartnerManagerProps | components/PartnerManager.tsx:29 | checker-resolved-properties-only | 4 |
| PayrollCommandInput | src/shared/services/payrollCommands.ts:7 | checker-resolved-properties-only | 4 |
| HRManagerProps | components/HRManager.tsx:45 | checker-resolved-properties-only | 11 |
| MergedItem | src/shared/mergeStatementItems.ts:15 | checker-resolved-properties-only | 7 |
| SplitMerged | src/shared/mergeStatementItems.ts:51 | checker-resolved-properties-only | 2 |
| DocParty | src/shared/docParty.ts:21 | checker-resolved-properties-only | 8 |
| DocPartiesByIdInput | src/shared/docParty.ts:89 | checker-resolved-properties-only | 5 |
| TaxStatementProps | components/TaxStatement.tsx:21 | checker-resolved-properties-only | 5 |
| AdminAccessLike | src/shared/adminAccess.ts:9 | checker-resolved-properties-only | 2 |
| AdminChecklistProps | components/AdminChecklist.tsx:15 | checker-resolved-properties-only | 19 |
| TabType | components/AdminChecklist.tsx:37 | non-object-model-not-expanded | 0 |
| PartnerSignupUser | components/PartnerSignupApproval.tsx:9 | checker-resolved-properties-only | 10 |
| Props | components/PartnerSignupApproval.tsx:22 | checker-resolved-properties-only | 1 |
| DocumentManagerProps | components/DocumentManager.tsx:17 | checker-resolved-properties-only | 4 |
| QuoteLineLike | src/shared/quoteTotals.ts:14 | checker-resolved-properties-only | 5 |
| QuoteTotals | src/shared/quoteTotals.ts:31 | checker-resolved-properties-only | 8 |
| ItemLike | src/shared/itemFilter.ts:8 | checker-resolved-properties-only | 5 |
| FilterOption | src/shared/itemFilter.ts:16 | checker-resolved-properties-only | 3 |
| ItemFilter | src/shared/itemFilter.ts:52 | checker-resolved-properties-only | 3 |
| QuotationLine | components/QuotationManager.tsx:31 | checker-resolved-properties-only | 9 |
| Quotation | components/QuotationManager.tsx:50 | checker-resolved-properties-only | 19 |
| Props | components/QuotationManager.tsx:80 | checker-resolved-properties-only | 8 |
| QrLabelPrintProps | components/QrLabelPrint.tsx:7 | checker-resolved-properties-only | 2 |
| Props | components/SmartStoreAnalytics.tsx:7 | checker-resolved-properties-only | 4 |
| Tab | components/SmartStoreAnalytics.tsx:14 | non-object-model-not-expanded | 0 |
| TabId | components/HaccpChecklist.tsx:111 | non-object-model-not-expanded | 0 |
| OverviewRow | components/HaccpChecklist.tsx:116 | checker-resolved-properties-only | 6 |
| DailyCheckResult | components/HaccpChecklist.tsx:247 | non-object-model-not-expanded | 0 |
| DailyCheckItem | components/HaccpChecklist.tsx:249 | checker-resolved-properties-only | 5 |
| PestRow | components/HaccpChecklist.tsx:368 | checker-resolved-properties-only | 6 |
| StorageZone | components/HaccpChecklist.tsx:473 | checker-resolved-properties-only | 2 |
| TempRow | components/HaccpChecklist.tsx:475 | checker-resolved-properties-only | 5 |
| TempRecord | components/HaccpChecklist.tsx:483 | checker-resolved-properties-only | 11 |
| CCPHeatRow | components/HaccpChecklist.tsx:789 | checker-resolved-properties-only | 13 |
| CCPMetalRow | components/HaccpChecklist.tsx:901 | checker-resolved-properties-only | 12 |
| IncomingRow | components/HaccpChecklist.tsx:1029 | checker-resolved-properties-only | 15 |
| IncomingRecord | components/HaccpChecklist.tsx:1047 | checker-resolved-properties-only | 10 |
| MachineCleanRow | components/HaccpChecklist.tsx:1303 | checker-resolved-properties-only | 9 |
| AreaCleanRow | components/HaccpChecklist.tsx:1315 | checker-resolved-properties-only | 7 |
| CleaningRecord | components/HaccpChecklist.tsx:1325 | checker-resolved-properties-only | 11 |
| SlotTime | components/HaccpChecklist.tsx:1637 | non-object-model-not-expanded | 0 |
| SanitationRow | components/HaccpChecklist.tsx:1639 | checker-resolved-properties-only | 3 |
| SanitationRecord | components/HaccpChecklist.tsx:1645 | checker-resolved-properties-only | 13 |
| PersonalHygieneRow | components/HaccpChecklist.tsx:2470 | checker-resolved-properties-only | 3 |
| PersonalHygieneRecord | components/HaccpChecklist.tsx:2475 | checker-resolved-properties-only | 11 |
| PeriodCycle | components/HaccpChecklist.tsx:3397 | non-object-model-not-expanded | 0 |
| PeriodRow | components/HaccpChecklist.tsx:3399 | checker-resolved-properties-only | 3 |
| PeriodRecord | components/HaccpChecklist.tsx:3405 | checker-resolved-properties-only | 12 |
| ClosingRecord | components/HaccpChecklist.tsx:3976 | checker-resolved-properties-only | 11 |
| BenzopyreneTest | components/BenzopyreneLog.tsx:11 | checker-resolved-properties-only | 11 |
| Props | components/BenzopyreneLog.tsx:28 | checker-resolved-properties-only | 3 |
| Line | functions/src/returnReversalPlan.ts:4 | checker-resolved-properties-only | 12 |
| ReturnItem | functions/src/returnReversalPlan.ts:5 | checker-resolved-properties-only | 4 |
| ReturnRow | functions/src/returnReversalPlan.ts:6 | checker-resolved-properties-only | 8 |
| Source | functions/src/returnReversalPlan.ts:8 | checker-resolved-properties-only | 8 |
| JournalLine | functions/src/returnReversalPlan.ts:10 | checker-resolved-properties-only | 3 |
| Item | functions/src/shared/returnStockKind.ts:3 | checker-resolved-properties-only | 10 |
| ExplicitReturnMoney | src/features/admin/purchaseReturnRequest.ts:94 | checker-resolved-properties-only | 2 |
| DateRangeQuick | src/shared/components/DateRangeFilter.tsx:3 | non-object-model-not-expanded | 0 |
| ReturnManagerProps | components/ReturnManager.tsx:31 | checker-resolved-properties-only | 8 |
| Tab | components/ReturnManager.tsx:42 | non-object-model-not-expanded | 0 |
| ReturnCardProps | components/ReturnManager.tsx:504 | checker-resolved-properties-only | 4 |
| PurchaseReturnRow | src/features/admin/purchaseReturnRows.ts:2 | checker-resolved-properties-only | 8 |
| ReturnTab | components/ReceivingReturnsManager.tsx:16 | non-object-model-not-expanded | 0 |
| ReceivingReturnsManagerProps | components/ReceivingReturnsManager.tsx:18 | checker-resolved-properties-only | 10 |
| ItemFormulaRow | components/ProductionManager.tsx:10 | checker-resolved-properties-only | 4 |
| ProductionManagerProps | components/ProductionManager.tsx:28 | checker-resolved-properties-only | 9 |
| LedgerRow | src/features/admin/cashLedger.ts:17 | checker-resolved-properties-only | 4 |
| AccountLedger | src/features/admin/cashLedger.ts:18 | checker-resolved-properties-only | 7 |
| PartnerHistorySource | src/features/admin/cashLedger.ts:102 | non-object-model-not-expanded | 0 |
| PartnerLedgerRow | src/features/admin/cashLedger.ts:205 | checker-resolved-properties-only | 11 |
| PartnerLedger | src/features/admin/cashLedger.ts:229 | checker-resolved-properties-only | 5 |
| Ev | src/features/admin/cashLedger.ts:267 | checker-resolved-properties-only | 3 |
| ReadonlyReturnOperation | src/features/admin/cashLedger.ts:494 | checker-resolved-properties-only | 6 |
| PartnerCashPart | src/features/admin/cashLedger.ts:591 | checker-resolved-properties-only | 3 |
| SettleState | src/features/admin/voucherMerge.ts:101 | non-object-model-not-expanded | 0 |
| SettleStatus | src/features/admin/voucherMerge.ts:103 | checker-resolved-properties-only | 2 |
| EvidenceType | src/features/statements/domain/evidence.ts:18 | non-object-model-not-expanded | 0 |
| VoucherKind | src/shared/timelineRows.ts:16 | non-object-model-not-expanded | 0 |
| StmtRow | src/shared/timelineRows.ts:19 | checker-resolved-properties-only | 5 |
| PayRow | src/shared/timelineRows.ts:21 | checker-resolved-properties-only | 15 |
| CashRow | src/shared/timelineRows.ts:32 | checker-resolved-properties-only | 11 |
| TimelineRow | src/shared/timelineRows.ts:40 | non-object-model-not-expanded | 0 |
| TimelineFilter | src/shared/timelineRows.ts:122 | checker-resolved-properties-only | 5 |
| TimelineDeps | src/shared/timelineRows.ts:133 | checker-resolved-properties-only | 2 |
| CodeType | src/shared/timelineRows.ts:195 | checker-resolved-properties-only | 1 |
| RowClass | src/shared/timelineRows.ts:197 | checker-resolved-properties-only | 4 |
| TimelineTotals | src/shared/timelineRows.ts:229 | checker-resolved-properties-only | 8 |
| TimelineSortColumn | src/shared/timelineColumnSort.ts:18 | non-object-model-not-expanded | 0 |
| TimelineSort | src/shared/timelineColumnSort.ts:20 | checker-resolved-properties-only | 2 |
| SortOptions | src/shared/timelineColumnSort.ts:67 | checker-resolved-properties-only | 2 |
| PriceSyncLine | src/shared/partnerPriceSync.ts:27 | checker-resolved-properties-only | 13 |
| PriceSyncInput | src/shared/partnerPriceSync.ts:41 | checker-resolved-properties-only | 8 |
| PriceSyncResult | src/shared/partnerPriceSync.ts:67 | checker-resolved-properties-only | 2 |
| StatementLike | src/shared/latestStatement.ts:24 | checker-resolved-properties-only | 4 |
| LatestInput | src/shared/latestStatement.ts:31 | checker-resolved-properties-only | 2 |
| MonthGroup | src/shared/groupByMonth.ts:10 | checker-resolved-properties-only | 2 |
| OrderPickerProps | components/OrderPicker.tsx:29 | checker-resolved-properties-only | 5 |
| PickRow | src/shared/itemPick.ts:15 | checker-resolved-properties-only | 2 |
| PickedLine | src/shared/itemPick.ts:22 | checker-resolved-properties-only | 8 |
| PickResult | src/shared/itemPick.ts:33 | checker-resolved-properties-only | 2 |
| BuildJournalsInput | src/shared/buildJournals.ts:10 | checker-resolved-properties-only | 6 |
| BuildJournalsResult | src/shared/buildJournals.ts:20 | checker-resolved-properties-only | 2 |
| PartnerAnchorOpenStmt | src/features/admin/partnerAnchor.ts:36 | checker-resolved-properties-only | 4 |
| PartnerAnchorRow | src/features/admin/partnerAnchor.ts:45 | checker-resolved-properties-only | 5 |
| PartnerAnchor | src/features/admin/partnerAnchor.ts:56 | checker-resolved-properties-only | 6 |
| AnchorInput | src/features/admin/partnerAnchor.ts:69 | checker-resolved-properties-only | 7 |
| VoucherLedgerInput | src/features/admin/useVoucherLedger.ts:32 | checker-resolved-properties-only | 9 |
| CashEditLineDraft | src/shared/cashEntryEdit.ts:15 | checker-resolved-properties-only | 3 |
| CashEditForm | src/shared/cashEntryEdit.ts:21 | checker-resolved-properties-only | 6 |
| CashModalMode | components/voucher/CashEntryModal.tsx:33 | non-object-model-not-expanded | 0 |
| SettleInput | components/voucher/CashEntryModal.tsx:38 | checker-resolved-properties-only | 5 |
| Props | components/voucher/CashEntryModal.tsx:47 | checker-resolved-properties-only | 19 |
| VoucherDir | src/shared/cashTemplates.tsx:26 | non-object-model-not-expanded | 0 |
| CashTemplate | src/shared/cashTemplates.tsx:56 | checker-resolved-properties-only | 29 |
| SplitMode | src/shared/cashTemplates.tsx:143 | non-object-model-not-expanded | 0 |
| Props | components/voucher/RecurringModal.tsx:20 | checker-resolved-properties-only | 10 |
| VoucherIssuePending | src/features/statements/infrastructure/voucherIssuePending.ts:3 | non-object-model-not-expanded | 0 |
| TransferPartner | src/shared/services/interCompanyTransferService.ts:6 | checker-resolved-properties-only | 5 |
| TransferOptions | src/shared/services/interCompanyTransferService.ts:7 | checker-resolved-properties-only | 3 |
| TransferDraft | src/shared/services/interCompanyTransferService.ts:8 | checker-resolved-properties-only | 12 |
| Command | src/shared/services/interCompanyTransferService.ts:9 | checker-resolved-properties-only | 14 |
| OverKind | src/shared/interCompany.ts:33 | non-object-model-not-expanded | 0 |
| TransferInput | src/shared/interCompany.ts:35 | checker-resolved-properties-only | 13 |
| TransferSplit | src/shared/interCompany.ts:54 | checker-resolved-properties-only | 3 |
| TransferResult | src/shared/interCompany.ts:68 | checker-resolved-properties-only | 3 |
| SplitLine | src/shared/splitEntry.ts:24 | checker-resolved-properties-only | 3 |
| EntryBase | src/shared/splitEntry.ts:27 | checker-resolved-properties-only | 18 |
| SplitInput | src/shared/splitEntry.ts:29 | checker-resolved-properties-only | 5 |
| PayrollInput | src/shared/splitEntry.ts:68 | checker-resolved-properties-only | 7 |
| Props | components/voucher/VoucherComposer.tsx:54 | checker-resolved-properties-only | 22 |
| StatementHistoryKind | src/features/statements/ui/StatementHistoryFilters.tsx:4 | non-object-model-not-expanded | 0 |
| StatementQuickRange | src/features/statements/ui/StatementHistoryFilters.tsx:5 | non-object-model-not-expanded | 0 |
| StatementOrderDateQuick | src/features/statements/ui/StatementOrderDateFilter.tsx:3 | non-object-model-not-expanded | 0 |
| StatementAccountChoice | src/features/statements/ui/StatementHistorySearchFields.tsx:3 | checker-resolved-properties-only | 7 |
| StatementHistoryRowView | src/features/statements/domain/statementHistoryRowView.ts:4 | checker-resolved-properties-only | 13 |
| ExcelListColumn | src/shared/listExcel.ts:1 | checker-resolved-properties-only | 3 |
| ExcelListValue | src/shared/listExcel.ts:2 | non-object-model-not-expanded | 0 |
| StatementQuickItemResult | src/features/statements/ui/StatementQuickItemBar.tsx:6 | checker-resolved-properties-only | 2 |
| Props | src/features/statements/ui/StatementQuickItemBar.tsx:11 | checker-resolved-properties-only | 26 |
| StatementItemPickerRow | src/features/statements/ui/StatementItemPicker.tsx:5 | checker-resolved-properties-only | 2 |
| Props | src/features/statements/ui/StatementItemPicker.tsx:10 | checker-resolved-properties-only | 14 |
| Props | src/features/statements/ui/StatementOrderItemRows.tsx:5 | checker-resolved-properties-only | 9 |
| StatementManualSearchResult | src/features/statements/ui/StatementManualItemRows.tsx:12 | checker-resolved-properties-only | 2 |
| Props | src/features/statements/ui/StatementManualItemRows.tsx:17 | checker-resolved-properties-only | 24 |
| Props | src/features/statements/ui/StatementActionBar.tsx:4 | checker-resolved-properties-only | 16 |
| Props | src/features/statements/ui/StatementSettlementSummary.tsx:4 | checker-resolved-properties-only | 6 |
| Props | src/features/statements/ui/StatementExpensePresetRow.tsx:5 | checker-resolved-properties-only | 9 |
| Props | src/features/statements/ui/StatementDuplicateWarning.tsx:6 | checker-resolved-properties-only | 5 |
| VoucherKind | src/shared/vouchers.ts:23 | non-object-model-not-expanded | 0 |
| VoucherLine | src/shared/vouchers.ts:25 | checker-resolved-properties-only | 3 |
| Voucher | src/shared/vouchers.ts:31 | checker-resolved-properties-only | 12 |
| ArApSide | src/shared/timelineBuild.ts:18 | checker-resolved-properties-only | 2 |
| BuildTimelineInput | src/shared/timelineBuild.ts:20 | checker-resolved-properties-only | 3 |
| Ev | src/shared/timelineBuild.ts:34 | non-object-model-not-expanded | 0 |
| Input | src/features/statements/hooks/useStatementTimeline.ts:15 | checker-resolved-properties-only | 21 |
| VoucherSlipProps | src/shared/VoucherSlip.tsx:23 | checker-resolved-properties-only | 9 |
| Meta | src/features/statements/hooks/useStatementJournal.tsx:8 | checker-resolved-properties-only | 4 |
| StatementPrintDeps | src/features/statements/infrastructure/statementPrint.ts:8 | checker-resolved-properties-only | 4 |
| Input | src/features/statements/domain/statementDraft.ts:6 | checker-resolved-properties-only | 11 |
| Input | src/features/statements/infrastructure/statementExcel.ts:4 | checker-resolved-properties-only | 7 |
| QuickItemMetrics | src/features/statements/domain/quickItemModel.ts:4 | checker-resolved-properties-only | 5 |
| Props | components/CashLedger.tsx:24 | checker-resolved-properties-only | 18 |
| EntryAttempt | components/CashLedger.tsx:402 | checker-resolved-properties-only | 3 |
| AccountModalProps | components/CashLedger.tsx:971 | checker-resolved-properties-only | 8 |
| TradeStatementProps | components/TradeStatement.tsx:99 | checker-resolved-properties-only | 62 |
| StatementType | components/TradeStatement.tsx:184 | non-object-model-not-expanded | 0 |
| Period | src/shared/ui/PeriodPicker.tsx:3 | non-object-model-not-expanded | 0 |
| PeriodPickerProps | src/shared/ui/PeriodPicker.tsx:20 | checker-resolved-properties-only | 18 |
| LedgerTone | src/shared/ui/LedgerCard.tsx:22 | non-object-model-not-expanded | 0 |
| CostManagerProps | components/CostManager.tsx:6 | checker-resolved-properties-only | 10 |
| PartnerMonthlyRow | src/features/admin/partnerMonthlySettlement.ts:5 | checker-resolved-properties-only | 9 |
| NamedSettlementRow | src/features/admin/partnerMonthlyPdf.ts:11 | checker-resolved-properties-only | 10 |
| InventoryValuationItem | functions/src/shared/inventoryValuation.ts:1 | checker-resolved-properties-only | 5 |
| InventoryValuationLine | functions/src/shared/inventoryValuation.ts:9 | checker-resolved-properties-only | 4 |
| CompanyInventoryValuation | functions/src/shared/inventoryValuation.ts:16 | checker-resolved-properties-only | 5 |
| MainTab | components/ProfitAnalysis.tsx:33 | non-object-model-not-expanded | 0 |
| ProfitAnalysisProps | components/ProfitAnalysis.tsx:35 | checker-resolved-properties-only | 29 |
| AccountTally | src/shared/journal.ts:35 | checker-resolved-properties-only | 3 |
| TrialBalanceRow | src/shared/journal.ts:60 | checker-resolved-properties-only | 6 |
| TrialBalance | src/shared/journal.ts:65 | checker-resolved-properties-only | 4 |
| IncomeStatement | src/shared/journal.ts:112 | checker-resolved-properties-only | 3 |
| BalanceSheet | src/shared/journal.ts:122 | checker-resolved-properties-only | 5 |
| OpeningDoc | components/FinancialReports.tsx:17 | checker-resolved-properties-only | 6 |
| Props | components/FinancialReports.tsx:19 | checker-resolved-properties-only | 9 |
| Props | components/LoanManager.tsx:17 | checker-resolved-properties-only | 6 |
| Props | components/PartnerAdvanceModal.tsx:11 | checker-resolved-properties-only | 4 |
| ComposerProps | components/PartnerLedger.tsx:19 | checker-resolved-properties-only | 22 |
| Props | components/PartnerLedger.tsx:21 | checker-resolved-properties-only | 16 |
| AdminAppProps | src/features/admin/AdminApp.tsx:254 | checker-resolved-properties-only | 12 |
| NewOrderDraft | src/features/admin/AdminApp.tsx:1427 | checker-resolved-properties-only | 44 |
| RightRow | src/features/admin/AdminApp.tsx:3170 | checker-resolved-properties-only | 7 |
| UsageRow | src/features/admin/AdminApp.tsx:3750 | checker-resolved-properties-only | 10 |
| StaffAppProps | src/features/staff/StaffApp.tsx:23 | checker-resolved-properties-only | 10 |
| Window | src/global.d.ts:3 | checker-resolved-properties-only | 186 |
| AppAlert | src/shared/components/AppAlertHost.tsx:5 | checker-resolved-properties-only | 4 |
| LoginResponse | src/shared/employeeAuth.ts:7 | checker-resolved-properties-only | 2 |
| LoginApp | src/shared/employeeAuth.ts:9 | non-object-model-not-expanded | 0 |
| AuthPageProps | src/shared/components/AuthPage.tsx:6 | checker-resolved-properties-only | 2 |
| PartnerPortalProps | components/PartnerPortal.tsx:18 | checker-resolved-properties-only | 5 |
| Row | functions/src/oemBatchCostInvalidation.ts:3 | checker-resolved-properties-only | 0 |
| OemCostInvalidationWrite | functions/src/oemBatchCostInvalidation.ts:4 | checker-resolved-properties-only | 2 |
| Row | functions/src/statementCreationReceipt.ts:4 | checker-resolved-properties-only | 0 |
| Claim | functions/src/partnerPaymentPlan.ts:3 | checker-resolved-properties-only | 6 |
| PaymentCash | functions/src/partnerPaymentPlan.ts:7 | checker-resolved-properties-only | 4 |
| PaymentSettlement | functions/src/partnerPaymentPlan.ts:11 | checker-resolved-properties-only | 4 |
| ReturnApplication | functions/src/partnerPaymentPlan.ts:12 | checker-resolved-properties-only | 5 |
| PaymentPlanInput | functions/src/partnerPaymentPlan.ts:13 | checker-resolved-properties-only | 9 |
| PaymentPlan | functions/src/partnerPaymentPlan.ts:18 | checker-resolved-properties-only | 4 |
| Row | functions/src/shared/returnClaimProjection.ts:3 | checker-resolved-properties-only | 0 |
| Row | functions/src/returnClaimReader.ts:4 | checker-resolved-properties-only | 0 |
| Row | functions/src/shared/partnerAdvanceReceipt.ts:4 | checker-resolved-properties-only | 0 |
| Row | functions/src/partnerAdvanceClaimReader.ts:6 | checker-resolved-properties-only | 0 |
| Row | functions/src/partnerPaymentCommand.ts:14 | checker-resolved-properties-only | 0 |
| Input | functions/src/partnerPaymentCommand.ts:15 | checker-resolved-properties-only | 11 |
| Row | functions/src/partnerAdvanceReader.ts:5 | checker-resolved-properties-only | 0 |
| PartnerAdvanceSnapshot | functions/src/partnerAdvanceReader.ts:28 | checker-resolved-properties-only | 0 |
| Row | functions/src/partnerAdvanceCommand.ts:13 | checker-resolved-properties-only | 0 |
| AdvanceWriteScope | functions/src/partnerAdvanceCommand.ts:19 | checker-resolved-properties-only | 10 |
| PreparedAdvanceMutation | functions/src/partnerAdvanceCommand.ts:20 | checker-resolved-properties-only | 4 |
| Row | functions/src/deleteIssuedStatementCommand.ts:11 | checker-resolved-properties-only | 0 |
| Link | functions/src/deleteIssuedStatementCommand.ts:12 | checker-resolved-properties-only | 3 |
| Input | functions/src/deleteIssuedStatementCommand.ts:13 | checker-resolved-properties-only | 5 |
| Kind | functions/src/voucherIssue.ts:13 | non-object-model-not-expanded | 0 |
| Input | functions/src/voucherIssue.ts:14 | checker-resolved-properties-only | 6 |
| LoanSnapshot | functions/src/loanMovementPlan.ts:2 | checker-resolved-properties-only | 5 |
| LoanCash | functions/src/loanMovementPlan.ts:6 | checker-resolved-properties-only | 9 |
| LoanMovementRequest | functions/src/loanMovementPlan.ts:12 | checker-resolved-properties-only | 3 |
| LoanMovementPlan | functions/src/loanMovementPlan.ts:13 | checker-resolved-properties-only | 7 |
| Row | functions/src/loanMovementCommand.ts:12 | checker-resolved-properties-only | 0 |
| LoanMovementInput | functions/src/loanMovementCommand.ts:13 | checker-resolved-properties-only | 10 |
| ScheduledRequest | functions/src/loanMovementCommand.ts:30 | checker-resolved-properties-only | 4 |
| Row | functions/src/cancelPendingReturnCommand.ts:4 | checker-resolved-properties-only | 0 |
| Actor | functions/src/cancelPendingReturnCommand.ts:5 | non-object-model-not-expanded | 0 |
| PendingReturnCancellationInput | functions/src/cancelPendingReturnCommand.ts:6 | checker-resolved-properties-only | 5 |
| PendingReturnCancellationResult | functions/src/cancelPendingReturnCommand.ts:8 | checker-resolved-properties-only | 4 |
| CashRow | functions/src/cashMutationPlan.ts:4 | checker-resolved-properties-only | 0 |
| CashPatch | functions/src/cashMutationPlan.ts:5 | checker-resolved-properties-only | 9 |
| Mode | functions/src/payrollVoucher.ts:9 | non-object-model-not-expanded | 0 |
| Line | functions/src/payrollVoucher.ts:10 | checker-resolved-properties-only | 14 |
| Input | functions/src/payrollVoucher.ts:13 | checker-resolved-properties-only | 7 |
| DraftInput | functions/src/payrollVoucher.ts:15 | checker-resolved-properties-only | 5 |
| AuthClaims | functions/src/cashMutationCommand.ts:18 | checker-resolved-properties-only | 3 |
| TransferCashEdit | functions/src/cashMutationCommand.ts:19 | checker-resolved-properties-only | 4 |
| CashMutationInput | functions/src/cashMutationCommand.ts:20 | checker-resolved-properties-only | 9 |
| Approval | functions/src/editIssuedStatementCommand.ts:13 | checker-resolved-properties-only | 2 |
| Attempt | functions/src/employeeLogin.ts:12 | checker-resolved-properties-only | 3 |
| 들어온것 | functions/src/extractOrder.ts:37 | checker-resolved-properties-only | 5 |
| Row | functions/src/tradeStatementIssue.ts:12 | checker-resolved-properties-only | 0 |
| Cost | functions/src/tradeStatementIssue.ts:13 | checker-resolved-properties-only | 5 |
| Input | functions/src/tradeStatementIssue.ts:14 | checker-resolved-properties-only | 7 |
| Row | functions/src/oemFeeVoucher.ts:10 | checker-resolved-properties-only | 0 |
| Input | functions/src/oemFeeVoucher.ts:11 | checker-resolved-properties-only | 4 |
| Row | functions/src/oemReceiptCommand.ts:8 | checker-resolved-properties-only | 0 |
| Input | functions/src/oemReceiptCommand.ts:9 | checker-resolved-properties-only | 8 |
| Result | functions/src/oemReceiptCommand.ts:19 | checker-resolved-properties-only | 4 |
| Action | functions/src/manualSettlementCommand.ts:10 | non-object-model-not-expanded | 0 |
| Input | functions/src/manualSettlementCommand.ts:11 | checker-resolved-properties-only | 10 |
| Item | functions/src/returnGeneralStockPlan.ts:4 | checker-resolved-properties-only | 9 |
| ReturnStockInput | functions/src/returnGeneralStockPlan.ts:6 | checker-resolved-properties-only | 9 |
| Item | functions/src/returnRawStockPlan.ts:12 | checker-resolved-properties-only | 13 |
| Input | functions/src/returnRawStockPlan.ts:14 | checker-resolved-properties-only | 13 |
| Applied | functions/src/returnRawStockPlan.ts:17 | checker-resolved-properties-only | 2 |
| ReturnClaim | functions/src/returnAllocationPlan.ts:4 | checker-resolved-properties-only | 7 |
| PriorReturnAllocation | functions/src/returnAllocationPlan.ts:8 | checker-resolved-properties-only | 3 |
| ReturnAllocationInput | functions/src/returnAllocationPlan.ts:11 | checker-resolved-properties-only | 8 |
| Row | functions/src/processReturnCommand.ts:28 | checker-resolved-properties-only | 0 |
| Input | functions/src/processReturnCommand.ts:29 | checker-resolved-properties-only | 6 |
| Allocation | functions/src/manualSettlementBatchCommand.ts:10 | checker-resolved-properties-only | 2 |
| Input | functions/src/manualSettlementBatchCommand.ts:11 | checker-resolved-properties-only | 6 |
| Claims | functions/src/interCompanyTransferPreparation.ts:8 | checker-resolved-properties-only | 3 |
| Row | functions/src/interCompanyTransferCommand.ts:13 | checker-resolved-properties-only | 0 |
| Claims | functions/src/interCompanyTransferCommand.ts:14 | checker-resolved-properties-only | 3 |
| Input | functions/src/interCompanyTransferCommand.ts:15 | checker-resolved-properties-only | 14 |
| Row | functions/src/inventoryOpeningCommand.ts:13 | checker-resolved-properties-only | 0 |
| InventoryOpeningInput | functions/src/inventoryOpeningCommand.ts:14 | checker-resolved-properties-only | 6 |
| Actor | functions/src/inventoryOpeningCommand.ts:15 | non-object-model-not-expanded | 0 |
| Row | functions/src/submitReturnRequestCommand.ts:6 | checker-resolved-properties-only | 0 |
| ReturnSubmissionInput | functions/src/submitReturnRequestCommand.ts:7 | checker-resolved-properties-only | 3 |
| ReturnSubmissionResult | functions/src/submitReturnRequestCommand.ts:8 | checker-resolved-properties-only | 4 |
| Row | functions/src/shared/pendingReturnQuantity.ts:2 | checker-resolved-properties-only | 0 |
| ReturnQuantityUpdate | functions/src/shared/pendingReturnQuantity.ts:3 | checker-resolved-properties-only | 3 |
| Row | functions/src/updatePendingReturnQuantityCommand.ts:7 | checker-resolved-properties-only | 0 |
| PendingReturnQuantityInput | functions/src/updatePendingReturnQuantityCommand.ts:8 | checker-resolved-properties-only | 4 |
| Actor | functions/src/updatePendingReturnQuantityCommand.ts:9 | non-object-model-not-expanded | 0 |
| Row | functions/src/taxIssueCommand.ts:5 | checker-resolved-properties-only | 0 |
| TaxIssueInput | functions/src/taxIssueCommand.ts:6 | checker-resolved-properties-only | 5 |
| OrderRow | functions/src/orderLockRecovery.ts:6 | checker-resolved-properties-only | 11 |
| Input | functions/src/orderLockRecovery.ts:7 | checker-resolved-properties-only | 5 |
| OrderLockRecoveryResult | functions/src/orderLockRecovery.ts:8 | checker-resolved-properties-only | 8 |

## 미해석 속성 접근 조사 목록

이 목록은 속성 선언을 해석하지 못한 위치와 수신 객체 타입이다. DB 필드 목록이 아니며 any/unknown·동적/런타임 접근을 실제 소스에서 분류해야 한다. 미해석 숫자 0을 완료 조건으로 바꾸지 않는다.

| 위치 | 식 | 수신 타입 | 미해석 이유 |
| --- | --- | --- | --- |
| functions/src/shared/oemBatchCost.ts:104 | source.companyId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/oemBatchCost.ts:104 | source.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/oemBatchCost.ts:104 | source.sent | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/oemBatchCost.ts:104 | source.date | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/oemBatchCost.ts:104 | source.oemCostEvidence | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/sharedChatMessageService.ts:36 | room.data().participantIds?.includes | any | any-receiver |
| src/shared/releaseGate.ts:2 | gate?.status | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/shared/releaseGate.ts:2 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/releaseGate.ts:3 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/releaseGate.ts:5 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/orderInventoryRecoveryService.ts:23 | ticket.companyId | any | any-receiver |
| src/shared/services/orderInventoryRecoveryService.ts:23 | ticket.orderId | any | any-receiver |
| src/shared/services/orderInventoryRecoveryService.ts:23 | ticket.operationId | any | any-receiver |
| functions/src/cashMutationReceipt.ts:7 | value.toMillis | any | any-receiver |
| functions/src/cashMutationReceipt.ts:7 | value.toMillis | any | any-receiver |
| functions/src/cashMutationReceipt.ts:30 | snapshots[id]?.companyId | any | any-receiver |
| functions/src/cashMutationReceipt.ts:31 | snapshots[id]?.companyId | any | any-receiver |
| functions/src/cashMutationReceipt.ts:32 | snapshots[id]?.transferOperationId | any | any-receiver |
| functions/src/cashMutationReceipt.ts:33 | snapshots[id]?.mutationRevision | any | any-receiver |
| functions/src/cashMutationReceipt.ts:34 | snapshots[id]?.mutationRevision | any | any-receiver |
| functions/src/cashMutationReceipt.ts:39 | before.companyId | any | any-receiver |
| functions/src/cashMutationReceipt.ts:40 | before.mutationRevision | any | any-receiver |
| functions/src/cashMutationReceipt.ts:40 | before.mutationRevision | any | any-receiver |
| functions/src/cashMutationReceipt.ts:42 | before.mutationRevision | any | any-receiver |
| functions/src/cashMutationReceipt.ts:44 | before.mutationRevision | any | any-receiver |
| functions/src/cashMutationReceipt.ts:54 | current.data()?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/releaseGate.ts:9 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/releaseGate.ts:16 | gate?.voucherNotBefore | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/releaseGate.ts:23 | gate?.catchUp | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/releaseGate.ts:25 | catchUp?.tradeDate | any | any-receiver |
| functions/src/releaseGate.ts:26 | catchUp?.fromDate | any | any-receiver |
| functions/src/releaseGate.ts:26 | catchUp.fromDate | any | any-receiver |
| functions/src/releaseGate.ts:27 | catchUp?.companyId | any | any-receiver |
| functions/src/releaseGate.ts:27 | catchUp?.status | any | any-receiver |
| functions/src/financialOpeningCommand.ts:38 | openingSnap.data().companyId | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:38 | openingSnap.data().date | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:41 | openingSnap.data().amounts | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:47 | saved.companyId | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:47 | saved.partnerId | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:47 | saved.tradeDate | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:48 | saved.items?.find((i: { accountCode: string }) => i.accountCode === code)?.total | any | any-receiver |
| functions/src/financialOpeningCommand.ts:48 | saved.items?.find | any | any-receiver |
| functions/src/financialOpeningCommand.ts:48 | saved.items | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:72 | openingData.companyId | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:72 | openingData.date | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:75 | openingData?.amounts | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:81 | voucherSnap.data().companyId | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:81 | voucherSnap.data().totalAmount | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:110 | latest?.companyId | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:135 | latest?.movementRevision | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:139 | latest?.principalBalance | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:163 | voucherSnap.data().companyId | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:163 | voucherSnap.data().totalAmount | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:167 | openingData.companyId | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:168 | openingData?.date | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:168 | openingData.date | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:174 | openingData.hasCashOpening | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:177 | openingData.amounts | Row | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:247 | actor?.token.companyId | Record<string, unknown> \| undefined | property-symbol-unresolved |
| functions/src/financialOpeningCommand.ts:248 | actor.token.isAdmin | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/financialOpeningCommands.ts:22 | d?.operationStatus | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/shared/services/financialOpeningCommands.ts:22 | d.version | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/financialOpeningCommands.ts:22 | d.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/financialOpeningCommands.ts:22 | d.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/financialOpeningCommands.ts:22 | d.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/financialOpeningCommands.ts:34 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:62 | data.lastStocktakeDate | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:62 | data.lastStocktakeDate | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:63 | data.stocktakeAnchor | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:67 | data.lastStocktakeOperationId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:68 | data.version | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:71 | data.id | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:72 | data.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:73 | data.rawItemId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:74 | data.materialSnapshot | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:75 | data.stockKg | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:76 | data.activeLots | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:76 | data.activeLots | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:77 | data.recentDepletedLots | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:77 | data.recentDepletedLots | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:79 | data.revision | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:79 | data.version | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:80 | data.lastProcessedAt | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:80 | data.updatedAt | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:88 | data.commandHash | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:89 | data.effectiveAt | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:89 | data.date | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:90 | data.lotChanges | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:90 | data.lotChanges | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:91 | ch.afterKg | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:91 | ch.kgAfter | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:92 | ch.deltaKg | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:96 | ch.beforeKg | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:98 | ch.lotSnapshot | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:99 | ch.lotId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:99 | data.materialSnapshot | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:99 | data.material | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:100 | ch.supplierName | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:101 | ch.receivedDate | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:101 | data.date | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:104 | data.recordedAt | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryDocument.ts:104 | data.createdAt | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryPrepare.ts:37 | itemData.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryPrepare.ts:45 | itemData.rawMaterialName | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryPrepare.ts:45 | itemData.name | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryPrepare.ts:59 | itemData?.lots | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/rawInventoryPrepare.ts:74 | itemData?.stock | Record<string, any> | property-symbol-unresolved |
| src/shared/services/rawInventoryService.ts:105 | patch.stock | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/oemCancelService.ts:52 | guard?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/oemCancelService.ts:58 | read.guardSnap?.data()?.reverseOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/shared/returnBusinessEvidence.ts:3 | request.linkedStatementId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/returnBusinessEvidence.ts:4 | request.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/returnBusinessEvidence.ts:4 | request.linkedStatementId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/returnBusinessEvidence.ts:4 | request.partnerId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/returnBusinessEvidence.ts:4 | request.returnType | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/returnBusinessEvidence.ts:4 | request.totalAmount | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/returnBusinessEvidence.ts:4 | request.items | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/returnBusinessEvidence.ts:4 | request.payableAccountCode | Record<string, any> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:51 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:69 | details?.operationStatus | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:69 | details.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:70 | details.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:70 | details.returnRequestId | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:76 | data?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:79 | details.requestHash | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:106 | evidence.companyId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:107 | evidence.items | Record<string, any> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:107 | evidence.items | Record<string, any> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:107 | evidence.totalAmount | Record<string, any> | property-symbol-unresolved |
| src/features/admin/returnCommands.ts:107 | evidence.totalAmount | Record<string, any> | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:63 | state?.revision | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:64 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:67 | state?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:80 | failure?.version | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:80 | failure.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:80 | failure.partnerId | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:81 | failure.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:81 | failure.operationRejected | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/manualSettlementCommands.ts:81 | failure.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/cashMutationCommands.ts:18 | claims?.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/features/admin/cashMutationCommands.ts:37 | value.toMillis | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:37 | value.toMillis | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:59 | proof?.version | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:59 | proof.terminalConfirmed | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:59 | proof.status | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:59 | proof.financialWrites | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:60 | proof.companyId | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:60 | proof.actorId | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:60 | proof.operationId | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:61 | proof.cashEntryId | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:61 | proof.command | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:62 | proof.requestHash | any | any-receiver |
| src/features/admin/cashMutationCommands.ts:106 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/cashMutationCommands.ts:130 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/features/admin/cashMutationCommands.ts:134 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/cashMutationCommands.ts:151 | claims?.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/features/admin/cashMutationCommands.ts:186 | claims?.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/features/admin/cashMutationCommands.ts:208 | state?.revision | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/cashMutationCommands.ts:209 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/companyWriteBoundary.ts:28 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/companyWriteBoundary.ts:28 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:105 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:171 | snap.data()?.hasPartnerOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:171 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:171 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:171 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:171 | snap.data()?.date | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:175 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:179 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:180 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:184 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:185 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:189 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:189 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:197 | snap.data()?.hasPartnerOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:198 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:199 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:200 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:207 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:349 | data.cashEntryId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:350 | data.statementId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:352 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:353 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:357 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:360 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:363 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:465 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:499 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:641 | data.companyId | any | any-receiver |
| src/shared/services/firebaseService.ts:680 | currentPo?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:681 | currentPo?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:27 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:29 | header.documentDate | ProductionDocumentWrite | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:30 | header.documentDate | ProductionDocumentWrite | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:30 | header.documentDate | ProductionDocumentWrite | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:31 | header.documentDate | ProductionDocumentWrite | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:70 | current?.revision | DocumentData \| null | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:82 | current?.createdAt | DocumentData \| null | property-symbol-unresolved |
| src/shared/services/productionWorkDocumentService.ts:83 | current?.createdBy | DocumentData \| null | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:21 | p.request.companyId | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:21 | p.request.returnType | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:22 | p.request.totalAmount | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:22 | p.request.totalAmount | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:22 | p.request.status | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:23 | p.request.partnerId | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:23 | p.request.partnerId | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:23 | p.request.items | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:23 | p.request.items | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:50 | d?.version | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:50 | d.operationStatus | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:51 | d.receiptStatus | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:51 | d.terminalConfirmed | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:51 | d.submissionWrites | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:51 | d.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:51 | d.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:52 | d.requestId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:52 | d.actorId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:52 | d.requestHash | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:60 | request.companyId | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:60 | request.partnerId | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:60 | request.items | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:60 | request.items | RequestBody | property-symbol-unresolved |
| src/shared/services/returnRequestSubmission.ts:61 | request.status | RequestBody | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:23 | data.items | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:23 | data.items | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:24 | data.items | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:25 | row.itemId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:26 | row.quantity | Record<string, any> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:26 | row.quantity | Record<string, any> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:26 | row.quantity | Record<string, any> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:29 | data.partnerId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:31 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:33 | data.createdAt | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/employeeCommand.ts:39 | data.createdAt | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/unpackService.ts:249 | previous.request | any | any-receiver |
| src/shared/services/unpackService.ts:249 | previous.targetQty | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof?.version | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof.terminalConfirmed | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof.status | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof.companyId | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof.actorId | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof.requestId | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof.operationId | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof.requestHash | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:52 | proof.command | any | any-receiver |
| src/shared/services/pendingFlowQuantityService.ts:64 | pending?.updates | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.operationId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.partnerId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.releaseId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.date | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.date | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.date | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.date | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.date | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.expectedRevision | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:11 | input.expectedRevision | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.source?.collection | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.source | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.source.id | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.source | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.source.lineKey | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.source | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.statementId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.accountCode | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.amount | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.amount | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.expectedSourceFingerprint | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:12 | input.expectedTargetFingerprint | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:13 | input.applicationStatementId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:13 | input.reason | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:13 | input.reason.trim | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:13 | input.reason | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:13 | input.reason.length | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:13 | input.reason | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof?.version | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.companyId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.partnerId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.operationId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.actorId | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.operationRejected | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.financialWrites | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.commandHash | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.commandHash | any | any-receiver |
| src/features/statements/infrastructure/partnerAdvanceCommands.ts:37 | proof.command | any | any-receiver |
| src/shared/services/deleteIssuedStatementService.ts:9 | value.toMillis | any | any-receiver |
| src/shared/services/deleteIssuedStatementService.ts:9 | value.toMillis | any | any-receiver |
| src/shared/services/deleteIssuedStatementService.ts:23 | row.noncashApplication.kind | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementPending.ts:16 | d?.operationStatus | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:16 | d.version | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:16 | d.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:16 | d.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:16 | d.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:28 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:41 | d?.operationStatus | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:41 | d.version | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:41 | d.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:41 | d.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:41 | d.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:49 | JSON.parse(text).operationId | any | any-receiver |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:60 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:89 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:161 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:179 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:191 | failure?.version | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:191 | failure.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:191 | failure.partnerId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:192 | failure.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:192 | failure.operationRejected | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:192 | failure.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestCancellation.ts:10 | value.toMillis | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:10 | value.toMillis | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:24 | saved.expectedRequest.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/returnRequestCancellation.ts:56 | proof?.version | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:56 | proof.terminalConfirmed | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:56 | proof.status | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:57 | proof.companyId | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:57 | proof.actorId | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:57 | proof.requestId | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:58 | proof.operationId | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:58 | proof.requestHash | any | any-receiver |
| src/shared/services/returnRequestCancellation.ts:59 | proof.command | any | any-receiver |
| components/AddItemModal.tsx:95 | pi.Direction | any | any-receiver |
| components/AddItemModal.tsx:96 | pi.Direction | any | any-receiver |
| components/AddItemModal.tsx:722 | (s as any).spec | any | any-receiver |
| components/AddItemModal.tsx:722 | (s as any).spec | any | any-receiver |
| components/AddItemModal.tsx:775 | cs.name | any | any-receiver |
| components/AddItemModal.tsx:776 | cs.stock | any | any-receiver |
| components/AddItemModal.tsx:844 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:844 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:847 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:847 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:854 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:855 | (p as any).spec | any | any-receiver |
| components/LotTimeline.tsx:35 | parts.year | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.month | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.day | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.hour | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.minute | { [k: string]: string; } | property-symbol-unresolved |
| components/OemManager.tsx:43 | value.jobId | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:43 | value.jobId | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:43 | value.oemPartnerId | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:43 | value.partnerName | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:43 | value.date | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:44 | value.sent | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:44 | value.sent | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:44 | row.material | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:44 | row.kg | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:46 | value.po | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:46 | value.po.id | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:46 | value.po | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:46 | value.po | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:47 | value.date | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:47 | value.unitPricePerKg | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:48 | value.returns | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:48 | value.returns | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:48 | row.itemId | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:48 | row.qty | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:49 | value.bulk | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:49 | value.bulk | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:49 | row.material | Record<string, unknown> | property-symbol-unresolved |
| components/OemManager.tsx:49 | row.kg | Record<string, unknown> | property-symbol-unresolved |
| components/ItemList.tsx:326 | (p?.lots ?? []).length | any | any-receiver |
| components/ItemList.tsx:326 | p?.lots | any | any-receiver |
| components/ItemList.tsx:327 | p.lots | any | any-receiver |
| components/ItemList.tsx:328 | p?.stock | any | any-receiver |
| components/ItemList.tsx:329 | p?.density | any | any-receiver |
| components/ItemList.tsx:329 | p.density | any | any-receiver |
| components/ItemList.tsx:560 | canvas.toBlob | any | any-receiver |
| components/ItemList.tsx:589 | (e as any)?.message | any | any-receiver |
| components/ItemList.tsx:601 | nav.canShare | any | any-receiver |
| components/ItemList.tsx:601 | nav.canShare | any | any-receiver |
| components/ItemList.tsx:602 | nav.share | any | any-receiver |
| components/ItemList.tsx:1134 | value.po?.id | any | any-receiver |
| components/ItemList.tsx:1134 | value.po | any | any-receiver |
| components/ItemList.tsx:1134 | value.po?.companyId | any | any-receiver |
| components/ItemList.tsx:1134 | value.po | any | any-receiver |
| components/ItemList.tsx:1134 | value.po?.poType | any | any-receiver |
| components/ItemList.tsx:1134 | value.po | any | any-receiver |
| components/ItemList.tsx:1134 | value.po?.status | any | any-receiver |
| components/ItemList.tsx:1134 | value.po | any | any-receiver |
| components/ItemList.tsx:1134 | value.po?.oemCancelledAt | any | any-receiver |
| components/ItemList.tsx:1134 | value.po | any | any-receiver |
| components/ItemList.tsx:1134 | value.po?.oemCancelOperationId | any | any-receiver |
| components/ItemList.tsx:1134 | value.po | any | any-receiver |
| components/ItemList.tsx:1135 | value.returns | any | any-receiver |
| components/ItemList.tsx:1135 | value.returns.every | any | any-receiver |
| components/ItemList.tsx:1135 | value.returns | any | any-receiver |
| components/ItemList.tsx:1135 | row.itemId | any | any-receiver |
| components/ItemList.tsx:1135 | row.itemId | any | any-receiver |
| components/ItemList.tsx:1135 | row.qty | any | any-receiver |
| components/ItemList.tsx:1135 | row.qty | any | any-receiver |
| components/ItemList.tsx:1136 | value.bulk | any | any-receiver |
| components/ItemList.tsx:1136 | value.bulk.every | any | any-receiver |
| components/ItemList.tsx:1136 | value.bulk | any | any-receiver |
| components/ItemList.tsx:1136 | row.material | any | any-receiver |
| components/ItemList.tsx:1136 | row.material | any | any-receiver |
| components/ItemList.tsx:1136 | row.kg | any | any-receiver |
| components/ItemList.tsx:1136 | row.kg | any | any-receiver |
| components/ItemList.tsx:1137 | value.returns.length | any | any-receiver |
| components/ItemList.tsx:1137 | value.returns | any | any-receiver |
| components/ItemList.tsx:1137 | value.bulk.length | any | any-receiver |
| components/ItemList.tsx:1137 | value.bulk | any | any-receiver |
| components/ItemList.tsx:1137 | value.unitPricePerKg | any | any-receiver |
| components/ItemList.tsx:1137 | value.unitPricePerKg | any | any-receiver |
| components/ItemList.tsx:1137 | value.date | any | any-receiver |
| components/ItemList.tsx:1137 | value.date | any | any-receiver |
| components/ItemList.tsx:2062 | (e as any).lotChanges?.some | any | any-receiver |
| components/ItemList.tsx:2062 | (e as any).lotChanges | any | any-receiver |
| components/ItemList.tsx:2062 | change.lotId | any | any-receiver |
| components/ItemList.tsx:2064 | (e as any).source?.type | any | any-receiver |
| components/ItemList.tsx:2064 | (e as any).source | any | any-receiver |
| components/ItemList.tsx:2064 | (e as any).source?.id | any | any-receiver |
| components/ItemList.tsx:2064 | (e as any).source | any | any-receiver |
| components/AddOrderModal.tsx:67 | pi.Direction | any | any-receiver |
| components/AddOrderModal.tsx:235 | pi.partnerId | any | any-receiver |
| components/AddOrderModal.tsx:236 | pi.itemId | any | any-receiver |
| src/shared/orderExtract.ts:87 | row.source | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:87 | row.name | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:88 | row.itemId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:95 | row.qty | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:105 | row.isBox | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:105 | row.isBox | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:106 | row.source | Record<string, unknown> | property-symbol-unresolved |
| components/PasteOrderModal.tsx:128 | pi.Direction | any | any-receiver |
| components/PasteOrderModal.tsx:213 | r.partnerId | any | any-receiver |
| components/PasteOrderModal.tsx:213 | r.Direction | any | any-receiver |
| components/PasteOrderModal.tsx:215 | r.itemId | any | any-receiver |
| src/shared/push.ts:97 | e?.message | any | any-receiver |
| src/features/admin/orderItemStock.ts:152 | snapshots[index]!.data()?.stock | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:96 | patch.lots | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:103 | patch.lots | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:128 | value?.state | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:129 | value.id | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:129 | value.orderId | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:129 | value.companyId | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:130 | value.cancellation?.action | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:130 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:130 | value.cancellation?.evidence | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:130 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:131 | value.cancellation?.deleted | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:131 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:210 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:210 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:211 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:273 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:275 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:276 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:292 | write.ref.path | any | any-receiver |
| src/shared/noticeImage.ts:23 | error.code | any | any-receiver |
| components/NoticeBoard.tsx:36 | saved?.post | any | any-receiver |
| components/NoticeBoard.tsx:37 | saved.editing | any | any-receiver |
| components/NoticeBoard.tsx:37 | p.id | any | any-receiver |
| components/NoticeBoard.tsx:37 | p.id | any | any-receiver |
| components/NoticeBoard.tsx:37 | p.id.includes | any | any-receiver |
| components/NoticeBoard.tsx:37 | p.id | any | any-receiver |
| components/NoticeBoard.tsx:37 | p.tag | any | any-receiver |
| components/NoticeBoard.tsx:37 | p.pinned | any | any-receiver |
| components/NoticeBoard.tsx:37 | p.blocks | any | any-receiver |
| components/NoticeBoard.tsx:38 | p.blocks | any | any-receiver |
| components/NoticeBoard.tsx:39 | b?.type | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.text | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.bold | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.bold | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.format | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.format | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.link | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.link | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.link.trim | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.link | any | any-receiver |
| components/NoticeBoard.tsx:40 | b.link | any | any-receiver |
| components/NoticeBoard.tsx:41 | b?.type | any | any-receiver |
| components/NoticeBoard.tsx:42 | b.caption | any | any-receiver |
| components/NoticeBoard.tsx:42 | b.path | any | any-receiver |
| components/NoticeBoard.tsx:42 | b.path.startsWith | any | any-receiver |
| components/NoticeBoard.tsx:42 | b.path | any | any-receiver |
| components/NoticeBoard.tsx:42 | p.id | any | any-receiver |
| components/NoticeBoard.tsx:42 | b.url | any | any-receiver |
| components/NoticeBoard.tsx:42 | b.url | any | any-receiver |
| components/ItemManager.tsx:435 | (pc as any).partnerId | any | any-receiver |
| components/ItemManager.tsx:436 | (pc as any).itemId | any | any-receiver |
| src/shared/notify.ts:86 | (window as any).webkitAudioContext | any | any-receiver |
| src/shared/officeTalkTime.ts:34 | parts.year | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/officeTalkTime.ts:34 | parts.month | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/officeTalkTime.ts:34 | parts.day | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/officeTalkTime.ts:35 | parts.hour | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/officeTalkTime.ts:35 | parts.minute | { [k: string]: string; } | property-symbol-unresolved |
| components/OfficeTalk.tsx:165 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:339 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:366 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:383 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:420 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:467 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:490 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:1258 | user.id | any | any-receiver |
| components/OfficeTalk.tsx:1259 | user.name | any | any-receiver |
| components/OfficeTalk.tsx:1266 | user.name | any | any-receiver |
| components/OfficeTalk.tsx:1267 | user.position | any | any-receiver |
| components/OfficeTalk.tsx:1267 | user.department | any | any-receiver |
| components/OfficeTalk.tsx:1428 | err?.message | any | any-receiver |
| functions/src/shared/partnerAdvanceAudit.ts:7 | statement.noncashApplication | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:8 | operation.status | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:8 | operation.action | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:9 | operation.companyId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:9 | statement.companyId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:9 | operation.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:9 | statement.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:10 | operation.createdBy | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:10 | statement.createdBy | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:10 | operation.statementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:10 | statement.id | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:11 | operation.id | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:11 | meta.operationId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:11 | statement.issueOperationId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:11 | operation.id | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:12 | operation.commandHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:13 | operation.requestHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:14 | operation.requestHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:14 | statement.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:14 | operation.statementHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:14 | statement.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:15 | operation.statementHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:15 | operation.docNo | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:15 | statement.docNo | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:16 | operation.issuePrefix | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:16 | statement.issuePrefix | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:17 | meta.kind | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:17 | operation.action | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:17 | operation.action | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:19 | operation.command | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:20 | command.operationId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:20 | operation.id | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:20 | command.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:20 | operation.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:20 | command.date | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:20 | statement.tradeDate | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:21 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:21 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:21 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:21 | statement.totalAmount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:23 | meta.kind | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:24 | meta.allocations | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:26 | source?.collection | any | any-receiver |
| functions/src/shared/partnerAdvanceAudit.ts:26 | source?.id | any | any-receiver |
| functions/src/shared/partnerAdvanceAudit.ts:26 | source?.lineKey | any | any-receiver |
| functions/src/shared/partnerAdvanceAudit.ts:27 | operation.source | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:27 | allocation.source | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:28 | command.source | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:28 | allocation.source | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:28 | operation.targetStatementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:28 | allocation.statementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:29 | command.statementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:29 | allocation.statementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:29 | command.amount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:29 | allocation.amount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:29 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:29 | allocation.amount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:30 | command.accountCode | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:30 | allocation.accountCode | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:30 | command.expectedSourceFingerprint | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:30 | meta.sourceFingerprints | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:30 | allocation.source | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:31 | command.expectedTargetFingerprint | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:31 | meta.targetFingerprints | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:31 | allocation.statementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:32 | meta.purpose | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:32 | allocation.source | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:32 | allocation.statementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:34 | command.applicationStatementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:34 | meta.applicationStatementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:34 | operation.applicationStatementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:34 | meta.applicationStatementId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:34 | command.reason | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:34 | command.reason | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceAudit.ts:34 | meta.reason | Row | property-symbol-unresolved |
| src/shared/partnerAdvanceAudit.ts:13 | operation.command | ReadonlyAdvanceOperation | property-symbol-unresolved |
| src/shared/partnerAdvanceAudit.ts:13 | operation.createdBy | ReadonlyAdvanceOperation | property-symbol-unresolved |
| src/shared/partnerAdvanceAudit.ts:13 | operation.action | ReadonlyAdvanceOperation | property-symbol-unresolved |
| src/shared/partnerAdvanceAudit.ts:13 | operation.command | ReadonlyAdvanceOperation | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:58 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:60 | contract?.movementRevision | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:73 | failure?.version | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:73 | failure.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:73 | failure.loanId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:74 | failure.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:74 | failure.operationRejected | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/recordLoanMovement.ts:75 | failure.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:10 | value.toMillis | any | any-receiver |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:10 | value.toMillis | any | any-receiver |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:37 | proof?.version | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:37 | proof.operationStatus | Record<string, unknown> | property-symbol-unresolved |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:37 | proof.terminalConfirmed | Record<string, unknown> | property-symbol-unresolved |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:37 | proof.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:37 | proof.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:37 | proof.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:37 | proof.actorId | Record<string, unknown> | property-symbol-unresolved |
| src/features/tax-documents/infrastructure/applyTaxIssueWrites.ts:37 | proof.requestHash | Record<string, unknown> | property-symbol-unresolved |
| components/DashboardLinks.tsx:68 | e?.message | any | any-receiver |
| components/DashboardLinks.tsx:96 | e?.message | any | any-receiver |
| components/Dashboard.tsx:74 | pi.Direction | any | any-receiver |
| src/shared/services/payrollCommands.ts:20 | row?.revision | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/payrollCommands.ts:33 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/payrollCommands.ts:34 | row?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/payrollCommands.ts:36 | row?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| components/MyPage.tsx:141 | (currentUser as any).username | any | any-receiver |
| components/AdminChecklist.tsx:66 | pi.Direction | any | any-receiver |
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
| src/features/admin/purchaseReturnRequest.ts:10 | release?.status | any | any-receiver |
| src/features/admin/purchaseReturnRequest.ts:10 | release.releaseId | any | any-receiver |
| src/features/admin/purchaseReturnRequest.ts:10 | release.releaseId | any | any-receiver |
| src/features/admin/purchaseReturnRequest.ts:11 | returns?.purchaseGeneralStockEnabled | any | any-receiver |
| src/features/admin/purchaseReturnRequest.ts:12 | gate?.companyId | any | any-receiver |
| src/features/admin/purchaseReturnRequest.ts:12 | gate.enabled | any | any-receiver |
| src/features/admin/purchaseReturnRequest.ts:13 | gate.auditPassed | any | any-receiver |
| src/features/admin/purchaseReturnRequest.ts:13 | gate.legacyWritersBlocked | any | any-receiver |
| components/ReturnManager.tsx:240 | pendingSubmission?.request.partnerName | RequestBody \| undefined | property-symbol-unresolved |
| components/ReturnManager.tsx:240 | pendingSubmission?.request.returnType | RequestBody \| undefined | property-symbol-unresolved |
| components/ReturnManager.tsx:241 | pendingSubmission.request.totalAmount.toLocaleString | any | any-receiver |
| components/ReturnManager.tsx:241 | pendingSubmission.request.totalAmount | RequestBody | property-symbol-unresolved |
| components/ReceivingReturnsManager.tsx:265 | pendingSubmission?.request.partnerName | RequestBody \| undefined | property-symbol-unresolved |
| components/ReceivingReturnsManager.tsx:265 | pendingSubmission?.request.returnType | RequestBody \| undefined | property-symbol-unresolved |
| components/ReceivingReturnsManager.tsx:266 | pendingSubmission.request.totalAmount.toLocaleString | any | any-receiver |
| components/ReceivingReturnsManager.tsx:266 | pendingSubmission.request.totalAmount | RequestBody | property-symbol-unresolved |
| components/VoucherTemplateManager.tsx:141 | (t as any).loanCode | any | any-receiver |
| components/VoucherTemplateManager.tsx:395 | (S as any).pick | any | any-receiver |
| src/features/statements/infrastructure/voucherIssuePending.ts:28 | p?.operationStatus | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/voucherIssuePending.ts:28 | p.version | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/voucherIssuePending.ts:28 | p.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/voucherIssuePending.ts:28 | p.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/voucherIssuePending.ts:28 | p.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/interCompanyTransferService.ts:13 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/interCompanyTransferService.ts:17 | command.from | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.to | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.to | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.overKind | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.amount | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.amount | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.expectedFromRevision | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.expectedToRevision | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.operationId | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.operationId | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.releaseId | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.releaseId | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.tradeDate | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.fromPartnerId | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.toPartnerId | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.note | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.note | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.note.length | any | any-receiver |
| src/shared/services/interCompanyTransferService.ts:17 | command.note | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:52 | i.qty | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:118 | item.name | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:119 | item.spec | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:119 | item.purchaseUnitId | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:119 | item.unitKg | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:119 | item.inventoryQty | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:120 | item.purchaseUnit | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:120 | (item as any).unit | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:121 | item.qty | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:122 | item.price | any | any-receiver |
| src/features/statements/infrastructure/statementPrint.ts:123 | item.total | any | any-receiver |
| src/shared/services/confirmedCashBalance.ts:23 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| components/CashLedger.tsx:659 | proof?.operationStatus | Record<string, unknown> \| undefined | property-symbol-unresolved |
| components/CashLedger.tsx:659 | proof.version | Record<string, unknown> | property-symbol-unresolved |
| components/CashLedger.tsx:660 | proof.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| components/CashLedger.tsx:660 | proof.companyId | Record<string, unknown> | property-symbol-unresolved |
| components/CashLedger.tsx:660 | proof.operationId | Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:233 | (item as any).itemId | any | any-receiver |
| components/TradeStatement.tsx:235 | (item as any).partnerId | any | any-receiver |
| components/TradeStatement.tsx:297 | pi.Direction | any | any-receiver |
| components/TradeStatement.tsx:298 | pi.Direction | any | any-receiver |
| components/TradeStatement.tsx:385 | s.Direction | any | any-receiver |
| components/TradeStatement.tsx:385 | s.itemId | any | any-receiver |
| components/TradeStatement.tsx:385 | s.partnerId | any | any-receiver |
| components/TradeStatement.tsx:387 | s.Direction | any | any-receiver |
| components/TradeStatement.tsx:387 | s.itemId | any | any-receiver |
| components/TradeStatement.tsx:387 | s.partnerId | any | any-receiver |
| components/TradeStatement.tsx:402 | error?.message | any | any-receiver |
| components/TradeStatement.tsx:403 | error?.code | any | any-receiver |
| components/TradeStatement.tsx:747 | row.manual | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:747 | row.operationId | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:747 | row.returnOperationId | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:747 | row.transferOperationId | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:748 | row.issueOperationId | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:748 | row.serverOwned | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:1239 | ((st as any).purchaseOrderIds ?? (st as any).confirmedProductIds ?? []).forEach | any | any-receiver |
| components/TradeStatement.tsx:1239 | (st as any).purchaseOrderIds | any | any-receiver |
| components/TradeStatement.tsx:1239 | (st as any).confirmedProductIds | any | any-receiver |
| components/TradeStatement.tsx:1270 | (s as any).itemId | any | any-receiver |
| components/TradeStatement.tsx:1272 | (ps as any).partnerId | any | any-receiver |
| components/TradeStatement.tsx:1874 | e?.message | any | any-receiver |
| components/TradeStatement.tsx:1892 | e?.message | any | any-receiver |
| components/TradeStatement.tsx:2687 | error?.message | any | any-receiver |
| components/TradeStatement.tsx:2862 | (purchaseOrder as any).id | any | any-receiver |
| components/ProfitAnalysis.tsx:392 | payload?.length | any | any-receiver |
| components/ProfitAnalysis.tsx:396 | payload.map | any | any-receiver |
| components/ProfitAnalysis.tsx:397 | p.name | any | any-receiver |
| components/ProfitAnalysis.tsx:398 | p.color | any | any-receiver |
| components/ProfitAnalysis.tsx:399 | p.name | any | any-receiver |
| components/ProfitAnalysis.tsx:400 | p.value | any | any-receiver |
| components/ProfitAnalysis.tsx:591 | d.sales | any | any-receiver |
| components/ProfitAnalysis.tsx:591 | d.operatingProfit | any | any-receiver |
| components/ProfitAnalysis.tsx:591 | d.sales | any | any-receiver |
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
| components/PartnerLedger.tsx:518 | it.name | any | any-receiver |
| components/PartnerLedger.tsx:519 | it.spec | any | any-receiver |
| components/PartnerLedger.tsx:520 | it.qty | any | any-receiver |
| components/PartnerLedger.tsx:521 | it.price | any | any-receiver |
| components/PartnerLedger.tsx:522 | it.supply | any | any-receiver |
| components/PartnerLedger.tsx:523 | it.tax | any | any-receiver |
| components/PartnerLedger.tsx:524 | it.total | any | any-receiver |
| components/PartnerLedger.tsx:544 | i.name | any | any-receiver |
| src/features/admin/AdminApp.tsx:427 | e?.message | any | any-receiver |
| src/features/admin/AdminApp.tsx:601 | (pc as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:602 | (pc as any).partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:994 | e.data?.type | any | any-receiver |
| src/features/admin/AdminApp.tsx:994 | e.data.view | any | any-receiver |
| src/features/admin/AdminApp.tsx:994 | e.data.view | any | any-receiver |
| src/features/admin/AdminApp.tsx:1121 | (s as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1122 | (ps as any)?.partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1184 | (s as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1185 | (ps as any)?.partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:2625 | patch.sortIndex | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/AdminApp.tsx:4703 | error?.message | any | any-receiver |
| src/features/admin/AdminApp.tsx:4713 | error?.message | any | any-receiver |
| src/shared/components/AuthPage.tsx:34 | cause?.code | any | any-receiver |
| functions/src/newScopeCounter.ts:11 | gate.data()?.oemLotCutoverDate | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/newScopeCounter.ts:17 | row?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/newScopeCounter.ts:67 | lot.receivedDate | any | any-receiver |
| functions/src/newScopeCounter.ts:67 | lot.lotNo | any | any-receiver |
| functions/src/newScopeCounter.ts:68 | lot.material | any | any-receiver |
| functions/src/newScopeCounter.ts:68 | lot.material | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:20 | row.oemBatchCost?.feeStatementId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:20 | row.oemBatchCost?.previousConfirmed?.feeStatementId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:20 | row.oemBatchCost?.previousConfirmed | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:24 | cost.status | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:24 | cost.previousConfirmed | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:25 | (confirmed?.allocations ?? []).map | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:25 | confirmed?.allocations | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:25 | row.itemId | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:34 | cost.status | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:34 | cost.previousConfirmed | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:45 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:45 | lot.oemBatchCost.feeStatementId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:45 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:46 | lot.oemBatchCost.poId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:46 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/statementCreationReceipt.ts:12 | current.mutationRevision | Row | property-symbol-unresolved |
| functions/src/statementCreationReceipt.ts:14 | original.mutationRevision | any | any-receiver |
| functions/src/statementCreationReceipt.ts:19 | before.mutationRevision | any | any-receiver |
| functions/src/statementCreationReceipt.ts:20 | before.companyId | any | any-receiver |
| functions/src/statementCreationReceipt.ts:23 | current.mutationRevision | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:13 | journal.id | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:14 | row.operationId | ReturnApplication & Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:20 | row.id | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:21 | row.id | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:21 | operation?.journalId | Row \| undefined | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:22 | row.operationId | ReturnApplication & Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:23 | journal.tradeDate | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:23 | operation.status | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:23 | operation.status | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:24 | operation.journalId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:24 | journal.id | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:24 | journal.returnOperationId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:24 | journal.type | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:25 | operation.companyId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:25 | journal.companyId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:25 | journal.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:25 | operation.journalHash | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:26 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:26 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:26 | journal.totalAmount | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:26 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:27 | operation.applications | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:27 | operation.applications | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:28 | operation.applications | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:28 | row.id | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:31 | operation.applications | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:31 | proof.id | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:32 | journal.companyId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:32 | journal.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:33 | row.returnRequestId | ReturnApplication & Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:33 | operation.returnRequestId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:34 | proof.statementId | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:34 | proof.amount | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:34 | proof.applicationHash | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:38 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:41 | journal.items | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:42 | journal.items | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:43 | line.total | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:43 | line.total | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:43 | line.side | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:44 | line.side | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:44 | line.total | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:44 | line.total | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:45 | line.accountCode | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:45 | line.side | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:45 | line.accountCode | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:45 | line.side | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:46 | line.accountCode | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:46 | line.accountCode | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:46 | line.total | any | any-receiver |
| functions/src/shared/returnClaimProjection.ts:50 | operation.amount | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:53 | journal.companyId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:53 | journal.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:55 | journal.id | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:55 | journal.companyId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:55 | journal.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/returnClaimProjection.ts:56 | journal.tradeDate | Row | property-symbol-unresolved |
| functions/src/returnClaimReader.ts:18 | row.operationId | ReturnApplication & Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:13 | row.companyId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:13 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:13 | row.date | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:14 | row.cashAccountId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:14 | row.dir | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:14 | row.amount | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:14 | row.lines | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:15 | row.note | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:15 | row.advanceOrigin | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:15 | row.advanceOrigin | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:26 | row.companyId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:26 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:27 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:27 | row.createdBy | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:31 | receipt.companyId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:31 | receipt.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:32 | receipt.createdBy | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:32 | receipt.status | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:32 | receipt.cashEntryId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:32 | row.id | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:33 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:33 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:34 | row.docNo | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:34 | row.docNo | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:34 | receipt.docNo | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:34 | row.docNo | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:35 | receipt.issuePrefix | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:35 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:36 | receipt.requestHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:36 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:36 | receipt.entryHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:40 | row.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:51 | row.companyId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:51 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:51 | row.id | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:52 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:52 | row.docNo | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:52 | row.docNo | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:53 | row.createdBy | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:53 | row.createdBy | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:53 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:54 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:54 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:55 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:60 | operation.command | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:60 | operation.companyId | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:60 | operation.createdBy | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:60 | operation.action | Row | property-symbol-unresolved |
| functions/src/shared/partnerAdvanceReceipt.ts:60 | operation.command | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:7 | row.companyId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:9 | operation.createdBy | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:9 | operation.createdBy | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:10 | operation.docNo | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:10 | operation.docNo | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:16 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:17 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:20 | op.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:20 | row.noncashApplication.operationId | any | any-receiver |
| functions/src/partnerAdvanceClaimReader.ts:20 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:22 | row.noncashApplication.kind | any | any-receiver |
| functions/src/partnerAdvanceClaimReader.ts:22 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:23 | original.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:23 | row.noncashApplication.applicationStatementId | any | any-receiver |
| functions/src/partnerAdvanceClaimReader.ts:23 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:24 | original?.noncashApplication?.allocations | any | any-receiver |
| functions/src/partnerAdvanceClaimReader.ts:24 | original?.noncashApplication | Row \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:25 | operation!.source | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:25 | allocation.source | any | any-receiver |
| functions/src/partnerAdvanceClaimReader.ts:26 | operation!.targetStatementId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:26 | allocation.statementId | any | any-receiver |
| functions/src/partnerAdvanceClaimReader.ts:26 | operation!.amount | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:26 | allocation.amount | any | any-receiver |
| functions/src/partnerAdvanceClaimReader.ts:30 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:31 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:31 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:39 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:39 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:45 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:46 | row.noncashApplication?.operationId | any | any-receiver |
| functions/src/partnerAdvanceClaimReader.ts:46 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceClaimReader.ts:47 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerCutover.ts:3 | gate?.auditScope | Record<string, unknown> \| undefined | property-symbol-unresolved |
| functions/src/partnerCutover.ts:4 | gate.blockedPartnerIds | Record<string, unknown> | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:23 | row.companyId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:38 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:39 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:40 | row.items | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:40 | row.items | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:41 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:41 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:42 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:42 | item.supply | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:43 | item.tax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:43 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:44 | item.supply | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:45 | row.totalTax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:45 | row.totalTax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:45 | item.tax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:46 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:49 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:51 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:52 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:57 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:58 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:58 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:59 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:59 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:60 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:60 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:61 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:61 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:63 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:63 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:64 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:64 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:65 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:69 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:69 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:69 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:70 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:70 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:71 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:75 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:76 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:76 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:76 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:83 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:89 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:125 | prior?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:141 | currentEntry?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:143 | row.companyId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:143 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:143 | row.date | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:143 | row.cashAccountId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:144 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:144 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:144 | row.lines | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:144 | row.note | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:145 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:145 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:145 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:146 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:146 | row.docNo | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:156 | currentEntry?.issuePrefix | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:168 | cutoverSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:169 | cutoverSnap.data()?.enabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:169 | cutoverSnap.data()?.legacyWritersBlocked | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:170 | cutoverSnap.data()?.auditPassed | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:175 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:177 | accountSnap.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:199 | partnerSnap.data()?.name | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:6 | row.companyId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:46 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:47 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:48 | op.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:48 | row.noncashApplication.operationId | any | any-receiver |
| functions/src/partnerAdvanceReader.ts:48 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:51 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:52 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:61 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:61 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:62 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:62 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:62 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:64 | cash.loanId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:64 | cash.payrollId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:64 | cash.transferOperationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:64 | cash.returnOperationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:64 | cash.balanceAdjustment | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:65 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:65 | cash.issueOperationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:68 | cash.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:69 | row.createdBy | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:69 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:70 | cash.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:77 | cash.mutationRevision | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:81 | cash.dir | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:81 | cash.dir | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:82 | cash.date | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:84 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:84 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:85 | row.balanceAdjustment | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:85 | row.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:85 | row.lines?.length | any | any-receiver |
| functions/src/partnerAdvanceReader.ts:85 | row.lines | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:87 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:87 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:89 | row.date | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:89 | row.date | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:89 | cash.date | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:91 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:91 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:91 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:91 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:92 | row.items | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:92 | row.items | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:92 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:93 | line.side | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:93 | line.total | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:93 | line.total | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:93 | line.side | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:93 | line.total | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:93 | line.total | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:95 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:95 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:95 | cash.date | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:98 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:98 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:117 | cash.date | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:118 | target.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:124 | row.createdBy | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:124 | row.createdBy | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:124 | row.docNo | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:124 | row.docNo | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:124 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:124 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:125 | row.companyId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:125 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:126 | row.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:126 | row.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:126 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:127 | target.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:130 | target.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:132 | operation.kind | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:132 | operation.status | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:132 | operation.companyId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:132 | operation.statementId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:132 | target.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:132 | operation.uid | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:132 | operation.uid | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:133 | operation.expectedRevision | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:133 | before.mutationRevision | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:133 | operation.revision | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:133 | operation.expectedRevision | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:133 | operation.beforeHash | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceReader.ts:133 | operation.afterHash | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:23 | partner.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:23 | partner.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:25 | gate?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:27 | payment?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:29 | value?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:43 | command.date | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:44 | command.operationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:44 | command.operationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:50 | snapshot.partner.data()?.name | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:52 | command.operationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:53 | command.operationId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:53 | command.applicationStatementId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:62 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:62 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:64 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:64 | application.noncashApplication?.operationId | any | any-receiver |
| functions/src/partnerAdvanceCommand.ts:64 | application.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:66 | application.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:67 | metadata.allocations.length | any | any-receiver |
| functions/src/partnerAdvanceCommand.ts:67 | metadata.allocations | any | any-receiver |
| functions/src/partnerAdvanceCommand.ts:68 | metadata.allocations | any | any-receiver |
| functions/src/partnerAdvanceCommand.ts:70 | application.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:72 | allocation.source | any | any-receiver |
| functions/src/partnerAdvanceCommand.ts:72 | allocation.statementId | any | any-receiver |
| functions/src/partnerAdvanceCommand.ts:72 | allocation.amount | any | any-receiver |
| functions/src/partnerAdvanceCommand.ts:102 | prepared.statement.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:102 | prepared.statement.docNo | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:119 | request.auth.token.companyId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:119 | request.auth.token.isAdmin | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:129 | snapshot.state.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:129 | snapshot.release.data()?.releaseId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:132 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:132 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:133 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:135 | cash.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:135 | cash.lines?.some | any | any-receiver |
| functions/src/partnerAdvanceCommand.ts:135 | cash.lines | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:135 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:136 | cash.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:140 | target.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:143 | cash.docNo | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:143 | cash.note | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:144 | target.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:144 | target.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:144 | target.docNo | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:148 | cash.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:154 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:157 | row.id | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:158 | raw.docNo | Row | property-symbol-unresolved |
| functions/src/partnerAdvanceCommand.ts:165 | request.data?.partnerId | any | any-receiver |
| functions/src/deleteIssuedStatementCommand.ts:17 | value.toMillis | any | any-receiver |
| functions/src/deleteIssuedStatementCommand.ts:17 | value.toMillis | any | any-receiver |
| functions/src/deleteIssuedStatementCommand.ts:24 | row.orderId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:24 | row.purchaseOrderIds | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:24 | row.purchaseOrderIds | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:24 | row.confirmedProductIds | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:24 | row.confirmedProductIds | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:24 | row.sourcePoId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:29 | statement.companyId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:30 | row.data.companyId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:31 | statement.partnerId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:33 | state?.revision | Row \| null | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:34 | state.companyId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:34 | state.partnerId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:36 | row.data.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:37 | row.data.statementId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:50 | before.companyId | any | any-receiver |
| functions/src/deleteIssuedStatementCommand.ts:74 | prior.data()?.beforeSnapshot?.partnerId | any | any-receiver |
| functions/src/deleteIssuedStatementCommand.ts:74 | prior.data()?.beforeSnapshot | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:119 | row.data.companyId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:119 | row.data.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:119 | row.data.linkedStatementAt | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:119 | row.data.linkedStatementAt | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:119 | row.statement.id | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:132 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:44 | document.companyId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:44 | document.companyId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:47 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:47 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:47 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:52 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:52 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:53 | document.accountCode | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:53 | line.accountCode | any | any-receiver |
| functions/src/voucherIssue.ts:88 | existing.data()?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:92 | row.companyId | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:92 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:93 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:93 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:93 | row.docNo | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:96 | original.docNo | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:100 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:100 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:101 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:101 | row.docNo | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:101 | row.docNo | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:102 | deleted.docNo | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:112 | document.accountCode | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:113 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:113 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:113 | line?.accountCode | any | any-receiver |
| functions/src/voucherIssue.ts:125 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:125 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:125 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:127 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:127 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:127 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:131 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:132 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:132 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:133 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:133 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:134 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:138 | account.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:138 | account.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:140 | partner.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:142 | cutover.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:142 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:144 | partner.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:144 | partner.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:145 | partner.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:147 | state.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:147 | state.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:148 | state.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:149 | state.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:149 | state.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:149 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:165 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:165 | partnerState.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:168 | cashPartner.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:180 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:185 | request.data?.releaseId | any | any-receiver |
| functions/src/loanMovementCommand.ts:20 | row.companyId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:61 | prior?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:74 | stored?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:76 | row.companyId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:76 | row.loanId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:76 | row.date | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:77 | row.cashAccountId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:77 | row.dir | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:77 | row.amount | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:78 | row.accountCode | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:78 | row.lines | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:78 | row.note | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:79 | row.loanId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:79 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:79 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:80 | row.docNo | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:88 | stored?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:88 | stored?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:94 | cutoverSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:95 | cutoverSnap.data()?.enabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:95 | cutoverSnap.data()?.legacyWritersBlocked | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:96 | cutoverSnap.data()?.auditPassed | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:105 | accountSnap.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:105 | accountSnap.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:116 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:116 | line.amount | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:116 | line.side | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:189 | template.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/autoVoucherCommand.ts:26 | decision.draft.document.type | Record<string, unknown> | property-symbol-unresolved |
| functions/src/autoVoucherCommand.ts:39 | document.type | Record<string, unknown> | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:20 | actor.token.isAdmin | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:20 | actor.token.employeeId | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:21 | actor.token.companyId | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:21 | actor.token.companyId | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:30 | snap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:33 | receipt.version | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:34 | receipt.requestId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:35 | receipt.actorId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:35 | receipt.actorId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:35 | receipt.actorId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:36 | receipt.request | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:36 | receipt.requestHash | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:37 | receipt.request | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:37 | receipt.requestHash | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:37 | receipt.requestHash | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:42 | rejected.status | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:42 | rejected.actorId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:42 | rejected.companyId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:42 | rejected.requestHash | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:42 | rejected.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:42 | rejected.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:42 | rejected.message | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:42 | rejected.message | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:43 | rejected.message | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:47 | prior?.command?.expectedRequest?.quantityOperations | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:47 | prior?.command?.expectedRequest | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:47 | prior?.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:48 | proofBody.quantityOperations | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:49 | proofBody.quantityOperations | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:49 | proofBody.quantityOperations | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:49 | proofBody.quantityOperations | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:50 | proofBody.quantityOperations | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:52 | value.status | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:52 | value.companyId | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:52 | value.actorId | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:52 | value.actorId | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:53 | value.message | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:53 | value.command | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:54 | value.command.companyId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:54 | value.command | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:54 | value.command.requestId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:54 | value.command | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:54 | value.command.operationId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:54 | value.command | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:55 | value.command | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:55 | value.requestHash | Row | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:57 | proofBody.quantityOperations | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:57 | proofBody.quantityOperations | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:58 | proofBody.quantityOperations | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/cancelPendingReturnCommand.ts:60 | prior.version | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:60 | prior.status | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:61 | prior.companyId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:61 | prior.requestId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:61 | prior.operationId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:62 | prior.actorId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:62 | prior.actorId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:62 | prior.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:63 | prior.command.companyId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:63 | prior.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:63 | prior.command.requestId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:63 | prior.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:64 | prior.command.operationId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:64 | prior.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:64 | prior.operationId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:64 | prior.command.expectedRequest | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:64 | prior.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:65 | prior.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:65 | prior.requestHash | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:66 | prior.createdAt | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:66 | prior.actorId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:67 | prior.beforeHash | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:68 | prior.beforeHash | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:68 | prior.command.expectedRequest | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:68 | prior.command | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:69 | prior.operationId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:74 | prior.actorId | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:74 | prior.requestHash | any | any-receiver |
| functions/src/cancelPendingReturnCommand.ts:86 | op.command.returnRequestId | any | any-receiver |
| functions/src/cashMutationPlan.ts:14 | current.cashAccountId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:14 | current.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:15 | current.companyId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:15 | account.companyId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:16 | account.active | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:16 | account.type | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:17 | current.transferOperationId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:17 | current.payrollId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:17 | current.balanceAdjustment | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:17 | current.returnOperationId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:30 | current.companyId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:30 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:31 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:31 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:31 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:32 | current.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:32 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:33 | next.note | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:33 | next.note | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:33 | next.note | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:37 | partner.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:37 | partner.companyId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:38 | next.partnerName | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:38 | partner!.name | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:40 | next.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:40 | next.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:40 | next.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:41 | next.lines?.length | any | any-receiver |
| functions/src/cashMutationPlan.ts:41 | next.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:41 | next.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:41 | next.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:41 | next.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:41 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:45 | line.accountCode | any | any-receiver |
| functions/src/cashMutationPlan.ts:45 | line.accountCode | any | any-receiver |
| functions/src/cashMutationPlan.ts:46 | line.amount | any | any-receiver |
| functions/src/cashMutationPlan.ts:46 | line.amount | any | any-receiver |
| functions/src/cashMutationPlan.ts:47 | line.side | any | any-receiver |
| functions/src/cashMutationPlan.ts:47 | line.side | any | any-receiver |
| functions/src/cashMutationPlan.ts:48 | line.note | any | any-receiver |
| functions/src/cashMutationPlan.ts:48 | line.note | any | any-receiver |
| functions/src/cashMutationPlan.ts:48 | line.note.length | any | any-receiver |
| functions/src/cashMutationPlan.ts:48 | line.note | any | any-receiver |
| functions/src/cashMutationPlan.ts:49 | line.side | any | any-receiver |
| functions/src/cashMutationPlan.ts:49 | line.side | any | any-receiver |
| functions/src/cashMutationPlan.ts:49 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:49 | line.amount | any | any-receiver |
| functions/src/cashMutationPlan.ts:49 | line.amount | any | any-receiver |
| functions/src/cashMutationPlan.ts:53 | lines.length | any | any-receiver |
| functions/src/cashMutationPlan.ts:53 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:53 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:53 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:54 | next.balanceAdjustment | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:55 | next.balanceAdjustment | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:56 | lines.length | any | any-receiver |
| functions/src/cashMutationPlan.ts:56 | next.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:56 | next.loanId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:56 | next.linkedAccrualStatementId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:57 | meta.before | any | any-receiver |
| functions/src/cashMutationPlan.ts:57 | meta.target | any | any-receiver |
| functions/src/cashMutationPlan.ts:57 | meta.delta | any | any-receiver |
| functions/src/cashMutationPlan.ts:57 | meta.delta | any | any-receiver |
| functions/src/cashMutationPlan.ts:58 | meta.reason | any | any-receiver |
| functions/src/cashMutationPlan.ts:58 | meta.reason.trim | any | any-receiver |
| functions/src/cashMutationPlan.ts:58 | meta.reason | any | any-receiver |
| functions/src/cashMutationPlan.ts:59 | meta.target | any | any-receiver |
| functions/src/cashMutationPlan.ts:59 | meta.before | any | any-receiver |
| functions/src/cashMutationPlan.ts:59 | meta.delta | any | any-receiver |
| functions/src/cashMutationPlan.ts:59 | meta.delta | any | any-receiver |
| functions/src/cashMutationPlan.ts:59 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:60 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:60 | meta.delta | any | any-receiver |
| functions/src/cashMutationPlan.ts:60 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:60 | current.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:66 | row.companyId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:66 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:66 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:68 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:68 | current.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:69 | next.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:69 | current.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:73 | statement.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:73 | row.statementId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:74 | statement.companyId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:74 | statement.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:74 | next.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:75 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:87 | next.loanId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:87 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:87 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:88 | next.lines?.length | any | any-receiver |
| functions/src/cashMutationPlan.ts:88 | next.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:88 | next.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:88 | next.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:88 | next.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:88 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:89 | lines.length | any | any-receiver |
| functions/src/cashMutationPlan.ts:89 | lines.some | any | any-receiver |
| functions/src/cashMutationPlan.ts:89 | line.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:90 | line.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:90 | line.side | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:90 | line.side | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:90 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:91 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:91 | line.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:101 | row.statementId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:102 | row.cashEntryId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:104 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:104 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:106 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationPlan.ts:107 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:29 | row.id | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:29 | row.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:29 | row.payrollId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:30 | row.payrollRequestHash | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:30 | row.payrollFingerprint | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:30 | row.docNo | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:32 | row.date | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:32 | row.dir | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:32 | row.amount | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:32 | row.cashAccountId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:33 | row.accountCode | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:33 | row.lines | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:33 | row.note | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:34 | row.issuedAt | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:34 | row.tradeDate | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:34 | row.type | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:35 | row.partnerId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:35 | row.partnerName | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:35 | row.orderId | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:36 | row.totalSupply | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:36 | row.totalTax | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:36 | row.totalAmount | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:36 | row.items | Record<string, any> | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:96 | old?.cashEntryId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:96 | old?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:98 | old?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:103 | old?.createdAt | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:141 | cashSnap.data()?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:145 | row.payrollRequestHash | Row | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:145 | row.payrollId | Row | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:145 | row.companyId | Row | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:146 | row.docNo | Row | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:148 | original.docNo | Row | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:169 | old?.cashEntryId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:169 | old?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:171 | old?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:229 | old?.createdAt | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:237 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/payrollVoucher.ts:244 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:22 | row.companyId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:79 | row.docNo | Row | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:79 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:80 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:123 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:125 | next.createdAt | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:125 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:126 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:126 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:151 | next!.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:151 | next!.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:152 | next!.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:152 | next!.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:158 | codes.docs.find(doc => doc.data().name === '급여')?.data().code | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:159 | codes.docs.find(doc => doc.data().name === '예수금')?.data().code | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:161 | next!.lines?.length | any | any-receiver |
| functions/src/cashMutationCommand.ts:161 | next!.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:161 | next!.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:161 | next!.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:161 | next!.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:162 | actual.map | any | any-receiver |
| functions/src/cashMutationCommand.ts:162 | line.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:163 | line.side | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:163 | line.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:163 | line.side | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:163 | line.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:163 | line.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:166 | next!.note | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:172 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:173 | source.type | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:173 | source.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:174 | source.items | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:175 | source.items | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:175 | line.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:175 | line.side | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:176 | line.total | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:178 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:178 | next.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:178 | next.lines?.length | any | any-receiver |
| functions/src/cashMutationCommand.ts:178 | next.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:178 | next.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:182 | next?.amount | CashRow \| null | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:185 | next?.partnerId | CashRow \| null | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:187 | statement.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:189 | statement.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:202 | stateRows.find(row => row.id === current.partnerId)?.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:216 | row.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:216 | row.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:216 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:217 | row.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:222 | row.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:222 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:225 | state.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:225 | state.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:225 | state.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:225 | state.snap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:225 | state.snap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:230 | next.partnerName | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:230 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:230 | next.createdAt | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:230 | next.balanceAdjustment | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:234 | next.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:235 | updated.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:235 | updated.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:238 | state.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:243 | row.statement.id | Row | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:246 | outcome.status | any | any-receiver |
| functions/src/cashMutationCommand.ts:246 | outcome.message | any | any-receiver |
| functions/src/cashMutationCommand.ts:253 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:261 | current.transferOperationId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:278 | current.transferOperationId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:278 | current.transferOperationId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:283 | last.data()?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:283 | last.data()?.transferOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:283 | current.transferOperationId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:284 | last.data()?.transferAfterHashes | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:285 | last.data()?.transferAfterHashes | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:287 | row.companyId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:287 | row.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:287 | row.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:288 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:288 | row.note | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:288 | row.cashAccountId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:288 | row.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:288 | row.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:303 | pair.other.data()?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:324 | original.row.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:331 | next.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:331 | next.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:331 | original.row.dir | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:332 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:332 | original.row.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:332 | next.createdAt | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:332 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:333 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:333 | next.date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:334 | original.row.mutationRevision | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:339 | nextRows[0].amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:339 | nextRows[1].amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:339 | nextRows[0].date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:339 | nextRows[1].date | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:341 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:341 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:342 | row.lines?.length | any | any-receiver |
| functions/src/cashMutationCommand.ts:342 | row.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:342 | row.lines | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:342 | row.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:342 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:344 | row.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:344 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:344 | row.side | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:345 | row.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:345 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:345 | row.side | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:346 | row.accountCode | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:346 | row.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:354 | state.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:354 | state.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:354 | state.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:354 | state.snap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:354 | state.snap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:356 | row.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:357 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:358 | row.partnerId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:358 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:362 | current.docNo | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:365 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:370 | row.id | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:371 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:371 | next.amount | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:374 | state.snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:379 | current.transferOperationId | CashRow | property-symbol-unresolved |
| functions/src/cashMutationCommand.ts:386 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:25 | claims?.isAdmin | Record<string, any> \| undefined | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:25 | claims.employeeId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:25 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:42 | patch.tradeDate | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:42 | patch.tradeDate | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:43 | patch.tradeDate | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:47 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:47 | patch.items.length | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:47 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:47 | patch.items.length | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:47 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:48 | patch.items.some | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:48 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:49 | line.name | Record<string, unknown> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:53 | patch.items.forEach | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:53 | patch.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:73 | editSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:73 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:79 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:85 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:86 | editSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:86 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:93 | patch.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:97 | patch.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:103 | next.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:104 | next.totalSupply | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:104 | next.totalTax | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:105 | next.totalAmount | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:110 | patch.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:110 | (old.items ?? []).some | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:111 | next.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:113 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:114 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:114 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:115 | oldLines[line.sourceLineIndex]?.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:115 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:115 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:117 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:119 | row.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:119 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:127 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:129 | line.purchaseQuantityKg | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:129 | line.purchaseQuantityKg | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:131 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:136 | matching.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:136 | previous.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:136 | matching.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:141 | next.type | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:145 | line.purchaseUnitId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:146 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:148 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:155 | rows.filter((row: Record<string, any>) => row.itemId === line.itemId && (row.sourceLineIndex !== undefined ? row.sourceLineIndex === sourceIndex : oldLines.filter(entry=>entry.itemId===line.itemId).length===1)).map | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:155 | rows.filter | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:155 | row.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:155 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:155 | row.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:155 | row.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:155 | entry.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:155 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:158 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:159 | row.data().items?.some | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:159 | item.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:159 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:159 | item.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:159 | item.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:161 | po.data().status | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:161 | po.data | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:166 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:169 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:172 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:172 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:172 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:176 | row.quantity | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:176 | previous.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:178 | po.ref.path | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:178 | po.ref | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:179 | po.ref | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:179 | rows.map | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:180 | entry.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:180 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:180 | entry.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:180 | entry.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:180 | oldLine.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:180 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:180 | line.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:186 | next.totalAmount | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:186 | next.totalAmount | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:190 | claims.employeeId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:191 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:194 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:196 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:197 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:199 | next.tradeDate | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:204 | row.id | Row | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:229 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:229 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:229 | next.partnerName | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:230 | claims.employeeId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:232 | claims.employeeId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:233 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:234 | row.statement.id | Row | property-symbol-unresolved |
| functions/src/employeeLogin.ts:23 | request.data?.username | any | any-receiver |
| functions/src/employeeLogin.ts:24 | request.data?.password | any | any-receiver |
| functions/src/employeeLogin.ts:25 | request.data?.app | any | any-receiver |
| functions/src/employeeLogin.ts:26 | request.data?.companyId | any | any-receiver |
| functions/src/employeeLogin.ts:46 | employee?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:48 | employee?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:50 | employee?.adminAccess | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:51 | employee?.passwordHash | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:80 | error?.code | any | any-receiver |
| functions/src/tradeStatementIssue.ts:28 | row.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:53 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:53 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:54 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:55 | raw.tradeDate | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:59 | raw.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:59 | raw.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:60 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:60 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:61 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:61 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:63 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:65 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:68 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:68 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:68 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:69 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:69 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:70 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:70 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:70 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:70 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:71 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:71 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:72 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:72 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:73 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:74 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:74 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:74 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:76 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:76 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:79 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:79 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:79 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:80 | line.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:80 | line.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:80 | raw.items.indexOf | any | any-receiver |
| functions/src/tradeStatementIssue.ts:80 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:81 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:81 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:85 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:85 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:85 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:86 | kgLines.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:86 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:86 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:86 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:87 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:87 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:87 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:89 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:90 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:90 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:90 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:90 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:90 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:90 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:91 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:91 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:91 | item.isBox | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:93 | item.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:94 | line.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:98 | raw.items.reduce | any | any-receiver |
| functions/src/tradeStatementIssue.ts:98 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:98 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:98 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:98 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:99 | raw.totalSupply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:99 | raw.totalTax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:99 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:100 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:100 | sums.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:100 | raw.totalSupply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:100 | raw.totalTax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:100 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:101 | raw.orderId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:102 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:103 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:103 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:103 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:105 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:106 | line.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:107 | raw.items.map((row:Row,index:number)=>row.itemId===cost.itemId && readPurchaseUnitSnapshot(row)?index:-1).filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:107 | raw.items.map | any | any-receiver |
| functions/src/tradeStatementIssue.ts:107 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:107 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:110 | raw.items.map((row:Row,index:number)=>row.itemId===cost.itemId?index:-1).filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:110 | raw.items.map | any | any-receiver |
| functions/src/tradeStatementIssue.ts:110 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:110 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:113 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:115 | allUnitIndexes.length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:115 | raw.items.filter((row:Row)=>row.itemId===cost.itemId).length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:115 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:115 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:115 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:115 | line.purchaseQuantityKg | any | any-receiver |
| functions/src/tradeStatementIssue.ts:116 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:116 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:116 | candidate.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:124 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:125 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:128 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:132 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:134 | line.purchaseUnitId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:136 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:139 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:145 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:167 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:168 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:168 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:169 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:169 | row.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:170 | row.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:170 | row.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:170 | row.issueVoucherNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:170 | row.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:171 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:171 | deleted.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:174 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:175 | original.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:175 | original.issueOperationId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:176 | original.issuePrefix | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:176 | original.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:177 | original.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:178 | original.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:178 | original.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:178 | original.issueVoucherNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:184 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:185 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:189 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:191 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:199 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:203 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:209 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:216 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:216 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:221 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:222 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:222 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:222 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:222 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:222 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:222 | row.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:223 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:223 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:223 | raw.items[row.sourceLineIndex]?.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:223 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:223 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:223 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:224 | raw.items[row.sourceLineIndex]?.qty | any | any-receiver |
| functions/src/tradeStatementIssue.ts:224 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:224 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:224 | row.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:224 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:224 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:225 | matching.length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:225 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:225 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:225 | matching[0].sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:226 | matching.length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:230 | po.data()?.items | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:230 | po.data()?.itemId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:230 | po.data()?.quantity | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:232 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:233 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:233 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:233 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:233 | row.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:233 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:233 | row.quantity | any | any-receiver |
| functions/src/tradeStatementIssue.ts:234 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:234 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:234 | raw.items[row.sourceLineIndex]?.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:234 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:234 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:234 | row.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:235 | raw.items[row.sourceLineIndex]?.qty | any | any-receiver |
| functions/src/tradeStatementIssue.ts:235 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:235 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:235 | row.quantity | any | any-receiver |
| functions/src/tradeStatementIssue.ts:235 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:235 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:236 | matching.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:237 | matching.length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:237 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:237 | matching[0].sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:243 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:243 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:243 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:246 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:249 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:249 | snap.data()?.purpose | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:252 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:257 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:267 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:268 | item.itemName | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:268 | item.unit | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:274 | raw.items[costUpdates[i].sourceLineIndex].purchaseQuantityKg | any | any-receiver |
| functions/src/tradeStatementIssue.ts:274 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:275 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:289 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:291 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:292 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:295 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:295 | raw.partnerName | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:297 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:299 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:302 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:305 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:309 | raw.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:14 | row.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:46 | stmt.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:46 | stmt.orderId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:46 | stmt.type | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:47 | stmt.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:47 | stmt.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:48 | stmt.tradeDate | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:52 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:52 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:52 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:53 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:53 | line.qty | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:54 | line.qty | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:54 | line.price | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:54 | line.price | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | stmt.items.reduce | any | any-receiver |
| functions/src/oemFeeVoucher.ts:59 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:60 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:60 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:60 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | sums.some | any | any-receiver |
| functions/src/oemFeeVoucher.ts:61 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | stmt.items.every | any | any-receiver |
| functions/src/oemFeeVoucher.ts:62 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:63 | stmt.items.every | any | any-receiver |
| functions/src/oemFeeVoucher.ts:63 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:63 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:101 | stmt.partnerId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:107 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:108 | (po.items ?? []).filter | any | any-receiver |
| functions/src/oemFeeVoucher.ts:108 | item.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:109 | (po.oemReceivedBulk ?? []).filter | any | any-receiver |
| functions/src/oemFeeVoucher.ts:109 | item.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:111 | item.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:112 | item.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:125 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:125 | poItem.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:126 | po.oemBatchCost.rows.find | any | any-receiver |
| functions/src/oemFeeVoucher.ts:126 | po.oemBatchCost.rows | any | any-receiver |
| functions/src/oemFeeVoucher.ts:126 | row.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:126 | poItem.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | matches[0].poId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | matches[0].qtyIn | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | poItem.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | matches[0].kgIn | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | row.kg | any | any-receiver |
| functions/src/oemFeeVoucher.ts:131 | children.get(row.child_id)?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:134 | poItem.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:137 | poItem.name | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:137 | poItem.unit | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:137 | poItem.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:139 | (po.oemSent ?? []).reduce | any | any-receiver |
| functions/src/oemFeeVoucher.ts:139 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:143 | row.material | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:143 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:145 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:146 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:147 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:151 | stmt.items.some | any | any-receiver |
| functions/src/oemFeeVoucher.ts:151 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:151 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:158 | po.oemBatchCost?.status | any | any-receiver |
| functions/src/oemFeeVoucher.ts:158 | po.oemBatchCost.reason | any | any-receiver |
| functions/src/oemFeeVoucher.ts:162 | stored.rows | any | any-receiver |
| functions/src/oemFeeVoucher.ts:165 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:172 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:173 | matches[0].poId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:173 | matches[0].kgIn | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:177 | matches[0].oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:178 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:22 | row.companyId | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:43 | item.packageKg | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:43 | item.spec | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:43 | item.name | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:43 | item.spec | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:46 | lot.qtyRemaining | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:46 | lot.status | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:76 | gate.data()?.oemLotCutoverDate | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:121 | children.get(row.child_id)?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:145 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:167 | candidate.id | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:168 | lot.lotNo | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:168 | lot.qtyIn | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:169 | lot.material | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:174 | po.oemBatchCost?.status | any | any-receiver |
| functions/src/oemReceiptCommand.ts:175 | po.oemBatchCost.feeStatementId | any | any-receiver |
| functions/src/oemReceiptCommand.ts:179 | po.oemBatchCost?.status | any | any-receiver |
| functions/src/oemReceiptCommand.ts:179 | po.oemBatchCost.reason | any | any-receiver |
| functions/src/oemReceiptCommand.ts:180 | po.oemBatchCost.previousConfirmed | any | any-receiver |
| functions/src/oemReceiptCommand.ts:181 | previous.feeStatementId | any | any-receiver |
| functions/src/oemReceiptCommand.ts:181 | previous.feeSupplyAmount | any | any-receiver |
| functions/src/oemReceiptCommand.ts:211 | existing.id | Row | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:16 | row.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:54 | priorOperation?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:73 | current?.cashEntryId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:79 | cutover?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:83 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:89 | statementSnap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:89 | cashSnap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:91 | cashSnap.data()?.transferOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:92 | cashSnap.data()?.loanMovementOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:92 | cashSnap.data()?.partnerPaymentOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:115 | prior?.cashEntryId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementCommand.ts:130 | linked.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:70 | opSnap.data()?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:91 | requestSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:124 | saved?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:125 | saved?.returnOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:127 | snap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:128 | snap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:128 | snap.data()?.statementId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:129 | snap.data()?.amount | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:129 | snap.data()?.operationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:133 | expected.id | any | any-receiver |
| functions/src/processReturnCommand.ts:134 | receipt.data()?.returnOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:135 | receipt.data()?.returnReceiptFingerprint | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:135 | expected.fingerprint | any | any-receiver |
| functions/src/processReturnCommand.ts:136 | receipt.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:136 | receipt.data()?.itemId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:136 | expected.itemId | any | any-receiver |
| functions/src/processReturnCommand.ts:137 | receipt.data()?.quantity | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:137 | expected.quantity | any | any-receiver |
| functions/src/processReturnCommand.ts:138 | expected.receiptHash | any | any-receiver |
| functions/src/processReturnCommand.ts:144 | expected.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:144 | expected.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:145 | expected.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:146 | movement.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:147 | movement.data()?.returnOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:148 | expected.movementHash | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:150 | sourceSnap?.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:151 | row.requestItemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:152 | request.items.length | any | any-receiver |
| functions/src/processReturnCommand.ts:154 | row.itemId | any | any-receiver |
| functions/src/processReturnCommand.ts:154 | row.sourceLineIndex | any | any-receiver |
| functions/src/processReturnCommand.ts:154 | request.items.length | any | any-receiver |
| functions/src/processReturnCommand.ts:155 | row.companyId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:156 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:156 | row.operationId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:157 | row.quantityDelta | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:157 | request.items.find((item: Row) => item.itemId === row.itemId && (row.sourceLineIndex !== undefined && rawMovements.some(raw=>raw.id===row.id) && sourceSnap?.exists               ? resolveReturnSourceLine<Row>(sourceSnap.data()!.items,{itemId:item.itemId,sourceLineIndex:item.sourceLineIndex}).index === row.sourceLineIndex               : item.sourceLineIndex === row.sourceLineIndex))?.quantity | any | any-receiver |
| functions/src/processReturnCommand.ts:157 | request.items.find | any | any-receiver |
| functions/src/processReturnCommand.ts:157 | item.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:157 | row.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:157 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:157 | raw.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:157 | row.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | item.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | item.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:159 | item.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:159 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:160 | row.date | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:165 | sourceSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:165 | sourceSnap.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:166 | partnerSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:170 | gate?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:179 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:183 | source?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:184 | cutoverSnap.data()?.purchaseGeneralStockEnabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:189 | request.items.some | any | any-receiver |
| functions/src/processReturnCommand.ts:189 | item.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:190 | request.items.some | any | any-receiver |
| functions/src/processReturnCommand.ts:190 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:193 | request.items.length | any | any-receiver |
| functions/src/processReturnCommand.ts:194 | request.items.filter((item: Row) => item.isResellable).length | any | any-receiver |
| functions/src/processReturnCommand.ts:194 | request.items.filter | any | any-receiver |
| functions/src/processReturnCommand.ts:194 | item.isResellable | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:233 | (app as Row).returnRequestId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:271 | sourceLine!.qty | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:283 | itemDocs.get(doc.data().child_id)?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:365 | row.statement.id | Row | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:15 | row.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:17 | row.manual | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:17 | row.operationId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:18 | row.returnOperationId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:18 | row.transferOperationId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:18 | row.issueOperationId | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:19 | row.serverOwned | Record<string, any> | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:66 | cutover?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:70 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/manualSettlementBatchCommand.ts:100 | linkedCash.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferPreparation.ts:28 | state.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferPreparation.ts:28 | state.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferPreparation.ts:28 | state.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:74 | operationSnap.data()?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:92 | employee?.authUid | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:97 | storedOut?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:97 | storedIn?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:99 | row.companyId | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:99 | row.dir | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:99 | row.transferOperationId | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:100 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:100 | row.docNo | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:101 | row.companyId | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:101 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:101 | row.date | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:101 | row.amount | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:102 | row.note | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:102 | row.cashAccountId | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:102 | row.dir | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:102 | row.lines | Row | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:116 | (prior.outApplications ?? []).map | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:117 | (prior.inApplications ?? []).map | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:121 | storedOut?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:121 | storedIn?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:122 | storedOut?.issuePayloadHash | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:122 | storedIn?.issuePayloadHash | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:126 | row.side | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:126 | row.statementId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:127 | row.companyId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:127 | row.cashId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:128 | row.statementId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:128 | row.amount | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:143 | gate?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:148 | row?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:154 | row?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:166 | snap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/interCompanyTransferCommand.ts:173 | row.companyId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:173 | row.partnerId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:173 | row.companyId | any | any-receiver |
| functions/src/interCompanyTransferCommand.ts:173 | row.partnerId | any | any-receiver |
| functions/src/inventoryOpeningCommand.ts:17 | row.companyId | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:24 | actor.token.isAdmin | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:24 | actor.token.companyId | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:24 | actor.token.companyId | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:39 | item.type | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:39 | item.archived | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:39 | item.phantom | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:50 | item.stock | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:50 | (item.lots ?? []).some | any | any-receiver |
| functions/src/inventoryOpeningCommand.ts:50 | item.lots | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:50 | lot.qtyRemaining | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:50 | lot.kgRemaining | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:50 | (item.stocktakeAnchors ?? []).length | any | any-receiver |
| functions/src/inventoryOpeningCommand.ts:50 | item.stocktakeAnchors | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:55 | stateSnap.data()?.stockKg | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:55 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:20 | prior.data()?.submissionReceipt | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:20 | prior.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:20 | stored?.version | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:20 | stored.requestId | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:20 | stored.actorId | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:20 | stored.requestHash | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:20 | stored.request | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:20 | stored.request | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:27 | body.companyId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.status | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.partnerId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.returnType | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.partnerName | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.partnerName | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.createdAt | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.createdAt | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.note | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.note | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.createdBy | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.createdBy | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:27 | body.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:28 | body.partnerId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:29 | partner.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:30 | body.items | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:30 | body.items | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:30 | body.items | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:30 | item.name | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:30 | item.name | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:30 | item.reason | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:30 | item.reason | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:31 | body.items.map | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:31 | body.items | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:31 | item.itemId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:31 | item.itemId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:32 | item.exists | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:32 | item.data()?.companyId | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:32 | item.data | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:34 | body.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:34 | body.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:34 | body.items.some | any | any-receiver |
| functions/src/submitReturnRequestCommand.ts:34 | body.items | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:34 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/submitReturnRequestCommand.ts:48 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:7 | record.companyId | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:8 | record.status | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:9 | record.items | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:9 | record.items | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:9 | record.items | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:9 | row.itemId | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:9 | row.quantity | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:10 | record.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:11 | record.items | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:11 | row.supply | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:11 | row.tax | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:11 | record.totalAmount | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:12 | record.items | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:14 | row.supply | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:14 | row.supply | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:14 | row.tax | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:14 | row.tax | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:14 | row.accountCode | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:14 | row.accountCode | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:15 | row.quantity | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:19 | row.supply | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:19 | row.tax | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:21 | row.supply | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:21 | row.tax | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:21 | row.quantity | Row | property-symbol-unresolved |
| functions/src/shared/pendingReturnQuantity.ts:21 | row.price | Row | property-symbol-unresolved |
| functions/src/updatePendingReturnQuantityCommand.ts:13 | actor.token.isAdmin | Row | property-symbol-unresolved |
| functions/src/updatePendingReturnQuantityCommand.ts:13 | actor.token.companyId | Row | property-symbol-unresolved |
| functions/src/updatePendingReturnQuantityCommand.ts:13 | actor.token.companyId | Row | property-symbol-unresolved |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.version | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.requestId | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.actorId | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.actorId | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.actorId | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.request | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.requestHash | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.request | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.requestHash | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:21 | receipt.requestHash | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.actorId | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.companyId | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.requestHash | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.command | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.command | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.status | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.status | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.message | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.message | any | any-receiver |
| functions/src/updatePendingReturnQuantityCommand.ts:24 | previous.message | any | any-receiver |
| functions/src/taxIssueCommand.ts:10 | row.items | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:10 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:10 | row.issuedAt | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:16 | row.id | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:16 | row.id | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:32 | input.statements.find(row => row.id === patch.id)!.mutationRevision | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:32 | row.id | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:38 | statement.id | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:41 | original.id | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:42 | before.mutationRevision | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:50 | row.id | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:55 | line.supply | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:55 | line.tax | Row | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:61 | write.data.supply | Record<string, unknown> | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:61 | write.data.tax | Record<string, unknown> | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:61 | write.data.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/taxIssueCommand.ts:90 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/orderLockRecovery.ts:32 | saved.cancellation?.action | any | any-receiver |
| functions/src/orderLockRecovery.ts:32 | saved.cancellation?.evidence | any | any-receiver |
| functions/src/index.ts:39 | request.data?.name | any | any-receiver |
| functions/src/index.ts:40 | request.data?.phone | any | any-receiver |
| functions/src/index.ts:59 | request.data?.username | any | any-receiver |
| functions/src/index.ts:60 | request.data?.name | any | any-receiver |
| functions/src/index.ts:61 | request.data?.phone | any | any-receiver |
| functions/src/index.ts:99 | startingRelease.data()?.releaseId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:161 | releaseSnap.data()?.releaseId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:301 | (room.participantIds ?? []).filter | any | any-receiver |
| functions/src/index.ts:315 | d.data()?.fcmTokens | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:318 | room.nameBy?.[d.id]?.trim | any | any-receiver |
| functions/src/index.ts:318 | room.name?.trim | any | any-receiver |

## 기존 shared 선언 필드

| 모델 | 필드 | 입력 | 선언 타입 | 선언 위치 | 정적 사용처 |
| --- | --- | --- | --- | --- | --- |
| OrderItem | lineId | 선택 | string | src/shared/types.ts:28 | 39 |
| OrderItem | itemId | 필수 | string | src/shared/types.ts:29 | 118 |
| OrderItem | name | 필수 | string | src/shared/types.ts:30 | 63 |
| OrderItem | orderedAs | 선택 | string | src/shared/types.ts:44 | 0 |
| OrderItem | quantity | 필수 | number | src/shared/types.ts:45 | 40 |
| OrderItem | price | 필수 | number | src/shared/types.ts:46 | 7 |
| OrderItem | checked | 선택 | boolean | src/shared/types.ts:47 | 37 |
| OrderItem | checkedBy | 선택 | string | src/shared/types.ts:48 | 6 |
| OrderItem | checkedAt | 선택 | string | src/shared/types.ts:49 | 5 |
| OrderItem | mfgDate | 선택 | string | src/shared/types.ts:50 | 18 |
| OrderItem | mfgBy | 선택 | string | src/shared/types.ts:51 | 2 |
| OrderItem | mfgAt | 선택 | string | src/shared/types.ts:52 | 2 |
| OrderItem | labelType | 선택 | '대기' \| '날인' \| '부착' | src/shared/types.ts:53 | 13 |
| OrderItem | labelBy | 선택 | string | src/shared/types.ts:60 | 2 |
| OrderItem | labelAt | 선택 | string | src/shared/types.ts:61 | 2 |
| OrderItem | isBoxUnit | 선택 | boolean | src/shared/types.ts:62 | 25 |
| OrderItem | boxQuantity | 선택 | number | src/shared/types.ts:63 | 23 |
| OrderItem | unitsPerBox | 선택 | number | src/shared/types.ts:64 | 7 |
| OrderItem | boxType | 선택 | string | src/shared/types.ts:65 | 2 |
| OrderItem | boxSubId | 선택 | string | src/shared/types.ts:66 | 1 |
| OrderItem | displaySize | 선택 | string | src/shared/types.ts:67 | 4 |
| OrderPallet | type | 필수 | string | src/shared/types.ts:71 | 16 |
| OrderPallet | quantity | 필수 | number | src/shared/types.ts:72 | 17 |
| OrderPallet | isExchange | 선택 | boolean | src/shared/types.ts:73 | 7 |
| DeliveryBox | itemId | 필수 | string | src/shared/types.ts:77 | 3 |
| DeliveryBox | name | 필수 | string | src/shared/types.ts:78 | 1 |
| DeliveryBox | quantity | 필수 | number | src/shared/types.ts:79 | 2 |
| PurchaseItem | id | 필수 | string | src/shared/types.ts:98 | 0 |
| PurchaseItem | name | 필수 | string | src/shared/types.ts:99 | 0 |
| ShipTo | id | 필수 | string | src/shared/types.ts:110 | 19 |
| ShipTo | name | 필수 | string | src/shared/types.ts:111 | 12 |
| ShipTo | archived | 선택 | boolean | src/shared/types.ts:113 | 11 |
| PartnerItem | id | 필수 | string | src/shared/types.ts:117 | 25 |
| PartnerItem | itemId | 필수 | string | src/shared/types.ts:118 | 69 |
| PartnerItem | partnerId | 필수 | string | src/shared/types.ts:119 | 62 |
| PartnerItem | Direction | 필수 | 'in' \| 'out' | src/shared/types.ts:120 | 28 |
| PartnerItem | price | 선택 | number | src/shared/types.ts:121 | 29 |
| PartnerItem | Account_Code | 선택 | string | src/shared/types.ts:122 | 13 |
| PartnerItem | taxType | 선택 | '과세' \| '면세' \| null | src/shared/types.ts:131 | 21 |
| PartnerItem | shipToIds | 선택 | string[] | src/shared/types.ts:145 | 1 |
| PartnerItem | isSmartStore | 선택 | boolean | src/shared/types.ts:146 | 0 |
| Partner | shipTos | 선택 | ShipTo[] | src/shared/types.ts:158 | 5 |
| Partner | id | 필수 | string | src/shared/types.ts:159 | 189 |
| Partner | name | 필수 | string | src/shared/types.ts:160 | 177 |
| Partner | email | 선택 | string | src/shared/types.ts:161 | 4 |
| Partner | phone | 선택 | string | src/shared/types.ts:162 | 6 |
| Partner | type | 필수 | PartnerChannel | src/shared/types.ts:163 | 28 |
| Partner | region | 선택 | string | src/shared/types.ts:164 | 8 |
| Partner | address | 선택 | string | src/shared/types.ts:165 | 10 |
| Partner | addressDetail | 선택 | string | src/shared/types.ts:166 | 8 |
| Partner | ownerName | 선택 | string | src/shared/types.ts:167 | 6 |
| Partner | bizNo | 선택 | string | src/shared/types.ts:168 | 6 |
| Partner | tel | 선택 | string | src/shared/types.ts:169 | 7 |
| Partner | mobile | 선택 | string | src/shared/types.ts:170 | 7 |
| Partner | fax | 선택 | string | src/shared/types.ts:171 | 2 |
| Partner | note | 선택 | string | src/shared/types.ts:172 | 3 |
| Partner | partnerType | 선택 | PartnerType | src/shared/types.ts:173 | 8 |
| Partner | companyId | 선택 | CompanyId | src/shared/types.ts:180 | 3 |
| Partner | isOemFactory | 선택 | boolean | src/shared/types.ts:181 | 1 |
| Partner | purchaseItems | 선택 | PurchaseItem[] | src/shared/types.ts:182 | 0 |
| OrderRawInventoryTrace | material | 필수 | string | src/shared/types.ts:215 | 14 |
| OrderRawInventoryTrace | rawItemId | 선택 | string | src/shared/types.ts:217 | 14 |
| OrderRawInventoryTrace | operationId | 선택 | string | src/shared/types.ts:219 | 20 |
| OrderRawInventoryTrace | ledgerId | 선택 | string | src/shared/types.ts:221 | 3 |
| OrderRawInventoryTrace | ledgerOnly | 선택 | boolean | src/shared/types.ts:223 | 11 |
| OrderRawInventoryTrace | lotId | 선택 | string | src/shared/types.ts:224 | 8 |
| OrderRawInventoryTrace | lotNo | 선택 | string | src/shared/types.ts:225 | 4 |
| OrderRawInventoryTrace | supplierName | 필수 | string | src/shared/types.ts:226 | 3 |
| OrderRawInventoryTrace | receivedDate | 선택 | string | src/shared/types.ts:227 | 3 |
| OrderRawInventoryTrace | kg | 필수 | number | src/shared/types.ts:228 | 13 |
| Order | id | 필수 | string | src/shared/types.ts:232 | 260 |
| Order | companyId | 선택 | CompanyId | src/shared/types.ts:234 | 1 |
| Order | cardNo | 선택 | string | src/shared/types.ts:245 | 5 |
| Order | createdBy | 선택 | string | src/shared/types.ts:250 | 1 |
| Order | sourceChatMessageId | 선택 | string | src/shared/types.ts:252 | 1 |
| Order | partnerId | 선택 | string | src/shared/types.ts:253 | 58 |
| Order | partnerName | 필수 | string | src/shared/types.ts:254 | 91 |
| Order | items | 필수 | OrderItem[] | src/shared/types.ts:255 | 146 |
| Order | note | 선택 | string | src/shared/types.ts:257 | 14 |
| Order | noteImportant | 선택 | boolean | src/shared/types.ts:258 | 4 |
| Order | noteBy | 선택 | string | src/shared/types.ts:259 | 2 |
| Order | noteAt | 선택 | string | src/shared/types.ts:260 | 2 |
| Order | totalAmount | 필수 | number | src/shared/types.ts:261 | 0 |
| Order | status | 필수 | OrderStatus | src/shared/types.ts:262 | 130 |
| Order | createdAt | 필수 | string | src/shared/types.ts:263 | 55 |
| Order | deliveryDate | 필수 | string | src/shared/types.ts:264 | 58 |
| Order | email | 필수 | string | src/shared/types.ts:265 | 0 |
| Order | purpose | 선택 | 'stock-production' | src/shared/types.ts:267 | 1 |
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
| Order | rawInventoryAttempt | 선택 | number | src/shared/types.ts:310 | 5 |
| Order | productConsumedLots | 선택 | { itemId: string; material?: string; lotId?: string; lotNo?: string; receivedDate?: string; qty: number; lotSnapshot?: RawMaterialLot }[] | src/shared/types.ts:316 | 7 |
| Order | autoBuilt | 선택 | { itemId: string; qty: number }[] | src/shared/types.ts:317 | 12 |
| Order | producedUnits | 선택 | { itemId: string; qty: number }[] | src/shared/types.ts:318 | 15 |
| Order | producedAt | 선택 | string | src/shared/types.ts:320 | 23 |
| Order | shippedOut | 선택 | boolean | src/shared/types.ts:321 | 14 |
| Order | inventorySnapshots | 선택 | {     version: 1;     production?: OrderInventorySnapshot;     shipment?: OrderInventorySnapshot;   } | src/shared/types.ts:326 | 30 |
| Order | itemInventory | 선택 | Record<string, OrderItemInventoryState> | src/shared/types.ts:336 | 18 |
| Order | inventoryOperation | 선택 | {     id: string;     /** 품목 한 줄은 결정적 원료 작업번호로 중단 지점부터 재개할 수 있다. */     kind?: 'line' \| 'status';     lineId?: string;     stage?: 'claim' \| 'reservation' \| 'raw-inventory' \| 'production-record' \| 'final-stock';     targetStatus: OrderStatus;     state: 'processing' \| 'failed';     startedAt: string;     actor: string;     error?: string;   } \| null | src/shared/types.ts:338 | 17 |
| OrderItemInventoryState | version | 필수 | 1 | src/shared/types.ts:353 | 0 |
| OrderItemInventoryState | lineId | 필수 | string | src/shared/types.ts:354 | 4 |
| OrderItemInventoryState | itemId | 필수 | string | src/shared/types.ts:355 | 3 |
| OrderItemInventoryState | applied | 필수 | boolean | src/shared/types.ts:356 | 15 |
| OrderItemInventoryState | attempt | 필수 | number | src/shared/types.ts:357 | 6 |
| OrderItemInventoryState | completedAt | 선택 | string | src/shared/types.ts:358 | 8 |
| OrderItemInventoryState | reversedAt | 선택 | string | src/shared/types.ts:359 | 0 |
| OrderItemInventoryState | rawConsumedLots | 필수 | OrderRawInventoryTrace[] | src/shared/types.ts:360 | 9 |
| OrderItemInventoryState | autoBuilt | 필수 | { itemId: string; qty: number }[] | src/shared/types.ts:361 | 4 |
| OrderItemInventoryState | producedUnits | 필수 | { itemId: string; qty: number }[] | src/shared/types.ts:362 | 5 |
| OrderItemInventoryState | production | 필수 | OrderInventorySnapshot | src/shared/types.ts:363 | 21 |
| OrderInventoryAdjustment | itemId | 필수 | string | src/shared/types.ts:367 | 18 |
| OrderInventoryAdjustment | delta | 필수 | number | src/shared/types.ts:368 | 14 |
| OrderRawCalculationEvidence | productId | 필수 | string | src/shared/types.ts:373 | 2 |
| OrderRawCalculationEvidence | spec | 필수 | string | src/shared/types.ts:374 | 1 |
| OrderRawCalculationEvidence | units | 필수 | number | src/shared/types.ts:375 | 1 |
| OrderRawCalculationEvidence | raw | 필수 | string | src/shared/types.ts:376 | 3 |
| OrderRawCalculationEvidence | kg | 필수 | number | src/shared/types.ts:377 | 3 |
| OrderRawCalculationEvidence | path | 필수 | 'bom-direct' \| 'bom-formula' \| 'formula-fallback' \| 'bulk' | src/shared/types.ts:378 | 1 |
| OrderRawCalculationEvidence | childItemId | 선택 | string | src/shared/types.ts:379 | 1 |
| OrderRawCalculationEvidence | bomQuantityKg | 선택 | number | src/shared/types.ts:380 | 1 |
| OrderRawCalculationEvidence | formulaName | 선택 | string | src/shared/types.ts:381 | 1 |
| OrderRawCalculationEvidence | ratio | 선택 | number | src/shared/types.ts:382 | 1 |
| OrderRawCalculationEvidence | convertedKg | 선택 | number | src/shared/types.ts:383 | 1 |
| OrderInventorySnapshot | capturedAt | 필수 | string | src/shared/types.ts:387 | 16 |
| OrderInventorySnapshot | rawCalculationEvidence | 선택 | OrderRawCalculationEvidence[] | src/shared/types.ts:388 | 4 |
| OrderInventorySnapshot | stockDeltas | 필수 | OrderInventoryAdjustment[] | src/shared/types.ts:389 | 19 |
| OrderInventorySnapshot | bomLines | 필수 | { parentItemId: string; childItemId: string; quantity: number }[] | src/shared/types.ts:390 | 3 |
| OrderInventorySnapshot | rawConsumedLots | 선택 | Order['rawConsumedLots'] | src/shared/types.ts:391 | 13 |
| OrderInventorySnapshot | productConsumedLots | 선택 | Order['productConsumedLots'] | src/shared/types.ts:392 | 6 |
| OrderInventorySnapshot | productProducedLots | 선택 | { itemId: string; lotId: string; qty: number }[] | src/shared/types.ts:393 | 6 |
| OrderInventorySnapshot | rawLedgerIds | 선택 | string[] | src/shared/types.ts:394 | 7 |
| OrderStatusAudit | id | 필수 | string | src/shared/types.ts:398 | 0 |
| OrderStatusAudit | orderId | 필수 | string | src/shared/types.ts:399 | 0 |
| OrderStatusAudit | partnerName | 필수 | string | src/shared/types.ts:400 | 0 |
| OrderStatusAudit | previousStatus | 필수 | OrderStatus | src/shared/types.ts:401 | 1 |
| OrderStatusAudit | nextStatus | 필수 | OrderStatus | src/shared/types.ts:402 | 1 |
| OrderStatusAudit | approvedBy | 필수 | string | src/shared/types.ts:403 | 1 |
| OrderStatusAudit | approvedAt | 필수 | string | src/shared/types.ts:404 | 1 |
| OrderStatusAudit | completedAt | 선택 | string | src/shared/types.ts:405 | 1 |
| OrderStatusAudit | state | 필수 | 'processing' \| 'completed' \| 'failed' | src/shared/types.ts:406 | 3 |
| OrderStatusAudit | legacyEvidenceWarning | 필수 | boolean | src/shared/types.ts:407 | 1 |
| OrderStatusAudit | stockAdjustments | 필수 | Array<OrderInventoryAdjustment & { name: string; unit: string }> | src/shared/types.ts:408 | 1 |
| OrderStatusAudit | error | 선택 | string | src/shared/types.ts:409 | 1 |
| OrderItemEdit | id | 필수 | string | src/shared/types.ts:419 | 0 |
| OrderItemEdit | orderId | 필수 | string | src/shared/types.ts:420 | 0 |
| OrderItemEdit | at | 필수 | string | src/shared/types.ts:421 | 1 |
| OrderItemEdit | by | 필수 | string | src/shared/types.ts:422 | 1 |
| OrderItemEdit | changes | 필수 | string[] | src/shared/types.ts:424 | 1 |
| SubmaterialComponent | id | 필수 | string | src/shared/types.ts:428 | 13 |
| SubmaterialComponent | name | 필수 | string | src/shared/types.ts:429 | 2 |
| SubmaterialComponent | category | 필수 | InventoryCategory \| string | src/shared/types.ts:430 | 0 |
| SubmaterialComponent | stock | 필수 | number | src/shared/types.ts:431 | 8 |
| SubmaterialComponent | unit | 필수 | string | src/shared/types.ts:432 | 1 |
| SubmaterialComponent | spec | 선택 | string | src/shared/types.ts:433 | 0 |
| SubmaterialComponent | cost | 선택 | number | src/shared/types.ts:434 | 0 |
| SubmaterialComponent | qrCode | 선택 | string | src/shared/types.ts:435 | 0 |
| ItemInventoryReservation | operationId | 필수 | string | src/shared/types.ts:481 | 2 |
| ItemInventoryReservation | orderId | 필수 | string | src/shared/types.ts:482 | 9 |
| ItemInventoryReservation | qty | 필수 | number | src/shared/types.ts:483 | 7 |
| ItemInventoryReservation | createdAt | 필수 | string | src/shared/types.ts:484 | 1 |
| ItemInventoryReservation | state | 필수 | 'processing' \| 'allocated' | src/shared/types.ts:486 | 3 |
| ItemStocktakeAnchor | id | 필수 | string | src/shared/types.ts:490 | 4 |
| ItemStocktakeAnchor | date | 필수 | string | src/shared/types.ts:491 | 3 |
| ItemStocktakeAnchor | createdAt | 필수 | string | src/shared/types.ts:492 | 2 |
| ItemStocktakeAnchor | targetQty | 필수 | number | src/shared/types.ts:493 | 1 |
| ItemStocktakeAnchor | beforeQty | 필수 | number | src/shared/types.ts:494 | 1 |
| ItemStocktakeAnchor | deltaQty | 필수 | number | src/shared/types.ts:495 | 0 |
| ItemStocktakeAnchor | note | 선택 | string | src/shared/types.ts:496 | 1 |
| ItemStocktakeAnchor | request | 선택 | ProductStocktakeRequest | src/shared/types.ts:498 | 0 |
| Item | id | 필수 | string | src/shared/types.ts:503 | 695 |
| Item | companyId | 선택 | CompanyId | src/shared/types.ts:515 | 3 |
| Item | name | 필수 | string | src/shared/types.ts:516 | 293 |
| Item | sku | 선택 | string | src/shared/types.ts:517 | 0 |
| Item | type | 필수 | InventoryCategory \| string | src/shared/types.ts:519 | 131 |
| Item | category | 선택 | ItemSubtype \| string | src/shared/types.ts:520 | 36 |
| Item | subtype | 선택 | string | src/shared/types.ts:521 | 20 |
| Item | cost | 선택 | number | src/shared/types.ts:522 | 20 |
| Item | costSource | 선택 | 'rollup' \| 'manual' | src/shared/types.ts:531 | 2 |
| Item | lotsAreTotal | 선택 | never | src/shared/types.ts:560 | 0 |
| Item | stock | 필수 | number | src/shared/types.ts:562 | 61 |
| Item | inventoryReservations | 선택 | ItemInventoryReservation[] | src/shared/types.ts:564 | 4 |
| Item | stocktakeAnchors | 선택 | ItemStocktakeAnchor[] | src/shared/types.ts:566 | 4 |
| Item | density | 선택 | number | src/shared/types.ts:572 | 15 |
| Item | minStock | 필수 | number | src/shared/types.ts:573 | 22 |
| Item | unit | 필수 | string | src/shared/types.ts:574 | 113 |
| Item | image | 필수 | string | src/shared/types.ts:575 | 3 |
| Item | imagePath | 선택 | string | src/shared/types.ts:577 | 5 |
| Item | oil | 선택 | string | src/shared/types.ts:578 | 3 |
| Item | partnerIds | 선택 | string[] | src/shared/types.ts:579 | 0 |
| Item | freightType | 선택 | 's' \| 'a' \| 'b' \| 'c' \| 'd' \| 'e' | src/shared/types.ts:580 | 3 |
| Item | 품목 | 선택 | string | src/shared/types.ts:583 | 13 |
| Item | 품목이력 | 선택 | { 품목: string; until: string }[] | src/shared/types.ts:585 | 1 |
| Item | spec | 선택 | string | src/shared/types.ts:586 | 100 |
| Item | isSmartStore | 선택 | boolean | src/shared/types.ts:587 | 1 |
| Item | smartStorePrice | 선택 | number | src/shared/types.ts:588 | 4 |
| Item | procureType | 선택 | '완사입' \| '임가공' | src/shared/types.ts:591 | 5 |
| Item | unpackable | 선택 | boolean | src/shared/types.ts:601 | 2 |
| Item | rawMaterialName | 선택 | string | src/shared/types.ts:602 | 7 |
| Item | packageType | 선택 | string | src/shared/types.ts:603 | 3 |
| Item | packageKg | 선택 | number | src/shared/types.ts:604 | 2 |
| Item | lots | 선택 | RawMaterialLot[] | src/shared/types.ts:605 | 39 |
| Item | mixEnabled | 선택 | boolean | src/shared/types.ts:606 | 4 |
| Item | mixTopPercent | 선택 | number | src/shared/types.ts:607 | 3 |
| Item | mixLotRatios | 선택 | { lotId: string; percent: number }[] | src/shared/types.ts:608 | 8 |
| Item | phantom | 선택 | boolean | src/shared/types.ts:609 | 12 |
| Item | archived | 선택 | boolean | src/shared/types.ts:611 | 38 |
| PalletStock | id | 필수 | string | src/shared/types.ts:616 | 35 |
| PalletStock | name | 필수 | string | src/shared/types.ts:617 | 25 |
| PalletStock | total | 필수 | number | src/shared/types.ts:618 | 10 |
| PalletStock | inUse | 필수 | number | src/shared/types.ts:620 | 0 |
| PalletStock | damaged | 필수 | number | src/shared/types.ts:621 | 6 |
| PalletStock | hidden | 선택 | boolean | src/shared/types.ts:622 | 9 |
| PalletTransaction | id | 필수 | string | src/shared/types.ts:626 | 12 |
| PalletTransaction | partnerId | 필수 | string | src/shared/types.ts:627 | 6 |
| PalletTransaction | palletId | 필수 | string | src/shared/types.ts:628 | 6 |
| PalletTransaction | type | 필수 | 'in' \| 'out' | src/shared/types.ts:629 | 9 |
| PalletTransaction | quantity | 필수 | number | src/shared/types.ts:630 | 13 |
| PalletTransaction | date | 필수 | string | src/shared/types.ts:631 | 6 |
| PalletTransaction | note | 선택 | string | src/shared/types.ts:632 | 2 |
| PalletTransaction | status | 선택 | '교체중' \| '교체완료' | src/shared/types.ts:633 | 3 |
| PalletTransaction | exchangeReturnQty | 선택 | number | src/shared/types.ts:634 | 2 |
| PalletTransaction | isTransfer | 선택 | boolean | src/shared/types.ts:635 | 5 |
| Post | id | 필수 | string | src/shared/types.ts:640 | 6 |
| Post | title | 필수 | string | src/shared/types.ts:641 | 5 |
| Post | author | 필수 | string | src/shared/types.ts:642 | 4 |
| Post | content | 필수 | string | src/shared/types.ts:643 | 3 |
| Post | date | 필수 | string | src/shared/types.ts:644 | 4 |
| Post | tag | 필수 | '공지' \| '긴급' \| '매뉴얼' \| '업무' | src/shared/types.ts:645 | 8 |
| Post | pinned | 선택 | boolean | src/shared/types.ts:646 | 6 |
| Post | blocks | 선택 | ({ type: 'text'; text: string; format?: 'paragraph' \| 'heading' \| 'subheading' \| 'list'; bold?: boolean; link?: string } \| { type: 'image'; url: string; path: string; caption: string })[] | src/shared/types.ts:647 | 5 |
| FileItem | id | 필수 | string | src/shared/types.ts:651 | 0 |
| FileItem | name | 필수 | string | src/shared/types.ts:652 | 0 |
| FileItem | type | 필수 | 'pdf' \| 'excel' \| 'image' \| 'word' | src/shared/types.ts:653 | 0 |
| FileItem | size | 필수 | string | src/shared/types.ts:654 | 0 |
| FileItem | date | 필수 | string | src/shared/types.ts:655 | 0 |
| FileItem | uploader | 필수 | string | src/shared/types.ts:656 | 0 |
| CabinetCategory | id | 필수 | string | src/shared/types.ts:662 | 2 |
| CabinetCategory | companyId | 선택 | CompanyId | src/shared/types.ts:663 | 0 |
| CabinetCategory | name | 필수 | string | src/shared/types.ts:664 | 12 |
| CabinetCategory | order | 필수 | number | src/shared/types.ts:665 | 1 |
| CabinetCategory | createdAt | 필수 | string | src/shared/types.ts:666 | 0 |
| CabinetSubCategory | id | 필수 | string | src/shared/types.ts:670 | 2 |
| CabinetSubCategory | companyId | 선택 | CompanyId | src/shared/types.ts:671 | 0 |
| CabinetSubCategory | category | 필수 | string | src/shared/types.ts:672 | 6 |
| CabinetSubCategory | name | 필수 | string | src/shared/types.ts:673 | 11 |
| CabinetSubCategory | order | 필수 | number | src/shared/types.ts:674 | 1 |
| CabinetSubCategory | createdAt | 필수 | string | src/shared/types.ts:675 | 0 |
| CabinetDoc | id | 필수 | string | src/shared/types.ts:679 | 3 |
| CabinetDoc | companyId | 선택 | CompanyId | src/shared/types.ts:680 | 0 |
| CabinetDoc | category | 필수 | string | src/shared/types.ts:681 | 3 |
| CabinetDoc | subCategory | 필수 | string | src/shared/types.ts:682 | 3 |
| CabinetDoc | fileName | 필수 | string | src/shared/types.ts:683 | 5 |
| CabinetDoc | storagePath | 필수 | string | src/shared/types.ts:684 | 1 |
| CabinetDoc | downloadUrl | 필수 | string | src/shared/types.ts:685 | 1 |
| CabinetDoc | size | 필수 | number | src/shared/types.ts:686 | 1 |
| CabinetDoc | contentType | 필수 | string | src/shared/types.ts:687 | 1 |
| CabinetDoc | note | 선택 | string | src/shared/types.ts:688 | 3 |
| CabinetDoc | uploadedBy | 필수 | string | src/shared/types.ts:689 | 1 |
| CabinetDoc | uploadedAt | 필수 | string | src/shared/types.ts:690 | 2 |
| AnnualLeave | carryOverLeave | 필수 | number | src/shared/types.ts:697 | 7 |
| AnnualLeave | bonusLeave | 필수 | number | src/shared/types.ts:698 | 7 |
| Employee | id | 필수 | string | src/shared/types.ts:702 | 138 |
| Employee | companyId | 선택 | CompanyId | src/shared/types.ts:704 | 4 |
| Employee | name | 필수 | string | src/shared/types.ts:705 | 99 |
| Employee | username | 선택 | string | src/shared/types.ts:706 | 1 |
| Employee | position | 필수 | string | src/shared/types.ts:707 | 25 |
| Employee | department | 필수 | string | src/shared/types.ts:708 | 21 |
| Employee | joinDate | 필수 | string | src/shared/types.ts:709 | 12 |
| Employee | status | 필수 | EmployeeStatus | src/shared/types.ts:710 | 5 |
| Employee | phone | 필수 | string | src/shared/types.ts:711 | 9 |
| Employee | birthDate | 선택 | string | src/shared/types.ts:712 | 1 |
| Employee | annualLeave | 선택 | AnnualLeave | src/shared/types.ts:713 | 12 |
| Employee | healthCertDate | 선택 | string | src/shared/types.ts:714 | 7 |
| Employee | adminAccess | 선택 | boolean | src/shared/types.ts:719 | 2 |
| Employee | fcmTokens | 선택 | string[] | src/shared/types.ts:724 | 1 |
| Employee | fcmDevices | 선택 | Record<string, { name: string; at: string }> | src/shared/types.ts:735 | 1 |
| PayrollLine | employeeId | 필수 | string | src/shared/types.ts:743 | 4 |
| PayrollLine | employeeName | 필수 | string | src/shared/types.ts:744 | 3 |
| PayrollLine | department | 선택 | string | src/shared/types.ts:745 | 3 |
| PayrollLine | position | 선택 | string | src/shared/types.ts:746 | 2 |
| PayrollLine | base | 필수 | number | src/shared/types.ts:747 | 2 |
| PayrollLine | overtime | 선택 | number | src/shared/types.ts:748 | 2 |
| PayrollLine | allowance | 선택 | number | src/shared/types.ts:749 | 2 |
| PayrollLine | incomeTax | 선택 | number | src/shared/types.ts:750 | 2 |
| PayrollLine | localTax | 선택 | number | src/shared/types.ts:751 | 2 |
| PayrollLine | pension | 선택 | number | src/shared/types.ts:752 | 2 |
| PayrollLine | health | 선택 | number | src/shared/types.ts:753 | 2 |
| PayrollLine | employment | 선택 | number | src/shared/types.ts:754 | 2 |
| PayrollLine | otherDeduct | 선택 | number | src/shared/types.ts:755 | 2 |
| PayrollLine | note | 선택 | string | src/shared/types.ts:756 | 0 |
| Payroll | id | 필수 | string | src/shared/types.ts:760 | 3 |
| Payroll | companyId | 선택 | CompanyId | src/shared/types.ts:762 | 0 |
| Payroll | yearMonth | 필수 | string | src/shared/types.ts:763 | 0 |
| Payroll | payDate | 필수 | string | src/shared/types.ts:764 | 1 |
| Payroll | lines | 필수 | PayrollLine[] | src/shared/types.ts:765 | 2 |
| Payroll | cashEntryId | 선택 | string | src/shared/types.ts:766 | 1 |
| Payroll | note | 선택 | string | src/shared/types.ts:767 | 0 |
| Payroll | createdAt | 선택 | string | src/shared/types.ts:768 | 0 |
| Payroll | updatedAt | 선택 | string | src/shared/types.ts:769 | 0 |
| LeaveModifyRequest | startDate | 필수 | string | src/shared/types.ts:804 | 3 |
| LeaveModifyRequest | endDate | 필수 | string | src/shared/types.ts:805 | 3 |
| LeaveModifyRequest | reason | 필수 | string | src/shared/types.ts:806 | 3 |
| LeaveModifyRequest | daysUsed | 필수 | number | src/shared/types.ts:807 | 3 |
| LeaveModifyRequest | status | 필수 | 'pending' \| 'approved' \| 'rejected' | src/shared/types.ts:808 | 7 |
| LeaveRequest | id | 필수 | string | src/shared/types.ts:812 | 19 |
| LeaveRequest | employeeId | 필수 | string | src/shared/types.ts:813 | 8 |
| LeaveRequest | employeeName | 필수 | string | src/shared/types.ts:814 | 6 |
| LeaveRequest | type | 필수 | LeaveType | src/shared/types.ts:815 | 10 |
| LeaveRequest | startDate | 필수 | string | src/shared/types.ts:816 | 17 |
| LeaveRequest | endDate | 필수 | string | src/shared/types.ts:817 | 11 |
| LeaveRequest | reason | 필수 | string | src/shared/types.ts:818 | 6 |
| LeaveRequest | status | 필수 | LeaveStatus | src/shared/types.ts:819 | 24 |
| LeaveRequest | requestedAt | 필수 | string | src/shared/types.ts:820 | 4 |
| LeaveRequest | daysUsed | 필수 | number | src/shared/types.ts:821 | 10 |
| LeaveRequest | deductsLeave | 선택 | boolean | src/shared/types.ts:827 | 1 |
| LeaveRequest | modifyRequest | 선택 | LeaveModifyRequest | src/shared/types.ts:828 | 19 |
| LeaveRequest | cancelledAt | 선택 | string | src/shared/types.ts:834 | 2 |
| LeaveRequest | cancelledBy | 선택 | string | src/shared/types.ts:835 | 0 |
| LeaveRequest | cancelledByName | 선택 | string | src/shared/types.ts:836 | 1 |
| LeaveRequest | cancelReason | 선택 | string | src/shared/types.ts:837 | 2 |
| ChatMessage | id | 필수 | string | src/shared/types.ts:841 | 18 |
| ChatMessage | companyId | 선택 | CompanyId | src/shared/types.ts:842 | 2 |
| ChatMessage | roomId | 필수 | string | src/shared/types.ts:843 | 7 |
| ChatMessage | senderId | 필수 | string | src/shared/types.ts:844 | 11 |
| ChatMessage | senderName | 필수 | string | src/shared/types.ts:845 | 9 |
| ChatMessage | text | 필수 | string | src/shared/types.ts:846 | 20 |
| ChatMessage | imageUrl | 선택 | string | src/shared/types.ts:847 | 4 |
| ChatMessage | images | 선택 | string[] | src/shared/types.ts:854 | 2 |
| ChatMessage | createdAt | 필수 | string | src/shared/types.ts:855 | 6 |
| ChatMessage | mentions | 선택 | string[] | src/shared/types.ts:856 | 0 |
| ChatMessage | fileUrl | 선택 | string | src/shared/types.ts:858 | 4 |
| ChatMessage | fileName | 선택 | string | src/shared/types.ts:859 | 3 |
| ChatMessage | fileSize | 선택 | number | src/shared/types.ts:860 | 4 |
| ChatMessage | replyTo | 선택 | { id: string; senderName: string; text: string } | src/shared/types.ts:865 | 3 |
| ChatMessage | deletedAt | 선택 | string | src/shared/types.ts:870 | 4 |
| ChatMessage | deletedBy | 선택 | string | src/shared/types.ts:871 | 0 |
| ChatMessage | reactions | 선택 | Record<string, string[]> | src/shared/types.ts:877 | 6 |
| ChatRoom | id | 필수 | string | src/shared/types.ts:881 | 25 |
| ChatRoom | companyId | 선택 | CompanyId | src/shared/types.ts:882 | 0 |
| ChatRoom | name | 선택 | string | src/shared/types.ts:884 | 4 |
| ChatRoom | nameBy | 선택 | Record<string, string> | src/shared/types.ts:886 | 1 |
| ChatRoom | createdBy | 선택 | string | src/shared/types.ts:888 | 0 |
| ChatRoom | participantIds | 필수 | string[] | src/shared/types.ts:889 | 12 |
| ChatRoom | participantCompanies | 선택 | Record<string, CompanyId> | src/shared/types.ts:891 | 0 |
| ChatRoom | lastMessage | 선택 | string | src/shared/types.ts:892 | 1 |
| ChatRoom | lastUpdatedAt | 필수 | string | src/shared/types.ts:893 | 5 |
| ChatRoom | isGroup | 필수 | boolean | src/shared/types.ts:894 | 7 |
| ChatRoom | lastReadBy | 선택 | Record<string, string> | src/shared/types.ts:895 | 5 |
| ChatRoom | pinnedBy | 선택 | Record<string, string> | src/shared/types.ts:903 | 3 |
| ChatRoom | notice | 선택 | RoomNotice \| null | src/shared/types.ts:911 | 2 |
| RoomNotice | messageId | 필수 | string | src/shared/types.ts:917 | 1 |
| RoomNotice | text | 필수 | string | src/shared/types.ts:918 | 2 |
| RoomNotice | by | 필수 | string | src/shared/types.ts:920 | 0 |
| RoomNotice | byName | 필수 | string | src/shared/types.ts:921 | 1 |
| RoomNotice | at | 필수 | string | src/shared/types.ts:923 | 1 |
| ProductionRecord | id | 필수 | string | src/shared/types.ts:931 | 9 |
| ProductionRecord | date | 필수 | string | src/shared/types.ts:932 | 4 |
| ProductionRecord | itemId | 필수 | string | src/shared/types.ts:933 | 8 |
| ProductionRecord | itemName | 필수 | string | src/shared/types.ts:934 | 3 |
| ProductionRecord | finishedQty | 필수 | number | src/shared/types.ts:935 | 3 |
| ProductionRecord | wipUsed | 선택 | number | src/shared/types.ts:936 | 1 |
| ProductionRecord | wipItemId | 선택 | string | src/shared/types.ts:937 | 0 |
| ProductionRecord | wipItemName | 선택 | string | src/shared/types.ts:938 | 2 |
| ProductionRecord | cost | 선택 | number | src/shared/types.ts:939 | 0 |
| ProductionRecord | note | 선택 | string | src/shared/types.ts:940 | 2 |
| ProductionRecord | createdBy | 선택 | string | src/shared/types.ts:941 | 0 |
| ProductionRecord | createdAt | 필수 | string | src/shared/types.ts:942 | 0 |
| FixedCostEntry | id | 필수 | string | src/shared/types.ts:949 | 0 |
| FixedCostEntry | yearMonth | 필수 | string | src/shared/types.ts:950 | 1 |
| FixedCostEntry | category | 필수 | FixedCostCategory | src/shared/types.ts:951 | 0 |
| FixedCostEntry | label | 필수 | string | src/shared/types.ts:952 | 0 |
| FixedCostEntry | amount | 필수 | number | src/shared/types.ts:953 | 1 |
| FixedCostEntry | accountCode | 선택 | string | src/shared/types.ts:954 | 0 |
| FixedCostEntry | note | 선택 | string | src/shared/types.ts:955 | 0 |
| FixedCostEntry | createdAt | 필수 | string | src/shared/types.ts:956 | 0 |
| FixedCostTemplate | statementType | 선택 | '매출' \| '매입' \| '비용' | src/shared/types.ts:960 | 2 |
| FixedCostTemplate | companyId | 선택 | CompanyId | src/shared/types.ts:970 | 3 |
| FixedCostTemplate | transferLines | 선택 | { accountCode: string; side: '차변' \| '대변'; name?: string }[] | src/shared/types.ts:972 | 7 |
| FixedCostTemplate | id | 필수 | string | src/shared/types.ts:973 | 16 |
| FixedCostTemplate | name | 필수 | string | src/shared/types.ts:974 | 19 |
| FixedCostTemplate | amount | 필수 | number | src/shared/types.ts:975 | 14 |
| FixedCostTemplate | category | 필수 | FixedCostCategory | src/shared/types.ts:976 | 1 |
| FixedCostTemplate | active | 필수 | boolean | src/shared/types.ts:977 | 1 |
| FixedCostTemplate | note | 선택 | string | src/shared/types.ts:978 | 1 |
| FixedCostTemplate | accountCode | 선택 | string | src/shared/types.ts:980 | 15 |
| FixedCostTemplate | partnerId | 선택 | string | src/shared/types.ts:981 | 4 |
| FixedCostTemplate | partnerName | 선택 | string | src/shared/types.ts:982 | 11 |
| FixedCostTemplate | startYm | 선택 | string | src/shared/types.ts:983 | 2 |
| FixedCostTemplate | endYm | 선택 | string | src/shared/types.ts:984 | 1 |
| FixedCostTemplate | kind | 선택 | 'recurring' \| 'voucher' | src/shared/types.ts:989 | 3 |
| FixedCostTemplate | dir | 선택 | '입금' \| '출금' \| '줄돈' \| '받을돈' \| '대체' \| '회사이체' | src/shared/types.ts:1002 | 3 |
| FixedCostTemplate | mode | 선택 | '일반' \| '상환' \| '급여' \| '보험' \| '세금' | src/shared/types.ts:1003 | 22 |
| FixedCostTemplate | insCorp | 선택 | number | src/shared/types.ts:1015 | 1 |
| FixedCostTemplate | insEmp | 선택 | number | src/shared/types.ts:1015 | 1 |
| FixedCostTemplate | principal | 선택 | number | src/shared/types.ts:1016 | 4 |
| FixedCostTemplate | interest | 선택 | number | src/shared/types.ts:1016 | 4 |
| FixedCostTemplate | gross | 선택 | number | src/shared/types.ts:1017 | 1 |
| FixedCostTemplate | deduction | 선택 | number | src/shared/types.ts:1017 | 1 |
| FixedCostTemplate | loanCode | 선택 | string | src/shared/types.ts:1019 | 4 |
| FixedCostTemplate | loanId | 선택 | string | src/shared/types.ts:1021 | 6 |
| FixedCostTemplate | vat | 선택 | number | src/shared/types.ts:1023 | 0 |
| FixedCostTemplate | incomeTax | 선택 | number | src/shared/types.ts:1023 | 0 |
| FixedCostTemplate | builtin | 선택 | string | src/shared/types.ts:1025 | 8 |
| FixedCostTemplate | hidden | 선택 | boolean | src/shared/types.ts:1027 | 6 |
| FixedCostTemplate | group | 선택 | string | src/shared/types.ts:1029 | 10 |
| FixedCostTemplate | favorite | 선택 | boolean | src/shared/types.ts:1031 | 6 |
| FixedCostTemplate | autoIssue | 선택 | boolean | src/shared/types.ts:1034 | 12 |
| FixedCostTemplate | issueDay | 선택 | number | src/shared/types.ts:1036 | 11 |
| FixedCostTemplate | taxExempt | 선택 | boolean | src/shared/types.ts:1038 | 2 |
| FixedCostTemplate | itemName | 선택 | string | src/shared/types.ts:1043 | 2 |
| IssuedStatementItem | sourceLineIndex | 선택 | number | src/shared/types.ts:1065 | 1 |
| IssuedStatementItem | purchaseQuantityKg | 선택 | number | src/shared/types.ts:1067 | 1 |
| IssuedStatementItem | itemId | 선택 | string | src/shared/types.ts:1069 | 15 |
| IssuedStatementItem | lineKind | 선택 | StatementLineKind | src/shared/types.ts:1071 | 1 |
| IssuedStatementItem | name | 필수 | string | src/shared/types.ts:1072 | 27 |
| IssuedStatementItem | spec | 필수 | string | src/shared/types.ts:1073 | 4 |
| IssuedStatementItem | qty | 필수 | number | src/shared/types.ts:1074 | 19 |
| IssuedStatementItem | price | 필수 | number | src/shared/types.ts:1075 | 2 |
| IssuedStatementItem | supply | 필수 | number | src/shared/types.ts:1076 | 17 |
| IssuedStatementItem | tax | 필수 | number | src/shared/types.ts:1077 | 13 |
| IssuedStatementItem | total | 필수 | number | src/shared/types.ts:1078 | 21 |
| IssuedStatementItem | isTaxExempt | 필수 | boolean | src/shared/types.ts:1079 | 4 |
| IssuedStatementItem | accountCode | 선택 | string | src/shared/types.ts:1084 | 20 |
| IssuedStatementItem | side | 선택 | '차변' \| '대변' | src/shared/types.ts:1097 | 15 |
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
| IssuedStatement | noncashApplication | 선택 | import('../../functions/src/shared/partnerAdvance').ApplicationMetadata \| import('../../functions/src/shared/partnerAdvance').CancellationMetadata | src/shared/types.ts:1118 | 9 |
| IssuedStatement | id | 필수 | string | src/shared/types.ts:1119 | 142 |
| IssuedStatement | mutationRevision | 선택 | number | src/shared/types.ts:1121 | 4 |
| IssuedStatement | openingItemId | 선택 | string | src/shared/types.ts:1123 | 0 |
| IssuedStatement | openingQuantity | 선택 | number | src/shared/types.ts:1124 | 0 |
| IssuedStatement | companyId | 선택 | CompanyId | src/shared/types.ts:1126 | 15 |
| IssuedStatement | issuedAt | 필수 | string | src/shared/types.ts:1127 | 15 |
| IssuedStatement | tradeDate | 필수 | string | src/shared/types.ts:1128 | 86 |
| IssuedStatement | type | 필수 | '매출' \| '매입' \| '비용' | src/shared/types.ts:1129 | 74 |
| IssuedStatement | partnerId | 필수 | string | src/shared/types.ts:1130 | 80 |
| IssuedStatement | partnerName | 필수 | string | src/shared/types.ts:1131 | 31 |
| IssuedStatement | orderId | 필수 | string | src/shared/types.ts:1132 | 8 |
| IssuedStatement | docNo | 필수 | string | src/shared/types.ts:1133 | 43 |
| IssuedStatement | totalSupply | 필수 | number | src/shared/types.ts:1134 | 8 |
| IssuedStatement | totalTax | 필수 | number | src/shared/types.ts:1135 | 9 |
| IssuedStatement | totalAmount | 필수 | number | src/shared/types.ts:1136 | 56 |
| IssuedStatement | items | 필수 | IssuedStatementItem[] | src/shared/types.ts:1137 | 62 |
| IssuedStatement | partySnapshot | 선택 | StatementPartySnapshot | src/shared/types.ts:1139 | 3 |
| IssuedStatement | memo | 선택 | string | src/shared/types.ts:1144 | 5 |
| IssuedStatement | createdBy | 선택 | string | src/shared/types.ts:1152 | 4 |
| IssuedStatement | evidence | 선택 | string | src/shared/types.ts:1160 | 0 |
| IssuedStatement | taxIssuedAt | 선택 | string | src/shared/types.ts:1161 | 9 |
| IssuedStatement | exemptIssuedAt | 선택 | string | src/shared/types.ts:1167 | 0 |
| IssuedStatement | cashDir | 선택 | '입금' \| '출금' | src/shared/types.ts:1168 | 0 |
| PurchaseOrderItem | sourceLineIndex | 선택 | number | src/shared/types.ts:1186 | 4 |
| PurchaseOrderItem | itemId | 필수 | string | src/shared/types.ts:1187 | 50 |
| PurchaseOrderItem | name | 필수 | string | src/shared/types.ts:1188 | 24 |
| PurchaseOrderItem | quantity | 필수 | number | src/shared/types.ts:1190 | 29 |
| PurchaseOrderItem | unit | 필수 | string | src/shared/types.ts:1191 | 12 |
| PurchaseOrderItem | boxQuantity | 선택 | number | src/shared/types.ts:1197 | 0 |
| PurchaseOrder | id | 필수 | string | src/shared/types.ts:1201 | 87 |
| PurchaseOrder | companyId | 선택 | CompanyId | src/shared/types.ts:1203 | 5 |
| PurchaseOrder | itemId | 필수 | string | src/shared/types.ts:1204 | 5 |
| PurchaseOrder | itemName | 필수 | string | src/shared/types.ts:1205 | 1 |
| PurchaseOrder | partnerId | 선택 | string | src/shared/types.ts:1206 | 16 |
| PurchaseOrder | partnerName | 선택 | string | src/shared/types.ts:1207 | 21 |
| PurchaseOrder | quantity | 필수 | number | src/shared/types.ts:1208 | 11 |
| PurchaseOrder | unit | 선택 | string | src/shared/types.ts:1209 | 1 |
| PurchaseOrder | boxQuantity | 선택 | number | src/shared/types.ts:1211 | 1 |
| PurchaseOrder | status | 필수 | 'pending' \| 'invoiced' \| 'received' \| 'cancelled' | src/shared/types.ts:1212 | 57 |
| PurchaseOrder | duplicateReceiptCorrection | 선택 | {operationId:string;originalOperationId:string;commandHash:string;originalHash:string;proofHash:string;kg:number;reason:string;cancelledAt:string} | src/shared/types.ts:1213 | 2 |
| PurchaseOrder | confirmedByUser | 선택 | boolean | src/shared/types.ts:1214 | 1 |
| PurchaseOrder | linkedStatementId | 선택 | string | src/shared/types.ts:1215 | 24 |
| PurchaseOrder | cardNo | 선택 | string | src/shared/types.ts:1220 | 2 |
| PurchaseOrder | linkedStatementAt | 선택 | string | src/shared/types.ts:1221 | 0 |
| PurchaseOrder | createdAt | 필수 | string | src/shared/types.ts:1222 | 11 |
| PurchaseOrder | invoicedAt | 선택 | string | src/shared/types.ts:1223 | 5 |
| PurchaseOrder | receivedAt | 선택 | string | src/shared/types.ts:1224 | 7 |
| PurchaseOrder | items | 선택 | PurchaseOrderItem[] | src/shared/types.ts:1225 | 16 |
| PurchaseOrder | photoUrl | 선택 | string | src/shared/types.ts:1226 | 0 |
| PurchaseOrder | note | 선택 | string | src/shared/types.ts:1227 | 1 |
| PurchaseOrder | poType | 선택 | 'oem' | src/shared/types.ts:1231 | 33 |
| PurchaseOrder | oemCostEvidence | 선택 | OemCostEvidence | src/shared/types.ts:1233 | 8 |
| PurchaseOrder | oemCostEvidenceSource | 선택 | 'issue' \| 'receipt' | src/shared/types.ts:1235 | 0 |
| PurchaseOrder | oemBatchCost | 선택 | OemBatchCostPreview \| OemBatchCostBlocked \| OemBatchCost | src/shared/types.ts:1237 | 2 |
| PurchaseOrder | oemPartnerId | 선택 | string | src/shared/types.ts:1238 | 4 |
| PurchaseOrder | oemSent | 선택 | { material: string; kg: number; rawItemId?: string }[] | src/shared/types.ts:1239 | 15 |
| PurchaseOrder | oemSentAt | 선택 | string | src/shared/types.ts:1240 | 1 |
| PurchaseOrder | oemIssueStatus | 선택 | 'processing' \| 'failed' \| 'complete' | src/shared/types.ts:1242 | 3 |
| PurchaseOrder | oemCancelledAt | 선택 | string | src/shared/types.ts:1243 | 17 |
| PurchaseOrder | oemCancelOperationId | 선택 | string | src/shared/types.ts:1244 | 9 |
| PurchaseOrder | oemIssueFingerprint | 선택 | string | src/shared/types.ts:1245 | 3 |
| PurchaseOrder | oemIssueDate | 선택 | string | src/shared/types.ts:1246 | 3 |
| PurchaseOrder | oemIssuedBy | 선택 | string | src/shared/types.ts:1247 | 1 |
| PurchaseOrder | oemIssueError | 선택 | string | src/shared/types.ts:1248 | 0 |
| PurchaseOrder | oemReceivedKg | 선택 | number | src/shared/types.ts:1249 | 7 |
| PurchaseOrder | oemReceivedBulk | 선택 | { material: string; kg: number }[] | src/shared/types.ts:1250 | 5 |
| PurchaseOrder | oemFeePerKg | 선택 | number | src/shared/types.ts:1251 | 3 |
| PurchaseOrder | oemReceiptOperationId | 선택 | string | src/shared/types.ts:1253 | 3 |
| CompanyInfo | name | 필수 | string | src/shared/types.ts:1287 | 4 |
| CompanyInfo | ceoName | 필수 | string | src/shared/types.ts:1288 | 3 |
| CompanyInfo | bizNo | 필수 | string | src/shared/types.ts:1289 | 3 |
| CompanyInfo | bizType | 필수 | string | src/shared/types.ts:1290 | 2 |
| CompanyInfo | bizItem | 필수 | string | src/shared/types.ts:1291 | 2 |
| CompanyInfo | address | 필수 | string | src/shared/types.ts:1292 | 3 |
| CompanyInfo | phone | 선택 | string | src/shared/types.ts:1293 | 2 |
| CompanyInfo | fax | 선택 | string | src/shared/types.ts:1294 | 2 |
| CompanyInfo | email | 선택 | string | src/shared/types.ts:1295 | 0 |
| CompanyInfo | bankAccount | 선택 | string | src/shared/types.ts:1296 | 3 |
| CompanyInfo | adminPassword | 선택 | string | src/shared/types.ts:1297 | 2 |
| ExpensePreset | id | 필수 | string | src/shared/types.ts:1302 | 2 |
| ExpensePreset | name | 필수 | string | src/shared/types.ts:1303 | 2 |
| ExpensePreset | price | 선택 | number | src/shared/types.ts:1304 | 2 |
| ExpensePreset | taxType | 선택 | '과세' \| '면세' | src/shared/types.ts:1305 | 1 |
| ExpensePreset | createdAt | 선택 | string | src/shared/types.ts:1306 | 0 |
| AppNotification | id | 필수 | string | src/shared/types.ts:1310 | 5 |
| AppNotification | type | 필수 | 'new_order' \| 'confirmation' \| 'mention' \| 'leave_request' \| 'inventory_shortage' | src/shared/types.ts:1311 | 8 |
| AppNotification | title | 필수 | string | src/shared/types.ts:1312 | 1 |
| AppNotification | body | 필수 | string | src/shared/types.ts:1313 | 3 |
| AppNotification | readBy | 필수 | string[] | src/shared/types.ts:1314 | 4 |
| AppNotification | dismissedBy | 선택 | string[] | src/shared/types.ts:1315 | 1 |
| AppNotification | createdAt | 필수 | string | src/shared/types.ts:1316 | 3 |
| AppNotification | linkedId | 선택 | string | src/shared/types.ts:1317 | 4 |
| AppNotification | senderId | 선택 | string | src/shared/types.ts:1318 | 0 |
| AppNotification | targetId | 선택 | string | src/shared/types.ts:1319 | 2 |
| RawMaterialEntry | id | 필수 | string | src/shared/types.ts:1337 | 42 |
| RawMaterialEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1339 | 5 |
| RawMaterialEntry | rawItemId | 선택 | string | src/shared/types.ts:1350 | 13 |
| RawMaterialEntry | kind | 선택 | RawMovementKind | src/shared/types.ts:1351 | 16 |
| RawMaterialEntry | reversalOf | 선택 | string | src/shared/types.ts:1352 | 5 |
| RawMaterialEntry | material | 필수 | string | src/shared/types.ts:1354 | 37 |
| RawMaterialEntry | date | 필수 | string | src/shared/types.ts:1355 | 23 |
| RawMaterialEntry | received | 필수 | number | src/shared/types.ts:1356 | 18 |
| RawMaterialEntry | used | 필수 | number | src/shared/types.ts:1357 | 17 |
| RawMaterialEntry | note | 필수 | string | src/shared/types.ts:1358 | 13 |
| RawMaterialEntry | createdAt | 필수 | string | src/shared/types.ts:1359 | 12 |
| RawMaterialEntry | recordedAt | 선택 | string | src/shared/types.ts:1361 | 7 |
| RawMaterialEntry | sequence | 선택 | number | src/shared/types.ts:1363 | 3 |
| RawMaterialEntry | effectiveAt | 선택 | string | src/shared/types.ts:1365 | 8 |
| RawMaterialEntry | balanceAfterKg | 선택 | number | src/shared/types.ts:1367 | 3 |
| RawMaterialEntry | addedBy | 선택 | string | src/shared/types.ts:1368 | 8 |
| RawMaterialEntry | type | 선택 | 'auto' \| 'manual' \| 'correction' \| 'stocktake_unit' | src/shared/types.ts:1369 | 13 |
| RawMaterialEntry | orderId | 선택 | string | src/shared/types.ts:1370 | 2 |
| RawMaterialEntry | canSize | 선택 | number | src/shared/types.ts:1371 | 2 |
| RawMaterialEntry | canSizeTag | 선택 | string | src/shared/types.ts:1372 | 2 |
| RawMaterialEntry | canCount | 선택 | number | src/shared/types.ts:1373 | 4 |
| RawMaterialEntry | unit | 선택 | 'kg' \| 'L' | src/shared/types.ts:1374 | 7 |
| RawMaterialEntry | originalAmount | 선택 | number | src/shared/types.ts:1376 | 1 |
| RawMaterialEntry | originalUnit | 선택 | 'kg' \| 'L' | src/shared/types.ts:1377 | 1 |
| RawMaterialEntry | targetKg | 선택 | number | src/shared/types.ts:1378 | 14 |
| RawMaterialEntry | targetLotId | 선택 | string | src/shared/types.ts:1380 | 4 |
| ItemFormula | id | 필수 | string | src/shared/types.ts:1388 | 1 |
| ItemFormula | parent_key | 필수 | string | src/shared/types.ts:1389 | 10 |
| ItemFormula | child_name | 필수 | string | src/shared/types.ts:1390 | 6 |
| ItemFormula | ratio | 필수 | number | src/shared/types.ts:1391 | 5 |
| ItemFormula | yield_rate | 필수 | number | src/shared/types.ts:1392 | 4 |
| ItemBom | id | 필수 | string | src/shared/types.ts:1397 | 4 |
| ItemBom | parent_id | 필수 | string | src/shared/types.ts:1398 | 14 |
| ItemBom | child_id | 필수 | string | src/shared/types.ts:1399 | 11 |
| ItemBom | quantity | 필수 | number | src/shared/types.ts:1400 | 3 |
| ReturnItem | sourceLineIndex | 선택 | number | src/shared/types.ts:1409 | 1 |
| ReturnItem | itemId | 필수 | string | src/shared/types.ts:1410 | 17 |
| ReturnItem | name | 필수 | string | src/shared/types.ts:1411 | 8 |
| ReturnItem | quantity | 필수 | number | src/shared/types.ts:1412 | 14 |
| ReturnItem | price | 필수 | number | src/shared/types.ts:1413 | 3 |
| ReturnItem | reason | 필수 | ReturnReason | src/shared/types.ts:1414 | 3 |
| ReturnItem | isResellable | 필수 | boolean | src/shared/types.ts:1415 | 8 |
| ReturnItem | supply | 선택 | number | src/shared/types.ts:1416 | 0 |
| ReturnItem | tax | 선택 | number | src/shared/types.ts:1417 | 0 |
| ReturnItem | accountCode | 선택 | string | src/shared/types.ts:1418 | 0 |
| ReturnRequest | id | 필수 | string | src/shared/types.ts:1422 | 18 |
| ReturnRequest | companyId | 선택 | CompanyId | src/shared/types.ts:1423 | 5 |
| ReturnRequest | orderId | 선택 | string | src/shared/types.ts:1424 | 2 |
| ReturnRequest | partnerId | 필수 | string | src/shared/types.ts:1425 | 3 |
| ReturnRequest | partnerName | 필수 | string | src/shared/types.ts:1426 | 6 |
| ReturnRequest | items | 필수 | ReturnItem[] | src/shared/types.ts:1427 | 17 |
| ReturnRequest | totalAmount | 필수 | number | src/shared/types.ts:1428 | 5 |
| ReturnRequest | status | 필수 | 'pending' \| 'processed' | src/shared/types.ts:1429 | 18 |
| ReturnRequest | returnType | 선택 | '매출' \| '매입' | src/shared/types.ts:1430 | 4 |
| ReturnRequest | createdAt | 필수 | string | src/shared/types.ts:1431 | 7 |
| ReturnRequest | createdBy | 선택 | string | src/shared/types.ts:1432 | 0 |
| ReturnRequest | processedAt | 선택 | string | src/shared/types.ts:1433 | 4 |
| ReturnRequest | processedBy | 선택 | string | src/shared/types.ts:1434 | 1 |
| ReturnRequest | cancelledAt | 선택 | string | src/shared/types.ts:1435 | 15 |
| ReturnRequest | cancelledBy | 선택 | string | src/shared/types.ts:1436 | 0 |
| ReturnRequest | cancellationReceipt | 선택 | Record<string, unknown> | src/shared/types.ts:1437 | 0 |
| ReturnRequest | linkedStatementId | 선택 | string | src/shared/types.ts:1438 | 8 |
| ReturnRequest | payableAccountCode | 선택 | typeof AP \| typeof OTHER_PAYABLE | src/shared/types.ts:1439 | 0 |
| ReturnRequest | note | 선택 | string | src/shared/types.ts:1440 | 3 |
| PendingStatementEdit | id | 필수 | string | src/shared/types.ts:1444 | 11 |
| PendingStatementEdit | statementId | 필수 | string | src/shared/types.ts:1445 | 2 |
| PendingStatementEdit | statementDocNo | 필수 | string | src/shared/types.ts:1446 | 1 |
| PendingStatementEdit | statementType | 필수 | '매출' \| '매입' | src/shared/types.ts:1447 | 1 |
| PendingStatementEdit | partnerName | 필수 | string | src/shared/types.ts:1448 | 1 |
| PendingStatementEdit | proposedData | 필수 | {     tradeDate: string;     partnerId: string;     partnerName: string;     totalSupply: number;     totalTax: number;     totalAmount: number;     items: IssuedStatementItem[];   } | src/shared/types.ts:1449 | 3 |
| PendingStatementEdit | createdAt | 필수 | string | src/shared/types.ts:1458 | 2 |
| PendingStatementEdit | createdBy | 필수 | string | src/shared/types.ts:1459 | 1 |
| PendingStatementEdit | status | 필수 | 'pending' \| 'approved' \| 'rejected' | src/shared/types.ts:1460 | 1 |
| PendingStatementEdit | reason | 선택 | string | src/shared/types.ts:1461 | 1 |
| PendingStatementEdit | changes | 선택 | { name: string; oldQty: number; newQty: number }[] | src/shared/types.ts:1462 | 2 |
| PendingStatementEdit | sourcePoId | 선택 | string | src/shared/types.ts:1463 | 0 |
| AccountCode | id | 필수 | string | src/shared/types.ts:1470 | 27 |
| AccountCode | code | 필수 | string | src/shared/types.ts:1471 | 104 |
| AccountCode | name | 필수 | string | src/shared/types.ts:1472 | 60 |
| AccountCode | groupId | 선택 | string | src/shared/types.ts:1473 | 11 |
| AccountCode | type | 선택 | AccountType | src/shared/types.ts:1475 | 18 |
| AccountCode | normalBalance | 선택 | 'debit' \| 'credit' | src/shared/types.ts:1476 | 10 |
| AccountCode | isCash | 선택 | boolean | src/shared/types.ts:1477 | 1 |
| AccountCode | noncash | 선택 | boolean | src/shared/types.ts:1482 | 0 |
| AccountCode | note | 선택 | string | src/shared/types.ts:1483 | 0 |
| JournalLine | accountCode | 필수 | string | src/shared/types.ts:1488 | 37 |
| JournalLine | debit | 필수 | number | src/shared/types.ts:1489 | 35 |
| JournalLine | credit | 필수 | number | src/shared/types.ts:1490 | 31 |
| JournalLine | partnerId | 선택 | string | src/shared/types.ts:1491 | 13 |
| JournalLine | note | 선택 | string | src/shared/types.ts:1492 | 1 |
| JournalEntry | id | 필수 | string | src/shared/types.ts:1496 | 10 |
| JournalEntry | date | 필수 | string | src/shared/types.ts:1497 | 17 |
| JournalEntry | lines | 필수 | JournalLine[] | src/shared/types.ts:1498 | 33 |
| JournalEntry | memo | 선택 | string | src/shared/types.ts:1499 | 3 |
| JournalEntry | sourceType | 필수 | '매출' \| '매입' \| '대체' \| '자금' \| '수동' | src/shared/types.ts:1500 | 9 |
| JournalEntry | sourceId | 선택 | string | src/shared/types.ts:1501 | 16 |
| JournalEntry | createdAt | 필수 | string | src/shared/types.ts:1502 | 0 |
| JournalEntry | createdBy | 선택 | string | src/shared/types.ts:1503 | 0 |
| AccountGroup | id | 필수 | string | src/shared/types.ts:1511 | 24 |
| AccountGroup | name | 필수 | string | src/shared/types.ts:1512 | 9 |
| AccountGroup | type | 필수 | '수익' \| '비용' \| '자산' \| '부채' \| '자본' | src/shared/types.ts:1513 | 6 |
| AccountGroup | plLine | 선택 | AccountGroupPlLine | src/shared/types.ts:1514 | 4 |
| AccountGroup | cfSection | 선택 | AccountGroupCfSection | src/shared/types.ts:1517 | 1 |
| AccountGroup | note | 선택 | string | src/shared/types.ts:1518 | 0 |
| CashAccount | id | 필수 | string | src/shared/types.ts:1526 | 34 |
| CashAccount | companyId | 선택 | CompanyId | src/shared/types.ts:1528 | 1 |
| CashAccount | name | 필수 | string | src/shared/types.ts:1529 | 12 |
| CashAccount | type | 필수 | '통장' \| '카드' \| '현금' | src/shared/types.ts:1530 | 17 |
| CashAccount | openingBalance | 필수 | number | src/shared/types.ts:1531 | 3 |
| CashAccount | openingDate | 필수 | string | src/shared/types.ts:1532 | 8 |
| CashAccount | active | 필수 | boolean | src/shared/types.ts:1533 | 18 |
| CashAccount | note | 선택 | string | src/shared/types.ts:1534 | 0 |
| CashAccount | confirmedBalances | 선택 | Array<{ date: string; balance: number; recordedAt: string; reason: string }> | src/shared/types.ts:1535 | 2 |
| CashAccount | createdAt | 필수 | string | src/shared/types.ts:1536 | 0 |
| CashEntry | id | 필수 | string | src/shared/types.ts:1540 | 77 |
| CashEntry | balanceAdjustment | 선택 | { before: number; target: number; delta: number; reason: string; confirmedBalance?: boolean } | src/shared/types.ts:1542 | 15 |
| CashEntry | linkedAccrualStatementId | 선택 | string | src/shared/types.ts:1544 | 2 |
| CashEntry | loanId | 선택 | string | src/shared/types.ts:1546 | 9 |
| CashEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1548 | 6 |
| CashEntry | docNo | 선택 | string | src/shared/types.ts:1554 | 10 |
| CashEntry | date | 필수 | string | src/shared/types.ts:1555 | 45 |
| CashEntry | cashAccountId | 필수 | string | src/shared/types.ts:1556 | 12 |
| CashEntry | dir | 필수 | '입금' \| '출금' \| '대체' | src/shared/types.ts:1567 | 49 |
| CashEntry | amount | 필수 | number | src/shared/types.ts:1568 | 31 |
| CashEntry | partnerId | 선택 | string | src/shared/types.ts:1569 | 49 |
| CashEntry | partnerName | 선택 | string | src/shared/types.ts:1570 | 18 |
| CashEntry | accountCode | 선택 | string | src/shared/types.ts:1571 | 24 |
| CashEntry | lines | 선택 | {     accountCode: string;     /**      * **언제나 양수로 적는다.** 차·대는 `side`가 말한다.      *      * `side`가 없는 옛 줄은 **부호가 곧 차·대**였다 — 양수면 통장 반대편, 음수면      * 통장과 같은 편(급여 원천공제가 그 길). 그 규칙은 `dir`에 매달려 있어서      * 입금·출금을 바꾸면 모든 줄의 뜻이 조용히 뒤집혔다. 읽는 쪽은 아직 그 줄도      * 받아 주지만(옛 데이터 호환), **새로 쓸 땐 `side`를 넣는다.**      */     amount: number;     /** 차변이냐 대변이냐. 대체전표 줄(`IssuedStatementItem.side`)과 같은 모양이다. */     side?: '차변' \| '대변';     note?: string;   }[] | src/shared/types.ts:1578 | 28 |
| CashEntry | offsetOf | 선택 | { ar: string; ap: string } | src/shared/types.ts:1594 | 0 |
| CashEntry | note | 선택 | string | src/shared/types.ts:1595 | 23 |
| CashEntry | createdAt | 필수 | string | src/shared/types.ts:1596 | 14 |
| CashEntry | createdBy | 선택 | string | src/shared/types.ts:1597 | 5 |
| Settlement | id | 필수 | string | src/shared/types.ts:1603 | 9 |
| Settlement | cashEntryId | 필수 | string | src/shared/types.ts:1604 | 17 |
| Settlement | statementId | 필수 | string | src/shared/types.ts:1605 | 14 |
| Settlement | amount | 필수 | number | src/shared/types.ts:1606 | 9 |
| Settlement | createdAt | 필수 | string | src/shared/types.ts:1607 | 0 |
| InventorySnapshot | id | 필수 | string | src/shared/types.ts:1611 | 5 |
| InventorySnapshot | companyId | 선택 | CompanyId | src/shared/types.ts:1614 | 0 |
| InventorySnapshot | yearMonth | 필수 | string | src/shared/types.ts:1615 | 8 |
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
| ProductionSalesLog | companyId | 선택 | CompanyId | src/shared/types.ts:1639 | 1 |
| ProductionSalesLog | date | 필수 | string | src/shared/types.ts:1640 | 12 |
| ProductionSalesLog | createdAt | 필수 | string | src/shared/types.ts:1641 | 2 |
| ProductionSalesLog | createdBy | 필수 | string | src/shared/types.ts:1642 | 2 |
| ProductionSalesLog | orderCount | 필수 | number | src/shared/types.ts:1643 | 3 |
| ProductionSalesLog | productionRows | 필수 | { groupLabel: string; spec: string; 수량: number; 소비기한: string; 비고: string }[] | src/shared/types.ts:1645 | 2 |
| ProductionSalesLog | seedRows | 선택 | { 품목: string; 용량: string; 수량: number; 소비기한: string; 비고: string }[] | src/shared/types.ts:1647 | 2 |
| ProductionSalesLog | salesRows | 선택 | { 상호: string; 품목: string; 용량: string; 수량: number; 소비기한: string }[] | src/shared/types.ts:1649 | 5 |
| ProductionSalesLog | extraRows | 선택 | { 품목: string; 용량: string; 수량: number; 거래처: string }[] | src/shared/types.ts:1651 | 1 |
| ProductionSalesLog | orderSummaries | 필수 | { partnerName: string; items: { name: string; qty: number }[] }[] | src/shared/types.ts:1653 | 1 |
| AdjustmentRequest | id | 필수 | string | src/shared/types.ts:1661 | 20 |
| AdjustmentRequest | companyId | 선택 | CompanyId | src/shared/types.ts:1662 | 1 |
| AdjustmentRequest | itemId | 필수 | string | src/shared/types.ts:1663 | 9 |
| AdjustmentRequest | itemName | 필수 | string | src/shared/types.ts:1664 | 3 |
| AdjustmentRequest | originalQuantity | 필수 | number | src/shared/types.ts:1665 | 6 |
| AdjustmentRequest | requestedQuantity | 선택 | number | src/shared/types.ts:1666 | 9 |
| AdjustmentRequest | type | 필수 | AdjustmentType | src/shared/types.ts:1667 | 31 |
| AdjustmentRequest | reason | 필수 | string | src/shared/types.ts:1668 | 4 |
| AdjustmentRequest | status | 필수 | AdjustmentStatus | src/shared/types.ts:1669 | 11 |
| AdjustmentRequest | requestedAt | 필수 | string | src/shared/types.ts:1670 | 4 |
| AdjustmentRequest | processedAt | 선택 | string | src/shared/types.ts:1671 | 3 |
| AdjustmentRequest | unit | 선택 | string | src/shared/types.ts:1672 | 4 |
| AdjustmentRequest | oemPoId | 선택 | string | src/shared/types.ts:1674 | 3 |
| AdjustmentRequest | oemFeePerKg | 선택 | number | src/shared/types.ts:1675 | 5 |
| AdjustmentRequest | oemTotal | 선택 | number | src/shared/types.ts:1676 | 2 |
