// Все звуки синтезируются через WebAudio — внешних файлов нет.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.siren = null;
    this.lastTap = 0;
  }

  /** Вызывать из обработчика пользовательского жеста (клик), иначе браузер не даст звук. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.noiseBuf = this._noiseBuffer(2);
    this._ambient();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  _noiseBuffer(seconds) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _env(gainNode, t, peak, attack, decay) {
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _tone(freq, peak, decay, type = 'sine', when = 0, slideTo = null) {
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + decay);
    this._env(g, t, peak, 0.004, decay);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + decay + 0.05);
  }

  _noise(peak, decay, filterType, freq, q = 1, when = 0) {
    const t = this.ctx.currentTime + when, s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    this._env(g, t, peak, 0.003, decay);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + decay + 0.05);
  }

  _ambient() { // тихий гул хранилища: низкий шум + 50 Гц от ламп
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.value = 140; g.gain.value = 0.11;
    s.connect(f).connect(g).connect(this.master); s.start();
    const hum = this.ctx.createOscillator(), hg = this.ctx.createGain();
    hum.frequency.value = 50; hg.gain.value = 0.012; hum.connect(hg).connect(this.master); hum.start();
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 0.04; lfo.connect(lg).connect(g.gain); lfo.start();
  }

  /** Звон стекла. strength 0..1 */
  glassTap(strength = 0.5) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastTap < 60) return;
    this.lastTap = now;
    const k = 0.05 + strength * 0.3, base = 1900 + Math.random() * 500;
    for (const [mul, dec] of [[1, 0.5], [2.32, 0.32], [3.9, 0.2], [5.4, 0.12]]) this._tone(base * mul, k / mul, dec * (0.6 + strength));
    this._noise(k * 0.7, 0.03, 'highpass', 3000);
  }

  glassCrack() {
    if (!this.ctx) return;
    this._noise(0.5, 0.12, 'highpass', 2500);
    for (let i = 0; i < 6; i++) this._tone(2500 + Math.random() * 5000, 0.12, 0.08 + Math.random() * 0.12, 'triangle', Math.random() * 0.12);
    this._tone(180, 0.3, 0.12, 'sine', 0, 70);
  }

  glassBreak() {
    if (!this.ctx) return;
    this._noise(0.9, 0.5, 'highpass', 1800);
    this._noise(0.5, 0.9, 'bandpass', 5000, 0.7);
    for (let i = 0; i < 34; i++) this._tone(1800 + Math.random() * 7000, 0.1, 0.1 + Math.random() * 0.4, 'sine', Math.random() * 0.9);
    this._tone(120, 0.6, 0.25, 'sine', 0, 45);
  }

  /** Глухой стук слитка. */
  thud(strength = 0.5) {
    if (!this.ctx) return;
    const k = 0.15 + strength * 0.6;
    this._tone(105, k, 0.16, 'sine', 0, 48);
    this._noise(k * 0.5, 0.06, 'lowpass', 500);
    this._tone(2900, k * 0.06, 0.25); // металлический призвук
  }

  click() {
    if (!this.ctx) return;
    this._tone(1500, 0.25, 0.03, 'square');
    this._noise(0.25, 0.02, 'bandpass', 3200, 3);
    this._tone(700, 0.2, 0.04, 'square', 0.045);
  }

  grab() { if (this.ctx) { this._noise(0.12, 0.07, 'lowpass', 900); this._tone(2400, 0.03, 0.2); } }
  /** Предмет засчитан в сейфе (не последний). */
  bank() { if (this.ctx) { this._tone(1319, 0.14, 0.35, 'triangle'); this._tone(1976, 0.08, 0.5, 'sine', 0.07); } }
  uiClick() { if (this.ctx) this._tone(880, 0.08, 0.05, 'triangle'); }
  zap() { if (this.ctx) { this._tone(1800, 0.3, 0.25, 'sawtooth', 0, 200); this._noise(0.3, 0.2, 'bandpass', 4000, 2); } }
  sizzle() { if (this.ctx) this._noise(0.35, 0.5, 'highpass', 4500); }

  win() {
    if (!this.ctx) return;
    [659, 880, 1109, 1319, 1760].forEach((f, i) => { this._tone(f, 0.16, 0.6, 'triangle', i * 0.09); this._tone(f * 2.01, 0.05, 0.8, 'sine', i * 0.09); });
  }

  fail() {
    if (!this.ctx) return;
    [392, 370, 349, 233].forEach((f, i) => this._tone(f, 0.22, i === 3 ? 0.9 : 0.28, 'sawtooth', i * 0.26, i === 3 ? 110 : null));
  }

  sirenStart() {
    if (!this.ctx || this.siren) return;
    const o = this.ctx.createOscillator(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(), g = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 760; lfo.type = 'triangle'; lfo.frequency.value = 1.6; lg.gain.value = 260;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
    g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.16, this.ctx.currentTime + 0.1);
    lfo.connect(lg).connect(o.frequency); o.connect(f).connect(g).connect(this.master);
    o.start(); lfo.start();
    this.siren = { o, lfo, g };
  }

  sirenStop() {
    if (!this.siren) return;
    const { o, lfo, g } = this.siren, t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, 0.05);
    o.stop(t + 0.3); lfo.stop(t + 0.3);
    this.siren = null;
  }
}
