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

const STATS = ENEMY_STATS['common-bug'];

// Generated via threejs-3d-generator (Tripo), static mesh — legs are faked
// procedurally below (bob + wiggle) same as the fallback, no skeleton needed.
const MODEL_URL = '/models/common-bug/05a14dc8-8491-4980-a358-a238a11e721a-pbr-model.glb';
const MODEL_TARGET_HEIGHT = 0.55;

const bodyGeometry = new THREE.SphereGeometry(0.3, 10, 8);
bodyGeometry.scale(1, 0.7, 1.2);
const abdomenGeometry = new THREE.SphereGeometry(0.22, 8, 6);
const legGeometry = new THREE.CylinderGeometry(0.03, 0.025, 0.42, 5);
const eyeGeometry = new THREE.SphereGeometry(0.06, 6, 6);

const shellMaterialTemplate = new THREE.MeshStandardMaterial({
  color: '#7a2f3a',
  roughness: 0.4,
  metalness: 0.35,
  emissive: '#ff2d4d',
  emissiveIntensity: 0.25,
});
const legMaterialTemplate = new THREE.MeshStandardMaterial({ color: '#241416', roughness: 0.6, metalness: 0.2 });
const eyeMaterialTemplate = new THREE.MeshBasicMaterial({ color: '#ff3b3b' });

export class CommonBug extends Enemy {
  private readonly shellMaterial = shellMaterialTemplate.clone();
  private readonly eyeMaterial = eyeMaterialTemplate.clone();
  private readonly legs: THREE.Mesh[] = [];
  private readonly proceduralVisual = new THREE.Group();
  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  private modelReady = false;
  private gait = 0;

  constructor(position: THREE.Vector3, rng: () => number) {
    super(
      'common-bug',
      STATS.maxHp,
      STATS.speed,
      STATS.radius,
      STATS.contactDamagePerSecond,
      STATS.playerContactDamagePerSecond,
      STATS.resourceValue,
      position,
    );

    this.group.add(this.proceduralVisual);

    const body = new THREE.Mesh(bodyGeometry, this.shellMaterial);
    body.position.y = 0.3;
    body.castShadow = true;
    this.proceduralVisual.add(body);

    const abdomen = new THREE.Mesh(abdomenGeometry, this.shellMaterial);
    abdomen.position.set(0, 0.3, 0.32);
    abdomen.castShadow = true;
    this.proceduralVisual.add(abdomen);

    for (let i = 0; i < 6; i += 1) {
      const leg = new THREE.Mesh(legGeometry, legMaterialTemplate);
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      leg.position.set(side * 0.26, 0.2, -0.18 + row * 0.18);
      leg.rotation.z = side * 0.9;
      leg.castShadow = true;
      this.proceduralVisual.add(leg);
      this.legs.push(leg);
    }

    const eyeGeometryOffsetL = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
    eyeGeometryOffsetL.position.set(-0.1, 0.36, -0.28);
    this.proceduralVisual.add(eyeGeometryOffsetL);
    const eyeGeometryOffsetR = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
    eyeGeometryOffsetR.position.set(0.1, 0.36, -0.28);
    this.proceduralVisual.add(eyeGeometryOffsetR);

    this.group.scale.setScalar(0.95 + rng() * 0.2);

    loadModelTemplate(MODEL_URL)
      .then((template) => {
        const instance = cloneWithUniqueMaterials(template);
        normalizeModelScale(instance, MODEL_TARGET_HEIGHT);
        instance.castShadow = true;
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
      this.group.rotation.y = Math.atan2(-facing.x, -facing.z);
      this.gait += ctx.delta * 14 * this.slowFactor;
    }
    this.group.position.y = Math.abs(Math.sin(this.gait)) * 0.06;
    if (!this.modelReady) {
      this.legs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(this.gait + i) * 0.5;
      });
    }
  }

  protected onHitFlash(active: boolean): void {
    this.shellMaterial.emissiveIntensity = active ? 2.4 : 0.25;
    if (this.modelMaterials.length > 0) setModelHitFlash(this.modelMaterials, active, 2.4);
  }

  dispose(): void {
    this.shellMaterial.dispose();
    this.eyeMaterial.dispose();
    for (const material of this.modelMaterials) material.dispose();
  }
}
