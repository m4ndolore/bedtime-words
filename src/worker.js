/* Bedtime words Worker. Static files come straight from public/; this script only sees
 * /api/*, /review/* and /admin* (see run_worker_first in wrangler.jsonc).
 *
 *   POST /api/submissions        share an affirmation (Turnstile, hourly limit, text rules)
 *   GET  /api/community          approved affirmations, most hearts first
 *   POST /api/hearts             one heart per device per affirmation
 *   GET  /review/<token>         emailed review page; never changes anything
 *   POST /api/review/<token>     approve or reject from that page
 *   /admin, /api/admin/*         maintainers only, behind Cloudflare Access
 *   GET  /go/<channel>           count a visit from a shared link, then go home
 */
import pool from '../public/pool.json' with { type: 'json' };
import validate from '../public/js/validate.js';
import { signReview, verifyReview, hashKey } from './token.js';
import { maintainer } from './access.js';

const CATEGORIES = [...pool.categories.map((category) => category.name), 'Our Own'];
const LIMITS = { submit: 20, heart: 120 };
const HOUR = 3600;
const KEEP_CONTACT_DAYS = 90;
const CHANNEL = /^[a-z0-9-]{1,32}$/;
// Link-preview fetchers (chat apps, social sites, search) open every pasted link; they are not visits.
const PREVIEW_BOT = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|discord|telegram|linkedin|embedly|iframely|skype|pinterest|vkshare|redditbot|mastodon|bluesky|headless/i;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function escape(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function page(title, body, status = 200) {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex">
<title>${escape(title)} · Bedtime Words</title><link rel="stylesheet" href="/css/page.css"></head>
<body><main>${body}</main></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

async function readBody(request) {
  const type = request.headers.get('Content-Type') || '';
  try {
    if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(await request.formData());
    return await request.json();
  } catch (_) {
    return null;
  }
}

async function overLimit(env, bucket, request, now) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `${bucket}:${await hashKey(env.RATE_SECRET, ip)}`;
  const window = Math.floor(now / 1000 / HOUR);
  const row = await env.DB.prepare(
    'INSERT INTO rate_counts (key, window, count) VALUES (?1, ?2, 1) '
    + 'ON CONFLICT (key, window) DO UPDATE SET count = count + 1 RETURNING count',
  ).bind(key, window).first();
  return row.count > LIMITS[bucket];
}

async function human(env, token, request) {
  if (!token || typeof token !== 'string') return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    return (await response.json()).success === true;
  } catch (_) {
    return false;
  }
}

/* Emails the moderator a review link. A failure leaves the submission pending in /admin. */
async function notify(env, id, item, now, origin) {
  try {
    const link = `${origin}/review/${await signReview(env.REVIEW_SECRET, id, now)}`;
    const from = item.contact || 'no name given';
    const text = [
      'A family shared an affirmation.',
      '',
      `Grown-up says: ${item.challenge}`,
      `Kids say: ${item.response}`,
      `Category: ${item.category}`,
      `From: ${from}`,
      '',
      `Approve or reject (link works for 7 days): ${link}`,
      `Everything waiting: ${origin}/admin`,
    ].join('\n');
    const html = `<p>A family shared an affirmation.</p>
<p><b style="color:#3a3d98">${escape(item.challenge)}</b> <b style="color:#bf3f2a">${escape(item.response)}</b></p>
<p>Category: ${escape(item.category)}<br>From: ${escape(from)}</p>
<p><a href="${escape(link)}">Approve or reject</a> (link works for 7 days)<br><a href="${escape(`${origin}/admin`)}">Everything waiting</a></p>`;
    await env.MAILER.send({
      to: env.MODERATOR_EMAIL,
      from: { email: env.MAIL_FROM, name: 'Bedtime Words' },
      subject: `To review: ${item.challenge} ${item.response}`.slice(0, 120),
      text,
      html,
    });
  } catch (error) {
    console.error('moderation email failed', id, error && error.message);
  }
}

async function submit(request, env, ctx, now) {
  const body = await readBody(request);
  if (!body || typeof body !== 'object') return json({ error: 'Send the affirmation as JSON.' }, 400);
  if (await overLimit(env, 'submit', request, now)) {
    return json({ error: 'Lots of shares from here this hour. Try again later.' }, 429);
  }
  if (!(await human(env, body.turnstileToken, request))) {
    return json({ error: 'The robot check did not pass. Try again.' }, 403);
  }
  const checked = validate.checkSubmission(body, CATEGORIES);
  if (!checked.ok) return json({ error: checked.reason }, 400);
  const item = checked.value;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO submissions (id, category, challenge, response, contact, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  ).bind(id, item.category, item.challenge, item.response, item.contact, new Date(now).toISOString()).run();
  ctx.waitUntil(notify(env, id, item, now, new URL(request.url).origin));
  return json({ id }, 201);
}

