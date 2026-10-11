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

const STATS = ENEMY_STATS['null-pointer'];

// Generated via threejs-3d-generator (Tripo), static mesh.
const MODEL_URL = '/models/null-pointer/56e91550-174a-4a69-9b78-979d89682d32-pbr-model.glb';
const MODEL_TARGET_HEIGHT = 0.65;

const coreGeometry = new THREE.OctahedronGeometry(0.38, 0);
const shardGeometry = new THREE.TetrahedronGeometry(0.16, 0);

const coreMaterialTemplate = new THREE.MeshStandardMaterial({
  color: '#2a1b40',
  roughness: 0.25,
  metalness: 0.5,
  emissive: '#9b4dff',
  emissiveIntensity: 0.9,
  transparent: true,
  opacity: 0.92,
});
const shardMaterialTemplate = new THREE.MeshBasicMaterial({ color: '#d9b3ff' });

const TELEPORT_MIN_INTERVAL = 1.6;
const TELEPORT_MAX_INTERVAL = 2.4;
const TELEPORT_CHARGE_TIME = 0.32;
const TELEPORT_HOP_MIN = 2.6;
const TELEPORT_HOP_MAX = 4.6;

export class NullPointer extends Enemy {
  private readonly coreMaterial = coreMaterialTemplate.clone();
  private readonly proceduralVisual = new THREE.Group();
  private readonly shards: THREE.Mesh[] = [];
  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  private modelReady = false;
  private teleportTimer: number;
  private charging = false;
  private chargeElapsed = 0;

  constructor(position: THREE.Vector3, private readonly rngRef: () => number) {
    super(
      'null-pointer',
      STATS.maxHp,
      STATS.speed,
      STATS.radius,
      STATS.contactDamagePerSecond,
      STATS.playerContactDamagePerSecond,
      STATS.resourceValue,
      position,
    );

    this.group.add(this.proceduralVisual);

    const core = new THREE.Mesh(coreGeometry, this.coreMaterial);
    core.position.y = 0.45;
    core.castShadow = true;
    this.proceduralVisual.add(core);

    for (let i = 0; i < 4; i += 1) {
      const shard = new THREE.Mesh(shardGeometry, shardMaterialTemplate);
      const angle = (i / 4) * Math.PI * 2;
      shard.position.set(Math.cos(angle) * 0.3, 0.45 + Math.sin(angle * 2) * 0.1, Math.sin(angle) * 0.3);
      this.proceduralVisual.add(shard);
      this.shards.push(shard);
    }

    this.teleportTimer = TELEPORT_MIN_INTERVAL + rngRef() * (TELEPORT_MAX_INTERVAL - TELEPORT_MIN_INTERVAL);

    loadModelTemplate(MODEL_URL)
      .then((template) => {
        const instance = cloneWithUniqueMaterials(template);
        normalizeModelScale(instance, MODEL_TARGET_HEIGHT);
        this.modelMaterials = collectStandardMaterials(instance);
        this.group.add(instance);
        this.proceduralVisual.visible = false;
        this.modelReady = true;
      })
      .catch(() => {
        // Stay on the procedural fallback.
      });
  }

  protected updateAI(ctx: EnemyUpdateContext): void {
    this.group.rotation.y += ctx.delta * 1.6;
    this.group.position.y = Math.sin(ctx.elapsed * 3 + this.position.x) * 0.05;
    if (!this.modelReady) {
      this.shards.forEach((shard, i) => {
        shard.rotation.x += ctx.delta * (2 + i * 0.3);
        shard.rotation.y += ctx.delta * (1.4 + i * 0.2);
      });
    }

    if (this.charging) {
      this.chargeElapsed += ctx.delta;
      const pulse = this.chargeElapsed / TELEPORT_CHARGE_TIME;
      this.group.scale.setScalar(1 - pulse * 0.4);
      if (!this.modelReady) this.coreMaterial.opacity = 0.92 - pulse * 0.6;
      if (this.chargeElapsed >= TELEPORT_CHARGE_TIME) {
        this.performTeleport(ctx);
        this.charging = false;
        this.chargeElapsed = 0;
        this.group.scale.setScalar(1);
        this.coreMaterial.opacity = 0.92;
        this.teleportTimer = TELEPORT_MIN_INTERVAL + ctx.rng() * (TELEPORT_MAX_INTERVAL - TELEPORT_MIN_INTERVAL);
      }
      const toPlayer = ctx.playerPosition.clone().sub(this.position);
      toPlayer.y = 0;
      if (toPlayer.length() <= ctx.playerRadius + this.radius + 0.25) {
        ctx.damagePlayer(this.playerContactDamagePerSecond * ctx.delta);
      }
      return;
    }

    this.teleportTimer -= ctx.delta;
    if (this.teleportTimer <= 0) {
      this.charging = true;
      this.chargeElapsed = 0;
      return;
    }

    const facing = this.moveTowardAndAttack(ctx, this.currentSpeed);
    if (facing) this.group.rotation.y = Math.atan2(-facing.x, -facing.z);
  }

  private performTeleport(ctx: EnemyUpdateContext): void {
    const toTarget = ctx.target.position.clone().sub(this.position);
    toTarget.y = 0;
    if (toTarget.lengthSq() < 0.0001) return;
    toTarget.normalize();
    const hop = TELEPORT_HOP_MIN + this.rngRef() * (TELEPORT_HOP_MAX - TELEPORT_HOP_MIN);
    this.position.addScaledVector(toTarget, hop);
    this.group.rotation.y = Math.atan2(-toTarget.x, -toTarget.z);
  }

  protected onHitFlash(active: boolean): void {
    this.coreMaterial.emissiveIntensity = active ? 3 : 0.9;
    if (this.modelMaterials.length > 0) setModelHitFlash(this.modelMaterials, active, 3);
  }

  dispose(): void {
    this.coreMaterial.dispose();
    for (const material of this.modelMaterials) material.dispose();
  }
}
