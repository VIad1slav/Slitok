// Golden Grab — инициализация и игровой цикл.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYS, HAND, GLASS, WORLD } from './config.js';
import { LEVELS, starsFor, stageDef, stageCount } from './levels.js';
import { createMaterials, textureReport } from './textures.js';
import { onLoadProgress } from './loading.js';
import { loadModels } from './assets.js';
import { Stage } from './scene.js';
import { GlassBox, GROUP } from './box.js';
import { Loot } from './loot.js';
import { levelLoot, lootNeeded } from './loot-types.js';
import { nextAfter, placeOf, levelById, totalStars } from './heists.js';
import { cosmeticById, unlockedCosmetics } from './cosmetics.js';
import { t, setLang, lootName, lootFall, lootBroken } from './i18n/index.js';
import { spawnShards } from './shards.js';
import { Hand } from './hand.js';
import { Pedestal, createTraps } from './traps.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { loadAll, storeSave, storeSettings, migrateSettings } from './save.js';
import { autopilotFor } from './autoplay.js';
import { platform } from './platform.js';
import { Achievements } from './achievements.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
/** Дать браузеру нарисовать кадр (полоска загрузки успевает обновиться). */
const limitedBelow50 = (limit) => limit > 0 && limit < 50;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

class Game {
  constructor() {
    this.state = 'loading';     // loading | menu | playing | paused | ending | won | lost
    this.levelIndex = 0;
    this.acc = 0; this.clock = 0; this.timeScale = 1;
    this.keys = new Set(); this.rmb = false; this.hadLock = false;
    this.autopilot = null;
    this.hud = { meter: null };
    this.fps = 60; this._fpsAcc = 0; this._fpsFrames = 0; this._lowFpsTime = 0;
    const data = loadAll();
    this.save = data.save; this.settings = data.settings;
    if (data.notes.save || data.notes.settings) console.info('[Golden Grab] player files were damaged:', data.notes);   // 'restored' — взята запасная копия, 'reset' — начато заново
    setLang(this.settings.lang);        // null — язык системы
    // Достижения: запоминаются в сохранении и отправляются в Steam, если он есть. При запуске всё полученное
    // отправляется заново — на случай, если раньше играли без Steam.
    this.achievements = new Achievements(this.save, { onUnlock: (id) => platform.unlockAchievements([id]), onChange: () => storeSave(this.save) });
    platform.unlockAchievements(this.achievements.sync());
    this.audio = new AudioSys();
    this.audio.volume = this.settings.volume; this.audio.music = this.settings.music;
  }

  async init() {
    this.ui = new UI(document.getElementById('ui'), {
      click: () => { this.audio.init(); this.audio.uiClick(); },
      playId: (id) => this.startLevelById(id),
      resume: () => this.resume(),
      restart: () => this.restartLevel(),
      next: () => { const n = nextAfter(this.level.id, this.save); if (n && !n.locked) this.startLevelById(n.level.id); else this.toMenu(); },
      menu: () => this.toMenu(),
      skin: (id) => this.hand.setSkin(cosmeticById(id)),
      accessory: (id) => this.hand.setAccessory(id ? cosmeticById(id) : null, this.models),
      language: (lang) => this.setLanguage(lang),
      quit: () => platform.quit(),
      settings: (change) => this.applySettings(change),
    }, this.save, this.settings);
    this.ui.show('loading');

    // Экран загрузки висит, пока не загружены все текстуры и модели и не нарисован первый кадр:
    // 90 % полоски — файлы, остальное — сборка сцены и компиляция шейдеров.
    onLoadProgress((p) => this.ui.setLoading(p * 0.9));
    const [{ models, missing }, mats] = await Promise.all([loadModels(), createMaterials()]);
    this.models = models; this.M = mats.M;
    this.assetReport = { missingModels: missing, fallbackTextures: mats.fallbacks, pngTextures: textureReport.png };
    if (missing.length || mats.fallbacks.length || textureReport.png.length) console.info('[Golden Grab] fallback assets:', this.assetReport);
    this.ui.setLoading(0.92);
    await nextFrame();

    this.stage = new Stage(document.getElementById('c'), this.M, models);
    this.stage.setQuality(this.settings.quality || 'high');
    this._initPhysics();
    this.hand = new Hand({ scene: this.stage.scene, world: this.world, M: this.M, glbScene: models.hand });
    this.hand.setSkin(cosmeticById(this.save.skin));
    if (this.save.accessory) this.hand.setAccessory(cosmeticById(this.save.accessory), models);
    this._bindInput();

    this.levelDef = LEVELS[0]; this.stageIndex = 0;
    this._loadLevel(LEVELS[0]);
    // первый кадр рисуется ещё под экраном загрузки: здесь компилируются шейдеры, и меню появляется без рывка
    this.hand.updateVisual(0); this.stage.update(0, 0, this.hand.pos, 0); this.stage.render();
    if (!this.settings.quality) { this.settings.quality = this._pickQuality(); storeSettings(this.settings); }
    this.ui.setLoading(1);
    await nextFrame();
    this.state = 'menu';
    this.ui.show('menu');
    this._last = performance.now();
    requestAnimationFrame((t) => this._frame(t));
  }

