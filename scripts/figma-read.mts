// 피그마 보드/파일에서 **글자를 뽑아 읽는다** — 설계를 피그마에서 하고 여기로 가져오려고.
//
//   사용:  npx tsx scripts/figma-read.mts "<피그마 URL>"
//          npx tsx scripts/figma-read.mts "<URL>" --json out.json     (원본 트리도 저장)
//
//   토큰은 **저장소에 두지 않는다.** 둘 중 하나로 준다 —
//     · 환경변수 `FIGMA_TOKEN`
//     · 파일 `%USERPROFILE%\.figma-token` (한 줄, 토큰만)
//
//   토큰 만드는 곳: figma.com → 오른쪽 위 프로필 → Settings → Security →
//   Personal access tokens → Generate new token. 권한은 **File content: Read** 면 된다.
//   (보드를 볼 수 있는 계정으로 만들어야 한다. 만든 뒤에는 다시 안 보이니 그때 복사한다.)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const 토큰 = (() => {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN.trim();
  const f = join(process.env.USERPROFILE || homedir(), '.figma-token');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  return '';
})();

if (!토큰) {
  console.error(`
피그마 토큰이 없다.

  ① figma.com → 프로필 → Settings → Security → Personal access tokens
     → Generate new token (File content: Read)
  ② 아래 둘 중 하나로 넣는다

     파일:      %USERPROFILE%\\.figma-token   (한 줄, 토큰만)
     환경변수:  setx FIGMA_TOKEN "figd_..."   (새 터미널부터 적용)

토큰은 저장소에 안 들어간다.
`);
  process.exit(1);
}

const url = process.argv[2];
if (!url) { console.error('피그마 URL 을 넘겨라.'); process.exit(1); }

//  figma.com/{board|file|design}/{키}/...?node-id=16-673
const key = /figma\.com\/(?:board|file|design|proto)\/([A-Za-z0-9]+)/.exec(url)?.[1];
if (!key) { console.error(`URL 에서 파일 키를 못 찾았다: ${url}`); process.exit(1); }
const nodeParam = /[?&]node-id=([0-9]+[-:][0-9]+)/.exec(url)?.[1]?.replace('-', ':');

const endpoint = nodeParam
  ? `https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(nodeParam)}`
  : `https://api.figma.com/v1/files/${key}`;

const res = await fetch(endpoint, { headers: { 'X-Figma-Token': 토큰 } });
if (!res.ok) {
  console.error(`피그마가 거절했다: HTTP ${res.status} ${res.statusText}`);
  if (res.status === 403) console.error('  → 토큰이 틀렸거나, 그 보드를 볼 수 없는 계정의 토큰이다.');
  if (res.status === 404) console.error('  → 파일 키가 틀렸거나 접근 권한이 없다.');
  console.error(await res.text().catch(() => ''));
  process.exit(1);
}
const data = await res.json() as Record<string, unknown>;

const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(data, null, 2), 'utf8'); console.log(`원본 → ${jsonOut}\n`); }

/**
 * 노드 트리를 걸어 글자와 연결을 모은다.
 *
 * FigJam 설계도는 일반 TEXT보다 SHAPE_WITH_TEXT와 CONNECTOR에 핵심 설명이 더 많이 들어간다.
 * 이 둘을 빼면 제목만 읽고 구조를 읽었다고 오인하므로, 상자 내용과 연결 양끝도 함께 출력한다.
 */
type Node = {
  id?: string;
  type?: string;
  name?: string;
  shapeType?: string;
  characters?: string;
  text?: { characters?: string };
  connectorStart?: { endpointNodeId?: string };
  connectorEnd?: { endpointNodeId?: string };
  children?: Node[];
};
const 줄: string[] = [];
const 글자 = (n: Node) => (n.characters ?? n.text?.characters ?? '').trim();
const 여러줄 = (prefix: string, value: string, indent: string) => {
  const lines = value.split('\n');
  줄.push(`${indent}${prefix}${lines[0]}`);
  for (const line of lines.slice(1)) 줄.push(`${indent}  ${line}`);
};
const walk = (n: Node, depth = 0) => {
  if (!n) return;
  const 들여 = '  '.repeat(Math.min(depth, 6));
  if (n.type === 'SECTION' || n.type === 'FRAME' || n.type === 'GROUP') {
    if (n.name && n.name !== 'Group') 줄.push(`\n${들여}━━ [${n.type}] ${n.name}`);
  } else if (n.type === 'TEXT' && 글자(n)) {
    여러줄('', 글자(n), 들여);
  } else if (n.type === 'SHAPE_WITH_TEXT' && 글자(n)) {
    여러줄(`▣ [${n.shapeType ?? '도형'}${n.id ? ` ${n.id}` : ''}] `, 글자(n), 들여);
  } else if (n.type === 'CONNECTOR') {
    const from = n.connectorStart?.endpointNodeId ?? '?';
    const to = n.connectorEnd?.endpointNodeId ?? '?';
    const label = 글자(n);
    줄.push(`${들여}→ ${from} → ${to}${label ? ` · ${label.replace(/\n/g, ' ')}` : ''}`);
  } else if (n.type === 'TABLE') {
    줄.push(`\n${들여}━━ [표] ${n.name ?? ''}`);
  } else if (n.type === 'STICKY' && 글자(n)) {
    줄.push(`${들여}• ${글자(n).replace(/\n/g, ' ')}`);
  }
  for (const c of n.children ?? []) walk(c, depth + 1);
};

const roots: Node[] = nodeParam
  ? Object.values((data.nodes ?? {}) as Record<string, { document: Node }>).map(v => v.document)
  : [(data.document as Node)];
for (const r of roots) walk(r);

console.log(`파일: ${data.name ?? '(이름 없음)'}${nodeParam ? `  · 노드 ${nodeParam}` : ''}`);
console.log('─'.repeat(60));
console.log(줄.join('\n').replace(/\n{3,}/g, '\n\n'));
