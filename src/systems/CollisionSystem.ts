import * as THREE from 'three';
import type { AttackTarget } from '../entities/enemies/Enemy';
import type { Enemy } from '../entities/enemies/Enemy';
import type { Mainframe } from '../entities/Mainframe';
import type { ProjectileInstance } from '../entities/Projectile';
import type { ResourceOrb } from '../entities/ResourceOrb';
import type { Tower } from '../entities/Tower';

export type ProjectileHitEvent = {
  projectile: ProjectileInstance;
  enemy: Enemy;
  killed: boolean;
};

export class CollisionSystem {
  private readonly delta = new THREE.Vector3();

  /** Mutates enemies (damage/slow/dot) and returns the projectiles that connected, for the caller to deactivate + react to. */
  resolveProjectilesVsEnemies(projectiles: readonly ProjectileInstance[], enemies: readonly Enemy[]): ProjectileHitEvent[] {
    const hits: ProjectileHitEvent[] = [];
    for (const projectile of projectiles) {
      if (!projectile.active) continue;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        if (projectile.pierce && projectile.hitTargets.has(enemy)) continue; // already punched through this one
        this.delta.copy(projectile.position).sub(enemy.position);
        this.delta.y = 0;
        const radius = projectile.radius + enemy.radius;
        if (this.delta.lengthSq() > radius * radius) continue;

        enemy.takeDamage(projectile.damage);
        if (projectile.slowFactor !== undefined && projectile.slowDuration !== undefined) {
          enemy.applySlow(projectile.slowFactor, projectile.slowDuration);
        }
        if (projectile.dotDamagePerSecond !== undefined && projectile.dotDuration !== undefined) {
          enemy.applyDot(projectile.dotDamagePerSecond, projectile.dotDuration);
        }
        hits.push({ projectile, enemy, killed: enemy.dead });
        if (projectile.pierce) {
          projectile.hitTargets.add(enemy);
          continue; // keep flying, may hit more enemies this frame or later frames
        }
        break;
      }
    }
    return hits;
  }

  collectResourceOrbs(playerPosition: THREE.Vector3, orbs: readonly ResourceOrb[], playerRadius: number): ResourceOrb[] {
    const collected: ResourceOrb[] = [];
    for (const orb of orbs) {
      if (!orb.active) continue;
      this.delta.copy(playerPosition).sub(orb.group.position);
      this.delta.y = 0;
      const radius = playerRadius + orb.radius;
      if (this.delta.lengthSq() <= radius * radius) {
        orb.collect();
        collected.push(orb);
      }
    }
    return collected;
  }

  /** The nearest defensive structure (a Tower, else the Mainframe) for an enemy at `position` to path toward and attack. */
  nearestAttackTarget(position: THREE.Vector3, mainframe: Mainframe, towers: readonly Tower[]): AttackTarget {
    let best: Tower | Mainframe = mainframe;
    let bestDistSq = position.distanceToSquared(mainframe.position);
    for (const tower of towers) {
      if (tower.destroyed) continue;
      const distSq = position.distanceToSquared(tower.position);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = tower;
      }
    }
    return {
      position: best.position,
      radius: best.radius,
      takeDamage: (amount: number) => best.takeDamage(amount),
    };
  }
}
