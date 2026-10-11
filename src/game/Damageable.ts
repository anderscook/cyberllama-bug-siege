import * as THREE from 'three';

/** Common shape for anything projectiles and contact damage can hurt. */
export interface Damageable {
  readonly position: THREE.Vector3;
  readonly radius: number;
  readonly hp: number;
  readonly maxHp: number;
  isAlive(): boolean;
  takeDamage(amount: number): void;
}
