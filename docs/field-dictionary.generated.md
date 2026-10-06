# 현재 코드 필드 사전

COL 67개, 선언 필드 724개, 운영 소스 317개를 분석했다.

TypeScript가 shared/types.ts 선언으로 해석한 속성 접근만 사용처로 집계한다. any·동적 인덱스·객체 전개·별도 모델은 포함하지 않으며, 사용처 0은 삭제 근거가 아니다. JSON에 정확한 파일·행별 사용처가 있다. 현재 DB의 실제 필드나 지향 설계를 뜻하지 않는다.

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
| IssuedStatementItem | name | 필수 | string | src/shared/types.ts:1072 | 21 |
| IssuedStatementItem | spec | 필수 | string | src/shared/types.ts:1073 | 4 |
| IssuedStatementItem | qty | 필수 | number | src/shared/types.ts:1074 | 10 |
| IssuedStatementItem | price | 필수 | number | src/shared/types.ts:1075 | 2 |
| IssuedStatementItem | supply | 필수 | number | src/shared/types.ts:1076 | 11 |
| IssuedStatementItem | tax | 필수 | number | src/shared/types.ts:1077 | 10 |
| IssuedStatementItem | total | 필수 | number | src/shared/types.ts:1078 | 16 |
| IssuedStatementItem | isTaxExempt | 필수 | boolean | src/shared/types.ts:1079 | 6 |
| IssuedStatementItem | accountCode | 선택 | string | src/shared/types.ts:1084 | 14 |
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
| IssuedStatement | id | 필수 | string | src/shared/types.ts:1118 | 105 |
| IssuedStatement | openingItemId | 선택 | string | src/shared/types.ts:1120 | 0 |
| IssuedStatement | openingQuantity | 선택 | number | src/shared/types.ts:1121 | 0 |
| IssuedStatement | companyId | 선택 | CompanyId | src/shared/types.ts:1123 | 1 |
| IssuedStatement | issuedAt | 필수 | string | src/shared/types.ts:1124 | 17 |
| IssuedStatement | tradeDate | 필수 | string | src/shared/types.ts:1125 | 77 |
| IssuedStatement | type | 필수 | '매출' \| '매입' \| '비용' | src/shared/types.ts:1126 | 66 |
| IssuedStatement | partnerId | 필수 | string | src/shared/types.ts:1127 | 53 |
| IssuedStatement | partnerName | 필수 | string | src/shared/types.ts:1128 | 26 |
| IssuedStatement | orderId | 필수 | string | src/shared/types.ts:1129 | 7 |
| IssuedStatement | docNo | 필수 | string | src/shared/types.ts:1130 | 37 |
| IssuedStatement | totalSupply | 필수 | number | src/shared/types.ts:1131 | 3 |
| IssuedStatement | totalTax | 필수 | number | src/shared/types.ts:1132 | 4 |
| IssuedStatement | totalAmount | 필수 | number | src/shared/types.ts:1133 | 47 |
| IssuedStatement | items | 필수 | IssuedStatementItem[] | src/shared/types.ts:1134 | 37 |
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
| AccountCode | code | 필수 | string | src/shared/types.ts:1474 | 97 |
| AccountCode | name | 필수 | string | src/shared/types.ts:1475 | 58 |
| AccountCode | groupId | 선택 | string | src/shared/types.ts:1476 | 11 |
| AccountCode | type | 선택 | AccountType | src/shared/types.ts:1478 | 17 |
| AccountCode | normalBalance | 선택 | 'debit' \| 'credit' | src/shared/types.ts:1479 | 8 |
| AccountCode | isCash | 선택 | boolean | src/shared/types.ts:1480 | 1 |
| AccountCode | noncash | 선택 | boolean | src/shared/types.ts:1485 | 0 |
| AccountCode | note | 선택 | string | src/shared/types.ts:1486 | 0 |
| JournalLine | accountCode | 필수 | string | src/shared/types.ts:1491 | 31 |
| JournalLine | debit | 필수 | number | src/shared/types.ts:1492 | 32 |
| JournalLine | credit | 필수 | number | src/shared/types.ts:1493 | 28 |
| JournalLine | partnerId | 선택 | string | src/shared/types.ts:1494 | 8 |
| JournalLine | note | 선택 | string | src/shared/types.ts:1495 | 1 |
| JournalEntry | id | 필수 | string | src/shared/types.ts:1499 | 5 |
| JournalEntry | date | 필수 | string | src/shared/types.ts:1500 | 13 |
| JournalEntry | lines | 필수 | JournalLine[] | src/shared/types.ts:1501 | 27 |
| JournalEntry | memo | 선택 | string | src/shared/types.ts:1502 | 2 |
| JournalEntry | sourceType | 필수 | '매출' \| '매입' \| '대체' \| '자금' \| '수동' | src/shared/types.ts:1503 | 4 |
| JournalEntry | sourceId | 선택 | string | src/shared/types.ts:1504 | 13 |
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
| CashEntry | id | 필수 | string | src/shared/types.ts:1542 | 44 |
| CashEntry | linkedAccrualStatementId | 선택 | string | src/shared/types.ts:1544 | 2 |
| CashEntry | loanId | 선택 | string | src/shared/types.ts:1546 | 1 |
| CashEntry | companyId | 선택 | CompanyId | src/shared/types.ts:1548 | 0 |
| CashEntry | docNo | 선택 | string | src/shared/types.ts:1554 | 7 |
| CashEntry | date | 필수 | string | src/shared/types.ts:1555 | 38 |
| CashEntry | cashAccountId | 필수 | string | src/shared/types.ts:1556 | 3 |
| CashEntry | dir | 필수 | '입금' \| '출금' \| '대체' | src/shared/types.ts:1567 | 44 |
| CashEntry | amount | 필수 | number | src/shared/types.ts:1568 | 24 |
| CashEntry | partnerId | 선택 | string | src/shared/types.ts:1569 | 29 |
| CashEntry | partnerName | 선택 | string | src/shared/types.ts:1570 | 14 |
| CashEntry | accountCode | 선택 | string | src/shared/types.ts:1571 | 22 |
| CashEntry | lines | 선택 | {     accountCode: string;     /**      * **언제나 양수로 적는다.** 차·대는 `side`가 말한다.      *      * `side`가 없는 옛 줄은 **부호가 곧 차·대**였다 — 양수면 통장 반대편, 음수면      * 통장과 같은 편(급여 원천공제가 그 길). 그 규칙은 `dir`에 매달려 있어서      * 입금·출금을 바꾸면 모든 줄의 뜻이 조용히 뒤집혔다. 읽는 쪽은 아직 그 줄도      * 받아 주지만(옛 데이터 호환), **새로 쓸 땐 `side`를 넣는다.**      */     amount: number;     /** 차변이냐 대변이냐. 대체전표 줄(`IssuedStatementItem.side`)과 같은 모양이다. */     side?: '차변' \| '대변';     note?: string;   }[] | src/shared/types.ts:1578 | 22 |
| CashEntry | offsetOf | 선택 | { ar: string; ap: string } | src/shared/types.ts:1594 | 0 |
| CashEntry | note | 선택 | string | src/shared/types.ts:1595 | 16 |
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
