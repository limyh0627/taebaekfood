import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { observe, outputPath, run, selfCheck, summarizeKey, type Transport } from './diag-appcheck-enterprise-readonly-20261015.mts';
const now = new Date('2026-10-15T00:00:00Z');
const siteKey = 'SECRET_SITE_KEY';
const key = () => ({ name: `projects/123/keys/${siteKey}`, webSettings: { allowedDomains: ['taebaek-staff.web.app', 'taebaek-3abe4.web.app'], integrationType: 'SCORE' }, testingOptions: { testingScore: 0 } });
const response = (body: unknown, status = 200) => ({ status, json: async () => body });
const ok: Transport = async endpoint => {
  const parsed = new URL(endpoint);
  if (parsed.pathname.endsWith('/webApps')) return response({ apps: [{ appId: '1:123:web:abcdef' }] });
  if (parsed.pathname.endsWith('/recaptchaEnterpriseConfig')) return response({ name: 'projects/123/apps/1:123:web:abcdef/recaptchaEnterpriseConfig', siteKey });
  if (parsed.hostname === 'recaptchaenterprise.googleapis.com') return response(key());
  return response({ projectId: 'taebaek-3abe4', projectNumber: '123' });
};

it('고정 프로젝트 GET만 사용하고 사이트키·앱ID·허용 도메인 원문을 출력하지 않는다', async () => {
  const transport = vi.fn<Transport>().mockImplementation(ok);
  const summary = await observe('SECRET_TOKEN', transport, now);
  expect(summary.enterpriseKeys).toMatchObject({ state: 'complete', observations: 1 });
  expect(summary.coverage.admin).toEqual({ observedKeys: 1, listedCoverageCount: 1, effectiveAllowedCount: 1 });
  expect(summary.coverage.staff).toEqual({ observedKeys: 1, listedCoverageCount: 1, effectiveAllowedCount: 1 });
  expect(summary.keyCounts).toMatchObject({ scoreBased: 1, domainRestrictionDisabled: 0, testingOptionsPresent: 1, testingScorePresent: 1 });
  expect(summary.providerSelected).toBe(false);
  expect(summary.enforcementReadiness).toBe('not-determined');
  expect(JSON.stringify(summary)).not.toMatch(/SECRET|abcdef|web\.app|projectNumber|allowedDomains/);
  expect(transport).toHaveBeenCalledTimes(4);
  for (const [endpoint, init] of transport.mock.calls) {
    const parsed = new URL(endpoint);
    expect(['firebase.googleapis.com', 'firebaseappcheck.googleapis.com', 'recaptchaenterprise.googleapis.com']).toContain(parsed.hostname);
    expect(init.method).toBe('GET'); expect(init.redirect).toBe('error'); expect(init.body).toBeUndefined();
    expect(parsed.searchParams.has('fields')).toBe(true);
    expect(endpoint).not.toMatch(/exchange|enable|assessments|create|patch|setIamPolicy/i);
  }
  const fields = new URL(transport.mock.calls[3][0]).searchParams.get('fields')!;
  expect(fields).toContain('),testingOptions'); expect(fields).not.toContain('integrationType,testingOptions');
});

it('전체 도메인 허용은 명시 등록과 구분하며 시험 점수 0도 설정 존재로 센다', () => {
  const raw = key();
  const summary = summarizeKey({ ...raw, webSettings: { ...raw.webSettings, allowedDomains: [], allowAllDomains: true } }, '123', siteKey);
  expect(summary.coverage.admin).toEqual({ listedCoverage: false, effectiveAllowed: true });
  expect(summary.domainRestrictionDisabled).toBe(true);
  expect(summary.testingScorePresent).toBe(true);
  expect(summary).not.toHaveProperty('testingScore');
});

it('도메인 일치는 레이블 경계를 확인하고 정상 상위 도메인은 허용한다', () => {
  const raw = key();
  expect(summarizeKey({ ...raw, webSettings: { ...raw.webSettings, allowedDomains: ['aebaek-staff.web.app'] } }, '123', siteKey).coverage.admin.listedCoverage).toBe(false);
  const parent = summarizeKey({ ...raw, webSettings: { ...raw.webSettings, allowedDomains: ['WEB.APP'] } }, '123', siteKey);
  expect(parent.coverage.admin.listedCoverage).toBe(true);
  expect(parent.coverage.staff.listedCoverage).toBe(true);
});

