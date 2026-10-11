import * as THREE from 'three';
import { FIRST_PREP_PHASE_SECONDS, MAINFRAME_POSITION, PREP_PHASE_SECONDS, SPAWN_RADIUS, WAVES, type EnemyKind, type WaveSpec } from '../game/GameConfig';

export type WavePhase = 'prep' | 'combat' | 'victory' | 'defeat';

export type SpawnRequest = { kind: EnemyKind; position: THREE.Vector3 };

/** Bresenham-style interleave so a wave's enemy mix feels combined throughout, not grouped in blocks. */
function interleave(spec: WaveSpec): EnemyKind[] {
  const allCounts: [EnemyKind, number][] = [
    ['common-bug', spec.commonBugs],
    ['null-pointer', spec.nullPointers],
    ['stack-overflow', spec.stackOverflows],
  ];
  const counts = allCounts.filter(([, n]) => n > 0);
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  const progress = new Map<EnemyKind, number>(counts.map(([k]) => [k, 0]));
  const result: EnemyKind[] = [];

  for (let i = 0; i < total; i += 1) {
    let bestKind: EnemyKind = counts[0][0];
    let bestRatio = Infinity;
    for (const [kind, count] of counts) {
      const ratio = (progress.get(kind) ?? 0) / count;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestKind = kind;
      }
    }
    result.push(bestKind);
    progress.set(bestKind, (progress.get(bestKind) ?? 0) + 1);
  }

  if (spec.boss) result.push('spaghetti-boss');
  return result;
}

export class WaveManager {
  phase: WavePhase = 'prep';
  waveIndex = 0;
  prepRemaining = FIRST_PREP_PHASE_SECONDS;

  private spawnQueue: EnemyKind[] = [];
  private spawnTimer = 0;
  private spawnInterval = 0.8;

  get totalWaves(): number {
    return WAVES.length;
  }

  get waveNumber(): number {
    return this.waveIndex + 1;
  }

  get isBossWave(): boolean {
    return WAVES[this.waveIndex]?.boss ?? false;
  }

  /** Call every frame; returns enemy spawn requests for this tick. */
  update(delta: number, aliveEnemies: number, rng: () => number): SpawnRequest[] {
    const requests: SpawnRequest[] = [];

    if (this.phase === 'prep') {
      this.prepRemaining -= delta;
      if (this.prepRemaining <= 0) this.startWave();
    } else if (this.phase === 'combat') {
      if (this.spawnQueue.length > 0) {
        this.spawnTimer -= delta;
        if (this.spawnTimer <= 0) {
          const kind = this.spawnQueue.shift();
          if (kind) {
            requests.push({ kind, position: this.randomSpawnPosition(rng) });
            this.spawnTimer = this.spawnInterval;
          }
        }
      } else if (aliveEnemies === 0) {
        if (this.waveIndex >= WAVES.length - 1) {
          this.phase = 'victory';
        } else {
          this.waveIndex += 1;
          this.phase = 'prep';
          this.prepRemaining = PREP_PHASE_SECONDS;
        }
      }
    }

    return requests;
  }

  declarePlayerDefeat(): void {
    this.phase = 'defeat';
  }

  reset(): void {
    this.phase = 'prep';
    this.waveIndex = 0;
    this.prepRemaining = FIRST_PREP_PHASE_SECONDS;
    this.spawnQueue = [];
    this.spawnTimer = 0;
  }

  /** Test/debug hook: jump straight to the final wave for screenshot/bot determinism. */
  forceFinalWave(): void {
    this.waveIndex = WAVES.length - 1;
    this.phase = 'combat';
    this.spawnQueue = [];
    this.spawnTimer = 0;
  }

  private startWave(): void {
    this.phase = 'combat';
    const spec = WAVES[this.waveIndex];
    this.spawnInterval = spec.spawnIntervalSeconds;
    this.spawnTimer = 0;
    this.spawnQueue = interleave(spec);
  }

  private randomSpawnPosition(rng: () => number): THREE.Vector3 {
    const angle = rng() * Math.PI * 2;
    return new THREE.Vector3(
      MAINFRAME_POSITION.x + Math.cos(angle) * SPAWN_RADIUS,
      0,
      MAINFRAME_POSITION.z + Math.sin(angle) * SPAWN_RADIUS,
    );
  }
}
