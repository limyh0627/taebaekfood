/**
 * **Firestore 컬렉션 이름은 여기 하나에 적는다.**
 *
 * 50여 개 이름이 앱 곳곳에 글자로 흩어져 있었다(2026-09-05). 글자로 쓰면 오타가
 * **조용히 지나간다** — `'issuedStatments'` 라고 쓰면 없는 컬렉션이 새로 생기고,
 * 쓴 쪽은 성공했다고 여기고 읽는 쪽은 영영 빈 목록을 본다. 화면에는 아무 표시도 안 난다.
 *
 * 여기 모아 두면 오타가 **컴파일에서 걸린다.**
 *
 * 지금 있는 이름을 그대로 옮겨 적은 것이다 — **DB 를 바꾸는 게 아니다.**
 */
export const COL = {
  // ── 품목·거래처 ──
  items: 'items',
  itemBom: 'item_bom',
  partners: 'partners',
  partnerItem: 'partner_item',
  itemReceipts: 'itemReceipts',
  itemTaxonomy: 'itemTaxonomy',
  itemPack: 'item_pack',
  itemFormula: 'item_formula',

  // ── 주문·발주 ──
  orders: 'orders',
  purchaseOrders: 'purchaseOrders',
  returnRequests: 'returnRequests',
  adjustmentRequests: 'adjustmentRequests',
  workOrderItems: 'workOrderItems',

  // ── 전표·회계 ──
  issuedStatements: 'issuedStatements',
  pendingStatementEdits: 'pendingStatementEdits',
  cashEntries: 'cashEntries',
  cashAccounts: 'cashAccounts',
  accountCodes: 'accountCodes',
  accountGroups: 'accountGroups',
  settlements: 'settlements',
  fixedCostTemplates: 'fixedCostTemplates',
  expensePresets: 'expensePresets',
  quotations: 'quotations',
  openingBalances: 'openingBalances',
  fixedCosts: 'fixedCosts',
  cashFlowManual: 'cashFlowManual',

  // ── 생산·재고 ──
  productionRecords: 'productionRecords',
  productionSalesLogs: 'productionSalesLogs',
  rawMaterialLedger: 'rawMaterialLedger',
  //  원료 재고 코어(원자화) — 상태와 이력을 한 트랜잭션에 같이 쓴다.
  //  docs/원료실제원장-로트-원자화-설계.md · src/shared/rawInventoryCore.ts
  rawInventories: 'rawInventories',
  rawInventoryJobs: 'rawInventoryJobs',
  rawInventoryReversalGuards: 'rawInventoryReversalGuards',
  inventorySnapshots: 'inventorySnapshots',
  pallets: 'pallets',
  palletTransactions: 'palletTransactions',
  sesameInputLedger: 'sesameInputLedger',
  stockClosings: 'stockClosings',
  partnerBalanceSnapshots: 'partnerBalanceSnapshots',

  // ── 사람 ──
  employees: 'employees',
  users: 'users',
  settings: 'settings',
  leaveRequests: 'leaveRequests',
  payrolls: 'payrolls',
  notifications: 'notifications',
  notices: 'notices',
  chatRooms: 'chatRooms',
  chatMessages: 'chatMessages',

  // ── 서류·문서함 ──
  fileCabinetCategories: 'fileCabinetCategories',
  fileCabinetSubCategories: 'fileCabinetSubCategories',
  fileCabinetDocs: 'fileCabinetDocs',
  docSheetTitles: 'docSheetTitles',
  dashboardLinks: 'dashboardLinks',

  // ── HACCP ──
  benzopyreneTests: 'benzopyreneTests',
  haccpTemp: 'haccp_temp',
  haccpIncoming: 'haccp_incoming',
  haccpCleaning: 'haccp_cleaning',
  haccpSanitation: 'haccp_sanitation',
  haccpPersonalHygiene: 'haccp_personal_hygiene',
  haccpPeriodicSanitation: 'haccp_periodic_sanitation',
  haccpClosingChecklist: 'haccp_closing_checklist',
} as const;

export type CollectionName = typeof COL[keyof typeof COL];

/** 여기 적힌 이름인가 — 스크립트처럼 글자를 받는 자리가 쓴다 */
export const isKnownCollection = (name: string): name is CollectionName =>
  (Object.values(COL) as string[]).includes(name);
