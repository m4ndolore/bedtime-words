/* Bedtime sounds, synthesized so the page needs no audio files.
 *
 * Modeled on Kevin Ngo's doodle chess (x.com/kevin_t_ngo, 2026-09-30): a soft chorused pad over
 * a low drone that changes chord every few seconds, short pencil scratches, music-box notes, and a
 * rising arpeggio at the end. Everything runs through one quiet master gain and a lowpass so it
 * stays gentle at bedtime volume.
 */
(() => {
  'use strict';

  // A slow lullaby turn in C: Cmaj7, Am7, Fmaj7, G6. Each chord lasts CHORD_SECONDS.
  const CHORDS = [
    [130.81, 196.0, 246.94, 329.63],
    [110.0, 164.81, 196.0, 261.63],
    [87.31, 174.61, 220.0, 329.63],
    [98.0, 146.83, 196.0, 246.94],
  ];
  const CHORD_SECONDS = 4.5;
  // C major pentatonic, two octaves, for music-box notes.
  const BELLS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];

  let ctx = null;
  let master = null;
  let padBus = null;
  let fxBus = null;
  let noise = null;
  let padTimer = null;
  let padStep = 0;
  let padFade = null;
  const settings = { sound: true, music: true };

  function setup() {
    if (ctx) return true;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    ctx = new Context();
    master = ctx.createGain();
    master.gain.value = 0.7;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    master.connect(tone).connect(ctx.destination);

    padBus = ctx.createGain();
    padBus.gain.value = 0;
    const padTone = ctx.createBiquadFilter();
    padTone.type = 'lowpass';
    padTone.frequency.value = 900;
    padTone.Q.value = 0.4;
    padBus.connect(padTone).connect(master);

    fxBus = ctx.createGain();
    fxBus.gain.value = 1;
    fxBus.connect(master);

    // One second of white noise, reused for every pencil stroke.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
    return true;
  }

  function now() { return ctx.currentTime; }

  /* ---------- Pad ---------- */

  function padVoice(freq, start, length) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(1, start + 1.6);
    gain.gain.setValueAtTime(1, start + length - 0.2);
    gain.gain.linearRampToValueAtTime(0, start + length + 1.6);
    gain.connect(padBus);
    // Two slightly detuned oscillators give the slow chorus beating heard in the reference.
    for (const detune of [-7, 6]) {
      const osc = ctx.createOscillator();
      osc.type = freq < 120 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const level = ctx.createGain();
      level.gain.value = freq < 120 ? 0.22 : 0.075;
      osc.connect(level).connect(gain);
      osc.start(start);
      osc.stop(start + length + 1.8);
    }
  }

  function playChord() {
    // A suspended context's clock is frozen; chords queued then would all sound at once on resume.
    if (ctx.state !== 'running') return;
    const start = now() + 0.05;
    const chord = CHORDS[padStep % CHORDS.length];
    chord.forEach((freq, index) => padVoice(freq, start + index * 0.12, CHORD_SECONDS));
    padStep += 1;
  }

  function startPad() {
    if (!settings.music || !setup() || padTimer) return;
    clearTimeout(padFade);
    padFade = null;
    padBus.gain.cancelScheduledValues(now());
    padBus.gain.setValueAtTime(padBus.gain.value, now());
    padBus.gain.linearRampToValueAtTime(0.55, now() + 3);
    ctx.resume().then(playChord);
    padTimer = setInterval(playChord, CHORD_SECONDS * 1000);
  }

  function stopPad(seconds = 2) {
    if (!ctx || !padTimer) return;
    padBus.gain.cancelScheduledValues(now());
    padBus.gain.setValueAtTime(padBus.gain.value, now());
    padBus.gain.linearRampToValueAtTime(0, now() + seconds);
    const timer = padTimer;
    padTimer = null;
    setTimeout(() => clearInterval(timer), seconds * 1000);
  }

  /* After "sweet dreams", let the music play on for a while, then drift out. */
  function fadePadLater(delaySeconds, fadeSeconds) {
    clearTimeout(padFade);
    padFade = setTimeout(() => stopPad(fadeSeconds), delaySeconds * 1000);
  }

  /* ---------- Effects ---------- */

  function pencil(strokes = 3) {
    if (!settings.sound || !setup()) return;
    let at = now() + 0.02;
    for (let i = 0; i < strokes; i += 1) {
      const length = 0.06 + Math.random() * 0.09;
      const source = ctx.createBufferSource();
      source.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2600 + Math.random() * 1800;
      band.Q.value = 0.9;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.11, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + length);
      source.connect(band).connect(gain).connect(fxBus);
      source.start(at, Math.random() * 0.8, length + 0.02);
      at += length + 0.03 + Math.random() * 0.06;
    }
  }

  function bell(index = 0, delay = 0, level = 0.16) {
    if (!settings.sound || !setup()) return;
    const freq = BELLS[Math.max(0, Math.min(BELLS.length - 1, index))];
    const start = now() + 0.02 + delay;
    // A music-box tine: the fundamental rings long, an inharmonic partial dies quickly.
    for (const [ratio, amount, decay] of [[1, 1, 1.8], [2.01, 0.28, 0.7], [4.1, 0.12, 0.25]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level * amount, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0005, start + decay);
      osc.connect(gain).connect(fxBus);
      osc.start(start);
      osc.stop(start + decay + 0.05);
    }
  }

  function tap() {
    if (!settings.sound || !setup()) return;
    const start = now() + 0.01;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, start);
    osc.frequency.exponentialRampToValueAtTime(180, start + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
    osc.connect(gain).connect(fxBus);
    osc.start(start);
    osc.stop(start + 0.12);
  }

  function lullaby() {
    [0, 2, 4, 5, 7, 9].forEach((note, step) => bell(note, step * 0.16, 0.13));
    bell(5, 6 * 0.16 + 0.35, 0.1);
  }

  /* ---------- Lifecycle ---------- */

  function unlock() {
    if (!setup()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') ctx.suspend();
    else ctx.resume();
  });

  window.BedtimeSound = {
    unlock,
    configure(next) {
      Object.assign(settings, next);
      if (!settings.music) stopPad(0.8);
    },
    startPad,
    stopPad,
    fadePadLater,
    pencil,
    bell,
    tap,
    lullaby,
  };
})();
