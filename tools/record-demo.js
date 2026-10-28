/* Records a 1080x1920 demo video with sound: the start screen, three affirmations tapped through,
 * and the whale, on an iPhone frame (tools/phone.html).
 *
 *   node tools/record-demo.js [out.mp4]      (needs ffmpeg on PATH)
 *
 * Frames come from a CDP screencast of the frame page. Sound is the app's own Web Audio output,
 * copied off ctx.destination by a ScriptProcessor and stamped with wall-clock time, so both line up
 * on Date.now() and ffmpeg needs no manual offset.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');

const PORT = 4179;
const OUT = path.resolve(process.argv[2] || 'demo.mp4');
const FPS = 30;

/* Runs in the app frame before its scripts: night paper whatever the hour, and tap every connection to the speakers. */
function captureAudio() {
  if (location.protocol === 'http:' && !localStorage.getItem('bedtime-words-v1')) {
    localStorage.setItem('bedtime-words-v1', JSON.stringify({ version: 1, prefs: { night: true } }));
  }
  const connect = AudioNode.prototype.connect;
  const taps = new WeakMap();
  const capture = { blocks: [], sampleRate: 0 };
  window.__capture = capture;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode && !taps.has(this.context)) {
      const ctx = this.context;
      const tap = ctx.createScriptProcessor(2048, 2, 2);
      taps.set(ctx, tap);
      capture.sampleRate = ctx.sampleRate;
      tap.onaudioprocess = (event) => {
        const stamp = ctx.getOutputTimestamp();
        const wall = stamp.performanceTime
          ? performance.timeOrigin + stamp.performanceTime + (event.playbackTime - stamp.contextTime) * 1000
          : Date.now();
        const input = event.inputBuffer;
        capture.blocks.push({ at: wall, left: input.getChannelData(0).slice(), right: input.getChannelData(1).slice() });
      };
      connect.call(tap, target);
    }
    if (target instanceof AudioDestinationNode) connect.call(this, taps.get(this.context));
    return connect.call(this, target, ...rest);
  };
  window.__takeAudio = () => capture.blocks.map((block) => ({
    at: block.at,
    left: Array.from(block.left, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767)),
    right: Array.from(block.right, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767)),
  }));
}

function wav(blocks, sampleRate, start, seconds) {
  const frames = Math.ceil(seconds * sampleRate);
  const pcm = Buffer.alloc(frames * 4);
  for (const block of blocks) {
    const first = Math.round(((block.at - start) / 1000) * sampleRate);
    block.left.forEach((left, i) => {
      const at = first + i;
      if (at < 0 || at >= frames) return;
      pcm.writeInt16LE(left, at * 4);
      pcm.writeInt16LE(block.right[i], at * 4 + 2);
    });
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bedtime-demo-'));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'tests', 'serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  const browser = await chromium.launch({
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, colorScheme: 'light', serviceWorkers: 'block' });
    await context.addInitScript(captureAudio);
    const page = await context.newPage();
    const src = `http://127.0.0.1:${PORT}/`;
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(src); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    await page.goto(`file://${path.join(__dirname, 'phone.html')}?src=${encodeURIComponent(src)}`);
    const app = page.frameLocator('#app');
    await app.locator('#begin').waitFor();
    const frame = page.frames().find((f) => f.url() === src);
    await frame.evaluate(() => document.fonts.ready);

    const shots = [];
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      shots.push({ at: metadata.timestamp * 1000, data });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });

    const pause = (ms) => page.waitForTimeout(ms);
    // The phone is drawn at 2x with a CSS transform, which boundingBox() does not apply.
    const screen = await page.evaluate(() => {
      const rect = document.getElementById('app').getBoundingClientRect();
      return { x: rect.x, y: rect.y, scale: rect.width / 393 };
    });
    async function tap(selector) {
      const box = await frame.locator(selector).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      const x = screen.x + box.x * screen.scale;
      const y = screen.y + box.y * screen.scale;
      await page.evaluate(([px, py]) => window.showTap(px, py), [x, y]);
      await page.mouse.click(x, y);
    }

    await pause(2500);
    await tap('#begin');
    await pause(2600);
    for (let i = 0; i < 3; i += 1) {
      await tap('#screen-card .half--challenge'); // the kids' half
      await pause(2400);
      await tap('#screen-card .half--challenge'); // the next one, or the whale after the third
      await pause(i < 2 ? 2400 : 6500);
    }
    const end = Date.now();
    await cdp.send('Page.stopScreencast');
    const audio = await frame.evaluate(() => window.__takeAudio());
    const sampleRate = await frame.evaluate(() => window.__capture.sampleRate);

    const start = shots[0].at;
    const list = shots.map((shot, i) => {
      const file = path.join(work, `f${String(i).padStart(5, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      const until = i + 1 < shots.length ? shots[i + 1].at : end;
      return `file '${file}'\nduration ${((until - shot.at) / 1000).toFixed(4)}`;
    });
    fs.writeFileSync(path.join(work, 'frames.txt'), `${list.join('\n')}\nfile '${path.join(work, `f${String(shots.length - 1).padStart(5, '0')}.jpg`)}'\n`);
    const seconds = (end - start) / 1000;
    fs.writeFileSync(path.join(work, 'sound.wav'), wav(audio, sampleRate, start, seconds));

    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'),
      '-i', path.join(work, 'sound.wav'),
      '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
      '-c:a', 'aac', '-b:a', '192k', '-t', seconds.toFixed(3), '-movflags', '+faststart', OUT,
    ]);
    console.log(`${OUT}: ${seconds.toFixed(1)} s, ${shots.length} frames, ${audio.length} audio blocks`);
  } finally {
    await browser.close();
    server.kill();
  }
})();
