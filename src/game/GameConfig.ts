import * as THREE from 'three';

export type ArenaBounds = {
  halfWidth: number;
  halfDepth: number;
};

export const ARENA: ArenaBounds = {
  halfWidth: 30,
  halfDepth: 30,
};

export const MAINFRAME_POSITION = new THREE.Vector3(0, 0, 0);
export const MAINFRAME_RADIUS = 3.1;
export const MAINFRAME_MAX_HP = 1000;

export const PLAYER_MAX_HP = 100;
export const PLAYER_RADIUS = 0.42;

export const SPAWN_RADIUS = 27;
export const SPAWN_TELEGRAPH_SECONDS = 0.9;

export const PREP_PHASE_SECONDS = 18;
export const FIRST_PREP_PHASE_SECONDS = 12;

export const STARTING_BITS = 70;
export const REPAIR_BITS_PER_HP = 0.5;
export const REPAIR_RATE_PER_SECOND = 40; // HP/sec restored while holding repair
export const BUILD_INTERACT_RANGE = 3.4;
export const REPAIR_INTERACT_RANGE = 3.6;

export type BuildPadDef = { angle: number; distance: number };

// Fixed build pads around the Mainframe. Varying distance/angle creates real
// placement decisions (close pads intercept early but are easier for enemies
// to swarm; far pads cover open approach lanes with more warning time).
export const BUILD_PADS: BuildPadDef[] = [
  { angle: 0, distance: 6.2 },
  { angle: Math.PI / 4, distance: 8.4 },
  { angle: Math.PI / 2, distance: 6.2 },
  { angle: (3 * Math.PI) / 4, distance: 8.4 },
  { angle: Math.PI, distance: 6.2 },
  { angle: (5 * Math.PI) / 4, distance: 8.4 },
  { angle: (3 * Math.PI) / 2, distance: 6.2 },
  { angle: (7 * Math.PI) / 4, distance: 8.4 },
];

export const TOWER_RADIUS = 0.75;

export type TowerKind = 'gatling-cannon' | 'railgun';

export const TOWER_DEFS: Record<TowerKind, {
  name: string;
  cost: number;
  maxHp: number;
  range: number;
  fireInterval: number;
  damage: number;
  projectileSpeed: number;
  projectileRadius: number;
  /** Railgun shots punch through every enemy along their path instead of stopping at the first hit. */
  pierce: boolean;
  tracerColor: string;
}> = {
  'gatling-cannon': {
    name: 'Gatling Cannon',
    cost: 45,
    maxHp: 170,
    range: 10,
    fireInterval: 0.1,
    damage: 4,
    projectileSpeed: 44,
    projectileRadius: 0.07,
    pierce: false,
    tracerColor: '#ffd98a',
  },
  railgun: {
    name: 'Railgun',
    cost: 80,
    maxHp: 200,
    range: 16,
    fireInterval: 1.8,
    damage: 50,
    projectileSpeed: 72,
    projectileRadius: 0.1,
    pierce: true,
    tracerColor: '#bfe8ff',
  },
};

export type WeaponId = 'debug-blaster' | 'spit-protocol';

export const WEAPONS: Record<WeaponId, {
  name: string;
  cooldown: number;
  projectileSpeed: number;
  damage: number;
  radius: number;
  lifespan: number;
  color: string;
  slowFactor?: number;
  slowDuration?: number;
  dotDamagePerSecond?: number;
  dotDuration?: number;
  gravity?: number;
}> = {
  'debug-blaster': {
    name: 'Debug Blaster',
    cooldown: 0.125,
    projectileSpeed: 46,
    damage: 9,
    radius: 0.1,
    lifespan: 1.3,
    color: '#59e8ff',
  },
  'spit-protocol': {
    name: 'Spit Protocol',
    cooldown: 0.45,
    projectileSpeed: 26,
    damage: 5,
    radius: 0.22,
    lifespan: 1.6,
    color: '#8fff4d',
    slowFactor: 0.5,
    slowDuration: 2.5,
    dotDamagePerSecond: 4,
    dotDuration: 3,
    gravity: 6,
  },
};

export type EnemyKind = 'common-bug' | 'null-pointer' | 'stack-overflow' | 'spaghetti-boss';

export const ENEMY_STATS: Record<EnemyKind, {
  maxHp: number;
  speed: number;
  radius: number;
  contactDamagePerSecond: number;
  playerContactDamagePerSecond: number;
  resourceValue: number;
}> = {
  'common-bug': {
    maxHp: 18,
    speed: 3.2,
    radius: 0.35,
    contactDamagePerSecond: 14,
    playerContactDamagePerSecond: 6,
    resourceValue: 4,
  },
  'null-pointer': {
    maxHp: 26,
    speed: 2.6,
    radius: 0.4,
    contactDamagePerSecond: 16,
    playerContactDamagePerSecond: 9,
    resourceValue: 6,
  },
  'stack-overflow': {
    maxHp: 150,
    speed: 1.4,
    radius: 0.85,
    contactDamagePerSecond: 30,
    playerContactDamagePerSecond: 14,
    resourceValue: 18,
  },
  'spaghetti-boss': {
    maxHp: 2600,
    speed: 1.05,
    radius: 1.9,
    contactDamagePerSecond: 55,
    playerContactDamagePerSecond: 22,
    resourceValue: 150,
  },
};

export type WaveSpec = {
  commonBugs: number;
  nullPointers: number;
  stackOverflows: number;
  spawnIntervalSeconds: number;
  boss?: boolean;
};

export const WAVES: WaveSpec[] = [
  { commonBugs: 6, nullPointers: 0, stackOverflows: 0, spawnIntervalSeconds: 0.9 },
  { commonBugs: 10, nullPointers: 2, stackOverflows: 0, spawnIntervalSeconds: 0.8 },
  { commonBugs: 12, nullPointers: 4, stackOverflows: 1, spawnIntervalSeconds: 0.75 },
  { commonBugs: 14, nullPointers: 6, stackOverflows: 2, spawnIntervalSeconds: 0.68 },
  { commonBugs: 16, nullPointers: 8, stackOverflows: 3, spawnIntervalSeconds: 0.6 },
  { commonBugs: 10, nullPointers: 4, stackOverflows: 0, spawnIntervalSeconds: 0.6, boss: true },
];

export const PLAYER_MOVE_SPEED = 6.4;
export const PLAYER_SPRINT_MULTIPLIER = 1.5;
export const PLAYER_ACCELERATION = 16;
export const PLAYER_JUMP_SPEED = 7.2;
export const PLAYER_GRAVITY = 20;
export const PLAYER_DASH_SPEED = 16;
export const PLAYER_DASH_DURATION = 0.18;
export const PLAYER_DASH_COOLDOWN = 1.1;
export const PLAYER_HIT_COOLDOWN = 0.4;
export const PLAYER_RESPAWN_INVULN = 1.6;
