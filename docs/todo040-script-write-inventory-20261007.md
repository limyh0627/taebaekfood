# TODO040 정정 스크립트 저장 경로 조사 · 2026-10-07

제품 components/src/features의 updateDoc/setDoc/addDoc/deleteDoc 직접 호출은 0건이다(주석 제외). 정정 스크립트는 원본 TODO의 별도 잔여 범위다. 아래는 실행하지 않고 소스만 조사한 후보 목록이며, 쓰기 명령이나 전환 완료 판정이 아니다.

## 판단

- Client SDK와 익명 로그인을 쓰는 과거 스크립트는 현재 직원 인증 기반 공용 서비스와 계약이 다르다. 과거 특정 자료 정정용 스크립트를 일반 앱 명령으로 그대로 치환하면 백업·undo·선행조건이 달라질 수 있다.
- Admin SDK는 Rules를 우회하므로 현재 공용 Client 서비스 호출만으로 대체할 수 없다. 활성 사용 대상과 회사·정정 계약을 먼저 확인하고, 서버 명령 재사용 가능성을 개별 대조해야 한다.
- 적용/복원/회사 식별 열은 문자열 존재 표시다. 안전성이나 실제 분기 수행을 보증하지 않는다. 메서드 호출 후보에는 Client SDK transaction/batch 쓰기와 Admin SDK 쓰기, Map.set/Set.delete 등 비DB 호출도 섞여 있으므로 행별 검토가 필요하다.
- 운영 DB 정정·삭제·권한 변경과 스크립트 실행은 이번 조사에 포함하지 않았다. Functions 원본은 실제 배포 동결본과 차이가 있으므로 현 원본을 그대로 배포하지 않는다.

후보 161개 파일. 직접 Client SDK 호출 후보 104개, 익명 로그인 문자열 111개.

