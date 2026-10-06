import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyFilename) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 없음');
const auth = new GoogleAuth({ keyFilename, scopes: ['https://www.googleapis.com/auth/firebase'] });
const token = await auth.getAccessToken();
const get = async (url: string) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Rules API ${response.status}`);
  return response.json() as Promise<Record<string, any>>;
};
const release = await get('https://firebaserules.googleapis.com/v1/projects/taebaek-3abe4/releases/cloud.firestore');
const ruleset = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
const live = String(ruleset.source?.files?.[0]?.content ?? '');
const local = readFileSync('firestore.rules', 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const normalize = (s: string) => s.replace(/\r\n/g, '\n').trim();
const l = normalize(live).split('\n'); const c = normalize(local).split('\n');
const changed = Array.from({ length: Math.max(l.length, c.length) }, (_, i) => i).filter(i => l[i] !== c[i]).slice(0, 12)
  .map(i => ({ line: i + 1, live: l[i], local: c[i] }));
console.log(JSON.stringify({ release: release.name, rulesetName: release.rulesetName, liveSha: sha(live), localSha: sha(local), same: live === local, normalizedSame: normalize(live) === normalize(local),
  changed,
  liveIssuedRule: live.match(/match \/issuedStatements\/[^{]+\{[\s\S]{0,1200}/)?.[0] ?? null,
  issuedRulesContext: live.slice(Math.max(0, live.indexOf('match /issuedStatements/') - 200), live.indexOf('match /issuedStatements/') + 1600),
  liveAdminOnly: live.match(/function adminOnlyCollection\(c\)[\s\S]{0,650}/)?.[0] ?? null,
}, null, 2));
