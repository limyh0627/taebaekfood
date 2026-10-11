/** 2026-08-27 완료된 일회성 원장 입고 보정 명령의 안내만 유지한다. */
const args = process.argv.slice(2);
console.error('옛 수입들기름 원장 입고 보정·삭제 명령은 폐기되었습니다. 원격 접속과 자료 변경은 하지 않습니다.');
console.error('원장과 로트의 차이를 미기록 매입으로 추정해 입고 줄을 만들거나 실행 날짜의 입고 줄을 삭제하지 않습니다.');
console.error('현재 원문은 회사별 원료 수불·로트와 처리 결과를 확인하고, 확인된 정정은 현재 재고 명령으로 처리하세요.');
console.error('과거 실행 기록: DB-CHANGELOG.md / 제거 조건: docs/deprecated-field-audit-20261006.md');
console.error('과거 작업 이력과 현재 원료 원자화 재고·로트·수불 계약은 보존합니다.');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 추정 입고 보정이나 과거 입고 삭제는 실행할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 기본 실행 또는 --dry, --help로 폐기 안내를 확인하세요.');
  process.exitCode = 1;
}
