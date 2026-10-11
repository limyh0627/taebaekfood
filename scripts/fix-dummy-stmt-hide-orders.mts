/** 옛 더미 작성·삭제 명령은 폐기했다. 이 CLI는 원격 접속 없이 안내만 출력한다. */
const args = process.argv.slice(2);
const readOnlyHelp = '실제 원본 읽기: npx tsx scripts/read-dummy-order-exclusions.mts --read-only';
console.error('옛 더미 전표 생성·삭제 명령은 폐기되었습니다. 기존 더미와 주문은 변경하지 않습니다.');
console.error(readOnlyHelp);
if (args.includes('--apply') || args.includes('--undo')) {
  console.error('쓰기 요청을 거절했습니다. 주문별 실제 제외 사유 확인과 별도 승인 없이 이관하거나 더미를 삭제할 수 없습니다.');
  process.exitCode = 1;
} else if (args.some(arg => arg !== '--dry' && arg !== '--help')) {
  console.error('지원하지 않는 인수입니다. 이 명령은 안내만 제공합니다.');
  process.exitCode = 1;
}
