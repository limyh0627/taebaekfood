# 현재 코드 필드 사전

COL 91개, 선언 필드 739개, 운영 소스 491개를 분석했다.

첫 요약과 기존 직접 필드 통계는 TypeScript가 shared/types.ts 직접 interface 선언으로 해석한 속성 접근의 범위다. 별도 모델의 원선언에 귀속된 정적 참조는 아래 additionalModels/resolvedModels에 따로 기록하며 기존 통계와 합산하지 않는다. any·동적 인덱스·객체 전개는 전체 사용처로 해석하지 않으며 사용처 0은 삭제 근거가 아니다. JSON에 정확한 파일·행별 사용처가 있다. 현재 DB의 실제 필드나 지향 설계를 뜻하지 않는다. 현재 checkout의 미배포 후보가 포함될 수 있으므로 배포 경계는 erd-current-and-target-20261007.md에서 별도로 확인한다.

## Firestore 경로 보완

SDK import·선언·수신 객체 타입으로 확인한 collection/doc/collectionGroup 호출 797건. 동적 문서 ID도 미해석으로 보존하며, 미해석 418건은 컬렉션 이름 누락과 같은 의미가 아니다. 서버 호출·중첩 경로·직접 const 별칭을 포함한다. 동적 문자열 안의 슬래시 수는 알 수 없어 깊이를 확정하지 않으며, JSON의 argumentDepthCandidate/pathKind는 인수 형태에 따른 후보이다. 함수 반환·분기·객체 전개로 구성한 경로는 해석하지 않는다. scripts·rules·테스트·JS 및 공용 래퍼 호출부의 경로 문자열은 이 운영 TS 소스 범위 밖이다. SDK 근거 없는 같은 이름 호출 19건은 JSON의 candidateCalls에 집계 밖 후보로 남긴다.

COL 밖 정적 컬렉션 이름: `itemUnpackMovements`, `orderCopyOperations`, `orderInterpretationRules`. 이 목록은 운영 DB 존재/삭제 대상이 아니라 코드에 나타난 이름이다. 부모를 해석하지 못한 호출은 COL 대조에서 제외한다.

동적 컬렉션 호출 51건과 정적 컬렉션의 동적 문서 경로 366건을 구분한다. 후자는 컬렉션 자체의 누락이 아니다. JSON dynamicWrappers는 SDK 호출의 명명 함수와 타입 검사기로 연결된 실제 소비자 위치/인수식을 기록한다. 인수식은 240자까지 표시하고 잘린 경우 truncated=true를 남기며, resolvedPaths는 실제 선언의 인수 대입으로 확인된 첫 컬렉션만 기록하며 회사 조건·문서 ID·런타임 컬렉션 전체 집합을 보장하지 않는다. 익명 고차 함수·객체 DTO·동적 분기는 원문 소스를 함께 대조한다.

| 동적 컬렉션 공용 함수 | 선언 | SDK 위치 | 실제 연결된 소비자 위치 |
| --- | --- | --- | --- |
| doc | functions/src/financialOpeningCommand.ts:19 | functions/src/financialOpeningCommand.ts:19 | functions/src/financialOpeningCommand.ts:27: 미해석; functions/src/financialOpeningCommand.ts:28: 미해석; functions/src/financialOpeningCommand.ts:30: 미해석; functions/src/financialOpeningCommand.ts:61: 미해석; functions/src/financialOpeningCommand.ts:62: 미해석; functions/src/financialOpeningCommand.ts:63: 미해석; functions/src/financialOpeningCommand.ts:64: 미해석; functions/src/financialOpeningCommand.ts:100: 미해석; functions/src/financialOpeningCommand.ts:101: 미해석; functions/src/financialOpeningCommand.ts:150: 미해석; functions/src/financialOpeningCommand.ts:151: 미해석; functions/src/financialOpeningCommand.ts:152: 미해석; functions/src/financialOpeningCommand.ts:194: 미해석; functions/src/financialOpeningCommand.ts:195: 미해석 |
| subscribeToDocument | src/shared/services/firebaseService.ts:247 | src/shared/services/firebaseService.ts:252 | src/shared/deliveryTimeSlot.ts:24: settings; components/OrdersList.tsx:1750: settings; components/DeliveryManager.tsx:140: settings; components/LeaveManager.tsx:181: settings; src/shared/hooks/useAppData.ts:361: settings |
| setDocument | src/shared/services/firebaseService.ts:257 | src/shared/services/firebaseService.ts:259, src/shared/services/firebaseService.ts:260 | src/shared/deliveryTimeSlot.ts:34: settings, settings; components/OrdersList.tsx:1757: settings, settings; components/DeliveryManager.tsx:302: deliveryScheduleAudits, deliveryScheduleAudits; components/DeliveryManager.tsx:304: settings, settings; components/DeliveryManager.tsx:305: deliveryScheduleAudits, deliveryScheduleAudits; components/DeliveryManager.tsx:311: deliveryScheduleAudits, deliveryScheduleAudits; components/DeliveryManager.tsx:482: settings, settings; components/DeliveryManager.tsx:488: settings, settings; components/DeliveryManager.tsx:1206: settings, settings; components/LeaveManager.tsx:215: settings, settings; components/PartnerSignupApproval.tsx:59: users, users; components/PartnerSignupApproval.tsx:74: users, users; components/HaccpChecklist.tsx:2881: haccp_templates, haccp_templates; components/HaccpChecklist.tsx:3008: haccp_templates, haccp_templates; components/HaccpChecklist.tsx:3144: haccp_templates, haccp_templates; components/HaccpChecklist.tsx:3316: haccp_templates, haccp_templates; components/HaccpChecklist.tsx:3459: haccp_templates, haccp_templates; components/HaccpChecklist.tsx:4077: haccp_templates, haccp_templates; components/HaccpChecklist.tsx:4586: haccp_templates, haccp_templates; src/features/admin/AdminApp.tsx:410: partner_item, partner_item; src/features/admin/AdminApp.tsx:4400: settings, settings; src/features/admin/AdminApp.tsx:4584: cashFlowManual, cashFlowManual |
| subscribeToCollection | src/shared/services/firebaseService.ts:344 | src/shared/services/firebaseService.ts:350 | src/shared/services/firebaseService.ts:390: 미해석; components/ItemList.tsx:594: stockClosings; src/shared/hooks/useAppData.ts:287: 미해석; src/shared/hooks/useAppData.ts:293: issuedStatements; src/shared/hooks/useAppData.ts:307: cashAccounts; src/shared/hooks/useAppData.ts:308: returnOperations; src/shared/hooks/useAppData.ts:311: cashEntries; src/shared/hooks/useAppData.ts:312: settlements; src/shared/hooks/useAppData.ts:313: partnerAdvanceOperations; src/shared/hooks/useAppData.ts:314: inventorySnapshots; src/shared/hooks/useAppData.ts:333: 미해석; src/shared/hooks/useAppData.ts:342: notices; src/shared/hooks/useAppData.ts:343: pallets; src/shared/hooks/useAppData.ts:345: employees; src/shared/hooks/useAppData.ts:346: leaveRequests; src/shared/hooks/useAppData.ts:347: adjustmentRequests; src/shared/hooks/useAppData.ts:348: purchaseOrders; src/shared/hooks/useAppData.ts:349: items; src/shared/hooks/useAppData.ts:350: partners; src/shared/hooks/useAppData.ts:351: chatRooms; src/shared/hooks/useAppData.ts:356: notifications; src/shared/hooks/useAppData.ts:357: workOrderItems; src/shared/hooks/useAppData.ts:359: itemReceipts; src/shared/hooks/useAppData.ts:379: orders; src/hooks/useAdminData.ts:56: fixedCosts; src/hooks/useAdminData.ts:61: productionRecords; components/HRManager.tsx:128: payrolls; components/PartnerSignupApproval.tsx:40: users; components/DocumentManager.tsx:78: fileCabinetCategories; components/DocumentManager.tsx:79: fileCabinetSubCategories; components/DocumentManager.tsx:80: fileCabinetDocs; components/QuotationManager.tsx:117: quotations; components/ReturnManager.tsx:104: returnRequests; components/ReceivingReturnsManager.tsx:56: returnRequests |
| fetchCollection | src/shared/services/firebaseService.ts:367 | src/shared/services/firebaseService.ts:371 | components/AddItemModal.tsx:137: itemTaxonomy; components/CategoryManager.tsx:39: itemTaxonomy; components/ItemList.tsx:570: itemTaxonomy; components/ItemList.tsx:625: fileCabinetCategories; components/ItemList.tsx:627: fileCabinetSubCategories; components/ItemManager.tsx:320: itemTaxonomy; src/shared/hooks/useAppData.ts:253: orders; src/shared/hooks/useAppData.ts:412: partner_item; src/shared/hooks/useAppData.ts:413: item_bom; src/shared/hooks/useAppData.ts:414: item_pack; src/shared/hooks/useAppData.ts:415: item_formula; src/shared/hooks/useAppData.ts:419: accountGroups; src/shared/hooks/useAppData.ts:420: accountCodes; src/shared/hooks/useAppData.ts:421: fixedCostTemplates; src/shared/hooks/useAppData.ts:422: expensePresets; src/shared/hooks/useAppData.ts:423: cashFlowManual; components/DashboardLinks.tsx:53: dashboardLinks; components/DocumentManager.tsx:82: fileCabinetCategories; components/DocumentManager.tsx:114: fileCabinetCategories; components/DocumentManager.tsx:115: fileCabinetSubCategories; src/features/statements/hooks/useStatementHistoryFilters.ts:29: itemTaxonomy; src/features/admin/AdminApp.tsx:562: rawMaterialLedger; src/features/admin/AdminApp.tsx:575: rawMaterialLedger |
| fetchDateRange | src/shared/services/firebaseService.ts:398 | src/shared/services/firebaseService.ts:406 | src/features/admin/useProductionSalesHistory.ts:14: productionSalesLogs; components/PalletManager.tsx:65: palletTransactions; components/TaxStatement.tsx:75: issuedStatements; src/features/admin/useVoucherLedger.ts:152: issuedStatements; src/features/admin/useVoucherLedger.ts:169: issuedStatements |
| addItem | src/shared/services/firebaseService.ts:463 | src/shared/services/firebaseService.ts:497, src/shared/services/firebaseService.ts:497, src/shared/services/firebaseService.ts:497, src/shared/services/firebaseService.ts:501, src/shared/services/firebaseService.ts:501, src/shared/services/firebaseService.ts:501, src/shared/services/firebaseService.ts:524, src/shared/services/firebaseService.ts:527 | src/shared/services/employeeCommand.ts:36: 미해석, 미해석, 미해석, 미해석, 미해석, 미해석, 미해석, 미해석; components/CategoryManager.tsx:45: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/CategoryManager.tsx:88: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/CategoryManager.tsx:106: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/CategoryManager.tsx:124: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/CategoryManager.tsx:149: itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy, itemTaxonomy; components/ItemList.tsx:626: fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories; components/ItemList.tsx:629: fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories; components/DashboardLinks.tsx:64: dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks; components/DashboardLinks.tsx:93: dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks, dashboardLinks; components/DocumentManager.tsx:86: fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories; components/DocumentManager.tsx:119: fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories; components/DocumentManager.tsx:121: fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories; components/DocumentManager.tsx:206: fileCabinetDocs, fileCabinetDocs, fileCabinetDocs, fileCabinetDocs, fileCabinetDocs, fileCabinetDocs, fileCabinetDocs, fileCabinetDocs; components/DocumentManager.tsx:254: fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories, fileCabinetCategories; components/DocumentManager.tsx:274: fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories, fileCabinetSubCategories; components/QuotationManager.tsx:266: quotations, quotations, quotations, quotations, quotations, quotations, quotations, quotations; components/HaccpChecklist.tsx:555: haccp_temp, haccp_temp, haccp_temp, haccp_temp, haccp_temp, haccp_temp, haccp_temp, haccp_temp; components/HaccpChecklist.tsx:1095: haccp_incoming, haccp_incoming, haccp_incoming, haccp_incoming, haccp_incoming, haccp_incoming, haccp_incoming, haccp_incoming; components/HaccpChecklist.tsx:1386: haccp_cleaning, haccp_cleaning, haccp_cleaning, haccp_cleaning, haccp_cleaning, haccp_cleaning, haccp_cleaning, haccp_cleaning; components/HaccpChecklist.tsx:1982: haccp_sanitation, haccp_sanitation, haccp_sanitation, haccp_sanitation, haccp_sanitation, haccp_sanitation, haccp_sanitation, haccp_sanitation; components/HaccpChecklist.tsx:2591: haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene, haccp_personal_hygiene; components/HaccpChecklist.tsx:3691: haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation, haccp_periodic_sanitation; components/HaccpChecklist.tsx:4258: haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist, haccp_closing_checklist; components/BenzopyreneLog.tsx:62: benzopyreneTests, benzopyreneTests, benzopyreneTests, benzopyreneTests, benzopyreneTests, benzopyreneTests, benzopyreneTests, benzopyreneTests; src/features/admin/AdminApp.tsx:824: items, items, items, items, items, items, items, items; src/features/admin/AdminApp.tsx:1147: adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests; src/features/admin/AdminApp.tsx:1159: notifications, notifications, notifications, notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:1174: adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests; src/features/admin/AdminApp.tsx:1186: notifications, notifications, notifications, notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:1549: notifications, notifications, notifications, notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:1884: pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits; src/features/admin/AdminApp.tsx:2145: orderItemEdits, orderItemEdits, orderItemEdits, orderItemEdits, orderItemEdits, orderItemEdits, orderItemEdits, orderItemEdits; src/features/admin/AdminApp.tsx:2726: workOrderItems, workOrderItems, workOrderItems, workOrderItems, workOrderItems, workOrderItems, workOrderItems, workOrderItems; src/features/admin/AdminApp.tsx:2762: items, items, items, items, items, items, items, items; src/features/admin/AdminApp.tsx:2783: adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests; src/features/admin/AdminApp.tsx:3147: partners, partners, partners, partners, partners, partners, partners, partners; src/features/admin/AdminApp.tsx:3173: notices, notices, notices, notices, notices, notices, notices, notices; src/features/admin/AdminApp.tsx:3183: palletTransactions, palletTransactions, palletTransactions, palletTransactions, palletTransactions, palletTransactions, palletTransactions, palletTransactions; src/features/admin/AdminApp.tsx:3193: employees, employees, employees, employees, employees, employees, employees, employees; src/features/admin/AdminApp.tsx:3201: leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests; src/features/admin/AdminApp.tsx:3515: productionSalesLogs, productionSalesLogs, productionSalesLogs, productionSalesLogs, productionSalesLogs, productionSalesLogs, productionSalesLogs, productionSalesLogs; src/features/admin/AdminApp.tsx:4306: fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates; src/features/admin/AdminApp.tsx:4310: expensePresets, expensePresets, expensePresets, expensePresets, expensePresets, expensePresets, expensePresets, expensePresets; src/features/admin/AdminApp.tsx:4359: pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits, pendingStatementEdits; src/features/admin/AdminApp.tsx:4427: fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates; src/features/admin/AdminApp.tsx:4437: accountCodes, accountCodes, accountCodes, accountCodes, accountCodes, accountCodes, accountCodes, accountCodes; src/features/admin/AdminApp.tsx:4439: accountGroups, accountGroups, accountGroups, accountGroups, accountGroups, accountGroups, accountGroups, accountGroups; src/features/admin/AdminApp.tsx:4444: inventorySnapshots, inventorySnapshots, inventorySnapshots, inventorySnapshots, inventorySnapshots, inventorySnapshots, inventorySnapshots, inventorySnapshots; src/features/admin/AdminApp.tsx:4506: fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates, fixedCostTemplates; src/features/admin/AdminApp.tsx:4655: productionRecords, productionRecords, productionRecords, productionRecords, productionRecords, productionRecords, productionRecords, productionRecords; src/features/admin/AdminApp.tsx:4729: leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests, leaveRequests; src/features/admin/AdminApp.tsx:4731: notifications, notifications, notifications, notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:4865: chatRooms, chatRooms, chatRooms, chatRooms, chatRooms, chatRooms, chatRooms, chatRooms; src/features/admin/AdminApp.tsx:4889: chatMessages, chatMessages, chatMessages, chatMessages, chatMessages, chatMessages, chatMessages, chatMessages; src/features/admin/AdminApp.tsx:4911: notifications, notifications, notifications, notifications, notifications, notifications, notifications, notifications; src/features/admin/AdminApp.tsx:4920: adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests, adjustmentRequests; src/features/admin/AdminApp.tsx:5042: items, items, items, items, items, items, items, items; src/features/admin/AdminApp.tsx:5102: items, items, items, items, items, items, items, items |
| updateItem | src/shared/services/firebaseService.ts:532 | src/shared/services/firebaseService.ts:535 | components/RawMaterialLotPanel.tsx:80: items; components/RawMaterialLotPanel.tsx:94: items; components/CategoryManager.tsx:91: itemTaxonomy; components/CategoryManager.tsx:105: itemTaxonomy; components/CategoryManager.tsx:120: itemTaxonomy; components/CategoryManager.tsx:135: itemTaxonomy; components/CategoryManager.tsx:159: itemTaxonomy; components/CategoryManager.tsx:180: itemTaxonomy; components/PalletManager.tsx:358: palletTransactions; components/DashboardLinks.tsx:103: dashboardLinks; components/DocumentManager.tsx:246: fileCabinetDocs; components/HaccpChecklist.tsx:559: haccp_temp; components/HaccpChecklist.tsx:570: haccp_temp; components/HaccpChecklist.tsx:1097: haccp_incoming; components/HaccpChecklist.tsx:1106: haccp_incoming; components/HaccpChecklist.tsx:1388: haccp_cleaning; components/HaccpChecklist.tsx:1397: haccp_cleaning; components/HaccpChecklist.tsx:1992: haccp_sanitation; components/HaccpChecklist.tsx:2015: haccp_sanitation; components/HaccpChecklist.tsx:2595: haccp_personal_hygiene; components/HaccpChecklist.tsx:2609: haccp_personal_hygiene; components/HaccpChecklist.tsx:3696: haccp_periodic_sanitation; components/HaccpChecklist.tsx:3713: haccp_periodic_sanitation; components/HaccpChecklist.tsx:4263: haccp_closing_checklist; components/HaccpChecklist.tsx:4280: haccp_closing_checklist; components/BenzopyreneLog.tsx:81: benzopyreneTests; src/features/admin/AdminApp.tsx:793: items; src/features/admin/AdminApp.tsx:845: items; src/features/admin/AdminApp.tsx:1219: purchaseOrders; src/features/admin/AdminApp.tsx:1227: purchaseOrders; src/features/admin/AdminApp.tsx:1229: purchaseOrders; src/features/admin/AdminApp.tsx:1238: purchaseOrders; src/features/admin/AdminApp.tsx:1246: purchaseOrders; src/features/admin/AdminApp.tsx:2139: orders; src/features/admin/AdminApp.tsx:2632: orders; src/features/admin/AdminApp.tsx:2635: orders; src/features/admin/AdminApp.tsx:2636: orders; src/features/admin/AdminApp.tsx:2637: orders; src/features/admin/AdminApp.tsx:2638: orders; src/features/admin/AdminApp.tsx:2671: orders; src/features/admin/AdminApp.tsx:2674: orders; src/features/admin/AdminApp.tsx:2675: orders; src/features/admin/AdminApp.tsx:2676: orders; src/features/admin/AdminApp.tsx:2677: orders; src/features/admin/AdminApp.tsx:2698: orders; src/features/admin/AdminApp.tsx:2699: orders; src/features/admin/AdminApp.tsx:2703: orders; src/features/admin/AdminApp.tsx:2704: orders; src/features/admin/AdminApp.tsx:2705: orders; src/features/admin/AdminApp.tsx:2706: orders; src/features/admin/AdminApp.tsx:2744: workOrderItems; src/features/admin/AdminApp.tsx:2760: items; src/features/admin/AdminApp.tsx:2778: purchaseOrders; src/features/admin/AdminApp.tsx:2916: items; src/features/admin/AdminApp.tsx:3147: partners; src/features/admin/AdminApp.tsx:3173: notices; src/features/admin/AdminApp.tsx:3182: pallets; src/features/admin/AdminApp.tsx:3192: employees; src/features/admin/AdminApp.tsx:3196: leaveRequests; src/features/admin/AdminApp.tsx:3198: leaveRequests; src/features/admin/AdminApp.tsx:3219: leaveRequests; src/features/admin/AdminApp.tsx:3221: adjustmentRequests; src/features/admin/AdminApp.tsx:3230: adjustmentRequests; src/features/admin/AdminApp.tsx:3254: adjustmentRequests; src/features/admin/AdminApp.tsx:3265: pendingStatementEdits; src/features/admin/AdminApp.tsx:3776: orders; src/features/admin/AdminApp.tsx:4303: cashAccounts; src/features/admin/AdminApp.tsx:4307: fixedCostTemplates; src/features/admin/AdminApp.tsx:4315: orders; src/features/admin/AdminApp.tsx:4380: purchaseOrders; src/features/admin/AdminApp.tsx:4428: fixedCostTemplates; src/features/admin/AdminApp.tsx:4436: accountCodes; src/features/admin/AdminApp.tsx:4440: accountGroups; src/features/admin/AdminApp.tsx:4532: cashAccounts; src/features/admin/AdminApp.tsx:4625: items; src/features/admin/AdminApp.tsx:4657: productionRecords; src/features/admin/AdminApp.tsx:4667: adjustmentRequests; src/features/admin/AdminApp.tsx:4676: adjustmentRequests; src/features/admin/AdminApp.tsx:4710: adjustmentRequests; src/features/admin/AdminApp.tsx:4743: leaveRequests; src/features/admin/AdminApp.tsx:4745: leaveRequests; src/features/admin/AdminApp.tsx:4866: chatRooms; src/features/admin/AdminApp.tsx:4869: chatMessages; src/features/admin/AdminApp.tsx:4899: chatRooms; src/features/admin/AdminApp.tsx:5082: items; src/features/admin/AdminApp.tsx:5084: items; src/features/admin/AdminApp.tsx:5097: items |
| deleteItem | src/shared/services/firebaseService.ts:545 | src/shared/services/firebaseService.ts:547 | src/shared/services/workOrderResetService.ts:21: workOrderItems; components/CategoryManager.tsx:169: itemTaxonomy; components/PalletManager.tsx:377: palletTransactions; components/DashboardLinks.tsx:109: dashboardLinks; components/DocumentManager.tsx:235: fileCabinetDocs; components/DocumentManager.tsx:265: fileCabinetCategories; components/DocumentManager.tsx:284: fileCabinetSubCategories; components/QuotationManager.tsx:362: quotations; components/HaccpChecklist.tsx:577: haccp_temp; components/HaccpChecklist.tsx:2028: haccp_sanitation; components/HaccpChecklist.tsx:2616: haccp_personal_hygiene; components/HaccpChecklist.tsx:3730: haccp_periodic_sanitation; components/HaccpChecklist.tsx:4297: haccp_closing_checklist; components/BenzopyreneLog.tsx:91: benzopyreneTests; src/features/admin/AdminApp.tsx:1085: notifications; src/features/admin/AdminApp.tsx:1215: purchaseOrders; src/features/admin/AdminApp.tsx:1237: purchaseOrders; src/features/admin/AdminApp.tsx:1240: purchaseOrders; src/features/admin/AdminApp.tsx:2722: workOrderItems; src/features/admin/AdminApp.tsx:3147: partners; src/features/admin/AdminApp.tsx:3173: notices; src/features/admin/AdminApp.tsx:3194: employees; src/features/admin/AdminApp.tsx:3199: leaveRequests; src/features/admin/AdminApp.tsx:3222: adjustmentRequests; src/features/admin/AdminApp.tsx:4308: fixedCostTemplates; src/features/admin/AdminApp.tsx:4311: expensePresets; src/features/admin/AdminApp.tsx:4429: fixedCostTemplates; src/features/admin/AdminApp.tsx:4438: accountCodes; src/features/admin/AdminApp.tsx:4441: accountGroups; src/features/admin/AdminApp.tsx:4656: productionRecords; src/features/admin/AdminApp.tsx:4708: purchaseOrders; src/features/admin/AdminApp.tsx:4713: adjustmentRequests; src/features/admin/AdminApp.tsx:4867: chatRooms; src/features/admin/AdminApp.tsx:5039: partner_item; src/features/admin/AdminApp.tsx:5067: items |
| subscribeToSubcollection | src/shared/services/firebaseService.ts:563 | src/shared/services/firebaseService.ts:569 | 정적 호출 연결 없음 |
| addSubItem | src/shared/services/firebaseService.ts:579 | src/shared/services/firebaseService.ts:588, src/shared/services/firebaseService.ts:591 | 정적 호출 연결 없음 |
| updateSubItem | src/shared/services/firebaseService.ts:596 | src/shared/services/firebaseService.ts:603 | 정적 호출 연결 없음 |
| deleteSubItem | src/shared/services/firebaseService.ts:607 | src/shared/services/firebaseService.ts:613 | 정적 호출 연결 없음 |
| fetchWhere | src/shared/services/firebaseService.ts:696 | src/shared/services/firebaseService.ts:701 | src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:16: productionWorkDocuments; src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:17: productionWorkDocumentLines; src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:129: orders; src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:130: rawMaterialLedger; src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:131: items; components/OrdersList.tsx:1668: orderStatusAudits; components/OrdersList.tsx:1669: orderItemEdits; src/features/admin/useVoucherLedger.ts:102: openingBalances; src/features/admin/useVoucherLedger.ts:114: partnerBalanceSnapshots; src/shared/useLoanContracts.ts:12: loanContracts; components/ProfitAnalysis.tsx:99: openingBalances; components/FinancialReports.tsx:111: openingBalances; components/LoanManager.tsx:76: loanContracts |
| fetchWhereIn | src/shared/services/firebaseService.ts:706 | src/shared/services/firebaseService.ts:716 | src/features/admin/AdminApp.tsx:1405: orders |
| fetchByIds | src/shared/services/firebaseService.ts:729 | src/shared/services/firebaseService.ts:737 | src/features/admin/useVoucherLedger.ts:136: issuedStatements |
| subscribeWhere | src/shared/services/firebaseService.ts:743 | src/shared/services/firebaseService.ts:750 | 정적 호출 연결 없음 |
| commitCompanyWrites | src/shared/services/firebaseService.ts:764 | src/shared/services/firebaseService.ts:771, src/shared/services/firebaseService.ts:797 | src/shared/services/firebaseService.ts:546: 미해석, 미해석; src/shared/services/firebaseService.ts:650: 미해석, 미해석; src/shared/services/firebaseService.ts:681: 미해석, 미해석; src/shared/services/firebaseService.ts:1018: 미해석, 미해석; src/features/admin/AdminApp.tsx:1455: 미해석, 미해석; src/features/admin/AdminApp.tsx:4829: 미해석, 미해석; src/features/admin/AdminApp.tsx:5025: 미해석, 미해석; src/features/admin/AdminApp.tsx:5120: 미해석, 미해석 |
| read | src/shared/services/oemExternalStockEvidence.ts:22 | src/shared/services/oemExternalStockEvidence.ts:23 | src/shared/services/oemExternalStockEvidence.ts:27: rawMaterialLedger; src/shared/services/oemExternalStockEvidence.ts:29: rawMaterialLedger; src/shared/services/oemExternalStockEvidence.ts:36: purchaseOrders; src/shared/services/oemExternalStockEvidence.ts:37: rawInventoryJobs; src/shared/services/oemExternalStockEvidence.ts:43: rawInventoryReversalGuards |
| readVoucherScopeRows | functions/src/newScopeCounter.ts:21 | functions/src/newScopeCounter.ts:27 | functions/src/newScopeCounter.ts:62: 미해석; functions/src/voucherIssue.ts:94: 미해석 |
| readStatementIssueEffects | functions/src/statementIssueReceipt.ts:55 | functions/src/statementIssueReceipt.ts:61 | functions/src/statementIssueReceipt.ts:102: 미해석; functions/src/cancelTradeStatementCommand.ts:30: 미해석 |
| readPartnerAdvanceSnapshot | functions/src/partnerAdvanceReader.ts:11 | functions/src/partnerAdvanceReader.ts:15 | functions/src/partnerAdvanceCommand.ts:98: 미해석; functions/src/partnerAdvanceCommand.ts:128: 미해석; functions/src/deleteIssuedStatementCommand.ts:64: 미해석; functions/src/cashMutationCommand.ts:198: 미해석; functions/src/editIssuedStatementCommand.ts:200: 미해석; functions/src/processReturnCommand.ts:209: 미해석 |
| deleteIssuedStatement | functions/src/deleteIssuedStatementCommand.ts:67 | functions/src/deleteIssuedStatementCommand.ts:105, functions/src/deleteIssuedStatementCommand.ts:120, functions/src/deleteIssuedStatementCommand.ts:120, functions/src/deleteIssuedStatementCommand.ts:136, functions/src/deleteIssuedStatementCommand.ts:136 | functions/src/deleteIssuedStatementCommand.ts:158: 미해석, 미해석, 미해석, 미해석, 미해석 |
| issueVoucher | functions/src/voucherIssue.ts:35 | functions/src/voucherIssue.ts:76, functions/src/voucherIssue.ts:76, functions/src/voucherIssue.ts:77, functions/src/voucherIssue.ts:77 | functions/src/voucherIssue.ts:211: 미해석, 미해석, 미해석, 미해석; functions/src/autoVoucherCommand.ts:39: 미해석, 미해석, 미해석, 미해석 |
| inspectTradeStatement | functions/src/inspectTradeStatementCommand.ts:17 | functions/src/inspectTradeStatementCommand.ts:121 | functions/src/inspectTradeStatementCommand.ts:159: 미해석; functions/src/cancelTradeStatementCommand.ts:44: 미해석 |
| recordTaxIssue | functions/src/taxIssueCommand.ts:12 | functions/src/taxIssueCommand.ts:35, functions/src/taxIssueCommand.ts:35, functions/src/taxIssueCommand.ts:62, functions/src/taxIssueCommand.ts:62, functions/src/taxIssueCommand.ts:76, functions/src/taxIssueCommand.ts:76 | functions/src/taxIssueCommand.ts:92: 미해석, 미해석, 미해석, 미해석, 미해석, 미해석 |
| retireOrderRequest | functions/src/orderRequestRetirement.ts:39 | functions/src/orderRequestRetirement.ts:85, functions/src/orderRequestRetirement.ts:85 | functions/src/orderRequestRetirement.ts:95: 미해석, 미해석 |
| claimRetiredOrderInventoryOperation | functions/src/orderRequestRetirement.ts:110 | functions/src/orderRequestRetirement.ts:136, functions/src/orderRequestRetirement.ts:136 | functions/src/orderRequestRetirement.ts:157: 미해석, 미해석 |

| 위치 | 실행 | API | 문맥 | 깊이 | 경로 (중괄호는 동적식) | COL 밖 |
| --- | --- | --- | --- | --- | --- | --- |
| src/shared/inventoryWriterProtocol.ts:116 | client | doc | root / top-level-candidate | 미해석 | inventoryWriterDeletions/{identity!.companyId+'__'+parts[1]} |  |
| src/shared/inventoryWriterProtocol.ts:121 | client | doc | root / top-level-candidate | 미해석 | orderStatusAudits/{before.inventoryOperation?.id} |  |
| src/shared/services/rawInventoryService.ts:68 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(command.operationId)} |  |
| src/shared/services/rawInventoryService.ts:69 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(command.operationId)} |  |
| src/shared/services/rawInventoryService.ts:70 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(command.companyId, command.rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:71 | client | doc | root / top-level-candidate | 미해석 | items/{command.rawItemId} |  |
| src/shared/services/rawInventoryService.ts:73 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:74 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:75 | client | doc | root / top-level-candidate | 미해석 | rawInventoryReversalGuards/{operationDocId(originalId \|\| '_none_')} |  |
| src/shared/services/rawInventoryService.ts:152 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(companyId, rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:169 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(input.companyId, input.rawItemId)} |  |
| src/shared/services/rawInventoryService.ts:170 | client | doc | root / top-level-candidate | 미해석 | items/{input.rawItemId} |  |
| functions/src/cashMutationReceipt.ts:19 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/releaseGate.ts:5 | server | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| functions/src/releaseGate.ts:5 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/financialOpeningCommand.ts:19 | server | doc | unresolved-parent / unresolved-parent | 미해석 | {id} |  |
| functions/src/financialOpeningCommand.ts:225 | server | doc | root / top-level-candidate | 미해석 | financialOpeningOperations/{input.operationId} |  |
| functions/src/financialOpeningCommand.ts:225 | server | collection | root / top-level | 1 | financialOpeningOperations |  |
| src/shared/services/financialOpeningCommands.ts:34 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/orderRequestRetirementService.ts:31 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/shared/services/orderRequestRetirementService.ts:38 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/orderRequestRetirementService.ts:64 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/firebaseService.ts:70 | client | doc | root / top-level-candidate | 미해석 | inventoryWriterDeletions/{companyId+'__'+itemId} |  |
| src/shared/services/firebaseService.ts:144 | client | doc | root / top-level-candidate | 미해석 | accountCodes/{account.id} |  |
| src/shared/services/firebaseService.ts:166 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/firebaseService.ts:252 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:259 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:260 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{docId} |  |
| src/shared/services/firebaseService.ts:267 | client | doc | root / top-level-candidate | 미해석 | openingBalances/{openingDocId(companyId)} |  |
| src/shared/services/firebaseService.ts:350 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:371 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:406 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:482 | client | doc | root / top-level-candidate | 미해석 | partners/{id} |  |
| src/shared/services/firebaseService.ts:497 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:497 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{<auto-id>} |  |
| src/shared/services/firebaseService.ts:497 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:501 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:501 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{<auto-id>} |  |
| src/shared/services/firebaseService.ts:501 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:504 | client | doc | root / top-level-candidate | 미해석 | cashEntries/{String(data.cashEntryId \|\| 'missing')} |  |
| src/shared/services/firebaseService.ts:505 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{String(data.statementId \|\| 'missing')} |  |
| src/shared/services/firebaseService.ts:512 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${data.companyId}_${partnerId}`} |  |
| src/shared/services/firebaseService.ts:524 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:527 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:535 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:547 | client | doc | root / top-level-candidate | 미해석 | {collectionName}/{id} |  |
| src/shared/services/firebaseService.ts:560 | client | doc | root / top-level-candidate | 미해석 | notifications/{id} |  |
| src/shared/services/firebaseService.ts:569 | client | collection | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName} |  |
| src/shared/services/firebaseService.ts:588 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:591 | client | collection | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName} |  |
| src/shared/services/firebaseService.ts:603 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:613 | client | doc | root / subcollection-candidate | 미해석 | {parentCollection}/{parentId}/{subCollectionName}/{id} |  |
| src/shared/services/firebaseService.ts:628 | client | collection | root / top-level | 1 | partner_item |  |
| src/shared/services/firebaseService.ts:661 | client | collection | root / top-level | 1 | partner_item |  |
| src/shared/services/firebaseService.ts:701 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:716 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:737 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:750 | client | collection | root / top-level-candidate | 미해석 | {collectionName} |  |
| src/shared/services/firebaseService.ts:771 | client | doc | root / top-level-candidate | 미해석 | {op.collection}/{op.id} |  |
| src/shared/services/firebaseService.ts:797 | client | doc | root / top-level-candidate | 미해석 | {op.collection}/{op.id} |  |
| src/shared/services/firebaseService.ts:822 | client | doc | root / top-level-candidate | 미해석 | items/{receipt.itemId} |  |
| src/shared/services/firebaseService.ts:823 | client | doc | root / top-level-candidate | 미해석 | itemReceipts/{receipt.id} |  |
| src/shared/services/firebaseService.ts:864 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/firebaseService.ts:869 | client | collection | root / top-level | 1 | itemReceipts |  |
| src/shared/services/firebaseService.ts:871 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/firebaseService.ts:892 | client | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| src/shared/services/firebaseService.ts:892 | client | doc | root / top-level-candidate | 미해석 | itemReceipts/{`rcv-po-${encodeURIComponent(poId)}-${encodeURIComponent(line.itemId)}`} |  |
| src/shared/services/firebaseService.ts:994 | client | collection | root / top-level | 1 | itemReceipts |  |
| src/shared/services/firebaseService.ts:996 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/firebaseService.ts:999 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| src/shared/services/firebaseService.ts:1009 | client | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| src/shared/services/firebaseService.ts:1056 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/shared/services/firebaseService.ts:1059 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/shared/services/firebaseService.ts:1086 | client | doc | root / top-level-candidate | 미해석 | orders/{generation.orderId} |  |
| src/shared/services/firebaseService.ts:1091 | client | doc | root / top-level-candidate | 미해석 | orders/{generation.orderId} |  |
| src/shared/services/firebaseService.ts:1097 | client | doc | root / top-level-candidate | 미해석 | orders/{generation.orderId} |  |
| src/shared/services/confirmPendingPurchaseOrderService.ts:36 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{expected.id} |  |
| src/shared/services/sharedChatMessageService.ts:36 | client | doc | root / top-level-candidate | 미해석 | chatMessages/{message.id} |  |
| src/shared/services/sharedChatMessageService.ts:37 | client | doc | root / top-level-candidate | 미해석 | chatRooms/{message.roomId} |  |
| src/shared/services/orderInventoryRecoveryService.ts:12 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
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
| src/shared/services/productionWorkDocumentService.ts:59 | client | collection | root / top-level | 1 | productionWorkDocumentLines |  |
| src/shared/services/productionWorkDocumentService.ts:66 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocuments/{header.id} |  |
| src/shared/services/productionWorkDocumentService.ts:73 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocumentLines/{id} |  |
| src/shared/services/productionWorkDocumentService.ts:87 | client | doc | root / top-level-candidate | 미해석 | productionWorkDocumentLines/{line.id} |  |
| src/shared/services/rawPressService.ts:69 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{`raw-press-${operationDocId(source.operationId)}`} |  |
| src/shared/services/rawPressService.ts:145 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{`raw-press-${operationDocId(request.originalOperationId)}`} |  |
| src/shared/services/rawPressService.ts:188 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{`raw-press-${operationDocId(input.originalOperationId)}`} |  |
| src/shared/services/unpackService.ts:75 | client | doc | root / top-level-candidate | 미해석 | items/{plan.canItemId} |  |
| src/shared/services/unpackService.ts:76 | client | doc | root / top-level-candidate | 미해석 | items/{plan.bulkItemId} |  |
| src/shared/services/unpackService.ts:77 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(operationId)} |  |
| src/shared/services/unpackService.ts:104 | client | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(bulkCompany, plan.bulkItemId)} |  |
| src/shared/services/unpackService.ts:265 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/unpackService.ts:340 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/shared/services/pendingFlowQuantityService.ts:15 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{id} |  |
| src/shared/services/workOrderResetService.ts:9 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`workOrderReset_${companyId}`} |  |
| src/shared/services/workOrderResetService.ts:20 | client | collection | root / top-level | 1 | workOrderItems |  |
| src/shared/services/deleteIssuedStatementService.ts:21 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{id} |  |
| src/shared/services/deleteIssuedStatementService.ts:30 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/deleteIssuedStatementService.ts:32 | client | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{input.operationId} |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:43 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:107 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:136 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:208 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:223 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:224 | client | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} |  |
| components/AddItemModal.tsx:360 | client | doc | root / top-level-candidate | 미해석 | items/{finalProduct.id} |  |
| components/AddItemModal.tsx:375 | client | doc | root / top-level-candidate | 미해석 | items/{finalProduct.id} |  |
| src/features/admin/oemReceiptInventory.ts:60 | client | collection | root / top-level | 1 | adjustmentRequests |  |
| src/features/admin/oemReceiptInventory.ts:64 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.poId} |  |
| src/features/admin/oemReceiptInventory.ts:65 | client | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${input.poId}`} |  |
| src/features/admin/oemReceiptInventory.ts:66 | client | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| src/shared/services/rawInventoryJob.ts:58 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{input.jobId} |  |
| src/shared/services/rawInventoryJob.ts:127 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{jobId} |  |
| src/shared/services/rawInventoryJob.ts:134 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(opId)} |  |
| src/shared/services/rawInventoryJob.ts:135 | client | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(opId)} |  |
| src/features/admin/oemIssueJob.ts:99 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.jobId} |  |
| src/features/admin/oemIssueJob.ts:146 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{draft.id} |  |
| src/features/admin/oemIssueJob.ts:161 | client | doc | root / top-level-candidate | 미해석 | purchaseOrders/{draft.id} |  |
| src/shared/services/oemExternalStockEvidence.ts:23 | client | doc | root / top-level-candidate | 미해석 | {collection}/{id} |  |
| src/shared/services/boxUnpackService.ts:30 | client | doc | root / top-level-candidate | 미해석 | items/{boxItemId} |  |
| src/shared/services/boxUnpackService.ts:31 | client | doc | root / top-level-candidate | 미해석 | items/{unitItemId} |  |
| src/shared/services/boxUnpackService.ts:32 | client | doc | root / top-level-candidate | 미해석 | itemUnpackMovements/{operationId} | itemUnpackMovements |
| src/shared/services/itemStockAddService.ts:19 | client | doc | root / top-level-candidate | 미해석 | itemStockAddOperations/{operationDocId(request.operationId)} |  |
| src/shared/services/itemStockAddService.ts:27 | client | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| functions/src/orderCopyCommands.ts:52 | server | doc | root / top-level-candidate | 미해석 | orderCopyOperations/{orderCopyHash(`${scope.companyId}:${request.requestId}`)} | orderCopyOperations |
| functions/src/orderCopyCommands.ts:52 | server | collection | root / top-level | 1 | orderCopyOperations | orderCopyOperations |
| functions/src/orderCopyCommands.ts:53 | server | doc | root / top-level-candidate | 미해석 | orders/{id(draft.id)?draft.id:''} |  |
| functions/src/orderCopyCommands.ts:53 | server | collection | root / top-level | 1 | orders |  |
| functions/src/orderCopyCommands.ts:54 | server | doc | root / top-level-candidate | 미해석 | orderInterpretationRules/{candidateRuleId(scope.companyId,row)} | orderInterpretationRules |
| functions/src/orderCopyCommands.ts:54 | server | collection | root / top-level | 1 | orderInterpretationRules | orderInterpretationRules |
| functions/src/orderCopyCommands.ts:63 | server | doc | root / top-level-candidate | 미해석 | partners/{draft.partnerId} |  |
| functions/src/orderCopyCommands.ts:63 | server | collection | root / top-level | 1 | partners |  |
| functions/src/orderCopyCommands.ts:63 | server | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| functions/src/orderCopyCommands.ts:63 | server | collection | root / top-level | 1 | items |  |
| functions/src/orderCopyCommands.ts:85 | server | collection | root / top-level | 1 | orderInterpretationRules | orderInterpretationRules |
| functions/src/orderCopyCommands.ts:90 | server | doc | root / top-level-candidate | 미해석 | orderInterpretationRules/{input.ruleId} | orderInterpretationRules |
| functions/src/orderCopyCommands.ts:90 | server | collection | root / top-level | 1 | orderInterpretationRules | orderInterpretationRules |
| functions/src/orderCopyCommands.ts:94 | server | doc | root / top-level-candidate | 미해석 | orderCopyOperations/{value} | orderCopyOperations |
| functions/src/orderCopyCommands.ts:94 | server | collection | root / top-level | 1 | orderCopyOperations | orderCopyOperations |
| functions/src/orderCopyCommands.ts:100 | server | doc | root / top-level-candidate | 미해석 | partners/{row.partnerId} |  |
| functions/src/orderCopyCommands.ts:100 | server | collection | root / top-level | 1 | partners |  |
| functions/src/orderCopyCommands.ts:100 | server | doc | root / top-level-candidate | 미해석 | partners/{row.partnerId} |  |
| functions/src/orderCopyCommands.ts:100 | server | collection | root / top-level | 1 | partners |  |
| functions/src/orderCopyCommands.ts:100 | server | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| functions/src/orderCopyCommands.ts:100 | server | collection | root / top-level | 1 | items |  |
| src/shared/services/orderCopyService.ts:36 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/orderCopyService.ts:49 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/pushTokenService.ts:12 | client | doc | root / top-level-candidate | 미해석 | employees/{employeeId} |  |
| src/shared/services/orderRawBatchService.ts:69 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{request.jobId} |  |
| src/shared/services/orderRawBatchService.ts:69 | client | doc | root / top-level-candidate | 미해석 | orders/{request.generation.orderId} |  |
| src/shared/services/orderRawBatchService.ts:70 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{id} |  |
| src/features/admin/orderItemStock.ts:124 | client | doc | root / top-level-candidate | 미해석 | orders/{generation.orderId} |  |
| src/features/admin/orderItemStock.ts:153 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/features/admin/orderItemStock.ts:213 | client | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| src/features/admin/orderItemStock.ts:267 | client | doc | root / top-level-candidate | 미해석 | orders/{orderMutation.orderId} |  |
| src/features/admin/orderItemStock.ts:281 | client | doc | root / top-level-candidate | 미해석 | orders/{generation.orderId} |  |
| src/features/admin/orderItemStock.ts:299 | client | doc | root / top-level-candidate | 미해석 | orders/{orderMutation.orderId} |  |
| src/features/admin/orderItemStock.ts:300 | client | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| src/features/admin/orderInventoryCancellation.ts:129 | client | doc | root / top-level-candidate | 미해석 | orderStatusAudits/{ticket.operationId} |  |
| src/features/admin/orderInventoryCancellation.ts:141 | client | doc | root / top-level-candidate | 미해석 | orders/{orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:166 | client | doc | root / top-level-candidate | 미해석 | orders/{ticket.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:177 | client | doc | root / top-level-candidate | 미해석 | orders/{ticket.orderId} |  |
| src/features/admin/orderInventoryCancellation.ts:234 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/features/admin/orderInventoryCancellation.ts:282 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/features/admin/orderProductionPreflight.ts:16 | client | doc | root / top-level-candidate | 미해석 | orders/{input.order.id} |  |
| src/features/admin/orderProductionPreflight.ts:22 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/shared/services/orderProductionRecordService.ts:33 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{request.jobId} |  |
| src/shared/services/orderProductionRecordService.ts:33 | client | doc | root / top-level-candidate | 미해석 | orders/{request.generation.orderId} |  |
| src/shared/services/orderProductionRecordService.ts:40 | client | doc | root / top-level-candidate | 미해석 | productionRecords/{id} |  |
| src/shared/services/orderProductionRecordService.ts:41 | client | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| src/shared/services/orderProductionRecordService.ts:42 | client | doc | root / top-level-candidate | 미해석 | productionRecords/{row.entry.recordId} |  |
| src/shared/services/orderProductionRecordService.ts:43 | client | doc | root / top-level-candidate | 미해석 | rawInventoryJobs/{orderRawBatchJobId(row.entry.generation)} |  |
| src/shared/services/orderProductionRecordService.ts:85 | client | doc | root / top-level-candidate | 미해석 | productionRecords/{record.id} |  |
| src/shared/services/orderProductionRecordService.ts:86 | client | doc | root / top-level-candidate | 미해석 | productionRecords/{row.entry.recordId} |  |
| src/features/admin/orderStockEngine.ts:474 | client | doc | root / top-level-candidate | 미해석 | orders/{order.id} |  |
| src/features/admin/orderStockEngine.ts:802 | client | doc | root / top-level-candidate | 미해석 | orders/{id} |  |
| src/shared/ledgerLotCheck.ts:66 | client | doc | root / top-level-candidate | 미해석 | items/{rawItemId} |  |
| src/shared/ledgerLotCheck.ts:67 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/ledgerLotCheck.ts:68 | client | collection | root / top-level | 1 | rawMaterialLedger |  |
| src/shared/services/itemPurchaseUnitService.ts:9 | client | collection | root / top-level | 1 | item_purchase_unit |  |
| src/shared/services/itemPurchaseUnitService.ts:20 | client | doc | root / top-level-candidate | 미해석 | item_purchase_unit/{unit.id} |  |
| components/OfficeTalk.tsx:211 | client | collection | root / top-level | 1 | chatMessages |  |
| src/shared/hooks/useAppData.ts:455 | client | doc | root / top-level-candidate | 미해석 | issuedStatements/{id} |  |
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
| components/HaccpChecklist.tsx:3585 | client | collection | root / top-level | 1 | haccp_periodic_sanitation |  |
| components/HaccpChecklist.tsx:3602 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'weekly_sanitation')} |  |
| components/HaccpChecklist.tsx:3614 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'monthly_sanitation')} |  |
| components/HaccpChecklist.tsx:4063 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'closing_checklist')} |  |
| components/HaccpChecklist.tsx:4173 | client | collection | root / top-level | 1 | haccp_closing_checklist |  |
| components/HaccpChecklist.tsx:4190 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'closing_checklist')} |  |
| components/HaccpChecklist.tsx:4565 | client | doc | root / top-level-candidate | 미해석 | haccp_templates/{haccpTemplateDocId(companyId, 'haccp_tab_order')} |  |
| components/BenzopyreneLog.tsx:49 | client | collection | root / top-level | 1 | benzopyreneTests |  |
| src/shared/services/interCompanyTransferService.ts:14 | client | doc | root / top-level | 1 | appMeta/releaseCutover |  |
| src/shared/services/interCompanyTransferService.ts:21 | client | doc | root / top-level-candidate | 미해석 | companyTransferOperations/{command.operationId} |  |
| src/shared/services/confirmedCashBalance.ts:9 | client | doc | root / top-level-candidate | 미해석 | cashAccounts/{original.id} |  |
| src/features/admin/AdminApp.tsx:522 | client | collection | root / top-level | 1 | users |  |
| src/features/admin/AdminApp.tsx:576 | client | collection | root / top-level | 1 | rawInventories |  |
| src/features/admin/AdminApp.tsx:577 | client | collection | root / top-level | 1 | items |  |
| src/features/admin/AdminApp.tsx:4814 | client | collection | root / top-level | 1 | partner_item |  |
| src/features/admin/AdminApp.tsx:4843 | client | doc | root / top-level-candidate | 미해석 | partner_item/{id} |  |
| src/shared/employeeAuth.ts:19 | client | doc | root / top-level-candidate | 미해석 | employees/{credential.user.uid} |  |
| functions/src/newScopeCounter.ts:27 | server | collection | root / top-level-candidate | 미해석 | {name} |  |
| functions/src/newScopeCounter.ts:91 | server | collection | root / top-level | 1 | items |  |
| functions/src/newScopeCounter.ts:91 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/newScopeCounter.ts:91 | server | collection | root / top-level | 1 | oemReceiptOperations |  |
| functions/src/oemBatchCostInvalidation.ts:15 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemBatchCostInvalidation.ts:16 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{statementId.slice('OEMFEE-'.length)} |  |
| functions/src/oemBatchCostInvalidation.ts:16 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemBatchCostInvalidation.ts:33 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemBatchCostInvalidation.ts:33 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemBatchCostInvalidation.ts:43 | server | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(companyId as 'taebaek' \| 'punghoe', id)} |  |
| functions/src/oemBatchCostInvalidation.ts:43 | server | collection | root / top-level | 1 | rawInventories |  |
| functions/src/statementCreationReceipt.ts:9 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/returnClaimReader.ts:20 | server | doc | root / top-level-candidate | 미해석 | returnOperations/{id} |  |
| functions/src/returnClaimReader.ts:20 | server | collection | root / top-level | 1 | returnOperations |  |
| functions/src/partnerAdvanceClaimReader.ts:46 | server | doc | root / top-level-candidate | 미해석 | partnerAdvanceOperations/{row.noncashApplication?.operationId} |  |
| functions/src/partnerAdvanceClaimReader.ts:46 | server | collection | root / top-level | 1 | partnerAdvanceOperations |  |
| functions/src/statementIssueReceipt.ts:36 | server | doc | root / top-level-candidate | 미해석 | statementIssueOperations/{statementIssueTextHash(JSON.stringify([identity.companyId,identity.operationId]))} |  |
| functions/src/statementIssueReceipt.ts:36 | server | collection | root / top-level | 1 | statementIssueOperations |  |
| functions/src/statementIssueReceipt.ts:56 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{id} |  |
| functions/src/statementIssueReceipt.ts:56 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/statementIssueReceipt.ts:56 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{id} |  |
| functions/src/statementIssueReceipt.ts:56 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/statementIssueReceipt.ts:61 | server | collection | root / top-level-candidate | 미해석 | {collection} |  |
| functions/src/partnerPaymentCommand.ts:104 | server | doc | root / top-level-candidate | 미해석 | partnerPaymentOperations/{input.operationId} |  |
| functions/src/partnerPaymentCommand.ts:104 | server | collection | root / top-level | 1 | partnerPaymentOperations |  |
| functions/src/partnerPaymentCommand.ts:105 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.operationId} |  |
| functions/src/partnerPaymentCommand.ts:105 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/partnerPaymentCommand.ts:106 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.operationId} |  |
| functions/src/partnerPaymentCommand.ts:106 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerPaymentCommand.ts:107 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate)} |  |
| functions/src/partnerPaymentCommand.ts:107 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerPaymentCommand.ts:108 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate, '추가')} |  |
| functions/src/partnerPaymentCommand.ts:108 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerPaymentCommand.ts:109 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/partnerPaymentCommand.ts:109 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerPaymentCommand.ts:110 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${input.partnerId}`} |  |
| functions/src/partnerPaymentCommand.ts:110 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/partnerPaymentCommand.ts:111 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.cashAccountId} |  |
| functions/src/partnerPaymentCommand.ts:111 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/partnerPaymentCommand.ts:112 | server | doc | root / top-level-candidate | 미해석 | partners/{input.partnerId} |  |
| functions/src/partnerPaymentCommand.ts:112 | server | collection | root / top-level | 1 | partners |  |
| functions/src/partnerPaymentCommand.ts:117 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/partnerPaymentCommand.ts:117 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/partnerPaymentCommand.ts:118 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/partnerPaymentCommand.ts:118 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/partnerPaymentCommand.ts:120 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/partnerPaymentCommand.ts:208 | server | doc | root / top-level-candidate | 미해석 | settlements/{`st-${input.operationId}-${row.statementId}`} |  |
| functions/src/partnerPaymentCommand.ts:208 | server | collection | root / top-level | 1 | settlements |  |
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
| functions/src/deleteIssuedStatementCommand.ts:59 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/deleteIssuedStatementCommand.ts:72 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.statementId} |  |
| functions/src/deleteIssuedStatementCommand.ts:72 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/deleteIssuedStatementCommand.ts:72 | server | doc | root / top-level-candidate | 미해석 | voucherMutationOperations/{input.operationId} |  |
| functions/src/deleteIssuedStatementCommand.ts:72 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/deleteIssuedStatementCommand.ts:85 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/deleteIssuedStatementCommand.ts:102 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${partnerAtRead}`} |  |
| functions/src/deleteIssuedStatementCommand.ts:102 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/deleteIssuedStatementCommand.ts:105 | server | collection | root / top-level-candidate | 미해석 | {kind} |  |
| functions/src/deleteIssuedStatementCommand.ts:120 | server | doc | root / top-level-candidate | 미해석 | {kind}/{id} |  |
| functions/src/deleteIssuedStatementCommand.ts:120 | server | collection | root / top-level-candidate | 미해석 | {kind} |  |
| functions/src/deleteIssuedStatementCommand.ts:136 | server | doc | root / top-level-candidate | 미해석 | {row.kind}/{row.id} |  |
| functions/src/deleteIssuedStatementCommand.ts:136 | server | collection | root / top-level-candidate | 미해석 | {row.kind} |  |
| functions/src/deleteIssuedStatementCommand.ts:137 | server | doc | root / top-level-candidate | 미해석 | settlements/{row.id} |  |
| functions/src/deleteIssuedStatementCommand.ts:137 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/voucherIssue.ts:76 | server | doc | root / top-level-candidate | 미해석 | {kind}/{operationId} |  |
| functions/src/voucherIssue.ts:76 | server | collection | root / top-level-candidate | 미해석 | {kind} |  |
| functions/src/voucherIssue.ts:77 | server | doc | root / top-level-candidate | 미해석 | {kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries'}/{operationId} |  |
| functions/src/voucherIssue.ts:77 | server | collection | root / top-level-candidate | 미해석 | {kind === 'cashEntries' ? 'issuedStatements' : 'cashEntries'} |  |
| functions/src/voucherIssue.ts:78 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, tradeDate, prefix)} |  |
| functions/src/voucherIssue.ts:78 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/voucherIssue.ts:79 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, tradeDate, '추가')} |  |
| functions/src/voucherIssue.ts:79 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/voucherIssue.ts:88 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/voucherIssue.ts:89 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/voucherIssue.ts:90 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/voucherIssue.ts:91 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/voucherIssue.ts:97 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{document.cashAccountId} |  |
| functions/src/voucherIssue.ts:97 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/voucherIssue.ts:99 | server | doc | root / top-level-candidate | 미해석 | partners/{document.partnerId} |  |
| functions/src/voucherIssue.ts:99 | server | collection | root / top-level | 1 | partners |  |
| functions/src/voucherIssue.ts:100 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${document.partnerId}`} |  |
| functions/src/voucherIssue.ts:100 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/voucherIssue.ts:101 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/voucherIssue.ts:101 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/loanMovementCommand.ts:47 | server | doc | root / top-level-candidate | 미해석 | loanMovementOperations/{input.operationId} |  |
| functions/src/loanMovementCommand.ts:47 | server | collection | root / top-level | 1 | loanMovementOperations |  |
| functions/src/loanMovementCommand.ts:48 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{input.operationId} |  |
| functions/src/loanMovementCommand.ts:48 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/loanMovementCommand.ts:49 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{input.operationId} |  |
| functions/src/loanMovementCommand.ts:49 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/loanMovementCommand.ts:50 | server | doc | root / top-level-candidate | 미해석 | loanContracts/{input.loanId} |  |
| functions/src/loanMovementCommand.ts:50 | server | collection | root / top-level | 1 | loanContracts |  |
| functions/src/loanMovementCommand.ts:51 | server | doc | root / top-level-candidate | 미해석 | cashAccounts/{input.cashAccountId} |  |
| functions/src/loanMovementCommand.ts:51 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/loanMovementCommand.ts:52 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate)} |  |
| functions/src/loanMovementCommand.ts:52 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/loanMovementCommand.ts:53 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`loanMovementCutover_${companyId}`} |  |
| functions/src/loanMovementCommand.ts:53 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/loanMovementCommand.ts:56 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/loanMovementCommand.ts:57 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/loanMovementCommand.ts:184 | server | doc | root / top-level-candidate | 미해석 | loanMovementOperations/{recurringId(templateId, yearMonth)} |  |
| functions/src/loanMovementCommand.ts:184 | server | collection | root / top-level | 1 | loanMovementOperations |  |
| functions/src/loanMovementCommand.ts:195 | server | doc | root / top-level-candidate | 미해석 | fixedCostTemplates/{templateId} |  |
| functions/src/loanMovementCommand.ts:195 | server | collection | root / top-level | 1 | fixedCostTemplates |  |
| functions/src/loanMovementCommand.ts:201 | server | doc | root / top-level-candidate | 미해석 | loanContracts/{draft.loanId} |  |
| functions/src/loanMovementCommand.ts:201 | server | collection | root / top-level | 1 | loanContracts |  |
| functions/src/loanMovementCommand.ts:202 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/autoVoucherCommand.ts:20 | server | collection | root / top-level | 1 | cashAccounts |  |
| functions/src/autoVoucherCommand.ts:25 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/cancelPendingReturnCommand.ts:27 | server | doc | root / top-level-candidate | 미해석 | returnRequests/{input.requestId} |  |
| functions/src/cancelPendingReturnCommand.ts:27 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/cancelPendingReturnCommand.ts:32 | server | doc | root / top-level-candidate | 미해석 | returnSubmissionOperations/{input.requestId} |  |
| functions/src/cancelPendingReturnCommand.ts:32 | server | collection | root / top-level | 1 | returnSubmissionOperations |  |
| functions/src/cancelPendingReturnCommand.ts:81 | server | collection | root / top-level | 1 | returnOperations |  |
| functions/src/cancelPendingReturnCommand.ts:82 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/tradeStatementIssue.ts:168 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{raw.id} |  |
| functions/src/tradeStatementIssue.ts:168 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/tradeStatementIssue.ts:169 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{raw.id} |  |
| functions/src/tradeStatementIssue.ts:169 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/tradeStatementIssue.ts:170 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '')} |  |
| functions/src/tradeStatementIssue.ts:170 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/tradeStatementIssue.ts:171 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '추가')} |  |
| functions/src/tradeStatementIssue.ts:171 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/tradeStatementIssue.ts:172 | server | doc | root / top-level-candidate | 미해석 | partners/{raw.partnerId} |  |
| functions/src/tradeStatementIssue.ts:172 | server | collection | root / top-level | 1 | partners |  |
| functions/src/tradeStatementIssue.ts:173 | server | doc | root / top-level-candidate | 미해석 | orders/{id} |  |
| functions/src/tradeStatementIssue.ts:173 | server | collection | root / top-level | 1 | orders |  |
| functions/src/tradeStatementIssue.ts:174 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{id} |  |
| functions/src/tradeStatementIssue.ts:174 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:175 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{newPo.id} |  |
| functions/src/tradeStatementIssue.ts:175 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:177 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/tradeStatementIssue.ts:177 | server | collection | root / top-level | 1 | items |  |
| functions/src/tradeStatementIssue.ts:178 | server | doc | root / top-level-candidate | 미해석 | item_purchase_unit/{line.purchaseUnitId} |  |
| functions/src/tradeStatementIssue.ts:178 | server | collection | root / top-level | 1 | item_purchase_unit |  |
| functions/src/tradeStatementIssue.ts:179 | server | doc | root / top-level-candidate | 미해석 | items/{c.itemId} |  |
| functions/src/tradeStatementIssue.ts:179 | server | collection | root / top-level | 1 | items |  |
| functions/src/tradeStatementIssue.ts:181 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/tradeStatementIssue.ts:181 | server | collection | root / top-level | 1 | items |  |
| functions/src/tradeStatementIssue.ts:182 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/tradeStatementIssue.ts:183 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`poCardNo_${companyId}_${cardNo}`} |  |
| functions/src/tradeStatementIssue.ts:183 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/tradeStatementIssue.ts:185 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/tradeStatementIssue.ts:187 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/tradeStatementIssue.ts:194 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/tradeStatementIssue.ts:195 | server | collection | root / top-level | 1 | voucherMutationOperations |  |
| functions/src/tradeStatementIssue.ts:354 | server | doc | root / top-level-candidate | 미해석 | itemCostHistory/{`${raw.id}_${cost.itemId}_${cost.sourceLineIndex}`} |  |
| functions/src/tradeStatementIssue.ts:354 | server | collection | root / top-level | 1 | itemCostHistory |  |
| functions/src/inspectTradeStatementCommand.ts:47 | server | doc | root / top-level-candidate | 미해석 | partnerPaymentOperations/{request.operationId} |  |
| functions/src/inspectTradeStatementCommand.ts:47 | server | collection | root / top-level | 1 | partnerPaymentOperations |  |
| functions/src/inspectTradeStatementCommand.ts:48 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{request.operationId} |  |
| functions/src/inspectTradeStatementCommand.ts:48 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/inspectTradeStatementCommand.ts:49 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{request.operationId} |  |
| functions/src/inspectTradeStatementCommand.ts:49 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/inspectTradeStatementCommand.ts:54 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/inspectTradeStatementCommand.ts:107 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{identity.statementId} |  |
| functions/src/inspectTradeStatementCommand.ts:107 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/inspectTradeStatementCommand.ts:108 | server | doc | root / top-level-candidate | 미해석 | cashEntries/{identity.statementId} |  |
| functions/src/inspectTradeStatementCommand.ts:108 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/inspectTradeStatementCommand.ts:121 | server | collection | root / top-level-candidate | 미해석 | {collection} |  |
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
| functions/src/editIssuedStatementCommand.ts:67 | server | doc | root / top-level-candidate | 미해석 | pendingStatementEdits/{approval.pendingEditRequestId} |  |
| functions/src/editIssuedStatementCommand.ts:67 | server | collection | root / top-level | 1 | pendingStatementEdits |  |
| functions/src/editIssuedStatementCommand.ts:146 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/editIssuedStatementCommand.ts:147 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/editIssuedStatementCommand.ts:148 | server | doc | root / top-level-candidate | 미해석 | item_purchase_unit/{line.purchaseUnitId} |  |
| functions/src/editIssuedStatementCommand.ts:148 | server | collection | root / top-level | 1 | item_purchase_unit |  |
| functions/src/editIssuedStatementCommand.ts:149 | server | doc | root / top-level-candidate | 미해석 | items/{line.itemId} |  |
| functions/src/editIssuedStatementCommand.ts:149 | server | collection | root / top-level | 1 | items |  |
| functions/src/employeeLogin.ts:32 | server | doc | root / top-level-candidate | 미해석 | authLoginAttempts/{loginKey(username, request.rawRequest.ip ?? 'unknown')} |  |
| functions/src/employeeLogin.ts:32 | server | collection | root / top-level | 1 | authLoginAttempts |  |
| functions/src/employeeLogin.ts:39 | server | collection | root / top-level | 1 | employees |  |
| functions/src/oemFeeVoucher.ts:69 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{poId} |  |
| functions/src/oemFeeVoucher.ts:69 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemFeeVoucher.ts:70 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`OEMFEE-${poId}`} |  |
| functions/src/oemFeeVoucher.ts:70 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/oemFeeVoucher.ts:71 | server | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${poId}`} |  |
| functions/src/oemFeeVoucher.ts:71 | server | collection | root / top-level | 1 | adjustmentRequests |  |
| functions/src/oemFeeVoucher.ts:72 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, date, '가공')} |  |
| functions/src/oemFeeVoucher.ts:72 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/oemFeeVoucher.ts:73 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/oemFeeVoucher.ts:74 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/oemFeeVoucher.ts:88 | server | doc | root / top-level-candidate | 미해석 | oemReceiptOperations/{po.oemReceiptOperationId} |  |
| functions/src/oemFeeVoucher.ts:88 | server | collection | root / top-level | 1 | oemReceiptOperations |  |
| functions/src/oemFeeVoucher.ts:106 | server | doc | root / top-level-candidate | 미해석 | partners/{po.oemPartnerId ?? po.partnerId} |  |
| functions/src/oemFeeVoucher.ts:106 | server | collection | root / top-level | 1 | partners |  |
| functions/src/oemFeeVoucher.ts:118 | server | doc | root / top-level-candidate | 미해석 | oemReceiptOperations/{`oem-receive:${poId}`} |  |
| functions/src/oemFeeVoucher.ts:118 | server | collection | root / top-level | 1 | oemReceiptOperations |  |
| functions/src/oemFeeVoucher.ts:136 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(row.operationId)} |  |
| functions/src/oemFeeVoucher.ts:136 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/oemFeeVoucher.ts:149 | server | doc | root / top-level-candidate | 미해석 | items/{row.rawItemId} |  |
| functions/src/oemFeeVoucher.ts:149 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemFeeVoucher.ts:150 | server | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(companyId as 'taebaek'\|'punghoe',row.rawItemId)} |  |
| functions/src/oemFeeVoucher.ts:150 | server | collection | root / top-level | 1 | rawInventories |  |
| functions/src/oemFeeVoucher.ts:159 | server | doc | root / top-level-candidate | 미해석 | items/{item.itemId} |  |
| functions/src/oemFeeVoucher.ts:159 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemFeeVoucher.ts:160 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/oemFeeVoucher.ts:163 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemFeeVoucher.ts:163 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:77 | server | doc | root / top-level-candidate | 미해석 | purchaseOrders/{input.poId} |  |
| functions/src/oemReceiptCommand.ts:77 | server | collection | root / top-level | 1 | purchaseOrders |  |
| functions/src/oemReceiptCommand.ts:78 | server | doc | root / top-level-candidate | 미해석 | adjustmentRequests/{`OEMFEE-${input.poId}`} |  |
| functions/src/oemReceiptCommand.ts:78 | server | collection | root / top-level | 1 | adjustmentRequests |  |
| functions/src/oemReceiptCommand.ts:79 | server | doc | root / top-level-candidate | 미해석 | oemReceiptOperations/{input.operationId} |  |
| functions/src/oemReceiptCommand.ts:79 | server | collection | root / top-level | 1 | oemReceiptOperations |  |
| functions/src/oemReceiptCommand.ts:80 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemReceiptCommand.ts:80 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:107 | server | doc | root / top-level-candidate | 미해석 | partners/{po.oemPartnerId ?? po.partnerId} |  |
| functions/src/oemReceiptCommand.ts:107 | server | collection | root / top-level | 1 | partners |  |
| functions/src/oemReceiptCommand.ts:114 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/oemReceiptCommand.ts:116 | server | doc | root / top-level-candidate | 미해석 | items/{id} |  |
| functions/src/oemReceiptCommand.ts:116 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:123 | server | collection | root / top-level | 1 | item_formula |  |
| functions/src/oemReceiptCommand.ts:124 | server | collection | root / top-level | 1 | items |  |
| functions/src/oemReceiptCommand.ts:143 | server | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(companyId as 'taebaek'\|'punghoe',row.rawId)} |  |
| functions/src/oemReceiptCommand.ts:143 | server | collection | root / top-level | 1 | rawInventories |  |
| functions/src/oemReceiptCommand.ts:144 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(row.operationId)} |  |
| functions/src/oemReceiptCommand.ts:144 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/oemReceiptCommand.ts:147 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(row.operationId)} |  |
| functions/src/oemReceiptCommand.ts:147 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/oemReceiptCommand.ts:201 | server | doc | root / top-level-candidate | 미해석 | appMeta/{lotCounterId(companyId, input.date, material)} |  |
| functions/src/oemReceiptCommand.ts:201 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/oemReceiptCommand.ts:229 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{po.oemBatchCost.feeStatementId} |  |
| functions/src/oemReceiptCommand.ts:229 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/oemReceiptCommand.ts:280 | server | doc | root / top-level-candidate | 미해석 | items/{row.rawId} |  |
| functions/src/oemReceiptCommand.ts:280 | server | collection | root / top-level | 1 | items |  |
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
| functions/src/returnRawStockPlan.ts:50 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(operationId)} |  |
| functions/src/returnRawStockPlan.ts:50 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/returnRawStockPlan.ts:52 | server | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(input.companyId, target.rawItem.id)} |  |
| functions/src/returnRawStockPlan.ts:52 | server | collection | root / top-level | 1 | rawInventories |  |
| functions/src/returnRawStockPlan.ts:53 | server | doc | root / top-level-candidate | 미해석 | items/{target.rawItem.id} |  |
| functions/src/returnRawStockPlan.ts:53 | server | collection | root / top-level | 1 | items |  |
| functions/src/returnRawStockPlan.ts:55 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(operationId)} |  |
| functions/src/returnRawStockPlan.ts:55 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/processReturnCommand.ts:53 | server | doc | root / top-level-candidate | 미해석 | returnOperations/{input.operationId} |  |
| functions/src/processReturnCommand.ts:53 | server | collection | root / top-level | 1 | returnOperations |  |
| functions/src/processReturnCommand.ts:54 | server | doc | root / top-level-candidate | 미해석 | returnRequests/{input.returnRequestId} |  |
| functions/src/processReturnCommand.ts:54 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/processReturnCommand.ts:55 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`return-${input.operationId}`} |  |
| functions/src/processReturnCommand.ts:55 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:56 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{`return-${input.operationId}`} |  |
| functions/src/processReturnCommand.ts:56 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:57 | server | doc | root / top-level-candidate | 미해석 | appMeta/{voucherSequenceKey(companyId, input.tradeDate, '반품')} |  |
| functions/src/processReturnCommand.ts:57 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/processReturnCommand.ts:58 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`returnCutover_${companyId}`} |  |
| functions/src/processReturnCommand.ts:58 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/processReturnCommand.ts:59 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentCutover_${companyId}`} |  |
| functions/src/processReturnCommand.ts:59 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/processReturnCommand.ts:64 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:65 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:66 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:67 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/processReturnCommand.ts:101 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{request.linkedStatementId} |  |
| functions/src/processReturnCommand.ts:101 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:102 | server | doc | root / top-level-candidate | 미해석 | partners/{request.partnerId} |  |
| functions/src/processReturnCommand.ts:102 | server | collection | root / top-level | 1 | partners |  |
| functions/src/processReturnCommand.ts:103 | server | doc | root / top-level-candidate | 미해석 | appMeta/{`partnerPaymentState_${companyId}_${request.partnerId}`} |  |
| functions/src/processReturnCommand.ts:103 | server | collection | root / top-level | 1 | appMeta |  |
| functions/src/processReturnCommand.ts:107 | server | collection | root / top-level | 1 | returnRequests |  |
| functions/src/processReturnCommand.ts:108 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/processReturnCommand.ts:109 | server | collection | root / top-level | 1 | cashEntries |  |
| functions/src/processReturnCommand.ts:110 | server | collection | root / top-level | 1 | settlements |  |
| functions/src/processReturnCommand.ts:111 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:112 | server | collection | root / top-level | 1 | items |  |
| functions/src/processReturnCommand.ts:113 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/processReturnCommand.ts:114 | server | collection | root / top-level | 1 | accountCodes |  |
| functions/src/processReturnCommand.ts:120 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} |  |
| functions/src/processReturnCommand.ts:120 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:134 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{expected.id} |  |
| functions/src/processReturnCommand.ts:134 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:146 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{expected.id} |  |
| functions/src/processReturnCommand.ts:146 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/processReturnCommand.ts:250 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} |  |
| functions/src/processReturnCommand.ts:250 | server | collection | root / top-level | 1 | returnApplications |  |
| functions/src/processReturnCommand.ts:303 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{row.receiptId} |  |
| functions/src/processReturnCommand.ts:303 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:352 | server | doc | root / top-level-candidate | 미해석 | items/{row.itemId} |  |
| functions/src/processReturnCommand.ts:352 | server | collection | root / top-level | 1 | items |  |
| functions/src/processReturnCommand.ts:354 | server | doc | root / top-level-candidate | 미해석 | itemReceipts/{row.receiptId} |  |
| functions/src/processReturnCommand.ts:354 | server | collection | root / top-level | 1 | itemReceipts |  |
| functions/src/processReturnCommand.ts:358 | server | doc | root / top-level-candidate | 미해석 | returnApplications/{row.id} |  |
| functions/src/processReturnCommand.ts:358 | server | collection | root / top-level | 1 | returnApplications |  |
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
| functions/src/inventoryOpeningCommand.ts:28 | server | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| functions/src/inventoryOpeningCommand.ts:28 | server | collection | root / top-level | 1 | items |  |
| functions/src/inventoryOpeningCommand.ts:28 | server | doc | root / top-level-candidate | 미해석 | openingBalances/{companyId === 'taebaek' ? 'main' : 'main-punghoe'} |  |
| functions/src/inventoryOpeningCommand.ts:28 | server | collection | root / top-level | 1 | openingBalances |  |
| functions/src/inventoryOpeningCommand.ts:29 | server | doc | root / top-level-candidate | 미해석 | issuedStatements/{`opening-inventory-${companyId}-${itemId}`} |  |
| functions/src/inventoryOpeningCommand.ts:29 | server | collection | root / top-level | 1 | issuedStatements |  |
| functions/src/inventoryOpeningCommand.ts:53 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{operationDocId(operationId)} |  |
| functions/src/inventoryOpeningCommand.ts:53 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/inventoryOpeningCommand.ts:54 | server | doc | root / top-level-candidate | 미해석 | rawInventories/{inventoryDocId(companyId,itemId)} |  |
| functions/src/inventoryOpeningCommand.ts:54 | server | collection | root / top-level | 1 | rawInventories |  |
| functions/src/inventoryOpeningCommand.ts:55 | server | doc | root / top-level-candidate | 미해석 | rawMaterialLedger/{legacyOperationDocId(operationId)} |  |
| functions/src/inventoryOpeningCommand.ts:55 | server | collection | root / top-level | 1 | rawMaterialLedger |  |
| functions/src/inventoryOpeningCommand.ts:63 | server | collection | root / top-level | 1 | item_bom |  |
| functions/src/inventoryOpeningCommand.ts:65 | server | doc | root / top-level-candidate | 미해석 | items/{String(row.data().child_id)} |  |
| functions/src/inventoryOpeningCommand.ts:65 | server | collection | root / top-level | 1 | items |  |
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
| functions/src/orderLockRecovery.ts:20 | server | doc | root / top-level-candidate | 미해석 | orders/{input.orderId} |  |
| functions/src/orderLockRecovery.ts:20 | server | collection | root / top-level | 1 | orders |  |
| functions/src/orderLockRecovery.ts:20 | server | doc | root / top-level-candidate | 미해석 | orderStatusAudits/{input.failedOperationId} |  |
| functions/src/orderLockRecovery.ts:20 | server | collection | root / top-level | 1 | orderStatusAudits |  |
| functions/src/orderLockRecovery.ts:21 | server | doc | root / top-level-candidate | 미해석 | orderLockRecoveryOperations/{'order-unlock-'+identity(companyId,input)} |  |
| functions/src/orderLockRecovery.ts:21 | server | collection | root / top-level | 1 | orderLockRecoveryOperations |  |
| functions/src/orderRequestRetirement.ts:45 | server | doc | root / top-level-candidate | 미해석 | orderRequestRetirementAuthorizations/{retirementIdentity({companyId,orderId:g.orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid})} |  |
| functions/src/orderRequestRetirement.ts:45 | server | collection | root / top-level | 1 | orderRequestRetirementAuthorizations |  |
| functions/src/orderRequestRetirement.ts:45 | server | doc | root / top-level-candidate | 미해석 | orderRequestRetirements/{retirementIdentity({companyId,orderId:g.orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid})} |  |
| functions/src/orderRequestRetirement.ts:45 | server | collection | root / top-level | 1 | orderRequestRetirements |  |
| functions/src/orderRequestRetirement.ts:45 | server | doc | root / top-level-candidate | 미해석 | orders/{g.orderId} |  |
| functions/src/orderRequestRetirement.ts:45 | server | collection | root / top-level | 1 | orders |  |
| functions/src/orderRequestRetirement.ts:78 | server | doc | root / top-level-candidate | 미해석 | items/{itemId} |  |
| functions/src/orderRequestRetirement.ts:78 | server | collection | root / top-level | 1 | items |  |
| functions/src/orderRequestRetirement.ts:78 | server | doc | root / top-level-candidate | 미해석 | inventoryWriterDeletions/{companyId+'__'+itemId} |  |
| functions/src/orderRequestRetirement.ts:78 | server | collection | root / top-level | 1 | inventoryWriterDeletions |  |
| functions/src/orderRequestRetirement.ts:83 | server | doc | root / top-level-candidate | 미해석 | rawInventories/{companyId+'__'+rawItemId} |  |
| functions/src/orderRequestRetirement.ts:83 | server | collection | root / top-level | 1 | rawInventories |  |
| functions/src/orderRequestRetirement.ts:85 | server | doc | root / top-level-candidate | 미해석 | {row.collection}/{row.id} |  |
| functions/src/orderRequestRetirement.ts:85 | server | collection | root / top-level-candidate | 미해석 | {row.collection} |  |
| functions/src/orderRequestRetirement.ts:118 | server | doc | root / top-level-candidate | 미해석 | orders/{request.orderId} |  |
| functions/src/orderRequestRetirement.ts:118 | server | collection | root / top-level | 1 | orders |  |
| functions/src/orderRequestRetirement.ts:118 | server | doc | root / top-level-candidate | 미해석 | orderRequestRetirements/{request.retirementId} |  |
| functions/src/orderRequestRetirement.ts:118 | server | collection | root / top-level | 1 | orderRequestRetirements |  |
| functions/src/orderRequestRetirement.ts:136 | server | doc | root / top-level-candidate | 미해석 | {row.collection}/{row.id} |  |
| functions/src/orderRequestRetirement.ts:136 | server | collection | root / top-level-candidate | 미해석 | {row.collection} |  |
| functions/src/orderRequestRetirement.ts:141 | server | doc | root / top-level-candidate | 미해석 | inventoryWriterDeletions/{companyId+'__'+row.id} |  |
| functions/src/orderRequestRetirement.ts:141 | server | collection | root / top-level | 1 | inventoryWriterDeletions |  |
| functions/src/index.ts:46 | server | collection | root / top-level | 1 | users |  |
| functions/src/index.ts:67 | server | collection | root / top-level | 1 | users |  |
| functions/src/index.ts:122 | server | collection | root / top-level | 1 | items |  |
| functions/src/index.ts:128 | server | doc | root / top-level-candidate | 미해석 | inventorySnapshots/{co === 'taebaek' ? `inv-snap-${yearMonth}` : `inv-snap-${co}-${yearMonth}`} |  |
| functions/src/index.ts:128 | server | collection | root / top-level | 1 | inventorySnapshots |  |
| functions/src/index.ts:166 | server | collection | root / top-level | 1 | fixedCostTemplates |  |
| functions/src/index.ts:229 | server | doc | root / top-level-candidate | 미해석 | employees/{empId} |  |
| functions/src/index.ts:229 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:256 | server | collection | root / top-level | 1 | employees |  |
| functions/src/index.ts:299 | server | doc | root / top-level-candidate | 미해석 | chatRooms/{String(msg.roomId)} |  |
| functions/src/index.ts:299 | server | collection | root / top-level | 1 | chatRooms |  |
| functions/src/index.ts:307 | server | doc | root / top-level-candidate | 미해석 | employees/{id} |  |
| functions/src/index.ts:307 | server | collection | root / top-level | 1 | employees |  |

## 별도 모델 보완

shared/types.ts 외 interface/type alias 828개를 별도 목록에 기록한다. 직접 property만 나열하며 상속·교차/공용체·mapped type·객체 전개는 펼치지 않는다. UI 상태/요청/응답 모델도 있으므로 DB 필드로 단정하지 않는다. 이 목록의 필드는 기존 shared 선언 필드 통계와 사용처 집계에 합치지 않는다. shared/types.ts 안의 type alias도 기존 interface 전용 집계에서는 제외된다.

| 모델 | 선언 위치 | 종류 | 범위 | 직접 필드 |
| --- | --- | --- | --- | --- |
| ProductStocktakeRequest | src/shared/productStocktakeAttempt.ts:2 | type-alias | direct-properties-only | version, operationId, companyId, uid, itemId, itemName, targetQty, minStock, unitKg, capturedAt |
| ProductStocktakeAttempt | src/shared/productStocktakeAttempt.ts:3 | type-alias | non-object-alias-not-expanded |  |
| OemCostEvidence | functions/src/shared/oemBatchCost.ts:1 | type-alias | direct-properties-only | version, ownerCompanyId, rawMaterials, packaging, capturedAt |
| OemCostScope | functions/src/shared/oemBatchCost.ts:4 | type-alias | direct-properties-only | companyId, sent |
| OemCostRow | functions/src/shared/oemBatchCost.ts:5 | type-alias | direct-properties-only | itemId, kg, kind, rawItemId, lotId |
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
| Row | functions/src/shared/inventoryWriterProtocol.ts:1 | type-alias | non-object-alias-not-expanded |  |
| InventoryWriterContext | src/shared/inventoryWriterProtocol.ts:18 | interface | direct-properties-only | companyId, actorUid, requestIdentity, isStillCurrent |
| CaptureOptions | src/shared/inventoryWriterProtocol.ts:24 | type-alias | direct-properties-only | requestIdentity, companyId, isStillCurrent, getCurrentUser, ready |
| Seen | src/shared/inventoryWriterProtocol.ts:43 | type-alias | direct-properties-only | snapshot, ref |
| Written | src/shared/inventoryWriterProtocol.ts:44 | type-alias | direct-properties-only | ref, kind, data |
| InventoryWriterObserver | src/shared/inventoryWriterProtocol.ts:45 | type-alias | non-object-alias-not-expanded |  |
| LegacyLedgerFields | functions/src/shared/rawInventoryDocument.ts:11 | interface | direct-properties-only | note, type, addedBy, orderId, canSize, canCount, canSizeTag, originalAmount, originalUnit |
| RawUnit | functions/src/shared/formula.ts:60 | type-alias | non-object-alias-not-expanded |  |
| RawReadSnapshot | functions/src/shared/rawInventoryPrepare.ts:6 | interface | direct-properties-only |  |
| RawCommandRead | functions/src/shared/rawInventoryPrepare.ts:7 | interface | direct-properties-only | movementSnap, oldMovementSnap, stateSnap, itemSnap, originalSnap, oldOriginalSnap, guardSnap |
| RawPrepareOptions | functions/src/shared/rawInventoryPrepare.ts:13 | interface | direct-properties-only | now, newLotId, carryOverLotId, mirrorToItem, legacy |
| CollectionName | src/shared/collections.ts:130 | type-alias | non-object-alias-not-expanded |  |
| RawCommandOptions | src/shared/services/rawInventoryService.ts:43 | interface | direct-properties-only | assertScope, now, newLotId, carryOverLotId, db, mirrorToItem, legacy |
| RawPressRequest | src/shared/rawPressAttempt.ts:5 | interface | direct-properties-only | version, companyId, actorUid, entry, yieldRule, sourceCommand, derivedCommand, sourceLegacy, derivedLegacy |
| RawPressRetained | src/shared/rawPressAttempt.ts:45 | type-alias | direct-properties-only | request, encoded, storageKey, state |
| RawPressEntry | src/shared/rawPressAttempt.ts:46 | type-alias | direct-properties-only | key, retained, deleted, error |
| RawPressCancellationRequest | src/shared/rawPressAttempt.ts:125 | interface | direct-properties-only | version, companyId, actorUid, originalOperationId, cancellationId, effectiveAt, createdAt, original, sourceReverse, derivedReverse |
| OrderInventoryGeneration | src/shared/orderInventoryGeneration.ts:4 | interface | direct-properties-only | contractVersion, companyId, orderId, operationId, startedAt, actorUid |
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
| OrderRawBatchCommand | src/shared/orderRawBatchAttempt.ts:11 | interface | direct-properties-only | command, options |
| OrderRawBatchRequest | src/shared/orderRawBatchAttempt.ts:12 | interface | direct-properties-only | version, generation, jobId, legacyJobIds, recordedAt, business, plan, commands |
| BomLine | src/shared/bomIndex.ts:19 | interface | direct-properties-only | childId, qty, child |
| BomDraftLine | src/shared/bomIndex.ts:36 | interface | direct-properties-only | childId, qty |
| BomParentLine | src/shared/bomIndex.ts:42 | interface | direct-properties-only | parentId, qty, parent |
| BomIndex | src/shared/bomIndex.ts:48 | interface | direct-properties-only |  |
| PackRow | src/shared/packIndex.ts:26 | interface | direct-properties-only | item_id, units_per_box |
| PackIndex | src/shared/packIndex.ts:31 | interface | direct-properties-only | of, size |
| StockComponent | functions/src/shared/stockUnitMeasure.ts:3 | type-alias | direct-properties-only | childId, qty, child |
| BoxLike | src/shared/orderUnits.ts:13 | type-alias | non-object-alias-not-expanded |  |
| OrderUnitInputs | src/shared/orderUnits.ts:15 | interface | direct-properties-only | bom, pack |
| 묶음갈래 | src/shared/orderUnits.ts:45 | type-alias | non-object-alias-not-expanded |  |
| LineAmount | functions/src/shared/lineAmount.ts:2 | interface | direct-properties-only | gross, supply, tax |
| RawHolderItem | functions/src/shared/rawHolder.ts:4 | type-alias | direct-properties-only | id, name, companyId, subtype, phantom, archived, rawMaterialName |
| PurchaseCostFallback | functions/src/shared/purchaseCost.ts:5 | type-alias | non-object-alias-not-expanded |  |
| StatementType | src/shared/statementLines.ts:19 | type-alias | non-object-alias-not-expanded |  |
| ManualRow | src/shared/statementLines.ts:22 | interface | direct-properties-only | sourceLineIndex, purchaseQuantityKg, itemId, name, spec, qty, price, isTaxExempt, note, accountCode, side |
| LineItem | src/shared/statementLines.ts:32 | interface | direct-properties-only | sourceLineIndex, purchaseQuantityKg, itemId, lineKind, key, no, name, spec, qty, price, supply, tax, total, isTaxExempt, accountCode, side, unknownItem, taxUnknown |
| ResolvedOrderItem | src/shared/statementLines.ts:143 | interface | direct-properties-only | product, qty, perBox, unknownItem |
| OrderLinesInput | src/shared/statementLines.ts:203 | interface | direct-properties-only | orderUnitInputs, order, stmtType, allItems, partnerItems, partnerId, editablePrices, taxExemptOverrides, accountCodeOverrides |
| LineTotals | src/shared/statementLines.ts:286 | interface | direct-properties-only | isTwoSided, supply, tax, amount |
| KstDateRangeUtc | src/shared/day.ts:18 | interface | direct-properties-only | startInclusive, endExclusive |
| ProductionRecordIndexEntry | src/shared/orderProductionRecordPlan.ts:9 | type-alias | non-object-alias-not-expanded |  |
| ProductionRecordIndex | src/shared/orderProductionRecordPlan.ts:10 | type-alias | non-object-alias-not-expanded |  |
| LegacyProductionSourceCandidate | src/shared/orderProductionRecordPlan.ts:11 | interface | direct-properties-only | recordId, companyId, itemId, note |
| OrderGeneratedProductionRecord | src/shared/orderProductionRecordPlan.ts:12 | type-alias | non-object-alias-not-expanded |  |
| OrderProductionRecordPlan | src/shared/orderProductionRecordPlan.ts:13 | interface | direct-properties-only | version, generation, recordedAt, previousIndex, records |
| OrderProductionRecordReceipt | src/shared/orderProductionRecordPlan.ts:14 | interface | direct-properties-only | version, generation, requestHash, recordIds, completedAt |
| OemReceiptScope | src/shared/oemReceiptPending.ts:3 | type-alias | direct-properties-only | companyId, actorUid, poId |
| OemReceiptRequest | src/shared/oemReceiptPending.ts:4 | type-alias | direct-properties-only | poId, operationId, date, returns, unitPricePerKg, oemCostEvidence, bulk, releaseId |
| OemReceiptDraft | src/shared/oemReceiptPending.ts:6 | type-alias | direct-properties-only | po, returns, bulk, unitPricePerKg, date, oemCostEvidence |
| DraftRecord | src/shared/oemReceiptPending.ts:7 | type-alias | non-object-alias-not-expanded |  |
| PacketRecord | src/shared/oemReceiptPending.ts:8 | type-alias | non-object-alias-not-expanded |  |
| OemReceiptEntry | src/shared/oemReceiptPending.ts:9 | type-alias | direct-properties-only | scope, draft, packet, draftText, packetText, legacyText, deleted, legacy, error |
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
| ProductLotClock | functions/src/shared/productLot.ts:4 | type-alias | direct-properties-only | now, date, id |
| ProductLotTake | functions/src/shared/productLot.ts:73 | interface | direct-properties-only | lotId, lotNo, receivedDate, supplierName, qty |
| InventoryKindItem | functions/src/shared/itemInventoryKind.ts:1 | interface | direct-properties-only | type, unit, subtype, rawMaterialName, density |
| CategoryKey | src/shared/taxonomy.ts:19 | type-alias | non-object-alias-not-expanded |  |
| TaxonomyRow | src/shared/taxonomy.ts:47 | interface | direct-properties-only | id, kind, key, parent, label, order, hidden |
| Taxonomy | src/shared/taxonomy.ts:58 | interface | direct-properties-only | types, allTypes, labelOf, subtypesOf, categoriesOf, seeded |
| TypeKey | src/shared/itemTaxonomy.ts:86 | type-alias | non-object-alias-not-expanded |  |
| AnchorResult | functions/src/shared/lotAnchor.ts:41 | interface | direct-properties-only | lots, deltaQty, beforeQty |
| ItemReceipt | src/shared/receipt.ts:4 | interface | direct-properties-only | id, itemId, itemName, quantity, unit, partnerId, partnerName, date, poId, companyId, addedBy, createdAt |
| CompanyClaim | src/shared/companyWriteBoundary.ts:14 | type-alias | direct-properties-only | companyId |
| LoanContract | src/shared/loanLedger.ts:6 | interface | direct-properties-only | id, companyId, name, lenderName, partnerId, accountCode, openingDate, openingPrincipal, maturityDate, note, createdAt |
| LoanMovement | src/shared/loanLedger.ts:20 | interface | direct-properties-only | entry, principalDelta |
| OrderRequestRetirementResult | src/shared/services/orderRequestRetirementService.ts:8 | interface | direct-properties-only | status, action, allowNewClaim, inventoryApplied, requestHash, requestText, authorizationId, retirementId, generation |
| ItemSaveOptions | src/shared/services/firebaseService.ts:98 | type-alias | direct-properties-only | reconcileSmartStoreMarker |
| PartnerRegistrationConflict | src/shared/services/firebaseService.ts:438 | type-alias | direct-properties-only | code, partnerId, existingPartner |
| AddItemOptions | src/shared/services/firebaseService.ts:443 | type-alias | direct-properties-only | partnerRegistration |
| CompanyWriteOperation | src/shared/services/firebaseService.ts:759 | type-alias | non-object-alias-not-expanded |  |
| PendingPurchaseOrderConfirmation | src/shared/services/confirmPendingPurchaseOrderService.ts:14 | type-alias | direct-properties-only | status, poId, invoicedAt |
| AppConfirmOptions | src/shared/components/appDialog.ts:1 | interface | direct-properties-only | title, message, confirmText, cancelText, tone |
| AppPromptOptions | src/shared/components/appDialog.ts:9 | interface | direct-properties-only | title, message, defaultValue, placeholder, confirmText |
| ConfirmRequest | src/shared/components/appDialog.ts:17 | type-alias | non-object-alias-not-expanded |  |
| NoticeRequest | src/shared/components/appDialog.ts:18 | type-alias | direct-properties-only | kind, title, message, resolve |
| PromptRequest | src/shared/components/appDialog.ts:19 | type-alias | non-object-alias-not-expanded |  |
| AppDialogRequest | src/shared/components/appDialog.ts:20 | type-alias | non-object-alias-not-expanded |  |
| OrderInventoryRecoveryResult | src/shared/services/orderInventoryRecoveryService.ts:6 | interface | direct-properties-only | status, orderId, failedOperationId, failedStartedAt, inventoryApplied, reason, failureMessage, targetStatus |
| PendingOrderInventoryRecovery | src/shared/services/orderInventoryRecoveryService.ts:27 | interface | direct-properties-only | version, companyId, uid, orderId, failedOperationId, failedStartedAt, expectedSaved |
| Props | components/OrderInventoryRecoveryPanel.tsx:6 | interface | direct-properties-only | companyId, actorUid, orders, pending, isCurrentActor, onRecovered |
| Entry | components/OrderInventoryRecoveryPanel.tsx:7 | type-alias | direct-properties-only | orderId, partnerName, operationId, startedAt, pending |
| Notice | components/OrderInventoryRecoveryPanel.tsx:9 | type-alias | direct-properties-only | message, checks, failure |
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
| ModalShellProps | src/shared/components/ModalShell.tsx:5 | interface | direct-properties-only | title, subtitle, onClose, children, footer, className, bodyClassName, layer, size |
| LargeModalShellProps | src/shared/components/LargeModalShell.tsx:4 | type-alias | non-object-alias-not-expanded |  |
| ProductionWorkDocument | src/features/production-documents/domain/productionWorkDocument.ts:5 | interface | direct-properties-only | id, companyId, documentDate, templateVersion, specialNotes, preparedByName, reviewedByName, approvedByName, revision, rowCount, createdAt, createdBy, updatedAt, updatedBy |
| ProductionWorkFields | src/features/production-documents/domain/productionWorkDocument.ts:22 | interface | direct-properties-only | manufacturedDate, itemId, itemNameSnapshot, specSnapshot, manufacturingLotNo, expiryDate, productionQty, productionUnit, rawItemId, rawNameSnapshot, rawUsedKg, rawLotId, rawLotNoSnapshot, workerNameSnapshot, note |
| ProductionWorkSource | src/features/production-documents/domain/productionWorkDocument.ts:40 | interface | direct-properties-only | kind, sourceId, operationId, ledgerId, lotId, recordedAt, importedAt |
| ProductionWorkDocumentLine | src/features/production-documents/domain/productionWorkDocument.ts:50 | interface | direct-properties-only | id, companyId, documentId, batchKey, sortOrder, documentRevision, source, sourceState, sourceSnapshot, manualFields |
| ProductionWorkEvidence | src/features/production-documents/domain/productionWorkDocument.ts:64 | interface | direct-properties-only | companyId, key, batchKey, fields, source, reversed |
| ProductionWorkPrintRow | src/features/production-documents/domain/productionWorkDocument.ts:158 | interface | direct-properties-only | line, showProduction, issues |
| ProductionWorkDocumentPrintProps | src/features/production-documents/ui/ProductionWorkDocumentPrint.tsx:8 | interface | direct-properties-only | document, lines |
| ProductionWorkDocumentEditorProps | src/features/production-documents/ui/ProductionWorkDocumentEditor.tsx:12 | interface | direct-properties-only | initialDocument, initialLines, loadEvidence, onStateChange, onSave |
| ProductionDocumentWrite | src/shared/services/productionWorkDocumentService.ts:9 | interface | direct-properties-only | id, companyId, revision |
| ProductionDocumentLineWrite | src/shared/services/productionWorkDocumentService.ts:14 | interface | direct-properties-only | id, companyId, documentId |
| LedgerEvidence | src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:40 | type-alias | non-object-alias-not-expanded |  |
| HostProps | src/features/production-documents/ui/ProductionWorkDocumentHost.tsx:6 | type-alias | direct-properties-only | companyId, date, actorId, onStateChange |
| AlertTone | src/shared/components/AlertModalShell.tsx:22 | type-alias | non-object-alias-not-expanded |  |
| Props | src/shared/components/AlertModalShell.tsx:37 | interface | direct-properties-only | title, tone, icon, onClose, wide, children, footer |
| ConfirmModalProps | src/shared/components/ConfirmModal.tsx:13 | interface | direct-properties-only | title, tone, icon, message, subMessage, body, confirmDisabled, footerNote, confirmText, cancelText, confirmOnly, onConfirm, onCancel |
| Margin | src/shared/margin.ts:26 | interface | direct-properties-only | supply, cost, margin, marginRate, markupRate |
| PrintableLine | src/shared/docName.ts:44 | interface | direct-properties-only | name, spec |
| BomCostCtx | src/shared/bomCost.ts:19 | interface | direct-properties-only | allItems, formulaOf, formulaRowsOf, processingFeeOf, itemBoms |
| CostFn | src/shared/bomCost.ts:48 | interface | direct-properties-only | rollup |
| CostCalcRow | src/features/admin/costCalc.ts:18 | interface | direct-properties-only | itemId, qty |
| CostCalcLine | src/features/admin/costCalc.ts:24 | interface | direct-properties-only | itemId, name, spec, unit, qty, unitCost, amount |
| CostCalcResult | src/features/admin/costCalc.ts:37 | interface | direct-properties-only | lines, cost, fee, price, margin, marginRate, markupRate |
| PriceRange | src/shared/partnerPrice.ts:40 | interface | direct-properties-only | min, max, count |
| RawUsersDeps | src/shared/rawUsers.ts:28 | interface | direct-properties-only | allItems, bomOf, buildFormula, baseRawName |
| RequestBody | src/shared/services/returnRequestSubmission.ts:4 | type-alias | non-object-alias-not-expanded |  |
| PendingReturnSubmission | src/shared/services/returnRequestSubmission.ts:5 | type-alias | direct-properties-only | version, companyId, userId, requestId, request |
| CreateCommand | src/shared/services/employeeCommand.ts:7 | type-alias | direct-properties-only | kind, collection, data |
| ReceiveCommand | src/shared/services/employeeCommand.ts:11 | type-alias | direct-properties-only | kind, poId, actorName, items, orderUnitInputs |
| RawPressOutcome | src/shared/services/rawPressService.ts:13 | type-alias | non-object-alias-not-expanded |  |
| RawPressJob | src/shared/services/rawPressService.ts:16 | type-alias | non-object-alias-not-expanded |  |
| Read | src/shared/services/rawPressService.ts:20 | type-alias | non-object-alias-not-expanded |  |
| RawPressCancellationOutcome | src/shared/services/rawPressService.ts:139 | type-alias | non-object-alias-not-expanded |  |
| LedgerRow | src/shared/derivedRawDocEntries.ts:4 | type-alias | non-object-alias-not-expanded |  |
| DerivedRawDocEntry | src/shared/derivedRawDocEntries.ts:5 | type-alias | direct-properties-only | date, received, used, note, type, createdAt |
| UnpackPlan | src/shared/canUnpack.ts:36 | interface | direct-properties-only | canItemId, canName, cans, bulkItemId, bulkName, bulkUnit, perCan, bulkQty, discarded |
| UnpackReject | src/shared/canUnpack.ts:60 | type-alias | non-object-alias-not-expanded |  |
| UnpackResult | src/shared/canUnpack.ts:68 | type-alias | non-object-alias-not-expanded |  |
| UnpackLotMove | src/shared/unpackLots.ts:36 | interface | direct-properties-only | canLotId, lotNo, supplierName, receivedDate, cans, bulkQty |
| UnpackLotResult | src/shared/unpackLots.ts:48 | interface | direct-properties-only | canLots, bulkLots, moves, shortageQty |
| Base | src/shared/itemInventoryAttempt.ts:5 | type-alias | direct-properties-only | version, operationId, companyId, uid, capturedAt, date |
| ItemStockAddRequest | src/shared/itemInventoryAttempt.ts:6 | type-alias | non-object-alias-not-expanded |  |
| CanUnpackRequest | src/shared/itemInventoryAttempt.ts:7 | type-alias | non-object-alias-not-expanded |  |
| BoxUnpackRequest | src/shared/itemInventoryAttempt.ts:8 | type-alias | non-object-alias-not-expanded |  |
| ItemInventoryRequest | src/shared/itemInventoryAttempt.ts:9 | type-alias | non-object-alias-not-expanded |  |
| ItemInventoryKind | src/shared/itemInventoryAttempt.ts:10 | type-alias | non-object-alias-not-expanded |  |
| ItemInventoryRetained | src/shared/itemInventoryAttempt.ts:11 | type-alias | direct-properties-only | request, state, encoded, storageKey, copies |
| ItemInventoryOutcome | src/shared/itemInventoryAttempt.ts:12 | type-alias | direct-properties-only | ok, message, status, retainPending |
| Initial | src/shared/itemInventoryAttempt.ts:13 | type-alias | non-object-alias-not-expanded |  |
| ItemInventoryEntry | src/shared/itemInventoryAttempt.ts:38 | type-alias | direct-properties-only | key, retained, error, deleted |
| UnpackOutcome | src/shared/services/unpackService.ts:50 | interface | direct-properties-only | ok, message, moves, status |
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
| StatementCommandKind | src/features/statements/domain/statementCommand.ts:21 | type-alias | non-object-alias-not-expanded |  |
| StatementCommand | src/features/statements/domain/statementCommand.ts:23 | interface | direct-properties-only | operationId, kind, statementId, expectedVersion, companyId, partnerId, partnerName, tradeDate, type, docNo, memo, orderIds, lines, partySnapshot, totals |
| StatementRejectionCode | src/features/statements/domain/statementCommand.ts:53 | type-alias | non-object-alias-not-expanded |  |
| StatementRejection | src/features/statements/domain/statementCommand.ts:61 | interface | direct-properties-only | code, lineIndexes, lineNames |
| StatementWarningCode | src/features/statements/domain/statementCommand.ts:70 | type-alias | non-object-alias-not-expanded |  |
| StatementWarning | src/features/statements/domain/statementCommand.ts:74 | interface | direct-properties-only | code, lineIndexes, lineNames |
| StatementCheck | src/features/statements/domain/statementCommand.ts:80 | interface | direct-properties-only | ok, rejections, warnings |
| BuildInput | src/features/statements/domain/statementCommand.ts:87 | interface | direct-properties-only | kind, statementId, partnerId, partnerName, tradeDate, type, docNo, memo, orderIds, lines, companyId, expectedVersion, partySnapshot |
| TradeStatementDraft | src/features/statements/infrastructure/tradeStatementPending.ts:5 | type-alias | direct-properties-only | command, statement, costUpdates, poIds, newPoItems |
| TradeStatementPending | src/features/statements/infrastructure/tradeStatementPending.ts:6 | type-alias | direct-properties-only | version, companyId, userId, input, payment |
| PendingEntry | src/features/statements/infrastructure/tradeStatementPending.ts:22 | type-alias | direct-properties-only | key, text, pending, archived, deleted, invalid, recoveryReason, identity, copies |
| PendingSources | src/features/statements/infrastructure/tradeStatementPending.ts:46 | type-alias | direct-properties-only | statementId, operationId, orderIds, poIds |
| IssueRequest | src/features/statements/infrastructure/tradeStatementPending.ts:116 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, costUpdates, newPo |
| RecoveryScope | src/features/statements/domain/tradeStatementRecovery.ts:4 | type-alias | direct-properties-only | companyId, actorUid |
| RecoveryCopy | src/features/statements/domain/tradeStatementRecovery.ts:5 | type-alias | direct-properties-only | key, text |
| RecoveryRequest | src/features/statements/domain/tradeStatementRecovery.ts:6 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, costUpdates, releaseId, newPo |
| RecoveryEntry | src/features/statements/domain/tradeStatementRecovery.ts:7 | type-alias | non-object-alias-not-expanded |  |
| RecoveryInspection | src/features/statements/domain/tradeStatementRecovery.ts:8 | type-alias | direct-properties-only | companyId, actorId, operationId, statementId, requestHash, inspectionId, status, cancellation, reason, docNo, serverRequestText, currentStatement, statement, rejection, payment |
| TradeStatementIssueInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:9 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, newPo, costUpdates |
| PartnerPaymentInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:159 | type-alias | direct-properties-only | tradeDate, partnerId, direction, amount, cashAccountId, pin, allocations, note |
| Request | src/features/statements/infrastructure/issueTradeStatementCommand.ts:191 | type-alias | non-object-alias-not-expanded |  |
| PageHeaderProps | src/shared/components/PageHeader.tsx:3 | interface | direct-properties-only | title, subtitle, right |
| OrderCreationModalHeaderProps | src/shared/components/OrderCreationModalHeader.tsx:4 | interface | direct-properties-only | currentLabel, description, onBack, onClose |
| Line | src/shared/orderLine.ts:26 | type-alias | non-object-alias-not-expanded |  |
| GroupMark | src/shared/rowGroup.ts:19 | interface | direct-properties-only | groupId, groupName, groupFirst, groupLast |
| GroupOf | src/shared/rowGroup.ts:27 | interface | direct-properties-only | id, name |
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
| CardDatePickerButtonProps | components/OrdersList.tsx:122 | interface | direct-properties-only | label, value, onChange, className, children, disabled |
| OrdersListProps | components/OrdersList.tsx:242 | interface | direct-properties-only | renderOrderRecovery, orderRecoveryOrphans, orderUnitInputs, companyId, title, employees, subtitle, groupBy, allowedStatuses, orders, partners, items, partnerItems, palletStocks, itemBoms, onUpdateStatus, onUpdateDeliveryDate, onUpdateReceivedDate, onUpdatePallets, onUpdateItems, onUpdateNote, onUpdateDeliveryBoxes, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleShipmentComplete, onToggleItemChecked, onDeleteOrder, onAddClick, onPasteClick, currentUserName, highlightOrderId, onHighlightClear, newOrderId, onNewOrderIdClear, workOrderItems, onSetWorkOrderItems, onLoadHistoricalOrders, isLoadingHistoricalOrders, ordersMonths, onChangeOrdersMonths, embeddedListOnly, calendarSlot |
| OrderCardProps | components/OrdersList.tsx:310 | interface | direct-properties-only | renderOrderRecovery, orderUnitInputs, order, partners, items, partnerItems, palletStocks, itemBoms, editingOrderId, setEditingOrderId, showAddProductSelect, setShowAddProductSelect, onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onUpdatePallets, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleItemChecked, onDeleteOrder, currentUserName, gridCols, isListView, tintedHeader, isHighlighted, highlightOrderId, readOnly, onEditOrder, onRequestShip |
| OrderSourceGroupProps | components/OrdersList.tsx:352 | interface | direct-properties-only | orderUnitInputs, colId, source, orders, gridCols, collapsedCategories, onToggleCategory, partners, items, partnerItems, editingOrderId, setEditingOrderId, showAddProductSelect, setShowAddProductSelect, onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onToggleInvoicePrinted, onToggleItemChecked, onDeleteOrder, currentUserName, isListView, highlightOrderId, onCardClick, onEditOrder, tintedHeader |
| DeliveryRowProps | components/OrdersList.tsx:386 | interface | direct-properties-only | order, partnerName, items, onToggleInvoicePrinted, onUpdateDeliveryBoxes |
| TabType | components/OrdersList.tsx:394 | type-alias | non-object-alias-not-expanded |  |
| WorkItem | components/OrdersList.tsx:1732 | type-alias | direct-properties-only | key, orderId, itemId, lineKey, itemName, partnerName, qty, category, workGroup, groupId, groupName |
| Command | src/shared/services/returnRequestCancellation.ts:5 | type-alias | direct-properties-only | companyId, requestId, operationId, expectedRequest |
| Result | src/shared/services/returnRequestCancellation.ts:6 | type-alias | direct-properties-only | status, requestId, operationId, requestHash |
| RoleLike | src/shared/partnerRole.ts:17 | type-alias | non-object-alias-not-expanded |  |
| ProductModalProps | components/AddItemModal.tsx:20 | interface | direct-properties-only | companyId, orderUnitInputs, initialData, allSubmaterials, items, partners, partnerItems, onClose, onSave, onUpsertPartnerItem, onDeletePartnerItem, onAddSubmaterial, rawItems, itemFormulas, onSaveItemFormula, rollupCostOf |
| SpecUnit | components/AddItemModal.tsx:66 | type-alias | non-object-alias-not-expanded |  |
| RawEntrySubmitResult | components/RawMaterialEntryModal.tsx:10 | type-alias | non-object-alias-not-expanded |  |
| Props | components/RawMaterialEntryModal.tsx:11 | interface | direct-properties-only | open, mode, materials, defaultMaterial, currentUserName, lotsForMaterial, onClose, onSubmit, companyId, actorUid, getActorUid, rawYieldRules |
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
| OemReceiptItemChange | src/features/admin/oemReceiptInventory.ts:8 | interface | direct-properties-only | itemId, qty, lot, material, unitKg |
| OemReceiptInventoryInput | src/features/admin/oemReceiptInventory.ts:16 | interface | direct-properties-only | oemCostEvidence, companyId, poId, operationId, date, items, bulk, poPatch, feeRequest |
| JobCommandInput | src/shared/services/rawInventoryJob.ts:20 | interface | direct-properties-only | command, options |
| JobCommandResult | src/shared/services/rawInventoryJob.ts:25 | type-alias | direct-properties-only | input, result |
| RunJobOptions | src/shared/services/rawInventoryJob.ts:27 | interface | direct-properties-only | assertScope, now, db |
| RunJobOutcome | src/shared/services/rawInventoryJob.ts:33 | interface | direct-properties-only | job, results |
| OemIssueRequest | src/shared/oemIssuePending.ts:5 | type-alias | direct-properties-only | version, companyId, actorUid, input |
| OemIssueRetained | src/shared/oemIssuePending.ts:6 | type-alias | direct-properties-only | request, encoded, key |
| OemIssueEntry | src/shared/oemIssuePending.ts:7 | type-alias | direct-properties-only | key, retained, deleted, error, companyId, actorUid, legacyText, legacyStore |
| OemIssueLine | src/features/admin/oemIssueJob.ts:9 | type-alias | direct-properties-only | material, rawItemId, kg |
| OemIssueInput | src/features/admin/oemIssueJob.ts:10 | interface | direct-properties-only | jobId, companyId, partnerId, partnerName, sent, date, note, addedBy, oemCostEvidence |
| OemIssueDraft | src/features/admin/oemIssueJob.ts:22 | type-alias | non-object-alias-not-expanded |  |
| OemIssuePorts | src/features/admin/oemIssueJob.ts:43 | interface | direct-properties-only | prepareDraft, runRawSteps, missingRawSteps, finalizeDraft, markFailed |
| OemFeeStatementWrite | src/features/admin/oemFeeStatement.ts:4 | interface | direct-properties-only | companyId, poId, perKg, statement |
| OemEngineDeps | src/features/admin/oemEngine.ts:33 | interface | direct-properties-only | orderUnitInputs, companyId, items, partners, issueOemBatchJob, adjustRawLots, updateItem, addItem, applyOemReceiptInventory, applyOemFeeStatement, buildFormula, processingFeeCode |
| StoredOemCostDisplay | src/features/admin/oemReconciliation.ts:8 | type-alias | non-object-alias-not-expanded |  |
| OemExternalEvidence | src/features/admin/oemExternalStock.ts:5 | interface | direct-properties-only | po, job, receipts, reversals, guards |
| OemExternalRow | src/features/admin/oemExternalStock.ts:12 | interface | direct-properties-only | poId, partnerName, state, rows, reason |
| Props | components/OemManager.tsx:23 | interface | direct-properties-only | actorUid, isCurrentActor, orderUnitInputs, companyId, items, partners, rawStockKg, issueDrafts, purchaseOrders, issueOpen, receiveTarget, feeTarget, onClose, onIssue, onReceive, onIssueFee |
| IssueInput | components/OemManager.tsx:42 | type-alias | non-object-alias-not-expanded |  |
| ReceiveInput | components/OemManager.tsx:43 | type-alias | non-object-alias-not-expanded |  |
| Props | components/CategoryManager.tsx:14 | interface | direct-properties-only | onClose, onSaved, usage, companyId |
| StockClosingRow | components/ItemList.tsx:186 | interface | direct-properties-only | itemId, name, spec, boxSize, boxes, loose, total |
| StockClosing | components/ItemList.tsx:187 | interface | direct-properties-only | id, date, closedBy, createdAt, items, totalStock |
| ItemListProps | components/ItemList.tsx:198 | interface | direct-properties-only | orderUnitInputs, mode, companyId, items, orderRequests, confirmedOrders, dispatchedQtyByItem, onUpdateItem, onAddItem, onAddOrderRequest, onRemoveOrderRequest, onUpdateOrderRequestQty, onUpdatePoItemQty, onRemovePoItem, onRequestPoEdit, onToggleConfirmRequestQty, onConfirmRequest, onConfirmRequests, onBulkAddConfirmedOrders, onConfirmAllRequests, onFinishConfirmedOrder, onUpdateConfirmedQty, onUpdatePendingFlowQty, onRemoveConfirmedOrder, onEditProduct, onDeleteItem, onAddAdjustmentRequest, inboundPartners, partners, partnerItems, rawMaterialLedger, linesUsingRaw, orders, onRequestPurchaseInvoice, onOpenVoucher, issuedStatements, onAddRawMaterialEntry, onDeleteRawMaterialEntry, onLedgerChanged, currentUser, isAdmin, onUpdateSubmaterial, receivedOrders, returnRequests, returnContent, onProcessReturn, onResumeReturn, returnBadge, oemEnabled, oemIssueDrafts, rawStockKg, rawYieldRules, onOemIssue, onOemReceive, onOemCancel, onOemIssueFee |
| MainTab | components/ItemList.tsx:275 | type-alias | non-object-alias-not-expanded |  |
| FlowTypeFilter | components/ItemList.tsx:315 | type-alias | non-object-alias-not-expanded |  |
| FlowStatusFilter | components/ItemList.tsx:316 | type-alias | non-object-alias-not-expanded |  |
| InboundSubTab | components/ItemList.tsx:317 | type-alias | non-object-alias-not-expanded |  |
| TopTab | components/ItemList.tsx:320 | type-alias | non-object-alias-not-expanded |  |
| GroupRow | components/ItemList.tsx:1373 | type-alias | direct-properties-only | p, isChild, parentId, boxCount |
| FlowRow | components/ItemList.tsx:1707 | type-alias | direct-properties-only | key, id, type, status, date, partnerName, itemSummary, quantitySummary, source |
| GridRow | components/ItemList.tsx:3679 | type-alias | direct-properties-only | itemId, label, spec, editable, isChild, group |
| Vouchered | src/shared/statementOrders.ts:24 | type-alias | non-object-alias-not-expanded |  |
| PartnerOrdersInput | src/shared/statementOrders.ts:39 | interface | direct-properties-only | orders, partnerId, isVouchered, onlyActive, dateFrom, dateTo |
| OrderStatusDotProps | src/shared/components/OrderStatusDot.tsx:4 | interface | direct-properties-only | status, className |
| OrderItemLinesProps | src/shared/components/OrderItemLines.tsx:5 | interface | direct-properties-only | orderItems, itemById, className |
| NewOrderLineInput | src/shared/newOrderDraft.ts:8 | interface | direct-properties-only | itemId, quantity, isBoxUnit, unitsPerBox, boxType, boxSubId, displaySize, orderedAs |
| AddOrderModalProps | components/AddOrderModal.tsx:28 | interface | direct-properties-only | mode, orderUnitInputs, items, orders, partners, partnerItems, palletStocks, submaterials, onClose, onBack, onSave |
| ScopedOrderSource | functions/src/shared/orderCopyInterpretationScope.ts:1 | type-alias | direct-properties-only | sourceId, text |
| ScopedOrderLine | functions/src/shared/orderCopyInterpretationScope.ts:2 | type-alias | direct-properties-only | itemId, qty, isBox, source |
| ScopedOrderResponse | functions/src/shared/orderCopyInterpretationScope.ts:3 | type-alias | direct-properties-only | valid, results, unresolvedSourceIds |
| RawExtracted | src/shared/orderExtract.ts:27 | interface | direct-properties-only | partnerId, deliveryDate, lines, note |
| ExtractedLine | src/shared/orderExtract.ts:34 | interface | direct-properties-only | itemId, name, qty, isBox, source |
| ExtractResult | src/shared/orderExtract.ts:45 | interface | direct-properties-only | partnerId, partnerName, deliveryDate, note, lines, rejected |
| CatalogItem | src/shared/orderExtract.ts:55 | interface | direct-properties-only | id, name, spec |
| CatalogPartner | src/shared/orderExtract.ts:56 | interface | direct-properties-only | id, name |
| ScopedExtractResult | src/shared/orderExtract.ts:57 | interface | direct-properties-only | valid, scopeValid, results, unresolvedSourceIds, lines, rejected |
| HistoryOrder | src/shared/orderExtract.ts:195 | interface | direct-properties-only | partnerId, createdAt, items |
| OrderInterpretationJson | functions/src/shared/orderInterpretation.ts:1 | type-alias | non-object-alias-not-expanded |  |
| OrderInterpretationJsonObject | functions/src/shared/orderInterpretation.ts:2 | type-alias | direct-properties-only |  |
| OrderInterpretationScope | functions/src/shared/orderInterpretation.ts:3 | type-alias | direct-properties-only | companyId, actorUid |
| OrderExpressionConfirmation | functions/src/shared/orderInterpretation.ts:4 | interface | direct-properties-only | sourceStart, sourceEnd, sourceText, scope, target, value |
| OrderExpressionRule | functions/src/shared/orderInterpretation.ts:5 | interface | direct-properties-only | kind, partnerId, alias, itemId, status, scope, target, value |
| OrderInterpretationRequest | functions/src/shared/orderInterpretation.ts:6 | interface | direct-properties-only | version, requestId, createdAt, sourceText, firstAnalysis, confirmed |
| OrderInterpretationAliasCandidate | functions/src/shared/orderInterpretation.ts:87 | interface | direct-properties-only | partnerId, alias, itemId |
| OrderInterpretationAliasResolution | functions/src/shared/orderInterpretation.ts:107 | type-alias | non-object-alias-not-expanded |  |
| OrderExpressionCandidate | functions/src/shared/orderInterpretation.ts:132 | interface | direct-properties-only | kind, partnerId, alias, itemId, scope, target, value |
| InterpretationRule | functions/src/orderCopyCommands.ts:11 | interface | direct-properties-only | ruleId, companyId, partnerId, alias, itemId, status, revision, captureIds, orderIds |
| OrderCopyInput | functions/src/orderCopyCommands.ts:39 | interface | direct-properties-only | action, requestText, requestHash, releaseId |
| OrderCopyResult | functions/src/orderCopyCommands.ts:40 | interface | direct-properties-only | status, requestId, orderId, requestHash, reason |
| PendingOrderCopy | src/shared/services/orderCopyService.ts:7 | interface | direct-properties-only | key, text, request, deleted, error |
| OrderInterpretationRule | src/shared/services/orderCopyService.ts:44 | interface | direct-properties-only | ruleId, companyId, partnerId, alias, itemId, status, revision, captureIds, orderIds, kind, scope, target, value |
| ScopedSource | src/shared/orderCopyInterpretationScope.ts:5 | type-alias | non-object-alias-not-expanded |  |
| OrderCopyScopeRow | src/shared/orderCopyInterpretationScope.ts:6 | type-alias | direct-properties-only | sourceId, rawText, rawName, qty, isBox, selectedProductId, manual, aiResolved, aliasConflict, orderedAs, sourceStart, sourceEnd |
| Context | src/shared/orderCopyInterpretationScope.ts:7 | type-alias | direct-properties-only | catalog, rules, partnerId |
| ParsedLine | components/PasteOrderModal.tsx:57 | type-alias | non-object-alias-not-expanded |  |
| OrderCopyEvidence | components/PasteOrderModal.tsx:101 | interface | direct-properties-only | sourceText, firstAnalysis, inputLines, expressionConfirmations |
| PasteOrderModalProps | components/PasteOrderModal.tsx:102 | interface | direct-properties-only | suspended, isCurrentActor, companyId, actorUid, orderUnitInputs, items, partners, orders, partnerItems, palletStocks, initialText, onClose, onBack, onSave |
| Step | components/PasteOrderModal.tsx:125 | type-alias | non-object-alias-not-expanded |  |
| Props | components/OrderInterpretationRules.tsx:6 | interface | direct-properties-only | companyId, actorUid, isAdmin, onClose, onChanged, isCurrentActor |
| DeliveryGroup | src/shared/deliveryPlan.ts:33 | interface | direct-properties-only | id, name, orderIds |
| DayPlan | src/shared/deliveryPlan.ts:41 | interface | direct-properties-only | ordering, timeSlots, done, by, groups |
| DeliveryPlanDoc | src/shared/deliveryPlan.ts:55 | interface | direct-properties-only | byDate, ordering, timeSlots |
| DayRow | src/shared/deliveryPlan.ts:99 | interface | direct-properties-only | orderId, auto, slot, done, groupId, groupName, groupFirst, groupLast |
| DayListHandlers | components/DeliveryDayList.tsx:24 | interface | direct-properties-only | open, toggleDone, toggleSlot, remove, reorder, select |
| Props | components/DeliveryDayList.tsx:39 | interface | direct-properties-only | rows, orders, partners, on, compact, selected, dateStr, positionOffset |
| DeliveryManagerProps | components/DeliveryManager.tsx:44 | interface | direct-properties-only | renderOrderRecovery, orderRecoveryOrphans, companyId, calendarOnly, sortMode, orders, partners, items, itemBoms, partnerItems, palletStocks, currentUserName, onUpdateDeliveryDate, onUpdateStatus, onUpdateItems, onUpdateNote, onUpdatePallets, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleShipmentComplete, onToggleItemChecked, onDeleteOrder |
| PalletManagerProps | components/PalletManager.tsx:30 | interface | direct-properties-only | companyId, pallets, orders, partners, palletTransactions, onUpdatePallet, onAddPalletTransaction |
| Row | components/PalletManager.tsx:330 | type-alias | direct-properties-only | id, date, partner, pallet, type, quantity, status, note, txId |
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
| Applied | src/shared/services/orderRawBatchService.ts:15 | type-alias | non-object-alias-not-expanded |  |
| OrderRawBatchOutcome | src/shared/services/orderRawBatchService.ts:16 | type-alias | direct-properties-only | status, request, results, reason |
| Read | src/shared/services/orderRawBatchService.ts:17 | type-alias | non-object-alias-not-expanded |  |
| OrderRawBatchRead | src/shared/services/orderRawBatchService.ts:18 | type-alias | non-object-alias-not-expanded |  |
| RawUsageKg | src/features/admin/orderRawInventory.ts:14 | type-alias | non-object-alias-not-expanded |  |
| OrderRawInventoryDeps | src/features/admin/orderRawInventory.ts:16 | interface | direct-properties-only | actorName, allItems, partners, db, addNotification, runRawInventoryJob |
| OrderProductLotMutationResult | src/features/admin/orderProductLots.ts:6 | interface | direct-properties-only | lots, consumedLots |
| OrderProductLotMutation | src/features/admin/orderProductLots.ts:11 | interface | direct-properties-only | itemId, apply |
| OrderProductLotDeps | src/features/admin/orderProductLots.ts:82 | interface | direct-properties-only | allItems, shipQtyOf |
| OrderItemStockDeps | src/features/admin/orderItemStock.ts:13 | interface | direct-properties-only | db, allItems, bomIndex, getActorUid |
| OrderStockReservation | src/features/admin/orderItemStock.ts:24 | interface | direct-properties-only | operationId, orderId, generation, itemIds, quantities, stockSnapshot, previousReservations, allocationQuantities, active |
| CancellationAction | src/features/admin/orderInventoryCancellation.ts:13 | type-alias | non-object-alias-not-expanded |  |
| CancellationTicket | src/features/admin/orderInventoryCancellation.ts:111 | interface | direct-properties-only | orderId, companyId, action, evidence, operationId |
| CancellationReceipt | src/features/admin/orderInventoryCancellation.ts:115 | interface | direct-properties-only | id, companyId, orderId, state, cancellation |
| CancellationResult | src/features/admin/orderInventoryCancellation.ts:119 | interface | direct-properties-only | status, operationId, code, affectedItemIds, inventoryApplied, retryable, deleted, nextStatus |
| RollbackPlan | src/features/admin/rollbackSummary.ts:15 | interface | direct-properties-only | needed, lines, text, adjustments, legacyEvidenceWarning, warnings |
| OrderDeleteAction | src/features/admin/rollbackSummary.ts:235 | type-alias | non-object-alias-not-expanded |  |
| OrderDeleteStage | src/features/admin/rollbackSummary.ts:236 | type-alias | non-object-alias-not-expanded |  |
| OrderDeleteProgress | src/features/admin/rollbackSummary.ts:239 | interface | direct-properties-only | action, state, completedStages, inventoryApplied, error, retryable |
| OrderDeletePlan | src/features/admin/rollbackSummary.ts:248 | interface | direct-properties-only | action, allowed, nextStatus, state, message, subMessage, confirmText, blockedReasons, adjustments, completedStages, inventoryApplied, retryable |
| OrderProductionPreview | src/features/admin/orderProductionPreflight.ts:9 | type-alias | direct-properties-only | deltas, commands, lotMutations |
| OrderProductionRecordOutcome | src/shared/services/orderProductionRecordService.ts:15 | type-alias | direct-properties-only | status, recordIds, historyChanged, reason |
| StockUseChoice | src/features/admin/orderStockEngine.ts:32 | interface | direct-properties-only | own, loose |
| StockUsePlan | src/features/admin/orderStockEngine.ts:38 | type-alias | non-object-alias-not-expanded |  |
| OrderStatusChangeContext | src/features/admin/orderStockEngine.ts:40 | interface | direct-properties-only | approvedBy, approvedAt, approvedPlan, approvedFromStatus, orderPatch |
| PreparedOrderStatusChange | src/features/admin/orderStockEngine.ts:48 | interface | direct-properties-only | order, plan |
| OrderStockEngineDeps | src/features/admin/orderStockEngine.ts:66 | interface | direct-properties-only | orderUnitInputs, actorName, getActorUid, allItems, submaterials, partners, allOrders, orders, db, buildFormula, createProductionRecordsForOrder, createProductionRecordPlan, updateItem, addItem, claimOrderOperation, retireRetainedRequestBeforeClaim, runRawInventoryJob |
| FrozenProductLots | src/features/admin/orderStockEngine.ts:179 | type-alias | direct-properties-only | operationId, catalog, mutationItemIds, negative, positive |
| SavedLinePlan | src/features/admin/orderStockEngine.ts:1000 | type-alias | direct-properties-only | lineId, production, rowDeltas, attempt, commandIndices, productLots, bomLines |
| Engine | src/features/admin/orderStockEngine.ts:1267 | type-alias | non-object-alias-not-expanded |  |
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
| SharedChatBase | src/shared/sharedChatAttempt.ts:4 | interface | direct-properties-only | companyId, uid, shareId, roomId, senderId, senderName, text, createdAt, message |
| SharedChatFileAttempt | src/shared/sharedChatAttempt.ts:9 | type-alias | non-object-alias-not-expanded |  |
| SharedChatTextAttempt | src/shared/sharedChatAttempt.ts:13 | type-alias | non-object-alias-not-expanded |  |
| SharedChatAttempt | src/shared/sharedChatAttempt.ts:14 | type-alias | non-object-alias-not-expanded |  |
| MessageAction | src/shared/messageActions.ts:9 | type-alias | non-object-alias-not-expanded |  |
| ActionCtx | src/shared/messageActions.ts:11 | interface | direct-properties-only | msg, me, isAdmin, pinned |
| Reactions | src/shared/messageReactions.ts:21 | type-alias | non-object-alias-not-expanded |  |
| TimestampLike | src/shared/officeTalkTime.ts:1 | type-alias | direct-properties-only | toDate, seconds, _seconds |
| SharedChatAck | components/OfficeTalk.tsx:51 | interface | direct-properties-only | companyId, actorUid, shareId, messageText |
| OfficeTalkProps | components/OfficeTalk.tsx:53 | interface | direct-properties-only | currentUser, employees, chatRooms, chatMessages, initialRoomId, onRoomOpened, onAddRoom, onUpdateRoom, onDeleteRoom, onSendMessage, onUpdateMessage, isAdmin, onExtractOrder, extractedMessageIds |
| OrderLike | src/shared/newOrderAlert.ts:6 | interface | direct-properties-only | id, createdAt |
| PickOpts | src/shared/newOrderAlert.ts:8 | interface | direct-properties-only | seeded, since, mine |
| RoomLike | src/shared/newChatAlert.ts:6 | interface | direct-properties-only | id, name, nameBy, participantIds, lastMessage, lastUpdatedAt, lastReadBy |
| ChatPickOpts | src/shared/newChatAlert.ts:16 | interface | direct-properties-only | userId, openRoomId, focused |
| DocMismatch | src/shared/docOil.ts:320 | interface | direct-properties-only | date, saleKg, rawKg, diffKg, unmapped |
| DocDropReason | src/shared/docOil.ts:341 | type-alias | non-object-alias-not-expanded |  |
| DocDrop | src/shared/docOil.ts:342 | interface | direct-properties-only | date, partnerName, itemName, qty, reason |
| DropOrder | src/shared/docOil.ts:350 | interface | direct-properties-only | status, deliveredAt, partnerName, items |
| RawDocEntry | src/shared/docOil.ts:438 | interface | direct-properties-only | id, material, date, targetKg, type, note, createdAt |
| RawDocRow | src/shared/docOil.ts:450 | interface | direct-properties-only | date, received, used, adj, prevBalance, currentBalance, note, kind |
| RawDocSheet | src/shared/docOil.ts:461 | interface | direct-properties-only | rows, opening, closing, totalIn, totalOut |
| Ev | src/shared/docOil.ts:488 | type-alias | direct-properties-only | date, received, used, targetKg, note, kind, createdAt |
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
| Window | components/AddPartnerModal.tsx:11 | interface | direct-properties-only | daum |
| AddPartnerModalProps | components/AddPartnerModal.tsx:16 | interface | direct-properties-only | onClose, onSave, onOpenExisting |
| PartnerManagerProps | components/PartnerManager.tsx:31 | interface | direct-properties-only | partners, onUpdateClient, onAddClient, onDeleteClient |
| PayrollCommandInput | src/shared/services/payrollCommands.ts:7 | type-alias | direct-properties-only | yearMonth, payDate, lines, expectedRevision |
| HRManagerProps | components/HRManager.tsx:45 | interface | direct-properties-only | companyId, cashAccounts, employees, leaveRequests, onUpdateEmployee, onAddEmployee, onDeleteEmployee, onUpdateLeaveStatus, onUpdateLeave, onDeleteLeaveRequest, onAddLeaveRequests |
| MergedItem | src/shared/mergeStatementItems.ts:15 | interface | direct-properties-only | name, spec, qty, supply, tax, total, isTaxExempt |
| SplitMerged | src/shared/mergeStatementItems.ts:51 | interface | direct-properties-only | taxable, exempt |
| DocParty | src/shared/docParty.ts:21 | interface | direct-properties-only | name, bizNo, ceo, addr, bizType, bizItem, tel, fax |
| DocPartiesByIdInput | src/shared/docParty.ts:89 | interface | direct-properties-only | isSale, companyInfo, partners, partnerId, partnerName |
| TaxStatementProps | components/TaxStatement.tsx:23 | interface | direct-properties-only | companyId, issuedStatements, partners, companyInfo, onApplyTaxIssue |
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
| ClosingRecord | components/HaccpChecklist.tsx:4034 | interface | direct-properties-only | id, checkDate, checkZone, rows, specialNotes, createdBy, createdAt, updatedBy, updatedAt, confirmedBy, confirmedAt |
| BenzopyreneTest | components/BenzopyreneLog.tsx:11 | interface | direct-properties-only | id, productName, receivedDate, completedDate, testItem, criteria, result, judgment, lotNo, createdAt, addedBy |
| Props | components/BenzopyreneLog.tsx:28 | interface | direct-properties-only | companyId, currentUserName, isAdmin |
| Line | functions/src/returnReversalPlan.ts:4 | type-alias | non-object-alias-not-expanded |  |
| ReturnItem | functions/src/returnReversalPlan.ts:5 | type-alias | direct-properties-only | itemId, sourceLineIndex, quantity, isResellable |
| ReturnRow | functions/src/returnReversalPlan.ts:6 | type-alias | direct-properties-only | id, companyId, linkedStatementId, partnerId, status, returnType, totalAmount, items |
| Source | functions/src/returnReversalPlan.ts:8 | type-alias | direct-properties-only | id, companyId, type, partnerId, totalSupply, totalTax, totalAmount, items |
| JournalLine | functions/src/returnReversalPlan.ts:10 | type-alias | direct-properties-only | accountCode, side, amount |
| Item | functions/src/shared/returnStockKind.ts:4 | type-alias | non-object-alias-not-expanded |  |
| ExplicitReturnMoney | src/features/admin/purchaseReturnRequest.ts:94 | interface | direct-properties-only | items, payableAccountCode |
| DateRangeQuick | src/shared/components/DateRangeFilter.tsx:3 | type-alias | non-object-alias-not-expanded |  |
| ReturnManagerProps | components/ReturnManager.tsx:31 | interface | direct-properties-only | companyId, items, partners, orders, issuedStatements, currentUser, isAdmin, onProcessReturn |
| Tab | components/ReturnManager.tsx:42 | type-alias | non-object-alias-not-expanded |  |
| ReturnCardProps | components/ReturnManager.tsx:504 | interface | direct-properties-only | req, isAdmin, isProcessing, onProcess |
| PurchaseReturnRow | src/features/admin/purchaseReturnRows.ts:2 | interface | direct-properties-only | itemId, name, qty, unit, sourceLineIndex, unitKg, originalQty, remainingQty |
| ReturnTab | components/ReceivingReturnsManager.tsx:16 | type-alias | non-object-alias-not-expanded |  |
| ReceivingReturnsManagerProps | components/ReceivingReturnsManager.tsx:18 | interface | direct-properties-only | companyId, items, partnerItems, partners, orders, issuedStatements, currentUser, isAdmin, onProcessReturn, onLinkInbound |
| ProductionRecordProjectionStatus | src/shared/productionRecordProjection.ts:5 | type-alias | non-object-alias-not-expanded |  |
| ProductionRecordProjectionDetail | src/shared/productionRecordProjection.ts:6 | interface | direct-properties-only | record, status, reason |
| ItemFormulaRow | components/ProductionManager.tsx:11 | type-alias | direct-properties-only | parent_key, child_name, ratio, yield_rate |
| ProductionManagerProps | components/ProductionManager.tsx:29 | interface | direct-properties-only | records, items, orders, ledger, itemFormulas, onAdd, onDelete, onUpdate, currentUserName |
| RecoveryDeletion | src/features/statements/infrastructure/tradeStatementRecoveryService.ts:52 | type-alias | direct-properties-only | outcome, statement, pending, reason |
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
| Props | components/voucher/CashEntryModal.tsx:47 | interface | direct-properties-only | mode, initialSettle, partners, companyId, accountCodes, cashAccounts, accountId, onAccountId, partnerBalances, getBalance, latestStatement, onClose, onSettle, payrollEdit, transferEdit, onSaveEdit, onDeleteEntry, hasPendingRequest, onResumeEntry, onAssignCashAccount |
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
| StatementManualSearchResult | src/features/statements/ui/StatementManualItemRows.tsx:11 | interface | direct-properties-only | pc, product |
| Props | src/features/statements/ui/StatementManualItemRows.tsx:16 | interface | direct-properties-only | preservedPurchaseUnitLineIndices, companyId, selectedPartnerId, lockedPurchaseUnitItemIds, purchaseUnits, purchaseUnitLoadError, bomIndex, rows, savedLines, readOnly, selectedIndex, activeSearchIndex, statementType, accountCodes, items, linked, formatAmount, searchResults, onSelect, onChange, onSearchFocus, onSearchBlur, onChooseProduct, onRemove |
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
| TradeStatementProps | components/TradeStatement.tsx:102 | interface | direct-properties-only | orderUnitInputs, returnOperations, advanceStatements, orders, allItems, partners, partnerItems, accountCodes, accountGroups, cashAccounts, cashEntries, settlements, onAddCashEntry, onIssueCashEntry, onUpdateCashEntry, onMatchCashAllocations, onResumeCashMutation, onAddSettlement, onUpdateSettlement, onDeleteCashEntry, onDeleteSettlement, onAddCashAccount, onUpdateCashAccount, fixedCostTemplates, onGenerateRecurringCosts, onAddFixedCostTemplate, onUpdateFixedCostTemplate, onDeleteFixedCostTemplate, voucherMode, embedded, issuedStatements, onUpdateStatus, onUpsertPartnerItem, onAddIssuedStatement, onApplyStatement, companyId, onUpdateIssuedStatement, onProposeEdit, focusDocNo, onFocusHandled, detailStatementId, onDetailClose, onDeleteIssuedStatement, pendingInvoice, onClearPendingInvoice, composerOnly, onComposerClose, purchaseUnitOrders, confirmedOrders, orderRequests, onAddConfirmedOrder, onRemoveConfirmedOrder, onRemoveOrderRequest, companyInfo, onSaveCompanyInfo, onUpdateItemCost, onUpdateOrder, currentUserId, defaultTab, expensePresets, onAddExpensePreset, onDeleteExpensePreset |
| StatementType | components/TradeStatement.tsx:187 | type-alias | non-object-alias-not-expanded |  |
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
| AdminAppProps | src/features/admin/AdminApp.tsx:266 | interface | direct-properties-only | currentUser, companyId, isAdmin, isAdminAuthenticated, onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData, onPreviewStaff, onExitPreview |
| NewOrderDraft | src/features/admin/AdminApp.tsx:1473 | type-alias | non-object-alias-not-expanded |  |
| RightRow | src/features/admin/AdminApp.tsx:3293 | type-alias | direct-properties-only | 상호, 품목, spec, 수량, 소비기한, 제조일자, orderItems |
| UsageRow | src/features/admin/AdminApp.tsx:3876 | type-alias | direct-properties-only | date, received, used, note, type, id, createdAt, targetKg, addedBy, orderId |
| StaffAppProps | src/features/staff/StaffApp.tsx:23 | interface | direct-properties-only | currentUser, companyId, isAdminAuthenticated, onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData, onExitPreview |
| Window | src/global.d.ts:3 | interface | direct-properties-only | __chunkErrorHandled |
| AppAlert | src/shared/components/AppAlertHost.tsx:5 | interface | direct-properties-only | id, title, message, tone |
| LoginResponse | src/shared/employeeAuth.ts:7 | type-alias | direct-properties-only | customToken, employee |
| LoginApp | src/shared/employeeAuth.ts:9 | type-alias | non-object-alias-not-expanded |  |
| AuthPageProps | src/shared/components/AuthPage.tsx:6 | interface | direct-properties-only | onLogin, app |
| PartnerPortalProps | components/PartnerPortal.tsx:18 | interface | direct-properties-only | partners, items, partnerItems, onOrderSubmit, onExit |
| VoucherScopeRows | functions/src/newScopeCounter.ts:7 | interface | direct-properties-only | companyId, date, prefix, statements, cashEntries |
| Row | functions/src/oemBatchCostInvalidation.ts:6 | type-alias | non-object-alias-not-expanded |  |
| OemCostInvalidationWrite | functions/src/oemBatchCostInvalidation.ts:7 | type-alias | direct-properties-only | ref, patch |
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
| Row | functions/src/statementIssueReceipt.ts:6 | type-alias | non-object-alias-not-expanded |  |
| StatementIssueIdentity | functions/src/statementIssueReceipt.ts:35 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/partnerPaymentCommand.ts:15 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/partnerPaymentCommand.ts:16 | type-alias | direct-properties-only | operationId, tradeDate, partnerId, direction, amount, cashAccountId, pin, allocations, expectedRevision, releaseId, note |
| Row | functions/src/partnerAdvanceReader.ts:5 | type-alias | non-object-alias-not-expanded |  |
| PartnerAdvanceSnapshot | functions/src/partnerAdvanceReader.ts:28 | type-alias | non-object-alias-not-expanded |  |
| Row | functions/src/partnerAdvanceCommand.ts:13 | type-alias | non-object-alias-not-expanded |  |
| AdvanceWriteScope | functions/src/partnerAdvanceCommand.ts:19 | type-alias | direct-properties-only | companyId, partnerId, counter, counterState, last, initialLast, revision, revisionAfter, date, releaseId |
| PreparedAdvanceMutation | functions/src/partnerAdvanceCommand.ts:20 | type-alias | direct-properties-only | statement, operation, statementRef, operationRef |
| Row | functions/src/deleteIssuedStatementCommand.ts:11 | type-alias | non-object-alias-not-expanded |  |
| Link | functions/src/deleteIssuedStatementCommand.ts:12 | type-alias | direct-properties-only | kind, id, data |
| Input | functions/src/deleteIssuedStatementCommand.ts:13 | type-alias | direct-properties-only | operationId, statementId, releaseId, expectedRevision, expectedOriginalHash |
| Kind | functions/src/voucherIssue.ts:15 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/voucherIssue.ts:16 | type-alias | direct-properties-only | kind, operationId, tradeDate, prefix, document, releaseId |
| LoanSnapshot | functions/src/loanMovementPlan.ts:2 | type-alias | direct-properties-only | id, companyId, accountCode, openingDate, openingPrincipal |
| LoanCash | functions/src/loanMovementPlan.ts:6 | type-alias | direct-properties-only | id, companyId, loanId, date, createdAt, dir, amount, accountCode, lines |
| LoanMovementRequest | functions/src/loanMovementPlan.ts:12 | type-alias | direct-properties-only | action, principal, interest |
| LoanMovementPlan | functions/src/loanMovementPlan.ts:13 | type-alias | direct-properties-only | balanceBefore, balanceAfter, principalDelta, dir, amount, accountCode, lines |
| Row | functions/src/loanMovementCommand.ts:13 | type-alias | non-object-alias-not-expanded |  |
| LoanMovementInput | functions/src/loanMovementCommand.ts:14 | type-alias | direct-properties-only | operationId, loanId, tradeDate, cashAccountId, action, principal, interest, expectedRevision, releaseId, note |
| ScheduledRequest | functions/src/loanMovementCommand.ts:31 | type-alias | direct-properties-only | templateId, yearMonth, loanCode, input |
| Row | functions/src/cancelPendingReturnCommand.ts:4 | type-alias | non-object-alias-not-expanded |  |
| Actor | functions/src/cancelPendingReturnCommand.ts:5 | type-alias | non-object-alias-not-expanded |  |
| PendingReturnCancellationInput | functions/src/cancelPendingReturnCommand.ts:6 | type-alias | direct-properties-only | companyId, requestId, operationId, expectedRequest, reason |
| PendingReturnCancellationResult | functions/src/cancelPendingReturnCommand.ts:8 | type-alias | direct-properties-only | status, requestId, operationId, requestHash |
| Row | functions/src/tradeStatementIssue.ts:13 | type-alias | non-object-alias-not-expanded |  |
| Cost | functions/src/tradeStatementIssue.ts:14 | type-alias | direct-properties-only | itemId, price, beforeCost, sourceLineIndex, sourceLineIndices |
| Input | functions/src/tradeStatementIssue.ts:15 | type-alias | direct-properties-only | operationId, statement, orderIds, poIds, newPo, costUpdates, releaseId, requestText |
| Row | functions/src/inspectTradeStatementCommand.ts:10 | type-alias | non-object-alias-not-expanded |  |
| InspectTradeStatementInput | functions/src/inspectTradeStatementCommand.ts:11 | type-alias | direct-properties-only | companyId, requestText, requestHash, inspectionId, operationId, statementId, paymentRequestText |
| Row | functions/src/cancelTradeStatementCommand.ts:6 | type-alias | non-object-alias-not-expanded |  |
| CancelTradeStatementInput | functions/src/cancelTradeStatementCommand.ts:7 | type-alias | direct-properties-only | companyId, statementId, operationId, inspectionId, cancellationId |
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
| 들어온것 | functions/src/extractOrder.ts:38 | interface | direct-properties-only | text, scopedSources, catalog, partners, history, today |
| Row | functions/src/oemFeeVoucher.ts:12 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/oemFeeVoucher.ts:13 | type-alias | direct-properties-only | poId, perKg, statement, releaseId |
| Row | functions/src/oemReceiptCommand.ts:14 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/oemReceiptCommand.ts:15 | type-alias | direct-properties-only | poId, operationId, date, returns, bulk, unitPricePerKg, oemCostEvidence, releaseId |
| Result | functions/src/oemReceiptCommand.ts:25 | type-alias | direct-properties-only | status, receivedKg, loss, lotNos |
| Action | functions/src/manualSettlementCommand.ts:10 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/manualSettlementCommand.ts:11 | type-alias | direct-properties-only | operationId, action, partnerId, cashEntryId, statementId, amount, expectedAmount, settlementId, expectedRevision, releaseId |
| Item | functions/src/returnGeneralStockPlan.ts:4 | type-alias | direct-properties-only | id, companyId, type, subtype, rawMaterialName, name, unit, stock, lots |
| ReturnStockInput | functions/src/returnGeneralStockPlan.ts:6 | type-alias | direct-properties-only | operationId, companyId, date, createdAt, partnerId, partnerName, item, quantityDelta, rawTargetExists |
| Item | functions/src/returnRawStockPlan.ts:13 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/returnRawStockPlan.ts:15 | type-alias | direct-properties-only | operationId, requestId, companyId, date, createdAt, partnerId, partnerName, item, quantityDelta, allItems, bomLines, explicitKg, sourceLineIndex |
| Applied | functions/src/returnRawStockPlan.ts:18 | type-alias | direct-properties-only | state, itemData |
| ReturnClaim | functions/src/returnAllocationPlan.ts:4 | type-alias | direct-properties-only | id, companyId, partnerId, direction, tradeDate, amount, cashApplied |
| PriorReturnAllocation | functions/src/returnAllocationPlan.ts:8 | type-alias | direct-properties-only | returnId, statementId, amount |
| ReturnAllocationInput | functions/src/returnAllocationPlan.ts:11 | type-alias | direct-properties-only | returnId, companyId, partnerId, direction, amount, linkedStatementId, claims, priorAllocations |
| Row | functions/src/processReturnCommand.ts:29 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/processReturnCommand.ts:30 | type-alias | direct-properties-only | operationId, returnRequestId, tradeDate, expectedPartnerRevision, releaseId, expectedBusinessHash |
| Allocation | functions/src/manualSettlementBatchCommand.ts:10 | type-alias | direct-properties-only | statementId, amount |
| Input | functions/src/manualSettlementBatchCommand.ts:11 | type-alias | direct-properties-only | operationId, cashEntryId, partnerId, allocations, expectedPartnerRevision, releaseId |
| Claims | functions/src/interCompanyTransferPreparation.ts:8 | type-alias | direct-properties-only | employeeId, companyId, isAdmin |
| Row | functions/src/interCompanyTransferCommand.ts:13 | type-alias | non-object-alias-not-expanded |  |
| Claims | functions/src/interCompanyTransferCommand.ts:14 | type-alias | direct-properties-only | employeeId, companyId, isAdmin |
| Input | functions/src/interCompanyTransferCommand.ts:15 | type-alias | direct-properties-only | operationId, from, to, tradeDate, amount, overKind, fromAccountId, toAccountId, fromPartnerId, toPartnerId, expectedFromRevision, expectedToRevision, releaseId, note |
| Row | functions/src/inventoryOpeningCommand.ts:14 | type-alias | non-object-alias-not-expanded |  |
| InventoryOpeningInput | functions/src/inventoryOpeningCommand.ts:15 | type-alias | direct-properties-only | companyId, date, itemId, quantity, value, releaseId |
| Actor | functions/src/inventoryOpeningCommand.ts:16 | type-alias | non-object-alias-not-expanded |  |
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
| OrderRow | functions/src/orderLockRecovery.ts:7 | type-alias | non-object-alias-not-expanded |  |
| Input | functions/src/orderLockRecovery.ts:8 | type-alias | direct-properties-only | action, orderId, failedOperationId, failedStartedAt, releaseId |
| OrderLockRecoveryResult | functions/src/orderLockRecovery.ts:9 | type-alias | direct-properties-only | status, orderId, failedOperationId, failedStartedAt, inventoryApplied, reason, failureMessage, targetStatus |
| RetirementInput | functions/src/orderRequestRetirement.ts:11 | interface | direct-properties-only | requestText, requestHash, releaseId |
| RetirementResult | functions/src/orderRequestRetirement.ts:12 | interface | direct-properties-only | status, action, allowNewClaim, inventoryApplied, requestHash, requestText, authorizationId, retirementId, generation |

## 상속·공용 모델의 정적 필드 보완

JSON additionalModels/resolvedModels의 references는 같은 Program에서 원선언에 귀속된 정적 속성 사용처다. 상속·Partial·교차 모델에 반복되는 참조는 해당 모델에만 고유한 사용처가 아니며 모델 사이에서 합산하지 않는다. 직접 선언 수와 기존 점 접근 참조는 유지하며 고정 문자열 접근 및 객체 구조분해의 원선언 참조를 추가한다. 동적 키·배열·rest·불명확한 공용체는 추정하지 않는다. referenceCoverage는 구문별 연결 및 제외 사유를 별도로 기록하고 기존 unresolved 지표는 점 접근 symbol 미해석 의미를 유지한다. 선언 Node는 JSON에 저장하지 않는다. 정적 모델과 사용처는 실제 DB 필드 전체나 동적 쓰기를 증명하지 않는다.

| 모델 | 선언 | 해석 범위 | 정적 필드 수 |
| --- | --- | --- | --- |
| ProductStocktakeRequest | src/shared/productStocktakeAttempt.ts:2 | checker-resolved-properties-only | 10 |
| ProductStocktakeAttempt | src/shared/productStocktakeAttempt.ts:3 | checker-resolved-properties-only | 11 |
| OemCostEvidence | functions/src/shared/oemBatchCost.ts:1 | checker-resolved-properties-only | 5 |
| OemCostScope | functions/src/shared/oemBatchCost.ts:4 | checker-resolved-properties-only | 2 |
| OemCostRow | functions/src/shared/oemBatchCost.ts:5 | checker-resolved-properties-only | 5 |
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
| Row | functions/src/shared/inventoryWriterProtocol.ts:1 | checker-resolved-properties-only | 0 |
| InventoryWriterContext | src/shared/inventoryWriterProtocol.ts:18 | checker-resolved-properties-only | 4 |
| CaptureOptions | src/shared/inventoryWriterProtocol.ts:24 | checker-resolved-properties-only | 5 |
| Seen | src/shared/inventoryWriterProtocol.ts:43 | checker-resolved-properties-only | 2 |
| Written | src/shared/inventoryWriterProtocol.ts:44 | checker-resolved-properties-only | 3 |
| InventoryWriterObserver | src/shared/inventoryWriterProtocol.ts:45 | checker-resolved-properties-only | 0 |
| LegacyLedgerFields | functions/src/shared/rawInventoryDocument.ts:11 | checker-resolved-properties-only | 9 |
| RawUnit | functions/src/shared/formula.ts:60 | non-object-model-not-expanded | 0 |
| RawReadSnapshot | functions/src/shared/rawInventoryPrepare.ts:6 | checker-resolved-properties-only | 0 |
| RawCommandRead | functions/src/shared/rawInventoryPrepare.ts:7 | checker-resolved-properties-only | 7 |
| RawPrepareOptions | functions/src/shared/rawInventoryPrepare.ts:13 | checker-resolved-properties-only | 5 |
| CollectionName | src/shared/collections.ts:130 | non-object-model-not-expanded | 0 |
| RawCommandOptions | src/shared/services/rawInventoryService.ts:43 | checker-resolved-properties-only | 7 |
| RawPressRequest | src/shared/rawPressAttempt.ts:5 | checker-resolved-properties-only | 9 |
| RawPressRetained | src/shared/rawPressAttempt.ts:45 | checker-resolved-properties-only | 4 |
| RawPressEntry | src/shared/rawPressAttempt.ts:46 | checker-resolved-properties-only | 4 |
| RawPressCancellationRequest | src/shared/rawPressAttempt.ts:125 | checker-resolved-properties-only | 10 |
| OrderInventoryGeneration | src/shared/orderInventoryGeneration.ts:4 | checker-resolved-properties-only | 6 |
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
| ShipTo | src/shared/types.ts:108 | checker-resolved-properties-only | 4 |
| PartnerItem | src/shared/types.ts:118 | checker-resolved-properties-only | 9 |
| Partner | src/shared/types.ts:152 | checker-resolved-properties-only | 20 |
| OrderSource | src/shared/types.ts:190 | non-object-model-not-expanded | 0 |
| ShipMethod | src/shared/types.ts:202 | non-object-model-not-expanded | 0 |
| InvoiceType | src/shared/types.ts:209 | non-object-model-not-expanded | 0 |
| OrderRawInventoryTrace | src/shared/types.ts:218 | checker-resolved-properties-only | 10 |
| OrderProductionRecordIndexEntry | src/shared/types.ts:235 | checker-resolved-properties-only | 3 |
| Order | src/shared/types.ts:240 | checker-resolved-properties-only | 48 |
| OrderItemInventoryState | src/shared/types.ts:368 | checker-resolved-properties-only | 11 |
| OrderInventoryAdjustment | src/shared/types.ts:382 | checker-resolved-properties-only | 2 |
| OrderRawCalculationEvidence | src/shared/types.ts:388 | checker-resolved-properties-only | 11 |
| OrderInventorySnapshot | src/shared/types.ts:402 | checker-resolved-properties-only | 8 |
| OrderStatusAudit | src/shared/types.ts:413 | checker-resolved-properties-only | 12 |
| OrderItemEdit | src/shared/types.ts:434 | checker-resolved-properties-only | 5 |
| SubmaterialComponent | src/shared/types.ts:443 | checker-resolved-properties-only | 8 |
| InventoryCategory | src/shared/types.ts:455 | non-object-model-not-expanded | 0 |
| ItemSubtype | src/shared/types.ts:461 | non-object-model-not-expanded | 0 |
| ItemInventoryReservation | src/shared/types.ts:496 | checker-resolved-properties-only | 6 |
| ItemStocktakeAnchor | src/shared/types.ts:506 | checker-resolved-properties-only | 8 |
| Item | src/shared/types.ts:519 | checker-resolved-properties-only | 37 |
| PalletStock | src/shared/types.ts:632 | checker-resolved-properties-only | 6 |
| PalletTransaction | src/shared/types.ts:642 | checker-resolved-properties-only | 10 |
| Post | src/shared/types.ts:656 | checker-resolved-properties-only | 8 |
| FileItem | src/shared/types.ts:667 | checker-resolved-properties-only | 6 |
| CabinetCategory | src/shared/types.ts:678 | checker-resolved-properties-only | 5 |
| CabinetSubCategory | src/shared/types.ts:686 | checker-resolved-properties-only | 6 |
| CabinetDoc | src/shared/types.ts:695 | checker-resolved-properties-only | 12 |
| EmployeeStatus | src/shared/types.ts:711 | non-object-model-not-expanded | 0 |
| AnnualLeave | src/shared/types.ts:713 | checker-resolved-properties-only | 2 |
| Employee | src/shared/types.ts:718 | checker-resolved-properties-only | 15 |
| PayrollLine | src/shared/types.ts:759 | checker-resolved-properties-only | 14 |
| Payroll | src/shared/types.ts:776 | checker-resolved-properties-only | 9 |
| LeaveType | src/shared/types.ts:817 | non-object-model-not-expanded | 0 |
| LeaveStatus | src/shared/types.ts:818 | non-object-model-not-expanded | 0 |
| LeaveModifyRequest | src/shared/types.ts:820 | checker-resolved-properties-only | 5 |
| LeaveRequest | src/shared/types.ts:828 | checker-resolved-properties-only | 16 |
| ChatMessage | src/shared/types.ts:857 | checker-resolved-properties-only | 17 |
| ChatRoom | src/shared/types.ts:897 | checker-resolved-properties-only | 13 |
| RoomNotice | src/shared/types.ts:932 | checker-resolved-properties-only | 5 |
| ViewType | src/shared/types.ts:944 | non-object-model-not-expanded | 0 |
| ProductionRecord | src/shared/types.ts:947 | checker-resolved-properties-only | 18 |
| FixedCostCategory | src/shared/types.ts:969 | non-object-model-not-expanded | 0 |
| FixedCostEntry | src/shared/types.ts:971 | checker-resolved-properties-only | 8 |
| FixedCostTemplate | src/shared/types.ts:982 | checker-resolved-properties-only | 35 |
| StatementLineKind | src/shared/types.ts:1084 | non-object-model-not-expanded | 0 |
| IssuedStatementItem | src/shared/types.ts:1086 | checker-resolved-properties-only | 19 |
| StatementParty | src/shared/types.ts:1124 | checker-resolved-properties-only | 8 |
| StatementPartySnapshot | src/shared/types.ts:1135 | checker-resolved-properties-only | 2 |
| IssuedStatement | src/shared/types.ts:1140 | checker-resolved-properties-only | 24 |
| PaymentMethod | src/shared/types.ts:1201 | non-object-model-not-expanded | 0 |
| PurchaseOrderItem | src/shared/types.ts:1207 | checker-resolved-properties-only | 11 |
| PurchaseOrder | src/shared/types.ts:1223 | checker-resolved-properties-only | 39 |
| CompanyInfo | src/shared/types.ts:1309 | checker-resolved-properties-only | 11 |
| ExpensePreset | src/shared/types.ts:1324 | checker-resolved-properties-only | 5 |
| AppNotification | src/shared/types.ts:1332 | checker-resolved-properties-only | 10 |
| RawMaterialEntry | src/shared/types.ts:1359 | checker-resolved-properties-only | 26 |
| ItemType | src/shared/types.ts:1408 | non-object-model-not-expanded | 0 |
| ItemFormula | src/shared/types.ts:1410 | checker-resolved-properties-only | 5 |
| ItemBom | src/shared/types.ts:1419 | checker-resolved-properties-only | 4 |
| ReturnReason | src/shared/types.ts:1428 | non-object-model-not-expanded | 0 |
| ReturnItem | src/shared/types.ts:1430 | checker-resolved-properties-only | 10 |
| ReturnRequest | src/shared/types.ts:1444 | checker-resolved-properties-only | 19 |
| PendingStatementEdit | src/shared/types.ts:1466 | checker-resolved-properties-only | 12 |
| AccountType | src/shared/types.ts:1490 | non-object-model-not-expanded | 0 |
| AccountCode | src/shared/types.ts:1492 | checker-resolved-properties-only | 9 |
| JournalLine | src/shared/types.ts:1510 | checker-resolved-properties-only | 5 |
| JournalEntry | src/shared/types.ts:1518 | checker-resolved-properties-only | 8 |
| AccountGroupPlLine | src/shared/types.ts:1529 | non-object-model-not-expanded | 0 |
| AccountGroupCfSection | src/shared/types.ts:1531 | non-object-model-not-expanded | 0 |
| AccountGroup | src/shared/types.ts:1533 | checker-resolved-properties-only | 6 |
| CashAccount | src/shared/types.ts:1548 | checker-resolved-properties-only | 10 |
| CashEntry | src/shared/types.ts:1562 | checker-resolved-properties-only | 18 |
| Settlement | src/shared/types.ts:1625 | checker-resolved-properties-only | 5 |
| InventorySnapshot | src/shared/types.ts:1633 | checker-resolved-properties-only | 6 |
| CashFlowManual | src/shared/types.ts:1647 | checker-resolved-properties-only | 10 |
| ProductionSalesLog | src/shared/types.ts:1660 | checker-resolved-properties-only | 11 |
| AdjustmentType | src/shared/types.ts:1680 | non-object-model-not-expanded | 0 |
| AdjustmentStatus | src/shared/types.ts:1681 | non-object-model-not-expanded | 0 |
| AdjustmentRequest | src/shared/types.ts:1683 | checker-resolved-properties-only | 15 |
| OrderRawBatchCommand | src/shared/orderRawBatchAttempt.ts:11 | checker-resolved-properties-only | 2 |
| OrderRawBatchRequest | src/shared/orderRawBatchAttempt.ts:12 | checker-resolved-properties-only | 8 |
| BomLine | src/shared/bomIndex.ts:19 | checker-resolved-properties-only | 3 |
| BomDraftLine | src/shared/bomIndex.ts:36 | checker-resolved-properties-only | 2 |
| BomParentLine | src/shared/bomIndex.ts:42 | checker-resolved-properties-only | 3 |
| BomIndex | src/shared/bomIndex.ts:48 | checker-resolved-properties-only | 0 |
| PackRow | src/shared/packIndex.ts:26 | checker-resolved-properties-only | 2 |
| PackIndex | src/shared/packIndex.ts:31 | checker-resolved-properties-only | 2 |
| StockComponent | functions/src/shared/stockUnitMeasure.ts:3 | checker-resolved-properties-only | 3 |
| BoxLike | src/shared/orderUnits.ts:13 | checker-resolved-properties-only | 1 |
| OrderUnitInputs | src/shared/orderUnits.ts:15 | checker-resolved-properties-only | 2 |
| 묶음갈래 | src/shared/orderUnits.ts:45 | non-object-model-not-expanded | 0 |
| LineAmount | functions/src/shared/lineAmount.ts:2 | checker-resolved-properties-only | 3 |
| RawHolderItem | functions/src/shared/rawHolder.ts:4 | checker-resolved-properties-only | 7 |
| PurchaseCostFallback | functions/src/shared/purchaseCost.ts:5 | non-object-model-not-expanded | 0 |
| StatementType | src/shared/statementLines.ts:19 | non-object-model-not-expanded | 0 |
| ManualRow | src/shared/statementLines.ts:22 | checker-resolved-properties-only | 16 |
| LineItem | src/shared/statementLines.ts:32 | checker-resolved-properties-only | 23 |
| ResolvedOrderItem | src/shared/statementLines.ts:143 | checker-resolved-properties-only | 4 |
| OrderLinesInput | src/shared/statementLines.ts:203 | checker-resolved-properties-only | 9 |
| LineTotals | src/shared/statementLines.ts:286 | checker-resolved-properties-only | 4 |
| KstDateRangeUtc | src/shared/day.ts:18 | checker-resolved-properties-only | 2 |
| ProductionRecordIndexEntry | src/shared/orderProductionRecordPlan.ts:9 | checker-resolved-properties-only | 3 |
| ProductionRecordIndex | src/shared/orderProductionRecordPlan.ts:10 | checker-resolved-properties-only | 0 |
| LegacyProductionSourceCandidate | src/shared/orderProductionRecordPlan.ts:11 | checker-resolved-properties-only | 4 |
| OrderGeneratedProductionRecord | src/shared/orderProductionRecordPlan.ts:12 | checker-resolved-properties-only | 18 |
| OrderProductionRecordPlan | src/shared/orderProductionRecordPlan.ts:13 | checker-resolved-properties-only | 5 |
| OrderProductionRecordReceipt | src/shared/orderProductionRecordPlan.ts:14 | checker-resolved-properties-only | 5 |
| OemReceiptScope | src/shared/oemReceiptPending.ts:3 | checker-resolved-properties-only | 3 |
| OemReceiptRequest | src/shared/oemReceiptPending.ts:4 | checker-resolved-properties-only | 8 |
| OemReceiptDraft | src/shared/oemReceiptPending.ts:6 | checker-resolved-properties-only | 6 |
| DraftRecord | src/shared/oemReceiptPending.ts:7 | checker-resolved-properties-only | 5 |
| PacketRecord | src/shared/oemReceiptPending.ts:8 | checker-resolved-properties-only | 5 |
| OemReceiptEntry | src/shared/oemReceiptPending.ts:9 | checker-resolved-properties-only | 9 |
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
| ProductLotClock | functions/src/shared/productLot.ts:4 | checker-resolved-properties-only | 3 |
| ProductLotTake | functions/src/shared/productLot.ts:73 | checker-resolved-properties-only | 5 |
| InventoryKindItem | functions/src/shared/itemInventoryKind.ts:1 | checker-resolved-properties-only | 5 |
| CategoryKey | src/shared/taxonomy.ts:19 | non-object-model-not-expanded | 0 |
| TaxonomyRow | src/shared/taxonomy.ts:47 | checker-resolved-properties-only | 7 |
| Taxonomy | src/shared/taxonomy.ts:58 | checker-resolved-properties-only | 6 |
| TypeKey | src/shared/itemTaxonomy.ts:86 | non-object-model-not-expanded | 0 |
| AnchorResult | functions/src/shared/lotAnchor.ts:41 | checker-resolved-properties-only | 3 |
| ItemReceipt | src/shared/receipt.ts:4 | checker-resolved-properties-only | 12 |
| CompanyClaim | src/shared/companyWriteBoundary.ts:14 | checker-resolved-properties-only | 1 |
| LoanContract | src/shared/loanLedger.ts:6 | checker-resolved-properties-only | 11 |
| LoanMovement | src/shared/loanLedger.ts:20 | checker-resolved-properties-only | 2 |
| OrderRequestRetirementResult | src/shared/services/orderRequestRetirementService.ts:8 | checker-resolved-properties-only | 9 |
| ItemSaveOptions | src/shared/services/firebaseService.ts:98 | checker-resolved-properties-only | 1 |
| PartnerRegistrationConflict | src/shared/services/firebaseService.ts:438 | checker-resolved-properties-only | 3 |
| AddItemOptions | src/shared/services/firebaseService.ts:443 | checker-resolved-properties-only | 1 |
| CompanyWriteOperation | src/shared/services/firebaseService.ts:759 | non-object-model-not-expanded | 0 |
| PendingPurchaseOrderConfirmation | src/shared/services/confirmPendingPurchaseOrderService.ts:14 | checker-resolved-properties-only | 3 |
| AppConfirmOptions | src/shared/components/appDialog.ts:1 | checker-resolved-properties-only | 5 |
| AppPromptOptions | src/shared/components/appDialog.ts:9 | checker-resolved-properties-only | 5 |
| ConfirmRequest | src/shared/components/appDialog.ts:17 | checker-resolved-properties-only | 7 |
| NoticeRequest | src/shared/components/appDialog.ts:18 | checker-resolved-properties-only | 4 |
| PromptRequest | src/shared/components/appDialog.ts:19 | checker-resolved-properties-only | 7 |
| AppDialogRequest | src/shared/components/appDialog.ts:20 | non-object-model-not-expanded | 0 |
| OrderInventoryRecoveryResult | src/shared/services/orderInventoryRecoveryService.ts:6 | checker-resolved-properties-only | 8 |
| PendingOrderInventoryRecovery | src/shared/services/orderInventoryRecoveryService.ts:27 | checker-resolved-properties-only | 7 |
| Props | components/OrderInventoryRecoveryPanel.tsx:6 | checker-resolved-properties-only | 6 |
| Entry | components/OrderInventoryRecoveryPanel.tsx:7 | checker-resolved-properties-only | 5 |
| Notice | components/OrderInventoryRecoveryPanel.tsx:9 | checker-resolved-properties-only | 3 |
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
| ModalShellProps | src/shared/components/ModalShell.tsx:5 | checker-resolved-properties-only | 9 |
| LargeModalShellProps | src/shared/components/LargeModalShell.tsx:4 | checker-resolved-properties-only | 8 |
| ProductionWorkDocument | src/features/production-documents/domain/productionWorkDocument.ts:5 | checker-resolved-properties-only | 14 |
| ProductionWorkFields | src/features/production-documents/domain/productionWorkDocument.ts:22 | checker-resolved-properties-only | 15 |
| ProductionWorkSource | src/features/production-documents/domain/productionWorkDocument.ts:40 | checker-resolved-properties-only | 7 |
| ProductionWorkDocumentLine | src/features/production-documents/domain/productionWorkDocument.ts:50 | checker-resolved-properties-only | 25 |
| ProductionWorkEvidence | src/features/production-documents/domain/productionWorkDocument.ts:64 | checker-resolved-properties-only | 6 |
| ProductionWorkPrintRow | src/features/production-documents/domain/productionWorkDocument.ts:158 | checker-resolved-properties-only | 3 |
| ProductionWorkDocumentPrintProps | src/features/production-documents/ui/ProductionWorkDocumentPrint.tsx:8 | checker-resolved-properties-only | 2 |
| ProductionWorkDocumentEditorProps | src/features/production-documents/ui/ProductionWorkDocumentEditor.tsx:12 | checker-resolved-properties-only | 5 |
| ProductionDocumentWrite | src/shared/services/productionWorkDocumentService.ts:9 | checker-resolved-properties-only | 3 |
| ProductionDocumentLineWrite | src/shared/services/productionWorkDocumentService.ts:14 | checker-resolved-properties-only | 3 |
| LedgerEvidence | src/features/production-documents/infrastructure/productionWorkDocumentRepository.ts:40 | checker-resolved-properties-only | 38 |
| HostProps | src/features/production-documents/ui/ProductionWorkDocumentHost.tsx:6 | checker-resolved-properties-only | 4 |
| AlertTone | src/shared/components/AlertModalShell.tsx:22 | non-object-model-not-expanded | 0 |
| Props | src/shared/components/AlertModalShell.tsx:37 | checker-resolved-properties-only | 7 |
| ConfirmModalProps | src/shared/components/ConfirmModal.tsx:13 | checker-resolved-properties-only | 13 |
| Margin | src/shared/margin.ts:26 | checker-resolved-properties-only | 5 |
| PrintableLine | src/shared/docName.ts:44 | checker-resolved-properties-only | 2 |
| BomCostCtx | src/shared/bomCost.ts:19 | checker-resolved-properties-only | 5 |
| CostFn | src/shared/bomCost.ts:48 | checker-resolved-properties-only | 1 |
| CostCalcRow | src/features/admin/costCalc.ts:18 | checker-resolved-properties-only | 2 |
| CostCalcLine | src/features/admin/costCalc.ts:24 | checker-resolved-properties-only | 7 |
| CostCalcResult | src/features/admin/costCalc.ts:37 | checker-resolved-properties-only | 7 |
| PriceRange | src/shared/partnerPrice.ts:40 | checker-resolved-properties-only | 3 |
| RawUsersDeps | src/shared/rawUsers.ts:28 | checker-resolved-properties-only | 4 |
| RequestBody | src/shared/services/returnRequestSubmission.ts:4 | checker-resolved-properties-only | 0 |
| PendingReturnSubmission | src/shared/services/returnRequestSubmission.ts:5 | checker-resolved-properties-only | 5 |
| CreateCommand | src/shared/services/employeeCommand.ts:7 | checker-resolved-properties-only | 3 |
| ReceiveCommand | src/shared/services/employeeCommand.ts:11 | checker-resolved-properties-only | 5 |
| RawPressOutcome | src/shared/services/rawPressService.ts:13 | non-object-model-not-expanded | 0 |
| RawPressJob | src/shared/services/rawPressService.ts:16 | checker-resolved-properties-only | 14 |
| Read | src/shared/services/rawPressService.ts:20 | checker-resolved-properties-only | 0 |
| RawPressCancellationOutcome | src/shared/services/rawPressService.ts:139 | non-object-model-not-expanded | 0 |
| LedgerRow | src/shared/derivedRawDocEntries.ts:4 | checker-resolved-properties-only | 38 |
| DerivedRawDocEntry | src/shared/derivedRawDocEntries.ts:5 | checker-resolved-properties-only | 6 |
| UnpackPlan | src/shared/canUnpack.ts:36 | checker-resolved-properties-only | 9 |
| UnpackReject | src/shared/canUnpack.ts:60 | non-object-model-not-expanded | 0 |
| UnpackResult | src/shared/canUnpack.ts:68 | non-object-model-not-expanded | 0 |
| UnpackLotMove | src/shared/unpackLots.ts:36 | checker-resolved-properties-only | 6 |
| UnpackLotResult | src/shared/unpackLots.ts:48 | checker-resolved-properties-only | 4 |
| Base | src/shared/itemInventoryAttempt.ts:5 | checker-resolved-properties-only | 6 |
| ItemStockAddRequest | src/shared/itemInventoryAttempt.ts:6 | checker-resolved-properties-only | 8 |
| CanUnpackRequest | src/shared/itemInventoryAttempt.ts:7 | checker-resolved-properties-only | 8 |
| BoxUnpackRequest | src/shared/itemInventoryAttempt.ts:8 | checker-resolved-properties-only | 13 |
| ItemInventoryRequest | src/shared/itemInventoryAttempt.ts:9 | non-object-model-not-expanded | 0 |
| ItemInventoryKind | src/shared/itemInventoryAttempt.ts:10 | non-object-model-not-expanded | 0 |
| ItemInventoryRetained | src/shared/itemInventoryAttempt.ts:11 | checker-resolved-properties-only | 5 |
| ItemInventoryOutcome | src/shared/itemInventoryAttempt.ts:12 | checker-resolved-properties-only | 4 |
| Initial | src/shared/itemInventoryAttempt.ts:13 | non-object-model-not-expanded | 0 |
| ItemInventoryEntry | src/shared/itemInventoryAttempt.ts:38 | checker-resolved-properties-only | 4 |
| UnpackOutcome | src/shared/services/unpackService.ts:50 | checker-resolved-properties-only | 4 |
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
| StatementCommandKind | src/features/statements/domain/statementCommand.ts:21 | non-object-model-not-expanded | 0 |
| StatementCommand | src/features/statements/domain/statementCommand.ts:23 | checker-resolved-properties-only | 15 |
| StatementRejectionCode | src/features/statements/domain/statementCommand.ts:53 | non-object-model-not-expanded | 0 |
| StatementRejection | src/features/statements/domain/statementCommand.ts:61 | checker-resolved-properties-only | 3 |
| StatementWarningCode | src/features/statements/domain/statementCommand.ts:70 | non-object-model-not-expanded | 0 |
| StatementWarning | src/features/statements/domain/statementCommand.ts:74 | checker-resolved-properties-only | 3 |
| StatementCheck | src/features/statements/domain/statementCommand.ts:80 | checker-resolved-properties-only | 3 |
| BuildInput | src/features/statements/domain/statementCommand.ts:87 | checker-resolved-properties-only | 13 |
| TradeStatementDraft | src/features/statements/infrastructure/tradeStatementPending.ts:5 | checker-resolved-properties-only | 5 |
| TradeStatementPending | src/features/statements/infrastructure/tradeStatementPending.ts:6 | checker-resolved-properties-only | 5 |
| PendingEntry | src/features/statements/infrastructure/tradeStatementPending.ts:22 | checker-resolved-properties-only | 9 |
| PendingSources | src/features/statements/infrastructure/tradeStatementPending.ts:46 | checker-resolved-properties-only | 4 |
| IssueRequest | src/features/statements/infrastructure/tradeStatementPending.ts:116 | checker-resolved-properties-only | 6 |
| RecoveryScope | src/features/statements/domain/tradeStatementRecovery.ts:4 | checker-resolved-properties-only | 2 |
| RecoveryCopy | src/features/statements/domain/tradeStatementRecovery.ts:5 | checker-resolved-properties-only | 2 |
| RecoveryRequest | src/features/statements/domain/tradeStatementRecovery.ts:6 | checker-resolved-properties-only | 7 |
| RecoveryEntry | src/features/statements/domain/tradeStatementRecovery.ts:7 | checker-resolved-properties-only | 22 |
| RecoveryInspection | src/features/statements/domain/tradeStatementRecovery.ts:8 | checker-resolved-properties-only | 15 |
| TradeStatementIssueInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:9 | checker-resolved-properties-only | 6 |
| PartnerPaymentInput | src/features/statements/infrastructure/issueTradeStatementCommand.ts:159 | checker-resolved-properties-only | 8 |
| Request | src/features/statements/infrastructure/issueTradeStatementCommand.ts:191 | checker-resolved-properties-only | 11 |
| PageHeaderProps | src/shared/components/PageHeader.tsx:3 | checker-resolved-properties-only | 3 |
| OrderCreationModalHeaderProps | src/shared/components/OrderCreationModalHeader.tsx:4 | checker-resolved-properties-only | 4 |
| Line | src/shared/orderLine.ts:26 | checker-resolved-properties-only | 1 |
| GroupMark | src/shared/rowGroup.ts:19 | checker-resolved-properties-only | 4 |
| GroupOf | src/shared/rowGroup.ts:27 | checker-resolved-properties-only | 2 |
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
| CardDatePickerButtonProps | components/OrdersList.tsx:122 | checker-resolved-properties-only | 6 |
| OrdersListProps | components/OrdersList.tsx:242 | checker-resolved-properties-only | 42 |
| OrderCardProps | components/OrdersList.tsx:310 | checker-resolved-properties-only | 29 |
| OrderSourceGroupProps | components/OrdersList.tsx:352 | checker-resolved-properties-only | 26 |
| DeliveryRowProps | components/OrdersList.tsx:386 | checker-resolved-properties-only | 5 |
| TabType | components/OrdersList.tsx:394 | non-object-model-not-expanded | 0 |
| WorkItem | components/OrdersList.tsx:1732 | checker-resolved-properties-only | 11 |
| Command | src/shared/services/returnRequestCancellation.ts:5 | checker-resolved-properties-only | 4 |
| Result | src/shared/services/returnRequestCancellation.ts:6 | checker-resolved-properties-only | 4 |
| RoleLike | src/shared/partnerRole.ts:17 | checker-resolved-properties-only | 1 |
| ProductModalProps | components/AddItemModal.tsx:20 | checker-resolved-properties-only | 16 |
| SpecUnit | components/AddItemModal.tsx:66 | non-object-model-not-expanded | 0 |
| RawEntrySubmitResult | components/RawMaterialEntryModal.tsx:10 | non-object-model-not-expanded | 0 |
| Props | components/RawMaterialEntryModal.tsx:11 | checker-resolved-properties-only | 12 |
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
| OemReceiptItemChange | src/features/admin/oemReceiptInventory.ts:8 | checker-resolved-properties-only | 5 |
| OemReceiptInventoryInput | src/features/admin/oemReceiptInventory.ts:16 | checker-resolved-properties-only | 9 |
| JobCommandInput | src/shared/services/rawInventoryJob.ts:20 | checker-resolved-properties-only | 2 |
| JobCommandResult | src/shared/services/rawInventoryJob.ts:25 | checker-resolved-properties-only | 2 |
| RunJobOptions | src/shared/services/rawInventoryJob.ts:27 | checker-resolved-properties-only | 3 |
| RunJobOutcome | src/shared/services/rawInventoryJob.ts:33 | checker-resolved-properties-only | 2 |
| OemIssueRequest | src/shared/oemIssuePending.ts:5 | checker-resolved-properties-only | 4 |
| OemIssueRetained | src/shared/oemIssuePending.ts:6 | checker-resolved-properties-only | 3 |
| OemIssueEntry | src/shared/oemIssuePending.ts:7 | checker-resolved-properties-only | 8 |
| OemIssueLine | src/features/admin/oemIssueJob.ts:9 | checker-resolved-properties-only | 3 |
| OemIssueInput | src/features/admin/oemIssueJob.ts:10 | checker-resolved-properties-only | 9 |
| OemIssueDraft | src/features/admin/oemIssueJob.ts:22 | checker-resolved-properties-only | 39 |
| OemIssuePorts | src/features/admin/oemIssueJob.ts:43 | checker-resolved-properties-only | 5 |
| OemFeeStatementWrite | src/features/admin/oemFeeStatement.ts:4 | checker-resolved-properties-only | 4 |
| OemEngineDeps | src/features/admin/oemEngine.ts:33 | checker-resolved-properties-only | 12 |
| StoredOemCostDisplay | src/features/admin/oemReconciliation.ts:8 | non-object-model-not-expanded | 0 |
| OemExternalEvidence | src/features/admin/oemExternalStock.ts:5 | checker-resolved-properties-only | 5 |
| OemExternalRow | src/features/admin/oemExternalStock.ts:12 | checker-resolved-properties-only | 5 |
| Props | components/OemManager.tsx:23 | checker-resolved-properties-only | 16 |
| IssueInput | components/OemManager.tsx:42 | checker-resolved-properties-only | 7 |
| ReceiveInput | components/OemManager.tsx:43 | checker-resolved-properties-only | 6 |
| Props | components/CategoryManager.tsx:14 | checker-resolved-properties-only | 4 |
| StockClosingRow | components/ItemList.tsx:186 | checker-resolved-properties-only | 7 |
| StockClosing | components/ItemList.tsx:187 | checker-resolved-properties-only | 6 |
| ItemListProps | components/ItemList.tsx:198 | checker-resolved-properties-only | 56 |
| MainTab | components/ItemList.tsx:275 | non-object-model-not-expanded | 0 |
| FlowTypeFilter | components/ItemList.tsx:315 | non-object-model-not-expanded | 0 |
| FlowStatusFilter | components/ItemList.tsx:316 | non-object-model-not-expanded | 0 |
| InboundSubTab | components/ItemList.tsx:317 | non-object-model-not-expanded | 0 |
| TopTab | components/ItemList.tsx:320 | non-object-model-not-expanded | 0 |
| GroupRow | components/ItemList.tsx:1373 | checker-resolved-properties-only | 4 |
| FlowRow | components/ItemList.tsx:1707 | checker-resolved-properties-only | 9 |
| GridRow | components/ItemList.tsx:3679 | checker-resolved-properties-only | 6 |
| Vouchered | src/shared/statementOrders.ts:24 | checker-resolved-properties-only | 0 |
| PartnerOrdersInput | src/shared/statementOrders.ts:39 | checker-resolved-properties-only | 6 |
| OrderStatusDotProps | src/shared/components/OrderStatusDot.tsx:4 | checker-resolved-properties-only | 2 |
| OrderItemLinesProps | src/shared/components/OrderItemLines.tsx:5 | checker-resolved-properties-only | 3 |
| NewOrderLineInput | src/shared/newOrderDraft.ts:8 | checker-resolved-properties-only | 8 |
| AddOrderModalProps | components/AddOrderModal.tsx:28 | checker-resolved-properties-only | 11 |
| ScopedOrderSource | functions/src/shared/orderCopyInterpretationScope.ts:1 | checker-resolved-properties-only | 2 |
| ScopedOrderLine | functions/src/shared/orderCopyInterpretationScope.ts:2 | checker-resolved-properties-only | 4 |
| ScopedOrderResponse | functions/src/shared/orderCopyInterpretationScope.ts:3 | checker-resolved-properties-only | 3 |
| RawExtracted | src/shared/orderExtract.ts:27 | checker-resolved-properties-only | 4 |
| ExtractedLine | src/shared/orderExtract.ts:34 | checker-resolved-properties-only | 5 |
| ExtractResult | src/shared/orderExtract.ts:45 | checker-resolved-properties-only | 6 |
| CatalogItem | src/shared/orderExtract.ts:55 | checker-resolved-properties-only | 3 |
| CatalogPartner | src/shared/orderExtract.ts:56 | checker-resolved-properties-only | 2 |
| ScopedExtractResult | src/shared/orderExtract.ts:57 | checker-resolved-properties-only | 6 |
| HistoryOrder | src/shared/orderExtract.ts:195 | checker-resolved-properties-only | 3 |
| OrderInterpretationJson | functions/src/shared/orderInterpretation.ts:1 | non-object-model-not-expanded | 0 |
| OrderInterpretationJsonObject | functions/src/shared/orderInterpretation.ts:2 | checker-resolved-properties-only | 0 |
| OrderInterpretationScope | functions/src/shared/orderInterpretation.ts:3 | checker-resolved-properties-only | 2 |
| OrderExpressionConfirmation | functions/src/shared/orderInterpretation.ts:4 | checker-resolved-properties-only | 6 |
| OrderExpressionRule | functions/src/shared/orderInterpretation.ts:5 | checker-resolved-properties-only | 8 |
| OrderInterpretationRequest | functions/src/shared/orderInterpretation.ts:6 | checker-resolved-properties-only | 8 |
| OrderInterpretationAliasCandidate | functions/src/shared/orderInterpretation.ts:87 | checker-resolved-properties-only | 3 |
| OrderInterpretationAliasResolution | functions/src/shared/orderInterpretation.ts:107 | non-object-model-not-expanded | 0 |
| OrderExpressionCandidate | functions/src/shared/orderInterpretation.ts:132 | checker-resolved-properties-only | 7 |
| InterpretationRule | functions/src/orderCopyCommands.ts:11 | checker-resolved-properties-only | 13 |
| OrderCopyInput | functions/src/orderCopyCommands.ts:39 | checker-resolved-properties-only | 4 |
| OrderCopyResult | functions/src/orderCopyCommands.ts:40 | checker-resolved-properties-only | 5 |
| PendingOrderCopy | src/shared/services/orderCopyService.ts:7 | checker-resolved-properties-only | 5 |
| OrderInterpretationRule | src/shared/services/orderCopyService.ts:44 | checker-resolved-properties-only | 13 |
| ScopedSource | src/shared/orderCopyInterpretationScope.ts:5 | checker-resolved-properties-only | 2 |
| OrderCopyScopeRow | src/shared/orderCopyInterpretationScope.ts:6 | checker-resolved-properties-only | 12 |
| Context | src/shared/orderCopyInterpretationScope.ts:7 | checker-resolved-properties-only | 3 |
| ParsedLine | components/PasteOrderModal.tsx:57 | checker-resolved-properties-only | 12 |
| OrderCopyEvidence | components/PasteOrderModal.tsx:101 | checker-resolved-properties-only | 4 |
| PasteOrderModalProps | components/PasteOrderModal.tsx:102 | checker-resolved-properties-only | 14 |
| Step | components/PasteOrderModal.tsx:125 | non-object-model-not-expanded | 0 |
| Props | components/OrderInterpretationRules.tsx:6 | checker-resolved-properties-only | 6 |
| DeliveryGroup | src/shared/deliveryPlan.ts:33 | checker-resolved-properties-only | 3 |
| DayPlan | src/shared/deliveryPlan.ts:41 | checker-resolved-properties-only | 5 |
| DeliveryPlanDoc | src/shared/deliveryPlan.ts:55 | checker-resolved-properties-only | 3 |
| DayRow | src/shared/deliveryPlan.ts:99 | checker-resolved-properties-only | 8 |
| DayListHandlers | components/DeliveryDayList.tsx:24 | checker-resolved-properties-only | 6 |
| Props | components/DeliveryDayList.tsx:39 | checker-resolved-properties-only | 8 |
| DeliveryManagerProps | components/DeliveryManager.tsx:44 | checker-resolved-properties-only | 22 |
| PalletManagerProps | components/PalletManager.tsx:30 | checker-resolved-properties-only | 7 |
| Row | components/PalletManager.tsx:330 | checker-resolved-properties-only | 9 |
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
| Applied | src/shared/services/orderRawBatchService.ts:15 | checker-resolved-properties-only | 4 |
| OrderRawBatchOutcome | src/shared/services/orderRawBatchService.ts:16 | checker-resolved-properties-only | 4 |
| Read | src/shared/services/orderRawBatchService.ts:17 | checker-resolved-properties-only | 0 |
| OrderRawBatchRead | src/shared/services/orderRawBatchService.ts:18 | checker-resolved-properties-only | 0 |
| RawUsageKg | src/features/admin/orderRawInventory.ts:14 | checker-resolved-properties-only | 0 |
| OrderRawInventoryDeps | src/features/admin/orderRawInventory.ts:16 | checker-resolved-properties-only | 6 |
| OrderProductLotMutationResult | src/features/admin/orderProductLots.ts:6 | checker-resolved-properties-only | 2 |
| OrderProductLotMutation | src/features/admin/orderProductLots.ts:11 | checker-resolved-properties-only | 2 |
| OrderProductLotDeps | src/features/admin/orderProductLots.ts:82 | checker-resolved-properties-only | 2 |
| OrderItemStockDeps | src/features/admin/orderItemStock.ts:13 | checker-resolved-properties-only | 4 |
| OrderStockReservation | src/features/admin/orderItemStock.ts:24 | checker-resolved-properties-only | 9 |
| CancellationAction | src/features/admin/orderInventoryCancellation.ts:13 | non-object-model-not-expanded | 0 |
| CancellationTicket | src/features/admin/orderInventoryCancellation.ts:111 | checker-resolved-properties-only | 5 |
| CancellationReceipt | src/features/admin/orderInventoryCancellation.ts:115 | checker-resolved-properties-only | 5 |
| CancellationResult | src/features/admin/orderInventoryCancellation.ts:119 | checker-resolved-properties-only | 8 |
| RollbackPlan | src/features/admin/rollbackSummary.ts:15 | checker-resolved-properties-only | 6 |
| OrderDeleteAction | src/features/admin/rollbackSummary.ts:235 | non-object-model-not-expanded | 0 |
| OrderDeleteStage | src/features/admin/rollbackSummary.ts:236 | non-object-model-not-expanded | 0 |
| OrderDeleteProgress | src/features/admin/rollbackSummary.ts:239 | checker-resolved-properties-only | 6 |
| OrderDeletePlan | src/features/admin/rollbackSummary.ts:248 | checker-resolved-properties-only | 12 |
| OrderProductionPreview | src/features/admin/orderProductionPreflight.ts:9 | checker-resolved-properties-only | 3 |
| OrderProductionRecordOutcome | src/shared/services/orderProductionRecordService.ts:15 | checker-resolved-properties-only | 4 |
| StockUseChoice | src/features/admin/orderStockEngine.ts:32 | checker-resolved-properties-only | 2 |
| StockUsePlan | src/features/admin/orderStockEngine.ts:38 | checker-resolved-properties-only | 0 |
| OrderStatusChangeContext | src/features/admin/orderStockEngine.ts:40 | checker-resolved-properties-only | 5 |
| PreparedOrderStatusChange | src/features/admin/orderStockEngine.ts:48 | checker-resolved-properties-only | 2 |
| OrderStockEngineDeps | src/features/admin/orderStockEngine.ts:66 | checker-resolved-properties-only | 17 |
| FrozenProductLots | src/features/admin/orderStockEngine.ts:179 | checker-resolved-properties-only | 5 |
| SavedLinePlan | src/features/admin/orderStockEngine.ts:1000 | checker-resolved-properties-only | 7 |
| Engine | src/features/admin/orderStockEngine.ts:1267 | checker-resolved-properties-only | 0 |
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
| SharedChatBase | src/shared/sharedChatAttempt.ts:4 | checker-resolved-properties-only | 9 |
| SharedChatFileAttempt | src/shared/sharedChatAttempt.ts:9 | checker-resolved-properties-only | 12 |
| SharedChatTextAttempt | src/shared/sharedChatAttempt.ts:13 | checker-resolved-properties-only | 11 |
| SharedChatAttempt | src/shared/sharedChatAttempt.ts:14 | non-object-model-not-expanded | 0 |
| MessageAction | src/shared/messageActions.ts:9 | non-object-model-not-expanded | 0 |
| ActionCtx | src/shared/messageActions.ts:11 | checker-resolved-properties-only | 4 |
| Reactions | src/shared/messageReactions.ts:21 | checker-resolved-properties-only | 0 |
| TimestampLike | src/shared/officeTalkTime.ts:1 | checker-resolved-properties-only | 3 |
| SharedChatAck | components/OfficeTalk.tsx:51 | checker-resolved-properties-only | 4 |
| OfficeTalkProps | components/OfficeTalk.tsx:53 | checker-resolved-properties-only | 14 |
| OrderLike | src/shared/newOrderAlert.ts:6 | checker-resolved-properties-only | 2 |
| PickOpts | src/shared/newOrderAlert.ts:8 | checker-resolved-properties-only | 3 |
| RoomLike | src/shared/newChatAlert.ts:6 | checker-resolved-properties-only | 7 |
| ChatPickOpts | src/shared/newChatAlert.ts:16 | checker-resolved-properties-only | 3 |
| DocMismatch | src/shared/docOil.ts:320 | checker-resolved-properties-only | 5 |
| DocDropReason | src/shared/docOil.ts:341 | non-object-model-not-expanded | 0 |
| DocDrop | src/shared/docOil.ts:342 | checker-resolved-properties-only | 5 |
| DropOrder | src/shared/docOil.ts:350 | checker-resolved-properties-only | 4 |
| RawDocEntry | src/shared/docOil.ts:438 | checker-resolved-properties-only | 7 |
| RawDocRow | src/shared/docOil.ts:450 | checker-resolved-properties-only | 8 |
| RawDocSheet | src/shared/docOil.ts:461 | checker-resolved-properties-only | 5 |
| Ev | src/shared/docOil.ts:488 | checker-resolved-properties-only | 7 |
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
| Window | components/AddPartnerModal.tsx:11 | checker-resolved-properties-only | 186 |
| AddPartnerModalProps | components/AddPartnerModal.tsx:16 | checker-resolved-properties-only | 3 |
| PartnerManagerProps | components/PartnerManager.tsx:31 | checker-resolved-properties-only | 4 |
| PayrollCommandInput | src/shared/services/payrollCommands.ts:7 | checker-resolved-properties-only | 4 |
| HRManagerProps | components/HRManager.tsx:45 | checker-resolved-properties-only | 11 |
| MergedItem | src/shared/mergeStatementItems.ts:15 | checker-resolved-properties-only | 7 |
| SplitMerged | src/shared/mergeStatementItems.ts:51 | checker-resolved-properties-only | 2 |
| DocParty | src/shared/docParty.ts:21 | checker-resolved-properties-only | 8 |
| DocPartiesByIdInput | src/shared/docParty.ts:89 | checker-resolved-properties-only | 5 |
| TaxStatementProps | components/TaxStatement.tsx:23 | checker-resolved-properties-only | 5 |
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
| ClosingRecord | components/HaccpChecklist.tsx:4034 | checker-resolved-properties-only | 11 |
| BenzopyreneTest | components/BenzopyreneLog.tsx:11 | checker-resolved-properties-only | 11 |
| Props | components/BenzopyreneLog.tsx:28 | checker-resolved-properties-only | 3 |
| Line | functions/src/returnReversalPlan.ts:4 | checker-resolved-properties-only | 12 |
| ReturnItem | functions/src/returnReversalPlan.ts:5 | checker-resolved-properties-only | 4 |
| ReturnRow | functions/src/returnReversalPlan.ts:6 | checker-resolved-properties-only | 8 |
| Source | functions/src/returnReversalPlan.ts:8 | checker-resolved-properties-only | 8 |
| JournalLine | functions/src/returnReversalPlan.ts:10 | checker-resolved-properties-only | 3 |
| Item | functions/src/shared/returnStockKind.ts:4 | checker-resolved-properties-only | 10 |
| ExplicitReturnMoney | src/features/admin/purchaseReturnRequest.ts:94 | checker-resolved-properties-only | 2 |
| DateRangeQuick | src/shared/components/DateRangeFilter.tsx:3 | non-object-model-not-expanded | 0 |
| ReturnManagerProps | components/ReturnManager.tsx:31 | checker-resolved-properties-only | 8 |
| Tab | components/ReturnManager.tsx:42 | non-object-model-not-expanded | 0 |
| ReturnCardProps | components/ReturnManager.tsx:504 | checker-resolved-properties-only | 4 |
| PurchaseReturnRow | src/features/admin/purchaseReturnRows.ts:2 | checker-resolved-properties-only | 8 |
| ReturnTab | components/ReceivingReturnsManager.tsx:16 | non-object-model-not-expanded | 0 |
| ReceivingReturnsManagerProps | components/ReceivingReturnsManager.tsx:18 | checker-resolved-properties-only | 10 |
| ProductionRecordProjectionStatus | src/shared/productionRecordProjection.ts:5 | non-object-model-not-expanded | 0 |
| ProductionRecordProjectionDetail | src/shared/productionRecordProjection.ts:6 | checker-resolved-properties-only | 3 |
| ItemFormulaRow | components/ProductionManager.tsx:11 | checker-resolved-properties-only | 4 |
| ProductionManagerProps | components/ProductionManager.tsx:29 | checker-resolved-properties-only | 9 |
| RecoveryDeletion | src/features/statements/infrastructure/tradeStatementRecoveryService.ts:52 | checker-resolved-properties-only | 4 |
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
| Props | components/voucher/CashEntryModal.tsx:47 | checker-resolved-properties-only | 20 |
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
| StatementManualSearchResult | src/features/statements/ui/StatementManualItemRows.tsx:11 | checker-resolved-properties-only | 2 |
| Props | src/features/statements/ui/StatementManualItemRows.tsx:16 | checker-resolved-properties-only | 24 |
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
| TradeStatementProps | components/TradeStatement.tsx:102 | checker-resolved-properties-only | 62 |
| StatementType | components/TradeStatement.tsx:187 | non-object-model-not-expanded | 0 |
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
| AdminAppProps | src/features/admin/AdminApp.tsx:266 | checker-resolved-properties-only | 12 |
| NewOrderDraft | src/features/admin/AdminApp.tsx:1473 | checker-resolved-properties-only | 46 |
| RightRow | src/features/admin/AdminApp.tsx:3293 | checker-resolved-properties-only | 7 |
| UsageRow | src/features/admin/AdminApp.tsx:3876 | checker-resolved-properties-only | 10 |
| StaffAppProps | src/features/staff/StaffApp.tsx:23 | checker-resolved-properties-only | 10 |
| Window | src/global.d.ts:3 | checker-resolved-properties-only | 186 |
| AppAlert | src/shared/components/AppAlertHost.tsx:5 | checker-resolved-properties-only | 4 |
| LoginResponse | src/shared/employeeAuth.ts:7 | checker-resolved-properties-only | 2 |
| LoginApp | src/shared/employeeAuth.ts:9 | non-object-model-not-expanded | 0 |
| AuthPageProps | src/shared/components/AuthPage.tsx:6 | checker-resolved-properties-only | 2 |
| PartnerPortalProps | components/PartnerPortal.tsx:18 | checker-resolved-properties-only | 5 |
| VoucherScopeRows | functions/src/newScopeCounter.ts:7 | checker-resolved-properties-only | 5 |
| Row | functions/src/oemBatchCostInvalidation.ts:6 | checker-resolved-properties-only | 0 |
| OemCostInvalidationWrite | functions/src/oemBatchCostInvalidation.ts:7 | checker-resolved-properties-only | 2 |
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
| Row | functions/src/statementIssueReceipt.ts:6 | checker-resolved-properties-only | 0 |
| StatementIssueIdentity | functions/src/statementIssueReceipt.ts:35 | checker-resolved-properties-only | 0 |
| Row | functions/src/partnerPaymentCommand.ts:15 | checker-resolved-properties-only | 0 |
| Input | functions/src/partnerPaymentCommand.ts:16 | checker-resolved-properties-only | 11 |
| Row | functions/src/partnerAdvanceReader.ts:5 | checker-resolved-properties-only | 0 |
| PartnerAdvanceSnapshot | functions/src/partnerAdvanceReader.ts:28 | checker-resolved-properties-only | 0 |
| Row | functions/src/partnerAdvanceCommand.ts:13 | checker-resolved-properties-only | 0 |
| AdvanceWriteScope | functions/src/partnerAdvanceCommand.ts:19 | checker-resolved-properties-only | 10 |
| PreparedAdvanceMutation | functions/src/partnerAdvanceCommand.ts:20 | checker-resolved-properties-only | 4 |
| Row | functions/src/deleteIssuedStatementCommand.ts:11 | checker-resolved-properties-only | 0 |
| Link | functions/src/deleteIssuedStatementCommand.ts:12 | checker-resolved-properties-only | 3 |
| Input | functions/src/deleteIssuedStatementCommand.ts:13 | checker-resolved-properties-only | 5 |
| Kind | functions/src/voucherIssue.ts:15 | non-object-model-not-expanded | 0 |
| Input | functions/src/voucherIssue.ts:16 | checker-resolved-properties-only | 6 |
| LoanSnapshot | functions/src/loanMovementPlan.ts:2 | checker-resolved-properties-only | 5 |
| LoanCash | functions/src/loanMovementPlan.ts:6 | checker-resolved-properties-only | 9 |
| LoanMovementRequest | functions/src/loanMovementPlan.ts:12 | checker-resolved-properties-only | 3 |
| LoanMovementPlan | functions/src/loanMovementPlan.ts:13 | checker-resolved-properties-only | 7 |
| Row | functions/src/loanMovementCommand.ts:13 | checker-resolved-properties-only | 0 |
| LoanMovementInput | functions/src/loanMovementCommand.ts:14 | checker-resolved-properties-only | 10 |
| ScheduledRequest | functions/src/loanMovementCommand.ts:31 | checker-resolved-properties-only | 4 |
| Row | functions/src/cancelPendingReturnCommand.ts:4 | checker-resolved-properties-only | 0 |
| Actor | functions/src/cancelPendingReturnCommand.ts:5 | non-object-model-not-expanded | 0 |
| PendingReturnCancellationInput | functions/src/cancelPendingReturnCommand.ts:6 | checker-resolved-properties-only | 5 |
| PendingReturnCancellationResult | functions/src/cancelPendingReturnCommand.ts:8 | checker-resolved-properties-only | 4 |
| Row | functions/src/tradeStatementIssue.ts:13 | checker-resolved-properties-only | 0 |
| Cost | functions/src/tradeStatementIssue.ts:14 | checker-resolved-properties-only | 5 |
| Input | functions/src/tradeStatementIssue.ts:15 | checker-resolved-properties-only | 8 |
| Row | functions/src/inspectTradeStatementCommand.ts:10 | checker-resolved-properties-only | 0 |
| InspectTradeStatementInput | functions/src/inspectTradeStatementCommand.ts:11 | checker-resolved-properties-only | 7 |
| Row | functions/src/cancelTradeStatementCommand.ts:6 | checker-resolved-properties-only | 0 |
| CancelTradeStatementInput | functions/src/cancelTradeStatementCommand.ts:7 | checker-resolved-properties-only | 5 |
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
| 들어온것 | functions/src/extractOrder.ts:38 | checker-resolved-properties-only | 6 |
| Row | functions/src/oemFeeVoucher.ts:12 | checker-resolved-properties-only | 0 |
| Input | functions/src/oemFeeVoucher.ts:13 | checker-resolved-properties-only | 4 |
| Row | functions/src/oemReceiptCommand.ts:14 | checker-resolved-properties-only | 0 |
| Input | functions/src/oemReceiptCommand.ts:15 | checker-resolved-properties-only | 8 |
| Result | functions/src/oemReceiptCommand.ts:25 | checker-resolved-properties-only | 4 |
| Action | functions/src/manualSettlementCommand.ts:10 | non-object-model-not-expanded | 0 |
| Input | functions/src/manualSettlementCommand.ts:11 | checker-resolved-properties-only | 10 |
| Item | functions/src/returnGeneralStockPlan.ts:4 | checker-resolved-properties-only | 9 |
| ReturnStockInput | functions/src/returnGeneralStockPlan.ts:6 | checker-resolved-properties-only | 9 |
| Item | functions/src/returnRawStockPlan.ts:13 | checker-resolved-properties-only | 13 |
| Input | functions/src/returnRawStockPlan.ts:15 | checker-resolved-properties-only | 13 |
| Applied | functions/src/returnRawStockPlan.ts:18 | checker-resolved-properties-only | 2 |
| ReturnClaim | functions/src/returnAllocationPlan.ts:4 | checker-resolved-properties-only | 7 |
| PriorReturnAllocation | functions/src/returnAllocationPlan.ts:8 | checker-resolved-properties-only | 3 |
| ReturnAllocationInput | functions/src/returnAllocationPlan.ts:11 | checker-resolved-properties-only | 8 |
| Row | functions/src/processReturnCommand.ts:29 | checker-resolved-properties-only | 0 |
| Input | functions/src/processReturnCommand.ts:30 | checker-resolved-properties-only | 6 |
| Allocation | functions/src/manualSettlementBatchCommand.ts:10 | checker-resolved-properties-only | 2 |
| Input | functions/src/manualSettlementBatchCommand.ts:11 | checker-resolved-properties-only | 6 |
| Claims | functions/src/interCompanyTransferPreparation.ts:8 | checker-resolved-properties-only | 3 |
| Row | functions/src/interCompanyTransferCommand.ts:13 | checker-resolved-properties-only | 0 |
| Claims | functions/src/interCompanyTransferCommand.ts:14 | checker-resolved-properties-only | 3 |
| Input | functions/src/interCompanyTransferCommand.ts:15 | checker-resolved-properties-only | 14 |
| Row | functions/src/inventoryOpeningCommand.ts:14 | checker-resolved-properties-only | 0 |
| InventoryOpeningInput | functions/src/inventoryOpeningCommand.ts:15 | checker-resolved-properties-only | 6 |
| Actor | functions/src/inventoryOpeningCommand.ts:16 | non-object-model-not-expanded | 0 |
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
| OrderRow | functions/src/orderLockRecovery.ts:7 | checker-resolved-properties-only | 11 |
| Input | functions/src/orderLockRecovery.ts:8 | checker-resolved-properties-only | 5 |
| OrderLockRecoveryResult | functions/src/orderLockRecovery.ts:9 | checker-resolved-properties-only | 8 |
| RetirementInput | functions/src/orderRequestRetirement.ts:11 | checker-resolved-properties-only | 3 |
| RetirementResult | functions/src/orderRequestRetirement.ts:12 | checker-resolved-properties-only | 9 |

## 미해석 속성 접근 조사 목록

이 목록은 속성 선언을 해석하지 못한 위치와 수신 객체 타입이다. DB 필드 목록이 아니며 any/unknown·동적/런타임 접근을 실제 소스에서 분류해야 한다. 미해석 숫자 0을 완료 조건으로 바꾸지 않는다.

| 위치 | 식 | 수신 타입 | 미해석 이유 |
| --- | --- | --- | --- |
| functions/src/shared/oemBatchCost.ts:107 | source.companyId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/oemBatchCost.ts:107 | source.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/oemBatchCost.ts:107 | source.sent | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/oemBatchCost.ts:107 | source.date | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/oemBatchCost.ts:107 | source.oemCostEvidence | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/inventoryWriterProtocol.ts:6 | before?.inventoryWriterProtocolVersion | Row \| undefined | property-symbol-unresolved |
| functions/src/shared/inventoryWriterProtocol.ts:7 | before?.inventoryWriteRevision | Row \| undefined | property-symbol-unresolved |
| functions/src/shared/inventoryWriterProtocol.ts:7 | before.inventoryWriteRevision | Row | property-symbol-unresolved |
| functions/src/shared/inventoryWriterProtocol.ts:9 | before?.inventoryWriteRevision | Row \| undefined | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:48 | data.inventoryWriterProtocolVersion | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:48 | data.inventoryWriterProtocolVersion | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:49 | data.inventoryWriterProtocolVersion | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:49 | data.inventoryWriteRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:50 | data.inventoryWriteRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:50 | data.inventoryWriteRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:80 | value.bind | any | any-receiver |
| src/shared/inventoryWriterProtocol.ts:89 | write.data?.inventoryWriterProtocolVersion | Record<string, any> \| undefined | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:92 | proposal?.inventoryWriterProtocolVersion | Record<string, any> \| undefined | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:92 | proposal.inventoryWriteRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:95 | proposal?.companyId | Record<string, any> \| undefined | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:95 | proposal.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:102 | proposal!.inventoryWriteRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:106 | proposal!.inventoryWriteRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:117 | seen.get(tombRef.path)?.snapshot.data()?.deletionRevision | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/inventoryWriterProtocol.ts:120 | before.inventoryOperation?.id | any | any-receiver |
| src/shared/inventoryWriterProtocol.ts:122 | audit.cancellation?.action | any | any-receiver |
| src/shared/inventoryWriterProtocol.ts:122 | audit.cancellation?.deleted | any | any-receiver |
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
| src/shared/services/rawInventoryService.ts:109 | patch.stock | Record<string, unknown> | property-symbol-unresolved |
| src/shared/rawPressAttempt.ts:54 | value.request | any | any-receiver |
| src/shared/rawPressAttempt.ts:55 | value.state | any | any-receiver |
| src/shared/rawPressAttempt.ts:57 | value.state | any | any-receiver |
| src/shared/rawPressAttempt.ts:57 | marker?.encoded | any | any-receiver |
| src/shared/rawPressAttempt.ts:57 | marker.deleted | any | any-receiver |
| src/shared/rawPressAttempt.ts:69 | parsed.request | any | any-receiver |
| src/shared/rawPressAttempt.ts:70 | parsed.state | any | any-receiver |
| src/shared/rawPressAttempt.ts:149 | request.companyId | any | any-receiver |
| src/shared/rawPressAttempt.ts:149 | request.actorUid | any | any-receiver |
| src/shared/rawPressAttempt.ts:149 | request.originalOperationId | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:35 | row.itemId | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:35 | row.itemId.trim | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:35 | row.itemId | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:35 | row.lotId | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:35 | row.lotId.trim | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:35 | row.lotId | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:35 | row.qty | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:35 | row.qty | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:43 | request.generation | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:44 | request.deltas | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:44 | request.deltas.some | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:44 | request.deltas | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:45 | request.lotItemIds | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:45 | request.lotItemIds.some | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:45 | request.lotItemIds | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:46 | request.patch | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:46 | request.patch | any | any-receiver |
| src/shared/orderInventoryGeneration.ts:46 | request.patch | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:3 | order.items.map | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:3 | order.items | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.id | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.status | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.producedAt | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.shippedOut | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.deliveredAt | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.rawInventoryAttempt | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.itemInventory | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.inventorySnapshots | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.rawConsumedLots | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:4 | order.purpose | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:8 | order?.inventoryOperation | Record<string, any> \| undefined | property-symbol-unresolved |
| functions/src/shared/orderRawBatchOrderEvidence.ts:10 | op.contractVersion | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:10 | op.id | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:10 | op.startedAt | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:10 | op.actorUid | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:10 | op.startedAt | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:11 | op.id | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:11 | op.startedAt | any | any-receiver |
| functions/src/shared/orderRawBatchOrderEvidence.ts:11 | op.actorUid | any | any-receiver |
| src/shared/orderRawBatchAttempt.ts:26 | request.business.orderText | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderRawBatchAttempt.ts:26 | request.business.orderText | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderRawBatchAttempt.ts:36 | request.generation | any | any-receiver |
| src/shared/orderRawBatchAttempt.ts:36 | g.companyId | any | any-receiver |
| src/shared/orderRawBatchAttempt.ts:36 | g.actorUid | any | any-receiver |
| src/shared/orderRawBatchAttempt.ts:36 | g.orderId | any | any-receiver |
| src/shared/oemReceiptPending.ts:20 | row?.version | any | any-receiver |
| src/shared/oemReceiptPending.ts:20 | row.companyId | any | any-receiver |
| src/shared/oemReceiptPending.ts:20 | row.actorUid | any | any-receiver |
| src/shared/oemReceiptPending.ts:20 | row.poId | any | any-receiver |
| src/shared/oemReceiptPending.ts:26 | row?.input?.po?.id | any | any-receiver |
| src/shared/oemReceiptPending.ts:26 | row?.input?.po | any | any-receiver |
| src/shared/oemReceiptPending.ts:26 | row?.input | any | any-receiver |
| src/shared/oemReceiptPending.ts:26 | row.poId | any | any-receiver |
| src/shared/oemReceiptPending.ts:26 | row.input.po.companyId | any | any-receiver |
| src/shared/oemReceiptPending.ts:26 | row.input.po | any | any-receiver |
| src/shared/oemReceiptPending.ts:26 | row.input | any | any-receiver |
| src/shared/oemReceiptPending.ts:26 | row.companyId | any | any-receiver |
| src/shared/oemReceiptPending.ts:27 | row.input.returns | any | any-receiver |
| src/shared/oemReceiptPending.ts:27 | row.input | any | any-receiver |
| src/shared/oemReceiptPending.ts:27 | row.input.bulk | any | any-receiver |
| src/shared/oemReceiptPending.ts:27 | row.input | any | any-receiver |
| src/shared/oemReceiptPending.ts:27 | row.input.date | any | any-receiver |
| src/shared/oemReceiptPending.ts:27 | row.input | any | any-receiver |
| src/shared/oemReceiptPending.ts:27 | row.input.unitPricePerKg | any | any-receiver |
| src/shared/oemReceiptPending.ts:27 | row.input | any | any-receiver |
| src/shared/oemReceiptPending.ts:28 | row?.request?.poId | any | any-receiver |
| src/shared/oemReceiptPending.ts:28 | row?.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:28 | row.poId | any | any-receiver |
| src/shared/oemReceiptPending.ts:28 | row.request.operationId | any | any-receiver |
| src/shared/oemReceiptPending.ts:28 | row.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:28 | row.poId | any | any-receiver |
| src/shared/oemReceiptPending.ts:29 | row.request.releaseId | any | any-receiver |
| src/shared/oemReceiptPending.ts:29 | row.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:29 | row.request.date | any | any-receiver |
| src/shared/oemReceiptPending.ts:29 | row.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:29 | row.request.returns | any | any-receiver |
| src/shared/oemReceiptPending.ts:29 | row.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:30 | row.request.returns.every | any | any-receiver |
| src/shared/oemReceiptPending.ts:30 | row.request.returns | any | any-receiver |
| src/shared/oemReceiptPending.ts:30 | row.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:30 | line?.itemId | any | any-receiver |
| src/shared/oemReceiptPending.ts:30 | line.qty | any | any-receiver |
| src/shared/oemReceiptPending.ts:30 | line.qty | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | row.request.bulk | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | row.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | row.request.bulk | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | row.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | row.request.bulk.every | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | row.request.bulk | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | row.request | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | line?.material | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | line.material.trim | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | line.material | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | line.rawItemId | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | line.kg | any | any-receiver |
| src/shared/oemReceiptPending.ts:31 | line.kg | any | any-receiver |
| src/shared/oemReceiptPending.ts:36 | marker.draftText | any | any-receiver |
| src/shared/oemReceiptPending.ts:36 | marker.packetText | any | any-receiver |
| src/shared/oemReceiptPending.ts:36 | marker.legacyText | any | any-receiver |
| src/shared/oemReceiptPending.ts:38 | marker.deleted | any | any-receiver |
| src/shared/oemReceiptPending.ts:38 | marker.error | any | any-receiver |
| src/shared/oemReceiptPending.ts:38 | marker.error | any | any-receiver |
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
| src/shared/releaseGate.ts:2 | gate?.status | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/shared/releaseGate.ts:2 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/releaseGate.ts:3 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/releaseGate.ts:5 | gate.releaseId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/lotAnchor.ts:51 | item.material | Record<string, unknown> | property-symbol-unresolved |
| functions/src/shared/lotAnchor.ts:51 | item.rawMaterialName | Record<string, unknown> | property-symbol-unresolved |
| src/shared/companyWriteBoundary.ts:28 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/companyWriteBoundary.ts:28 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/orderRequestRetirementService.ts:15 | stored.requestText | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:15 | request.retirementId | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | stored.requestText | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | stored.requestHash | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | stored.version | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.companyId | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.actorUid | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.orderId | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.expectedStatus | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.operation.kind | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.operation | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.operation.lineId | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.operation | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.operation.targetStatus | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:27 | request.operation | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:42 | request.operation.id | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:42 | request.operation | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:42 | request.operation.startedAt | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:42 | request.operation | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:44 | request.retirementId | any | any-receiver |
| src/shared/services/orderRequestRetirementService.ts:44 | request.retirementId | any | any-receiver |
| src/shared/services/firebaseService.ts:72 | data.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:72 | data.itemId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:72 | data.inventoryWriterProtocolVersion | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:72 | data.deletionRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:72 | data.deletionRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:72 | data.lastDeletedItemRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:72 | data.lastDeletedItemRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:72 | data.beforeRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:72 | data.lastDeletedItemRevision | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:85 | tombstone?.lastDeletedItemRevision | Record<string, any> \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:100 | data.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:102 | data.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:103 | data.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:104 | data.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:108 | before?.type | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:109 | data.isSmartStore | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:111 | scoped.partnerIds | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:160 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:271 | snap.data()?.hasPartnerOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:271 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:271 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:271 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:271 | snap.data()?.date | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:275 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:279 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:280 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:284 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:285 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:289 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:289 | snap.data()?.amounts | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:297 | snap.data()?.hasPartnerOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:298 | snap.data()?.hasLoanOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:299 | snap.data()?.hasCashOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:300 | snap.data()?.hasInventoryOpening | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:307 | token?.claims.companyId | ParsedToken \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:465 | item.id | any | any-receiver |
| src/shared/services/firebaseService.ts:465 | item.id.trim | any | any-receiver |
| src/shared/services/firebaseService.ts:465 | item.id | any | any-receiver |
| src/shared/services/firebaseService.ts:465 | item.id | any | any-receiver |
| src/shared/services/firebaseService.ts:465 | item.id.trim | any | any-receiver |
| src/shared/services/firebaseService.ts:465 | item.id | any | any-receiver |
| src/shared/services/firebaseService.ts:465 | item.id.includes | any | any-receiver |
| src/shared/services/firebaseService.ts:465 | item.id | any | any-receiver |
| src/shared/services/firebaseService.ts:487 | request.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:504 | data.cashEntryId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:505 | data.statementId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:507 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:508 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:512 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:515 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:518 | data.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:624 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:658 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:770 | scoped[0].companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:773 | scoped[index].companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:776 | scoped[index].companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:778 | scoped[index].companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:782 | checked.inventoryWriteRevision | Row | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:783 | tomb?.deletionRevision | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:785 | scoped[index].companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:785 | scoped[index].companyId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:827 | data.companyId | any | any-receiver |
| src/shared/services/firebaseService.ts:866 | currentPo?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:867 | currentPo?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:1046 | current.retirementClaimPending | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:1047 | current.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:1048 | current.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:1050 | current.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/firebaseService.ts:1050 | current.retirementId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/sharedChatMessageService.ts:38 | room.data().participantIds?.includes | any | any-receiver |
| src/shared/services/orderInventoryRecoveryService.ts:23 | ticket.companyId | any | any-receiver |
| src/shared/services/orderInventoryRecoveryService.ts:23 | ticket.orderId | any | any-receiver |
| src/shared/services/orderInventoryRecoveryService.ts:23 | ticket.operationId | any | any-receiver |
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
| src/shared/services/rawPressService.ts:38 | state?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/rawPressService.ts:58 | guard?.id | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/itemInventoryAttempt.ts:51 | value.request | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:51 | value.request | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:51 | value.state | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:52 | marker?.deleted | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:52 | marker.encoded | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:54 | value.state | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:55 | value.state | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:74 | value.request | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:74 | value.state | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:74 | value.request.companyId | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:74 | value.request | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:74 | value.request.uid | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:74 | value.request | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:74 | value.request.kind | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:74 | value.request | any | any-receiver |
| src/shared/itemInventoryAttempt.ts:82 | JSON.parse(marker).encoded | any | any-receiver |
| src/shared/services/unpackService.ts:85 | saved.inventoryResult?.movesText | any | any-receiver |
| src/shared/services/unpackService.ts:87 | saved.source?.type | any | any-receiver |
| src/shared/services/unpackService.ts:87 | saved.source.id | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.supplierName | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.cans | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.cans | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.bulkQty | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.cans | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.canLotId | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.canLotId | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.canLotId | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.cans | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.canBefore | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.canAfter | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.bulkBefore | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.bulkAfter | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.canBefore | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.canAfter | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.canAfter | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.bulkAfter | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.bulkAfter | any | any-receiver |
| src/shared/services/unpackService.ts:88 | result.bulkBefore | any | any-receiver |
| src/shared/services/unpackService.ts:88 | row.bulkQty | any | any-receiver |
| src/shared/services/unpackService.ts:277 | previous.request | any | any-receiver |
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
| src/features/statements/infrastructure/tradeStatementPending.ts:28 | row?.version | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementPending.ts:28 | row.key | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementPending.ts:28 | row.text | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementPending.ts:28 | row.archived | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementPending.ts:29 | row.deleted | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementPending.ts:112 | JSON.parse(state).text | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementPending.ts:133 | d?.version | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:133 | d.operationStatus | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:133 | d.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:134 | d.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:134 | d.actorId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:134 | d.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:134 | d.statementId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:134 | request.statement.id | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:135 | d.requestText | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:135 | d.requestHash | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:135 | d.receiptRevision | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:135 | d.receiptRevision | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:138 | d.requestHash | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:143 | d?.operationStatus | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:143 | d.version | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:143 | d.financialWrites | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:143 | d.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementPending.ts:143 | d.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.operationId | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.operationId | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.statement | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.statement.companyId | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.statement | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.statement.id | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.statement | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.operationId | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.statement.id | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.statement | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.releaseId | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.releaseId | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.orderIds | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.orderIds.some | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.orderIds | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.poIds | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.poIds.some | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.poIds | any | any-receiver |
| src/features/statements/domain/tradeStatementRecovery.ts:16 | r.costUpdates | any | any-receiver |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:37 | JSON.parse(legacyText)?.operationId | any | any-receiver |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:44 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:46 | scoped.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:108 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:137 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:209 | gate?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:227 | release?.status | DocumentData \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:241 | failure?.version | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:241 | failure.companyId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:241 | failure.partnerId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:242 | failure.operationId | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:242 | failure.operationRejected | Record<string, unknown> | property-symbol-unresolved |
| src/features/statements/infrastructure/issueTradeStatementCommand.ts:242 | failure.financialWrites | Record<string, unknown> | property-symbol-unresolved |
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
| components/AddItemModal.tsx:96 | pi.Direction | any | any-receiver |
| components/AddItemModal.tsx:97 | pi.Direction | any | any-receiver |
| components/AddItemModal.tsx:723 | (s as any).spec | any | any-receiver |
| components/AddItemModal.tsx:723 | (s as any).spec | any | any-receiver |
| components/AddItemModal.tsx:776 | cs.name | any | any-receiver |
| components/AddItemModal.tsx:777 | cs.stock | any | any-receiver |
| components/AddItemModal.tsx:845 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:845 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:848 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:848 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:855 | (p as any).spec | any | any-receiver |
| components/AddItemModal.tsx:856 | (p as any).spec | any | any-receiver |
| components/LotTimeline.tsx:35 | parts.year | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.month | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.day | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.hour | { [k: string]: string; } | property-symbol-unresolved |
| components/LotTimeline.tsx:35 | parts.minute | { [k: string]: string; } | property-symbol-unresolved |
| src/shared/oemIssuePending.ts:24 | state?.encoded | any | any-receiver |
| src/shared/oemIssuePending.ts:24 | state.deleted | any | any-receiver |
| src/shared/oemIssuePending.ts:24 | state?.encoded | any | any-receiver |
| src/shared/oemIssuePending.ts:24 | state.error | any | any-receiver |
| src/shared/oemIssuePending.ts:24 | state.error | any | any-receiver |
| src/shared/oemIssuePending.ts:29 | marker?.encoded | any | any-receiver |
| src/shared/oemIssuePending.ts:29 | marker.deleted | any | any-receiver |
| src/features/admin/oemExternalStock.ts:33 | job.companyId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:34 | job.id | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:34 | job.source?.type | any | any-receiver |
| src/features/admin/oemExternalStock.ts:34 | job.source | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:34 | job.source?.id | any | any-receiver |
| src/features/admin/oemExternalStock.ts:34 | job.source | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:35 | job.status | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:35 | job.expectedOperationIds | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:43 | receipt.companyId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:43 | receipt.operationId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:43 | receipt.rawItemId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:44 | receipt.source?.type | any | any-receiver |
| src/features/admin/oemExternalStock.ts:44 | receipt.source | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:44 | receipt.source?.id | any | any-receiver |
| src/features/admin/oemExternalStock.ts:44 | receipt.source | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:44 | receipt.kind | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:44 | receipt.commandHash | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:45 | receipt.reportedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:45 | receipt.appliedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:46 | receipt.appliedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:54 | guard.companyId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:54 | guard.rawItemId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:54 | guard.originalOperationId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:54 | guard.reverseOperationId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:55 | reversal.companyId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:55 | reversal.rawItemId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:55 | reversal.operationId | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:55 | reversal.reversalOf | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:56 | reversal.source?.type | any | any-receiver |
| src/features/admin/oemExternalStock.ts:56 | reversal.source | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:56 | reversal.source?.id | any | any-receiver |
| src/features/admin/oemExternalStock.ts:56 | reversal.source | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:56 | reversal.kind | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:56 | reversal.commandHash | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:57 | reversal.reportedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:57 | reversal.appliedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:57 | receipt.appliedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:61 | receipt.reportedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:61 | receipt.appliedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/features/admin/oemExternalStock.ts:61 | receipt.appliedDeltaKg | Record<string, any> | property-symbol-unresolved |
| src/shared/services/boxUnpackService.ts:38 | row.qty | any | any-receiver |
| src/shared/services/boxUnpackService.ts:38 | row.qty | any | any-receiver |
| src/shared/services/boxUnpackService.ts:38 | row.qty | any | any-receiver |
| src/shared/services/boxUnpackService.ts:38 | move.inventoryResult?.sourceText | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | move.sourceLots.length | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.boxBefore | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.boxAfter | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.unitBefore | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.unitAfter | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.unitKg | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.boxBefore | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.boxAfter | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.unitAfter | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.unitBefore | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.unitKg | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.boxAfter | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | result.unitAfter | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | move.sourceLots.some | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | row.lotId | any | any-receiver |
| src/shared/services/boxUnpackService.ts:39 | row.lotId | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.itemId | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.deltaQty | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.beforeQty | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.afterQty | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.afterQty | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.anchorId | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.afterQty | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.beforeQty | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.deltaQty | any | any-receiver |
| src/shared/services/itemStockAddService.ts:23 | row.anchorId | any | any-receiver |
| src/shared/services/itemStockAddService.ts:33 | lots.find((lot:any)=>lot.unitKg)?.unitKg | any | any-receiver |
| src/shared/services/itemStockAddService.ts:33 | lots.find | any | any-receiver |
| src/shared/services/itemStockAddService.ts:33 | lot.unitKg | any | any-receiver |
| components/ItemList.tsx:330 | (p?.lots ?? []).length | any | any-receiver |
| components/ItemList.tsx:330 | p?.lots | any | any-receiver |
| components/ItemList.tsx:331 | p.lots | any | any-receiver |
| components/ItemList.tsx:332 | p?.stock | any | any-receiver |
| components/ItemList.tsx:333 | p?.density | any | any-receiver |
| components/ItemList.tsx:333 | p.density | any | any-receiver |
| components/ItemList.tsx:619 | canvas.toBlob | any | any-receiver |
| components/ItemList.tsx:648 | (e as any)?.message | any | any-receiver |
| components/ItemList.tsx:668 | nav.canShare | any | any-receiver |
| components/ItemList.tsx:668 | nav.canShare | any | any-receiver |
| components/ItemList.tsx:669 | nav.share | any | any-receiver |
| components/ItemList.tsx:1212 | value.po?.id | any | any-receiver |
| components/ItemList.tsx:1212 | value.po | any | any-receiver |
| components/ItemList.tsx:1212 | value.po?.companyId | any | any-receiver |
| components/ItemList.tsx:1212 | value.po | any | any-receiver |
| components/ItemList.tsx:1212 | value.po?.poType | any | any-receiver |
| components/ItemList.tsx:1212 | value.po | any | any-receiver |
| components/ItemList.tsx:1212 | value.po?.status | any | any-receiver |
| components/ItemList.tsx:1212 | value.po | any | any-receiver |
| components/ItemList.tsx:1212 | value.po?.oemCancelledAt | any | any-receiver |
| components/ItemList.tsx:1212 | value.po | any | any-receiver |
| components/ItemList.tsx:1212 | value.po?.oemCancelOperationId | any | any-receiver |
| components/ItemList.tsx:1212 | value.po | any | any-receiver |
| components/ItemList.tsx:1213 | value.returns | any | any-receiver |
| components/ItemList.tsx:1213 | value.returns.every | any | any-receiver |
| components/ItemList.tsx:1213 | value.returns | any | any-receiver |
| components/ItemList.tsx:1213 | row.itemId | any | any-receiver |
| components/ItemList.tsx:1213 | row.itemId | any | any-receiver |
| components/ItemList.tsx:1213 | row.qty | any | any-receiver |
| components/ItemList.tsx:1213 | row.qty | any | any-receiver |
| components/ItemList.tsx:1214 | value.bulk | any | any-receiver |
| components/ItemList.tsx:1214 | value.bulk.every | any | any-receiver |
| components/ItemList.tsx:1214 | value.bulk | any | any-receiver |
| components/ItemList.tsx:1214 | row.material | any | any-receiver |
| components/ItemList.tsx:1214 | row.material | any | any-receiver |
| components/ItemList.tsx:1214 | row.kg | any | any-receiver |
| components/ItemList.tsx:1214 | row.kg | any | any-receiver |
| components/ItemList.tsx:1215 | value.returns.length | any | any-receiver |
| components/ItemList.tsx:1215 | value.returns | any | any-receiver |
| components/ItemList.tsx:1215 | value.bulk.length | any | any-receiver |
| components/ItemList.tsx:1215 | value.bulk | any | any-receiver |
| components/ItemList.tsx:1215 | value.unitPricePerKg | any | any-receiver |
| components/ItemList.tsx:1215 | value.unitPricePerKg | any | any-receiver |
| components/ItemList.tsx:1215 | value.date | any | any-receiver |
| components/ItemList.tsx:1215 | value.date | any | any-receiver |
| components/ItemList.tsx:2147 | (e as any).lotChanges?.some | any | any-receiver |
| components/ItemList.tsx:2147 | (e as any).lotChanges | any | any-receiver |
| components/ItemList.tsx:2147 | change.lotId | any | any-receiver |
| components/ItemList.tsx:2149 | (e as any).source?.type | any | any-receiver |
| components/ItemList.tsx:2149 | (e as any).source | any | any-receiver |
| components/ItemList.tsx:2149 | (e as any).source?.id | any | any-receiver |
| components/ItemList.tsx:2149 | (e as any).source | any | any-receiver |
| components/AddOrderModal.tsx:68 | pi.Direction | any | any-receiver |
| components/AddOrderModal.tsx:238 | pi.partnerId | any | any-receiver |
| components/AddOrderModal.tsx:239 | pi.itemId | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:50 | row.sourceId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:50 | row.sourceId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:50 | row.sourceId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:51 | row.text | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:51 | row.text | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:52 | row.sourceId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:52 | row.text | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:54 | row.sourceId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:54 | row.text | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:62 | raw.results | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:63 | raw.results | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:63 | group.sourceId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:63 | group.sourceId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:66 | raw.results | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:66 | group.sourceId | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:70 | group.lines | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:70 | group.rejected | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:70 | group.lines.length | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:70 | group.lines | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:70 | group.lines.length | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:70 | group.lines | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:70 | group.rejected.length | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:70 | group.rejected | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:74 | group.lines | any | any-receiver |
| functions/src/shared/orderCopyInterpretationScope.ts:75 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:75 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:76 | line.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:76 | line.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:76 | line.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:77 | line.isBox | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:77 | line.isBox | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:77 | line.source | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:78 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:78 | line.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:78 | line.isBox | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:78 | line.source | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:80 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:80 | line.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:80 | line.source | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:80 | line.isBox | Record<string, any> | property-symbol-unresolved |
| functions/src/shared/orderCopyInterpretationScope.ts:80 | line.isBox | Record<string, any> | property-symbol-unresolved |
| src/shared/orderExtract.ts:110 | row.source | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:110 | row.name | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:111 | row.itemId | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:118 | row.qty | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:128 | row.isBox | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:128 | row.isBox | Record<string, unknown> | property-symbol-unresolved |
| src/shared/orderExtract.ts:129 | row.source | Record<string, unknown> | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:22 | value.id | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.cardNo | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.partnerId | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.partnerName | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.items | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.items.length | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.items | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.items.length | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.items | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.totalAmount | any | any-receiver |
| functions/src/orderCopyCommands.ts:22 | value.totalAmount | any | any-receiver |
| functions/src/orderCopyCommands.ts:23 | value.source | any | any-receiver |
| functions/src/orderCopyCommands.ts:23 | value.shipMethod | any | any-receiver |
| functions/src/orderCopyCommands.ts:23 | value.createdAt | any | any-receiver |
| functions/src/orderCopyCommands.ts:23 | value.deliveryDate | any | any-receiver |
| functions/src/orderCopyCommands.ts:25 | value.items | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.lineId | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.lineId | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.itemId | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.name | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.quantity | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.quantity | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.price | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.price | any | any-receiver |
| functions/src/orderCopyCommands.ts:27 | row.lineId | any | any-receiver |
| functions/src/orderCopyCommands.ts:29 | row.isBoxUnit | any | any-receiver |
| functions/src/orderCopyCommands.ts:29 | row.isBoxUnit | any | any-receiver |
| functions/src/orderCopyCommands.ts:33 | value.noteImportant | any | any-receiver |
| functions/src/orderCopyCommands.ts:33 | value.noteImportant | any | any-receiver |
| functions/src/orderCopyCommands.ts:35 | value.pallets | any | any-receiver |
| functions/src/orderCopyCommands.ts:35 | pallet.type | any | any-receiver |
| functions/src/orderCopyCommands.ts:35 | pallet.quantity | any | any-receiver |
| functions/src/orderCopyCommands.ts:35 | pallet.quantity | any | any-receiver |
| functions/src/orderCopyCommands.ts:35 | pallet.isExchange | any | any-receiver |
| functions/src/orderCopyCommands.ts:35 | pallet.isExchange | any | any-receiver |
| functions/src/orderCopyCommands.ts:36 | value.deliveryBoxes | any | any-receiver |
| functions/src/orderCopyCommands.ts:36 | box.itemId | any | any-receiver |
| functions/src/orderCopyCommands.ts:36 | box.name | any | any-receiver |
| functions/src/orderCopyCommands.ts:36 | box.quantity | any | any-receiver |
| functions/src/orderCopyCommands.ts:36 | box.quantity | any | any-receiver |
| functions/src/orderCopyCommands.ts:43 | auth.token | any | any-receiver |
| functions/src/orderCopyCommands.ts:43 | token?.companyId | any | any-receiver |
| functions/src/orderCopyCommands.ts:43 | token.employeeId | any | any-receiver |
| functions/src/orderCopyCommands.ts:43 | token.employeeId.trim | any | any-receiver |
| functions/src/orderCopyCommands.ts:43 | token.employeeId | any | any-receiver |
| functions/src/orderCopyCommands.ts:43 | auth.uid | any | any-receiver |
| functions/src/orderCopyCommands.ts:43 | token.isAdmin | any | any-receiver |
| functions/src/orderCopyCommands.ts:44 | token.companyId | any | any-receiver |
| functions/src/orderCopyCommands.ts:44 | auth.uid | any | any-receiver |
| functions/src/orderCopyCommands.ts:44 | token.employeeId | any | any-receiver |
| functions/src/orderCopyCommands.ts:52 | draft.id | Record<string, any> | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:52 | draft.id | Record<string, any> | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:63 | draft.partnerId | Record<string, any> | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:63 | draft.items.map | any | any-receiver |
| functions/src/orderCopyCommands.ts:63 | draft.items | Record<string, any> | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:63 | row.itemId | any | any-receiver |
| functions/src/orderCopyCommands.ts:65 | row.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:66 | row.data()?.archived | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:76 | draft.id | Record<string, any> | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:97 | request.requestId | any | any-receiver |
| functions/src/orderCopyCommands.ts:97 | request.confirmed.orderDraft.id | any | any-receiver |
| functions/src/orderCopyCommands.ts:97 | request.confirmed.orderDraft | any | any-receiver |
| functions/src/orderCopyCommands.ts:97 | request.confirmed | any | any-receiver |
| functions/src/orderCopyCommands.ts:100 | doc.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:100 | doc.data()?.archived | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderCopyCommands.ts:105 | request.data?.includeAll | any | any-receiver |
| functions/src/orderCopyCommands.ts:105 | request.data?.companyId | any | any-receiver |
| functions/src/orderCopyCommands.ts:105 | request.data?.includeAll | any | any-receiver |
| src/shared/services/orderCopyService.ts:50 | gate?.releaseId | DocumentData \| undefined | property-symbol-unresolved |
| components/PasteOrderModal.tsx:131 | pi.Direction | any | any-receiver |
| components/PasteOrderModal.tsx:234 | r.partnerId | any | any-receiver |
| components/PasteOrderModal.tsx:234 | r.Direction | any | any-receiver |
| components/PasteOrderModal.tsx:236 | r.itemId | any | any-receiver |
| src/shared/push.ts:97 | e?.message | any | any-receiver |
| src/shared/services/orderRawBatchService.ts:40 | data.requestText | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:40 | data.requestText | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:40 | data.request | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:42 | data.requestText | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:43 | data.request | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:52 | data.results | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:55 | data.atomicVersion | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:55 | data.status | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:55 | data.companyId | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:55 | data.actorUid | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:56 | data.id | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:56 | data.source?.type | any | any-receiver |
| src/shared/services/orderRawBatchService.ts:56 | data.source | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:56 | data.source.id | any | any-receiver |
| src/shared/services/orderRawBatchService.ts:56 | data.source | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:56 | data.createdAt | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:56 | data.completedAt | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:57 | data.requestHash | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:57 | data.expectedOperationIds | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:87 | request.business.orderText | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:88 | request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/orderRawBatchService.ts:103 | itemData.stock | { [x: string]: any; } | property-symbol-unresolved |
| src/features/admin/orderItemStock.ts:104 | data.inventoryReservations | Record<string, any> | property-symbol-unresolved |
| src/features/admin/orderItemStock.ts:107 | data.stock | Record<string, any> | property-symbol-unresolved |
| src/features/admin/orderItemStock.ts:114 | data.stock | Record<string, any> | property-symbol-unresolved |
| src/features/admin/orderItemStock.ts:161 | snapshot.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/orderItemStock.ts:217 | snapshot.data()?.inventoryReservations | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/orderItemStock.ts:309 | snapshot.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| src/features/admin/orderItemStock.ts:363 | patch?.inventoryOperation | Record<string, unknown> \| null | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:98 | patch.lots | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:105 | patch.lots | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderInventoryCancellation.ts:130 | value?.state | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:131 | value.id | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:131 | value.orderId | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:131 | value.companyId | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:132 | value.cancellation?.action | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:132 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:132 | value.cancellation?.evidence | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:132 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:133 | value.cancellation?.deleted | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:133 | value.cancellation | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:212 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:212 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:213 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:275 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:277 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:278 | ref.path | any | any-receiver |
| src/features/admin/orderInventoryCancellation.ts:294 | write.ref.path | any | any-receiver |
| src/features/admin/orderProductionPreflight.ts:29 | item?.name | Record<string, any> \| undefined | property-symbol-unresolved |
| src/features/admin/orderProductionPreflight.ts:41 | itemData.stock | { [x: string]: any; } | property-symbol-unresolved |
| src/features/admin/orderProductionPreflight.ts:46 | item.lots | Record<string, any> | property-symbol-unresolved |
| src/features/admin/orderProductionPreflight.ts:46 | item.stock | Record<string, any> | property-symbol-unresolved |
| src/shared/services/orderProductionRecordService.ts:18 | request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/orderProductionRecordService.ts:65 | request.business.orderText | Record<string, unknown> | property-symbol-unresolved |
| src/shared/services/orderProductionRecordService.ts:69 | priorData?.productionRecordReceipt | DocumentData \| undefined | property-symbol-unresolved |
| src/shared/services/orderProductionRecordService.ts:71 | receipt.requestHash | any | any-receiver |
| src/shared/services/orderProductionRecordService.ts:71 | receipt.generation | any | any-receiver |
| src/shared/services/orderProductionRecordService.ts:71 | receipt.recordIds | any | any-receiver |
| src/shared/services/orderProductionRecordService.ts:71 | receipt.recordIds.includes | any | any-receiver |
| src/shared/services/orderProductionRecordService.ts:71 | receipt.recordIds | any | any-receiver |
| src/features/admin/orderStockEngine.ts:146 | first.request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:504 | retained.request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:505 | retained.request.plan.attempt | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:507 | retained.request.plan.production | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:510 | retained.request.plan.productionDeltas | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:518 | retained?.request.plan.productLots | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:519 | retained?.request.plan.normalizedItems | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:519 | finalPlan?.completionPatch | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:520 | retained.request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:525 | applied.request.plan.production | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:527 | applied.request.plan.productionDeltas | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:529 | applied.request.plan.productLots | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:529 | applied.request.plan.bomLines | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:529 | applied.request.plan.shipmentDeltas | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:646 | retained.request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:647 | retained?.request.plan.normalizedItems | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:647 | completionPatch?.items | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:648 | retained.request.plan.finalPlan | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:656 | retained.request.plan.reservationDeltas | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:673 | retained.request.plan.finalPlan | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:820 | request.business.selection | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:821 | request.plan.finalPlan | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:826 | request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:832 | request.plan.lines | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:833 | request.plan.productionDeltas | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:833 | request.plan.shipmentDeltas | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:834 | payload.patch.status | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:835 | payload.patch.items | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:836 | payload.patch.items | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:836 | request.plan.normalizedItems | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:839 | request.plan.finalLotItemIds | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:841 | request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:842 | request.business.orderText | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:971 | retainedRaw.request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:977 | retainedRaw.request.plan.reservationDeltas | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:1005 | retained.request.plan.lines | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:1019 | retained?.request.plan.finalPlan | Record<string, unknown> \| undefined | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:1020 | retained.request.plan.productionRecords | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:1024 | result.request.plan.lines | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/orderStockEngine.ts:1084 | readOrderRawBatchAttempt(generation.companyId,generation.actorUid,id)?.request.plan.finalPlan | Record<string, unknown> \| undefined | property-symbol-unresolved |
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
| components/OfficeTalk.tsx:321 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:350 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:388 | error?.message | any | any-receiver |
| components/OfficeTalk.tsx:435 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:458 | err?.message | any | any-receiver |
| components/OfficeTalk.tsx:1220 | user.id | any | any-receiver |
| components/OfficeTalk.tsx:1221 | user.name | any | any-receiver |
| components/OfficeTalk.tsx:1228 | user.name | any | any-receiver |
| components/OfficeTalk.tsx:1229 | user.position | any | any-receiver |
| components/OfficeTalk.tsx:1229 | user.department | any | any-receiver |
| components/OfficeTalk.tsx:1390 | err?.message | any | any-receiver |
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
| components/ReceivingReturnsManager.tsx:272 | pendingSubmission?.request.partnerName | RequestBody \| undefined | property-symbol-unresolved |
| components/ReceivingReturnsManager.tsx:272 | pendingSubmission?.request.returnType | RequestBody \| undefined | property-symbol-unresolved |
| components/ReceivingReturnsManager.tsx:273 | pendingSubmission.request.totalAmount.toLocaleString | any | any-receiver |
| components/ReceivingReturnsManager.tsx:273 | pendingSubmission.request.totalAmount | RequestBody | property-symbol-unresolved |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | cache.request | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | cache.version | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.partnerId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.allocations.length | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.allocations[0].statementId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.allocations[0].amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.operationId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.releaseId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:13 | q.expectedRevision | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | cache.request | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | cache.version | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.partnerId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.direction | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.pin | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.allocations.length | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.allocations[0].statementId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.allocations[0].amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.operationId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.releaseId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.expectedRevision | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:15 | q.expectedRevision | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:16 | q.amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:16 | q.cashAccountId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:16 | q.tradeDate | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:16 | q.note | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:23 | state?.deleted | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:23 | state.copies | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:39 | JSON.parse(entry.paymentRequestText).note?.trim | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:39 | JSON.parse(entry.paymentRequestText).note | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:39 | JSON.parse(entry.paymentRequestText).operationId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:94 | q.tradeDate | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:94 | q.partnerId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:94 | q.direction | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:94 | q.amount | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:94 | q.cashAccountId | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:94 | q.pin | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:94 | q.allocations | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:94 | q.note | any | any-receiver |
| src/features/statements/infrastructure/tradeStatementRecoveryService.ts:95 | cache.fingerprint | any | any-receiver |
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
| components/TradeStatement.tsx:236 | (item as any).itemId | any | any-receiver |
| components/TradeStatement.tsx:238 | (item as any).partnerId | any | any-receiver |
| components/TradeStatement.tsx:300 | pi.Direction | any | any-receiver |
| components/TradeStatement.tsx:301 | pi.Direction | any | any-receiver |
| components/TradeStatement.tsx:388 | s.Direction | any | any-receiver |
| components/TradeStatement.tsx:388 | s.itemId | any | any-receiver |
| components/TradeStatement.tsx:388 | s.partnerId | any | any-receiver |
| components/TradeStatement.tsx:390 | s.Direction | any | any-receiver |
| components/TradeStatement.tsx:390 | s.itemId | any | any-receiver |
| components/TradeStatement.tsx:390 | s.partnerId | any | any-receiver |
| components/TradeStatement.tsx:405 | error?.message | any | any-receiver |
| components/TradeStatement.tsx:406 | error?.code | any | any-receiver |
| components/TradeStatement.tsx:760 | row.manual | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:760 | row.operationId | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:760 | row.returnOperationId | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:760 | row.transferOperationId | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:761 | row.issueOperationId | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:761 | row.serverOwned | Settlement & Record<string, unknown> | property-symbol-unresolved |
| components/TradeStatement.tsx:1253 | ((st as any).purchaseOrderIds ?? (st as any).confirmedProductIds ?? []).forEach | any | any-receiver |
| components/TradeStatement.tsx:1253 | (st as any).purchaseOrderIds | any | any-receiver |
| components/TradeStatement.tsx:1253 | (st as any).confirmedProductIds | any | any-receiver |
| components/TradeStatement.tsx:1284 | (s as any).itemId | any | any-receiver |
| components/TradeStatement.tsx:1286 | (ps as any).partnerId | any | any-receiver |
| components/TradeStatement.tsx:1695 | JSON.parse(entry.paymentRequestText).cashAccountId | any | any-receiver |
| components/TradeStatement.tsx:1698 | payment.amount | any | any-receiver |
| components/TradeStatement.tsx:1698 | payment.tradeDate | any | any-receiver |
| components/TradeStatement.tsx:1698 | payment.cashAccountId | any | any-receiver |
| components/TradeStatement.tsx:2029 | e?.message | any | any-receiver |
| components/TradeStatement.tsx:2047 | e?.message | any | any-receiver |
| components/TradeStatement.tsx:2236 | payment?.tradeDate | any | any-receiver |
| components/TradeStatement.tsx:2236 | payment.tradeDate | any | any-receiver |
| components/TradeStatement.tsx:2236 | payment?.amount | any | any-receiver |
| components/TradeStatement.tsx:2236 | payment.amount | any | any-receiver |
| components/TradeStatement.tsx:2236 | payment.amount.toLocaleString | any | any-receiver |
| components/TradeStatement.tsx:2236 | payment.amount | any | any-receiver |
| components/TradeStatement.tsx:2287 | payment.cashAccountId | any | any-receiver |
| components/TradeStatement.tsx:2287 | payment.amount | any | any-receiver |
| components/TradeStatement.tsx:2287 | payment.tradeDate | any | any-receiver |
| components/TradeStatement.tsx:2291 | first.statement | any | any-receiver |
| components/TradeStatement.tsx:2291 | statement.partnerName | any | any-receiver |
| components/TradeStatement.tsx:2291 | statement.tradeDate | any | any-receiver |
| components/TradeStatement.tsx:2291 | statement.totalAmount | any | any-receiver |
| components/TradeStatement.tsx:2291 | statement.docNo | any | any-receiver |
| components/TradeStatement.tsx:2291 | first.orderIds?.join | any | any-receiver |
| components/TradeStatement.tsx:2291 | first.orderIds | any | any-receiver |
| components/TradeStatement.tsx:2291 | first.poIds?.join | any | any-receiver |
| components/TradeStatement.tsx:2291 | first.poIds | any | any-receiver |
| components/TradeStatement.tsx:2291 | statement.items?.map | any | any-receiver |
| components/TradeStatement.tsx:2291 | statement.items | any | any-receiver |
| components/TradeStatement.tsx:2291 | statement.totalAmount | any | any-receiver |
| components/TradeStatement.tsx:2291 | statement.totalAmount | any | any-receiver |
| components/TradeStatement.tsx:2919 | error?.message | any | any-receiver |
| components/TradeStatement.tsx:3094 | (purchaseOrder as any).id | any | any-receiver |
| components/ProfitAnalysis.tsx:395 | payload?.length | any | any-receiver |
| components/ProfitAnalysis.tsx:399 | payload.map | any | any-receiver |
| components/ProfitAnalysis.tsx:400 | p.name | any | any-receiver |
| components/ProfitAnalysis.tsx:401 | p.color | any | any-receiver |
| components/ProfitAnalysis.tsx:402 | p.name | any | any-receiver |
| components/ProfitAnalysis.tsx:403 | p.value | any | any-receiver |
| components/ProfitAnalysis.tsx:594 | d.sales | any | any-receiver |
| components/ProfitAnalysis.tsx:594 | d.operatingProfit | any | any-receiver |
| components/ProfitAnalysis.tsx:594 | d.sales | any | any-receiver |
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
| src/features/admin/AdminApp.tsx:439 | e?.message | any | any-receiver |
| src/features/admin/AdminApp.tsx:663 | (pc as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:664 | (pc as any).partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1068 | e.data?.type | any | any-receiver |
| src/features/admin/AdminApp.tsx:1068 | e.data.view | any | any-receiver |
| src/features/admin/AdminApp.tsx:1068 | e.data.view | any | any-receiver |
| src/features/admin/AdminApp.tsx:1195 | (s as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1196 | (ps as any)?.partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1258 | (s as any).itemId | any | any-receiver |
| src/features/admin/AdminApp.tsx:1259 | (ps as any)?.partnerId | any | any-receiver |
| src/features/admin/AdminApp.tsx:2737 | patch.sortIndex | Record<string, unknown> | property-symbol-unresolved |
| src/features/admin/AdminApp.tsx:4783 | error?.message | any | any-receiver |
| src/features/admin/AdminApp.tsx:4793 | error?.message | any | any-receiver |
| src/features/admin/AdminApp.tsx:4986 | copySelected.request?.confirmed.orderDraft.partnerName | OrderInterpretationJsonObject \| undefined | property-symbol-unresolved |
| src/shared/components/AuthPage.tsx:34 | cause?.code | any | any-receiver |
| functions/src/newScopeCounter.ts:40 | gate.data()?.oemLotCutoverDate | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/newScopeCounter.ts:46 | row?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/newScopeCounter.ts:101 | lot.lotNo | any | any-receiver |
| functions/src/newScopeCounter.ts:102 | lot.material | any | any-receiver |
| functions/src/newScopeCounter.ts:102 | lot.material | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:23 | row.oemBatchCost?.feeStatementId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:23 | row.oemBatchCost?.previousConfirmed?.feeStatementId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:23 | row.oemBatchCost?.previousConfirmed | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:27 | cost.status | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:27 | cost.previousConfirmed | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:28 | (confirmed?.allocations ?? []).map | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:28 | confirmed?.allocations | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:28 | row.itemId | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:36 | cost.status | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:36 | cost.previousConfirmed | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:37 | (confirmed?.allocations ?? []).filter((row: Row) => row.kind === 'bulk').map | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:37 | (confirmed?.allocations ?? []).filter | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:37 | confirmed?.allocations | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:37 | row.kind | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:39 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:45 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:46 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:47 | po.data()!.oemReceivedBulk?.filter | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:47 | po.data()!.oemReceivedBulk | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:47 | po.data | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:47 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:47 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:47 | row.lotId | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:47 | allocation.lotId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:48 | allocation.itemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:48 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:48 | allocation.lotId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:48 | allocation.lotId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:49 | saved.length | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:49 | saved[0].kg | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:49 | allocation.kg | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:50 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:54 | item.data()!.lots.filter | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:54 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:54 | allocation.lotId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:55 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:55 | allocation.lotId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:56 | itemLots.length | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:56 | itemLots.length | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:57 | itemLots.some | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:57 | lot.poId | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:57 | po.id | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:57 | lot.kgIn | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:57 | allocation.kg | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:58 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:58 | lot.oemBatchCost.poId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:58 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:58 | po.id | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:58 | lot.oemBatchCost.feeStatementId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:58 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:59 | saved[0].appliedDeltaKg | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:59 | itemLots.length | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:66 | cost.status | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:66 | cost.previousConfirmed | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:77 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:77 | lot.oemBatchCost.feeStatementId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:77 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:78 | lot.oemBatchCost.poId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:78 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:79 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:80 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:80 | allocation.lotId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:80 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:80 | po.id | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:80 | lot.oemBatchCost.poId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:80 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:91 | state.data()![field].map | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:92 | allocation.rawItemId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:93 | allocation.lotId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:93 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:93 | po.id | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:93 | lot.oemBatchCost?.poId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:93 | lot.oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemBatchCostInvalidation.ts:93 | lot.oemBatchCost?.feeStatementId | any | any-receiver |
| functions/src/oemBatchCostInvalidation.ts:93 | lot.oemBatchCost | Row | property-symbol-unresolved |
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
| functions/src/statementIssueReceipt.ts:21 | copy.newPo | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:21 | copy.newPo | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:21 | copy.newPo | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:26 | command.statement?.id | any | any-receiver |
| functions/src/statementIssueReceipt.ts:26 | command.statement | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:27 | command.statement.id | any | any-receiver |
| functions/src/statementIssueReceipt.ts:27 | command.statement | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:27 | command.operationId | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:27 | command.statement.id | any | any-receiver |
| functions/src/statementIssueReceipt.ts:27 | command.statement | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:32 | command.operationId | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:32 | command.statement.id | any | any-receiver |
| functions/src/statementIssueReceipt.ts:32 | command.statement | { [x: string]: any; } | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:49 | row?.status | Row \| undefined | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:66 | row.status | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:66 | row.revision | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:66 | row.revision | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:78 | gate?.statementIssueProtocol | Row \| undefined | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:83 | protocol?.oldServerDrainConfirmedAt | any | any-receiver |
| functions/src/statementIssueReceipt.ts:84 | gate?.status | Row \| undefined | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:84 | gate.releaseId | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:84 | gate.releaseId | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:84 | protocol?.releaseId | any | any-receiver |
| functions/src/statementIssueReceipt.ts:84 | gate.releaseId | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:85 | gate.oldWritersBlocked | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:85 | gate.oldWritersBlockedEvidence | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:86 | gate.oldWritersBlockedEvidence | Row | property-symbol-unresolved |
| functions/src/statementIssueReceipt.ts:86 | protocol?.version | any | any-receiver |
| functions/src/statementIssueReceipt.ts:86 | protocol.status | any | any-receiver |
| functions/src/statementIssueReceipt.ts:87 | protocol.generation | any | any-receiver |
| functions/src/statementIssueReceipt.ts:87 | protocol.oldServerDrained | any | any-receiver |
| functions/src/statementIssueReceipt.ts:90 | protocol.writerEvidence | any | any-receiver |
| functions/src/statementIssueReceipt.ts:90 | evidence?.deployedAt | any | any-receiver |
| functions/src/statementIssueReceipt.ts:90 | evidence?.oldRevisionDrainedAt | any | any-receiver |
| functions/src/statementIssueReceipt.ts:91 | evidence?.generation | any | any-receiver |
| functions/src/statementIssueReceipt.ts:91 | evidence.evidence | any | any-receiver |
| functions/src/statementIssueReceipt.ts:91 | evidence.evidence.trim | any | any-receiver |
| functions/src/statementIssueReceipt.ts:91 | evidence.evidence | any | any-receiver |
| functions/src/partnerCutover.ts:3 | gate?.auditScope | Record<string, unknown> \| undefined | property-symbol-unresolved |
| functions/src/partnerCutover.ts:4 | gate.blockedPartnerIds | Record<string, unknown> | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:24 | row.companyId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:39 | row.noncashApplication | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:40 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:41 | row.items | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:41 | row.items | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:42 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:42 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:43 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:43 | item.supply | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:44 | item.tax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:44 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:45 | item.supply | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:46 | row.totalTax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:46 | row.totalTax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:46 | item.tax | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:47 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:50 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:52 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:53 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:58 | row.type | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:59 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:59 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:60 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:60 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:61 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:61 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:62 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:62 | item.total | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:64 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:64 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:65 | item.side | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:65 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:66 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:70 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:70 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:70 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:71 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:71 | row.tradeDate | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:72 | row.totalAmount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:76 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:77 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:77 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:77 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:84 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:90 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:128 | prior?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:142 | currentEntry?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:144 | row.companyId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:144 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:144 | row.date | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:144 | row.cashAccountId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:145 | row.dir | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:145 | row.amount | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:145 | row.lines | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:145 | row.note | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:146 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:146 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:146 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:147 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:147 | row.docNo | Row | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:157 | currentEntry?.issuePrefix | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:158 | currentEntry?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:158 | currentEntry?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:174 | cutoverSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:175 | cutoverSnap.data()?.enabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:175 | cutoverSnap.data()?.legacyWritersBlocked | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:176 | cutoverSnap.data()?.auditPassed | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:181 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:183 | accountSnap.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/partnerPaymentCommand.ts:205 | partnerSnap.data()?.name | DocumentData \| undefined | property-symbol-unresolved |
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
| functions/src/deleteIssuedStatementCommand.ts:76 | receipt.data()?.beforeSnapshot | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:77 | row.companyId | any | any-receiver |
| functions/src/deleteIssuedStatementCommand.ts:77 | row.partnerId | any | any-receiver |
| functions/src/deleteIssuedStatementCommand.ts:100 | prior.data()?.beforeSnapshot?.partnerId | any | any-receiver |
| functions/src/deleteIssuedStatementCommand.ts:100 | prior.data()?.beforeSnapshot | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:142 | row.data.companyId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:142 | row.data.linkedStatementId | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:142 | row.data.linkedStatementAt | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:142 | row.data.linkedStatementAt | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:142 | row.statement.id | Row | property-symbol-unresolved |
| functions/src/deleteIssuedStatementCommand.ts:155 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:46 | document.companyId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:46 | document.companyId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:49 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:49 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:49 | document.amount | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:54 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:54 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:55 | document.accountCode | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:55 | line.accountCode | any | any-receiver |
| functions/src/voucherIssue.ts:81 | document.accountCode | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:82 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:82 | document.lines | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:82 | line?.accountCode | any | any-receiver |
| functions/src/voucherIssue.ts:96 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:96 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:96 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:97 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:98 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:98 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:98 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:99 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:100 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:112 | row.mutationRevision | Record<string, any> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:114 | row.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:114 | row.issueOperationId | Record<string, any> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:115 | row.issuePrefix | Record<string, any> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:115 | row.issuePrefix | Record<string, any> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:115 | row.issuePayloadHash | Record<string, any> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:116 | row.docNo | Record<string, any> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:116 | row.docNo | Record<string, any> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:119 | existing.data()?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:121 | original.docNo | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:125 | deleted.docNo | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:131 | original.docNo | Row | property-symbol-unresolved |
| functions/src/voucherIssue.ts:155 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:155 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:155 | document.cashAccountId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:157 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:157 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:157 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:162 | account.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:162 | account.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:164 | partner.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:166 | cutover.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:166 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:168 | partner.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:168 | partner.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:169 | partner.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:171 | state.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:171 | state.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:172 | state.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:173 | state.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:173 | state.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:173 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:189 | document.partnerId | Record<string, unknown> | property-symbol-unresolved |
| functions/src/voucherIssue.ts:189 | partnerState.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:192 | cashPartner.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:204 | request.auth?.token.companyId | DecodedIdToken \| undefined | property-symbol-unresolved |
| functions/src/voucherIssue.ts:209 | request.data?.releaseId | any | any-receiver |
| functions/src/loanMovementCommand.ts:21 | row.companyId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:65 | prior?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:76 | stored?.mutationRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:78 | row.companyId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:78 | row.loanId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:78 | row.date | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:79 | row.cashAccountId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:79 | row.dir | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:79 | row.amount | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:80 | row.accountCode | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:80 | row.lines | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:80 | row.note | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:81 | row.loanId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:81 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:81 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:82 | row.docNo | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:90 | stored?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:90 | stored?.issueOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:99 | cutoverSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:100 | cutoverSnap.data()?.enabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:100 | cutoverSnap.data()?.legacyWritersBlocked | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:101 | cutoverSnap.data()?.auditPassed | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:110 | accountSnap.data()?.active | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:110 | accountSnap.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:121 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:121 | line.amount | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:121 | line.side | Row | property-symbol-unresolved |
| functions/src/loanMovementCommand.ts:196 | template.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
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
| functions/src/tradeStatementIssue.ts:30 | row.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:35 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:41 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:44 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:44 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:45 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:45 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:45 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:46 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:52 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:100 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:100 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:101 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:102 | raw.tradeDate | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:106 | raw.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:106 | raw.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:107 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:107 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:108 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:108 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:110 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:112 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:115 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:115 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:115 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:116 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:116 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:117 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:117 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:117 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:117 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:118 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:118 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:119 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:119 | line.price | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:120 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:121 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:121 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:121 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:123 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:123 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:126 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:126 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:126 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:127 | line.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:127 | line.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:127 | raw.items.indexOf | any | any-receiver |
| functions/src/tradeStatementIssue.ts:127 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:128 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:128 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:132 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:132 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:132 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:133 | kgLines.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:133 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:133 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:133 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:134 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:134 | line.purchaseQuantityKg | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:134 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:136 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:137 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:137 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:137 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:137 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:137 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:137 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:138 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:138 | item.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:138 | item.isBox | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:140 | item.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:141 | line.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:145 | raw.items.reduce | any | any-receiver |
| functions/src/tradeStatementIssue.ts:145 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:145 | line.supply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:145 | line.tax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:145 | line.total | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:146 | raw.totalSupply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:146 | raw.totalTax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:146 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:147 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:147 | sums.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:147 | raw.totalSupply | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:147 | raw.totalTax | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:147 | raw.totalAmount | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:148 | raw.orderId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:149 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:150 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:150 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:150 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:152 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:153 | line.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:154 | raw.items.map((row:Row,index:number)=>row.itemId===cost.itemId && readPurchaseUnitSnapshot(row)?index:-1).filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:154 | raw.items.map | any | any-receiver |
| functions/src/tradeStatementIssue.ts:154 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:154 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:157 | raw.items.map((row:Row,index:number)=>row.itemId===cost.itemId?index:-1).filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:157 | raw.items.map | any | any-receiver |
| functions/src/tradeStatementIssue.ts:157 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:157 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:160 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:162 | allUnitIndexes.length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:162 | raw.items.filter((row:Row)=>row.itemId===cost.itemId).length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:162 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:162 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:162 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:162 | line.purchaseQuantityKg | any | any-receiver |
| functions/src/tradeStatementIssue.ts:163 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:163 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:163 | candidate.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:168 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:169 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:172 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:176 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:178 | line.purchaseUnitId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:180 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:187 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:194 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:195 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:215 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:216 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:216 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:217 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:217 | row.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:218 | row.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:218 | row.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:218 | row.issueVoucherNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:218 | row.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:219 | deleted.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:219 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:219 | deleted.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:222 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:223 | original.companyId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:223 | original.issueOperationId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:224 | original.issuePrefix | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:224 | original.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:225 | original.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:226 | original.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:226 | original.docNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:226 | original.issueVoucherNo | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:232 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:233 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:237 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:239 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:247 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:251 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:264 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:264 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:269 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:270 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:270 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:270 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:270 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:270 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:270 | row.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:271 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:271 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:271 | raw.items[row.sourceLineIndex]?.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:271 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:271 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:271 | row.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:272 | raw.items[row.sourceLineIndex]?.qty | any | any-receiver |
| functions/src/tradeStatementIssue.ts:272 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:272 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:272 | row.quantity | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:272 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:272 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:273 | matching.length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:273 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:273 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:273 | matching[0].sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:274 | matching.length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:278 | po.data()?.items | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:278 | po.data()?.itemId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:278 | po.data()?.quantity | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:280 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:281 | raw.items.filter | any | any-receiver |
| functions/src/tradeStatementIssue.ts:281 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:281 | line.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:281 | row.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:281 | line.qty | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:281 | row.quantity | any | any-receiver |
| functions/src/tradeStatementIssue.ts:282 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:282 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:282 | raw.items[row.sourceLineIndex]?.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:282 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:282 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:282 | row.itemId | any | any-receiver |
| functions/src/tradeStatementIssue.ts:283 | raw.items[row.sourceLineIndex]?.qty | any | any-receiver |
| functions/src/tradeStatementIssue.ts:283 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:283 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:283 | row.quantity | any | any-receiver |
| functions/src/tradeStatementIssue.ts:283 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:283 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:284 | matching.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:285 | matching.length | any | any-receiver |
| functions/src/tradeStatementIssue.ts:285 | row.sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:285 | matching[0].sourceLineIndex | any | any-receiver |
| functions/src/tradeStatementIssue.ts:291 | raw.items.some | any | any-receiver |
| functions/src/tradeStatementIssue.ts:291 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:291 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:294 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:297 | raw.type | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:297 | snap.data()?.purpose | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:300 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:305 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:315 | item.itemId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:316 | item.itemName | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:316 | item.unit | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:322 | raw.items[costUpdates[i].sourceLineIndex].purchaseQuantityKg | any | any-receiver |
| functions/src/tradeStatementIssue.ts:322 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:323 | raw.items | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:340 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:342 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:343 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:346 | raw.partnerId | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:346 | raw.partnerName | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:348 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:350 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:354 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:357 | raw.id | Row | property-symbol-unresolved |
| functions/src/tradeStatementIssue.ts:362 | raw.id | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:14 | row.failureCode | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:14 | row.failureMessage | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:14 | row.failureMessage | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:24 | capturedCommand?.statement.companyId | any | any-receiver |
| functions/src/inspectTradeStatementCommand.ts:24 | capturedCommand?.statement | Row \| undefined | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:33 | capturedPayment.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:34 | capturedPayment.note | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:34 | capturedPayment.note | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:35 | capturedPayment.allocations | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:35 | capturedPayment.allocations | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:35 | row.statementId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:41 | payment.partnerId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:41 | payment.allocations.some | any | any-receiver |
| functions/src/inspectTradeStatementCommand.ts:41 | payment.allocations | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:41 | row.statementId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:42 | payment.partnerId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:45 | request.note?.trim | any | any-receiver |
| functions/src/inspectTradeStatementCommand.ts:45 | request.note | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:46 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:47 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:48 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:49 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:52 | request.partnerId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:54 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:55 | proof.status | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:55 | proof.reason | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:56 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:57 | row.companyId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:57 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:57 | request.partnerId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:58 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:58 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:58 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:59 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:59 | row.docNo | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:60 | row.companyId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:60 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:60 | row.date | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:60 | row.cashAccountId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:61 | row.dir | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:61 | row.amount | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:61 | row.lines | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:61 | row.note | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:63 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:67 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:67 | row.statementId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:68 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:69 | row.statementId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:69 | row.amount | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:71 | proof.status | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:71 | proof.cashEntryId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:71 | request.operationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:71 | proof.docNo | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:71 | proof.reason | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:75 | result.payment | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:100 | command?.statement.companyId | any | any-receiver |
| functions/src/inspectTradeStatementCommand.ts:100 | command?.statement | Row \| undefined | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:106 | result.serverRequestText | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:110 | payment.partnerId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:110 | command.statement.partnerId | any | any-receiver |
| functions/src/inspectTradeStatementCommand.ts:110 | command.statement | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:124 | result.status | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:124 | result.reason | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:125 | result.rejection | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:132 | row.companyId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:133 | row.issueOperationId | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:133 | row.issuePrefix | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:134 | row.issuePayloadHash | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:134 | row.issueStatementHash | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:135 | row.docNo | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:135 | row.issueVoucherNo | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:137 | result.status | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:137 | result.currentStatement | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:137 | result.reason | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:142 | result.status | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:142 | result.currentStatement | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:143 | result.statement | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:144 | result.reason | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:144 | result.currentStatement | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:146 | result.status | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:146 | result.docNo | Row | property-symbol-unresolved |
| functions/src/inspectTradeStatementCommand.ts:150 | command.statement.partnerId | any | any-receiver |
| functions/src/inspectTradeStatementCommand.ts:150 | command.statement | Row | property-symbol-unresolved |
| functions/src/cancelTradeStatementCommand.ts:21 | row?.requestHash | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cancelTradeStatementCommand.ts:21 | row?.requestText | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cancelTradeStatementCommand.ts:22 | row?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cancelTradeStatementCommand.ts:31 | row?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cancelTradeStatementCommand.ts:35 | row?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/cancelTradeStatementCommand.ts:43 | result.needsInspection | Row | property-symbol-unresolved |
| functions/src/cancelTradeStatementCommand.ts:45 | inspected.status | Row | property-symbol-unresolved |
| functions/src/cancelTradeStatementCommand.ts:47 | result.needsInspection | Row | property-symbol-unresolved |
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
| functions/src/editIssuedStatementCommand.ts:76 | editSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:76 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:82 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:88 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:89 | editSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:89 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:96 | patch.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:100 | patch.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:106 | next.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:107 | next.totalSupply | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:107 | next.totalTax | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:108 | next.totalAmount | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:113 | patch.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:113 | (old.items ?? []).some | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:114 | next.items | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:116 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:117 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:117 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:118 | oldLines[line.sourceLineIndex]?.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:118 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:118 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:120 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:122 | row.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:122 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:130 | line.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:132 | line.purchaseQuantityKg | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:132 | line.purchaseQuantityKg | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:134 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:139 | matching.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:139 | previous.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:139 | matching.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:144 | next.type | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:148 | line.purchaseUnitId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:149 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:151 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:158 | rows.filter((row: Record<string, any>) => row.itemId === line.itemId && (row.sourceLineIndex !== undefined ? row.sourceLineIndex === sourceIndex : oldLines.filter(entry=>entry.itemId===line.itemId).length===1)).map | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:158 | rows.filter | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:158 | row.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:158 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:158 | row.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:158 | row.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:158 | entry.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:158 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:161 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:162 | row.data().items?.some | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:162 | item.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:162 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:162 | item.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:162 | item.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:164 | po.data().status | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:164 | po.data | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:169 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:172 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:176 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:176 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:176 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:180 | row.quantity | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:180 | previous.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:182 | po.ref.path | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:182 | po.ref | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:183 | po.ref | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:183 | rows.map | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:184 | entry.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:184 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:184 | entry.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:184 | entry.sourceLineIndex | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:184 | oldLine.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:184 | line.itemId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:184 | line.qty | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:190 | next.totalAmount | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:190 | next.totalAmount | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:194 | claims.employeeId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:195 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:198 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:200 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:201 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:203 | next.tradeDate | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:208 | row.id | Row | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:233 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:233 | next.partnerId | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:233 | next.partnerName | any | any-receiver |
| functions/src/editIssuedStatementCommand.ts:234 | claims.employeeId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:236 | claims.employeeId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:237 | claims.companyId | Record<string, any> | property-symbol-unresolved |
| functions/src/editIssuedStatementCommand.ts:238 | row.statement.id | Row | property-symbol-unresolved |
| functions/src/employeeLogin.ts:23 | request.data?.username | any | any-receiver |
| functions/src/employeeLogin.ts:24 | request.data?.password | any | any-receiver |
| functions/src/employeeLogin.ts:25 | request.data?.app | any | any-receiver |
| functions/src/employeeLogin.ts:26 | request.data?.companyId | any | any-receiver |
| functions/src/employeeLogin.ts:46 | employee?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:48 | employee?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:50 | employee?.adminAccess | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:51 | employee?.passwordHash | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/employeeLogin.ts:80 | error?.code | any | any-receiver |
| functions/src/oemFeeVoucher.ts:16 | row.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:48 | stmt.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:48 | stmt.orderId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:48 | stmt.type | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:49 | stmt.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:49 | stmt.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:50 | stmt.tradeDate | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:54 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:54 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:54 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:55 | line.qty | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.qty | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.price | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:56 | line.price | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:57 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:58 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:59 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:60 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:60 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:60 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | stmt.items.reduce | any | any-receiver |
| functions/src/oemFeeVoucher.ts:61 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | line.supply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | line.tax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:61 | line.total | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:62 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:63 | sums.some | any | any-receiver |
| functions/src/oemFeeVoucher.ts:63 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:63 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:63 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:64 | stmt.items.every | any | any-receiver |
| functions/src/oemFeeVoucher.ts:64 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:64 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:65 | stmt.items.every | any | any-receiver |
| functions/src/oemFeeVoucher.ts:65 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:65 | line.isTaxExempt | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:105 | stmt.partnerId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:111 | stmt.totalAmount | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:112 | (po.items ?? []).filter | any | any-receiver |
| functions/src/oemFeeVoucher.ts:112 | item.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:113 | (po.oemReceivedBulk ?? []).filter | any | any-receiver |
| functions/src/oemFeeVoucher.ts:113 | item.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:121 | receiptData?.bulkReceipts | Row \| undefined | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:122 | receiptData.companyId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:122 | receiptData.poId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:123 | receiptData.bulkEvidenceHash | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:125 | proof.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:125 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:125 | proof.lotId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:125 | row.lotId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | row.lotId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | row.operationId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | proof.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:127 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:128 | proof.material | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:128 | row.material | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:128 | proof.command?.materialSnapshot | any | any-receiver |
| functions/src/oemFeeVoucher.ts:128 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:128 | row.material | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:129 | proof.commandHash | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:129 | row.commandHash | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:129 | proof.operationId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:129 | row.operationId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:130 | proof.reportedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:130 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:130 | proof.appliedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:130 | row.appliedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:131 | proof.status | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:131 | row.status | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:131 | proof.status | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:132 | proof.command?.companyId | any | any-receiver |
| functions/src/oemFeeVoucher.ts:132 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:132 | proof.command?.rawItemId | any | any-receiver |
| functions/src/oemFeeVoucher.ts:132 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:132 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:133 | proof.command?.kind | any | any-receiver |
| functions/src/oemFeeVoucher.ts:133 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:133 | proof.command?.kg | any | any-receiver |
| functions/src/oemFeeVoucher.ts:133 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:133 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:134 | proof.command?.operationId | any | any-receiver |
| functions/src/oemFeeVoucher.ts:134 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:134 | row.operationId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:134 | proof.command?.source?.id | any | any-receiver |
| functions/src/oemFeeVoucher.ts:134 | proof.command?.source | any | any-receiver |
| functions/src/oemFeeVoucher.ts:134 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:134 | proof.command?.source?.type | any | any-receiver |
| functions/src/oemFeeVoucher.ts:134 | proof.command?.source | any | any-receiver |
| functions/src/oemFeeVoucher.ts:134 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:135 | proof.command | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:135 | row.commandHash | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:136 | row.operationId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:137 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:138 | proof.movement.companyId | any | any-receiver |
| functions/src/oemFeeVoucher.ts:138 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:138 | proof.movement.rawItemId | any | any-receiver |
| functions/src/oemFeeVoucher.ts:138 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:138 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:139 | proof.movement.operationId | any | any-receiver |
| functions/src/oemFeeVoucher.ts:139 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:139 | row.operationId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:139 | proof.movement.commandHash | any | any-receiver |
| functions/src/oemFeeVoucher.ts:139 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:139 | row.commandHash | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:140 | proof.movement.kind | any | any-receiver |
| functions/src/oemFeeVoucher.ts:140 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:140 | proof.movement.materialSnapshot | any | any-receiver |
| functions/src/oemFeeVoucher.ts:140 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:140 | row.material | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:141 | proof.movement.source?.type | any | any-receiver |
| functions/src/oemFeeVoucher.ts:141 | proof.movement.source | any | any-receiver |
| functions/src/oemFeeVoucher.ts:141 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:141 | proof.movement.source?.id | any | any-receiver |
| functions/src/oemFeeVoucher.ts:141 | proof.movement.source | any | any-receiver |
| functions/src/oemFeeVoucher.ts:141 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:142 | proof.movement.reportedDeltaKg | any | any-receiver |
| functions/src/oemFeeVoucher.ts:142 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:142 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:142 | proof.movement.appliedDeltaKg | any | any-receiver |
| functions/src/oemFeeVoucher.ts:142 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:142 | row.appliedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:143 | row.appliedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:143 | row.appliedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:143 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:144 | row.appliedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:144 | row.status | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:144 | proof.movement.backdatedBeforeStocktake | any | any-receiver |
| functions/src/oemFeeVoucher.ts:144 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:144 | row.status | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:146 | row.appliedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:146 | proof.movement.lotChanges?.some | any | any-receiver |
| functions/src/oemFeeVoucher.ts:146 | proof.movement.lotChanges | any | any-receiver |
| functions/src/oemFeeVoucher.ts:146 | proof.movement | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:146 | change.lotId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:146 | row.lotId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:147 | change.deltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:147 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:147 | change.lotSnapshot?.poId | any | any-receiver |
| functions/src/oemFeeVoucher.ts:147 | change.lotSnapshot | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:148 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:149 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:150 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:152 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:154 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:159 | item.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:160 | item.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:173 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:173 | poItem.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:174 | po.oemBatchCost.rows.find | any | any-receiver |
| functions/src/oemFeeVoucher.ts:174 | po.oemBatchCost.rows | any | any-receiver |
| functions/src/oemFeeVoucher.ts:174 | row.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:174 | poItem.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:175 | matches[0].poId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:175 | matches[0].qtyIn | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:175 | poItem.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:175 | matches[0].kgIn | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:175 | row.kg | any | any-receiver |
| functions/src/oemFeeVoucher.ts:179 | children.get(row.child_id)?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:182 | poItem.itemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:185 | poItem.name | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:185 | poItem.unit | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:185 | poItem.quantity | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:187 | (po.oemSent ?? []).reduce | any | any-receiver |
| functions/src/oemFeeVoucher.ts:187 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:191 | row.material | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:191 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:193 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:194 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:195 | stmt.totalTax | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:199 | stmt.items.some | any | any-receiver |
| functions/src/oemFeeVoucher.ts:199 | stmt.items | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:199 | line.accountCode | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:206 | po.oemBatchCost?.status | any | any-receiver |
| functions/src/oemFeeVoucher.ts:206 | po.oemBatchCost.reason | any | any-receiver |
| functions/src/oemFeeVoucher.ts:210 | stored.rows | any | any-receiver |
| functions/src/oemFeeVoucher.ts:213 | stmt.totalSupply | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:220 | row.rawItemId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:220 | row.lotId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:222 | saved.kg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:226 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:227 | lot.id | any | any-receiver |
| functions/src/oemFeeVoucher.ts:236 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:237 | lot.poId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:237 | lot.kgIn | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:238 | lot.kgRemaining | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:238 | lot.kgRemaining | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:238 | lot.kgRemaining | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:239 | saved.appliedDeltaKg | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:242 | matches[0].oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:243 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:253 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:254 | matches[0].poId | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:254 | matches[0].kgIn | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:256 | matches[0].oemBatchCost | Row | property-symbol-unresolved |
| functions/src/oemFeeVoucher.ts:257 | lot.id | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:28 | row.companyId | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:49 | item.packageKg | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:49 | item.spec | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:49 | item.name | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:49 | item.spec | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:52 | lot.qtyRemaining | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:52 | lot.status | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:88 | gate.data()?.oemLotCutoverDate | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:149 | row.item.rawMaterialName | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:172 | children.get(row.child_id)?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:196 | row.kg | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:218 | candidate.id | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:219 | lot.lotNo | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:219 | lot.qtyIn | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:220 | lot.material | Row | property-symbol-unresolved |
| functions/src/oemReceiptCommand.ts:228 | po.oemBatchCost?.status | any | any-receiver |
| functions/src/oemReceiptCommand.ts:229 | po.oemBatchCost.feeStatementId | any | any-receiver |
| functions/src/oemReceiptCommand.ts:233 | po.oemBatchCost?.status | any | any-receiver |
| functions/src/oemReceiptCommand.ts:233 | po.oemBatchCost.reason | any | any-receiver |
| functions/src/oemReceiptCommand.ts:234 | po.oemBatchCost.previousConfirmed | any | any-receiver |
| functions/src/oemReceiptCommand.ts:235 | previous.feeStatementId | any | any-receiver |
| functions/src/oemReceiptCommand.ts:235 | previous.feeSupplyAmount | any | any-receiver |
| functions/src/oemReceiptCommand.ts:267 | existing.id | Row | property-symbol-unresolved |
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
| functions/src/processReturnCommand.ts:71 | opSnap.data()?.status | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:92 | requestSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:125 | saved?.docNo | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:126 | saved?.returnOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:128 | snap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:129 | snap.data()?.partnerId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:129 | snap.data()?.statementId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:130 | snap.data()?.amount | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:130 | snap.data()?.operationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:134 | expected.id | any | any-receiver |
| functions/src/processReturnCommand.ts:135 | receipt.data()?.returnOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:136 | receipt.data()?.returnReceiptFingerprint | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:136 | expected.fingerprint | any | any-receiver |
| functions/src/processReturnCommand.ts:137 | receipt.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:137 | receipt.data()?.itemId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:137 | expected.itemId | any | any-receiver |
| functions/src/processReturnCommand.ts:138 | receipt.data()?.quantity | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:138 | expected.quantity | any | any-receiver |
| functions/src/processReturnCommand.ts:139 | expected.receiptHash | any | any-receiver |
| functions/src/processReturnCommand.ts:145 | expected.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:145 | expected.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:146 | expected.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:147 | movement.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:148 | movement.data()?.returnOperationId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:149 | expected.movementHash | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:151 | sourceSnap?.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:152 | row.requestItemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:153 | request.items.length | any | any-receiver |
| functions/src/processReturnCommand.ts:155 | row.itemId | any | any-receiver |
| functions/src/processReturnCommand.ts:155 | row.sourceLineIndex | any | any-receiver |
| functions/src/processReturnCommand.ts:155 | request.items.length | any | any-receiver |
| functions/src/processReturnCommand.ts:156 | row.companyId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:157 | row.partnerId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:157 | row.operationId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | row.quantityDelta | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | request.items.find((item: Row) => item.itemId === row.itemId && (row.sourceLineIndex !== undefined && rawMovements.some(raw=>raw.id===row.id) && sourceSnap?.exists               ? resolveReturnSourceLine<Row>(sourceSnap.data()!.items,{itemId:item.itemId,sourceLineIndex:item.sourceLineIndex}).index === row.sourceLineIndex               : item.sourceLineIndex === row.sourceLineIndex))?.quantity | any | any-receiver |
| functions/src/processReturnCommand.ts:158 | request.items.find | any | any-receiver |
| functions/src/processReturnCommand.ts:158 | item.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | row.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | raw.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:158 | row.id | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:159 | item.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:159 | item.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:159 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:160 | item.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:160 | row.sourceLineIndex | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:161 | row.date | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:166 | sourceSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:166 | sourceSnap.data()?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:167 | partnerSnap.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:171 | gate?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:180 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:184 | source?.type | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:185 | cutoverSnap.data()?.purchaseGeneralStockEnabled | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:190 | request.items.some | any | any-receiver |
| functions/src/processReturnCommand.ts:190 | item.itemId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:191 | request.items.some | any | any-receiver |
| functions/src/processReturnCommand.ts:191 | item.accountCode | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:194 | request.items.length | any | any-receiver |
| functions/src/processReturnCommand.ts:195 | request.items.filter((item: Row) => item.isResellable).length | any | any-receiver |
| functions/src/processReturnCommand.ts:195 | request.items.filter | any | any-receiver |
| functions/src/processReturnCommand.ts:195 | item.isResellable | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:234 | (app as Row).returnRequestId | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:272 | sourceLine!.qty | Row | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:284 | itemDocs.get(doc.data().child_id)?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/processReturnCommand.ts:366 | row.statement.id | Row | property-symbol-unresolved |
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
| functions/src/inventoryOpeningCommand.ts:18 | row.companyId | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:25 | actor.token.isAdmin | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:25 | actor.token.companyId | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:25 | actor.token.companyId | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:40 | item.type | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:40 | item.archived | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:40 | item.phantom | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:51 | item.stock | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:51 | (item.lots ?? []).some | any | any-receiver |
| functions/src/inventoryOpeningCommand.ts:51 | item.lots | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:51 | lot.qtyRemaining | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:51 | lot.kgRemaining | Row | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:51 | (item.stocktakeAnchors ?? []).length | any | any-receiver |
| functions/src/inventoryOpeningCommand.ts:51 | item.stocktakeAnchors | Row & { id: string; name: string; } | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:56 | stateSnap.data()?.stockKg | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/inventoryOpeningCommand.ts:56 | stateSnap.data()?.revision | DocumentData \| undefined | property-symbol-unresolved |
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
| functions/src/orderLockRecovery.ts:33 | saved.cancellation?.action | any | any-receiver |
| functions/src/orderLockRecovery.ts:33 | saved.cancellation?.evidence | any | any-receiver |
| functions/src/orderRequestRetirement.ts:17 | request.plan | any | any-receiver |
| functions/src/orderRequestRetirement.ts:18 | request.commands | any | any-receiver |
| functions/src/orderRequestRetirement.ts:20 | row?.itemId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:22 | plan.finalLotItemIds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:22 | plan.finalLotItemIds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:22 | plan.finalLotItemIds.forEach | any | any-receiver |
| functions/src/orderRequestRetirement.ts:22 | plan.finalLotItemIds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:23 | lots?.mutationItemIds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:23 | lots.mutationItemIds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:23 | lots.mutationItemIds.forEach | any | any-receiver |
| functions/src/orderRequestRetirement.ts:23 | lots.mutationItemIds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:24 | plan.productLots | any | any-receiver |
| functions/src/orderRequestRetirement.ts:25 | plan.lines | any | any-receiver |
| functions/src/orderRequestRetirement.ts:25 | plan.lines | any | any-receiver |
| functions/src/orderRequestRetirement.ts:25 | plan.lines | any | any-receiver |
| functions/src/orderRequestRetirement.ts:25 | row.rowDeltas | any | any-receiver |
| functions/src/orderRequestRetirement.ts:25 | row.productLots | any | any-receiver |
| functions/src/orderRequestRetirement.ts:26 | plan.finalPlan?.reservation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:26 | plan.finalPlan | any | any-receiver |
| functions/src/orderRequestRetirement.ts:28 | plan.productionRecords?.records | any | any-receiver |
| functions/src/orderRequestRetirement.ts:28 | plan.productionRecords | any | any-receiver |
| functions/src/orderRequestRetirement.ts:28 | plan.productionRecords.records | any | any-receiver |
| functions/src/orderRequestRetirement.ts:28 | plan.productionRecords | any | any-receiver |
| functions/src/orderRequestRetirement.ts:28 | plan.productionRecords.records | any | any-receiver |
| functions/src/orderRequestRetirement.ts:28 | plan.productionRecords | any | any-receiver |
| functions/src/orderRequestRetirement.ts:28 | row.itemId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | request.commands | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | row?.command | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.companyId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | request.generation.companyId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | request.generation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.rawItemId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.kind | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.source?.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.source | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | request.generation.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | request.generation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.kg | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.kg | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.rawItemId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:29 | command.rawItemId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:33 | advanceInventoryWriterProtocol(row,{}).inventoryWriteRevision | Row | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:34 | row.companyId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:42 | request?.generation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | request.version | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.contractVersion | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.companyId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.actorUid | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.operationId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.startedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.actorUid | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.orderId.includes | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:43 | g.startedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:44 | g.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:44 | g.operationId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:44 | g.startedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:45 | g.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:50 | g.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:50 | g.operationId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:50 | g.startedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:55 | order.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:58 | g.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:60 | order.data()?.retirementClaimPending | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:60 | order.data()?.inventoryOperation | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:61 | order.data()?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:69 | live?.companyId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:72 | g.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:75 | a.expectedOrderVersion.seconds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:75 | a.expectedOrderVersion.nanoseconds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:81 | t?.deletionRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:81 | t?.lastDeletedItemRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:83 | state.data()?.rawItemId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:85 | row.existed | any | any-receiver |
| functions/src/orderRequestRetirement.ts:85 | row.collection | any | any-receiver |
| functions/src/orderRequestRetirement.ts:85 | row.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:85 | row.revision | any | any-receiver |
| functions/src/orderRequestRetirement.ts:87 | g.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:100 | order.inventoryGenerationCompletion | any | any-receiver |
| functions/src/orderRequestRetirement.ts:102 | marker.requestText | any | any-receiver |
| functions/src/orderRequestRetirement.ts:103 | order.inventoryOperation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:103 | marker.generation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:103 | request.generation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:104 | marker.requestText | any | any-receiver |
| functions/src/orderRequestRetirement.ts:104 | request.deltas | any | any-receiver |
| functions/src/orderRequestRetirement.ts:104 | request.deltas.every | any | any-receiver |
| functions/src/orderRequestRetirement.ts:104 | request.deltas | any | any-receiver |
| functions/src/orderRequestRetirement.ts:105 | request.lotItemIds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:105 | request.lotItemIds.every | any | any-receiver |
| functions/src/orderRequestRetirement.ts:105 | request.lotItemIds | any | any-receiver |
| functions/src/orderRequestRetirement.ts:105 | request.patch | any | any-receiver |
| functions/src/orderRequestRetirement.ts:105 | request.patch | any | any-receiver |
| functions/src/orderRequestRetirement.ts:105 | request.patch | any | any-receiver |
| functions/src/orderRequestRetirement.ts:106 | marker.consumedLots | any | any-receiver |
| functions/src/orderRequestRetirement.ts:106 | marker.consumedLots.every | any | any-receiver |
| functions/src/orderRequestRetirement.ts:106 | marker.consumedLots | any | any-receiver |
| functions/src/orderRequestRetirement.ts:106 | row.itemId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:106 | row.lotId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:106 | row.qty | any | any-receiver |
| functions/src/orderRequestRetirement.ts:106 | row.qty | any | any-receiver |
| functions/src/orderRequestRetirement.ts:107 | marker.consumedLots | any | any-receiver |
| functions/src/orderRequestRetirement.ts:107 | marker.consumedLotsText | any | any-receiver |
| functions/src/orderRequestRetirement.ts:107 | marker.completedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:107 | marker.completedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:113 | request?.operation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:114 | request.version | any | any-receiver |
| functions/src/orderRequestRetirement.ts:114 | request.companyId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:114 | request.actorUid | any | any-receiver |
| functions/src/orderRequestRetirement.ts:114 | request.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:114 | request.retirementId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:114 | request.orderText | any | any-receiver |
| functions/src/orderRequestRetirement.ts:114 | request.expectedStatus | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.contractVersion | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.productionRecordContractVersion | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.actorUid | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.startedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.startedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.state | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.kind | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.kind | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.lineId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.actor | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.actor.trim | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.actor | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.targetStatus | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.targetStatus | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.stage | any | any-receiver |
| functions/src/orderRequestRetirement.ts:115 | op.stage | any | any-receiver |
| functions/src/orderRequestRetirement.ts:117 | request.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:117 | op.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:117 | op.startedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:118 | request.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:118 | request.retirementId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:122 | request.retirementId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:122 | request.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:122 | request.retirementId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:122 | saved.generation?.operationId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:122 | op.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:123 | request.retirementId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:123 | request.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:125 | saved.firstClaim.requestText | any | any-receiver |
| functions/src/orderRequestRetirement.ts:125 | saved.firstClaim.requestHash | any | any-receiver |
| functions/src/orderRequestRetirement.ts:125 | op.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:125 | saved.firstClaim.generation | any | any-receiver |
| functions/src/orderRequestRetirement.ts:127 | current?.contractVersion | any | any-receiver |
| functions/src/orderRequestRetirement.ts:127 | request.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:127 | current.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:127 | current.startedAt | any | any-receiver |
| functions/src/orderRequestRetirement.ts:127 | current.actorUid | any | any-receiver |
| functions/src/orderRequestRetirement.ts:128 | current.state | any | any-receiver |
| functions/src/orderRequestRetirement.ts:132 | request.expectedStatus | any | any-receiver |
| functions/src/orderRequestRetirement.ts:132 | request.orderId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:132 | request.orderText | any | any-receiver |
| functions/src/orderRequestRetirement.ts:135 | row.collection | any | any-receiver |
| functions/src/orderRequestRetirement.ts:135 | row.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:136 | row.collection | any | any-receiver |
| functions/src/orderRequestRetirement.ts:136 | row.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:137 | row.collection | any | any-receiver |
| functions/src/orderRequestRetirement.ts:138 | value?.rawItemId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:138 | row.rawItemId | any | any-receiver |
| functions/src/orderRequestRetirement.ts:138 | value?.inventoryWriterProtocolVersion | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:138 | row.revision | any | any-receiver |
| functions/src/orderRequestRetirement.ts:138 | row.existed | any | any-receiver |
| functions/src/orderRequestRetirement.ts:141 | row.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:142 | row.id | any | any-receiver |
| functions/src/orderRequestRetirement.ts:142 | row.deletionRevision | any | any-receiver |
| functions/src/orderRequestRetirement.ts:142 | row.deletionFloor | any | any-receiver |
| functions/src/orderRequestRetirement.ts:142 | row.deletionRevision | any | any-receiver |
| functions/src/orderRequestRetirement.ts:142 | row.deletionFloor | any | any-receiver |
| functions/src/orderRequestRetirement.ts:144 | value?.inventoryWriterProtocolVersion | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:144 | row.revision | any | any-receiver |
| functions/src/orderRequestRetirement.ts:144 | t?.deletionRevision | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/orderRequestRetirement.ts:144 | row.deletionRevision | any | any-receiver |
| functions/src/orderRequestRetirement.ts:145 | row.existed | any | any-receiver |
| functions/src/orderRequestRetirement.ts:145 | row.deletionRevision | any | any-receiver |
| functions/src/orderRequestRetirement.ts:145 | row.revision | any | any-receiver |
| functions/src/orderRequestRetirement.ts:149 | op.id | any | any-receiver |
| functions/src/index.ts:40 | request.data?.name | any | any-receiver |
| functions/src/index.ts:41 | request.data?.phone | any | any-receiver |
| functions/src/index.ts:60 | request.data?.username | any | any-receiver |
| functions/src/index.ts:61 | request.data?.name | any | any-receiver |
| functions/src/index.ts:62 | request.data?.phone | any | any-receiver |
| functions/src/index.ts:100 | startingRelease.data()?.releaseId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:162 | releaseSnap.data()?.releaseId | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:302 | (room.participantIds ?? []).filter | any | any-receiver |
| functions/src/index.ts:316 | d.data()?.fcmTokens | DocumentData \| undefined | property-symbol-unresolved |
| functions/src/index.ts:319 | room.nameBy?.[d.id]?.trim | any | any-receiver |
| functions/src/index.ts:319 | room.name?.trim | any | any-receiver |

## 기존 shared 선언 필드

| 모델 | 필드 | 입력 | 선언 타입 | 선언 위치 | 정적 사용처 |
| --- | --- | --- | --- | --- | --- |
| OrderItem | lineId | 선택 | string | src/shared/types.ts:28 | 50 |
| OrderItem | itemId | 필수 | string | src/shared/types.ts:29 | 121 |
| OrderItem | name | 필수 | string | src/shared/types.ts:30 | 63 |
| OrderItem | orderedAs | 선택 | string | src/shared/types.ts:44 | 0 |
| OrderItem | quantity | 필수 | number | src/shared/types.ts:45 | 42 |
| OrderItem | price | 필수 | number | src/shared/types.ts:46 | 7 |
| OrderItem | checked | 선택 | boolean | src/shared/types.ts:47 | 40 |
| OrderItem | checkedBy | 선택 | string | src/shared/types.ts:48 | 8 |
| OrderItem | checkedAt | 선택 | string | src/shared/types.ts:49 | 7 |
| OrderItem | mfgDate | 선택 | string | src/shared/types.ts:50 | 18 |
| OrderItem | mfgBy | 선택 | string | src/shared/types.ts:51 | 2 |
| OrderItem | mfgAt | 선택 | string | src/shared/types.ts:52 | 2 |
| OrderItem | labelType | 선택 | '대기' \| '날인' \| '부착' | src/shared/types.ts:53 | 13 |
| OrderItem | labelBy | 선택 | string | src/shared/types.ts:60 | 2 |
| OrderItem | labelAt | 선택 | string | src/shared/types.ts:61 | 2 |
| OrderItem | isBoxUnit | 선택 | boolean | src/shared/types.ts:62 | 25 |
| OrderItem | boxQuantity | 선택 | number | src/shared/types.ts:63 | 25 |
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
| ShipTo | defaultShipMethod | 선택 | ShipMethod | src/shared/types.ts:110 | 2 |
| ShipTo | id | 필수 | string | src/shared/types.ts:112 | 21 |
| ShipTo | name | 필수 | string | src/shared/types.ts:113 | 13 |
| ShipTo | archived | 선택 | boolean | src/shared/types.ts:115 | 13 |
| PartnerItem | id | 필수 | string | src/shared/types.ts:119 | 27 |
| PartnerItem | itemId | 필수 | string | src/shared/types.ts:120 | 70 |
| PartnerItem | partnerId | 필수 | string | src/shared/types.ts:121 | 63 |
| PartnerItem | Direction | 필수 | 'in' \| 'out' | src/shared/types.ts:122 | 29 |
| PartnerItem | price | 선택 | number | src/shared/types.ts:123 | 30 |
| PartnerItem | Account_Code | 선택 | string | src/shared/types.ts:124 | 14 |
| PartnerItem | taxType | 선택 | '과세' \| '면세' \| null | src/shared/types.ts:133 | 22 |
| PartnerItem | shipToIds | 선택 | string[] | src/shared/types.ts:147 | 1 |
| PartnerItem | isSmartStore | 선택 | boolean | src/shared/types.ts:148 | 0 |
| Partner | defaultShipMethod | 선택 | ShipMethod | src/shared/types.ts:154 | 3 |
| Partner | shipTos | 선택 | ShipTo[] | src/shared/types.ts:162 | 6 |
| Partner | id | 필수 | string | src/shared/types.ts:163 | 192 |
| Partner | name | 필수 | string | src/shared/types.ts:164 | 180 |
| Partner | email | 선택 | string | src/shared/types.ts:165 | 4 |
| Partner | phone | 선택 | string | src/shared/types.ts:166 | 6 |
| Partner | type | 필수 | PartnerChannel | src/shared/types.ts:167 | 26 |
| Partner | region | 선택 | string | src/shared/types.ts:168 | 8 |
| Partner | address | 선택 | string | src/shared/types.ts:169 | 10 |
| Partner | addressDetail | 선택 | string | src/shared/types.ts:170 | 8 |
| Partner | ownerName | 선택 | string | src/shared/types.ts:171 | 6 |
| Partner | bizNo | 선택 | string | src/shared/types.ts:172 | 6 |
| Partner | tel | 선택 | string | src/shared/types.ts:173 | 7 |
| Partner | mobile | 선택 | string | src/shared/types.ts:174 | 7 |
| Partner | fax | 선택 | string | src/shared/types.ts:175 | 2 |
| Partner | note | 선택 | string | src/shared/types.ts:176 | 3 |
| Partner | partnerType | 선택 | PartnerType | src/shared/types.ts:177 | 11 |
| Partner | companyId | 선택 | CompanyId | src/shared/types.ts:184 | 3 |
| Partner | isOemFactory | 선택 | boolean | src/shared/types.ts:185 | 1 |
| Partner | purchaseItems | 선택 | PurchaseItem[] | src/shared/types.ts:186 | 0 |
| OrderRawInventoryTrace | material | 필수 | string | src/shared/types.ts:219 | 14 |
| OrderRawInventoryTrace | rawItemId | 선택 | string | src/shared/types.ts:221 | 14 |
| OrderRawInventoryTrace | operationId | 선택 | string | src/shared/types.ts:223 | 20 |
| OrderRawInventoryTrace | ledgerId | 선택 | string | src/shared/types.ts:225 | 3 |
| OrderRawInventoryTrace | ledgerOnly | 선택 | boolean | src/shared/types.ts:227 | 11 |
| OrderRawInventoryTrace | lotId | 선택 | string | src/shared/types.ts:228 | 8 |
| OrderRawInventoryTrace | lotNo | 선택 | string | src/shared/types.ts:229 | 4 |
| OrderRawInventoryTrace | supplierName | 필수 | string | src/shared/types.ts:230 | 3 |
| OrderRawInventoryTrace | receivedDate | 선택 | string | src/shared/types.ts:231 | 3 |
| OrderRawInventoryTrace | kg | 필수 | number | src/shared/types.ts:232 | 13 |
| OrderProductionRecordIndexEntry | recordId | 필수 | string | src/shared/types.ts:236 | 9 |
| OrderProductionRecordIndexEntry | generation | 필수 | import('./orderInventoryGeneration').OrderInventoryGeneration | src/shared/types.ts:237 | 7 |
| OrderProductionRecordIndexEntry | requestHash | 필수 | string | src/shared/types.ts:238 | 3 |
| Order | productionRecordIndex | 선택 | Record<string,OrderProductionRecordIndexEntry> | src/shared/types.ts:241 | 10 |
| Order | id | 필수 | string | src/shared/types.ts:242 | 285 |
| Order | companyId | 선택 | CompanyId | src/shared/types.ts:244 | 7 |
| Order | cardNo | 선택 | string | src/shared/types.ts:255 | 5 |
| Order | createdBy | 선택 | string | src/shared/types.ts:260 | 1 |
| Order | sourceChatMessageId | 선택 | string | src/shared/types.ts:262 | 1 |
| Order | partnerId | 선택 | string | src/shared/types.ts:263 | 58 |
| Order | partnerName | 필수 | string | src/shared/types.ts:264 | 91 |
| Order | items | 필수 | OrderItem[] | src/shared/types.ts:265 | 154 |
| Order | note | 선택 | string | src/shared/types.ts:267 | 15 |
| Order | noteImportant | 선택 | boolean | src/shared/types.ts:268 | 4 |
| Order | noteBy | 선택 | string | src/shared/types.ts:269 | 2 |
| Order | noteAt | 선택 | string | src/shared/types.ts:270 | 2 |
| Order | totalAmount | 필수 | number | src/shared/types.ts:271 | 0 |
| Order | status | 필수 | OrderStatus | src/shared/types.ts:272 | 132 |
| Order | createdAt | 필수 | string | src/shared/types.ts:273 | 55 |
| Order | deliveryDate | 필수 | string | src/shared/types.ts:274 | 58 |
| Order | email | 필수 | string | src/shared/types.ts:275 | 0 |
| Order | purpose | 선택 | 'stock-production' | src/shared/types.ts:277 | 2 |
| Order | source | 필수 | OrderSource | src/shared/types.ts:278 | 33 |
| Order | pallets | 선택 | OrderPallet[] | src/shared/types.ts:279 | 20 |
| Order | region | 선택 | string | src/shared/types.ts:280 | 0 |
| Order | shipToId | 선택 | string | src/shared/types.ts:288 | 5 |
| Order | deliveryBoxes | 선택 | DeliveryBox[] | src/shared/types.ts:289 | 10 |
| Order | shipMethod | 선택 | ShipMethod \| '직접수령' | src/shared/types.ts:291 | 0 |
| Order | invoicePrinted | 선택 | boolean | src/shared/types.ts:292 | 16 |
| Order | invoiceStage | 선택 | 'printed' \| 'attached' | src/shared/types.ts:301 | 2 |
| Order | invoiceType | 선택 | InvoiceType | src/shared/types.ts:303 | 2 |
| Order | shipmentConfirmedBy | 선택 | string \| null | src/shared/types.ts:304 | 3 |
| Order | shipmentConfirmedAt | 선택 | string \| null | src/shared/types.ts:305 | 5 |
| Order | deliveredAt | 선택 | string | src/shared/types.ts:306 | 14 |
| Order | documentDate | 선택 | string | src/shared/types.ts:307 | 0 |
| Order | accountingExcluded | 선택 | boolean | src/shared/types.ts:313 | 3 |
| Order | accountingExclusionReason | 선택 | string | src/shared/types.ts:314 | 2 |
| Order | accountingExcludedAt | 선택 | string | src/shared/types.ts:315 | 0 |
| Order | accountingExcludedBy | 선택 | string | src/shared/types.ts:316 | 0 |
| Order | rawLotsDeducted | 선택 | boolean | src/shared/types.ts:317 | 3 |
| Order | rawConsumedLots | 선택 | OrderRawInventoryTrace[] | src/shared/types.ts:318 | 18 |
| Order | rawInventoryAttempt | 선택 | number | src/shared/types.ts:320 | 7 |
| Order | productConsumedLots | 선택 | { itemId: string; material?: string; lotId?: string; lotNo?: string; receivedDate?: string; qty: number; lotSnapshot?: RawMaterialLot }[] | src/shared/types.ts:326 | 7 |
| Order | autoBuilt | 선택 | { itemId: string; qty: number }[] | src/shared/types.ts:327 | 12 |
| Order | producedUnits | 선택 | { itemId: string; qty: number }[] | src/shared/types.ts:328 | 15 |
| Order | producedAt | 선택 | string | src/shared/types.ts:330 | 26 |
| Order | shippedOut | 선택 | boolean | src/shared/types.ts:331 | 15 |
| Order | inventorySnapshots | 선택 | {     version: 1;     production?: OrderInventorySnapshot;     shipment?: OrderInventorySnapshot;   } | src/shared/types.ts:336 | 31 |
| Order | itemInventory | 선택 | Record<string, OrderItemInventoryState> | src/shared/types.ts:346 | 23 |
| Order | inventoryGenerationCompletion | 선택 | {generation:import('./orderInventoryGeneration').OrderInventoryGeneration;completedAt:string;requestText:string;consumedLotsText:string;consumedLots:NonNullable<Order['productConsumedLots']>} | src/shared/types.ts:348 | 7 |
| Order | inventoryOperation | 선택 | {     id: string;     /** 새 원료 batch·제품 확정이 같은 최초 세대를 확인한다. 옛 잠금은 자동 승격하지 않는다. */     contractVersion?: 1;     /** 최초 생산기록 계획까지 고정한 새 claim만 사용한다. 옛 실패에는 추정해 붙이지 않는다. */     productionRecordContractVersion?:1;     actorUid?: string;     /** 품목 한 줄은 결정적 원료 작업번호로 중단 지점부터 재개할 수 있다. */     kind?: 'line' \| 'status';     lineId?: string;     stage?: 'claim' \| 'reservation' \| 'raw-inventory' \| 'production-record' \| 'final-stock';     targetStatus: OrderStatus;     state: 'processing' \| 'failed';     startedAt: string;     actor: string;     error?: string;   } \| null | src/shared/types.ts:349 | 45 |
| OrderItemInventoryState | version | 필수 | 1 | src/shared/types.ts:369 | 0 |
| OrderItemInventoryState | lineId | 필수 | string | src/shared/types.ts:370 | 4 |
| OrderItemInventoryState | itemId | 필수 | string | src/shared/types.ts:371 | 3 |
| OrderItemInventoryState | applied | 필수 | boolean | src/shared/types.ts:372 | 16 |
| OrderItemInventoryState | attempt | 필수 | number | src/shared/types.ts:373 | 8 |
| OrderItemInventoryState | completedAt | 선택 | string | src/shared/types.ts:374 | 8 |
| OrderItemInventoryState | reversedAt | 선택 | string | src/shared/types.ts:375 | 0 |
| OrderItemInventoryState | rawConsumedLots | 필수 | OrderRawInventoryTrace[] | src/shared/types.ts:376 | 9 |
| OrderItemInventoryState | autoBuilt | 필수 | { itemId: string; qty: number }[] | src/shared/types.ts:377 | 4 |
| OrderItemInventoryState | producedUnits | 필수 | { itemId: string; qty: number }[] | src/shared/types.ts:378 | 5 |
| OrderItemInventoryState | production | 필수 | OrderInventorySnapshot | src/shared/types.ts:379 | 22 |
| OrderInventoryAdjustment | itemId | 필수 | string | src/shared/types.ts:383 | 19 |
| OrderInventoryAdjustment | delta | 필수 | number | src/shared/types.ts:384 | 14 |
| OrderRawCalculationEvidence | productId | 필수 | string | src/shared/types.ts:389 | 2 |
| OrderRawCalculationEvidence | spec | 필수 | string | src/shared/types.ts:390 | 1 |
| OrderRawCalculationEvidence | units | 필수 | number | src/shared/types.ts:391 | 1 |
| OrderRawCalculationEvidence | raw | 필수 | string | src/shared/types.ts:392 | 3 |
| OrderRawCalculationEvidence | kg | 필수 | number | src/shared/types.ts:393 | 3 |
| OrderRawCalculationEvidence | path | 필수 | 'bom-direct' \| 'bom-formula' \| 'formula-fallback' \| 'bulk' | src/shared/types.ts:394 | 1 |
| OrderRawCalculationEvidence | childItemId | 선택 | string | src/shared/types.ts:395 | 1 |
| OrderRawCalculationEvidence | bomQuantityKg | 선택 | number | src/shared/types.ts:396 | 1 |
| OrderRawCalculationEvidence | formulaName | 선택 | string | src/shared/types.ts:397 | 1 |
| OrderRawCalculationEvidence | ratio | 선택 | number | src/shared/types.ts:398 | 1 |
| OrderRawCalculationEvidence | convertedKg | 선택 | number | src/shared/types.ts:399 | 1 |
| OrderInventorySnapshot | capturedAt | 필수 | string | src/shared/types.ts:403 | 16 |
| OrderInventorySnapshot | rawCalculationEvidence | 선택 | OrderRawCalculationEvidence[] | src/shared/types.ts:404 | 4 |
| OrderInventorySnapshot | stockDeltas | 필수 | OrderInventoryAdjustment[] | src/shared/types.ts:405 | 20 |
| OrderInventorySnapshot | bomLines | 필수 | { parentItemId: string; childItemId: string; quantity: number }[] | src/shared/types.ts:406 | 3 |
| OrderInventorySnapshot | rawConsumedLots | 선택 | Order['rawConsumedLots'] | src/shared/types.ts:407 | 13 |
| OrderInventorySnapshot | productConsumedLots | 선택 | Order['productConsumedLots'] | src/shared/types.ts:408 | 6 |
| OrderInventorySnapshot | productProducedLots | 선택 | { itemId: string; lotId: string; qty: number }[] | src/shared/types.ts:409 | 6 |
| OrderInventorySnapshot | rawLedgerIds | 선택 | string[] | src/shared/types.ts:410 | 7 |
| OrderStatusAudit | id | 필수 | string | src/shared/types.ts:414 | 0 |
| OrderStatusAudit | orderId | 필수 | string | src/shared/types.ts:415 | 0 |
| OrderStatusAudit | partnerName | 필수 | string | src/shared/types.ts:416 | 0 |
| OrderStatusAudit | previousStatus | 필수 | OrderStatus | src/shared/types.ts:417 | 1 |
| OrderStatusAudit | nextStatus | 필수 | OrderStatus | src/shared/types.ts:418 | 1 |
| OrderStatusAudit | approvedBy | 필수 | string | src/shared/types.ts:419 | 1 |
| OrderStatusAudit | approvedAt | 필수 | string | src/shared/types.ts:420 | 1 |
| OrderStatusAudit | completedAt | 선택 | string | src/shared/types.ts:421 | 1 |
| OrderStatusAudit | state | 필수 | 'processing' \| 'completed' \| 'failed' | src/shared/types.ts:422 | 3 |
| OrderStatusAudit | legacyEvidenceWarning | 필수 | boolean | src/shared/types.ts:423 | 1 |
| OrderStatusAudit | stockAdjustments | 필수 | Array<OrderInventoryAdjustment & { name: string; unit: string }> | src/shared/types.ts:424 | 1 |
| OrderStatusAudit | error | 선택 | string | src/shared/types.ts:425 | 1 |
| OrderItemEdit | id | 필수 | string | src/shared/types.ts:435 | 0 |
| OrderItemEdit | orderId | 필수 | string | src/shared/types.ts:436 | 0 |
| OrderItemEdit | at | 필수 | string | src/shared/types.ts:437 | 1 |
| OrderItemEdit | by | 필수 | string | src/shared/types.ts:438 | 1 |
| OrderItemEdit | changes | 필수 | string[] | src/shared/types.ts:440 | 1 |
| SubmaterialComponent | id | 필수 | string | src/shared/types.ts:444 | 13 |
| SubmaterialComponent | name | 필수 | string | src/shared/types.ts:445 | 2 |
| SubmaterialComponent | category | 필수 | InventoryCategory \| string | src/shared/types.ts:446 | 0 |
| SubmaterialComponent | stock | 필수 | number | src/shared/types.ts:447 | 8 |
| SubmaterialComponent | unit | 필수 | string | src/shared/types.ts:448 | 1 |
| SubmaterialComponent | spec | 선택 | string | src/shared/types.ts:449 | 0 |
| SubmaterialComponent | cost | 선택 | number | src/shared/types.ts:450 | 0 |
| SubmaterialComponent | qrCode | 선택 | string | src/shared/types.ts:451 | 0 |
| ItemInventoryReservation | operationId | 필수 | string | src/shared/types.ts:497 | 3 |
| ItemInventoryReservation | generation | 선택 | import('./orderInventoryGeneration').OrderInventoryGeneration | src/shared/types.ts:498 | 1 |
| ItemInventoryReservation | orderId | 필수 | string | src/shared/types.ts:499 | 9 |
| ItemInventoryReservation | qty | 필수 | number | src/shared/types.ts:500 | 7 |
| ItemInventoryReservation | createdAt | 필수 | string | src/shared/types.ts:501 | 1 |
| ItemInventoryReservation | state | 필수 | 'processing' \| 'allocated' | src/shared/types.ts:503 | 3 |
| ItemStocktakeAnchor | id | 필수 | string | src/shared/types.ts:507 | 4 |
| ItemStocktakeAnchor | date | 필수 | string | src/shared/types.ts:508 | 3 |
| ItemStocktakeAnchor | createdAt | 필수 | string | src/shared/types.ts:509 | 2 |
| ItemStocktakeAnchor | targetQty | 필수 | number | src/shared/types.ts:510 | 1 |
| ItemStocktakeAnchor | beforeQty | 필수 | number | src/shared/types.ts:511 | 1 |
| ItemStocktakeAnchor | deltaQty | 필수 | number | src/shared/types.ts:512 | 0 |
| ItemStocktakeAnchor | note | 선택 | string | src/shared/types.ts:513 | 1 |
| ItemStocktakeAnchor | request | 선택 | ProductStocktakeRequest | src/shared/types.ts:515 | 0 |
| Item | id | 필수 | string | src/shared/types.ts:520 | 700 |
| Item | companyId | 선택 | CompanyId | src/shared/types.ts:532 | 3 |
| Item | name | 필수 | string | src/shared/types.ts:533 | 292 |
| Item | sku | 선택 | string | src/shared/types.ts:534 | 0 |
| Item | type | 필수 | InventoryCategory \| string | src/shared/types.ts:536 | 135 |
| Item | category | 선택 | ItemSubtype \| string | src/shared/types.ts:537 | 36 |
| Item | subtype | 선택 | string | src/shared/types.ts:538 | 20 |
| Item | cost | 선택 | number | src/shared/types.ts:539 | 20 |
| Item | costSource | 선택 | 'rollup' \| 'manual' | src/shared/types.ts:548 | 2 |
| Item | lotsAreTotal | 선택 | never | src/shared/types.ts:577 | 0 |
| Item | stock | 필수 | number | src/shared/types.ts:579 | 62 |
| Item | inventoryReservations | 선택 | ItemInventoryReservation[] | src/shared/types.ts:581 | 4 |
| Item | stocktakeAnchors | 선택 | ItemStocktakeAnchor[] | src/shared/types.ts:583 | 4 |
| Item | density | 선택 | number | src/shared/types.ts:589 | 15 |
| Item | minStock | 필수 | number | src/shared/types.ts:590 | 22 |
| Item | unit | 필수 | string | src/shared/types.ts:591 | 113 |
| Item | image | 필수 | string | src/shared/types.ts:592 | 4 |
| Item | imagePath | 선택 | string | src/shared/types.ts:594 | 6 |
| Item | oil | 선택 | string | src/shared/types.ts:595 | 3 |
| Item | partnerIds | 선택 | string[] | src/shared/types.ts:596 | 1 |
| Item | freightType | 선택 | 's' \| 'a' \| 'b' \| 'c' \| 'd' \| 'e' | src/shared/types.ts:597 | 3 |
| Item | 품목 | 선택 | string | src/shared/types.ts:600 | 13 |
| Item | 품목이력 | 선택 | { 품목: string; until: string }[] | src/shared/types.ts:602 | 1 |
| Item | spec | 선택 | string | src/shared/types.ts:603 | 100 |
| Item | isSmartStore | 선택 | boolean | src/shared/types.ts:604 | 1 |
| Item | smartStorePrice | 선택 | number | src/shared/types.ts:605 | 4 |
| Item | procureType | 선택 | '완사입' \| '임가공' | src/shared/types.ts:608 | 5 |
| Item | unpackable | 선택 | boolean | src/shared/types.ts:618 | 2 |
| Item | rawMaterialName | 선택 | string | src/shared/types.ts:619 | 7 |
| Item | packageType | 선택 | string | src/shared/types.ts:620 | 3 |
| Item | packageKg | 선택 | number | src/shared/types.ts:621 | 2 |
| Item | lots | 선택 | RawMaterialLot[] | src/shared/types.ts:622 | 39 |
| Item | mixEnabled | 선택 | boolean | src/shared/types.ts:623 | 4 |
| Item | mixTopPercent | 선택 | number | src/shared/types.ts:624 | 3 |
| Item | mixLotRatios | 선택 | { lotId: string; percent: number }[] | src/shared/types.ts:625 | 8 |
| Item | phantom | 선택 | boolean | src/shared/types.ts:626 | 12 |
| Item | archived | 선택 | boolean | src/shared/types.ts:628 | 38 |
| PalletStock | id | 필수 | string | src/shared/types.ts:633 | 35 |
| PalletStock | name | 필수 | string | src/shared/types.ts:634 | 25 |
| PalletStock | total | 필수 | number | src/shared/types.ts:635 | 10 |
| PalletStock | inUse | 필수 | number | src/shared/types.ts:637 | 0 |
| PalletStock | damaged | 필수 | number | src/shared/types.ts:638 | 6 |
| PalletStock | hidden | 선택 | boolean | src/shared/types.ts:639 | 9 |
| PalletTransaction | id | 필수 | string | src/shared/types.ts:643 | 12 |
| PalletTransaction | partnerId | 필수 | string | src/shared/types.ts:644 | 6 |
| PalletTransaction | palletId | 필수 | string | src/shared/types.ts:645 | 6 |
| PalletTransaction | type | 필수 | 'in' \| 'out' | src/shared/types.ts:646 | 9 |
| PalletTransaction | quantity | 필수 | number | src/shared/types.ts:647 | 13 |
| PalletTransaction | date | 필수 | string | src/shared/types.ts:648 | 6 |
| PalletTransaction | note | 선택 | string | src/shared/types.ts:649 | 2 |
| PalletTransaction | status | 선택 | '교체중' \| '교체완료' | src/shared/types.ts:650 | 3 |
| PalletTransaction | exchangeReturnQty | 선택 | number | src/shared/types.ts:651 | 2 |
| PalletTransaction | isTransfer | 선택 | boolean | src/shared/types.ts:652 | 5 |
| Post | id | 필수 | string | src/shared/types.ts:657 | 6 |
| Post | title | 필수 | string | src/shared/types.ts:658 | 5 |
| Post | author | 필수 | string | src/shared/types.ts:659 | 4 |
| Post | content | 필수 | string | src/shared/types.ts:660 | 3 |
| Post | date | 필수 | string | src/shared/types.ts:661 | 4 |
| Post | tag | 필수 | '공지' \| '긴급' \| '매뉴얼' \| '업무' | src/shared/types.ts:662 | 8 |
| Post | pinned | 선택 | boolean | src/shared/types.ts:663 | 6 |
| Post | blocks | 선택 | ({ type: 'text'; text: string; format?: 'paragraph' \| 'heading' \| 'subheading' \| 'list'; bold?: boolean; link?: string } \| { type: 'image'; url: string; path: string; caption: string })[] | src/shared/types.ts:664 | 5 |
| FileItem | id | 필수 | string | src/shared/types.ts:668 | 0 |
| FileItem | name | 필수 | string | src/shared/types.ts:669 | 0 |
| FileItem | type | 필수 | 'pdf' \| 'excel' \| 'image' \| 'word' | src/shared/types.ts:670 | 0 |
| FileItem | size | 필수 | string | src/shared/types.ts:671 | 0 |
| FileItem | date | 필수 | string | src/shared/types.ts:672 | 0 |
| FileItem | uploader | 필수 | string | src/shared/types.ts:673 | 0 |
| CabinetCategory | id | 필수 | string | src/shared/types.ts:679 | 2 |
| CabinetCategory | companyId | 선택 | CompanyId | src/shared/types.ts:680 | 0 |
| CabinetCategory | name | 필수 | string | src/shared/types.ts:681 | 12 |
| CabinetCategory | order | 필수 | number | src/shared/types.ts:682 | 1 |
| CabinetCategory | createdAt | 필수 | string | src/shared/types.ts:683 | 0 |
| CabinetSubCategory | id | 필수 | string | src/shared/types.ts:687 | 2 |
| CabinetSubCategory | companyId | 선택 | CompanyId | src/shared/types.ts:688 | 0 |
| CabinetSubCategory | category | 필수 | string | src/shared/types.ts:689 | 6 |
| CabinetSubCategory | name | 필수 | string | src/shared/types.ts:690 | 11 |
| CabinetSubCategory | order | 필수 | number | src/shared/types.ts:691 | 1 |
| CabinetSubCategory | createdAt | 필수 | string | src/shared/types.ts:692 | 0 |
| CabinetDoc | id | 필수 | string | src/shared/types.ts:696 | 3 |
| CabinetDoc | companyId | 선택 | CompanyId | src/shared/types.ts:697 | 0 |
| CabinetDoc | category | 필수 | string | src/shared/types.ts:698 | 3 |
| CabinetDoc | subCategory | 필수 | string | src/shared/types.ts:699 | 3 |
| CabinetDoc | fileName | 필수 | string | src/shared/types.ts:700 | 5 |
| CabinetDoc | storagePath | 필수 | string | src/shared/types.ts:701 | 1 |
| CabinetDoc | downloadUrl | 필수 | string | src/shared/types.ts:702 | 1 |
| CabinetDoc | size | 필수 | number | src/shared/types.ts:703 | 1 |
| CabinetDoc | contentType | 필수 | string | src/shared/types.ts:704 | 1 |
| CabinetDoc | note | 선택 | string | src/shared/types.ts:705 | 3 |
| CabinetDoc | uploadedBy | 필수 | string | src/shared/types.ts:706 | 1 |
| CabinetDoc | uploadedAt | 필수 | string | src/shared/types.ts:707 | 2 |
| AnnualLeave | carryOverLeave | 필수 | number | src/shared/types.ts:714 | 7 |
| AnnualLeave | bonusLeave | 필수 | number | src/shared/types.ts:715 | 7 |
| Employee | id | 필수 | string | src/shared/types.ts:719 | 142 |
| Employee | companyId | 선택 | CompanyId | src/shared/types.ts:721 | 4 |
| Employee | name | 필수 | string | src/shared/types.ts:722 | 99 |
| Employee | username | 선택 | string | src/shared/types.ts:723 | 1 |
| Employee | position | 필수 | string | src/shared/types.ts:724 | 25 |
| Employee | department | 필수 | string | src/shared/types.ts:725 | 21 |
| Employee | joinDate | 필수 | string | src/shared/types.ts:726 | 12 |
| Employee | status | 필수 | EmployeeStatus | src/shared/types.ts:727 | 5 |
| Employee | phone | 필수 | string | src/shared/types.ts:728 | 9 |
| Employee | birthDate | 선택 | string | src/shared/types.ts:729 | 1 |
| Employee | annualLeave | 선택 | AnnualLeave | src/shared/types.ts:730 | 12 |
| Employee | healthCertDate | 선택 | string | src/shared/types.ts:731 | 7 |
| Employee | adminAccess | 선택 | boolean | src/shared/types.ts:736 | 2 |
| Employee | fcmTokens | 선택 | string[] | src/shared/types.ts:741 | 1 |
| Employee | fcmDevices | 선택 | Record<string, { name: string; at: string }> | src/shared/types.ts:752 | 1 |
| PayrollLine | employeeId | 필수 | string | src/shared/types.ts:760 | 4 |
| PayrollLine | employeeName | 필수 | string | src/shared/types.ts:761 | 3 |
| PayrollLine | department | 선택 | string | src/shared/types.ts:762 | 3 |
| PayrollLine | position | 선택 | string | src/shared/types.ts:763 | 2 |
| PayrollLine | base | 필수 | number | src/shared/types.ts:764 | 2 |
| PayrollLine | overtime | 선택 | number | src/shared/types.ts:765 | 2 |
| PayrollLine | allowance | 선택 | number | src/shared/types.ts:766 | 2 |
| PayrollLine | incomeTax | 선택 | number | src/shared/types.ts:767 | 2 |
| PayrollLine | localTax | 선택 | number | src/shared/types.ts:768 | 2 |
| PayrollLine | pension | 선택 | number | src/shared/types.ts:769 | 2 |
| PayrollLine | health | 선택 | number | src/shared/types.ts:770 | 2 |
| PayrollLine | employment | 선택 | number | src/shared/types.ts:771 | 2 |
| PayrollLine | otherDeduct | 선택 | number | src/shared/types.ts:772 | 2 |
| PayrollLine | note | 선택 | string | src/shared/types.ts:773 | 0 |
| Payroll | id | 필수 | string | src/shared/types.ts:777 | 3 |
| Payroll | companyId | 선택 | CompanyId | src/shared/types.ts:779 | 0 |
| Payroll | yearMonth | 필수 | string | src/shared/types.ts:780 | 0 |
| Payroll | payDate | 필수 | string | src/shared/types.ts:781 | 1 |
| Payroll | lines | 필수 | PayrollLine[] | src/shared/types.ts:782 | 2 |
| Payroll | cashEntryId | 선택 | string | src/shared/types.ts:783 | 1 |
| Payroll | note | 선택 | string | src/shared/types.ts:784 | 0 |
| Payroll | createdAt | 선택 | string | src/shared/types.ts:785 | 0 |
| Payroll | updatedAt | 선택 | string | src/shared/types.ts:786 | 0 |
| LeaveModifyRequest | startDate | 필수 | string | src/shared/types.ts:821 | 3 |
| LeaveModifyRequest | endDate | 필수 | string | src/shared/types.ts:822 | 3 |
| LeaveModifyRequest | reason | 필수 | string | src/shared/types.ts:823 | 3 |
| LeaveModifyRequest | daysUsed | 필수 | number | src/shared/types.ts:824 | 3 |
| LeaveModifyRequest | status | 필수 | 'pending' \| 'approved' \| 'rejected' | src/shared/types.ts:825 | 7 |
| LeaveRequest | id | 필수 | string | src/shared/types.ts:829 | 19 |
| LeaveRequest | employeeId | 필수 | string | src/shared/types.ts:830 | 8 |
| LeaveRequest | employeeName | 필수 | string | src/shared/types.ts:831 | 6 |
| LeaveRequest | type | 필수 | LeaveType | src/shared/types.ts:832 | 10 |
| LeaveRequest | startDate | 필수 | string | src/shared/types.ts:833 | 17 |
| LeaveRequest | endDate | 필수 | string | src/shared/types.ts:834 | 11 |
| LeaveRequest | reason | 필수 | string | src/shared/types.ts:835 | 6 |
| LeaveRequest | status | 필수 | LeaveStatus | src/shared/types.ts:836 | 24 |
| LeaveRequest | requestedAt | 필수 | string | src/shared/types.ts:837 | 4 |
| LeaveRequest | daysUsed | 필수 | number | src/shared/types.ts:838 | 10 |
| LeaveRequest | deductsLeave | 선택 | boolean | src/shared/types.ts:844 | 1 |
| LeaveRequest | modifyRequest | 선택 | LeaveModifyRequest | src/shared/types.ts:845 | 19 |
| LeaveRequest | cancelledAt | 선택 | string | src/shared/types.ts:851 | 2 |
| LeaveRequest | cancelledBy | 선택 | string | src/shared/types.ts:852 | 0 |
| LeaveRequest | cancelledByName | 선택 | string | src/shared/types.ts:853 | 1 |
| LeaveRequest | cancelReason | 선택 | string | src/shared/types.ts:854 | 2 |
| ChatMessage | id | 필수 | string | src/shared/types.ts:858 | 18 |
| ChatMessage | companyId | 선택 | CompanyId | src/shared/types.ts:859 | 2 |
| ChatMessage | roomId | 필수 | string | src/shared/types.ts:860 | 7 |
| ChatMessage | senderId | 필수 | string | src/shared/types.ts:861 | 12 |
| ChatMessage | senderName | 필수 | string | src/shared/types.ts:862 | 9 |
| ChatMessage | text | 필수 | string | src/shared/types.ts:863 | 21 |
| ChatMessage | imageUrl | 선택 | string | src/shared/types.ts:864 | 4 |
| ChatMessage | images | 선택 | string[] | src/shared/types.ts:871 | 2 |
| ChatMessage | createdAt | 필수 | string | src/shared/types.ts:872 | 6 |
| ChatMessage | mentions | 선택 | string[] | src/shared/types.ts:873 | 0 |
| ChatMessage | fileUrl | 선택 | string | src/shared/types.ts:875 | 5 |
| ChatMessage | fileName | 선택 | string | src/shared/types.ts:876 | 4 |
| ChatMessage | fileSize | 선택 | number | src/shared/types.ts:877 | 5 |
| ChatMessage | replyTo | 선택 | { id: string; senderName: string; text: string } | src/shared/types.ts:882 | 3 |
| ChatMessage | deletedAt | 선택 | string | src/shared/types.ts:887 | 4 |
| ChatMessage | deletedBy | 선택 | string | src/shared/types.ts:888 | 0 |
| ChatMessage | reactions | 선택 | Record<string, string[]> | src/shared/types.ts:894 | 6 |
| ChatRoom | id | 필수 | string | src/shared/types.ts:898 | 29 |
| ChatRoom | companyId | 선택 | CompanyId | src/shared/types.ts:899 | 0 |
| ChatRoom | name | 선택 | string | src/shared/types.ts:901 | 5 |
| ChatRoom | nameBy | 선택 | Record<string, string> | src/shared/types.ts:903 | 1 |
| ChatRoom | createdBy | 선택 | string | src/shared/types.ts:905 | 0 |
| ChatRoom | participantIds | 필수 | string[] | src/shared/types.ts:906 | 12 |
| ChatRoom | participantCompanies | 선택 | Record<string, CompanyId> | src/shared/types.ts:908 | 0 |
| ChatRoom | lastMessage | 선택 | string | src/shared/types.ts:909 | 1 |
| ChatRoom | lastUpdatedAt | 필수 | string | src/shared/types.ts:910 | 5 |
| ChatRoom | isGroup | 필수 | boolean | src/shared/types.ts:911 | 7 |
| ChatRoom | lastReadBy | 선택 | Record<string, string> | src/shared/types.ts:912 | 5 |
| ChatRoom | pinnedBy | 선택 | Record<string, string> | src/shared/types.ts:920 | 3 |
| ChatRoom | notice | 선택 | RoomNotice \| null | src/shared/types.ts:928 | 2 |
| RoomNotice | messageId | 필수 | string | src/shared/types.ts:934 | 1 |
| RoomNotice | text | 필수 | string | src/shared/types.ts:935 | 2 |
| RoomNotice | by | 필수 | string | src/shared/types.ts:937 | 0 |
| RoomNotice | byName | 필수 | string | src/shared/types.ts:938 | 1 |
| RoomNotice | at | 필수 | string | src/shared/types.ts:940 | 1 |
| ProductionRecord | supersededBy | 선택 | OrderProductionRecordIndexEntry | src/shared/types.ts:948 | 2 |
| ProductionRecord | legacySourceCandidates | 선택 | {recordId:string;companyId:CompanyId;itemId:string;note:string}[] | src/shared/types.ts:949 | 2 |
| ProductionRecord | id | 필수 | string | src/shared/types.ts:950 | 32 |
| ProductionRecord | companyId | 선택 | CompanyId | src/shared/types.ts:951 | 1 |
| ProductionRecord | orderId | 선택 | string | src/shared/types.ts:952 | 7 |
| ProductionRecord | lineId | 선택 | string | src/shared/types.ts:953 | 12 |
| ProductionRecord | generation | 선택 | import('./orderInventoryGeneration').OrderInventoryGeneration | src/shared/types.ts:954 | 5 |
| ProductionRecord | date | 필수 | string | src/shared/types.ts:955 | 5 |
| ProductionRecord | itemId | 필수 | string | src/shared/types.ts:956 | 11 |
| ProductionRecord | itemName | 필수 | string | src/shared/types.ts:957 | 4 |
| ProductionRecord | finishedQty | 필수 | number | src/shared/types.ts:958 | 5 |
| ProductionRecord | wipUsed | 선택 | number | src/shared/types.ts:959 | 1 |
| ProductionRecord | wipItemId | 선택 | string | src/shared/types.ts:960 | 0 |
| ProductionRecord | wipItemName | 선택 | string | src/shared/types.ts:961 | 2 |
| ProductionRecord | cost | 선택 | number | src/shared/types.ts:962 | 1 |
| ProductionRecord | note | 선택 | string | src/shared/types.ts:963 | 3 |
| ProductionRecord | createdBy | 선택 | string | src/shared/types.ts:964 | 0 |
| ProductionRecord | createdAt | 필수 | string | src/shared/types.ts:965 | 1 |
| FixedCostEntry | id | 필수 | string | src/shared/types.ts:972 | 0 |
| FixedCostEntry | yearMonth | 필수 | string | src/shared/types.ts:973 | 1 |
| FixedCostEntry | category | 필수 | FixedCostCategory | src/shared/types.ts:974 | 0 |
| FixedCostEntry | label | 필수 | string | src/shared/types.ts:975 | 0 |
| FixedCostEntry | amount | 필수 | number | src/shared/types.ts:976 | 1 |
| FixedCostEntry | accountCode | 선택 | string | src/shared/types.ts:977 | 0 |
| FixedCostEntry | note | 선택 | string | src/shared/types.ts:978 | 0 |
| FixedCostEntry | createdAt | 필수 | string | src/shared/types.ts:979 | 0 |
| FixedCostTemplate | statementType | 선택 | '매출' \| '매입' \| '비용' | src/shared/types.ts:983 | 2 |
| FixedCostTemplate | companyId | 선택 | CompanyId | src/shared/types.ts:993 | 3 |
| FixedCostTemplate | transferLines | 선택 | { accountCode: string; side: '차변' \| '대변'; name?: string }[] | src/shared/types.ts:995 | 7 |
| FixedCostTemplate | id | 필수 | string | src/shared/types.ts:996 | 16 |
| FixedCostTemplate | name | 필수 | string | src/shared/types.ts:997 | 19 |
| FixedCostTemplate | amount | 필수 | number | src/shared/types.ts:998 | 14 |
| FixedCostTemplate | category | 필수 | FixedCostCategory | src/shared/types.ts:999 | 1 |
| FixedCostTemplate | active | 필수 | boolean | src/shared/types.ts:1000 | 1 |
| FixedCostTemplate | note | 선택 | string | src/shared/types.ts:1001 | 1 |
| FixedCostTemplate | accountCode | 선택 | string | src/shared/types.ts:1003 | 15 |
| FixedCostTemplate | partnerId | 선택 | string | src/shared/types.ts:1004 | 4 |
| FixedCostTemplate | partnerName | 선택 | string | src/shared/types.ts:1005 | 11 |
| FixedCostTemplate | startYm | 선택 | string | src/shared/types.ts:1006 | 2 |
| FixedCostTemplate | endYm | 선택 | string | src/shared/types.ts:1007 | 1 |
| FixedCostTemplate | kind | 선택 | 'recurring' \| 'voucher' | src/shared/types.ts:1012 | 3 |
| FixedCostTemplate | dir | 선택 | '입금' \| '출금' \| '줄돈' \| '받을돈' \| '대체' \| '회사이체' | src/shared/types.ts:1025 | 3 |
| FixedCostTemplate | mode | 선택 | '일반' \| '상환' \| '급여' \| '보험' \| '세금' | src/shared/types.ts:1026 | 22 |
| FixedCostTemplate | insCorp | 선택 | number | src/shared/types.ts:1038 | 1 |
| FixedCostTemplate | insEmp | 선택 | number | src/shared/types.ts:1038 | 1 |
| FixedCostTemplate | principal | 선택 | number | src/shared/types.ts:1039 | 4 |
| FixedCostTemplate | interest | 선택 | number | src/shared/types.ts:1039 | 4 |
| FixedCostTemplate | gross | 선택 | number | src/shared/types.ts:1040 | 1 |
| FixedCostTemplate | deduction | 선택 | number | src/shared/types.ts:1040 | 1 |
| FixedCostTemplate | loanCode | 선택 | string | src/shared/types.ts:1042 | 4 |
| FixedCostTemplate | loanId | 선택 | string | src/shared/types.ts:1044 | 6 |
| FixedCostTemplate | vat | 선택 | number | src/shared/types.ts:1046 | 0 |
| FixedCostTemplate | incomeTax | 선택 | number | src/shared/types.ts:1046 | 0 |
| FixedCostTemplate | builtin | 선택 | string | src/shared/types.ts:1048 | 8 |
| FixedCostTemplate | hidden | 선택 | boolean | src/shared/types.ts:1050 | 6 |
| FixedCostTemplate | group | 선택 | string | src/shared/types.ts:1052 | 10 |
| FixedCostTemplate | favorite | 선택 | boolean | src/shared/types.ts:1054 | 6 |
| FixedCostTemplate | autoIssue | 선택 | boolean | src/shared/types.ts:1057 | 12 |
| FixedCostTemplate | issueDay | 선택 | number | src/shared/types.ts:1059 | 11 |
| FixedCostTemplate | taxExempt | 선택 | boolean | src/shared/types.ts:1061 | 2 |
| FixedCostTemplate | itemName | 선택 | string | src/shared/types.ts:1066 | 2 |
| IssuedStatementItem | sourceLineIndex | 선택 | number | src/shared/types.ts:1088 | 1 |
| IssuedStatementItem | purchaseQuantityKg | 선택 | number | src/shared/types.ts:1090 | 2 |
| IssuedStatementItem | itemId | 선택 | string | src/shared/types.ts:1092 | 16 |
| IssuedStatementItem | lineKind | 선택 | StatementLineKind | src/shared/types.ts:1094 | 1 |
| IssuedStatementItem | name | 필수 | string | src/shared/types.ts:1095 | 31 |
| IssuedStatementItem | spec | 필수 | string | src/shared/types.ts:1096 | 6 |
| IssuedStatementItem | qty | 필수 | number | src/shared/types.ts:1097 | 23 |
| IssuedStatementItem | price | 필수 | number | src/shared/types.ts:1098 | 5 |
| IssuedStatementItem | supply | 필수 | number | src/shared/types.ts:1099 | 17 |
| IssuedStatementItem | tax | 필수 | number | src/shared/types.ts:1100 | 13 |
| IssuedStatementItem | total | 필수 | number | src/shared/types.ts:1101 | 23 |
| IssuedStatementItem | isTaxExempt | 필수 | boolean | src/shared/types.ts:1102 | 5 |
| IssuedStatementItem | accountCode | 선택 | string | src/shared/types.ts:1107 | 21 |
| IssuedStatementItem | side | 선택 | '차변' \| '대변' | src/shared/types.ts:1120 | 15 |
| StatementParty | name | 필수 | string | src/shared/types.ts:1125 | 0 |
| StatementParty | bizNo | 필수 | string | src/shared/types.ts:1126 | 0 |
| StatementParty | ceo | 필수 | string | src/shared/types.ts:1127 | 0 |
| StatementParty | addr | 필수 | string | src/shared/types.ts:1128 | 0 |
| StatementParty | bizType | 필수 | string | src/shared/types.ts:1129 | 0 |
| StatementParty | bizItem | 필수 | string | src/shared/types.ts:1130 | 0 |
| StatementParty | tel | 필수 | string | src/shared/types.ts:1131 | 0 |
| StatementParty | fax | 필수 | string | src/shared/types.ts:1132 | 0 |
| StatementPartySnapshot | supplier | 필수 | StatementParty | src/shared/types.ts:1136 | 1 |
| StatementPartySnapshot | buyer | 필수 | StatementParty | src/shared/types.ts:1137 | 1 |
| IssuedStatement | noncashApplication | 선택 | import('../../functions/src/shared/partnerAdvance').ApplicationMetadata \| import('../../functions/src/shared/partnerAdvance').CancellationMetadata | src/shared/types.ts:1141 | 9 |
| IssuedStatement | id | 필수 | string | src/shared/types.ts:1142 | 174 |
| IssuedStatement | mutationRevision | 선택 | number | src/shared/types.ts:1144 | 4 |
| IssuedStatement | openingItemId | 선택 | string | src/shared/types.ts:1146 | 0 |
| IssuedStatement | openingQuantity | 선택 | number | src/shared/types.ts:1147 | 0 |
| IssuedStatement | companyId | 선택 | CompanyId | src/shared/types.ts:1149 | 15 |
| IssuedStatement | issuedAt | 필수 | string | src/shared/types.ts:1150 | 15 |
| IssuedStatement | tradeDate | 필수 | string | src/shared/types.ts:1151 | 96 |
| IssuedStatement | type | 필수 | '매출' \| '매입' \| '비용' | src/shared/types.ts:1152 | 76 |
| IssuedStatement | partnerId | 필수 | string | src/shared/types.ts:1153 | 84 |
| IssuedStatement | partnerName | 필수 | string | src/shared/types.ts:1154 | 40 |
| IssuedStatement | orderId | 필수 | string | src/shared/types.ts:1155 | 9 |
| IssuedStatement | docNo | 필수 | string | src/shared/types.ts:1156 | 46 |
| IssuedStatement | totalSupply | 필수 | number | src/shared/types.ts:1157 | 8 |
| IssuedStatement | totalTax | 필수 | number | src/shared/types.ts:1158 | 9 |
| IssuedStatement | totalAmount | 필수 | number | src/shared/types.ts:1159 | 66 |
| IssuedStatement | items | 필수 | IssuedStatementItem[] | src/shared/types.ts:1160 | 66 |
| IssuedStatement | partySnapshot | 선택 | StatementPartySnapshot | src/shared/types.ts:1162 | 3 |
| IssuedStatement | memo | 선택 | string | src/shared/types.ts:1167 | 6 |
| IssuedStatement | createdBy | 선택 | string | src/shared/types.ts:1175 | 4 |
| IssuedStatement | evidence | 선택 | string | src/shared/types.ts:1183 | 0 |
| IssuedStatement | taxIssuedAt | 선택 | string | src/shared/types.ts:1184 | 9 |
| IssuedStatement | exemptIssuedAt | 선택 | string | src/shared/types.ts:1190 | 0 |
| IssuedStatement | cashDir | 선택 | '입금' \| '출금' | src/shared/types.ts:1191 | 0 |
| PurchaseOrderItem | sourceLineIndex | 선택 | number | src/shared/types.ts:1209 | 4 |
| PurchaseOrderItem | itemId | 필수 | string | src/shared/types.ts:1210 | 50 |
| PurchaseOrderItem | name | 필수 | string | src/shared/types.ts:1211 | 24 |
| PurchaseOrderItem | quantity | 필수 | number | src/shared/types.ts:1213 | 29 |
| PurchaseOrderItem | unit | 필수 | string | src/shared/types.ts:1214 | 12 |
| PurchaseOrderItem | boxQuantity | 선택 | number | src/shared/types.ts:1220 | 0 |
| PurchaseOrder | id | 필수 | string | src/shared/types.ts:1224 | 107 |
| PurchaseOrder | companyId | 선택 | CompanyId | src/shared/types.ts:1226 | 6 |
| PurchaseOrder | itemId | 필수 | string | src/shared/types.ts:1227 | 5 |
| PurchaseOrder | itemName | 필수 | string | src/shared/types.ts:1228 | 1 |
| PurchaseOrder | partnerId | 선택 | string | src/shared/types.ts:1229 | 15 |
| PurchaseOrder | partnerName | 선택 | string | src/shared/types.ts:1230 | 22 |
| PurchaseOrder | quantity | 필수 | number | src/shared/types.ts:1231 | 11 |
| PurchaseOrder | unit | 선택 | string | src/shared/types.ts:1232 | 1 |
| PurchaseOrder | boxQuantity | 선택 | number | src/shared/types.ts:1234 | 1 |
| PurchaseOrder | status | 필수 | 'pending' \| 'invoiced' \| 'received' \| 'cancelled' | src/shared/types.ts:1235 | 60 |
| PurchaseOrder | duplicateReceiptCorrection | 선택 | {operationId:string;originalOperationId:string;commandHash:string;originalHash:string;proofHash:string;kg:number;reason:string;cancelledAt:string} | src/shared/types.ts:1236 | 2 |
| PurchaseOrder | confirmedByUser | 선택 | boolean | src/shared/types.ts:1237 | 1 |
| PurchaseOrder | linkedStatementId | 선택 | string | src/shared/types.ts:1238 | 25 |
| PurchaseOrder | cardNo | 선택 | string | src/shared/types.ts:1243 | 2 |
| PurchaseOrder | linkedStatementAt | 선택 | string | src/shared/types.ts:1244 | 0 |
| PurchaseOrder | createdAt | 필수 | string | src/shared/types.ts:1245 | 11 |
| PurchaseOrder | invoicedAt | 선택 | string | src/shared/types.ts:1246 | 6 |
| PurchaseOrder | receivedAt | 선택 | string | src/shared/types.ts:1247 | 7 |
| PurchaseOrder | items | 선택 | PurchaseOrderItem[] | src/shared/types.ts:1248 | 16 |
| PurchaseOrder | photoUrl | 선택 | string | src/shared/types.ts:1249 | 0 |
| PurchaseOrder | note | 선택 | string | src/shared/types.ts:1250 | 0 |
| PurchaseOrder | poType | 선택 | 'oem' | src/shared/types.ts:1254 | 36 |
| PurchaseOrder | oemCostEvidence | 선택 | OemCostEvidence | src/shared/types.ts:1256 | 7 |
| PurchaseOrder | oemCostEvidenceSource | 선택 | 'issue' \| 'receipt' | src/shared/types.ts:1258 | 0 |
| PurchaseOrder | oemBatchCost | 선택 | OemBatchCostPreview \| OemBatchCostBlocked \| OemBatchCost | src/shared/types.ts:1260 | 2 |
| PurchaseOrder | oemPartnerId | 선택 | string | src/shared/types.ts:1261 | 3 |
| PurchaseOrder | oemSent | 선택 | { material: string; kg: number; rawItemId?: string }[] | src/shared/types.ts:1262 | 16 |
| PurchaseOrder | oemSentAt | 선택 | string | src/shared/types.ts:1263 | 1 |
| PurchaseOrder | oemIssueStatus | 선택 | 'processing' \| 'failed' \| 'complete' | src/shared/types.ts:1265 | 4 |
| PurchaseOrder | oemCancelledAt | 선택 | string | src/shared/types.ts:1266 | 26 |
| PurchaseOrder | oemCancelOperationId | 선택 | string | src/shared/types.ts:1267 | 13 |
| PurchaseOrder | oemIssueFingerprint | 선택 | string | src/shared/types.ts:1268 | 3 |
| PurchaseOrder | oemIssueDate | 선택 | string | src/shared/types.ts:1269 | 4 |
| PurchaseOrder | oemIssuedBy | 선택 | string | src/shared/types.ts:1270 | 1 |
| PurchaseOrder | oemIssueError | 선택 | string | src/shared/types.ts:1271 | 0 |
| PurchaseOrder | oemReceivedKg | 선택 | number | src/shared/types.ts:1272 | 7 |
| PurchaseOrder | oemReceivedBulk | 선택 | { material: string; kg: number }[] | src/shared/types.ts:1273 | 5 |
| PurchaseOrder | oemFeePerKg | 선택 | number | src/shared/types.ts:1274 | 3 |
| PurchaseOrder | oemReceiptOperationId | 선택 | string | src/shared/types.ts:1276 | 4 |
| CompanyInfo | name | 필수 | string | src/shared/types.ts:1310 | 5 |
| CompanyInfo | ceoName | 필수 | string | src/shared/types.ts:1311 | 3 |
| CompanyInfo | bizNo | 필수 | string | src/shared/types.ts:1312 | 3 |
| CompanyInfo | bizType | 필수 | string | src/shared/types.ts:1313 | 2 |
| CompanyInfo | bizItem | 필수 | string | src/shared/types.ts:1314 | 2 |
| CompanyInfo | address | 필수 | string | src/shared/types.ts:1315 | 3 |
| CompanyInfo | phone | 선택 | string | src/shared/types.ts:1316 | 2 |
| CompanyInfo | fax | 선택 | string | src/shared/types.ts:1317 | 2 |
| CompanyInfo | email | 선택 | string | src/shared/types.ts:1318 | 0 |
| CompanyInfo | bankAccount | 선택 | string | src/shared/types.ts:1319 | 3 |
| CompanyInfo | adminPassword | 선택 | string | src/shared/types.ts:1320 | 2 |
| ExpensePreset | id | 필수 | string | src/shared/types.ts:1325 | 2 |
| ExpensePreset | name | 필수 | string | src/shared/types.ts:1326 | 2 |
| ExpensePreset | price | 선택 | number | src/shared/types.ts:1327 | 2 |
| ExpensePreset | taxType | 선택 | '과세' \| '면세' | src/shared/types.ts:1328 | 1 |
| ExpensePreset | createdAt | 선택 | string | src/shared/types.ts:1329 | 0 |
| AppNotification | id | 필수 | string | src/shared/types.ts:1333 | 5 |
| AppNotification | type | 필수 | 'new_order' \| 'confirmation' \| 'mention' \| 'leave_request' \| 'inventory_shortage' | src/shared/types.ts:1334 | 8 |
| AppNotification | title | 필수 | string | src/shared/types.ts:1335 | 1 |
| AppNotification | body | 필수 | string | src/shared/types.ts:1336 | 3 |
| AppNotification | readBy | 필수 | string[] | src/shared/types.ts:1337 | 4 |
| AppNotification | dismissedBy | 선택 | string[] | src/shared/types.ts:1338 | 1 |
| AppNotification | createdAt | 필수 | string | src/shared/types.ts:1339 | 3 |
| AppNotification | linkedId | 선택 | string | src/shared/types.ts:1340 | 4 |
| AppNotification | senderId | 선택 | string | src/shared/types.ts:1341 | 0 |
| AppNotification | targetId | 선택 | string | src/shared/types.ts:1342 | 2 |
| RawMaterialEntry | id | 필수 | string | src/shared/types.ts:1360 | 59 |
| RawMaterialEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1362 | 6 |
| RawMaterialEntry | rawItemId | 선택 | string | src/shared/types.ts:1373 | 13 |
| RawMaterialEntry | kind | 선택 | RawMovementKind | src/shared/types.ts:1374 | 17 |
| RawMaterialEntry | reversalOf | 선택 | string | src/shared/types.ts:1375 | 6 |
| RawMaterialEntry | material | 필수 | string | src/shared/types.ts:1377 | 40 |
| RawMaterialEntry | date | 필수 | string | src/shared/types.ts:1378 | 24 |
| RawMaterialEntry | received | 필수 | number | src/shared/types.ts:1379 | 21 |
| RawMaterialEntry | used | 필수 | number | src/shared/types.ts:1380 | 26 |
| RawMaterialEntry | note | 필수 | string | src/shared/types.ts:1381 | 14 |
| RawMaterialEntry | createdAt | 필수 | string | src/shared/types.ts:1382 | 17 |
| RawMaterialEntry | recordedAt | 선택 | string | src/shared/types.ts:1384 | 7 |
| RawMaterialEntry | sequence | 선택 | number | src/shared/types.ts:1386 | 3 |
| RawMaterialEntry | effectiveAt | 선택 | string | src/shared/types.ts:1388 | 15 |
| RawMaterialEntry | balanceAfterKg | 선택 | number | src/shared/types.ts:1390 | 3 |
| RawMaterialEntry | addedBy | 선택 | string | src/shared/types.ts:1391 | 10 |
| RawMaterialEntry | type | 선택 | 'auto' \| 'manual' \| 'correction' \| 'stocktake_unit' | src/shared/types.ts:1392 | 16 |
| RawMaterialEntry | orderId | 선택 | string | src/shared/types.ts:1393 | 2 |
| RawMaterialEntry | canSize | 선택 | number | src/shared/types.ts:1394 | 2 |
| RawMaterialEntry | canSizeTag | 선택 | string | src/shared/types.ts:1395 | 2 |
| RawMaterialEntry | canCount | 선택 | number | src/shared/types.ts:1396 | 4 |
| RawMaterialEntry | unit | 선택 | 'kg' \| 'L' | src/shared/types.ts:1397 | 7 |
| RawMaterialEntry | originalAmount | 선택 | number | src/shared/types.ts:1399 | 2 |
| RawMaterialEntry | originalUnit | 선택 | 'kg' \| 'L' | src/shared/types.ts:1400 | 2 |
| RawMaterialEntry | targetKg | 선택 | number | src/shared/types.ts:1401 | 17 |
| RawMaterialEntry | targetLotId | 선택 | string | src/shared/types.ts:1403 | 8 |
| ItemFormula | id | 필수 | string | src/shared/types.ts:1411 | 1 |
| ItemFormula | parent_key | 필수 | string | src/shared/types.ts:1412 | 10 |
| ItemFormula | child_name | 필수 | string | src/shared/types.ts:1413 | 6 |
| ItemFormula | ratio | 필수 | number | src/shared/types.ts:1414 | 5 |
| ItemFormula | yield_rate | 필수 | number | src/shared/types.ts:1415 | 4 |
| ItemBom | id | 필수 | string | src/shared/types.ts:1420 | 4 |
| ItemBom | parent_id | 필수 | string | src/shared/types.ts:1421 | 14 |
| ItemBom | child_id | 필수 | string | src/shared/types.ts:1422 | 11 |
| ItemBom | quantity | 필수 | number | src/shared/types.ts:1423 | 3 |
| ReturnItem | sourceLineIndex | 선택 | number | src/shared/types.ts:1432 | 1 |
| ReturnItem | itemId | 필수 | string | src/shared/types.ts:1433 | 17 |
| ReturnItem | name | 필수 | string | src/shared/types.ts:1434 | 8 |
| ReturnItem | quantity | 필수 | number | src/shared/types.ts:1435 | 14 |
| ReturnItem | price | 필수 | number | src/shared/types.ts:1436 | 3 |
| ReturnItem | reason | 필수 | ReturnReason | src/shared/types.ts:1437 | 3 |
| ReturnItem | isResellable | 필수 | boolean | src/shared/types.ts:1438 | 8 |
| ReturnItem | supply | 선택 | number | src/shared/types.ts:1439 | 0 |
| ReturnItem | tax | 선택 | number | src/shared/types.ts:1440 | 0 |
| ReturnItem | accountCode | 선택 | string | src/shared/types.ts:1441 | 0 |
| ReturnRequest | id | 필수 | string | src/shared/types.ts:1445 | 19 |
| ReturnRequest | companyId | 선택 | CompanyId | src/shared/types.ts:1446 | 5 |
| ReturnRequest | orderId | 선택 | string | src/shared/types.ts:1447 | 2 |
| ReturnRequest | partnerId | 필수 | string | src/shared/types.ts:1448 | 3 |
| ReturnRequest | partnerName | 필수 | string | src/shared/types.ts:1449 | 6 |
| ReturnRequest | items | 필수 | ReturnItem[] | src/shared/types.ts:1450 | 17 |
| ReturnRequest | totalAmount | 필수 | number | src/shared/types.ts:1451 | 5 |
| ReturnRequest | status | 필수 | 'pending' \| 'processed' | src/shared/types.ts:1452 | 18 |
| ReturnRequest | returnType | 선택 | '매출' \| '매입' | src/shared/types.ts:1453 | 4 |
| ReturnRequest | createdAt | 필수 | string | src/shared/types.ts:1454 | 7 |
| ReturnRequest | createdBy | 선택 | string | src/shared/types.ts:1455 | 0 |
| ReturnRequest | processedAt | 선택 | string | src/shared/types.ts:1456 | 4 |
| ReturnRequest | processedBy | 선택 | string | src/shared/types.ts:1457 | 1 |
| ReturnRequest | cancelledAt | 선택 | string | src/shared/types.ts:1458 | 16 |
| ReturnRequest | cancelledBy | 선택 | string | src/shared/types.ts:1459 | 0 |
| ReturnRequest | cancellationReceipt | 선택 | Record<string, unknown> | src/shared/types.ts:1460 | 0 |
| ReturnRequest | linkedStatementId | 선택 | string | src/shared/types.ts:1461 | 8 |
| ReturnRequest | payableAccountCode | 선택 | typeof AP \| typeof OTHER_PAYABLE | src/shared/types.ts:1462 | 0 |
| ReturnRequest | note | 선택 | string | src/shared/types.ts:1463 | 3 |
| PendingStatementEdit | id | 필수 | string | src/shared/types.ts:1467 | 11 |
| PendingStatementEdit | statementId | 필수 | string | src/shared/types.ts:1468 | 2 |
| PendingStatementEdit | statementDocNo | 필수 | string | src/shared/types.ts:1469 | 1 |
| PendingStatementEdit | statementType | 필수 | '매출' \| '매입' | src/shared/types.ts:1470 | 1 |
| PendingStatementEdit | partnerName | 필수 | string | src/shared/types.ts:1471 | 1 |
| PendingStatementEdit | proposedData | 필수 | {     tradeDate: string;     partnerId: string;     partnerName: string;     totalSupply: number;     totalTax: number;     totalAmount: number;     items: IssuedStatementItem[];   } | src/shared/types.ts:1472 | 3 |
| PendingStatementEdit | createdAt | 필수 | string | src/shared/types.ts:1481 | 2 |
| PendingStatementEdit | createdBy | 필수 | string | src/shared/types.ts:1482 | 1 |
| PendingStatementEdit | status | 필수 | 'pending' \| 'approved' \| 'rejected' | src/shared/types.ts:1483 | 1 |
| PendingStatementEdit | reason | 선택 | string | src/shared/types.ts:1484 | 1 |
| PendingStatementEdit | changes | 선택 | { name: string; oldQty: number; newQty: number }[] | src/shared/types.ts:1485 | 2 |
| PendingStatementEdit | sourcePoId | 선택 | string | src/shared/types.ts:1486 | 0 |
| AccountCode | id | 필수 | string | src/shared/types.ts:1493 | 27 |
| AccountCode | code | 필수 | string | src/shared/types.ts:1494 | 104 |
| AccountCode | name | 필수 | string | src/shared/types.ts:1495 | 60 |
| AccountCode | groupId | 선택 | string | src/shared/types.ts:1496 | 11 |
| AccountCode | type | 선택 | AccountType | src/shared/types.ts:1498 | 18 |
| AccountCode | normalBalance | 선택 | 'debit' \| 'credit' | src/shared/types.ts:1499 | 10 |
| AccountCode | isCash | 선택 | boolean | src/shared/types.ts:1500 | 1 |
| AccountCode | noncash | 선택 | boolean | src/shared/types.ts:1505 | 0 |
| AccountCode | note | 선택 | string | src/shared/types.ts:1506 | 0 |
| JournalLine | accountCode | 필수 | string | src/shared/types.ts:1511 | 37 |
| JournalLine | debit | 필수 | number | src/shared/types.ts:1512 | 35 |
| JournalLine | credit | 필수 | number | src/shared/types.ts:1513 | 31 |
| JournalLine | partnerId | 선택 | string | src/shared/types.ts:1514 | 13 |
| JournalLine | note | 선택 | string | src/shared/types.ts:1515 | 1 |
| JournalEntry | id | 필수 | string | src/shared/types.ts:1519 | 10 |
| JournalEntry | date | 필수 | string | src/shared/types.ts:1520 | 17 |
| JournalEntry | lines | 필수 | JournalLine[] | src/shared/types.ts:1521 | 33 |
| JournalEntry | memo | 선택 | string | src/shared/types.ts:1522 | 3 |
| JournalEntry | sourceType | 필수 | '매출' \| '매입' \| '대체' \| '자금' \| '수동' | src/shared/types.ts:1523 | 9 |
| JournalEntry | sourceId | 선택 | string | src/shared/types.ts:1524 | 16 |
| JournalEntry | createdAt | 필수 | string | src/shared/types.ts:1525 | 0 |
| JournalEntry | createdBy | 선택 | string | src/shared/types.ts:1526 | 0 |
| AccountGroup | id | 필수 | string | src/shared/types.ts:1534 | 24 |
| AccountGroup | name | 필수 | string | src/shared/types.ts:1535 | 9 |
| AccountGroup | type | 필수 | '수익' \| '비용' \| '자산' \| '부채' \| '자본' | src/shared/types.ts:1536 | 6 |
| AccountGroup | plLine | 선택 | AccountGroupPlLine | src/shared/types.ts:1537 | 4 |
| AccountGroup | cfSection | 선택 | AccountGroupCfSection | src/shared/types.ts:1540 | 1 |
| AccountGroup | note | 선택 | string | src/shared/types.ts:1541 | 0 |
| CashAccount | id | 필수 | string | src/shared/types.ts:1549 | 37 |
| CashAccount | companyId | 선택 | CompanyId | src/shared/types.ts:1551 | 1 |
| CashAccount | name | 필수 | string | src/shared/types.ts:1552 | 14 |
| CashAccount | type | 필수 | '통장' \| '카드' \| '현금' | src/shared/types.ts:1553 | 17 |
| CashAccount | openingBalance | 필수 | number | src/shared/types.ts:1554 | 3 |
| CashAccount | openingDate | 필수 | string | src/shared/types.ts:1555 | 8 |
| CashAccount | active | 필수 | boolean | src/shared/types.ts:1556 | 20 |
| CashAccount | note | 선택 | string | src/shared/types.ts:1557 | 0 |
| CashAccount | confirmedBalances | 선택 | Array<{ date: string; balance: number; recordedAt: string; reason: string }> | src/shared/types.ts:1558 | 2 |
| CashAccount | createdAt | 필수 | string | src/shared/types.ts:1559 | 0 |
| CashEntry | id | 필수 | string | src/shared/types.ts:1563 | 80 |
| CashEntry | balanceAdjustment | 선택 | { before: number; target: number; delta: number; reason: string; confirmedBalance?: boolean } | src/shared/types.ts:1565 | 15 |
| CashEntry | linkedAccrualStatementId | 선택 | string | src/shared/types.ts:1567 | 2 |
| CashEntry | loanId | 선택 | string | src/shared/types.ts:1569 | 9 |
| CashEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1571 | 6 |
| CashEntry | docNo | 선택 | string | src/shared/types.ts:1577 | 10 |
| CashEntry | date | 필수 | string | src/shared/types.ts:1578 | 45 |
| CashEntry | cashAccountId | 필수 | string | src/shared/types.ts:1579 | 12 |
| CashEntry | dir | 필수 | '입금' \| '출금' \| '대체' | src/shared/types.ts:1590 | 49 |
| CashEntry | amount | 필수 | number | src/shared/types.ts:1591 | 31 |
| CashEntry | partnerId | 선택 | string | src/shared/types.ts:1592 | 49 |
| CashEntry | partnerName | 선택 | string | src/shared/types.ts:1593 | 18 |
| CashEntry | accountCode | 선택 | string | src/shared/types.ts:1594 | 24 |
| CashEntry | lines | 선택 | {     accountCode: string;     /**      * **언제나 양수로 적는다.** 차·대는 `side`가 말한다.      *      * `side`가 없는 옛 줄은 **부호가 곧 차·대**였다 — 양수면 통장 반대편, 음수면      * 통장과 같은 편(급여 원천공제가 그 길). 그 규칙은 `dir`에 매달려 있어서      * 입금·출금을 바꾸면 모든 줄의 뜻이 조용히 뒤집혔다. 읽는 쪽은 아직 그 줄도      * 받아 주지만(옛 데이터 호환), **새로 쓸 땐 `side`를 넣는다.**      */     amount: number;     /** 차변이냐 대변이냐. 대체전표 줄(`IssuedStatementItem.side`)과 같은 모양이다. */     side?: '차변' \| '대변';     note?: string;   }[] | src/shared/types.ts:1601 | 28 |
| CashEntry | offsetOf | 선택 | { ar: string; ap: string } | src/shared/types.ts:1617 | 0 |
| CashEntry | note | 선택 | string | src/shared/types.ts:1618 | 23 |
| CashEntry | createdAt | 필수 | string | src/shared/types.ts:1619 | 15 |
| CashEntry | createdBy | 선택 | string | src/shared/types.ts:1620 | 5 |
| Settlement | id | 필수 | string | src/shared/types.ts:1626 | 9 |
| Settlement | cashEntryId | 필수 | string | src/shared/types.ts:1627 | 17 |
| Settlement | statementId | 필수 | string | src/shared/types.ts:1628 | 14 |
| Settlement | amount | 필수 | number | src/shared/types.ts:1629 | 9 |
| Settlement | createdAt | 필수 | string | src/shared/types.ts:1630 | 0 |
| InventorySnapshot | id | 필수 | string | src/shared/types.ts:1634 | 5 |
| InventorySnapshot | companyId | 선택 | CompanyId | src/shared/types.ts:1637 | 0 |
| InventorySnapshot | yearMonth | 필수 | string | src/shared/types.ts:1638 | 8 |
| InventorySnapshot | value | 필수 | number | src/shared/types.ts:1639 | 5 |
| InventorySnapshot | recordedAt | 필수 | string | src/shared/types.ts:1640 | 1 |
| InventorySnapshot | items | 선택 | { itemId: string; name: string; category?: string; spec?: string; qty: number; value: number }[] | src/shared/types.ts:1643 | 3 |
| CashFlowManual | id | 필수 | string | src/shared/types.ts:1648 | 0 |
| CashFlowManual | month | 필수 | string | src/shared/types.ts:1649 | 3 |
| CashFlowManual | depreciation | 선택 | number | src/shared/types.ts:1650 | 1 |
| CashFlowManual | prepaidInc | 선택 | number | src/shared/types.ts:1651 | 1 |
| CashFlowManual | assetBuy | 선택 | number | src/shared/types.ts:1652 | 1 |
| CashFlowManual | assetSell | 선택 | number | src/shared/types.ts:1653 | 1 |
| CashFlowManual | financeIn | 선택 | number | src/shared/types.ts:1654 | 1 |
| CashFlowManual | debtRepay | 선택 | number | src/shared/types.ts:1655 | 1 |
| CashFlowManual | openingCash | 선택 | number | src/shared/types.ts:1656 | 4 |
| CashFlowManual | closingCash | 선택 | number | src/shared/types.ts:1657 | 4 |
| ProductionSalesLog | id | 필수 | string | src/shared/types.ts:1661 | 10 |
| ProductionSalesLog | companyId | 선택 | CompanyId | src/shared/types.ts:1662 | 1 |
| ProductionSalesLog | date | 필수 | string | src/shared/types.ts:1663 | 12 |
| ProductionSalesLog | createdAt | 필수 | string | src/shared/types.ts:1664 | 2 |
| ProductionSalesLog | createdBy | 필수 | string | src/shared/types.ts:1665 | 2 |
| ProductionSalesLog | orderCount | 필수 | number | src/shared/types.ts:1666 | 3 |
| ProductionSalesLog | productionRows | 필수 | { groupLabel: string; spec: string; 수량: number; 소비기한: string; 비고: string }[] | src/shared/types.ts:1668 | 2 |
| ProductionSalesLog | seedRows | 선택 | { 품목: string; 용량: string; 수량: number; 소비기한: string; 비고: string }[] | src/shared/types.ts:1670 | 2 |
| ProductionSalesLog | salesRows | 선택 | { 상호: string; 품목: string; 용량: string; 수량: number; 소비기한: string }[] | src/shared/types.ts:1672 | 5 |
| ProductionSalesLog | extraRows | 선택 | { 품목: string; 용량: string; 수량: number; 거래처: string }[] | src/shared/types.ts:1674 | 1 |
| ProductionSalesLog | orderSummaries | 필수 | { partnerName: string; items: { name: string; qty: number }[] }[] | src/shared/types.ts:1676 | 1 |
| AdjustmentRequest | id | 필수 | string | src/shared/types.ts:1684 | 20 |
| AdjustmentRequest | companyId | 선택 | CompanyId | src/shared/types.ts:1685 | 1 |
| AdjustmentRequest | itemId | 필수 | string | src/shared/types.ts:1686 | 9 |
| AdjustmentRequest | itemName | 필수 | string | src/shared/types.ts:1687 | 3 |
| AdjustmentRequest | originalQuantity | 필수 | number | src/shared/types.ts:1688 | 6 |
| AdjustmentRequest | requestedQuantity | 선택 | number | src/shared/types.ts:1689 | 9 |
| AdjustmentRequest | type | 필수 | AdjustmentType | src/shared/types.ts:1690 | 31 |
| AdjustmentRequest | reason | 필수 | string | src/shared/types.ts:1691 | 4 |
| AdjustmentRequest | status | 필수 | AdjustmentStatus | src/shared/types.ts:1692 | 11 |
| AdjustmentRequest | requestedAt | 필수 | string | src/shared/types.ts:1693 | 4 |
| AdjustmentRequest | processedAt | 선택 | string | src/shared/types.ts:1694 | 3 |
| AdjustmentRequest | unit | 선택 | string | src/shared/types.ts:1695 | 4 |
| AdjustmentRequest | oemPoId | 선택 | string | src/shared/types.ts:1697 | 3 |
| AdjustmentRequest | oemFeePerKg | 선택 | number | src/shared/types.ts:1698 | 5 |
| AdjustmentRequest | oemTotal | 선택 | number | src/shared/types.ts:1699 | 2 |