async function community(env) {
  const { results } = await env.DB.prepare(
    'SELECT s.id, s.category, s.challenge, s.response, COUNT(h.device) AS hearts '
    + 'FROM submissions s LEFT JOIN hearts h ON h.submission_id = s.id '
    + "WHERE s.status = 'approved' GROUP BY s.id ORDER BY hearts DESC, s.created_at DESC LIMIT 50",
  ).all();
  const affirmations = results.map((row) => ({
    id: row.id, category: row.category, challenge: row.challenge, response: row.response, hearts: Number(row.hearts),
  }));
  return json({ siteKey: env.TURNSTILE_SITE_KEY, affirmations }, 200, { 'Cache-Control': 'public, max-age=300' });
}

async function heart(request, env, now) {
  const body = await readBody(request);
  const id = body && typeof body.id === 'string' ? body.id : '';
  const device = body && typeof body.device === 'string' ? body.device : '';
  if (!id || device.length < 8 || device.length > 64) return json({ error: 'Send {id, device}.' }, 400);
  if (await overLimit(env, 'heart', request, now)) return json({ error: 'Lots of hearts from here this hour.' }, 429);
  const found = await env.DB.prepare("SELECT 1 AS ok FROM submissions WHERE id = ?1 AND status = 'approved'").bind(id).first();
  if (!found) return json({ error: 'No such affirmation.' }, 404);
  await env.DB.prepare('INSERT OR IGNORE INTO hearts (submission_id, device, created_at) VALUES (?1, ?2, ?3)')
    .bind(id, device, new Date(now).toISOString()).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS hearts FROM hearts WHERE submission_id = ?1').bind(id).first();
  return json({ hearts: Number(row.hearts) });
}

async function reviewPage(env, token, now) {
  const check = await verifyReview(env.REVIEW_SECRET, token, now);
  if (!check.ok) {
    return page('Review link', `<h1>review link</h1><p>${check.status === 410
      ? 'This link has expired. Open <a href="/admin">the admin page</a> to decide.'
      : 'This link is not valid.'}</p>`, check.status);
  }
  const item = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?1').bind(check.id).first();
  if (!item) return page('Review link', '<h1>review link</h1><p>This affirmation is gone.</p>', 410);
  const words = `<p class="review-words"><span class="c">${escape(item.challenge)}</span> <span class="r">${escape(item.response)}</span></p>
<p class="note">${escape(item.category)} · from ${escape(item.contact || 'no name given')}</p>`;
  if (item.status !== 'pending') {
    return page('Review', `<h1>already ${escape(item.status)}</h1>${words}<p><a href="/admin">Admin page</a></p>`);
  }
  return page('Review', `<h1>share this one?</h1>${words}
<form method="post" action="/api/review/${escape(token)}" class="review-actions">
  <button type="submit" name="decision" value="approve" class="approve">Approve: show it to families</button>
  <button type="submit" name="decision" value="reject" class="reject">Reject</button>
</form>`);
}

async function reviewDecision(request, env, token, now) {
  const body = await readBody(request);
  const decision = body && body.decision;
  const asPage = (request.headers.get('Content-Type') || '').includes('form-urlencoded');
  const reply = (status, message) => (asPage
    ? page('Review', `<h1>${escape(message)}</h1><p><a href="/admin">Admin page</a></p>`, status)
    : json(status < 300 ? { status: message } : { error: message }, status));
  if (decision !== 'approve' && decision !== 'reject') return reply(400, 'Choose approve or reject.');
  const check = await verifyReview(env.REVIEW_SECRET, token, now);
  if (!check.ok) return reply(check.status, check.status === 410 ? 'This link has expired.' : 'This link is not valid.');
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const result = await env.DB.prepare(
    "UPDATE submissions SET status = ?1, decided_at = ?2, decided_by = 'email' WHERE id = ?3 AND status = 'pending'",
  ).bind(status, new Date(now).toISOString(), check.id).run();
  if (!result.meta.changes) return reply(410, 'This one was already decided.');
  return reply(200, status === 'approved' ? 'Approved. Families will see it within 5 minutes.' : 'Rejected.');
}

