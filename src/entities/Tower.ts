import * as THREE from 'three';
import type { Damageable } from '../game/Damageable';
import { TOWER_DEFS, TOWER_RADIUS, type TowerKind } from '../game/GameConfig';
import {
  cloneWithUniqueMaterials,
  collectStandardMaterials,
  loadModelTemplate,
  normalizeModelScale,
} from '../utils/modelCache';

// Generated via threejs-3d-generator (Tripo), static meshes (fused base+head,
// no rig) — the whole model rotates to face its target instead of just a
// "head" sub-part, since there's nothing to separately articulate.
const MODEL_URLS: Record<TowerKind, string> = {
  'gatling-cannon': '/models/firewall-tower/5631a1e3-7cdc-4e63-b415-0fd7e6658eb6-pbr-model.glb',
  railgun: '/models/railgun-tower/287758cd-5b0a-4d90-9907-f1084272ac63-pbr-model.glb',
};
const MODEL_TARGET_HEIGHTS: Record<TowerKind, number> = {
  'gatling-cannon': 1.5,
  railgun: 1.35,
};

const baseGeometry = new THREE.CylinderGeometry(TOWER_RADIUS, TOWER_RADIUS + 0.15, 0.5, 8);
const headGeometry = new THREE.SphereGeometry(0.42, 12, 10);
const barrelGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.9, 8);

const baseMaterial = new THREE.MeshStandardMaterial({ color: '#2d3340', roughness: 0.5, metalness: 0.6 });
const headMaterialTemplate = new THREE.MeshStandardMaterial({
  color: '#1d4d55',
  roughness: 0.3,
  metalness: 0.4,
  emissive: '#2de0c0',
  emissiveIntensity: 0.8,
});
const barrelMaterial = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.4, metalness: 0.7 });

export type TowerFireRequest = {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  damage: number;
  speed: number;
  radius: number;
  pierce: boolean;
  color: string;
};

/** Minimal shape an enemy must expose for turret targeting/firing. */
export type Targetable = { position: THREE.Vector3; isAlive(): boolean };

export class Tower implements Damageable {
  readonly group = new THREE.Group();
  readonly position = this.group.position;
  readonly radius = TOWER_RADIUS;
  readonly kind: TowerKind;
  readonly maxHp: number;
  readonly range: number;
  hp: number;
  destroyed = false;

  private readonly def: (typeof TOWER_DEFS)[TowerKind];
  private readonly proceduralVisual = new THREE.Group();
  private readonly headMaterial = headMaterialTemplate.clone();
  private readonly head: THREE.Group;
  private readonly modelVisual = new THREE.Group();
  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  private modelReady = false;
  private fireCooldown = 0;
  private readonly muzzle = new THREE.Vector3();
  private readonly aimDirection = new THREE.Vector3(0, 0, -1);

  constructor(position: THREE.Vector3, kind: TowerKind) {
    this.kind = kind;
    this.def = TOWER_DEFS[kind];
    this.maxHp = this.def.maxHp;
    this.hp = this.def.maxHp;
    this.range = this.def.range;

    this.group.position.copy(position);
    this.group.add(this.proceduralVisual);
    this.group.add(this.modelVisual);

    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = 0.25;
    base.castShadow = true;
    base.receiveShadow = true;
    this.proceduralVisual.add(base);

    this.head = new THREE.Group();
    this.head.position.y = 0.7;
    this.proceduralVisual.add(this.head);

    const headMesh = new THREE.Mesh(headGeometry, this.headMaterial);
    headMesh.castShadow = true;
    this.head.add(headMesh);

    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.55;
    this.head.add(barrel);

    loadModelTemplate(MODEL_URLS[kind])
      .then((template) => {
        const instance = cloneWithUniqueMaterials(template);
        normalizeModelScale(instance, MODEL_TARGET_HEIGHTS[kind]);
        this.modelMaterials = collectStandardMaterials(instance);
        this.modelVisual.add(instance);
        this.proceduralVisual.visible = false;
        this.modelReady = true;
      })
      .catch(() => {
        // Stay on the procedural fallback.
      });
  }

  isAlive(): boolean {
    return !this.destroyed;
  }

  takeDamage(amount: number): void {
    if (this.destroyed) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.destroyed = true;
  }

  repair(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  /** Returns a fire request when the turret acquires a target and its cooldown has elapsed. */
  update(delta: number, targets: readonly Targetable[]): TowerFireRequest | null {
    this.fireCooldown = Math.max(0, this.fireCooldown - delta);
    const pulse = 0.6 + Math.sin(performance.now() * 0.004) * 0.15;
    this.headMaterial.emissiveIntensity = pulse;
    for (const material of this.modelMaterials) material.emissiveIntensity = pulse * 0.5;

    let nearest: Targetable | null = null;
    let nearestDistSq = this.range * this.range;
    for (const target of targets) {
      if (!target.isAlive()) continue;
      const distSq = this.position.distanceToSquared(target.position);
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = target;
      }
    }

    if (!nearest) return null;

    this.aimDirection.copy(nearest.position).sub(this.position);
    this.aimDirection.y = 0;
    if (this.aimDirection.lengthSq() > 0.0001) {
      this.aimDirection.normalize();
      const facing = Math.atan2(-this.aimDirection.x, -this.aimDirection.z);
      this.head.rotation.y = facing;
      if (this.modelReady) this.modelVisual.rotation.y = facing;
    }

    if (this.fireCooldown > 0) return null;
    this.fireCooldown = this.def.fireInterval;
    this.muzzle.copy(this.position).add(new THREE.Vector3(0, 0.7, 0)).addScaledVector(this.aimDirection, 0.6);
    return {
      position: this.muzzle.clone(),
      direction: this.aimDirection.clone(),
      damage: this.def.damage,
      speed: this.def.projectileSpeed,
      radius: this.def.projectileRadius,
      pierce: this.def.pierce,
      color: this.def.tracerColor,
    };
  }

  dispose(): void {
    this.headMaterial.dispose();
    for (const material of this.modelMaterials) material.dispose();
  }
}
