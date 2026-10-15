import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cliToken } from './diag-zero-item-price-20261015.mts';

const project = 'taebaek-3abe4';
const targets = { admin: 'taebaek-staff.web.app', staff: 'taebaek-3abe4.web.app' };
type State = 'complete' | 'empty' | 'denied' | 'disabled' | 'error' | 'truncated' | 'notQueried' | 'notFound' | 'configMissingKey' | 'malformed';
type Failure = { diagnosticCode: 'NETWORK_ERROR' | 'JSON_ERROR' | 'HTTP_ERROR' | 'RESPONSE_SHAPE_ERROR'; httpStatus?: number; apiStatus?: string };
type Observation = { state: State; partial: boolean; pages: number; observed: number; failure?: Failure };
export type Transport = (url: string, init: RequestInit) => Promise<{ status: number; json: () => Promise<unknown> }>;
class ReadFailure { constructor(readonly state: State, readonly failure: Failure = { diagnosticCode: 'RESPONSE_SHAPE_ERROR' }) {} }
function check(value: unknown): asserts value { if (!value) throw new ReadFailure('malformed'); }
function object(value: unknown): asserts value is Record<string, any> { check(value !== null && typeof value === 'object' && !Array.isArray(value)); }
const observation = (state: State = 'notQueried'): Observation => ({ state, partial: false, pages: 0, observed: 0 });
const apiStatuses = new Set(['CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS', 'UNAUTHENTICATED']);
const url = (base: string, fields: string, next?: string) => `${base}?${new URLSearchParams({ fields, ...(next ? { pageToken: next } : {}) })}`;
function fail(observed: Observation, error: unknown) {
  observed.state = error instanceof ReadFailure ? error.state : 'malformed';
  observed.failure = error instanceof ReadFailure ? error.failure : { diagnosticCode: 'RESPONSE_SHAPE_ERROR' };
}
function aggregate(rows: Observation[]) {
  const states: Record<string, number> = {}, diagnosticCodes: Record<string, number> = {}, httpStatuses: Record<string, number> = {}, statuses: Record<string, number> = {};
  for (const row of rows) {
    states[row.state] = (states[row.state] ?? 0) + 1;
    if (row.failure) {
      const { diagnosticCode, httpStatus, apiStatus } = row.failure;
      diagnosticCodes[diagnosticCode] = (diagnosticCodes[diagnosticCode] ?? 0) + 1;
      if (httpStatus !== undefined) httpStatuses[httpStatus] = (httpStatuses[httpStatus] ?? 0) + 1;
      if (apiStatus !== undefined) statuses[apiStatus] = (statuses[apiStatus] ?? 0) + 1;
    }
  }
  const incomplete = rows.find(row => row.state !== 'complete');
  return { state: rows.length ? incomplete?.state ?? 'complete' : 'notQueried',
    partial: !!incomplete && rows.some(row => row.state === 'complete'), observations: rows.length, states,
    failures: { diagnosticCodes, httpStatuses, apiStatuses: statuses } };
}

