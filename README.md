# Bedtime words

Say affirmations together at bedtime. A grown-up reads the first half (indigo), the kids answer with the second (red-orange). One tap shows the kids' half, the next moves on. **+** adds one more, **−** takes one out, and the night ends on a whale that keeps the sleepers.

Live at **https://affirmations.buildwith.dad**. Read every built-in affirmation at [/words](https://affirmations.buildwith.dad/words). No accounts: a family's set, the affirmations they write, and their settings stay in that browser (`localStorage` key `bedtime-words-v1`). Works offline after the first visit.

## Sharing with other families

A family can share an affirmation they wrote. It goes to a maintainer by email; nothing appears for other families until it is approved. Approved ones show under **From other families** in the + sheet, most hearts first.

- `src/worker.js` handles `/api/*`, `/review/*` and `/admin*`; everything else is a static file.
- D1 database `bedtime-words` (`migrations/`). Turnstile on submit. Hourly limits per connection are counted in D1 under a keyed hash of the IP; the IP is never stored.
- Each submission emails `MODERATOR_EMAIL` a signed review link (7 days). Opening it changes nothing; the Approve and Reject buttons do.
- `/admin` lists everything and is reachable only through Cloudflare Access for the emails in `MAINTAINERS`; the Worker re-checks the Access token on every call.
- Shared text cannot contain links, email addresses or phone numbers (`public/js/validate.js`, used by the page and the Worker).
- Contacts are erased 90 days after a decision (daily cron).
- Turn it all off with `COMMUNITY_ENABLED` = `"false"` in `wrangler.jsonc`.

Secrets: `TURNSTILE_SECRET`, `REVIEW_SECRET`, `RATE_SECRET`, `MODERATOR_EMAIL`, `MAINTAINERS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` (`wrangler secret put`). For local runs put test values in `.dev.vars` (Turnstile's always-pass test secret is `1x0000000000000000000000000000000AA`).

## Layout

| Path | What |
|---|---|
| `public/index.html` | The page |
| `public/js/app.js` | Screens, + / −, writer, settings |
| `public/js/store.js` | Browser storage: `load`, `setRotation`, `addOwn`, `updateOwn`, `deleteOwn`, prefs |
| `public/js/sound.js` | Pencil, bell and lullaby, synthesized with Web Audio |
| `public/pool.json` | The built-in affirmations. Edit wording here. |
| `public/words.html` (`/words`) | Every built-in affirmation on one page, for reading and review |
| `public/js/validate.js` | Rules for shared text, used by the page and the Worker |
| `public/admin.html` | Maintainer page (behind Cloudflare Access) |
| `src/` | Worker: submissions, community list, hearts, review links, admin |
| `public/sw.js` | Offline cache. Bump `CACHE` on every release. |
| `public/_headers` | Response headers (CSP, no-cache for `sw.js` and `pool.json`) |

No build step. A Cloudflare Worker with static assets serves `public/` as is; `_headers` applies.

## Develop

```bash
npm install
npm run serve        # http://127.0.0.1:4173/
npm test             # store, validator and Worker tests (node --test, D1 on node:sqlite)
npm run e2e          # phone-profile flows in Playwright (community API mocked)
npx wrangler dev     # the Worker with a local D1 (run `npx wrangler d1 migrations apply bedtime-words --local` once)
npm run deploy       # wrangler deploy: the bedtime-words Worker (static assets, custom domain in wrangler.jsonc)
node tools/record-demo.js demo.mp4   # 1080x1920 video with sound: three affirmations on an iPhone frame (needs ffmpeg)
```

## Credits

Look and sound inspired by Kevin Ngo's doodle chess. Fonts: Patrick Hand and Gaegu, SIL Open Font License 1.1 (`public/fonts/OFL.txt`). See `public/credits.html`.

## License

Code: MIT. Fonts: SIL OFL 1.1.
