# Bedtime words

Say affirmations together at bedtime. A grown-up reads the first half (indigo), the kids answer with the second (red-orange). One tap shows the kids' half, the next moves on. **+** adds one more, **−** takes one out, and the night ends on a whale that keeps the sleepers.

Live at **https://affirmations.buildwith.dad**. Read every built-in affirmation at [/words](https://affirmations.buildwith.dad/words). No accounts: a family's set, the affirmations they write, and their settings stay in that browser (`localStorage` key `bedtime-words-v1`). Works offline after the first visit.

## Layout

| Path | What |
|---|---|
| `public/index.html` | The page |
| `public/js/app.js` | Screens, + / −, writer, settings |
| `public/js/store.js` | Browser storage: `load`, `setRotation`, `addOwn`, `updateOwn`, `deleteOwn`, prefs |
| `public/js/sound.js` | Pencil, bell and lullaby, synthesized with Web Audio |
| `public/pool.json` | The built-in affirmations. Edit wording here. |
| `public/words.html` (`/words`) | Every built-in affirmation on one page, for reading and review |
| `public/sw.js` | Offline cache. Bump `CACHE` on every release. |
| `public/_headers` | Response headers (CSP, no-cache for `sw.js` and `pool.json`) |

No build step. A Cloudflare Worker with static assets serves `public/` as is; `_headers` applies.

## Develop

```bash
npm install
npm run serve        # http://127.0.0.1:4173/
npm test             # store unit tests (node --test)
npm run e2e          # offline session on a mobile profile (Playwright)
npm run deploy       # wrangler deploy: the bedtime-words Worker (static assets, custom domain in wrangler.jsonc)
```

## Credits

Look and sound inspired by Kevin Ngo's doodle chess. Fonts: Patrick Hand and Gaegu, SIL Open Font License 1.1 (`public/fonts/OFL.txt`). See `public/credits.html`.

## License

Code: MIT. Fonts: SIL OFL 1.1.
