/* Test stand-ins for the Worker's bindings. D1 runs on node:sqlite with the real migration,
 * so the SQL under test is the SQL that ships; the mailer and Access keys are local fakes.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION = ['0001_community.sql', '0002_channel_visits.sql']
  .map((name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8'))
  .join('\n');

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async first() { const row = this.db.prepare(this.sql).get(...this.args); return row ? { ...row } : null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args).map((row) => ({ ...row })) }; }
  async run() { const info = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(info.changes) } }; }
}

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRATION);
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
  };
}

export function fakeMailer({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async send(message) {
      if (fail) throw new Error('mailer down');
      sent.push(message);
      return { messageId: `m-${sent.length}` };
    },
  };
}

export function fakeEnv(overrides = {}) {
  return {
    DB: fakeD1(),
    MAILER: fakeMailer(),
    ASSETS: { fetch: async () => new Response('<h1>admin</h1>', { status: 200 }) },
    COMMUNITY_ENABLED: 'true',
    TURNSTILE_SECRET: 'turnstile-secret',
    TURNSTILE_SITE_KEY: 'site-key',
    REVIEW_SECRET: 'review-secret-for-tests-only-0123456789',
    RATE_SECRET: 'rate-secret-for-tests-only',
    MAIL_FROM: 'bedtime@example.test',
    MODERATOR_EMAIL: 'moderator@example.test',
    ACCESS_TEAM_DOMAIN: 'team.example.test',
    ACCESS_AUD: 'aud-123',
    MAINTAINERS: 'maintainer@example.test',
    ...overrides,
  };
}

/* ctx whose waitUntil promises the test can await. */
export function fakeCtx() {
  const pending = [];
  return { pending, waitUntil: (promise) => pending.push(promise), settle: () => Promise.all(pending) };
}

/* Turnstile siteverify stand-in: only the token "pass" succeeds. Other URLs go to `rest`. */
export function stubFetch(rest = async () => new Response('not stubbed', { status: 599 })) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
      const token = init.body.get('response');
      return Response.json({ success: token === 'pass' });
    }
    return rest(url, init);
  };
  return () => { globalThis.fetch = original; };
}
