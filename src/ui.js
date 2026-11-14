// HUD, меню, экраны победы/поражения, сохранение прогресса. Текста здесь нет — только ключи словарей src/i18n/.
import { storeSave, QUALITY_LEVELS, FPS_LIMITS } from './save.js';
import { HEISTS, heistStars, isHeistUnlocked, totalStars, continueLevel, levelById } from './heists.js';
import { cosmeticById, unlockedCosmetics } from './cosmetics.js';
import { platform } from './platform.js';
import { t, tList, tPick, LANGS, getLang, langName, levelName, levelHint, heistName, heistTagline, cosmeticName, metalName } from './i18n/index.js';
import { metalById, unlockedMetals } from './metals.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const stars = (n, max = 3) => '<span class="stars">' + Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('') + '</span>';
export const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };


export class UI {
  constructor(root, handlers, save, settings) {
    this.root = root; this.h = handlers; this.save = save; this.settings = settings;
    this.screens = {};
    this.root.innerHTML = '';     // убрать заставку из index.html
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
    this._build();
    this.hintTimer = 0; this.toastTimer = 0;
  }

  /** Построить интерфейс заново (после смены языка): тот же экран остаётся открытым. */
  rebuild() {
    const open = Object.entries(this.screens).find(([, sc]) => !sc.hidden)?.[0], hud = !this.hud.hidden, back = this.controlsBack;
    this.root.innerHTML = ''; this.screens = {}; this._pips = null;
    this._build();
    this.setLoading(this.loadP || 0);
    if (open) this.show(open);
    this.controlsBack = back; this.showHud(hud);
  }

