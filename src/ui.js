// HUD, меню, экраны победы/поражения, сохранение прогресса. Весь текст — на русском.
import { LEVELS } from './levels.js';
import { STORAGE_KEY, FAIL_LINES } from './config.js';

// --- сохранение (localStorage может быть недоступен — всё в try/catch) ---------
export function loadSave() {
  const def = { best: {}, skin: 'skin', volume: 0.7 };
  try { return { ...def, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return def; }
}
export function storeSave(save) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); } catch { /* приватный режим и т.п. */ }
}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const stars = (n, max = 3) => '<span class="stars">' + Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('') + '</span>';
export const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

const CONTROLS = [
  ['Мышь', 'двигать кисть влево-вправо и вверх-вниз'],
  ['Колесо / W S', 'вперёд и назад (вглубь коробки)'],
  ['ЛКМ (держать)', 'сжать пальцы и схватить слиток'],
  ['ПКМ + мышь', 'наклон и вращение запястья'],
  ['Q / E', 'поворот кисти влево-вправо'],
  ['C', 'вид сбоку (3 раза за уровень)'],
  ['R', 'начать уровень заново'],
  ['Esc', 'пауза'],
];

export class UI {
  constructor(root, handlers, save) {
    this.root = root; this.h = handlers; this.save = save;
    this.screens = {};
    this._build();
    this.hintTimer = 0; this.toastTimer = 0;
  }

  _screen(name, cls = '') { const s = el('div', `screen ${cls}`); s.dataset.name = name; s.hidden = true; this.root.append(s); this.screens[name] = s; return s; }
  _button(text, fn, cls = '') { const b = el('button', `btn ${cls}`, text); b.addEventListener('click', (e) => { e.stopPropagation(); this.h.click?.(); fn(); }); return b; }

