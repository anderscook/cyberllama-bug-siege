import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Mainframe } from '../entities/Mainframe';
import { Player } from '../entities/Player';
import { ProjectileSystem } from '../entities/Projectile';
import { ResourceOrb } from '../entities/ResourceOrb';
import { Tower } from '../entities/Tower';
import { CommonBug } from '../entities/enemies/CommonBug';
import type { Enemy } from '../entities/enemies/Enemy';
import { NullPointer } from '../entities/enemies/NullPointer';
import { SpaghettiBoss } from '../entities/enemies/SpaghettiBoss';
import { StackOverflow } from '../entities/enemies/StackOverflow';
import { AudioSystem } from '../systems/AudioSystem';
import type { BuildPad } from '../systems/BuildSystem';
import { BuildSystem } from '../systems/BuildSystem';
import { CameraRig, type CameraObstacle } from '../systems/CameraRig';
import { CollisionSystem } from '../systems/CollisionSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { EconomySystem } from '../systems/EconomySystem';
import { Hud } from '../systems/Hud';
import { ShakeRig } from '../systems/ShakeRig';
import { WaveManager, type SpawnRequest, type WavePhase } from '../systems/WaveManager';
import { WeaponSystem } from '../systems/WeaponSystem';
import { disposeObject3D } from '../utils/dispose';
import { cloneWithUniqueMaterials, loadModelTemplate, normalizeModelScale } from '../utils/modelCache';
import { createSeededRandom } from '../utils/random';
import {
  ARENA,
  PLAYER_ACCELERATION,
  PLAYER_DASH_COOLDOWN,
  PLAYER_DASH_DURATION,
  PLAYER_DASH_SPEED,
  PLAYER_GRAVITY,
  PLAYER_JUMP_SPEED,
  PLAYER_MOVE_SPEED,
  PLAYER_SPRINT_MULTIPLIER,
  REPAIR_BITS_PER_HP,
  REPAIR_RATE_PER_SECOND,
  TOWER_DEFS,
  type EnemyKind,
  type TowerKind,
} from './GameConfig';

function createEnemy(kind: EnemyKind, position: THREE.Vector3, rng: () => number): Enemy {
  switch (kind) {
    case 'common-bug':
      return new CommonBug(position, rng);
    case 'null-pointer':
      return new NullPointer(position, rng);
    case 'stack-overflow':
      return new StackOverflow(position, rng);
    case 'spaghetti-boss':
      return new SpaghettiBoss(position, rng);
  }
}

type PendingSpawn = { request: SpawnRequest; timer: number; ring: THREE.Mesh };

const telegraphGeometry = new THREE.RingGeometry(0.5, 0.65, 24);
telegraphGeometry.rotateX(-Math.PI / 2);
const telegraphMaterial = new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.8, side: THREE.DoubleSide });

const SPAWN_TELEGRAPH_SECONDS = 0.9;

