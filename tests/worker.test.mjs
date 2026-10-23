import test from 'node:test';
import assert from 'node:assert/strict';
import { route, purge } from '../src/worker.js';
import { signReview, verifyReview, base64url } from '../src/token.js';
import { resetAccessKeys } from '../src/access.js';
import { fakeEnv, fakeCtx, fakeMailer, stubFetch } from './fakes.mjs';

const ORIGIN = 'https://affirmations.example.test';
const NOW = Date.parse('2026-10-23T12:00:00Z');
const DAY = 86400 * 1000;

function request(method, path, body, headers = {}) {
  const init = { method, headers: { 'CF-Connecting-IP': '203.0.113.5', ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  return new Request(`${ORIGIN}${path}`, init);
}

const share = (overrides = {}) => ({
  challenge: 'When I feel left out,', response: 'I know my family loves me.', category: 'Our Own', turnstileToken: 'pass', ...overrides,
});

async function call(env, req, now = NOW) {
  const ctx = fakeCtx();
  const response = await route(req, env, ctx, now);
  await ctx.settle();
  return response;
}

async function count(env, sql = 'SELECT COUNT(*) AS n FROM submissions') {
  return (await env.DB.prepare(sql).first()).n;
}

async function submitted(env, overrides) {
  const response = await call(env, request('POST', '/api/submissions', share(overrides)));
  assert.equal(response.status, 201);
  return (await response.json()).id;
}

test.beforeEach(() => resetAccessKeys());

test('submit: missing or failed Turnstile is refused and nothing is stored', async (t) => {
  // protects=#4 AC1, bots cannot fill the moderation queue; fails_when=a submission without a passing token is stored or returns 2xx; no_claim=Turnstile's own bot detection (siteverify is stubbed: only "pass" succeeds)
  t.after(stubFetch());
  const env = fakeEnv();
  assert.equal((await call(env, request('POST', '/api/submissions', share({ turnstileToken: undefined })))).status, 403);
  assert.equal((await call(env, request('POST', '/api/submissions', share({ turnstileToken: 'nope' })))).status, 403);
  assert.equal(await count(env), 0);
});

test('submit: links, emails and phone numbers in either half are refused', async (t) => {
  // protects=#4 AC2, kids never read contact details or links; fails_when=any of the four fixtures is stored; no_claim=other ways of writing contact details (spelled-out numbers, obfuscated emails)
  t.after(stubFetch());
  const env = fakeEnv();
  const email = ['someone', 'example.org'].join('@');
  const phone = ['808', '555', '0123'].join('-');
  for (const bad of ['see http://x', 'go to www.x', `write ${email}`, `call ${phone}`]) {
    for (const half of ['challenge', 'response']) {
      const response = await call(env, request('POST', '/api/submissions', share({ [half]: bad })));
      assert.equal(response.status, 400, `${half}: ${bad}`);
    }
  }
  assert.equal(await count(env), 0);
});

test('submit: the 21st submission in an hour from one connection is refused', async (t) => {
  // protects=#4 AC3, one connection cannot flood the queue; fails_when=the 21st returns 201 or an earlier one returns 429; no_claim=IP rotation (a different IP gets its own count)
  t.after(stubFetch());
  const env = fakeEnv();
  for (let i = 0; i < 20; i += 1) assert.equal((await call(env, request('POST', '/api/submissions', share()))).status, 201);
  assert.equal((await call(env, request('POST', '/api/submissions', share()))).status, 429);
  const other = request('POST', '/api/submissions', share(), { 'CF-Connecting-IP': '198.51.100.9' });
  assert.equal((await call(env, other)).status, 201);
  const stored = await env.DB.prepare('SELECT key FROM rate_counts').all();
  assert.ok(stored.results.every((row) => !row.key.includes('203.0.113.5')), 'IP is never stored');
  assert.equal((await call(env, request('POST', '/api/submissions', share()), NOW + 3600 * 1000)).status, 201, 'next hour resets');
});

test('community: pending stays hidden, approved shows, contact never appears', async (t) => {
  // protects=#4 AC4-5, families only see approved words and never a submitter's contact; fails_when=a pending row is listed or "contact" appears in the body; no_claim=the 5-minute browser cache (header checked, expiry not simulated)
  t.after(stubFetch());
  const env = fakeEnv();
  const id = await submitted(env, { contact: 'Pat, pat@example.test' });
  let body = await (await call(env, request('GET', '/api/community'))).json();
  assert.deepEqual(body.affirmations, []);
  await env.DB.prepare("UPDATE submissions SET status = 'approved' WHERE id = ?1").bind(id).run();
  const response = await call(env, request('GET', '/api/community'));
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300');
  const text = await response.text();
  body = JSON.parse(text);
  assert.equal(body.affirmations.length, 1);
  assert.equal(body.affirmations[0].response, 'I know my family loves me.');
  assert.doesNotMatch(text, /contact|pat@example/);
});

test('community: most hearts first, then newest, at most 50', async (t) => {
  // protects=the + sheet shows the best-loved first; fails_when=ordering ignores hearts or recency, or more than 50 come back; no_claim=ties at the same timestamp
  t.after(stubFetch());
  const env = fakeEnv();
  for (let i = 0; i < 52; i += 1) {
    await env.DB.prepare("INSERT INTO submissions (id, category, challenge, response, status, created_at) VALUES (?1, 'Our Own', ?2, 'b', 'approved', ?3)")
      .bind(`s${i}`, `a${i}`, new Date(NOW + i * 1000).toISOString()).run();
  }
  for (const device of ['device-01', 'device-02']) {
    await env.DB.prepare('INSERT INTO hearts VALUES (?1, ?2, ?3)').bind('s3', device, new Date(NOW).toISOString()).run();
  }
  await env.DB.prepare('INSERT INTO hearts VALUES (?1, ?2, ?3)').bind('s7', 'device-01', new Date(NOW).toISOString()).run();
  const { affirmations } = await (await call(env, request('GET', '/api/community'))).json();
  assert.equal(affirmations.length, 50);
  assert.deepEqual(affirmations.slice(0, 4).map((item) => item.id), ['s3', 's7', 's51', 's50']);
});

test('hearts: one per device, and only on approved affirmations', async (t) => {
  // protects=#4 AC6, heart counts mean distinct devices; fails_when=a repeat raises the count or a pending id accepts a heart; no_claim=a family clearing storage to get a new device id
  t.after(stubFetch());
  const env = fakeEnv();
  const id = await submitted(env);
  assert.equal((await call(env, request('POST', '/api/hearts', { id, device: 'device-aaaa' }))).status, 404);
  await env.DB.prepare("UPDATE submissions SET status = 'approved' WHERE id = ?1").bind(id).run();
  for (let i = 0; i < 2; i += 1) {
    const response = await call(env, request('POST', '/api/hearts', { id, device: 'device-aaaa' }));
    assert.deepEqual(await response.json(), { hearts: 1 });
  }
  assert.deepEqual(await (await call(env, request('POST', '/api/hearts', { id, device: 'device-bbbb' }))).json(), { hearts: 2 });
});

test('flag off: the community API answers 404', async (t) => {
  // protects=#4 AC7 rollback switch; fails_when=any community endpoint works with COMMUNITY_ENABLED=false; no_claim=UI hiding (covered by e2e, which has no API)
  t.after(stubFetch());
  const env = fakeEnv({ COMMUNITY_ENABLED: 'false' });
  assert.equal((await call(env, request('POST', '/api/submissions', share()))).status, 404);
  assert.equal((await call(env, request('GET', '/api/community'))).status, 404);
  assert.equal((await call(env, request('POST', '/api/hearts', { id: 'x', device: 'device-aaaa' }))).status, 404);
  assert.equal(await count(env), 0);
});

test('purge: contact is cleared 90 days after a decision, not before', async (t) => {
  // protects=#4 AC8, contacts are not kept forever; fails_when=the 91-day row keeps its contact or the 89-day row loses it; no_claim=that the cron trigger fires (wrangler.jsonc config, not run here)
  t.after(stubFetch());
  const env = fakeEnv();
  for (const [id, days] of [['old', 91], ['recent', 89]]) {
    await env.DB.prepare("INSERT INTO submissions (id, category, challenge, response, contact, status, created_at, decided_at) VALUES (?1, 'Our Own', 'a', 'b', 'Pat', 'approved', ?2, ?2)")
      .bind(id, new Date(NOW - days * DAY).toISOString()).run();
  }
  await purge(env, NOW);
  const rows = (await env.DB.prepare('SELECT id, contact FROM submissions ORDER BY id').all()).results;
  assert.deepEqual(rows.map((row) => [row.id, row.contact]), [['old', null], ['recent', 'Pat']]);
});

test('review email: one email per submission with a link that opens the review page', async (t) => {
  // protects=#5 AC1, the moderator hears about every share and can act from the email; fails_when=no email, two emails, or a link that does not verify; no_claim=delivery to a real inbox (mailer is a fake)
  t.after(stubFetch());
  const env = fakeEnv();
  const id = await submitted(env, { contact: 'Pat' });
  assert.equal(env.MAILER.sent.length, 1);
  const mail = env.MAILER.sent[0];
  assert.equal(mail.to, 'moderator@example.test');
  assert.match(mail.text, /When I feel left out, *\n?.*Kids say: I know my family loves me\./s);
  const link = mail.text.match(/https:\/\/\S+\/review\/(\S+)/);
  assert.ok(link);
  assert.deepEqual(await verifyReview(env.REVIEW_SECRET, link[1], NOW), { ok: true, id });
});

test('review link: GET changes nothing; approve once; second try and expiry are 410; tampering is 403', async (t) => {
  // protects=#5 AC2-3, email scanners opening links cannot approve, and a link decides once; fails_when=GET changes status, a repeat succeeds, or an edited token is accepted; no_claim=HTML layout of the page
  t.after(stubFetch());
  const env = fakeEnv();
  const id = await submitted(env);
  const token = await signReview(env.REVIEW_SECRET, id, NOW);
  const view = await call(env, request('GET', `/review/${token}`));
  assert.equal(view.status, 200);
  assert.match(await view.text(), /Approve/);
  assert.equal((await env.DB.prepare('SELECT status FROM submissions WHERE id = ?1').bind(id).first()).status, 'pending');

  const forged = `${base64url(new TextEncoder().encode(`other-id.${Math.floor(NOW / 1000) + 999}`))}.${token.split('.')[1]}`;
  assert.equal((await call(env, request('POST', `/api/review/${forged}`, { decision: 'approve' }))).status, 403);
  assert.equal((await call(env, request('POST', `/api/review/${token}`, { decision: 'approve' }), NOW + 8 * DAY)).status, 410);

  assert.equal((await call(env, request('POST', `/api/review/${token}`, { decision: 'approve' }))).status, 200);
  assert.equal((await env.DB.prepare('SELECT status, decided_by FROM submissions WHERE id = ?1').bind(id).first()).decided_by, 'email');
  assert.equal((await call(env, request('POST', `/api/review/${token}`, { decision: 'approve' }))).status, 410);
});

test('review link: the form on the page approves and answers with a page', async (t) => {
  // protects=approving works from a phone mail app with no JavaScript; fails_when=the form post is rejected or returns JSON; no_claim=CSP form-action in a real browser
  t.after(stubFetch());
  const env = fakeEnv();
  const id = await submitted(env);
  const token = await signReview(env.REVIEW_SECRET, id, NOW);
  const response = await call(env, new Request(`${ORIGIN}/api/review/${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'decision=approve',
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /text\/html/);
  assert.equal((await env.DB.prepare('SELECT status FROM submissions WHERE id = ?1').bind(id).first()).status, 'approved');
});

test('token: sign, verify, expire and tamper', async () => {
  // protects=#5 token rules; fails_when=a valid token fails, an expired one passes, or a changed signature or payload passes; no_claim=secret strength (set as a Worker secret)
  const token = await signReview('s3cret', 'abc', NOW);
  assert.deepEqual(await verifyReview('s3cret', token, NOW), { ok: true, id: 'abc' });
  assert.equal((await verifyReview('s3cret', token, NOW + 7 * DAY + 1000)).status, 410);
  assert.equal((await verifyReview('other', token, NOW)).status, 403);
  assert.equal((await verifyReview('s3cret', `${token}x`, NOW)).status, 403);
  assert.equal((await verifyReview('s3cret', 'not-a-token', NOW)).status, 403);
});

async function accessKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const sign = async (claims, key = pair.privateKey) => {
    const enc = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)));
    const head = `${enc({ alg: 'RS256', kid: 'k1' })}.${enc(claims)}`;
    return `${head}.${base64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head)))}`;
  };
  const certs = async (url) => (String(url) === 'https://team.example.test/cdn-cgi/access/certs'
    ? Response.json({ keys: [jwk] }) : new Response('no', { status: 404 }));
  return { sign, certs };
}

test('admin: no Access token or a forged one is refused; a maintainer can list, decide and unpublish', async (t) => {
  // protects=#5 AC4-5, only signed-in maintainers moderate and unpublish takes words down; fails_when=a missing, forged, wrong-audience or non-maintainer token gets in, a cross-site form decides, or an unpublished item stays listed; no_claim=the Access sign-in page itself (Cloudflare serves it before the Worker)
  const keys = await accessKeys();
  t.after(stubFetch(keys.certs));
  const env = fakeEnv();
  const id = await submitted(env, { contact: 'Pat' });
  const claims = { aud: ['aud-123'], iss: 'https://team.example.test', email: 'Maintainer@example.test', exp: NOW / 1000 + 600 };
  const list = (token) => request('GET', '/api/admin/submissions?status=pending', undefined, token ? { 'Cf-Access-Jwt-Assertion': token } : {});

  assert.equal((await call(env, list())).status, 403);
  assert.equal((await call(env, request('GET', '/admin'))).status, 403);
  const stranger = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  assert.equal((await call(env, list(await keys.sign(claims, stranger.privateKey)))).status, 403);
  assert.equal((await call(env, list(await keys.sign({ ...claims, aud: ['other'] })))).status, 403);
  assert.equal((await call(env, list(await keys.sign({ ...claims, email: 'someone@example.test' })))).status, 403);
  assert.equal((await call(env, list(await keys.sign({ ...claims, exp: NOW / 1000 - 1 })))).status, 403);

  const token = await keys.sign(claims);
  const listed = await (await call(env, list(token))).json();
  assert.equal(listed.submissions[0].contact, 'Pat', 'maintainers see contact');
  assert.equal((await call(env, request('GET', '/admin', undefined, { 'Cf-Access-Jwt-Assertion': token }))).status, 200);

  const forgedForm = new Request(`${ORIGIN}/api/admin/decide`, {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': token, Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `id=${id}&decision=approve`,
  });
  assert.equal((await call(env, forgedForm)).status, 403, 'cross-site form cannot decide');
  const decide = (decision) => call(env, request('POST', '/api/admin/decide', { id, decision }, { 'Cf-Access-Jwt-Assertion': token, Origin: ORIGIN }));
  assert.equal((await decide('approve')).status, 200);
  assert.equal((await (await call(env, request('GET', '/api/community'))).json()).affirmations.length, 1);
  assert.equal((await decide('unpublish')).status, 200);
  assert.equal((await (await call(env, request('GET', '/api/community'))).json()).affirmations.length, 0);
  const row = await env.DB.prepare('SELECT status, decided_by FROM submissions WHERE id = ?1').bind(id).first();
  assert.deepEqual({ ...row }, { status: 'rejected', decided_by: 'maintainer@example.test' });
  assert.equal((await decide('unpublish')).status, 409);
});

test('admin: Access not configured yet means nobody gets in', async (t) => {
  // protects=a fresh deploy is closed by default; fails_when=admin answers 200 without ACCESS_TEAM_DOMAIN/ACCESS_AUD; no_claim=none beyond protects
  const keys = await accessKeys();
  t.after(stubFetch(keys.certs));
  const env = fakeEnv({ ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined });
  const token = await keys.sign({ aud: ['aud-123'], iss: 'https://team.example.test', email: 'maintainer@example.test', exp: NOW / 1000 + 600 });
  assert.equal((await call(env, request('GET', '/api/admin/submissions', undefined, { 'Cf-Access-Jwt-Assertion': token }))).status, 403);
});

test('mailer down: the submission is still stored as pending and shows in admin', async (t) => {
  // protects=#5 AC6, a mail outage loses nothing; fails_when=submit fails or the row is missing; no_claim=that the failure log reaches Workers observability
  const keys = await accessKeys();
  t.after(stubFetch(keys.certs));
  const env = fakeEnv({ MAILER: fakeMailer({ fail: true }) });
  const errors = t.mock.method(console, 'error', () => {});
  const id = await submitted(env);
  assert.equal(errors.mock.callCount(), 1);
  const token = await keys.sign({ aud: ['aud-123'], iss: 'https://team.example.test', email: 'maintainer@example.test', exp: NOW / 1000 + 600 });
  const listed = await (await call(env, request('GET', '/api/admin/submissions?status=pending', undefined, { 'Cf-Access-Jwt-Assertion': token }))).json();
  assert.deepEqual(listed.submissions.map((row) => row.id), [id]);
});

test('channel links: a person counts once per visit, preview bots and bad names do not, and everyone lands home', async (t) => {
  // protects=per-channel visit counts mean people, not link-preview fetchers; fails_when=a bot or malformed channel is counted, a visit is not, or the redirect is not to /; no_claim=every bot's user agent (a list of common preview fetchers stands in)
  const keys = await accessKeys();
  t.after(stubFetch(keys.certs));
  const env = fakeEnv();
  const phone = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };
  for (let i = 0; i < 3; i += 1) {
    const response = await call(env, request('GET', '/go/class', undefined, phone));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), '/');
  }
  await call(env, request('GET', '/go/x', undefined, phone), NOW - 10 * DAY);
  await call(env, request('GET', '/go/class', undefined, { 'User-Agent': 'facebookexternalhit/1.1 Facebot Twitterbot/1.0' }));
  await call(env, request('GET', '/go/class', undefined, { 'User-Agent': 'WhatsApp/2.23' }));
  await call(env, request('GET', '/go/Not_OK!', undefined, phone));
  await call(env, request('GET', '/go/class')); // no user agent
  const token = await keys.sign({ aud: ['aud-123'], iss: 'https://team.example.test', email: 'maintainer@example.test', exp: NOW / 1000 + 600 });
  const { channels } = await (await call(env, request('GET', '/api/admin/channels', undefined, { 'Cf-Access-Jwt-Assertion': token }))).json();
  assert.deepEqual(channels.map(({ channel, total, week }) => [channel, total, week]), [['class', 3, 3], ['x', 1, 0]]);
  assert.equal((await call(env, request('GET', '/api/admin/channels'))).status, 403);
});
