// erp-core 저장소 supabase/functions/send-push/index.ts 복사본. 고칠 때는 erp-core에서 고치고 여기로 복사한다.
// 휴대폰 푸시 보내기(Supabase Edge Function). erp.notifications에 알림이 생기면 DB 트리거(push.sql)가 부른다.
// 배포: taebaekfood 저장소 'supabase-push-deploy' 워크플로(--no-verify-jwt, 대신 x-push-secret으로 확인).
// SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY는 Supabase가 함수에 넣어 준다. VAPID 키는 처음 돌 때 만들어 DB에 둔다.
import webpush from 'npm:web-push@3.6.7';

const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', body: JSON.stringify(args),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`${fn} ${r.status} ${await r.text()}`);
  return r.json();
};

type Job = { secret: string; vapid_public: string | null; vapid_private: string | null; title: string; body: string; url: string; tag: string;
  subs: { endpoint: string; p256dh: string; auth: string }[] };

Deno.serve(async req => {
  try {
    const { id } = await req.json().catch(() => ({}));
    const job = (await rpc('push_job', { p_id: String(id ?? '') })) as Job;
    if (!job.secret || req.headers.get('x-push-secret') !== job.secret) return new Response('forbidden', { status: 403 });
    let pub = job.vapid_public, priv = job.vapid_private;
    if (!pub || !priv) {   // 처음 한 번: 키를 만들어 DB에 둔다(이미 있으면 DB 것을 쓴다)
      const k = webpush.generateVAPIDKeys();
      await rpc('push_set_vapid', { p_public: k.publicKey, p_private: k.privateKey });
      const again = (await rpc('push_job', { p_id: String(id ?? '') })) as Job;
      pub = again.vapid_public; priv = again.vapid_private;
    }
    if (!job.subs?.length) return Response.json({ sent: 0 });
    webpush.setVapidDetails('mailto:noreply@taebaek.local', pub!, priv!);
    const payload = JSON.stringify({ title: job.title, body: job.body, url: job.url, tag: job.tag });
    let sent = 0;
    await Promise.all(job.subs.map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
        sent++;
        await rpc('push_result', { p_endpoint: s.endpoint, p_ok: true, p_gone: false });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        await rpc('push_result', { p_endpoint: s.endpoint, p_ok: false, p_gone: code === 404 || code === 410 });
      }
    }));
    return Response.json({ sent });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
