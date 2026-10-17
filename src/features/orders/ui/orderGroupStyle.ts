/*  **그룹마다 색이 다르다**(2026-09-12 사장님: "그룹별로 색 다르게").
    작업순서 설정 창에서 칩도 줄도 다 보라라, 어느 줄이 어느 그룹에 담겼는지 **이름을 읽어야**
    알았다. 그룹 차례대로 색을 돌려 쓴다 — 여섯 번째부터는 처음 색을 다시 쓴다.

    **클래스 이름은 통째로 적는다** — Tailwind 는 글자를 찾아 만들기 때문에
    `bg-${색}-50` 처럼 이어 붙이면 그 클래스가 아예 안 만들어진다. */
export const 그룹색표 = [
  { 칩: 'border-violet-400 bg-violet-50 text-violet-700', 줄: 'bg-violet-50', 번호: 'bg-violet-600 border-violet-600', 글자: 'text-violet-500' },
  { 칩: 'border-amber-400 bg-amber-50 text-amber-700', 줄: 'bg-amber-50', 번호: 'bg-amber-500 border-amber-500', 글자: 'text-amber-600' },
  { 칩: 'border-emerald-400 bg-emerald-50 text-emerald-700', 줄: 'bg-emerald-50', 번호: 'bg-emerald-600 border-emerald-600', 글자: 'text-emerald-600' },
  { 칩: 'border-sky-400 bg-sky-50 text-sky-700', 줄: 'bg-sky-50', 번호: 'bg-sky-600 border-sky-600', 글자: 'text-sky-600' },
  { 칩: 'border-rose-400 bg-rose-50 text-rose-700', 줄: 'bg-rose-50', 번호: 'bg-rose-600 border-rose-600', 글자: 'text-rose-600' },
];
export const 그룹색 = (groups: readonly string[], name: string | undefined) => {
  const 자리 = name ? groups.indexOf(name) : -1;
  return 그룹색표[(자리 < 0 ? 0 : 자리) % 그룹색표.length];
};
