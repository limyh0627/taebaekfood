/** 과거 동우 박스 보정 명령은 폐기했다. 원격 자료를 읽거나 수정하지 않는다. */
const args = process.argv.slice(2);
console.error('옛 동우 박스 연결·주문·재고 보정 명령은 폐기되었습니다. 원격 접속과 자료 변경은 하지 않습니다.');
console.error('과거 백업으로 현재 재고나 주문을 추정해 덮어쓰지 않습니다. partnerIds 읽기 호환과 현재 partner_item 관계는 보존합니다.');
console.error('과거 백업: scripts/fix-dongwoo-sesame-box-backup.json / 실행 기록: DB-CHANGELOG.md');
console.error('현재 제거 조건: docs/deprecated-field-audit-20261006.md. 재고·주문 보정은 원문을 확인한 현재 공용 처리 경로에서 검토해야 합니다.');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 과거 직접 수정이나 무조건 복원은 실행할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 기본 실행 또는 --dry, --help로 폐기 안내를 확인하세요.');
  process.exitCode = 1;
}
