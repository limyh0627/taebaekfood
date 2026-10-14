import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { observe, outputPath, run, selfCheck, type Transport } from './diag-appcheck-readonly-20261015.mts';
const now = new Date('2026-10-15T00:00:00Z');
const response = (body: unknown, status = 200) => ({ status, json: async () => body });
const ok: Transport = async url => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/webApps')) return response({ apps: [{ appId: '1:123:web:abcdef' }] });
  if (parsed.pathname.endsWith('/services')) return response({ services: [{ enforcementMode: 'UNENFORCED' }] });
  if (/recaptcha(V3|Enterprise)Config$/.test(parsed.pathname)) return response({ name: 'projects/123/apps/1:123:web:abcdef/' + parsed.pathname.split('/').at(-1), siteKey: 'SECRET_SITE_KEY' });
  if (parsed.pathname.includes('/metricDescriptors/')) return response({ type: 'firebaseappcheck.googleapis.com/resources/verification_count', metricKind: 'DELTA', valueType: 'INT64' });
  if (parsed.pathname.endsWith('/timeSeries')) return response({ timeSeries: [{ metric: { labels: { security: 'VALID', result: 'ALLOW', app_id: 'SECRET_APP' } }, points: [{ interval: { endTime: '2026-10-14T23:00:00Z' }, value: { int64Value: '8' } }] }] });
  if (parsed.pathname.endsWith('/entries:list')) return response({ entries: [{ timestamp: '2026-10-14T23:00:00Z', jsonPayload: { verifications: { app: 'MISSING' }, message: 'SECRET_LOG_AND_IP' } }] });
  return response({ projectId: 'taebaek-3abe4', projectNumber: '123' });
};

it('정확한 읽기 경로·메서드와 필드 마스크만 사용하고 비밀 원문을 요약에 남기지 않는다', async () => {
  const transport = vi.fn<Transport>().mockImplementation(ok);
  const summary = await observe('SECRET_TOKEN', transport, now);
  expect(summary.services.counts).toEqual({ UNENFORCED: 1 });
  expect(summary.callableLogs.counts).toEqual({ MISSING: 1 });
  expect(summary.enforcementReadiness).toBe('not-determined');
  expect(JSON.stringify(summary)).not.toMatch(/SECRET|abcdef|siteKey|projectNumber/);
  const requests = transport.mock.calls;
  expect(requests).toHaveLength(9);
  for (const [url, init] of requests) {
    const parsed = new URL(url);
    expect(['firebase.googleapis.com', 'firebaseappcheck.googleapis.com', 'monitoring.googleapis.com', 'logging.googleapis.com']).toContain(parsed.host);
    expect(parsed.searchParams.has('fields')).toBe(true);
    expect(init.redirect).toBe('error');
    expect(init.method).toBe(parsed.pathname.endsWith('/entries:list') ? 'POST' : 'GET');
    expect(url).not.toMatch(/patch|batchUpdate|enable|setIamPolicy|exchangeToken/i);
  }
  const windows = summary.windows as any;
  expect(windows['1d'].end).toBe(windows['7d'].end);
  expect(windows['1d'].verification.counts).toEqual({ 'ALLOW:VALID': 8 });
  expect(windows['7d'].verification.counts).toEqual({ 'ALLOW:VALID': 8 });
  expect(summary.doNotSumWindows).toBe(true);
  const metricRequest = requests.find(([url]) => url.includes('/timeSeries'))![0];
  expect(new URL(metricRequest).searchParams.get('fields')).toContain('metric(labels)');
  expect(new URL(metricRequest).searchParams.get('fields')).not.toContain('labels(security');
  expect(new URL(requests.find(([url]) => url.includes('entries:list'))![0]).searchParams.get('fields')).toContain('timestamp,jsonPayload)');
  const log = JSON.parse(requests.find(([url]) => url.includes('entries:list'))![1].body as string);
  expect(log.resourceNames).toEqual(['projects/taebaek-3abe4']);
  expect(log.filter).toContain('cloud_run_revision');
  expect(log.filter).toContain('callable-request-verification');
});