| 파일 | SDK 추정 | Client 호출 | 메서드 호출 후보 | 익명 | apply | undo | 회사 식별 |
|---|---|---:|---:|---|---|---|---|
| [add-haenaeum-receipt-20261006.mts](../scripts/add-haenaeum-receipt-20261006.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [add-punghoe-salary-20260930.mts](../scripts/add-punghoe-salary-20260930.mts) | Admin SDK | 0 | 4 | - | 있음 | - | 있음 |
| [add-punghoe-taebaek-sale-20260928.mts](../scripts/add-punghoe-taebaek-sale-20260928.mts) | Admin SDK | 0 | 4 | - | 있음 | - | 있음 |
| [audit-live-rules-20261006.mts](../scripts/audit-live-rules-20261006.mts) | 수동 확인 | 0 | 1 | - | - | - | - |
| [build-field-dictionary.mjs](../scripts/build-field-dictionary.mjs) | Client SDK | 0 | 1 | - | - | - | - |
| [cleanup-submaterial-lots-20261006.mts](../scripts/cleanup-submaterial-lots-20261006.mts) | Admin SDK | 0 | 4 | - | 있음 | - | - |
| [delete-notifications.mts](../scripts/delete-notifications.mts) | Admin SDK | 0 | 6 | - | 있음 | 있음 | 있음 |
| [delete-order.mts](../scripts/delete-order.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [delete-owner-draw-20260930.mts](../scripts/delete-owner-draw-20260930.mts) | Admin SDK | 0 | 2 | - | 있음 | - | 있음 |
| [diag-compare-external-books.mts](../scripts/diag-compare-external-books.mts) | Client SDK | 0 | 3 | 있음 | - | - | - |
| [diag-oem-box-ledger.mts](../scripts/diag-oem-box-ledger.mts) | Client SDK | 0 | 3 | 있음 | - | - | - |
| [diag-raw-ledger-lots.mts](../scripts/diag-raw-ledger-lots.mts) | Client SDK | 0 | 4 | 있음 | - | - | 있음 |
| [diagnose-company.mts](../scripts/diagnose-company.mts) | Admin SDK | 0 | 1 | - | - | - | 있음 |
| [export-pl.mts](../scripts/export-pl.mts) | Client SDK | 0 | 1 | 있음 | - | - | 있음 |
| [fix-add-prepaid-template.mts](../scripts/fix-add-prepaid-template.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-add-savings-accounts.mts](../scripts/fix-add-savings-accounts.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-add-voucher-templates.mts](../scripts/fix-add-voucher-templates.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-admin-access-add.mts](../scripts/fix-admin-access-add.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-admin-access-eunkyung.mts](../scripts/fix-admin-access-eunkyung.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-admin-company-accounts.mts](../scripts/fix-admin-company-accounts.mts) | Admin SDK | 0 | 12 | - | 있음 | 있음 | 있음 |
| [fix-advance-misbooked.mts](../scripts/fix-advance-misbooked.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-alchan350-dispatched-stock.mts](../scripts/fix-alchan350-dispatched-stock.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-aug-sales-oil-ledger.mts](../scripts/fix-aug-sales-oil-ledger.mts) | Admin SDK | 0 | 7 | - | 있음 | 있음 | 있음 |
| [fix-aug-tongkkae-snapshot.mts](../scripts/fix-aug-tongkkae-snapshot.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-aug19-duplicate-pressing.mts](../scripts/fix-aug19-duplicate-pressing.mts) | Admin SDK | 0 | 8 | - | 있음 | 있음 | 있음 |
| [fix-bokkeum-1kg-vinyl.mts](../scripts/fix-bokkeum-1kg-vinyl.mts) | Client SDK | 2 | 0 | 있음 | 있음 | - | - |
| [fix-bokkeum-bulk-anchor.mts](../scripts/fix-bokkeum-bulk-anchor.mts) | Client SDK | 3 | 0 | 있음 | 있음 | - | - |
| [fix-bokkeum-bulk-minus45.mts](../scripts/fix-bokkeum-bulk-minus45.mts) | Client SDK | 1 | 0 | 있음 | 있음 | - | - |
| [fix-bokkeum-loose-lot-gap.mts](../scripts/fix-bokkeum-loose-lot-gap.mts) | Admin SDK | 0 | 2 | - | 있음 | 있음 | - |
| [fix-bom-금빛-kg.mts](../scripts/fix-bom-금빛-kg.mts) | Client SDK | 1 | 0 | 있음 | 있음 | - | - |
| [fix-box-partner-price.mts](../scripts/fix-box-partner-price.mts) | Client SDK | 1 | 3 | 있음 | 있음 | - | - |
| [fix-box-spec-tail.mts](../scripts/fix-box-spec-tail.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-box-subtype.mts](../scripts/fix-box-subtype.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-boxsize-restore.mts](../scripts/fix-boxsize-restore.mts) | Client SDK | 1 | 0 | 있음 | 있음 | 있음 | - |
| [fix-burn-deficit-production.mts](../scripts/fix-burn-deficit-production.mts) | Client SDK | 3 | 1 | 있음 | 있음 | 있음 | - |
| [fix-c019-partner-name.mts](../scripts/fix-c019-partner-name.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-cabinet-dedup2.mts](../scripts/fix-cabinet-dedup2.mts) | Client SDK | 2 | 1 | 있음 | 있음 | 있음 | - |
| [fix-can-receipt-lot-20260929.mts](../scripts/fix-can-receipt-lot-20260929.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-cans-to-wip.mts](../scripts/fix-cans-to-wip.mts) | Admin SDK | 0 | 12 | - | 있음 | 있음 | 있음 |
| [fix-car-installment.mts](../scripts/fix-car-installment.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-cash-docno.mts](../scripts/fix-cash-docno.mts) | Client SDK | 2 | 1 | 있음 | 있음 | 있음 | - |
| [fix-chat-room-participant-companies.mts](../scripts/fix-chat-room-participant-companies.mts) | Admin SDK | 0 | 8 | - | - | - | 있음 |
| [fix-cheongjeong-payment-20261006.mts](../scripts/fix-cheongjeong-payment-20261006.mts) | Admin SDK | 0 | 9 | - | 있음 | - | 있음 |
| [fix-clear-set-pumok.mts](../scripts/fix-clear-set-pumok.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-clear-shortage-notifs.mts](../scripts/fix-clear-shortage-notifs.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-company-backfill.mts](../scripts/fix-company-backfill.mts) | Admin SDK | 0 | 13 | - | 있음 | 있음 | 있음 |
| [fix-company-settings.mts](../scripts/fix-company-settings.mts) | Admin SDK | 0 | 13 | - | 있음 | - | 있음 |
| [fix-cost-supply-basis.mts](../scripts/fix-cost-supply-basis.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-cost-vat-inflated.mts](../scripts/fix-cost-vat-inflated.mts) | Client SDK | 1 | 2 | 있음 | 있음 | - | - |
| [fix-create-punghoe-admin.mts](../scripts/fix-create-punghoe-admin.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-damiwon-inventory-lock.mts](../scripts/fix-damiwon-inventory-lock.mts) | Client SDK | 2 | 0 | - | 있음 | 있음 | 있음 |
| [fix-dedup-cabinet.mts](../scripts/fix-dedup-cabinet.mts) | Client SDK | 2 | 1 | 있음 | 있음 | 있음 | - |
| [fix-delete-order-taeyoung.mts](../scripts/fix-delete-order-taeyoung.mts) | Client SDK | 4 | 1 | 있음 | 있음 | 있음 | - |
| [fix-dongwoo-sesame-box.mts](../scripts/fix-dongwoo-sesame-box.mts) | Client SDK | 6 | 0 | 있음 | 있음 | 있음 | - |
| [fix-drop-item-submaterials.mts](../scripts/fix-drop-item-submaterials.mts) | Client SDK | 1 | 2 | 있음 | 있음 | - | - |
| [fix-drop-item-taxtype.mts](../scripts/fix-drop-item-taxtype.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-drop-legacy-partnerids.mts](../scripts/fix-drop-legacy-partnerids.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-drop-sep-invsnap.mts](../scripts/fix-drop-sep-invsnap.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-dummy-stmt-hide-orders.mts](../scripts/fix-dummy-stmt-hide-orders.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-employee-auth.mts](../scripts/fix-employee-auth.mts) | Client SDK | 2 | 1 | 있음 | 있음 | 있음 | - |
| [fix-failed-inventory-permission-locks.mts](../scripts/fix-failed-inventory-permission-locks.mts) | Admin SDK | 0 | 7 | - | 있음 | 있음 | - |
| [fix-fumi-opening.mts](../scripts/fix-fumi-opening.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-gadeukchan-document-close.mts](../scripts/fix-gadeukchan-document-close.mts) | Admin SDK | 0 | 8 | - | 있음 | 있음 | 있음 |
| [fix-geosan-deulhyang-company.mts](../scripts/fix-geosan-deulhyang-company.mts) | Admin SDK | 0 | 2 | - | 있음 | 있음 | 있음 |
| [fix-gimbapdam-inventory-lock-20261007.mts](../scripts/fix-gimbapdam-inventory-lock-20261007.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-happy-naver-loose-prices.mts](../scripts/fix-happy-naver-loose-prices.mts) | Admin SDK | 0 | 6 | - | - | - | - |
| [fix-ilsung-order-inventory-lock.mts](../scripts/fix-ilsung-order-inventory-lock.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-ilsung-square-special-a-bom.mts](../scripts/fix-ilsung-square-special-a-bom.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-imported-perilla-can-lot.mts](../scripts/fix-imported-perilla-can-lot.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-imported-perilla-unpack.mts](../scripts/fix-imported-perilla-unpack.mts) | Admin SDK | 0 | 15 | - | 있음 | 있음 | 있음 |
| [fix-issue-car-0810.mts](../scripts/fix-issue-car-0810.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-issue-electric-0831.mts](../scripts/fix-issue-electric-0831.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-item-company.mts](../scripts/fix-item-company.mts) | Client SDK | 1 | 2 | 있음 | 있음 | 있음 | 있음 |
| [fix-kkaebun-lot-to-ledger.mts](../scripts/fix-kkaebun-lot-to-ledger.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-kkaebun-unpack-state.mts](../scripts/fix-kkaebun-unpack-state.mts) | Admin SDK | 0 | 7 | - | 있음 | 있음 | 있음 |
| [fix-kkaetmuk-3ton.mts](../scripts/fix-kkaetmuk-3ton.mts) | Client SDK | 6 | 0 | 있음 | 있음 | 있음 | - |
| [fix-kkaetmuk-july.mts](../scripts/fix-kkaetmuk-july.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-kkaetmuk-sep.mts](../scripts/fix-kkaetmuk-sep.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-kkaetmuk-subtype.mts](../scripts/fix-kkaetmuk-subtype.mts) | Client SDK | 1 | 0 | 있음 | 있음 | - | - |
| [fix-leave-cancel-0904.mts](../scripts/fix-leave-cancel-0904.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-leave-eunji-0902.mts](../scripts/fix-leave-eunji-0902.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-link-merged-orders.mts](../scripts/fix-link-merged-orders.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-link-o20-stmt260904.mts](../scripts/fix-link-o20-stmt260904.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-loading-fee-to-material.mts](../scripts/fix-loading-fee-to-material.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-lot-to-ledger.mts](../scripts/fix-lot-to-ledger.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-lots-to-item-stock.mts](../scripts/fix-lots-to-item-stock.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-mugyeong-lot-180.mts](../scripts/fix-mugyeong-lot-180.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-negative-box-stock.mts](../scripts/fix-negative-box-stock.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-note-taebaek-food.mts](../scripts/fix-note-taebaek-food.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-oil-stock-move.mts](../scripts/fix-oil-stock-move.mts) | Client SDK | 2 | 0 | 있음 | 있음 | - | - |
| [fix-oil-taxtype.mts](../scripts/fix-oil-taxtype.mts) | Client SDK | 1 | 2 | 있음 | 있음 | - | - |
| [fix-open-foodone.mts](../scripts/fix-open-foodone.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-opening-balance-amount.mts](../scripts/fix-opening-balance-amount.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-opening-mikwang.mts](../scripts/fix-opening-mikwang.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-order-item-notes.mts](../scripts/fix-order-item-notes.mts) | Admin SDK | 0 | 3 | - | 있음 | 있음 | 있음 |
| [fix-order-work-status.mts](../scripts/fix-order-work-status.mts) | Admin SDK | 0 | 6 | - | 있음 | 있음 | - |
| [fix-orphan-item-boms.mts](../scripts/fix-orphan-item-boms.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-orphan-settlements.mts](../scripts/fix-orphan-settlements.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-pack-table.mts](../scripts/fix-pack-table.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-partner-all-exempt.mts](../scripts/fix-partner-all-exempt.mts) | Client SDK | 1 | 2 | 있음 | 있음 | - | - |
| [fix-partner-item-taxtype.mts](../scripts/fix-partner-item-taxtype.mts) | Client SDK | 1 | 5 | 있음 | 있음 | - | - |
| [fix-punghoe-1800.mts](../scripts/fix-punghoe-1800.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-punghoe-card-vat.mts](../scripts/fix-punghoe-card-vat.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-punghoe-close-0831.mts](../scripts/fix-punghoe-close-0831.mts) | Client SDK | 5 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-punghoe-kkaebun-2000.mts](../scripts/fix-punghoe-kkaebun-2000.mts) | Client SDK | 1 | 0 | 있음 | 있음 | - | 있음 |
| [fix-punghoe-kkaetmuk.mts](../scripts/fix-punghoe-kkaetmuk.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-punghoe-mirror-taebaek.mts](../scripts/fix-punghoe-mirror-taebaek.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-punghoe-payroll-0831.mts](../scripts/fix-punghoe-payroll-0831.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-punghoe-setup.mts](../scripts/fix-punghoe-setup.mts) | Client SDK | 10 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-raw-ledger-anchor-to-lots.mts](../scripts/fix-raw-ledger-anchor-to-lots.mts) | Client SDK | 1 | 2 | 있음 | 있음 | - | 있음 |
| [fix-raw-ledger-keys.mts](../scripts/fix-raw-ledger-keys.mts) | Admin SDK | 0 | 11 | - | 있음 | 있음 | 있음 |
| [fix-recat-검정탈피.mts](../scripts/fix-recat-검정탈피.mts) | Client SDK | 1 | 0 | 있음 | 있음 | - | - |
| [fix-recost-yield.mts](../scripts/fix-recost-yield.mts) | Client SDK | 2 | 1 | 있음 | 있음 | 있음 | - |
| [fix-reference-data-company-split.mts](../scripts/fix-reference-data-company-split.mts) | Admin SDK | 0 | 16 | - | 있음 | 있음 | 있음 |
| [fix-relink-statements.mts](../scripts/fix-relink-statements.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-rest-taxtype.mts](../scripts/fix-rest-taxtype.mts) | Client SDK | 1 | 2 | 있음 | 있음 | - | - |
| [fix-saeng-ledger-sync.mts](../scripts/fix-saeng-ledger-sync.mts) | Client SDK | 4 | 0 | 있음 | 있음 | 있음 | - |
| [fix-savings-to-cash.mts](../scripts/fix-savings-to-cash.mts) | Client SDK | 6 | 0 | 있음 | 있음 | 있음 | - |
| [fix-seed-punghoe-voucher-templates.mts](../scripts/fix-seed-punghoe-voucher-templates.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-sehwa-statement-item-link.mts](../scripts/fix-sehwa-statement-item-link.mts) | Admin SDK | 0 | 2 | - | 있음 | 있음 | - |
| [fix-seolleung-opening-20261006.mts](../scripts/fix-seolleung-opening-20261006.mts) | Admin SDK | 0 | 6 | - | 있음 | 있음 | 있음 |
| [fix-sep-sesame-receipt-date.mts](../scripts/fix-sep-sesame-receipt-date.mts) | Admin SDK | 0 | 6 | - | 있음 | 있음 | 있음 |
| [fix-sep23-sales-log-date.mts](../scripts/fix-sep23-sales-log-date.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-sesame-lots.mts](../scripts/fix-sesame-lots.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-spec-loose-bulk.mts](../scripts/fix-spec-loose-bulk.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-split-card-tax.mts](../scripts/fix-split-card-tax.mts) | Client SDK | 4 | 1 | 있음 | 있음 | 있음 | - |
| [fix-stamp-after-dateedit.mts](../scripts/fix-stamp-after-dateedit.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-standard-chart-cleanup.mts](../scripts/fix-standard-chart-cleanup.mts) | Admin SDK | 0 | 2 | - | 있음 | 있음 | 있음 |
| [fix-standard-chart.mts](../scripts/fix-standard-chart.mts) | Admin SDK | 0 | 4 | - | 있음 | 있음 | 있음 |
| [fix-statement-itemid-manual.mts](../scripts/fix-statement-itemid-manual.mts) | Client SDK | 1 | 2 | 있음 | 있음 | - | 있음 |
| [fix-statement-itemid.mts](../scripts/fix-statement-itemid.mts) | Client SDK | 1 | 5 | 있음 | 있음 | - | 있음 |
| [fix-stmt-box-to-loose.mts](../scripts/fix-stmt-box-to-loose.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-storage-company-paths.mts](../scripts/fix-storage-company-paths.mts) | Admin SDK | 0 | 12 | - | 있음 | 있음 | 있음 |
| [fix-subtype-배송-to-박스.mts](../scripts/fix-subtype-배송-to-박스.mts) | Client SDK | 1 | 1 | 있음 | 있음 | - | - |
| [fix-suip-cost-172000.mts](../scripts/fix-suip-cost-172000.mts) | Admin SDK | 0 | 6 | - | 있음 | 있음 | 있음 |
| [fix-suip-cost-kg.mts](../scripts/fix-suip-cost-kg.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-suip-deulgireum-unit.mts](../scripts/fix-suip-deulgireum-unit.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-suip-ledger-to-zero.mts](../scripts/fix-suip-ledger-to-zero.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-suip-to-saeng-lots.mts](../scripts/fix-suip-to-saeng-lots.mts) | Client SDK | 3 | 0 | 있음 | 있음 | 있음 | - |
| [fix-suip-to-saeng-stock.mts](../scripts/fix-suip-to-saeng-stock.mts) | Client SDK | 3 | 0 | 있음 | 있음 | 있음 | - |
| [fix-taeyoung-keep-stock.mts](../scripts/fix-taeyoung-keep-stock.mts) | Client SDK | 1 | 0 | 있음 | 있음 | - | - |
| [fix-talpi-merge.mts](../scripts/fix-talpi-merge.mts) | Client SDK | 1 | 7 | 있음 | 있음 | - | - |
| [fix-talpi-taxtype.mts](../scripts/fix-talpi-taxtype.mts) | Client SDK | 1 | 2 | 있음 | 있음 | - | - |
| [fix-taxtype-면세원료.mts](../scripts/fix-taxtype-면세원료.mts) | Client SDK | 1 | 0 | 있음 | 있음 | - | - |
| [fix-template-company.mts](../scripts/fix-template-company.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | 있음 |
| [fix-teuka-merge.mts](../scripts/fix-teuka-merge.mts) | Client SDK | 1 | 5 | 있음 | 있음 | - | - |
| [fix-tongkkae-three-ledger-records.mts](../scripts/fix-tongkkae-three-ledger-records.mts) | Admin SDK | 0 | 6 | - | 있음 | 있음 | 있음 |
| [fix-tpl-hide-old-salary.mts](../scripts/fix-tpl-hide-old-salary.mts) | Client SDK | 1 | 0 | 있음 | 있음 | 있음 | - |
| [fix-tpl-salary-payout.mts](../scripts/fix-tpl-salary-payout.mts) | Client SDK | 2 | 0 | 있음 | 있음 | 있음 | - |
| [fix-zero-price-taxtype-unknown.mts](../scripts/fix-zero-price-taxtype-unknown.mts) | Client SDK | 4 | 7 | 있음 | 있음 | 있음 | - |
| [link-statement-itemid-by-order.mts](../scripts/link-statement-itemid-by-order.mts) | Client SDK | 3 | 8 | 있음 | 있음 | 있음 | - |
| [list-statement-noitemid.mts](../scripts/list-statement-noitemid.mts) | Client SDK | 0 | 2 | 있음 | - | - | 있음 |
| [list-taxtype-review.mts](../scripts/list-taxtype-review.mts) | Client SDK | 0 | 2 | 있음 | - | - | - |
| [merge-happy-shiptos-v2.mts](../scripts/merge-happy-shiptos-v2.mts) | Admin SDK | 0 | 9 | - | 있음 | 있음 | - |
| [merge-happy-shiptos.mts](../scripts/merge-happy-shiptos.mts) | Client SDK | 8 | 2 | 있음 | 있음 | 있음 | - |
| [migrate-raw-inventories.mts](../scripts/migrate-raw-inventories.mts) | Client SDK | 0 | 3 | 있음 | 있음 | 있음 | 있음 |
| [seed-local-emulator.mts](../scripts/seed-local-emulator.mts) | Admin SDK | 0 | 1 | - | - | - | 있음 |
| [sim-deduction-fullflow.mts](../scripts/sim-deduction-fullflow.mts) | Client SDK | 0 | 2 | 있음 | - | - | - |
| [stamp-partner-anchor.mts](../scripts/stamp-partner-anchor.mts) | Client SDK | 3 | 0 | 있음 | 있음 | 있음 | 있음 |
| [test-order-item-notes-emulator.mts](../scripts/test-order-item-notes-emulator.mts) | Admin SDK | 0 | 6 | - | 있음 | 있음 | 있음 |
| [verify-latest-request-deploy.mjs](../scripts/verify-latest-request-deploy.mjs) | 수동 확인 | 0 | 1 | - | - | - | - |

## 후속

현재 실제 재사용할 정정 스크립트의 대상·금액·회사·백업 복원 계약을 확인해 정확한 공용 명령으로 전환한다. 과거 실행 기록만 있는 스크립트와 현재 사용하는 일반 도구를 구분하며, 이 조사만으로 TODO040 전체 완료 처리하지 않는다.