export function summarizeKey(raw: unknown, projectNumber: string, siteKey: string) {
  object(raw);
  check(raw.name === `projects/${project}/keys/${siteKey}` || raw.name === `projects/${projectNumber}/keys/${siteKey}`);
  object(raw.webSettings); const settings = raw.webSettings;
  check(settings.allowAllDomains === undefined || typeof settings.allowAllDomains === 'boolean');
  check(settings.allowedDomains === undefined || Array.isArray(settings.allowedDomains));
  const domains: string[] = settings.allowedDomains ?? [];
  check(domains.length <= 250);
  for (const domain of domains) check(typeof domain === 'string' && domain.length <= 253 && domain === domain.trim()
    && /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(domain));
  check(['SCORE', 'CHECKBOX', 'INVISIBLE', 'POLICY_BASED_CHALLENGE'].includes(settings.integrationType));
  const disabled = settings.allowAllDomains === true;
  const coverage = Object.fromEntries(Object.entries(targets).map(([name, host]) => {
    const listedCoverage = domains.some(domain => host === domain.toLowerCase() || host.endsWith('.' + domain.toLowerCase()));
    return [name, { listedCoverage, effectiveAllowed: disabled || listedCoverage }];
  }));
  const testingOptionsPresent = Object.hasOwn(raw, 'testingOptions');
  if (testingOptionsPresent) object(raw.testingOptions);
  const testing = raw.testingOptions ?? {};
  const testingScorePresent = Object.hasOwn(testing, 'testingScore');
  if (testingScorePresent) check(typeof testing.testingScore === 'number' && Number.isFinite(testing.testingScore) && testing.testingScore >= 0 && testing.testingScore <= 1);
  const challenge = testing.testingChallenge ?? 'TESTING_CHALLENGE_UNSPECIFIED';
  check(['TESTING_CHALLENGE_UNSPECIFIED', 'NOCAPTCHA', 'UNSOLVABLE_CHALLENGE'].includes(challenge));
  return { coverage, domainCount: domains.length, domainRestrictionDisabled: disabled, scoreBased: settings.integrationType === 'SCORE',
    testingOptionsPresent, testingScorePresent, testingChallengeConfigured: challenge !== 'TESTING_CHALLENGE_UNSPECIFIED' };
}
function keyTotals() {
  return { counts: { domainCount: 0, scoreBased: 0, domainRestrictionDisabled: 0, testingOptionsPresent: 0, testingScorePresent: 0, testingChallengeConfigured: 0 },
    coverage: { admin: { observedKeys: 0, listedCoverageCount: 0, effectiveAllowedCount: 0 }, staff: { observedKeys: 0, listedCoverageCount: 0, effectiveAllowedCount: 0 } } };
}
function addKeyTotals(total: ReturnType<typeof keyTotals>, summary: ReturnType<typeof summarizeKey>) {
  for (const name of ['admin', 'staff'] as const) {
    total.coverage[name].observedKeys++;
    total.coverage[name].listedCoverageCount += Number(summary.coverage[name].listedCoverage);
    total.coverage[name].effectiveAllowedCount += Number(summary.coverage[name].effectiveAllowed);
  }
  total.counts.domainCount += summary.domainCount;
  for (const flag of ['scoreBased', 'domainRestrictionDisabled', 'testingOptionsPresent', 'testingScorePresent', 'testingChallengeConfigured'] as const) total.counts[flag] += Number(summary[flag]);
}
/** 원설정은 메모리에서만 비교한다. 같은 집계 숫자라도 서로 다른 설정이면 합치지 않는다. */
function keyMeaning(raw: Record<string, any>) {
  const settings = raw.webSettings, testing = raw.testingOptions ?? {};
  return JSON.stringify({ allowedDomains: (settings.allowedDomains ?? []).map((domain: string) => domain.toLowerCase()).sort(),
    allowAllDomains: settings.allowAllDomains ?? false, integrationType: settings.integrationType,
    testingScore: Object.hasOwn(testing, 'testingScore') ? { present: true, value: testing.testingScore } : { present: false },
    testingChallenge: testing.testingChallenge ?? 'TESTING_CHALLENGE_UNSPECIFIED' });
}