it.each(['NETWORK_ERROR', 'JSON_ERROR', 'HTTP_ERROR', 'RESPONSE_SHAPE_ERROR'])('%s를 고정 진단 코드로 구분하고 원문을 보존하지 않는다', async code => {
  const transport: Transport = async () => {
    if (code === 'NETWORK_ERROR') throw Error('SECRET_NETWORK_TOKEN');
    if (code === 'JSON_ERROR') return { status: 200, json: async () => { throw Error('SECRET_JSON'); } };
    if (code === 'HTTP_ERROR') return response({ error: { status: 'INVALID_ARGUMENT', message: 'SECRET_MESSAGE', details: [{ metadata: { token: 'SECRET_TOKEN' } }] } }, 400);
    return response({ secret: 'SECRET_SHAPE' });
  };
  const summary = await observe('synthetic', transport, now);
  expect(summary.projectInfo.failure?.diagnosticCode).toBe(code);
  expect(summary.webApps.failure?.diagnosticCode).toBe(code);
  if (code === 'HTTP_ERROR') expect(summary.projectInfo.failure).toEqual({ diagnosticCode: code, httpStatus: 400, apiStatus: 'INVALID_ARGUMENT' });
  expect(JSON.stringify(summary)).not.toContain('SECRET');
});

it('비2xx의 깨진 JSON은 HTTP 오류를 우선하고 알려지지 않은 API 상태는 버린다', async () => {
  const broken: Transport = async () => ({ status: 403, json: async () => { throw Error('SECRET_BAD_JSON'); } });
  expect((await observe('synthetic', broken, now)).projectInfo).toMatchObject({ state: 'denied', failure: { diagnosticCode: 'HTTP_ERROR', httpStatus: 403 } });
  const unknown: Transport = async () => response({ error: { status: 'SECRET_STATUS', message: 'SECRET_MESSAGE' } }, 500);
  const summary = await observe('synthetic', unknown, now);
  expect(summary.projectInfo.failure).toEqual({ diagnosticCode: 'HTTP_ERROR', httpStatus: 500 });
  expect(JSON.stringify(summary)).not.toContain('SECRET');
});

it('웹 앱 전체 페이지를 읽고 페이지 토큰을 저장하지 않는다', async () => {
  let page = 0;
  const transport: Transport = async (url, init) => {
    if (new URL(url).pathname.endsWith('/webApps')) {
      page++;
      if (page === 1) return response({ apps: [{ appId: '1:123:web:abcdef' }], nextPageToken: 'SECRET_PAGE' });
      expect(new URL(url).searchParams.get('pageToken')).toBe('SECRET_PAGE');
      return response({ apps: [{ appId: '1:123:web:123abc' }] });
    }
    if (url.includes('123abc')) return response({ name: 'projects/123/apps/1:123:web:123abc/' + new URL(url).pathname.split('/').at(-1) });
    return ok(url, init);
  };
  const summary = await observe('synthetic', transport, now);
  expect(summary.webApps).toMatchObject({ state: 'complete', pages: 2, observed: 2, counts: { registered: 2 } });
  expect(summary.providers.recaptchaV3Config).toMatchObject({ observations: 2 });
  expect(JSON.stringify(summary)).not.toContain('SECRET_PAGE');
});

it.each(['denied', 'disabled', 'error'])('%s 조회는 관측량 0의 정상으로 승격하지 않는다', async state => {
  const transport: Transport = async () => state === 'disabled' ? response({ error: { details: [{ reason: 'SERVICE_DISABLED', message: 'SECRET' }] } }, 403)
    : response({ error: { message: 'SECRET' } }, state === 'denied' ? 403 : 500);
  const summary = await observe('synthetic', transport, now);
  expect(summary.projectInfo.state).toBe(state);
  expect(summary.webApps.state).toBe(state);
  expect(summary.services.state).toBe('notQueried');
  expect(summary.providers.recaptchaV3Config.state).toBe('notQueried');
  expect(summary.callableLogs.state).toBe(state);
  expect(JSON.stringify(summary)).not.toContain('SECRET');
});

it('빈 목록은 empty이고 서비스 OFF 또는 검증 성공률을 추정하지 않는다', async () => {
  const transport: Transport = async (url, init) => url.endsWith('none') ? response({})
    : new URL(url).pathname.endsWith('/projects/taebaek-3abe4') ? ok(url, init)
      : url.includes('metricDescriptors') ? ok(url, init) : response({});
  const summary = await observe('synthetic', transport, now);
  expect(summary.services.state).toBe('empty');
  expect(summary.services.counts).toEqual({});
  expect((summary.windows['1d'] as any).verification.state).toBe('empty');
  expect(summary.callableLogs.state).toBe('empty');
  expect(summary.enforcementReadiness).toBe('not-determined');
});