  /**
   * Масштаб интерфейса. Все размеры в styles.css заданы для экрана 1920×1080; на экранах крупнее (1440p, 4K)
   * интерфейс увеличивается целиком, иначе текст на них получается мелким. На 1080p и меньше масштаб 1.
   */
  applyScale() {
    this.scale = Math.max(1, Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    this.root.style.zoom = this.scale === 1 ? '' : String(this.scale);
  }

  _screen(name, cls = '') { const s = el('div', `screen ${cls}`); s.dataset.name = name; s.hidden = true; this.root.append(s); this.screens[name] = s; return s; }
  _button(text, fn, cls = '') { const b = el('button', `btn ${cls}`, text); b.addEventListener('click', (e) => { e.stopPropagation(); this.h.click?.(); fn(); }); return b; }

  _build() {
    // --- загрузка
    const loading = this._screen('loading');
    loading.append(el('div', 'title', 'GOLDEN <b>GRAB</b>'), this.loadBar = el('div', 'loadbar', '<i></i>'), this.loadText = el('div', 'muted', t('loading.text')), this.loadPct = el('div', 'loadpct', '0 %'));

    // --- главное меню
    const menu = this._screen('menu');
    const card = el('div', 'card menu');
    card.append(el('div', 'kicker', t('menu.kicker')), el('div', 'title', 'GOLDEN <b>GRAB</b>'), el('div', 'muted lead', t('menu.lead')));
    card.append(this._button(t('menu.play'), () => this.h.playId(continueLevel(this.save).id), 'primary'));
    card.append(this._button(t('menu.heists'), () => this.show('levels')));
    card.append(this._button(t('menu.controls'), () => this.show('controls')));
    card.append(this._button(t('menu.settings'), () => this.show('settings')));
    if (platform.isDesktop) card.append(this._button(t('menu.quit'), () => this.h.quit()));   // в браузере закрывать нечего
    const opts = el('div', 'opts');
    this.skinBtn = this._button('', () => {   // перебор открытых вариантов руки по кругу
      const list = unlockedCosmetics('hand', totalStars(this.save)), i = list.findIndex((c) => c.id === this.save.skin);
      this.save.skin = list[(i + 1) % list.length].id;
      this._syncOptions(); this.h.skin(this.save.skin); storeSave(this.save);
    }, 'ghost');
    this.accBtn = this._button('', () => {    // украшение: «нет» и открытые варианты по кругу
      const list = [null, ...unlockedCosmetics('accessory', totalStars(this.save)).map((c) => c.id)], i = list.indexOf(this.save.accessory);
      this.save.accessory = list[(i + 1) % list.length];
      this._syncOptions(); this.h.accessory(this.save.accessory); storeSave(this.save);
    }, 'ghost');
    this.metalBtn = this._button('', () => {  // металл слитка: открытые варианты по кругу
      const list = unlockedMetals(totalStars(this.save)), i = list.findIndex((m) => m.id === this.save.metal);
      this.h.metal(list[(i + 1) % list.length].id);
    }, 'ghost');
    opts.append(this.skinBtn, this.accBtn, this.metalBtn);
    card.append(opts);
    menu.append(card);

    // --- уровни
    const levels = this._screen('levels');
    const lc = el('div', 'card wide');
    lc.append(el('div', 'h2', t('menu.heists')));
    this.levelGrid = el('div', 'heists');
    lc.append(this.levelGrid, this._button(t('common.back'), () => this.show('menu'), 'ghost'));
    levels.append(lc);

    // --- управление
    const controls = this._screen('controls');
    const cc = el('div', 'card wide');
    cc.append(el('div', 'h2', t('menu.controls')));
    cc.append(el('div', 'keys', tList('controls.keys').map((k, i) => `<div><kbd>${k}</kbd><span>${tList('controls.texts')[i]}</span></div>`).join('')));
    cc.append(el('div', 'muted', t('controls.note')));
    cc.append(this._button(t('common.back'), () => this.show(this.controlsBack || 'menu'), 'ghost'));
    controls.append(cc);

    // --- настройки (из главного меню и из паузы). Каждая строка: подпись и либо кнопка «значения по кругу», либо ползунок.
    const settings = this._screen('settings');
    const sc = el('div', 'card wide');
    sc.append(el('div', 'h2', t('menu.settings')));
    const rows = el('div', 'setrows'); sc.append(rows);
    const S = this.settings, set = (change) => this.h.settings(change);
    this._sync = [];
    const row = (key, label, control) => { const r = el('div', 'setrow'); r.dataset.key = key; r.append(el('span', 'setlabel', label), control); rows.append(r); return r; };
    const cycle = (key, label, values, get, textOf, apply) => {
      const b = this._button('', () => apply(values[(values.indexOf(get()) + 1) % values.length]), 'ghost val');
      this._sync.push(() => { b.innerHTML = `<b>${textOf(get())}</b>`; });
      return row(key, label, b);
    };
    const slider = (key, label, min, max, step, textOf) => {
      const wrap = el('label', 'setslider'), input = el('input'), out = el('span', 'setvalue');
      input.type = 'range'; input.min = min; input.max = max; input.step = step;
      input.addEventListener('input', () => { set({ [key]: +input.value }); });
      wrap.append(input, out);
      this._sync.push(() => { input.value = S[key]; out.textContent = textOf(S[key]); });
      return row(key, label, wrap);
    };
    const onOff = (v) => (v ? t('common.on') : t('common.off')), percent = (v) => `${Math.round(v * 100)} %`;
    cycle('lang', t('opt.language'), LANGS, getLang, langName, (v) => this.h.language(v));
    cycle('quality', t('set.quality'), QUALITY_LEVELS, () => S.quality, (v) => t(`set.quality.${v}`), (v) => set({ quality: v }));
    if (platform.isDesktop) cycle('fullscreen', t('opt.display'), [true, false], () => platform.isFullscreen(), (v) => (v ? t('opt.fullscreen') : t('opt.windowed')), (v) => set({ fullscreen: v }));
    cycle('fpsLimit', t('set.fps'), FPS_LIMITS, () => S.fpsLimit, (v) => (v ? t('set.fps.value', { n: v }) : t('set.fps.vsync')), (v) => set({ fpsLimit: v }));
    cycle('showFps', t('set.showFps'), [false, true], () => S.showFps, onOff, (v) => set({ showFps: v }));
    slider('sensitivity', t('set.sensitivity'), 0.3, 2.5, 0.05, (v) => `× ${v.toFixed(2)}`);
    cycle('invertDepth', t('set.invert'), [false, true], () => S.invertDepth, onOff, (v) => set({ invertDepth: v }));
    slider('volume', t('set.sfx'), 0, 1, 0.01, percent);
    slider('music', t('set.music'), 0, 1, 0.01, percent);
    cycle('fatigue', t('set.fatigue'), [true, false], () => S.fatigue, onOff, (v) => set({ fatigue: v }));
    cycle('noFlicker', t('opt.flicker'), [false, true], () => S.noFlicker, (v) => (v ? t('opt.flickerOff') : t('opt.flickerOn')), (v) => set({ noFlicker: v }));
    sc.append(this._button(t('common.back'), () => this.show(this.controlsBack || 'menu'), 'ghost'));
    settings.append(sc);

    // --- пауза
    const pause = this._screen('pause');
    const pc = el('div', 'card');
    pc.append(el('div', 'h2', t('pause.title')));
    pc.append(this._button(t('pause.resume'), () => this.h.resume(), 'primary'), this._button(t('pause.restart'), () => this.h.restart()),
      this._button(t('menu.controls'), () => { this.controlsBack = 'pause'; this.show('controls'); }), this._button(t('menu.settings'), () => { this.controlsBack = 'pause'; this.show('settings'); }),
      this._button(t('common.toMenu'), () => this.h.menu(), 'ghost'));
    pause.append(pc);

    // --- победа
    const win = this._screen('win');
    const wc = el('div', 'card');
    wc.append(el('div', 'kicker', t('win.kicker')), this.winTitle = el('div', 'h2'), this.winStars = el('div', 'bigstars'), this.winStats = el('div', 'stats'), this.winNote = el('div', 'muted'));
    this.nextBtn = this._button(t('win.next'), () => this.h.next(), 'primary');
    wc.append(this.nextBtn, this._button(t('common.retry'), () => this.h.restart()), this._button(t('common.toMenu'), () => this.h.menu(), 'ghost'));
    win.append(wc);

    // --- поражение
    const lose = this._screen('lose', 'red');
    const oc = el('div', 'card');
    oc.append(this.loseKicker = el('div', 'kicker'), this.loseLine = el('div', 'h2 line'));
    oc.append(this._button(t('common.retry'), () => this.h.restart(), 'primary'), this._button(t('common.toMenu'), () => this.h.menu(), 'ghost'));
    lose.append(oc);

    // --- HUD
    const hud = this.hud = el('div', 'hud'); hud.hidden = true;
    hud.innerHTML = `
      <div class="tl">
        <div class="lvl"></div>
        <div class="row"><span class="timer">0:00.0</span><span class="limit"></span></div>
        <div class="row small"><span>${t('hud.touches')}</span><b class="touches">0</b></div>
        <div class="row small"><span>${t('hud.glass')}</span><span class="pips"></span></div>
        <div class="row small lootrow" hidden><span class="lootlabel"></span><b class="loot"></b></div>
      </div>
      <div class="tr">
        <div class="cam"><kbd>C</kbd> ${t('hud.side')} <b class="camuses">3</b></div>
        <div class="meter" hidden><span class="mlabel"></span><div class="mbar"><i></i><b class="mmark" hidden></b></div></div>
        <div class="meter meter2" hidden><span class="mlabel"></span><div class="mbar"><i></i><b class="mmark" hidden></b></div></div>
      </div>
      <div class="alarm" hidden><span class="atext"></span><b class="acount"></b></div>
      <div class="toast" hidden></div>
      <div class="bottom">
        <div class="grab"><i></i><span></span></div>
        <div class="hint"></div>
      </div>
      <div class="clickme" hidden>${t('hud.clickme')}</div>`;
    this.root.append(hud);
    const q = (s) => hud.querySelector(s);
    this.$ = { lootrow: q('.lootrow'), lootlabel: q('.lootlabel'), loot: q('.loot'), lvl: q('.lvl'), timer: q('.timer'), limit: q('.limit'), touches: q('.touches'), pips: q('.pips'), camuses: q('.camuses'), meter: q('.meter:not(.meter2)'), mlabel: q('.meter:not(.meter2) .mlabel'), mbar: q('.meter:not(.meter2) .mbar i'), mmark: q('.meter:not(.meter2) .mmark'), alarm: q('.alarm'), atext: q('.atext'), acount: q('.acount'), toast: q('.toast'), grab: q('.grab'), grabText: q('.grab span'), hint: q('.hint'), clickme: q('.clickme') };
    this.$2 = { meter: q('.meter2'), label: q('.meter2 .mlabel'), bar: q('.meter2 .mbar i'), mark: q('.meter2 .mmark') };
    this.vignette = el('div', 'vignette'); this.root.append(this.vignette);
    this.fpsBox = el('div', 'fpsbox'); this.fpsBox.hidden = true; this.root.append(this.fpsBox);

    this._syncOptions();
    this.refreshLevels();
  }

  _syncOptions() {
    this.skinBtn.innerHTML = `${t('opt.hand')}: <b>${cosmeticName(cosmeticById(this.save.skin))}</b>`;
    this.accBtn.innerHTML = `${t('opt.accessory')}: <b>${this.save.accessory ? cosmeticName(cosmeticById(this.save.accessory)) : t('opt.accessoryNone')}</b>`;
    this.metalBtn.innerHTML = `${t('opt.metal')}: <b>${metalName(metalById(this.save.metal))}</b>`;
    this.metalBtn.hidden = unlockedMetals(totalStars(this.save)).length < 2;                       // выбирать не из чего — кнопки нет
    this.accBtn.hidden = unlockedCosmetics('accessory', totalStars(this.save)).length === 0;   // пока ничего не открыто, кнопки нет
    for (const fn of this._sync) fn();
  }

  /** Экран выбора: по блоку на ограбление — название, звёзды, замок с порогом, карточки уровней. */
  refreshLevels() {
    this.levelGrid.innerHTML = '';
    const have = totalStars(this.save);
    for (const heist of HEISTS) {
      const open = isHeistUnlocked(heist, this.save), st = heistStars(heist, this.save);
      const block = el('div', 'heist' + (open ? '' : ' locked'));
      const status = !open ? t('heist.locked', { need: heist.unlockStars, have }) : heist.levels.length ? t('heist.stars', st) : t('heist.empty');
      block.append(el('div', 'heisthead', `<span class="hname">${heistName(heist)}</span><span class="htag">${heistTagline(heist)}</span><span class="hstat">${open ? '' : '<i class="lock"></i>'}${status}</span>`));
      const grid = el('div', 'grid');
      heist.levels.forEach((id, i) => {
        const l = levelById(id), best = this.save.best[id];
        const b = el('button', 'lvlcard' + (best ? ' done' : ''), `<span class="num">${i + 1}</span><span class="name">${levelName(l)}</span>${stars(best?.stars || 0)}<span class="best">${best ? fmtTime(best.time) : '—'}</span>`);
        b.disabled = !open;
        b.addEventListener('click', () => { this.h.click?.(); this.h.playId(id); });
        grid.append(b);
      });
      if (heist.levels.length) block.append(grid);
      this.levelGrid.append(block);
    }
  }

  /** Настройки изменились (в том числе полный экран по Alt+Enter): обновить подписи. */
  syncSettings() { this._syncOptions(); }

  /** Счётчик кадров в углу: число или null, чтобы спрятать. */
  setFps(fps) { this.fpsBox.hidden = fps == null; if (fps != null) this.fpsBox.textContent = `${Math.round(fps)} FPS`; }

  setLoading(p) { this.loadP = p; this.loadBar.firstChild.style.width = `${Math.round(p * 100)}%`; this.loadPct.textContent = `${Math.round(p * 100)} %`; }

  show(name) {
    if (name === 'menu') this.controlsBack = 'menu';
    for (const [k, s] of Object.entries(this.screens)) s.hidden = k !== name;
    if (name === 'levels') this.refreshLevels();
  }
  hideScreens() { for (const s of Object.values(this.screens)) s.hidden = true; }
  showHud(on) { this.hud.hidden = !on; }

  /** @param place место уровня в кампании ({ heist, number }) или null для уровня вне кампании */
  startLevel(level, place) {
    this.$.lvl.textContent = (place ? t('hud.level', { heist: heistName(place.heist), number: place.number, name: levelName(level) }) : t('hud.levelPlain', { id: level.id, name: levelName(level) })) + (level.stageCount ? ` · ${t('hud.stage', { i: level.stage, n: level.stageCount })}` : '');
    this.$.lootlabel.textContent = t('hud.loot');
    this.$.hint.textContent = levelHint(level); this.$.hint.classList.remove('gone');
    this.hintTimer = 10;
    this.$.limit.textContent = level.timeLimit ? ` / ${fmtTime(level.timeLimit)}` : '';
    this.$.toast.hidden = true; this.$.alarm.hidden = true; this.$.meter.hidden = true; this.$2.meter.hidden = true;
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
    this.$.lootrow.hidden = !s.loot;
    if (s.loot) this.$.loot.textContent = `${s.loot.done} / ${s.loot.need}`;
    // вторая полоска — усталость руки (первая занята ловушкой или хватом)
    this.$2.meter.hidden = !s.meter2;
    if (s.meter2) {
      this.$2.label.textContent = s.meter2.label; this.$2.bar.style.width = `${Math.min(100, s.meter2.value * 100)}%`;
      this.$2.mark.hidden = s.meter2.mark == null;
      if (s.meter2.mark != null) this.$2.mark.style.left = `${s.meter2.mark * 100}%`;
      this.$2.meter.classList.toggle('hot', s.meter2.mark != null && s.meter2.value >= s.meter2.mark);
    }
    this.$.meter.hidden = !s.meter;
    if (s.meter) {
      this.$.mlabel.textContent = s.meter.label; this.$.mbar.style.width = `${Math.min(100, s.meter.value * 100)}%`;
      // необязательные поля полоски: mark — отметка порога (0..1), good — зелёная полоска (чем полнее, тем лучше)
      this.$.mmark.hidden = s.meter.mark == null;
      if (s.meter.mark != null) this.$.mmark.style.left = `${s.meter.mark * 100}%`;
      this.$.meter.classList.toggle('good', !!s.meter.good);
    }
    this.$.alarm.hidden = !s.alarm;
    if (s.alarm) { this.$.atext.textContent = s.alarm.text; this.$.acount.textContent = s.alarm.hideCount ? '' : s.alarm.left.toFixed(1); }
    this.vignette.classList.toggle('alarm', !!s.alarm);
    this.$.grab.className = 'grab' + (s.holding ? ' hold' : s.grabReady ? ' ready' : '');
    this.$.grabText.textContent = s.holding ? t('hud.holding') : s.grabReady ? t('hud.grabReady') : '';
    this.$.clickme.hidden = !s.needLock;
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) this.$.hint.classList.add('gone'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.$.toast.hidden = true; }
  }

