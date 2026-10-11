import * as THREE from 'three';
import { ENEMY_STATS } from '../../game/GameConfig';
import {
  cloneWithUniqueMaterials,
  collectStandardMaterials,
  loadModelTemplate,
  normalizeModelScale,
  setModelHitFlash,
} from '../../utils/modelCache';
import { Enemy, type EnemyUpdateContext } from './Enemy';

const STATS = ENEMY_STATS['stack-overflow'];

// Generated via threejs-3d-generator (Tripo), static mesh.
const MODEL_URL = '/models/stack-overflow/291f76e5-fc04-4b84-bab8-1c322d970adb-pbr-model.glb';
const MODEL_TARGET_HEIGHT = 1.6;

const hullGeometry = new THREE.BoxGeometry(1.3, 1.1, 1.5);
const plateGeometry = new THREE.BoxGeometry(1.42, 0.3, 1.62);
const spikeGeometry = new THREE.ConeGeometry(0.14, 0.4, 5);

const hullMaterialTemplate = new THREE.MeshStandardMaterial({
  color: '#3a2a1a',
  roughness: 0.55,
  metalness: 0.4,
  emissive: '#ff7a1f',
  emissiveIntensity: 0.2,
});
const plateMaterialTemplate = new THREE.MeshStandardMaterial({ color: '#5a4530', roughness: 0.4, metalness: 0.6 });
const spikeMaterialTemplate = new THREE.MeshStandardMaterial({ color: '#241a10', roughness: 0.3, metalness: 0.7 });

export class StackOverflow extends Enemy {
  private readonly hullMaterial = hullMaterialTemplate.clone();
  private readonly proceduralVisual = new THREE.Group();
  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  private bob = 0;

  constructor(position: THREE.Vector3, rng: () => number) {
    super(
      'stack-overflow',
      STATS.maxHp,
      STATS.speed,
      STATS.radius,
      STATS.contactDamagePerSecond,
      STATS.playerContactDamagePerSecond,
      STATS.resourceValue,
      position,
    );

    this.group.add(this.proceduralVisual);

    const hull = new THREE.Mesh(hullGeometry, this.hullMaterial);
    hull.position.y = 0.6;
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.proceduralVisual.add(hull);

    const plateTop = new THREE.Mesh(plateGeometry, plateMaterialTemplate);
    plateTop.position.y = 1.2;
    plateTop.castShadow = true;
    this.proceduralVisual.add(plateTop);

    for (let i = 0; i < 5; i += 1) {
      const spike = new THREE.Mesh(spikeGeometry, spikeMaterialTemplate);
      spike.position.set(-0.5 + i * 0.25, 1.4, 0);
      this.proceduralVisual.add(spike);
    }

    this.group.scale.setScalar(1 + rng() * 0.15);

    loadModelTemplate(MODEL_URL)
      .then((template) => {
        const instance = cloneWithUniqueMaterials(template);
        normalizeModelScale(instance, MODEL_TARGET_HEIGHT);
        this.modelMaterials = collectStandardMaterials(instance);
        this.group.add(instance);
        this.proceduralVisual.visible = false;
      })
      .catch(() => {
        // Stay on the procedural fallback.
      });
  }

  protected updateAI(ctx: EnemyUpdateContext): void {
    const facing = this.moveTowardAndAttack(ctx, this.currentSpeed);
    if (facing) {
      this.group.rotation.y = THREE.MathUtils.lerp(
        this.group.rotation.y,
        Math.atan2(-facing.x, -facing.z),
        1 - Math.exp(-ctx.delta * 4),
      );
      this.bob += ctx.delta * 5 * this.slowFactor;
    }
    this.group.position.y = Math.sin(this.bob) * 0.04;
  }

  protected onHitFlash(active: boolean): void {
    this.hullMaterial.emissiveIntensity = active ? 2.2 : 0.2;
    if (this.modelMaterials.length > 0) setModelHitFlash(this.modelMaterials, active, 2.2);
  }

  protected spawnOnDeath(): { kind: 'common-bug'; count: number } {
    return { kind: 'common-bug', count: 3 };
  }

  dispose(): void {
    this.hullMaterial.dispose();
    for (const material of this.modelMaterials) material.dispose();
  }
}