  _build() {
    // --- загрузка
    const loading = this._screen('loading');
    loading.append(el('div', 'title small', 'GOLDEN GRAB'), this.loadBar = el('div', 'loadbar', '<i></i>'), el('div', 'muted', 'Вскрываем хранилище…'));

    // --- главное меню
    const menu = this._screen('menu');
    const card = el('div', 'card menu');
    card.append(el('div', 'kicker', 'ограбление музея · ночь'), el('div', 'title', 'GOLDEN <b>GRAB</b>'), el('div', 'muted lead', 'Просунь руку. Возьми слиток. Не разбей стекло.'));
    card.append(this._button('Играть', () => this.h.play(this._nextLevelIndex()), 'primary'));
    card.append(this._button('Выбор уровня', () => this.show('levels')));
    card.append(this._button('Управление', () => this.show('controls')));
    const opts = el('div', 'opts');
    this.skinBtn = this._button('', () => { this.save.skin = this.save.skin === 'skin' ? 'glove' : 'skin'; this._syncOptions(); this.h.skin(this.save.skin); storeSave(this.save); }, 'ghost');
    const vol = el('label', 'vol', '<span>Громкость</span>');
    this.volInput = el('input'); this.volInput.type = 'range'; this.volInput.min = 0; this.volInput.max = 1; this.volInput.step = 0.01;
    this.volInput.addEventListener('input', () => { this.save.volume = +this.volInput.value; this.h.volume(this.save.volume); storeSave(this.save); });
    vol.append(this.volInput);
    opts.append(this.skinBtn, vol);
    card.append(opts);
    menu.append(card);

    // --- уровни
    const levels = this._screen('levels');
    const lc = el('div', 'card wide');
    lc.append(el('div', 'h2', 'Выбор уровня'));
    this.levelGrid = el('div', 'grid');
    lc.append(this.levelGrid, this._button('Назад', () => this.show('menu'), 'ghost'));
    levels.append(lc);

    // --- управление
    const controls = this._screen('controls');
    const cc = el('div', 'card wide');
    cc.append(el('div', 'h2', 'Управление'));
    cc.append(el('div', 'keys', CONTROLS.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')));
    cc.append(el('div', 'muted', 'Рука тяжёлая и слегка неуклюжая — так задумано. Двигайся плавно: резкий удар оставляет трещину, три трещины — и стекло вдребезги.'));
    cc.append(this._button('Назад', () => this.show(this.controlsBack || 'menu'), 'ghost'));
    controls.append(cc);

    // --- пауза
    const pause = this._screen('pause');
    const pc = el('div', 'card');
    pc.append(el('div', 'h2', 'Пауза'));
    pc.append(this._button('Продолжить', () => this.h.resume(), 'primary'), this._button('Заново', () => this.h.restart()),
      this._button('Управление', () => { this.controlsBack = 'pause'; this.show('controls'); }), this._button('В меню', () => this.h.menu(), 'ghost'));
    pause.append(pc);

    // --- победа
    const win = this._screen('win');
    const wc = el('div', 'card');
    wc.append(el('div', 'kicker', 'слиток в сейфе'), this.winTitle = el('div', 'h2'), this.winStars = el('div', 'bigstars'), this.winStats = el('div', 'stats'));
    this.nextBtn = this._button('Дальше', () => this.h.next(), 'primary');
    wc.append(this.nextBtn, this._button('Ещё раз', () => this.h.restart()), this._button('В меню', () => this.h.menu(), 'ghost'));
    win.append(wc);

    // --- поражение
    const lose = this._screen('lose', 'red');
    const oc = el('div', 'card');
    oc.append(this.loseKicker = el('div', 'kicker'), this.loseLine = el('div', 'h2 line'));
    oc.append(this._button('Ещё раз', () => this.h.restart(), 'primary'), this._button('В меню', () => this.h.menu(), 'ghost'));
    lose.append(oc);

    // --- HUD
    const hud = this.hud = el('div', 'hud'); hud.hidden = true;
    hud.innerHTML = `
      <div class="tl">
        <div class="lvl"></div>
        <div class="row"><span class="timer">0:00.0</span><span class="limit"></span></div>
        <div class="row small"><span>Касания стекла</span><b class="touches">0</b></div>
        <div class="row small"><span>Стекло</span><span class="pips"></span></div>
      </div>
      <div class="tr">
        <div class="cam"><kbd>C</kbd> вид сбоку <b class="camuses">3</b></div>
        <div class="meter" hidden><span class="mlabel"></span><div class="mbar"><i></i></div></div>
      </div>
      <div class="alarm" hidden><span class="atext"></span><b class="acount"></b></div>
      <div class="toast" hidden></div>
      <div class="grab"><i></i><span></span></div>
      <div class="hint"></div>
      <div class="clickme" hidden>Кликни, чтобы захватить мышь</div>`;
    this.root.append(hud);
    const q = (s) => hud.querySelector(s);
    this.$ = { lvl: q('.lvl'), timer: q('.timer'), limit: q('.limit'), touches: q('.touches'), pips: q('.pips'), camuses: q('.camuses'), meter: q('.meter'), mlabel: q('.mlabel'), mbar: q('.mbar i'), alarm: q('.alarm'), atext: q('.atext'), acount: q('.acount'), toast: q('.toast'), grab: q('.grab'), grabText: q('.grab span'), hint: q('.hint'), clickme: q('.clickme') };
    this.vignette = el('div', 'vignette'); this.root.append(this.vignette);

    this._syncOptions();
    this.refreshLevels();
  }

  _syncOptions() {
    this.skinBtn.innerHTML = `Рука: <b>${this.save.skin === 'glove' ? 'перчатка' : 'кожа'}</b>`;
    this.volInput.value = this.save.volume;
  }

  _nextLevelIndex() {
    const i = LEVELS.findIndex((l) => !this.save.best[l.id]);
    return i < 0 ? 0 : i;
  }

  refreshLevels() {
    this.levelGrid.innerHTML = '';
    LEVELS.forEach((l, i) => {
      const best = this.save.best[l.id];
      const b = el('button', 'lvlcard' + (best ? ' done' : ''), `<span class="num">${l.id}</span><span class="name">${l.name}</span>${stars(best?.stars || 0)}<span class="best">${best ? fmtTime(best.time) : '—'}</span>`);
      b.addEventListener('click', () => { this.h.click?.(); this.h.play(i); });
      this.levelGrid.append(b);
    });
  }

  setLoading(p) { this.loadBar.firstChild.style.width = `${Math.round(p * 100)}%`; }

  show(name) {
    if (name === 'menu') this.controlsBack = 'menu';
    for (const [k, s] of Object.entries(this.screens)) s.hidden = k !== name;
    if (name === 'levels') this.refreshLevels();
  }
  hideScreens() { for (const s of Object.values(this.screens)) s.hidden = true; }
  showHud(on) { this.hud.hidden = !on; }

  startLevel(level) {
    this.$.lvl.textContent = `Уровень ${level.id} · ${level.name}`;
    this.$.hint.textContent = level.hint; this.$.hint.classList.remove('gone');
    this.hintTimer = 10;
    this.$.limit.textContent = level.timeLimit ? ` / ${fmtTime(level.timeLimit)}` : '';
    this.$.toast.hidden = true; this.$.alarm.hidden = true; this.$.meter.hidden = true;
    this.vignette.className = 'vignette';
  }

  toast(text, seconds = 2.2) { this.$.toast.textContent = text; this.$.toast.hidden = false; this.toastTimer = seconds; }

  /** Обновление HUD раз в кадр. */
  update(dt, s) {
    this.$.timer.textContent = fmtTime(s.time);
    this.$.timer.classList.toggle('warn', !!s.timeLimit && s.timeLimit - s.time < 10);
    this.$.touches.textContent = s.touches;
    const pips = Array.from({ length: s.maxHealth }, (_, i) => `<i class="${i < s.maxHealth - s.damage ? 'on' : ''}"></i>`).join('');
    if (this._pips !== pips) { this.$.pips.innerHTML = pips; this._pips = pips; }
    this.$.camuses.textContent = s.camUses;
    this.$.meter.hidden = !s.meter;
    if (s.meter) { this.$.mlabel.textContent = s.meter.label; this.$.mbar.style.width = `${Math.min(100, s.meter.value * 100)}%`; }
    this.$.alarm.hidden = !s.alarm;
    if (s.alarm) { this.$.atext.textContent = s.alarm.text; this.$.acount.textContent = s.alarm.hideCount ? '' : s.alarm.left.toFixed(1); }
    this.vignette.classList.toggle('alarm', !!s.alarm);
    this.$.grab.className = 'grab' + (s.holding ? ' hold' : s.grabReady ? ' ready' : '');
    this.$.grabText.textContent = s.holding ? 'держу' : s.grabReady ? 'ЛКМ — схватить' : '';
    this.$.clickme.hidden = !s.needLock;
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) this.$.hint.classList.add('gone'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.$.toast.hidden = true; }
  }

  showWin({ level, time, touches, starsCount, best, hasNext, record }) {
    this.winTitle.textContent = `Уровень ${level.id} пройден`;
    this.winStars.innerHTML = stars(starsCount);
    this.winStats.innerHTML = `<div><span>Время</span><b>${fmtTime(time)}</b></div><div><span>Касания стекла</span><b>${touches}</b></div><div><span>Лучший результат</span><b>${fmtTime(best.time)} ${record ? '· рекорд!' : ''}</b></div>`;
    this.nextBtn.hidden = !hasNext;
    this.show('win');
  }

  showLose(reason) {
    this.loseKicker.textContent = reason;
    this.loseLine.textContent = FAIL_LINES[Math.floor(Math.random() * FAIL_LINES.length)];
    this.show('lose');
  }
}