// Generated via threejs-3d-generator (Tripo), static mesh.
const PERIMETER_MODEL_URL = '/models/server-pillar/033e8218-b20e-41b8-91c1-86730f5108ae-pbr-model.glb';
const PERIMETER_MODEL_BASE_HEIGHT = 2;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(64, 1, 0.1, 140);
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly mainframe = new Mainframe();
  private readonly buildSystem = new BuildSystem();
  private readonly economy = new EconomySystem();
  private readonly waveManager = new WaveManager();
  private readonly weaponSystem = new WeaponSystem();
  private readonly projectiles = new ProjectileSystem();
  private readonly collision = new CollisionSystem();
  private readonly cameraRig: CameraRig;
  private readonly shakeRig = new ShakeRig();
  private readonly hud = new Hud();
  private readonly audio = new AudioSystem();
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private readonly enemies: Enemy[] = [];
  private readonly towers: Tower[] = [];
  private readonly towerPads = new Map<Tower, BuildPad>();
  private readonly resourceOrbs: ResourceOrb[] = [];
  private readonly pendingSpawns: PendingSpawn[] = [];
  private readonly cameraObstacles: CameraObstacle[] = [];
  private readonly perimeterGroup = new THREE.Group();

  private readonly tuning: DebugTuning = {
    moveSpeed: PLAYER_MOVE_SPEED,
    sprintMultiplier: PLAYER_SPRINT_MULTIPLIER,
    acceleration: PLAYER_ACCELERATION,
    jumpSpeed: PLAYER_JUMP_SPEED,
    gravity: PLAYER_GRAVITY,
    dashSpeed: PLAYER_DASH_SPEED,
    dashDuration: PLAYER_DASH_DURATION,
    dashCooldown: PLAYER_DASH_COOLDOWN,
    cameraLag: 0.1,
    exposure: 1.25,
    maxDpr: 2,
  };

  private readonly debugTools: DebugTools;
  private frame = 0;
  private elapsed = 0;
  private kills = 0;
  private readonly totalEnemyCount = 120;
  private rng = createSeededRandom(1);
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private previousPhase: WavePhase = 'prep';
  private selectedTowerKind: TowerKind = 'gatling-cannon';
  private repairSoundTimer = 0;
  private alarmPlayed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.camera.position.set(0, 4, 8);

    this.input = new InputController(
      canvas,
      { stick: this.getElement('#touch-stick'), knob: this.getElement('#touch-knob') },
      { stick: this.getElement('#touch-look-stick'), knob: this.getElement('#touch-look-knob') },
      {
        fire: this.getElement('#fire-button'),
        jump: this.getElement('#jump-button'),
        dash: this.getElement('#dash-button'),
        build: this.getElement('#build-button'),
        repair: this.getElement('#repair-button'),
        towerGatling: this.getElement('#select-gatling-button'),
        towerRailgun: this.getElement('#select-railgun-button'),
      },
    );

    this.cameraRig = new CameraRig(this.camera);
    this.player.setWeapon('debug-blaster');

    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });

    this.createScene();
    this.hud.onRetry(() => this.resetRun());
    this.resetRun();
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    for (const enemy of this.enemies) enemy.dispose();
    for (const tower of this.towers) tower.dispose();
    for (const orb of this.resourceOrbs) orb.dispose();
    this.projectiles.dispose();
    this.player.dispose();
    this.mainframe.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    const roundOver = this.waveManager.phase === 'victory' || this.waveManager.phase === 'defeat';
    if (!roundOver) this.elapsed += delta;

    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    const animDelta = this.reducedMotion ? 0 : delta;
    const animElapsed = this.reducedMotion ? 0 : elapsed;

    this.cameraObstacles.length = 0;
    this.cameraObstacles.push(this.mainframe);
    for (const tower of this.towers) this.cameraObstacles.push(tower);

    this.player.update(animDelta, animElapsed, this.input, this.cameraRig, this.tuning, ARENA, this.cameraObstacles);

    if (this.waveManager.phase !== 'prep' && this.buildSystem.buildMode) this.buildSystem.setBuildMode(false);
    if (!roundOver && this.input.consumeBuildTogglePressed()) {
      if (this.waveManager.phase === 'prep') this.buildSystem.setBuildMode(!this.buildSystem.buildMode);
    }

    const fireJustPressed = this.input.consumeFirePressed();

    if (!roundOver && this.buildSystem.buildMode && fireJustPressed) {
      this.tryPlaceTower();
    }

    if (!roundOver && this.input.isRepairHeld()) {
      this.tryRepair(delta);
    } else {
      this.repairSoundTimer = 0;
    }

    const digit = this.input.consumeDigitPress();
    if (digit && this.buildSystem.buildMode) {
      this.selectedTowerKind = digit === '1' ? 'gatling-cannon' : 'railgun';
    } else if (digit) {
      this.weaponSystem.setWeapon(digit === '1' ? 'debug-blaster' : 'spit-protocol', this.player);
    }

    const canFire = !roundOver && !this.buildSystem.buildMode;
    const fireEvent = this.weaponSystem.update(delta, this.input, this.player, this.projectiles, canFire);
    if (fireEvent) {
      if (fireEvent.weapon === 'debug-blaster') this.audio.blasterShot(this.rng);
      else this.audio.spitShot(this.rng);
    }

    if (!roundOver) {
      this.updateEnemies(delta, elapsed);
      this.updateTowers(delta);
    }

    this.projectiles.update(delta);
    if (!roundOver) this.resolveCombat();

    for (const orb of this.resourceOrbs) orb.update(animDelta, animElapsed);
    const collected = this.collision.collectResourceOrbs(this.player.group.position, this.resourceOrbs, this.player.radius + 0.4);
    for (const orb of collected) {
      this.economy.add(orb.value);
      this.audio.resourcePickup(this.rng);
      this.hud.punchBits();
    }
    this.cullCollected(this.resourceOrbs, (orb) => !orb.active);

    if (!roundOver) {
      this.updateSpawning(delta);
    }

    this.mainframe.update(delta, elapsed);
    if (this.mainframe.destroyed && this.waveManager.phase !== 'defeat') {
      this.waveManager.declarePlayerDefeat();
      this.shakeRig.addTrauma(0.8);
    }
    const mainframeFraction = this.mainframe.hp / this.mainframe.maxHp;
    if (mainframeFraction < 0.25 && !this.alarmPlayed) {
      this.alarmPlayed = true;
      this.audio.mainframeAlarm();
    } else if (mainframeFraction >= 0.25) {
      this.alarmPlayed = false;
    }

    this.buildSystem.update(elapsed);

    if (this.waveManager.phase !== this.previousPhase) {
      this.onPhaseChanged(this.waveManager.phase);
    }
    this.previousPhase = this.waveManager.phase;

    this.cameraRig.update(delta, this.player.group.position, this.cameraObstacles, this.tuning.cameraLag);
    this.shakeRig.update(delta, this.camera);

    this.updateHud();
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private updateEnemies(delta: number, elapsed: number): void {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const target = this.collision.nearestAttackTarget(enemy.position, this.mainframe, this.towers);
      enemy.update({
        delta,
        elapsed,
        target,
        playerPosition: this.player.group.position,
        playerRadius: this.player.radius,
        damagePlayer: (amount) => this.damagePlayer(amount),
        rng: this.rng,
      });
    }
    this.processEnemyDeaths();
  }

  private updateTowers(delta: number): void {
    for (let i = this.towers.length - 1; i >= 0; i -= 1) {
      const tower = this.towers[i];
      if (tower.destroyed) {
        this.scene.remove(tower.group);
        const pad = this.towerPads.get(tower);
        if (pad) pad.occupied = false;
        this.towerPads.delete(tower);
        tower.dispose();
        this.towers.splice(i, 1);
        continue;
      }
      const fireRequest = tower.update(delta, this.enemies);
      if (fireRequest) {
        this.projectiles.spawn({
          position: fireRequest.position,
          direction: fireRequest.direction,
          speed: fireRequest.speed,
          damage: fireRequest.damage,
          radius: fireRequest.radius,
          lifespan: 1,
          owner: 'tower',
          color: fireRequest.color,
          pierce: fireRequest.pierce,
        });
        if (tower.kind === 'gatling-cannon') this.audio.gatlingFire(this.rng);
        else this.audio.railgunFire(this.rng);
      }
    }
  }

  private resolveCombat(): void {
    const playerShots = this.projectiles.activeByOwner('player');
    const towerShots = this.projectiles.activeByOwner('tower');
    const hits = this.collision.resolveProjectilesVsEnemies(playerShots, this.enemies);
    hits.push(...this.collision.resolveProjectilesVsEnemies(towerShots, this.enemies));
    for (const hit of hits) {
      if (!hit.projectile.pierce) this.projectiles.deactivate(hit.projectile);
      if (hit.killed) this.shakeRig.addTrauma(0.3);
      else this.audio.enemyHit(this.rng);
    }
    this.processEnemyDeaths();
  }

  private processEnemyDeaths(): void {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (!enemy.pendingDeath) continue;
      const death = enemy.pendingDeath;
      this.scene.remove(enemy.group);
      enemy.dispose();
      this.enemies.splice(i, 1);
      this.kills += 1;

      const orb = new ResourceOrb(death.resourceValue, death.position, this.rng() * 4);
      this.scene.add(orb.group);
      this.resourceOrbs.push(orb);
      this.audio.enemyDeath(this.rng);
      this.shakeRig.addTrauma(death.kind === 'spaghetti-boss' ? 0.9 : 0.25);

      if (death.spawnOnDeath) {
        for (let s = 0; s < death.spawnOnDeath.count; s += 1) {
          const angle = this.rng() * Math.PI * 2;
          const childPosition = death.position.clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(0.7));
          const child = createEnemy(death.spawnOnDeath.kind, childPosition, this.rng);
          child.hp = Math.max(1, Math.floor(child.maxHp * 0.5));
          this.scene.add(child.group);
          this.enemies.push(child);
        }
      }
    }
  }

  private updateSpawning(delta: number): void {
    for (let i = this.pendingSpawns.length - 1; i >= 0; i -= 1) {
      const pending = this.pendingSpawns[i];
      pending.timer -= delta;
      const t = THREE.MathUtils.clamp(1 - pending.timer / SPAWN_TELEGRAPH_SECONDS, 0, 1);
      pending.ring.scale.setScalar(0.3 + t * 1.4);
      (pending.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t) + 0.15;
      if (pending.timer <= 0) {
        this.scene.remove(pending.ring);
        const enemy = createEnemy(pending.request.kind, pending.request.position, this.rng);
        this.scene.add(enemy.group);
        this.enemies.push(enemy);
        this.pendingSpawns.splice(i, 1);
      }
    }

    const aliveEnemies = this.enemies.length + this.pendingSpawns.length;
    const requests = this.waveManager.update(delta, aliveEnemies, this.rng);
    for (const request of requests) {
      const ring = new THREE.Mesh(telegraphGeometry, telegraphMaterial.clone());
      ring.position.copy(request.position);
      ring.position.y = 0.03;
      ring.scale.setScalar(0.3);
      this.scene.add(ring);
      this.pendingSpawns.push({ request, timer: SPAWN_TELEGRAPH_SECONDS, ring });
    }
  }

  private tryPlaceTower(): void {
    const pad = this.buildSystem.findPlaceablePad(this.player.group.position);
    if (!pad) return;
    if (!this.economy.spend(TOWER_DEFS[this.selectedTowerKind].cost)) return;
    pad.occupied = true;
    const tower = new Tower(pad.position, this.selectedTowerKind);
    this.scene.add(tower.group);
    this.towers.push(tower);
    this.towerPads.set(tower, pad);
    this.audio.buildPlace();
  }

  private tryRepair(delta: number): void {
    const target = this.buildSystem.findRepairTarget(this.player.group.position, this.mainframe, this.towers);
    if (!target) {
      this.repairSoundTimer = 0;
      return;
    }
    const desired = REPAIR_RATE_PER_SECOND * delta;
    const cost = desired * REPAIR_BITS_PER_HP;
    if (!this.economy.canAfford(cost)) return;
    const restored = target.repair(desired);
    if (restored <= 0) return;
    this.economy.spend(restored * REPAIR_BITS_PER_HP);
    this.repairSoundTimer -= delta;
    if (this.repairSoundTimer <= 0) {
      this.audio.repairHum();
      this.repairSoundTimer = 0.25;
    }
  }

  private damagePlayer(amount: number): void {
    if (this.player.invulnerable) return;
    this.player.takeDamage(amount);
    this.hud.flashDamage();
    this.shakeRig.addTrauma(0.35);
    this.audio.playerHit(this.rng);
  }

  private onPhaseChanged(phase: WavePhase): void {
    if (phase === 'combat') {
      this.audio.waveStart();
      if (this.waveManager.isBossWave) this.audio.bossRoar();
    } else if (phase === 'victory') {
      this.hud.showEndScreen('victory', `Mainframe held through ${this.waveManager.totalWaves} waves. Bugs squashed: ${this.kills}.`);
    } else if (phase === 'defeat') {
      this.hud.showEndScreen('defeat', `The Mainframe fell on wave ${this.waveManager.waveNumber}. Bugs squashed: ${this.kills}.`);
    }
  }

  private cullCollected<T extends { active: boolean }>(list: T[], predicate: (item: T) => boolean): void {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (predicate(list[i])) list.splice(i, 1);
    }
  }

  private updateHud(): void {
    const boss = this.enemies.find((enemy) => enemy.kind === 'spaghetti-boss');
    let prompt: string | null = null;
    if (this.buildSystem.buildMode) {
      const selected = TOWER_DEFS[this.selectedTowerKind];
      const pad = this.buildSystem.findPlaceablePad(this.player.group.position);
      prompt = pad
        ? `${selected.name} selected — Fire to build (${selected.cost} bits)`
        : `${selected.name} selected — move to an empty glowing pad`;
    } else if (this.waveManager.phase === 'prep') {
      prompt = `Prep Phase — next wave in ${Math.ceil(this.waveManager.prepRemaining)}s`;
    }

    this.hud.update({
      mainframeHp: this.mainframe.hp,
      mainframeMaxHp: this.mainframe.maxHp,
      playerHp: this.player.hp,
      playerMaxHp: this.player.maxHp,
      bits: this.economy.bits,
      waveNumber: Math.min(this.waveManager.waveNumber, this.waveManager.totalWaves),
      totalWaves: this.waveManager.totalWaves,
      phase: this.waveManager.phase,
      prepRemaining: this.waveManager.prepRemaining,
      weaponName: this.weaponSystem.weaponName(),
      cooldownFraction: this.weaponSystem.cooldownFraction(),
      buildMode: this.buildSystem.buildMode,
      selectedTowerKind: this.selectedTowerKind,
      bossHp: boss ? boss.hp : null,
      bossMaxHp: boss ? boss.maxHp : null,
      prompt,
    });
  }

  private createScene(): void {
    this.scene.background = new THREE.Color('#0a0f16');
    this.scene.fog = new THREE.Fog('#0a0f16', 30, 74);

    const hemisphere = new THREE.HemisphereLight('#8fd6ff', '#241733', 1.75);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight('#dff2ff', 2.5);
    sun.position.set(-10, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // mobile GPU memory headroom; 2048 was overkill for this scene's visible shadow detail
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -32;
    sun.shadow.camera.right = 32;
    sun.shadow.camera.top = 32;
    sun.shadow.camera.bottom = -32;
    this.scene.add(sun);

    const rim = new THREE.PointLight('#ff4de0', 2.2, 44, 2);
    rim.position.set(16, 6, -16);
    this.scene.add(rim);

    this.scene.add(this.createGround());
    this.scene.add(this.createPerimeter());
    this.loadPerimeterModels();
    this.scene.add(this.mainframe.group);
    this.scene.add(this.buildSystem.group);
    this.scene.add(this.player.group);
    this.scene.add(this.projectiles.group);
  }

  private createGround(): THREE.Mesh {
    const { map, emissiveMap } = this.createFloorTextures();
    const repeat = ARENA.halfWidth / 3;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeat, repeat);
    emissiveMap.repeat.set(repeat, repeat);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA.halfWidth * 2, ARENA.halfDepth * 2, 1, 1),
      new THREE.MeshStandardMaterial({
        map,
        emissiveMap,
        emissive: '#59e8ff',
        emissiveIntensity: 1.1,
        roughness: 0.75,
        metalness: 0.25,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    return floor;
  }

  private createPerimeter(): THREE.Group {
    const towerGeometry = new THREE.BoxGeometry(1.4, 1, 1.4);
    const material = new THREE.MeshStandardMaterial({ color: '#1c2430', roughness: 0.6, metalness: 0.4, emissive: '#2de0c0', emissiveIntensity: 0.18 });
    const count = 18;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const radius = ARENA.halfWidth * 0.98;
      const height = 2 + ((i * 37) % 5);
      const mesh = new THREE.Mesh(towerGeometry, material);
      mesh.scale.set(1, height, 1);
      mesh.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.perimeterGroup.add(mesh);
    }
    return this.perimeterGroup;
  }

  /** Swaps the fallback perimeter boxes for the generated server-pillar model once it loads. */
  private loadPerimeterModels(): void {
    const count = 18;
    loadModelTemplate(PERIMETER_MODEL_URL)
      .then((template) => {
        const fallbackMeshes = [...this.perimeterGroup.children];
        for (let i = 0; i < count; i += 1) {
          const angle = (i / count) * Math.PI * 2;
          const radius = ARENA.halfWidth * 0.98;
          const height = PERIMETER_MODEL_BASE_HEIGHT + ((i * 37) % 5) * 0.6;
          const instance = cloneWithUniqueMaterials(template);
          normalizeModelScale(instance, height);
          instance.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
          instance.rotation.y = angle;
          this.perimeterGroup.add(instance);
        }
        for (const mesh of fallbackMeshes) {
          this.perimeterGroup.remove(mesh);
          disposeObject3D(mesh);
        }
      })
      .catch(() => {
        // Stay on the procedural fallback boxes.
      });
  }

  /** Sci-fi tech-panel floor: beveled panels with shade variation, corner bolts, occasional hazard
   *  stripes, and glowing circuit seams on a separate emissive map so they read even in dim lighting. */
  private createFloorTextures(): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
    const size = 512;
    const panelSize = 128;
    const panelsPerSide = size / panelSize;
    const rng = createSeededRandom(1337);

    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = size;
    colorCanvas.height = size;
    const ctx = colorCanvas.getContext('2d');
    const emissiveCanvas = document.createElement('canvas');
    emissiveCanvas.width = size;
    emissiveCanvas.height = size;
    const ectx = emissiveCanvas.getContext('2d');
    if (!ctx || !ectx) throw new Error('Could not create floor texture context.');

    ctx.fillStyle = '#0d1016';
    ctx.fillRect(0, 0, size, size);
    ectx.fillStyle = '#000000';
    ectx.fillRect(0, 0, size, size);

    for (let py = 0; py < panelsPerSide; py += 1) {
      for (let px = 0; px < panelsPerSide; px += 1) {
        const x = px * panelSize;
        const y = py * panelSize;
        const shade = 30 + Math.floor(rng() * 16);
        const hazard = rng() < 0.07;

        ctx.fillStyle = hazard ? `rgb(${shade + 10},${shade + 4},${Math.max(0, shade - 8)})` : `rgb(${shade},${shade + 5},${shade + 11})`;
        ctx.fillRect(x + 2, y + 2, panelSize - 4, panelSize - 4);

        if (hazard) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 4, y + 4, panelSize - 8, panelSize - 8);
          ctx.clip();
          ctx.strokeStyle = 'rgba(245, 186, 73, 0.55)';
          ctx.lineWidth = 7;
          for (let s = -panelSize; s < panelSize * 2; s += 18) {
            ctx.beginPath();
            ctx.moveTo(x + s, y);
            ctx.lineTo(x + s + panelSize, y + panelSize);
            ctx.stroke();
          }
          ctx.restore();
        }

        ctx.strokeStyle = 'rgba(4, 6, 9, 0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1, y + 1, panelSize - 2, panelSize - 2);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        const inset = 9;
        for (const [bx, by] of [
          [x + inset, y + inset],
          [x + panelSize - inset, y + inset],
          [x + inset, y + panelSize - inset],
          [x + panelSize - inset, y + panelSize - inset],
        ]) {
          ctx.beginPath();
          ctx.arc(bx, by, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }

        if (rng() < 0.4) {
          const edge = Math.floor(rng() * 4);
          const margin = 7;
          ectx.strokeStyle = `rgba(89, 232, 255, ${0.5 + rng() * 0.5})`;
          ectx.lineWidth = 2;
          ectx.beginPath();
          if (edge === 0) {
            ectx.moveTo(x + margin, y + margin);
            ectx.lineTo(x + panelSize - margin, y + margin);
          } else if (edge === 1) {
            ectx.moveTo(x + panelSize - margin, y + margin);
            ectx.lineTo(x + panelSize - margin, y + panelSize - margin);
          } else if (edge === 2) {
            ectx.moveTo(x + margin, y + panelSize - margin);
            ectx.lineTo(x + panelSize - margin, y + panelSize - margin);
          } else {
            ectx.moveTo(x + margin, y + margin);
            ectx.lineTo(x + margin, y + panelSize - margin);
          }
          ectx.stroke();
        }
      }
    }

    const map = new THREE.CanvasTexture(colorCanvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
    return { map, emissiveMap };
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        if (name !== 'active-play' && name !== 'complete') throw new Error(`Unknown test state: ${name}`);
        this.resetRun();
        if (name === 'complete') this.forceVictoryForScreenshot();
        this.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        if (enabled) this.player.stabilizeVisuals();
        this.render();
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugTools.setHidden(hidden);
      },
    };
  }

  private forceVictoryForScreenshot(): void {
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.group);
      enemy.dispose();
    }
    this.enemies.length = 0;
    this.waveManager.forceFinalWave();
    this.waveManager.phase = 'victory';
    this.previousPhase = 'victory';
    this.hud.showEndScreen('victory', `Mainframe held through ${this.waveManager.totalWaves} waves. Bugs squashed: ${this.kills}.`);
    this.updateHud();
  }

  private resetRun(): void {
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.group);
      enemy.dispose();
    }
    this.enemies.length = 0;

    for (const tower of this.towers) {
      this.scene.remove(tower.group);
      tower.dispose();
    }
    this.towers.length = 0;
    this.towerPads.clear();

    for (const orb of this.resourceOrbs) this.scene.remove(orb.group);
    this.resourceOrbs.length = 0;

    for (const pending of this.pendingSpawns) this.scene.remove(pending.ring);
    this.pendingSpawns.length = 0;

    this.projectiles.reset();
    this.buildSystem.reset();
    this.economy.reset();
    this.waveManager.reset();
    this.weaponSystem.reset();
    this.mainframe.hp = this.mainframe.maxHp;
    this.mainframe.destroyed = false;
    this.player.reset();
    this.player.setWeapon('debug-blaster');
    this.selectedTowerKind = 'gatling-cannon';

    this.kills = 0;
    this.elapsed = 0;
    this.previousPhase = 'prep';
    this.alarmPlayed = false;

    this.cameraObstacles.length = 0;
    this.cameraObstacles.push(this.mainframe);
    this.cameraRig.snapTo(this.player.group.position, this.cameraObstacles);
    this.hud.hideEndScreen();
    this.updateHud();
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.kills,
      targetScore: this.totalEnemyCount,
      complete: this.waveManager.phase === 'victory',
      wave: this.waveManager.waveNumber,
      totalWaves: this.waveManager.totalWaves,
      phase: this.waveManager.phase,
      mainframeHp: this.mainframe.hp,
      bits: this.economy.bits,
      player: {
        position: {
          x: this.player.group.position.x,
          y: this.player.group.position.y,
          z: this.player.group.position.z,
        },
        speed: this.player.velocity.length(),
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