  /** next — следующий уровень кампании ({ heist, locked }) или null; stars — сумма звёзд игрока. */
  showWin({ level, place, time, touches, starsCount, best, next, record, stars: have }) {
    this.winTitle.textContent = place ? t('win.title', { heist: heistName(place.heist), number: place.number }) : t('win.titlePlain', { id: level.id });
    this.winStars.innerHTML = stars(starsCount);
    this.winStats.innerHTML = `<div><span>${t('win.time')}</span><b>${fmtTime(time)}</b></div><div><span>${t('hud.touches')}</span><b>${touches}</b></div><div><span>${t('win.best')}</span><b>${fmtTime(best.time)} ${record ? '· ' + t('win.record') : ''}</b></div>`;
    this.nextBtn.hidden = !next || next.locked;
    this.winNote.textContent = !next ? t('win.campaignDone') : next.locked ? t('win.nextLocked', { heist: heistName(next.heist), need: next.heist.unlockStars, have }) : '';
    this.winNote.hidden = !this.winNote.textContent;
    this._syncOptions();
    this.show('win');
  }

  /** Короткое затемнение при смене этапа. */
  fade() { this.vignette.classList.remove('fade'); void this.vignette.offsetWidth; this.vignette.classList.add('fade'); }

  showLose(reason) {
    this.loseKicker.textContent = reason;
    this.loseLine.textContent = tPick('fail.lines');
    this.show('lose');
  }
}