/** 정보는 읽되 어느 provider를 선택하거나 활성화하지 않는다. 원문 식별자는 메모리에서만 쓴다. */
export async function observe(token: string, transport: Transport = fetch, now = new Date(), pageLimit = 10, inventoryExistingKeys = false) {
  check(typeof token === 'string' && !!token && !/[\r\n]/.test(token));
  check(Number.isInteger(pageLimit) && pageLimit >= 1 && pageLimit <= 20 && Number.isFinite(now.getTime()));
  check(typeof inventoryExistingKeys === 'boolean');
  async function read(endpoint: string) {
    let response: Awaited<ReturnType<Transport>>, value: unknown;
    try { response = await transport(endpoint, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60000) }); }
    catch { throw new ReadFailure('error', { diagnosticCode: 'NETWORK_ERROR' }); }
    check(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599);
    try { value = await response.json(); }
    catch { throw new ReadFailure(response.status === 401 || response.status === 403 ? 'denied' : response.status === 404 ? 'notFound' : 'error',
      { diagnosticCode: response.status < 200 || response.status >= 300 ? 'HTTP_ERROR' : 'JSON_ERROR', httpStatus: response.status }); }
    if (response.status < 200 || response.status >= 300) {
      const status = (value as any)?.error?.status;
      const failure: Failure = { diagnosticCode: 'HTTP_ERROR', httpStatus: response.status,
        ...(typeof status === 'string' && apiStatuses.has(status) ? { apiStatus: status } : {}) };
      const details = (value as any)?.error?.details;
      const state = response.status === 403 && Array.isArray(details) && details.some(row => row?.reason === 'SERVICE_DISABLED') ? 'disabled'
        : response.status === 401 || response.status === 403 ? 'denied' : response.status === 404 ? 'notFound' : 'error';
      throw new ReadFailure(state, failure);
    }
    check(response.status === 200); object(value); check(!value.error); return value;
  }
  const projectInfo = observation(), webApps = observation();
  const configs: Observation[] = [], keys: Observation[] = [], apps: string[] = [], seenTokens = new Set<string>();
  let number: string | undefined;
  try {
    const row = await read(url(`https://firebase.googleapis.com/v1beta1/projects/${project}`, 'projectId,projectNumber'));
    check(row.projectId === project && typeof row.projectNumber === 'string' && /^\d+$/.test(row.projectNumber));
    number = row.projectNumber; Object.assign(projectInfo, { state: 'complete', pages: 1, observed: 1 });
  } catch (error) { fail(projectInfo, error); }
  try {
    let next = '';
    do {
      const row = await read(url(`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`, 'apps(appId),nextPageToken', next));
      check(Object.keys(row).every(key => ['apps', 'nextPageToken'].includes(key)));
      check(row.apps === undefined || Array.isArray(row.apps)); check(row.nextPageToken === undefined || typeof row.nextPageToken === 'string');
      const batch: string[] = [];
      for (const app of row.apps ?? []) {
        object(app); check(typeof app.appId === 'string' && /^1:\d+:web:[a-fA-F0-9]+$/.test(app.appId) && (!number || app.appId.split(':')[1] === number) && !apps.includes(app.appId) && !batch.includes(app.appId));
        batch.push(app.appId);
      }
      apps.push(...batch); webApps.pages++; webApps.observed = apps.length; next = row.nextPageToken ?? '';
      if (next) { check(!seenTokens.has(next)); seenTokens.add(next); }
      if (next && webApps.pages >= pageLimit) { webApps.state = 'truncated'; webApps.partial = true; break; }
    } while (next);
    if (webApps.state !== 'truncated') webApps.state = apps.length ? 'complete' : 'empty';
  } catch (error) { fail(webApps, error); webApps.partial = webApps.pages > 0; }
  const total = keyTotals(), { counts, coverage } = total;
  const seenKeys = new Set<string>();
  if (number && ['complete', 'empty'].includes(webApps.state)) for (const app of apps) {
    const config = observation(); configs.push(config); let siteKey: string;
    try {
      const row = await read(url(`https://firebaseappcheck.googleapis.com/v1/projects/${number}/apps/${encodeURIComponent(app)}/recaptchaEnterpriseConfig`, 'name,siteKey'));
      check(row.name === `projects/${number}/apps/${app}/recaptchaEnterpriseConfig` || row.name === `projects/${project}/apps/${app}/recaptchaEnterpriseConfig`);
      if (row.siteKey === undefined || row.siteKey === '') { config.state = 'configMissingKey'; continue; }
      check(typeof row.siteKey === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(row.siteKey));
      siteKey = row.siteKey; Object.assign(config, { state: 'complete', pages: 1, observed: 1 });
    } catch (error) { fail(config, error); continue; }
    if (seenKeys.has(siteKey)) continue; seenKeys.add(siteKey);
    const key = observation(); keys.push(key);
    try {
      const row = await read(url(`https://recaptchaenterprise.googleapis.com/v1/projects/${project}/keys/${siteKey}`, 'name,webSettings(allowedDomains,allowAllDomains,integrationType),testingOptions'));
      const summary = summarizeKey(row, number, siteKey);
      addKeyTotals(total, summary);
      Object.assign(key, { state: 'complete', pages: 1, observed: 1 });
    } catch (error) { fail(key, error); }
  }
  const inventory = observation(), inventoryTotal = keyTotals();
  let conditionalCandidateCount = 0;
  if (inventoryExistingKeys && number) {
    const seen = new Map<string, string>(), tokens = new Set<string>();
    try {
      let next = '';
      do {
        const row = await read(url(`https://recaptchaenterprise.googleapis.com/v1/projects/${project}/keys`, 'keys(name,webSettings(allowedDomains,allowAllDomains,integrationType),testingOptions),nextPageToken', next));
        check(Object.keys(row).every(key => ['keys', 'nextPageToken'].includes(key)));
        check(row.keys === undefined || Array.isArray(row.keys)); check(row.nextPageToken === undefined || typeof row.nextPageToken === 'string');
        const fresh: { id: string; summary: ReturnType<typeof summarizeKey>; proof: string }[] = [];
        const staged = new Map(seen);
        for (const raw of row.keys ?? []) {
          object(raw); check(typeof raw.name === 'string');
          const match = /^projects\/([^/]+)\/keys\/([A-Za-z0-9_-]{1,256})$/.exec(raw.name);
          check(match && [project, number].includes(match[1]));
          const summary = summarizeKey(raw, number, match[2]), proof = keyMeaning(raw);
          if (staged.has(match[2])) { check(staged.get(match[2]) === proof); continue; }
          staged.set(match[2], proof); fresh.push({ id: match[2], summary, proof });
        }
        for (const item of fresh) {
          seen.set(item.id, item.proof); addKeyTotals(inventoryTotal, item.summary);
          if (item.summary.scoreBased && item.summary.coverage.admin.listedCoverage && item.summary.coverage.staff.listedCoverage
            && !item.summary.domainRestrictionDisabled && !item.summary.testingScorePresent && !item.summary.testingChallengeConfigured) conditionalCandidateCount++;
        }
        inventory.pages++; inventory.observed = seen.size; next = row.nextPageToken ?? '';
        if (next) { check(!tokens.has(next)); tokens.add(next); }
        if (next && inventory.pages >= pageLimit) { inventory.state = 'truncated'; inventory.partial = true; break; }
      } while (next);
      if (inventory.state !== 'truncated') inventory.state = inventory.observed ? 'complete' : 'empty';
    } catch (error) { fail(inventory, error); inventory.partial = inventory.pages > 0; }
  }
  return { project, generatedAt: now.toISOString(), readOnly: true, configurationChanged: false, providerSelected: false, enforcementReadiness: 'not-determined',
    projectInfo, webApps, enterpriseConfigs: aggregate(configs), enterpriseKeys: aggregate(keys), uniqueKeysQueried: seenKeys.size, coverage, keyCounts: counts,
    existingKeyInventory: { requested: inventoryExistingKeys, ...inventory, coverage: inventoryTotal.coverage, keyCounts: inventoryTotal.counts,
      conditionalCandidateCount, candidateCondition: 'SCORE, 두 호스트 명시 허용, 도메인 제한 유지, 시험 강제값 없음', candidateIsSelection: false } };
}
export function outputPath(args: string[], exists = existsSync) {
  const inventory = args.length === 3 && args[1] === '--inventory-existing-keys';
  const expected = resolve(inventory ? '../appcheck-enterprise-inventory-readonly-20261015.json' : '../appcheck-enterprise-readonly-20261015.json');
  const output = args[inventory ? 2 : 1];
  check(args.length === (inventory ? 3 : 2) && args[0] === '--auth=firebase-cli' && typeof output === 'string' && output.startsWith('--output='));
  check(resolve(output.slice(9)) === expected && !exists(expected)); return expected;
}
export async function run(args: string[], deps = { exists: existsSync, token: cliToken, observe, write: (path: string, text: string) => writeFileSync(path, text, { flag: 'wx' }) }) {
  const path = outputPath(args, deps.exists); const summary = await deps.observe(await deps.token(), undefined, undefined, undefined, args.includes('--inventory-existing-keys'));
  deps.write(path, JSON.stringify(summary, null, 2)); return summary;
}
export async function selfCheck() {
  const summary = await observe('synthetic', async () => ({ status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED' } }) }), new Date('2026-10-15T00:00:00Z'));
  assert.equal(summary.projectInfo.state, 'denied'); assert.equal(summary.enterpriseKeys.state, 'notQueried');
  assert.equal(summary.providerSelected, false);
  const inventory = await observe('synthetic', async endpoint => ({ status: 200, json: async () => new URL(endpoint).pathname.endsWith('/projects/taebaek-3abe4') ? { projectId: project, projectNumber: '123' } : {} }), new Date('2026-10-15T00:00:00Z'), 10, true);
  assert.equal(inventory.existingKeyInventory.state, 'empty'); assert.equal(inventory.providerSelected, false);
  return { selfCheck: 'passed', productionRead: false, productionOutputWritten: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--self-check') console.log(JSON.stringify(await selfCheck()));
    else { await run(process.argv.slice(2)); console.log(JSON.stringify({ readOnly: true, outputWritten: true, providerSelected: false, configurationChanged: false })); }
  } catch { console.error('Enterprise 설정 읽기 실패: 인증·응답·출력 경로를 확인하세요. 설정은 변경하지 않았습니다.'); process.exitCode = 1; }
}
