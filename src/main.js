// Golden Grab — инициализация и игровой цикл.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYS, HAND, GLASS, WORLD } from './config.js';
import { LEVELS, starsFor } from './levels.js';
import { createMaterials } from './textures.js';
import { loadModels } from './assets.js';
import { Stage } from './scene.js';
import { GlassBox, GROUP } from './box.js';
import { Loot } from './loot.js';
import { levelLoot, lootNeeded } from './loot-types.js';
import { nextAfter, placeOf, levelById, totalStars } from './heists.js';
import { cosmeticById, unlockedCosmetics } from './cosmetics.js';
import { T } from './strings.js';
import { spawnShards } from './shards.js';
import { Hand } from './hand.js';
import { Pedestal, createTraps } from './traps.js';
import { AudioSys } from './audio.js';
import { UI, loadSave, storeSave } from './ui.js';
import { autopilotFor } from './autoplay.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

class Game {
  constructor() {
    this.state = 'loading';     // loading | menu | playing | paused | ending | won | lost
    this.levelIndex = 0;
    this.acc = 0; this.clock = 0; this.timeScale = 1;
    this.keys = new Set(); this.rmb = false; this.hadLock = false;
    this.autopilot = null;
    this.hud = { meter: null };
    this.fps = 60; this._fpsAcc = 0; this._fpsFrames = 0; this._lowFpsTime = 0;
    this.save = loadSave();
    this.audio = new AudioSys();
    this.audio.volume = this.save.volume;
  }

  async init() {
    this.ui = new UI(document.getElementById('ui'), {
      click: () => { this.audio.init(); this.audio.uiClick(); },
      playId: (id) => this.startLevelById(id),
      resume: () => this.resume(),
      restart: () => this.startLevel(this.levelIndex),
      next: () => { const n = nextAfter(this.level.id, this.save); if (n && !n.locked) this.startLevelById(n.level.id); else this.toMenu(); },
      menu: () => this.toMenu(),
      skin: (id) => this.hand.setSkin(cosmeticById(id)),
      accessory: (id) => this.hand.setAccessory(id ? cosmeticById(id) : null, this.models),
      volume: (v) => this.audio.setVolume(v),
    }, this.save);
    this.ui.show('loading');

    const [{ models, missing }, mats] = await Promise.all([loadModels((p) => this.ui.setLoading(p * 0.7)), createMaterials()]);
    this.models = models; this.M = mats.M;
    this.assetReport = { missingModels: missing, fallbackTextures: mats.fallbacks };
    if (missing.length || mats.fallbacks.length) console.info('[Golden Grab] запасные ассеты:', this.assetReport);
    this.ui.setLoading(0.9);

    this.stage = new Stage(document.getElementById('c'), this.M, models);
    this._initPhysics();
    this.hand = new Hand({ scene: this.stage.scene, world: this.world, M: this.M, glbScene: models.hand });
    this.hand.setSkin(cosmeticById(this.save.skin));
    if (this.save.accessory) this.hand.setAccessory(cosmeticById(this.save.accessory), models);
    this._bindInput();

    this._loadLevel(LEVELS[0]);
    this.state = 'menu';
    this.ui.setLoading(1);
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
    this.levelIndex = LEVELS.indexOf(level);
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

  /** Запустить уровень по его описанию. */
  startLevelDef(level) {
    this.audio.init();
    this.autopilot = null; this.result = null;   // автопилот прошлого уровня не должен рулить новым
    this._loadLevel(level);
    this.state = 'playing';
    const place = placeOf(level.id);
    this.stage.setTheme(place?.heist.theme);
    this.ui.hideScreens(); this.ui.showHud(true); this.ui.startLevel(this.level, place);
    this._requestLock();
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
  alarm(seconds, text, hideCount = false, failReason = T.alarmFail) {
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
        this.fail('Стекло разбито');
      }
    }
  }