  _initPhysics() {
    const world = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYS.gravity, 0) });
    world.solver.iterations = PHYS.solverIterations;
    world.allowSleep = false;
    world.defaultContactMaterial.friction = 0.45;
    world.defaultContactMaterial.restitution = 0;
    this.staticMaterial = new CANNON.Material('static');   // контактные материалы «предмет — статика» заводит src/loot.js

    const [tw, tt, td] = WORLD.tableSize, c = new THREE.Vector3(0, WORLD.tableY - tt / 2, 0), h = new THREE.Vector3(tw / 2, tt / 2, td / 2);
    const table = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.staticMaterial, collisionFilterGroup: GROUP.STATIC, collisionFilterMask: GROUP.BAR });
    table.addShape(new CANNON.Box(new CANNON.Vec3(h.x, h.y, h.z)));
    table.position.set(c.x, c.y, c.z);
    table.userData = { kind: 'table' };
    world.addBody(table);
    this.tableCollider = { type: 'box', kind: 'table', c, h, q: null, qi: null };
  }

  // --- уровни ---------------------------------------------------------------
  _clearLevel() {
    this.traps?.forEach((t) => t.dispose());
    this.pedestal?.dispose(); this.items?.forEach((it) => it.dispose()); this.box?.dispose();
    this.traps = []; this.items = []; this.pedestal = this.box = null;
    this.shards?.forEach((s) => s.dispose()); this.shards = [];
    this.audio.sirenStop();
  }

  /** @param level описание уровня (обычно из LEVELS; проверки могут передать своё) */
  _loadLevel(level) {
    this._clearLevel();
    this.level = level;
    this.levelIndex = LEVELS.indexOf(this.levelDef ?? level);
    const scene = this.stage.scene, world = this.world, M = this.M, staticMaterial = this.staticMaterial;
    this.box = new GlassBox({ scene, world, level, M, glbRoot: this.models.glass_box, staticMaterial });
    if (level.pedestal) this.pedestal = new Pedestal({ scene, world, M, level, glbScene: this.models.pedestal, staticMaterial });
    this.items = levelLoot(level).map((def, index) => new Loot({ scene, world, M, models: this.models, level, def, index, staticMaterial }));
    for (const it of this.items) it.body.addEventListener('collide', (e) => this._onLootCollide(e));
    this.lootNeed = lootNeeded(level); this.lootDone = 0;
    this.traps = createTraps(level, { scene, world, M, level, items: this.items, staticMaterial, stage: this.stage, models: this.models });
    this._refreshStatics();
    this.hand.reset(level);
    this.stage.setLevel(level);

    this.time = 0; this.touches = 0; this.endTimer = 0; this.endAction = null;
    this.lastGlassContact = -9; this.lastHit = -9; this.alarmState = null; this.safePulse = 0;
    this.hud.meter = null; this.acc = 0;
  }

  _refreshStatics() {
    this.hand.statics = [...this.box.colliders, this.tableCollider, ...(this.pedestal?.colliders || []), ...this.traps.flatMap((t) => t.colliders || [])];
  }

  startLevel(index) { this.startLevelDef(LEVELS[index]); }
  startLevelById(id) { this.startLevelDef(levelById(id)); }

  /**
   * Запустить уровень по его описанию. У многоэтапного уровня (level.stages) stage — номер этапа с нуля,
   * carry — что переносится между этапами: { time, touches }.
   */
  startLevelDef(level, stage = 0, carry = null) {
    this.audio.init();
    this.autopilot = null; this.autoOn = false; this.result = null;   // автопилот прошлого уровня не должен рулить новым
    this.levelDef = level; this.stageIndex = stage;
    this._loadLevel(stageDef(level, stage));
    if (carry) { this.time = carry.time; this.touches = carry.touches; }
    this.state = 'playing';
    const place = placeOf(level.id);
    this.stage.setTheme(place?.heist.theme);
    this.ui.hideScreens(); this.ui.showHud(true); this.ui.startLevel(this.level, place);
    this._requestLock();
  }

  /** «Ещё раз»: обычный уровень — с начала; многоэтапный — с текущего этапа, время и касания продолжают идти. */
  restartLevel() {
    if (this.levelDef.stages && this.stageIndex > 0) this.startLevelDef(this.levelDef, this.stageIndex, { time: this.time, touches: this.touches });
    else this.startLevelDef(this.levelDef);
  }

  /** Добыча этапа в сейфе: следующий этап или победа. */
  _stageDone() {
    const n = stageCount(this.levelDef);
    if (this.stageIndex + 1 >= n) return this.win();
    const auto = this.autoOn, scale = this.timeScale;
    this.audio.bank();
    this.startLevelDef(this.levelDef, this.stageIndex + 1, { time: this.time, touches: this.touches });
    this.ui.fade(); this.toast(t('toast.stage', { i: this.stageIndex + 1, n }));
    if (auto) { this.autopilot = autopilotFor(this); this.autoOn = true; this.timeScale = scale; }
  }

  /**
   * Первый запуск: подобрать качество графики по скорости видеокарты. Рисуется несколько кадров на «высоком»,
   * затем на «среднем»; выбирается самое красивое, при котором кадр укладывается в запас для 60 кадров в секунду.
   * Игрок может поменять выбор в настройках.
   */
  _pickQuality() {
    const gl = this.stage.renderer.getContext(), px = new Uint8Array(4);
    const frameMs = () => {
      const run = (n) => { const a = performance.now(); for (let i = 0; i < n; i++) { this.stage.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - a) / n; };
      run(2); return run(4);
    };
    const BUDGET_MS = 9;      // кадр отрисовки не дольше 9 мс: остаётся запас на физику и на сцены тяжелее первой
    let pick = 'low';
    for (const q of ['high', 'medium']) { this.stage.setQuality(q); if (frameMs() <= BUDGET_MS) { pick = q; break; } }
    this.stage.setQuality(pick);
    this.qualityPicked = pick;
    return pick;
  }

  /**
   * Изменить настройки: change — { имя: значение } (имена — SETTINGS_DEFAULTS в src/save.js).
   * Значения проверяются, применяются сразу и записываются.
   */
  applySettings(change) {
    const before = { ...this.settings };
    Object.assign(this.settings, migrateSettings({ ...this.settings, ...change }));
    this.settings.quality ??= before.quality;          // недопустимое значение качества не сбрасывает выбранное
    const s = this.settings, changed = (k) => s[k] !== before[k];
    if (changed('quality')) { this.stage?.setQuality(s.quality); this._lowFpsTime = 0; }
    if (changed('volume')) this.audio.setVolume(s.volume);
    if (changed('music')) this.audio.setMusicVolume(s.music);
    if ('fullscreen' in change && s.fullscreen !== platform.isFullscreen()) platform.setFullscreen(s.fullscreen);
    if (changed('lang')) return this.setLanguage(s.lang);
    storeSettings(s);
    this.ui.syncSettings();
  }

  /** Сменить язык: тексты интерфейса строятся заново, уровень и его состояние не трогаются. */
  setLanguage(lang) {
    this.settings.lang = setLang(lang); storeSettings(this.settings);
    this.ui.rebuild();
    if (this.state === 'paused') this.ui.startLevel(this.level, placeOf(this.level.id));
  }

  toMenu() {
    this.state = 'menu'; this.audio.sirenStop(); this.stage.setAlarm(false);
    this.ui.showHud(false); this.ui.show('menu');
    document.exitPointerLock?.();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; this.hand.setGrip(false);
    this.audio.sirenStop();
    this.ui.show('pause');
    document.exitPointerLock?.();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing'; this.ui.hideScreens();
    if (this.alarmState) this.audio.sirenStart();
    this._requestLock();
  }

  // --- события игры -----------------------------------------------------------
  toast(text) { this.ui.toast(text); }

  /** Тревога: сирена, красный свет и обратный отсчёт до провала. */
  /** failReason — что написать на экране поражения, если отсчёт дойдёт до нуля. */
  alarm(seconds, text, hideCount = false, failReason = t('fail.alarm')) {
    if (this.alarmState || this.state !== 'playing') return;
    this.alarmState = { left: seconds, text, hideCount, failReason };
    this.stage.setAlarm(true);
    this.audio.sirenStart();
  }

  fail(reason) {
    if (this.state !== 'playing') return;
    this.state = 'ending'; this.endTimer = 1.3; this.result = 'lost: ' + reason;
    this.hand.setGrip(false);
    this.endAction = () => {
      this.state = 'lost'; this.audio.sirenStop(); this.audio.fail();
      this.ui.showLose(reason);
      document.exitPointerLock?.();
    };
  }

  win() {
    if (this.state !== 'playing') return;
    const level = this.level, time = this.time, touches = this.touches, starsCount = starsFor(level, time, touches);
    const prev = this.save.best[level.id];
    const record = !prev || starsCount > prev.stars || (starsCount === prev.stars && time < prev.time);
    if (record) { this.save.best[level.id] = { stars: starsCount, time: +time.toFixed(2), touches }; storeSave(this.save); }
    this.achievements.emit('win', { level: level.id, time, touches, stars: starsCount });
    this.state = 'ending'; this.endTimer = 0.7; this.result = 'won';
    this.audio.sirenStop(); this.stage.setAlarm(false); this.alarmState = null;
    this.audio.win();
    this.endAction = () => {
      this.state = 'won';
      this.ui.showWin({ level, place: placeOf(level.id), time, touches, starsCount, best: this.save.best[level.id], record: record && !!prev, next: nextAfter(level.id, this.save), stars: totalStars(this.save) });
      document.exitPointerLock?.();
    };
  }

  _glassContact(wall, impact) {
    if (this.box.broken) return;
    if (this.time - this.lastGlassContact > GLASS.touchCooldown) {
      if (this.state === 'playing') this.touches++;
      this.audio.glassTap(clamp(impact / 1.4, 0.08, 1));
    }
    this.lastGlassContact = this.time;
    if (impact >= this.box.hitSpeed && this.time - this.lastHit > 0.3) {
      this.lastHit = this.time;
      const broken = this.box.hit(wall);
      this.audio.glassCrack();
      if (broken) {
        this.audio.glassBreak();
        this._refreshStatics();
        if (this.state === 'playing') this.achievements.emit('glassBroken');
        this.fail(t('fail.glass'));
      }
    }
  }

  /** Удар по хрупкой добыче: трещина или вдребезги. */
  _fragileHit(item, speed) {
    const r = item.hit(speed, this.time, this.M.cracks[1]);
    if (r === 'crack') { this.audio.glassCrack(); this.toast(t('toast.cracked', { name: lootName(item.type) })); }
    else if (r === 'break') {
      if (this.hand.item === item) this.hand.release('open');
      this.audio.glassBreak();
      this.shards.push(spawnShards(this.stage.scene, item.position(), item.type.bounds, item.material.color));
      if (this.state === 'playing') this.achievements.emit('lootBroken', { type: item.type.id });
      this.fail(lootBroken(item.type));
    }
  }

  _onLootCollide(e) {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal()), kind = e.body.userData?.kind;
    if (kind === 'glass') this._glassContact(e.body.userData.wall, v >= GLASS.barHitSpeed ? Math.max(v, this.box.hitSpeed) : Math.min(v, this.box.hitSpeed * 0.9));
    else if (kind !== 'hand' && v > 0.3) this.audio.thud(clamp(v / 2.5, 0, 1));
  }

  // --- ввод -----------------------------------------------------------------
  _requestLock() {
    const c = this.stage.renderer.domElement;
    try { const p = c.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* нет жеста пользователя — мышь захватится по клику */ }
  }

  _bindInput() {
    const canvas = this.stage.renderer.domElement;
    const locked = () => document.pointerLockElement === canvas;
    canvas.addEventListener('mousedown', (e) => {
      this.audio.init();
      if (this.state !== 'playing') return;
      if (!locked()) this._requestLock();
      if (e.button === 0) this.hand.setGrip(true);
      if (e.button === 2) this.rmb = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.hand.setGrip(false);
      if (e.button === 2) this.rmb = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || !locked()) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      // ПКМ + мышь направляет кисть: влево-вправо — поворот, вверх-вниз — наклон; скручивание запястья — Q/E
      const k = this.settings.sensitivity;   // чувствительность мыши из настроек
      if (this.rmb) this.hand.rotate(-dy * HAND.rotSens * k, 0, -dx * HAND.rotSens * k);
      else this.hand.moveTarget(dx * HAND.mouseSens * k, -dy * HAND.mouseSens * k, 0);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.state === 'playing') this.hand.moveTarget(0, 0, Math.sign(e.deltaY) * HAND.wheelStep * this._depthSign());
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      if (locked()) this.hadLock = true;
      else if (this.hadLock && this.state === 'playing') this.pause(); // Esc снимает захват мыши → пауза
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape') { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); }
      if (this.state !== 'playing') return;
      if (e.code === 'KeyR') this.restartLevel();
      if (e.code === 'KeyC' && !this.stage.toggleSide()) this.toast(t('toast.sideOver'));
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Окно потеряло фокус (Alt+Tab, свернули, оверлей Steam): клавиши отпускаются, игра встаёт на паузу — физика не идёт.
    // Автопилот (проверки) паузой не прерывается.
    const away = () => { this.keys.clear(); this.rmb = false; this.hand.setGrip(false); if (!this.autopilot) this.pause(); };
    window.addEventListener('blur', away);
    document.addEventListener('visibilitychange', () => { if (document.hidden) away(); });
    platform.onFullscreen((on) => { this.settings.fullscreen = on; storeSettings(this.settings); this.ui.syncSettings(); });
    // в сборке для игроков контекстного меню нет нигде
    if (platform.isDesktop && !platform.dev) window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Настройка «инверсия вперёд-назад»: −1 меняет местами направления колеса и клавиш W/S. */
  _depthSign() { return this.settings.invertDepth ? -1 : 1; }

  _applyKeys(dt) {
    const k = this.keys, sign = this._depthSign();
    if (k.has('KeyW')) this.hand.moveTarget(0, 0, -HAND.keySpeed * dt * sign);
    if (k.has('KeyS')) this.hand.moveTarget(0, 0, HAND.keySpeed * dt * sign);
    if (k.has('KeyQ')) this.hand.rotate(0, HAND.twistSpeed * dt);
    if (k.has('KeyE')) this.hand.rotate(0, -HAND.twistSpeed * dt);
  }

  // --- симуляция --------------------------------------------------------------
  _fixedStep(dt) {
    const playing = this.state === 'playing';
    if (playing) {
      this.time += dt;
      if (this.autopilot) { const r = this.autopilot.next(); if (r.done) this.autopilot = null; } else this._applyKeys(dt);
    }
    this.hud.meter = null;
    this.hand.step(dt, this.items);
    this.world.step(dt);
    for (const it of this.items) if (!it.banked) { it.postStep(); if (it.impact > 0) this._fragileHit(it, it.impact); }

    for (const ev of this.hand.events) {
      if (ev.type === 'contact') {
        if (ev.kind === 'glass') {
          this._glassContact(ev.wall, ev.impact);
          // скользкая добыча (бриллиант) выпадает из пальцев от удара руки о стекло
          const drop = this.hand.item?.type.dropImpact;
          if (drop && ev.impact >= drop) this.hand.release('slip');
        }
        else if (ev.byBar && ev.impact > 0.35) this.audio.thud(clamp(ev.impact / 2, 0, 1));
        if (ev.byBar && this.hand.item) this._fragileHit(this.hand.item, ev.impact);   // хрупкий предмет в руке ударился о стекло или стол
      } else if (ev.type === 'grab') this.audio.grab();
      else if (ev.type === 'release' && ev.reason === 'slip') this.toast(t('toast.slipped'));
    }
    this.hand.events.length = 0;
    if (!playing) return;

    const ctx = { game: this, hand: this.hand, items: this.items, audio: this.audio, time: this.time };
    for (const t of this.traps) t.step(dt, ctx);
    // полоска «хват» для скользкой добычи: насколько скорость кисти близка к той, на которой предмет выскользнет
    if (!this.hud.meter && this.hand.item?.type.slipSpeed) this.hud.meter = { label: t('meter.grip'), value: this.hand.vel.length() / this.hand.slipSpeed };

    if (this.alarmState) {
      this.alarmState.left -= dt;
      if (this.alarmState.left <= 0) return this.fail(this.alarmState.failReason);
    }
    if (this.level.timeLimit && this.time > this.level.timeLimit) return this.fail(t('fail.time'));

    // добыча: предмет полежал в «сейфе» без руки — засчитан; вся нужная добыча в сейфе — победа
    const s = this.level.safe;
    this.safePulse = 0;
    for (const it of this.items) {
      if (it.banked) continue;
      const p = it.body.position;
      if (p.y < WORLD.tableY - 0.2) {
        if (it.role === 'target') return this.fail(lootFall(it.type));
        it.bank(); this.toast(t('toast.propLost'));
        continue;
      }
      if (it.role !== 'target') continue;
      const d = Math.hypot(p.x - s.pos[0], p.z - s.pos[1]), inZone = d < s.radius - 0.02 && p.y < WORLD.tableY + 0.14 && p.y > WORLD.tableY;
      if (inZone) this.safePulse = 1;
      if (inZone && this.hand.item !== it && it.speed() < 0.08) {
        it.zoneTime += dt;
        if (it.zoneTime > 0.35) {
          this.lootDone++;
          if (this.lootDone >= this.lootNeed) return this._stageDone();
          it.bank(); this.stage.flashSafe(); this.audio.bank();
          this.toast(t('toast.banked', { done: this.lootDone, total: this.lootNeed }));
        }
      } else it.zoneTime = 0;
    }
  }

  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    // предел кадров из настроек: лишние кадры пропускаются целиком (ни физики, ни отрисовки)
    const limit = this.settings.fpsLimit;
    if (limit > 0 && now - this._last < 1000 / limit - 1) return;
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now; this.clock += dt;
    this._trackFps(dt);

    if (this.state === 'playing' || this.state === 'ending') {
      this.acc += dt * this.timeScale;
      let steps = 0;
      const maxSteps = PHYS.maxStepsPerFrame * Math.max(1, this.timeScale);
      while (this.acc >= PHYS.step && steps < maxSteps) { this._fixedStep(PHYS.step); this.acc -= PHYS.step; steps++; }
      if (steps === maxSteps) this.acc = 0;
      if (this.state === 'ending') { this.endTimer -= dt; if (this.endTimer <= 0) { const fn = this.endAction; this.endAction = null; fn?.(); } }
    }

    const t = this.clock;
    this.hand.updateVisual(t);
    for (const it of this.items) {
      if (it.banked) continue;
      it.sync();
      // подсветка «можно схватить» — только у предмета, который сейчас возьмёт рука (у горячего слитка свечением управляет ловушка)
      if (!it.glowOwner) it.setGlow(this.state === 'playing' && this.hand.grabItem === it ? 0.12 + 0.06 * Math.sin(t * 10) : 0, 0xffb040);
    }
    for (const tr of this.traps) tr.update(t);
    this.box.update(dt);
    for (const s of this.shards) s.update(dt);
    this.stage.update(dt, t, this.hand.pos, this.safePulse);
    this.stage.render();

    if (this.state === 'playing' || this.state === 'ending') {
      this.ui.update(dt, {
        time: this.time, timeLimit: this.level.timeLimit, touches: this.touches, damage: this.box.damage, maxHealth: this.box.maxHealth,
        camUses: this.stage.sideUses, meter: this.hud.meter, loot: this.lootNeed > 1 ? { done: this.lootDone, need: this.lootNeed } : null, alarm: this.alarmState, grabReady: this.hand.grabReady, holding: this.hand.holding,
        needLock: this.state === 'playing' && !this.autopilot && document.pointerLockElement !== this.stage.renderer.domElement,
      });
    }
  }

  // --- автопилот (проверка проходимости) ---------------------------------------
  /** Показать прохождение уровня автопилотом в реальном времени. */
  runAuto(id = this.level.id, timeScale = 1) {
    this.startLevelById(id);
    this.autopilot = autopilotFor(this); this.autoOn = true; this.timeScale = timeScale; this.result = null;
  }

  /** Синхронно прогнать уровень автопилотом без отрисовки. Возвращает итог. */
  /** id — номер уровня или описание уровня (объект). */
  autoTest(id, maxSeconds = 120) {
    if (typeof id === 'object') this.startLevelDef(id); else this.startLevelById(id);
    this.autopilot = autopilotFor(this); this.autoOn = true; this.result = null;
    while (this.state === 'playing' && this.time < maxSeconds) this._fixedStep(PHYS.step);
    const res = { level: this.level.id, result: this.result || 'timeout', time: +this.time.toFixed(2), touches: this.touches, damage: this.box.damage, stars: this.result === 'won' ? starsFor(this.level, this.time, this.touches) : 0 };
    this.autopilot = null; this.endTimer = 0;
    return res;
  }

  /** Средний FPS и автоматическое снижение разрешения, если кадры проседают. */
  _trackFps(dt) {
    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc < 1) return;
    this.fps = this._fpsFrames / this._fpsAcc; this._fpsAcc = 0; this._fpsFrames = 0;
    this.ui.setFps(this.settings.showFps ? this.fps : null);
    if (document.hidden) return;
    this._lowFpsTime = this.fps < 50 ? this._lowFpsTime + 1 : 0;
    if (limitedBelow50(this.settings.fpsLimit)) return;   // игрок сам ограничил кадры ниже порога — это не просадка
    if (this._lowFpsTime >= 3 && this.stage.pixelRatio > 0.5) { this.stage.setPixelRatio(Math.max(0.5, this.stage.pixelRatio - 0.25)); this._lowFpsTime = 0; }
  }
}

const game = new Game();
if (platform.dev) window.__gg = game;   // отладка, автопилот и автопроверки — только в режиме разработки (см. src/platform.js)
game.init().catch((err) => {
  console.error(err);
  document.getElementById('ui').innerHTML = `<div class="screen"><div class="card"><div class="h2">${t('error.start')}</div><div class="muted">${String(err.message || err)}</div></div></div>`;
});