const ADMIN_MOVES = {
  approve: { from: ['pending', 'rejected'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  unpublish: { from: ['approved'], to: 'rejected' },
};

async function admin(request, env, url, now) {
  const who = await maintainer(request, env, (target) => fetch(target), now);
  if (!who) return new Response('Sign in through Cloudflare Access as a maintainer.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  if (url.pathname === '/api/admin/submissions' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    const { results } = await env.DB.prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM hearts h WHERE h.submission_id = s.id) AS hearts '
      + 'FROM submissions s WHERE s.status = ?1 ORDER BY s.created_at DESC LIMIT 200',
    ).bind(status).all();
    return json({ maintainer: who, submissions: results });
  }
  if (url.pathname === '/api/admin/channels' && request.method === 'GET') {
    const weekAgo = new Date(now - 6 * 86400 * 1000).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(
      'SELECT channel, SUM(count) AS total, SUM(CASE WHEN day >= ?1 THEN count ELSE 0 END) AS week, MAX(day) AS last '
      + 'FROM channel_visits GROUP BY channel ORDER BY total DESC',
    ).bind(weekAgo).all();
    return json({ channels: results.map((row) => ({ ...row, total: Number(row.total), week: Number(row.week) })) });
  }
  if (url.pathname === '/api/admin/decide' && request.method === 'POST') {
    // The Access session is a cookie, so refuse anything another site could forge: forms and foreign origins.
    const sameOrigin = request.headers.get('Origin') === url.origin;
    if (!sameOrigin || !(request.headers.get('Content-Type') || '').includes('application/json')) {
      return json({ error: 'Send JSON from this site.' }, 403);
    }
    const body = await readBody(request);
    const move = body && ADMIN_MOVES[body.decision];
    if (!move || typeof body.id !== 'string') return json({ error: 'Send {id, decision}.' }, 400);
    const result = await env.DB.prepare(
      `UPDATE submissions SET status = ?1, decided_at = ?2, decided_by = ?3 WHERE id = ?4 AND status IN (${move.from.map((s) => `'${s}'`).join(', ')})`,
    ).bind(move.to, new Date(now).toISOString(), who, body.id).run();
    if (!result.meta.changes) return json({ error: 'That one has already moved on.' }, 409);
    return json({ status: move.to });
  }
  if (url.pathname.startsWith('/admin')) return env.ASSETS.fetch(request);
  return json({ error: 'Not found.' }, 404);
}

/* /go/<channel>: count one visit for the channel today, then send the visitor home. */
async function go(request, env, channel, now) {
  const agent = request.headers.get('User-Agent') || '';
  if (request.method === 'GET' && CHANNEL.test(channel) && agent && !PREVIEW_BOT.test(agent)) {
    await env.DB.prepare(
      'INSERT INTO channel_visits (channel, day, count) VALUES (?1, ?2, 1) '
      + 'ON CONFLICT (channel, day) DO UPDATE SET count = count + 1',
    ).bind(channel, new Date(now).toISOString().slice(0, 10)).run();
  }
  return new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store' } });
}

/* Daily: forget contacts 90 days after a decision, and drop old rate-limit windows. */
export async function purge(env, now) {
  const cutoff = new Date(now - KEEP_CONTACT_DAYS * 86400 * 1000).toISOString();
  await env.DB.prepare('UPDATE submissions SET contact = NULL WHERE contact IS NOT NULL AND decided_at IS NOT NULL AND decided_at < ?1')
    .bind(cutoff).run();
  await env.DB.prepare('DELETE FROM rate_counts WHERE window < ?1').bind(Math.floor(now / 1000 / HOUR) - 1).run();
}

export async function route(request, env, ctx, now = Date.now()) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith('/admin') || path.startsWith('/api/admin/')) return admin(request, env, url, now);
  if (path.startsWith('/go/')) return go(request, env, path.slice('/go/'.length), now);
  if (path.startsWith('/review/') && request.method === 'GET') return reviewPage(env, path.slice('/review/'.length), now);
  if (path.startsWith('/api/review/') && request.method === 'POST') {
    return reviewDecision(request, env, path.slice('/api/review/'.length), now);
  }
  if (env.COMMUNITY_ENABLED !== 'true') return json({ error: 'Not found.' }, 404);
  if (path === '/api/submissions' && request.method === 'POST') return submit(request, env, ctx, now);
  if (path === '/api/community' && request.method === 'GET') return community(env);
  if (path === '/api/hearts' && request.method === 'POST') return heart(request, env, now);
  return json({ error: 'Not found.' }, 404);
}

export default {
  fetch(request, env, ctx) {
    return route(request, env, ctx);
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(purge(env, Date.now()));
  },
};
