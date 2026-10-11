import * as THREE from 'three';
import { ARENA } from '../game/GameConfig';

export type ProjectileOwner = 'player' | 'tower';

export type ProjectileSpawnOptions = {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  damage: number;
  radius: number;
  lifespan: number;
  owner: ProjectileOwner;
  color: string;
  gravity?: number;
  slowFactor?: number;
  slowDuration?: number;
  dotDamagePerSecond?: number;
  dotDuration?: number;
  /** Railgun shots: punch through every enemy along the path instead of stopping at the first. */
  pierce?: boolean;
};

export class ProjectileInstance {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly mesh: THREE.Mesh;
  active = false;
  age = 0;
  owner: ProjectileOwner = 'player';
  damage = 0;
  radius = 0.1;
  lifespan = 1;
  gravity = 0;
  slowFactor?: number;
  slowDuration?: number;
  dotDamagePerSecond?: number;
  dotDuration?: number;
  pierce = false;
  /** Enemies already hit by this piercing shot, so it doesn't re-damage the same one every frame it overlaps. */
  readonly hitTargets = new Set<unknown>();

  constructor(mesh: THREE.Mesh) {
    this.mesh = mesh;
    this.mesh.visible = false;
  }
}

const coreGeometry = new THREE.SphereGeometry(1, 8, 6);
coreGeometry.scale(1, 1, 2.4); // base "bolt" streak shape; instances rescale per-radius

const forward = new THREE.Vector3(0, 0, 1);
const materialCache = new Map<string, THREE.MeshBasicMaterial>();
function materialForColor(color: string): THREE.MeshBasicMaterial {
  let material = materialCache.get(color);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    materialCache.set(color, material);
  }
  return material;
}

/** Pooled projectile manager: player/tower weapon fire. Never allocates per-shot after warmup. */
export class ProjectileSystem {
  readonly group = new THREE.Group();
  private readonly pool: ProjectileInstance[] = [];
  private readonly quaternion = new THREE.Quaternion();

  spawn(options: ProjectileSpawnOptions): void {
    const instance = this.acquire(options.color);
    instance.active = true;
    instance.age = 0;
    instance.owner = options.owner;
    instance.damage = options.damage;
    instance.radius = options.radius;
    instance.lifespan = options.lifespan;
    instance.gravity = options.gravity ?? 0;
    instance.slowFactor = options.slowFactor;
    instance.slowDuration = options.slowDuration;
    instance.dotDamagePerSecond = options.dotDamagePerSecond;
    instance.dotDuration = options.dotDuration;
    instance.pierce = options.pierce ?? false;
    instance.hitTargets.clear();
    instance.position.copy(options.position);
    instance.velocity.copy(options.direction).multiplyScalar(options.speed);

    instance.mesh.visible = true;
    instance.mesh.material = materialForColor(options.color);
    instance.mesh.position.copy(instance.position);
    this.quaternion.setFromUnitVectors(forward, options.direction.lengthSq() > 0 ? options.direction : forward);
    instance.mesh.quaternion.copy(this.quaternion);
    instance.mesh.scale.set(options.radius, options.radius, options.radius * (options.gravity ? 1.4 : 2.6));
  }

  update(delta: number): void {
    for (const instance of this.pool) {
      if (!instance.active) continue;
      instance.age += delta;
      if (instance.gravity) instance.velocity.y -= instance.gravity * delta;
      instance.position.addScaledVector(instance.velocity, delta);

      const out =
        instance.age >= instance.lifespan ||
        instance.position.y < -0.5 ||
        Math.abs(instance.position.x) > ARENA.halfWidth + 2 ||
        Math.abs(instance.position.z) > ARENA.halfDepth + 2;

      if (out) {
        this.deactivate(instance);
        continue;
      }

      instance.mesh.position.copy(instance.position);
      if (instance.velocity.lengthSq() > 0.0001) {
        this.quaternion.setFromUnitVectors(forward, instance.velocity.clone().normalize());
        instance.mesh.quaternion.copy(this.quaternion);
      }
    }
  }

  deactivate(instance: ProjectileInstance): void {
    instance.active = false;
    instance.mesh.visible = false;
  }

  activeByOwner(owner: ProjectileOwner): ProjectileInstance[] {
    const result: ProjectileInstance[] = [];
    for (const instance of this.pool) {
      if (instance.active && instance.owner === owner) result.push(instance);
    }
    return result;
  }

  reset(): void {
    for (const instance of this.pool) this.deactivate(instance);
  }

  private acquire(color: string): ProjectileInstance {
    for (const instance of this.pool) {
      if (!instance.active) return instance;
    }
    const mesh = new THREE.Mesh(coreGeometry, materialForColor(color));
    const instance = new ProjectileInstance(mesh);
    this.pool.push(instance);
    this.group.add(mesh);
    return instance;
  }

  dispose(): void {
    for (const material of materialCache.values()) material.dispose();
  }
}
