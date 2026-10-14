/** 완료된 고정 정정 CLI의 안내만 유지한다. */
const args = process.argv.slice(2);
console.error('옛 원료 로트 기준 상태 정정 명령은 폐기되었습니다. 원격 접속과 자료 변경은 하지 않습니다.');
console.error('2026-09-11 완료된 정정입니다. 과거 깻묵 8,000kg 고정 입고나 당시 로트 합을 현재 실물로 추정하지 않습니다.');
console.error('현재 회사별 원료 수불·로트와 처리 결과를 확인하고, 새 정정은 현재 모델의 공용 원자 명령과 별도 검증 도구로 처리하세요.');
console.error('과거 백업: scripts/fix-raw-state-to-lots-backup.json / 실행 기록: DB-CHANGELOG.md');
console.error('제거 조건: docs/deprecated-field-audit-20261006.md. 과거 백업·작업 이력은 보존합니다.');
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 과거 고정 정정이나 무조건 복원은 실행할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 기본 실행 또는 --dry, --help로 폐기 안내를 확인하세요.');
  process.exitCode = 1;
}
