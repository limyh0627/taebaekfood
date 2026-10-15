/** 완료된 고정 정정 CLI의 안내만 유지한다. */
const args = process.argv.slice(2);
console.error('옛 과세 원가 일괄 정정·복원 명령은 폐기되었습니다. 원격 접속과 자료 변경은 하지 않습니다.');
console.error('2026-09-10에 과세 품목 원가 8건 정정을 완료했습니다. 당시 일회성 선별 기준으로 현재 원가를 다시 낮추지 않습니다.');
console.error('옛 undo도 종료되었습니다. 새 복원은 현재 원문과 후속 변경을 대조하고 별도 검수를 받은 계획으로 준비하세요.');
console.error('과거 백업: scripts/fix-cost-vat-inflated-backup.json / 실행 기록: DB-CHANGELOG.md');
console.error('제거 조건: docs/deprecated-field-audit-20261006.md. 과거 백업·작업 이력은 보존합니다.');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 과거 고정 정정이나 무조건 복원은 실행할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 기본 실행 또는 --dry, --help로 폐기 안내를 확인하세요.');
  process.exitCode = 1;
}