it('최상위 testingOptions만 읽으며 기본 옵션 누락은 false로 남긴다', () => {
  const summary = summarizeKey({ name: key().name, webSettings: { integrationType: 'CHECKBOX', testingOptions: { testingScore: 0 } } }, '123', siteKey);
  expect(summary).toMatchObject({ testingOptionsPresent: false, testingScorePresent: false, domainRestrictionDisabled: false, scoreBased: false });
});

it.each([
  { name: 'projects/999/keys/SECRET_SITE_KEY' }, { name: 'https://outside.example/keys/SECRET_SITE_KEY' },
  { webSettings: { integrationType: 'SCORE', allowAllDomains: 'true' } },
  { webSettings: { integrationType: 'NEW_SECRET_ENUM' } },
  { webSettings: { integrationType: 'SCORE', allowedDomains: ['https://taebaek-staff.web.app'] } },
  { webSettings: { integrationType: 'SCORE', allowedDomains: ['taebaek-staff.web.app:443'] } },
  { webSettings: { integrationType: 'SCORE', allowedDomains: ['*.web.app'] } },
  { testingOptions: { testingScore: '0' } }, { testingOptions: { testingChallenge: 'SECRET_CHALLENGE' } },
])('다른 프로젝트·알 수 없는 설정은 요약을 만들기 전에 거절한다 %#', patch => {
  expect(() => summarizeKey({ ...key(), ...patch }, '123', siteKey)).toThrow();
});

it('검증한 프로젝트의 ID·번호 두 정규 이름만 허용한다', async () => {
  const transport: Transport = async (endpoint, init) => endpoint.includes('recaptchaenterprise.googleapis.com')
    ? response({ ...key(), name: `projects/taebaek-3abe4/keys/${siteKey}` }) : ok(endpoint, init);
  expect((await observe('synthetic', transport, now)).enterpriseKeys.state).toBe('complete');
  const foreign: Transport = async (endpoint, init) => endpoint.includes('recaptchaenterprise.googleapis.com')
    ? response({ ...key(), name: `projects/999/keys/${siteKey}` }) : ok(endpoint, init);
  expect((await observe('synthetic', foreign, now)).enterpriseKeys.state).toBe('malformed');
});

it.each(['missing', 'external', 'notFound', 'denied', 'disabled'])('Enterprise config %s는 key 미발견 전체 판정으로 확대하지 않는다', async kind => {
  const transport = vi.fn<Transport>().mockImplementation(async (endpoint, init) => {
    if (!endpoint.includes('firebaseappcheck.googleapis.com')) return ok(endpoint, init);
    if (kind === 'missing') return response({ name: 'projects/123/apps/1:123:web:abcdef/recaptchaEnterpriseConfig' });
    if (kind === 'external') return response({ name: 'projects/123/apps/1:123:web:abcdef/recaptchaEnterpriseConfig', siteKey: 'https://outside.example/key' });
    return response({ error: { status: kind === 'notFound' ? 'NOT_FOUND' : 'PERMISSION_DENIED', message: 'SECRET', ...(kind === 'disabled' ? { details: [{ reason: 'SERVICE_DISABLED' }] } : {}) } }, kind === 'notFound' ? 404 : 403);
  });
  const summary = await observe('synthetic', transport, now);
  expect(summary.enterpriseConfigs.state).toBe(kind === 'missing' ? 'configMissingKey' : kind === 'external' ? 'malformed' : kind);
  expect(summary.enterpriseKeys.state).toBe('notQueried');
  expect(summary.providerSelected).toBe(false);
  expect(transport.mock.calls.some(([endpoint]) => endpoint.includes('recaptchaenterprise.googleapis.com'))).toBe(false);
  expect(JSON.stringify(summary)).not.toContain('SECRET');
});

