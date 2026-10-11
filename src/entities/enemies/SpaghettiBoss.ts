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

const STATS = ENEMY_STATS['spaghetti-boss'];

// Generated via threejs-3d-generator (Tripo), static mesh — the writhing
// per-limb segment animation below only applies to the procedural fallback
// (the generated noodle limbs aren't individually rigged); the model still
// gets the shared bob/rotation/hit-flash/lash-glow treatment.
const MODEL_URL = '/models/spaghetti-boss/dba09469-2c7a-46c6-8488-790d4b2a6866-pbr-model.glb';
const MODEL_TARGET_HEIGHT = 3.2;

const coreGeometry = new THREE.SphereGeometry(1.1, 20, 16);
const meatballGeometry = new THREE.SphereGeometry(0.32, 10, 8);
const segmentGeometry = new THREE.CylinderGeometry(0.16, 0.12, 0.55, 8);

const coreMaterialTemplate = new THREE.MeshStandardMaterial({
  color: '#8a1f1f',
  roughness: 0.5,
  metalness: 0.1,
  emissive: '#ff5a1f',
  emissiveIntensity: 0.4,
});
const noodleMaterialTemplate = new THREE.MeshStandardMaterial({
  color: '#e8c468',
  roughness: 0.55,
  metalness: 0.05,
  emissive: '#5a3a10',
  emissiveIntensity: 0.3,
});
const meatballMaterialTemplate = new THREE.MeshStandardMaterial({ color: '#4a2a1a', roughness: 0.7, metalness: 0.1 });
const eyeMaterialTemplate = new THREE.MeshBasicMaterial({ color: '#ffe84d' });
const eyeGeometry = new THREE.SphereGeometry(0.14, 8, 8);

const LIMB_COUNT = 6;
const SEGMENTS_PER_LIMB = 5;

type Limb = { segments: THREE.Mesh[]; phase: number };

export class SpaghettiBoss extends Enemy {
  private readonly coreMaterial = coreMaterialTemplate.clone();
  private readonly proceduralVisual = new THREE.Group();
  private readonly limbs: Limb[] = [];
  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  private modelReady = false;
  private bob = 0;
  private lashTimer = 4;
  lashPulse = 0;

  constructor(position: THREE.Vector3, rng: () => number) {
    super(
      'spaghetti-boss',
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
    core.position.y = 1.6;
    core.castShadow = true;
    this.proceduralVisual.add(core);

    for (let m = 0; m < 5; m += 1) {
      const meatball = new THREE.Mesh(meatballGeometry, meatballMaterialTemplate);
      const angle = (m / 5) * Math.PI * 2;
      meatball.position.set(Math.cos(angle) * 0.95, 1.3 + Math.sin(angle * 1.7) * 0.3, Math.sin(angle) * 0.95);
      meatball.castShadow = true;
      this.proceduralVisual.add(meatball);
    }

    const eyeL = new THREE.Mesh(eyeGeometry, eyeMaterialTemplate);
    eyeL.position.set(-0.4, 1.9, -0.95);
    this.proceduralVisual.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeometry, eyeMaterialTemplate);
    eyeR.position.set(0.4, 1.9, -0.95);
    this.proceduralVisual.add(eyeR);

    for (let l = 0; l < LIMB_COUNT; l += 1) {
      const angle = (l / LIMB_COUNT) * Math.PI * 2;
      let parent: THREE.Object3D = this.proceduralVisual;
      const segments: THREE.Mesh[] = [];
      for (let s = 0; s < SEGMENTS_PER_LIMB; s += 1) {
        const segment = new THREE.Mesh(segmentGeometry, noodleMaterialTemplate);
        segment.castShadow = true;
        if (s === 0) {
          segment.position.set(Math.cos(angle) * 1.05, 1.5, Math.sin(angle) * 1.05);
          segment.rotation.z = Math.cos(angle) * 0.6;
          segment.rotation.x = Math.sin(angle) * 0.6 + 0.3;
        } else {
          segment.position.set(0, 0.52, 0);
        }
        parent.add(segment);
        parent = segment;
        segments.push(segment);
      }
      this.limbs.push({ segments, phase: rng() * Math.PI * 2 });
    }

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
    const facing = this.moveTowardAndAttack(ctx, this.currentSpeed);
    if (facing) {
      this.group.rotation.y = THREE.MathUtils.lerp(
        this.group.rotation.y,
        Math.atan2(-facing.x, -facing.z),
        1 - Math.exp(-ctx.delta * 2.5),
      );
    }
    this.bob += ctx.delta;
    this.group.position.y = Math.sin(this.bob * 1.4) * 0.12;

    if (!this.modelReady) {
      for (const limb of this.limbs) {
        limb.segments.forEach((segment, i) => {
          const wave = Math.sin(ctx.elapsed * 2.2 + limb.phase + i * 0.9) * 0.35;
          if (i === 0) {
            segment.rotation.y = wave * 0.5;
          } else {
            segment.rotation.x = 0.3 + wave;
          }
        });
      }
    }

    if (this.lashTimer > 0) {
      this.lashTimer -= ctx.delta;
      this.lashPulse = Math.max(0, this.lashPulse - ctx.delta * 2);
    } else {
      this.lashTimer = 4.5 + ctx.rng() * 2;
      this.lashPulse = 1;
    }
    // Skip while a hit-flash is actively overriding emissive this frame —
    // otherwise this unconditional assignment stomps the flash pulse.
    if (this.hitFlashTimer <= 0) {
      const lashIntensity = 0.4 + this.lashPulse * 1.4;
      this.coreMaterial.emissiveIntensity = lashIntensity;
      for (const material of this.modelMaterials) material.emissiveIntensity = lashIntensity * 0.5;
    }
  }

  protected onHitFlash(active: boolean): void {
    this.coreMaterial.emissiveIntensity = active ? 3 : 0.4;
    if (this.modelMaterials.length > 0) setModelHitFlash(this.modelMaterials, active, 3);
  }

  dispose(): void {
    this.coreMaterial.dispose();
    for (const material of this.modelMaterials) material.dispose();
  }
}
