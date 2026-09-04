import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * **화면이 취소를 취소로 보내는지 글자로 확인한다.**
 *
 * 취소 승인이 `'approved'` 를 보내고 있었다. 셈은 멀쩡하고 화면도 멀쩡한데
 * **취소만 아무 일도 안 했다** — 눌러도 연차가 그대로 남았다(2026-09-04 발견).
 * 값 하나가 틀린 것이라 단위 테스트로는 안 잡힌다. 배선을 본다.
 */
const 읽기 = (p: string) => readFileSync(p, 'utf8');

describe('취소 승인은 cancelled 를 보낸다', () => {
  for (const p of ['components/AdminChecklist.tsx', 'components/HRManager.tsx']) {
    it(p, () => {
      const src = 읽기(p);
      // '취소승인' / '취소 승인' 단추가 달린 onUpdateLeaveStatus 호출을 집는다
      const 줄 = src.split('\n').filter(l => /취소\s?승인/.test(l) && l.includes('onUpdateLeaveStatus'));
      expect(줄.length, `${p} 에 취소 승인 단추가 없다`).toBeGreaterThan(0);
      for (const l of 줄) {
        expect(l, `취소 승인이 cancelled 를 안 보낸다:\n${l.trim()}`).toContain("'cancelled'");
      }
    });
  }
});

describe('취소를 거절하는 단추는 두지 않는다', () => {
  //  사장님: "직원이 취소한걸 반려하는 경우는 없어".
  //  그 갈래가 뜻이 뒤집혀 쓰이던 자리다 — 취소를 거절했는데 연차가 사라졌다.
  it('cancel_pending 갈래에 반려 단추가 없다', () => {
    for (const p of ['components/AdminChecklist.tsx', 'components/HRManager.tsx']) {
      const src = 읽기(p);
      const i = src.indexOf("cancel_pending' ?");
      const j = src.indexOf('isCancel &&');
      const 시작 = i >= 0 ? i : j;
      if (시작 < 0) continue;
      const 토막 = src.slice(시작, 시작 + 900);
      expect(토막, `${p} 의 취소 갈래에 반려 단추가 남아 있다`).not.toMatch(/>반려</);
    }
  });
});

describe('상태를 뒤집는 곳은 없다', () => {
  //  AdminApp 이 지금 상태를 보고 뜻을 뒤집으려다 정반대로 썼다.
  //  이제 shared/leave 의 leaveStatusPatch 만 지난다.
  it('AdminApp 이 leaveRequests 상태를 손으로 안 짠다', () => {
    const src = 읽기('src/features/admin/AdminApp.tsx');
    const 손으로 = src.split('\n').filter(l =>
      l.includes("updateItem('leaveRequests'") && /status:\s*'/.test(l));
    expect(손으로, `손으로 상태를 쓴 줄:\n${손으로.join('\n')}`).toEqual([]);
  });
});