it('페이지 전체를 읽고 앱이 공유하는 같은 key는 한 번만 조회한다', async () => {
  let pages = 0;
  const transport = vi.fn<Transport>().mockImplementation(async (endpoint, init) => {
    if (endpoint.includes('/webApps')) {
      pages++;
      return pages === 1 ? response({ apps: [{ appId: '1:123:web:abcdef' }], nextPageToken: 'SECRET_PAGE' }) : response({ apps: [{ appId: '1:123:web:123abc' }] });
    }
    if (endpoint.includes('123abc')) return response({ name: 'projects/123/apps/1:123:web:123abc/recaptchaEnterpriseConfig', siteKey });
    return ok(endpoint, init);
  });
  const summary = await observe('synthetic', transport, now);
  expect(summary.webApps).toMatchObject({ state: 'complete', pages: 2, observed: 2 });
  expect(summary.enterpriseConfigs.observations).toBe(2); expect(summary.uniqueKeysQueried).toBe(1);
  expect(transport.mock.calls.filter(([endpoint]) => endpoint.includes('recaptchaenterprise.googleapis.com'))).toHaveLength(1);
  expect(JSON.stringify(summary)).not.toContain('SECRET_PAGE');
});

it.each(['truncated', 'duplicate', 'cycle', 'later-denied'])('웹 앱 페이지 %s는 부분 결과이며 provider를 추정하지 않는다', async kind => {
  let page = 0;
  const transport: Transport = async (endpoint, init) => {
    if (!endpoint.includes('/webApps')) return ok(endpoint, init);
    page++;
    if (kind === 'later-denied' && page > 1) return response({ error: { message: 'SECRET' } }, 403);
    return response({ apps: kind === 'cycle' ? [] : [{ appId: '1:123:web:abcdef' }], nextPageToken: 'same' });
  };
  const summary = await observe('synthetic', transport, now, kind === 'truncated' ? 1 : 10);
  expect(summary.webApps).toMatchObject({ state: kind === 'truncated' ? 'truncated' : kind === 'later-denied' ? 'denied' : 'malformed', partial: true });
  expect(summary.enterpriseConfigs.state).toBe('notQueried');
});

it.each(['NETWORK_ERROR', 'JSON_ERROR', 'HTTP_ERROR', 'RESPONSE_SHAPE_ERROR'])('진단 코드 %s는 원문 오류를 남기지 않는다', async code => {
  const transport: Transport = async () => {
    if (code === 'NETWORK_ERROR') throw Error('SECRET_NETWORK');
    if (code === 'JSON_ERROR') return { status: 200, json: async () => { throw Error('SECRET_JSON'); } };
    if (code === 'HTTP_ERROR') return response({ error: { status: 'PERMISSION_DENIED', message: 'SECRET' } }, 403);
    return response({ wrong: 'SECRET_SHAPE' });
  };
  const summary = await observe('synthetic', transport, now);
  expect(summary.projectInfo.failure?.diagnosticCode).toBe(code);
  expect(JSON.stringify(summary)).not.toContain('SECRET');
});

it('고정 출력과 wx 기존 파일 보호는 인증보다 먼저 검사한다', async () => {
  const path = resolve('../appcheck-enterprise-readonly-20261015.json'), args = ['--auth=firebase-cli', '--output=' + path];
  expect(outputPath(args, () => false)).toBe(path);
  expect(() => outputPath(args, () => true)).toThrow();
  expect(() => outputPath(['--auth=firebase-cli', '--output=' + resolve('../wrong.json')], () => false)).toThrow();
  const token = vi.fn(), write = vi.fn();
  await expect(run(args, { exists: () => true, token, observe: vi.fn(), write })).rejects.toBeDefined();
  expect(token).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});

it('실제 Node self-check는 인증·운영 통신·결과 출력을 만들지 않는다', async () => {
  expect(await selfCheck()).toMatchObject({ productionRead: false, productionOutputWritten: false });
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/diag-appcheck-enterprise-readonly-20261015.mts', '--self-check'], { encoding: 'utf8', timeout: 15000 });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toMatchObject({ productionRead: false, productionOutputWritten: false });
});