it('페이지 상한과 후속 실패는 partial이고 provider 미등록으로 단정하지 않는다', async () => {
  const limited: Transport = async (url, init) => url.includes('/webApps') ? response({ apps: [{ appId: '1:123:web:abcdef' }], nextPageToken: 'next' }) : ok(url, init);
  const truncated = await observe('synthetic', limited, now, 1);
  expect(truncated.webApps).toMatchObject({ state: 'truncated', partial: true, observed: 1 });
  expect(truncated.providers.recaptchaV3Config.state).toBe('notQueried');
  const denied: Transport = async (url, init) => url.includes('/webApps') && new URL(url).searchParams.has('pageToken') ? response({ error: {} }, 403) : limited(url, init);
  expect((await observe('synthetic', denied, now)).webApps).toMatchObject({ state: 'denied', partial: true, pages: 1 });
});

it.each(['unknown-list', 'unknown-security', 'unsafe-count', 'bad-log', 'cycle'])('알 수 없는 %s 응답을 fail closed한다', async kind => {
  const transport: Transport = async (url, init) => {
    if (kind === 'unknown-list' && url.includes('/webApps')) return response({ unexpected: ['SECRET'] });
    if (kind === 'cycle' && url.includes('/webApps')) return response({ nextPageToken: 'same' });
    if ((kind === 'unknown-security' || kind === 'unsafe-count') && url.includes('/timeSeries')) return response({ timeSeries: [{ metric: { labels: { security: kind === 'unknown-security' ? 'ALIEN' : 'VALID', result: 'ALLOW' } }, points: [{ interval: { endTime: '2026-10-14T23:00:00Z' }, value: { int64Value: '9999999999999999999999' } }] }] });
    if (kind === 'bad-log' && url.includes('entries:list')) return response({ entries: [{ jsonPayload: { verifications: { app: 'ALIEN' } } }] });
    return ok(url, init);
  };
  const summary = await observe('synthetic', transport, now);
  if (kind === 'unknown-list' || kind === 'cycle') expect(summary.webApps.state).toBe('error');
  else if (kind === 'bad-log') expect(summary.callableLogs.state).toBe('error');
  else expect((summary.windows['1d'] as any).verification.state).toBe('error');
  expect(summary.enforcementReadiness).toBe('not-determined');
});

it('출력 경로·기존 파일은 인증 전에 검사하고 성공 출력은 wx만 사용한다', async () => {
  const token = vi.fn().mockResolvedValue('synthetic'), write = vi.fn();
  const path = resolve('../appcheck-readonly-20261015.json');
  expect(() => outputPath(['--auth=firebase-cli', '--output=' + path], () => true)).toThrow();
  await expect(run(['--auth=firebase-cli', '--output=elsewhere'], { exists: () => false, token, observe: vi.fn(), write })).rejects.toBeDefined();
  expect(token).not.toHaveBeenCalled();
  const observeMock = vi.fn().mockResolvedValue({ readOnly: true });
  await run(['--auth=firebase-cli', '--output=' + path], { exists: () => false, token, observe: observeMock, write });
  expect(write).toHaveBeenCalledExactlyOnceWith(path, JSON.stringify({ readOnly: true }, null, 2));
});

it('등록된 r2 경로만 명시 허용하고 기존 결과나 다른 revision을 선택하지 않는다', async () => {
  const path = resolve('../appcheck-readonly-20261015-r2.json');
  const args = ['--auth=firebase-cli', '--output=' + path];
  expect(outputPath(args, () => false)).toBe(path);
  expect(() => outputPath(args, () => true)).toThrow();
  expect(() => outputPath(['--auth=firebase-cli', '--output=' + resolve('../appcheck-readonly-20261015-r3.json')], () => false)).toThrow();
  const token = vi.fn(), write = vi.fn();
  await expect(run(args, { exists: () => true, token, observe: vi.fn(), write })).rejects.toBeDefined();
  expect(token).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it('self-check는 인증·실제 통신·결과 파일 생성 없이 실행한다', async () => {
  expect(await selfCheck()).toEqual({ selfCheck: 'passed', productionRead: false, productionOutputWritten: false });
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/diag-appcheck-readonly-20261015.mts', '--self-check'], { encoding: 'utf8', timeout: 15000 });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toMatchObject({ productionRead: false, productionOutputWritten: false });
});
