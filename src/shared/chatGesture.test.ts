import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * **오피스톡 말풍선은 폰과 PC 가 서로 다른 걸 원한다.**
 *
 *   폰  꾹 눌러 창을 띄운다 → 글자 고르기를 막아야 한다(OS 선택과 겹치면 둘 다 어정쩡해진다)
 *   PC  긁어서 복사하는 게 기본 → 고를 수 있어야 하고, **꾹 눌러도 창이 뜨면 안 된다**
 *
 * 2026-09-06 에 꾹 누르기를 붙이면서 둘을 한 규칙으로 묶었다가 PC 를 망가뜨렸다 —
 * 2026-09-07 사장님: "데스크톱에서 채팅 좌클릭하는데 수정 삭제 그거 뜨면
 * 긁어서 복사하거나 이런걸 못하잖아". `select-none` 이 글자 고르기를 통째로 막았고,
 * `onPointerDown` 이 마우스에도 걸려서 긁으려고 누르고 있으면 0.45초 뒤 창이 튀어나왔다.
 *
 * 한 줄만 되돌려도 다시 못 긁게 된다. 그래서 글자로 못 박는다.
 */
const 톡 = readFileSync('components/OfficeTalk.tsx', 'utf8');

describe('말풍선 — PC 는 긁을 수 있어야 한다', () => {
  it('말풍선에 select-none 을 직접 붙이지 않는다 — 가리키개별 규칙은 index.css 의 .msg-bubble 이 정한다', () => {
    const 줄 = 톡.split('\n')
      .map((l, i) => ({ i: i + 1, l }))
      .filter(x => x.l.includes('select-none') && x.l.includes('rounded-2xl'));
    expect(줄.map(x => `  OfficeTalk.tsx:${x.i}`),
      `말풍선에 select-none 이 다시 붙었다 — 마우스로 글자를 못 긁는다.\n` +
      `.msg-bubble 을 쓴다(폰은 none, PC 는 text).`).toEqual([]);
  });

  it('말풍선이 .msg-bubble 을 쓴다', () => {
    expect(톡, '말풍선에서 msg-bubble 이 사라졌다 — 폰에서 꾹 누르기가 OS 선택과 겹친다').toContain('msg-bubble');
  });

  it('마우스로는 꾹 누르기가 안 걸린다', () => {
    //  onPointerDown 이 pointerType 을 안 보면 마우스에도 걸린다
    const 맨몸 = /onPointerDown=\{\(\)\s*=>\s*startLongPress/.test(톡);
    expect(맨몸, `onPointerDown 이 마우스를 안 가린다 — 긁는 도중에 창이 튀어나온다.\n` +
      `e.pointerType !== 'mouse' 로 걸러라.`).toBe(false);
    expect(톡).toContain("pointerType !== 'mouse'");
  });

  it('글자를 긁어 뒀으면 우클릭이 브라우저 메뉴를 뺏지 않는다', () => {
    expect(톡, `우클릭이 늘 우리 창을 띄우면 긁어 놓고도 '복사'를 못 누른다`)
      .toContain('isCollapsed');
  });
});

/**
 * **붙여넣기(Ctrl+V)로 사진이 들어가는 길**(2026-09-07 사장님).
 * 입력칸과 화면 전체 둘 다에 걸어야 "방 열고 바로 Ctrl+V"가 된다.
 */
describe('붙여넣기로 사진 보내기', () => {
  it('입력칸과 화면 전체에 붙여넣기가 걸려 있다', () => {
    expect(톡, '입력칸에 onPaste 가 없다').toContain('onPaste=');
    expect(톡, "화면 전체 붙여넣기가 없다 — 입력칸을 안 누르고 Ctrl+V 하면 아무 일도 안 난다")
      .toContain("addEventListener('paste'");
  });

  it('클립보드에서 파일 꺼내는 셈은 shared 것을 쓴다 — 화면에서 또 짜지 않는다', () => {
    expect(톡).toContain('filesFromPaste');
    //  `getAsFile` 이 화면에 나오면 클립보드를 직접 뒤지고 있다는 뜻이다.
    //  거기서 다시 짜면 캡처 이름 짓기(image.png → 날짜)가 빠져 Storage 에 같은 이름이 쌓인다.
    expect(/getAsFile|clipboardData\.(items|files)/.test(톡),
      '화면에서 클립보드를 직접 뒤진다 — chatUpload.filesFromPaste 한 곳에 둔다').toBe(false);
  });
});