  /** Удар по хрупкой добыче: трещина или вдребезги. */
  _fragileHit(item, speed) {
    const r = item.hit(speed, this.time, this.M.cracks[1]);
    if (r === 'crack') { this.audio.glassCrack(); this.toast(T.cracked(item.type.name)); }
    else if (r === 'break') {
      if (this.hand.item === item) this.hand.release('open');
      this.audio.glassBreak();
      this.shards.push(spawnShards(this.stage.scene, item.position(), item.type.bounds, item.material.color));
      this.fail(item.type.failBreak);
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
      if (this.rmb) this.hand.rotate(-dy * HAND.rotSens, -dx * HAND.rotSens);
      else this.hand.moveTarget(dx * HAND.mouseSens, -dy * HAND.mouseSens, 0);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.state === 'playing') this.hand.moveTarget(0, 0, Math.sign(e.deltaY) * HAND.wheelStep);
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
      if (e.code === 'KeyR') this.startLevel(this.levelIndex);
      if (e.code === 'KeyC' && !this.stage.toggleSide()) this.toast('Вид сбоку закончился');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.rmb = false; this.hand.setGrip(false); });
  }

  _applyKeys(dt) {
    const k = this.keys;
    if (k.has('KeyW')) this.hand.moveTarget(0, 0, -HAND.keySpeed * dt);
    if (k.has('KeyS')) this.hand.moveTarget(0, 0, HAND.keySpeed * dt);
    if (k.has('KeyQ')) this.hand.rotate(0, 0, HAND.yawSpeed * dt);
    if (k.has('KeyE')) this.hand.rotate(0, 0, -HAND.yawSpeed * dt);
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
      else if (ev.type === 'release' && ev.reason === 'slip') this.toast(T.slipped);
    }
    this.hand.events.length = 0;
    if (!playing) return;

    const ctx = { game: this, hand: this.hand, items: this.items, audio: this.audio, time: this.time };
    for (const t of this.traps) t.step(dt, ctx);
    // полоска «хват» для скользкой добычи: насколько скорость кисти близка к той, на которой предмет выскользнет
    if (!this.hud.meter && this.hand.item?.type.slipSpeed) this.hud.meter = { label: T.gripMeter, value: this.hand.vel.length() / this.hand.slipSpeed };

    if (this.alarmState) {
      this.alarmState.left -= dt;
      if (this.alarmState.left <= 0) return this.fail(this.alarmState.failReason);
    }
    if (this.level.timeLimit && this.time > this.level.timeLimit) return this.fail('Время вышло');

    // добыча: предмет полежал в «сейфе» без руки — засчитан; вся нужная добыча в сейфе — победа
    const s = this.level.safe;
    this.safePulse = 0;
    for (const it of this.items) {
      if (it.banked) continue;
      const p = it.body.position;
      if (p.y < WORLD.tableY - 0.2) {
        if (it.role === 'target') return this.fail(it.type.failFall);
        it.bank(); this.toast(T.propLost);
        continue;
      }
      if (it.role !== 'target') continue;
      const d = Math.hypot(p.x - s.pos[0], p.z - s.pos[1]), inZone = d < s.radius - 0.02 && p.y < WORLD.tableY + 0.14 && p.y > WORLD.tableY;
      if (inZone) this.safePulse = 1;
      if (inZone && this.hand.item !== it && it.speed() < 0.08) {
        it.zoneTime += dt;
        if (it.zoneTime > 0.35) {
          this.lootDone++;
          if (this.lootDone >= this.lootNeed) return this.win();
          it.bank(); this.stage.flashSafe(); this.audio.bank();
          this.toast(T.itemBanked(this.lootDone, this.lootNeed));
        }
      } else it.zoneTime = 0;
    }
  }

  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
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
    this.autopilot = autopilotFor(this); this.timeScale = timeScale; this.result = null;
  }

  /** Синхронно прогнать уровень автопилотом без отрисовки. Возвращает итог. */
  /** id — номер уровня или описание уровня (объект). */
  autoTest(id, maxSeconds = 120) {
    if (typeof id === 'object') this.startLevelDef(id); else this.startLevelById(id);
    this.autopilot = autopilotFor(this); this.result = null;
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
    if (document.hidden) return;
    this._lowFpsTime = this.fps < 50 ? this._lowFpsTime + 1 : 0;
    if (this._lowFpsTime >= 3 && this.stage.pixelRatio > 0.75) { this.stage.setPixelRatio(Math.max(0.75, this.stage.pixelRatio - 0.25)); this._lowFpsTime = 0; }
  }
}

const game = new Game();
window.__gg = game; // для отладки и автотестов
game.init().catch((err) => {
  console.error(err);
  document.getElementById('ui').innerHTML = `<div class="screen"><div class="card"><div class="h2">Не удалось запустить игру</div><div class="muted">${String(err.message || err)}</div></div></div>`;
});
