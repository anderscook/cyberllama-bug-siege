import * as THREE from 'three';
import type { Damageable } from '../../game/Damageable';
import type { EnemyKind } from '../../game/GameConfig';

/** Nearest defensive structure (Mainframe or a Tower) for this enemy to path toward and attack. */
export type AttackTarget = {
  position: THREE.Vector3;
  radius: number;
  takeDamage: (amount: number) => void;
};

export type EnemyUpdateContext = {
  delta: number;
  elapsed: number;
  target: AttackTarget;
  playerPosition: THREE.Vector3;
  playerRadius: number;
  damagePlayer: (amount: number) => void;
  rng: () => number;
};

/** Returned by update() so Game/WaveManager can react without Enemy owning spawn logic. */
export type EnemyDeathEvent = {
  kind: EnemyKind;
  position: THREE.Vector3;
  resourceValue: number;
  spawnOnDeath?: { kind: EnemyKind; count: number };
};

export abstract class Enemy implements Damageable {
  readonly group = new THREE.Group();
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  hp: number;
  dead = false;
  pendingDeath: EnemyDeathEvent | null = null;

  protected slowTimer = 0;
  protected slowFactor = 1;
  protected dotTimer = 0;
  protected dotDamagePerSecond = 0;
  protected hitFlashTimer = 0;

  constructor(
    readonly kind: EnemyKind,
    readonly maxHp: number,
    readonly baseSpeed: number,
    readonly radius: number,
    readonly contactDamagePerSecond: number,
    readonly playerContactDamagePerSecond: number,
    readonly resourceValue: number,
    position: THREE.Vector3,
  ) {
    this.hp = maxHp;
    this.position = this.group.position;
    this.group.position.copy(position);
  }

  isAlive(): boolean {
    return !this.dead;
  }

  get currentSpeed(): number {
    return this.baseSpeed * this.slowFactor;
  }

  takeDamage(amount: number): void {
    if (this.dead) return;
    this.hp -= amount;
    this.hitFlashTimer = 0.14;
    this.onHitFlash(true);
    if (this.hp <= 0) {
      this.dead = true;
      this.pendingDeath = {
        kind: this.kind,
        position: this.position.clone(),
        resourceValue: this.resourceValue,
        spawnOnDeath: this.spawnOnDeath(),
      };
    }
  }

  applySlow(factor: number, duration: number): void {
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  applyDot(damagePerSecond: number, duration: number): void {
    this.dotDamagePerSecond = Math.max(this.dotDamagePerSecond, damagePerSecond);
    this.dotTimer = Math.max(this.dotTimer, duration);
  }

  update(ctx: EnemyUpdateContext): void {
    if (this.dead) return;

    if (this.dotTimer > 0) {
      this.dotTimer -= ctx.delta;
      this.hp -= this.dotDamagePerSecond * ctx.delta;
      if (this.hp <= 0 && !this.dead) {
        this.dead = true;
        this.pendingDeath = {
          kind: this.kind,
          position: this.position.clone(),
          resourceValue: this.resourceValue,
          spawnOnDeath: this.spawnOnDeath(),
        };
        return;
      }
    } else {
      this.dotDamagePerSecond = 0;
    }

    if (this.slowTimer > 0) {
      this.slowTimer -= ctx.delta;
    } else {
      this.slowFactor = 1;
    }

    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= ctx.delta;
      if (this.hitFlashTimer <= 0) this.onHitFlash(false);
    }

    this.updateAI(ctx);
  }

  /** Movement, attacks, and visual animation for this enemy kind. */
  protected abstract updateAI(ctx: EnemyUpdateContext): void;

  private readonly scratch = new THREE.Vector3();

  /**
   * Shared locomotion: walk toward the attack target, stop at its edge and
   * deal contact damage while in range, and separately bite the player if
   * adjacent. Returns the normalized facing direction (or null if idle) so
   * subclasses can orient their model.
   */
  protected moveTowardAndAttack(ctx: EnemyUpdateContext, speed: number): THREE.Vector3 | null {
    const toTarget = this.scratch.copy(ctx.target.position).sub(this.position);
    toTarget.y = 0;
    const distance = toTarget.length();
    const attackRange = ctx.target.radius + this.radius + 0.15;

    let facing: THREE.Vector3 | null = null;
    if (distance > attackRange) {
      toTarget.normalize();
      facing = toTarget.clone();
      this.position.addScaledVector(toTarget, speed * ctx.delta);
    } else {
      ctx.target.takeDamage(this.contactDamagePerSecond * ctx.delta);
    }

    const toPlayer = this.scratch.copy(ctx.playerPosition).sub(this.position);
    toPlayer.y = 0;
    const meleeRange = ctx.playerRadius + this.radius + 0.25;
    if (toPlayer.length() <= meleeRange) {
      ctx.damagePlayer(this.playerContactDamagePerSecond * ctx.delta);
    }

    return facing;
  }

  /** Override to pulse an emissive material when hit. */
  protected onHitFlash(_active: boolean): void {
    // no-op by default
  }

  /** Override for enemies that spawn children on death (e.g. Stack Overflow). */
  protected spawnOnDeath(): { kind: EnemyKind; count: number } | undefined {
    return undefined;
  }

  abstract dispose(): void;
}
