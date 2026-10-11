import type { InputController } from '../core/InputController';
import type { Player } from '../entities/Player';
import { ProjectileSystem } from '../entities/Projectile';
import { WEAPONS, type WeaponId } from '../game/GameConfig';

export type FireEvent = { weapon: WeaponId };

export class WeaponSystem {
  private currentWeapon: WeaponId = 'debug-blaster';
  private readonly cooldowns: Record<WeaponId, number> = {
    'debug-blaster': 0,
    'spit-protocol': 0,
  };

  get weapon(): WeaponId {
    return this.currentWeapon;
  }

  weaponName(): string {
    return WEAPONS[this.currentWeapon].name;
  }

  cooldownFraction(): number {
    const total = WEAPONS[this.currentWeapon].cooldown;
    return total > 0 ? 1 - this.cooldowns[this.currentWeapon] / total : 1;
  }

  /** Called by Game.ts, which owns interpreting the raw 1/2 digit press (weapon switch outside build mode). */
  setWeapon(weapon: WeaponId, player: Player): void {
    this.currentWeapon = weapon;
    player.setWeapon(weapon);
  }

  update(
    delta: number,
    input: InputController,
    player: Player,
    projectiles: ProjectileSystem,
    canFire: boolean,
  ): FireEvent | null {
    (Object.keys(this.cooldowns) as WeaponId[]).forEach((id) => {
      this.cooldowns[id] = Math.max(0, this.cooldowns[id] - delta);
    });

    if (!canFire || !input.isFireHeld()) return null;
    if (this.cooldowns[this.currentWeapon] > 0) return null;

    const stats = WEAPONS[this.currentWeapon];
    this.cooldowns[this.currentWeapon] = stats.cooldown;

    projectiles.spawn({
      position: player.muzzlePosition,
      direction: player.aimDirection,
      speed: stats.projectileSpeed,
      damage: stats.damage,
      radius: stats.radius,
      lifespan: stats.lifespan,
      owner: 'player',
      color: stats.color,
      gravity: stats.gravity,
      slowFactor: stats.slowFactor,
      slowDuration: stats.slowDuration,
      dotDamagePerSecond: stats.dotDamagePerSecond,
      dotDuration: stats.dotDuration,
    });
    player.playFireRecoil();
    return { weapon: this.currentWeapon };
  }

  reset(): void {
    this.currentWeapon = 'debug-blaster';
    this.cooldowns['debug-blaster'] = 0;
    this.cooldowns['spit-protocol'] = 0;
  }
}
