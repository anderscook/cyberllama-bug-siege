import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { InputController } from '../core/InputController';
import type { CameraRig } from '../systems/CameraRig';
import { disposeObject3D } from '../utils/dispose';
import { downscaleSceneTextures } from '../utils/modelCache';
import {
  MAINFRAME_POSITION,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  type ArenaBounds,
  type WeaponId,
} from '../game/GameConfig';

export type PlayerTuning = {
  moveSpeed: number;
  sprintMultiplier: number;
  acceleration: number;
  jumpSpeed: number;
  gravity: number;
  dashSpeed: number;
  dashDuration: number;
  dashCooldown: number;
};

export type PlayerObstacle = { position: THREE.Vector3; radius: number };

const armorMaterial = new THREE.MeshStandardMaterial({ color: '#d6613f', roughness: 0.42, metalness: 0.35 });
const plateMaterial = new THREE.MeshStandardMaterial({
  color: '#232a30',
  roughness: 0.35,
  metalness: 0.6,
  emissive: '#59e8ff',
  emissiveIntensity: 0.25,
});
const furMaterial = new THREE.MeshStandardMaterial({ color: '#efe6d8', roughness: 0.75, metalness: 0.02 });
const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#59e8ff' });
const hoofMaterial = new THREE.MeshStandardMaterial({ color: '#1a1d22', roughness: 0.5, metalness: 0.5 });
const blasterMaterial = new THREE.MeshStandardMaterial({
  color: '#1c3e4a',
  roughness: 0.3,
  metalness: 0.6,
  emissive: '#59e8ff',
  emissiveIntensity: 0.6,
});
const spitGlowMaterial = new THREE.MeshBasicMaterial({ color: '#8fff4d', transparent: true, opacity: 0.85 });

// Generated via threejs-3d-generator (Tripo): the rig stage output is a
// properly textured, skinned GLB in bind pose. Locomotion/aim are driven by
// rotating its real bones (same approach as the procedural fallback below),
// NOT by Tripo's baked walk/run FBX clips — those drift off-mark (locomotion
// translation isn't fully isolated to the bone the documented strip targets)
// and FBXLoader can't read Tripo's embedded FBX textures at all. See
// artifacts/game-progress.md for the investigation.
const MODEL_URL = '/models/cyberllama-v2/rig/d6e34373-95be-4731-86d1-00b05ff0f3f7-model.glb';
// The rig's bind pose (every bone at identity rotation) turned out to be a
// crouched, forward-leaning stance with one arm raised/pointing, baked in by
// the auto-rig step — not the T-pose Tripo's own preview showed. Fix: sample
// this idle clip's first keyframe per-bone (same skeleton/bone names, no
// extra generation cost) and apply it as a one-time static pose correction
// over the bind pose, instead of using the raw bind pose as-is.
const IDLE_POSE_URL = '/models/cyberllama-v2/idle/a2b29851-4e4c-459f-b52d-aace9ddfd06f-model.fbx';
const MODEL_TARGET_HEIGHT = 1.7;

/**
 * A driven bone plus the quaternion it held right after the idle-pose
 * correction. Procedural swing is composed ON TOP of this base quaternion
 * (`base * delta`), never by overwriting `.rotation.x` directly: that
 * decomposes the bone's current quaternion to Euler XYZ, swaps in the new
 * X, and recomposes — which previously threw a bone (spine02) into a wildly
 * different orientation whenever its rest pose wasn't a clean X-axis bend.
 * Composing a delta quaternion on the stored base is safe regardless of
 * what the base orientation actually is.
 */
type ModelBone = { bone: THREE.Bone; baseQuaternion: THREE.Quaternion };
type ModelBones = {
  thighL: ModelBone;
  thighR: ModelBone;
  calfL: ModelBone;
  calfR: ModelBone;
  spine02: ModelBone;
};

function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((child) => {
    if (!found && (child as THREE.Bone).isBone && child.name === name) found = child as THREE.Bone;
  });
  return found;
}

/** Finds a bone and snapshots its current (idle-corrected) quaternion as the swing base. */
function captureModelBone(root: THREE.Object3D, name: string): ModelBone | null {
  const bone = findBone(root, name);
  if (!bone) return null;
  return { bone, baseQuaternion: bone.quaternion.clone() };
}

const swingAxis = new THREE.Vector3(1, 0, 0);
const swingDeltaQuaternion = new THREE.Quaternion();

/** Applies `base * rotation(angle around local X)` to a driven bone — see ModelBone doc comment for why. */
function applyBoneSwing(modelBone: ModelBone, angle: number): void {
  swingDeltaQuaternion.setFromAxisAngle(swingAxis, angle);
  modelBone.bone.quaternion.copy(modelBone.baseQuaternion).multiply(swingDeltaQuaternion);
}

/** Applies each bone's first-keyframe quaternion from the idle clip onto the matching GLB bone, once. */
function applyIdlePoseCorrection(root: THREE.Object3D, idleClip: THREE.AnimationClip): void {
  const firstQuaternionByBone = new Map<string, THREE.Quaternion>();
  for (const track of idleClip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot === -1 || track.name.slice(dot) !== '.quaternion') continue;
    const boneName = track.name.slice(0, dot);
    if (boneName === 'Armature' || boneName === 'Root') continue; // wrapper/root nodes, not skeletal bones
    const v = track.values;
    firstQuaternionByBone.set(boneName, new THREE.Quaternion(v[0], v[1], v[2], v[3]));
  }

  root.traverse((child) => {
    if (!(child as THREE.Bone).isBone) return;
    const quaternion = firstQuaternionByBone.get(child.name);
    if (quaternion) child.quaternion.copy(quaternion);
  });
}

export class Player {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly radius = PLAYER_RADIUS;
  readonly maxHp = PLAYER_MAX_HP;
  hp = PLAYER_MAX_HP;
  grounded = true;
  dashing = false;
  invulnerable = false;

  /** World-space muzzle position + aim direction for the currently equipped weapon, refreshed each update. */
  readonly muzzlePosition = new THREE.Vector3();
  readonly aimDirection = new THREE.Vector3(0, 0, -1);

  private readonly bodyPivot = new THREE.Group();
  private readonly proceduralVisual = new THREE.Group();
  private readonly modelVisual = new THREE.Group();
  private modelReady = false;
  private modelRoot: THREE.Object3D | null = null;
  private modelBones: ModelBones | null = null;
  private readonly modelMaterials: THREE.MeshStandardMaterial[] = [];

  private readonly upperBody = new THREE.Group();
  // Rig bones in the generated model compose rotation+scale in a way that
  // doesn't decompose into a simple invertible scale (confirmed by testing:
  // a mathematically-correct world-scale inverse still rendered the weapon
  // as a distorted slab). Since arm bones aren't animated anyway (only
  // legs/spine are driven procedurally), there's nothing to gain from a true
  // bone attachment — this plain, unskinned anchor sits in bodyPivot's clean
  // coordinate space near the model's hand instead.
  private readonly modelWeaponAnchor = new THREE.Group();
  private readonly weaponMount = new THREE.Group();
  private readonly blasterMesh: THREE.Group;
  private readonly spitGlowMesh: THREE.Mesh;
  private readonly leftEar: THREE.Mesh;
  private readonly rightEar: THREE.Mesh;
  private readonly tail: THREE.Mesh;
  private readonly torsoMaterial = armorMaterial.clone();
  private readonly legs: { thigh: THREE.Mesh; shin: THREE.Object3D; phase: number }[] = [];

  private readonly moveInput = new THREE.Vector2();
  private readonly lookDelta = new THREE.Vector2();
  private readonly desiredVelocity = new THREE.Vector3();
  private readonly forward3 = new THREE.Vector3();
  private readonly right3 = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  private verticalVelocity = 0;
  private dashTimer = 0;
  private dashCooldownRemaining = 0;
  private dashDirection = new THREE.Vector3(0, 0, -1);
  private gait = 0;
  private idleTimer = 0;
  private earTwitch = 0;
  private recoilKick = 0;
  private hitFlashTimer = 0;
  private invulnTimer = 0;
  private respawnTimer = 0;
  private equippedWeapon: WeaponId = 'debug-blaster';

  constructor() {
    this.group.add(this.bodyPivot);
    this.bodyPivot.position.y = 0;
    this.bodyPivot.add(this.proceduralVisual);
    this.bodyPivot.add(this.modelVisual);
    this.modelWeaponAnchor.position.set(0.4, 1.15, -0.35);
    this.bodyPivot.add(this.modelWeaponAnchor);

    // ---- Procedural fallback: visible until the generated model loads, and
    // the permanent visual if it ever fails to load. ----

    // Hind legs (digitigrade stance).
    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      const legGroup = new THREE.Group();
      legGroup.position.set(side * 0.22, 0.62, 0.05);
      this.proceduralVisual.add(legGroup);

      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.4, 8), furMaterial);
      thigh.position.set(0, -0.2, 0);
      thigh.castShadow = true;
      legGroup.add(thigh);

      const shinGroup = new THREE.Group();
      shinGroup.position.set(0, -0.4, 0);
      thigh.add(shinGroup);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.38, 8), furMaterial);
      shin.position.set(0, -0.19, 0.05);
      shin.castShadow = true;
      shinGroup.add(shin);

      const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.2), hoofMaterial);
      hoof.position.set(0, -0.38, 0.1);
      shin.add(hoof);

      this.legs.push({ thigh, shin: shinGroup, phase: i * Math.PI });
    }

    // Torso.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 6, 12), this.torsoMaterial);
    torso.position.set(0, 1.08, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.proceduralVisual.add(torso);

    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.18), plateMaterial);
    chestPlate.position.set(0, 1.18, -0.24);
    chestPlate.castShadow = true;
    this.proceduralVisual.add(chestPlate);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.26), plateMaterial);
    backpack.position.set(0, 1.16, 0.32);
    backpack.castShadow = true;
    this.proceduralVisual.add(backpack);

    this.tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 6), furMaterial);
    this.tail.position.set(0, 0.95, 0.46);
    this.tail.rotation.x = Math.PI / 2.3;
    this.proceduralVisual.add(this.tail);

    // Upper body pivot carries neck/head/arms/weapon and tilts with camera pitch.
    this.upperBody.position.set(0, 1.42, 0);
    this.proceduralVisual.add(this.upperBody);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.62, 8), furMaterial);
    neck.position.set(0, 0.32, -0.12);
    neck.rotation.x = -0.35;
    neck.castShadow = true;
    this.upperBody.add(neck);

    const head = new THREE.Group();
    head.position.set(0, 0.62, -0.28);
    this.upperBody.add(head);

    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.42), furMaterial);
    skull.castShadow = true;
    head.add(skull);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 6), furMaterial);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.05, -0.34);
    head.add(snout);

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), eyeMaterial);
    eyeL.position.set(-0.1, 0.03, -0.2);
    head.add(eyeL);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), eyeMaterial);
    eyeR.position.set(0.1, 0.03, -0.2);
    head.add(eyeR);

    const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMaterial);
    sensor.position.set(0, 0.2, -0.05);
    head.add(sensor);

    this.leftEar = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.42, 4), furMaterial);
    this.leftEar.position.set(-0.13, 0.3, 0.04);
    this.leftEar.rotation.z = 0.22;
    this.leftEar.castShadow = true;
    head.add(this.leftEar);

    this.rightEar = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.42, 4), furMaterial);
    this.rightEar.position.set(0.13, 0.3, 0.04);
    this.rightEar.rotation.z = -0.22;
    this.rightEar.castShadow = true;
    head.add(this.rightEar);

    // Arms + weapon mount.
    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 4, 8), furMaterial);
    leftArm.position.set(-0.32, 0.02, -0.18);
    leftArm.rotation.x = 0.9;
    leftArm.castShadow = true;
    this.upperBody.add(leftArm);

    const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 4, 8), furMaterial);
    rightArm.position.set(0.4, 0.02, -0.22);
    rightArm.rotation.x = 1.0;
    rightArm.castShadow = true;
    this.upperBody.add(rightArm);

    // Weapon mount starts on the procedural arm; reparented onto the real
    // R_Hand bone once the generated model finishes loading (see loadModel).
    this.weaponMount.position.set(0.44, -0.02, -0.5);
    this.upperBody.add(this.weaponMount);

    this.blasterMesh = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.55), blasterMaterial);
    barrel.position.z = -0.2;
    barrel.castShadow = true;
    this.blasterMesh.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.26), blasterMaterial);
    stock.position.z = 0.16;
    this.blasterMesh.add(stock);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.1), plateMaterial);
    sight.position.set(0, 0.1, -0.1);
    this.blasterMesh.add(sight);
    this.weaponMount.add(this.blasterMesh);

    this.spitGlowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), spitGlowMaterial);
    this.spitGlowMesh.position.set(-0.34, 0.34, -0.42);
    this.spitGlowMesh.visible = false;
    this.upperBody.add(this.spitGlowMesh);

    void this.loadModel();
  }

  private async loadModel(): Promise<void> {
    try {
      const [gltf, idleFbx] = await Promise.all([
        new GLTFLoader().loadAsync(MODEL_URL),
        new FBXLoader().loadAsync(IDLE_POSE_URL),
      ]);
      const root = gltf.scene;
      if (idleFbx.animations[0]) applyIdlePoseCorrection(root, idleFbx.animations[0]);
      // This model ships 4096x4096 textures (base color + normal + roughness)
      // — uncompressed on the GPU that alone approaches the memory ceiling
      // that crashes iOS Safari's WebGL context. See modelCache.ts.
      downscaleSceneTextures(root);

      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) this.modelMaterials.push(material as THREE.MeshStandardMaterial);
      });

      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = MODEL_TARGET_HEIGHT / Math.max(size.y, 0.001);
      root.scale.setScalar(scale);
      root.updateMatrixWorld(true);
      const scaledBox = new THREE.Box3().setFromObject(root);
      root.position.y -= scaledBox.min.y;

      const thighL = captureModelBone(root, 'L_Thigh');
      const thighR = captureModelBone(root, 'R_Thigh');
      const calfL = captureModelBone(root, 'L_Calf');
      const calfR = captureModelBone(root, 'R_Calf');
      const spine02 = captureModelBone(root, 'Spine02');

      if (!thighL || !thighR || !calfL || !calfR || !spine02) {
        console.warn('Cyberllama model is missing an expected bone; staying on the procedural fallback.');
        return;
      }

      this.modelBones = { thighL, thighR, calfL, calfR, spine02 };
      this.modelWeaponAnchor.add(this.weaponMount);
      this.weaponMount.position.set(0, 0, 0);
      this.weaponMount.rotation.set(0, 0, 0);
      this.weaponMount.scale.set(1, 1, 1);

      this.modelRoot = root;
      this.modelVisual.add(root);
      this.proceduralVisual.visible = false;
      this.modelReady = true;
    } catch (error) {
      console.warn('Failed to load the Cyberllama model; staying on the procedural fallback.', error);
    }
  }

  setWeapon(weapon: WeaponId): void {
    this.equippedWeapon = weapon;
    this.blasterMesh.visible = weapon === 'debug-blaster';
    this.spitGlowMesh.visible = weapon === 'spit-protocol';
  }

  update(
    delta: number,
    elapsed: number,
    input: InputController,
    cameraRig: CameraRig,
    tuning: PlayerTuning,
    arena: ArenaBounds,
    obstacles: readonly PlayerObstacle[],
  ): void {
    if (this.hp <= 0) {
      this.respawnTimer -= delta;
      if (this.respawnTimer <= 0) this.respawn();
      else return;
    }

    input.readLookDelta(delta, this.lookDelta);
    cameraRig.applyLook(this.lookDelta.x, this.lookDelta.y);
    cameraRig.getForward(this.aimDirection);

    this.group.rotation.y = Math.atan2(-this.aimDirection.x, -this.aimDirection.z);

    input.readMovement(this.moveInput);
    cameraRig.getForward(this.forward3);
    this.forward3.y = 0;
    this.forward3.normalize();
    cameraRig.getRight(this.right3);
    this.right3.y = 0;
    this.right3.normalize();

    if (this.dashTimer > 0) {
      this.dashTimer -= delta;
      this.desiredVelocity.copy(this.dashDirection).multiplyScalar(tuning.dashSpeed);
      this.velocity.x = this.desiredVelocity.x;
      this.velocity.z = this.desiredVelocity.z;
      this.dashing = true;
    } else {
      this.dashing = false;
      if (this.dashCooldownRemaining > 0) this.dashCooldownRemaining -= delta;
      if (input.consumeDashPressed() && this.dashCooldownRemaining <= 0) {
        this.scratch.copy(this.forward3).multiplyScalar(this.moveInput.y <= 0 ? -1 : 1);
        const lateral = this.right3.clone().multiplyScalar(this.moveInput.x);
        this.dashDirection
          .copy(this.scratch)
          .add(lateral);
        if (this.dashDirection.lengthSq() < 0.001) this.dashDirection.copy(this.forward3);
        this.dashDirection.normalize();
        this.dashTimer = tuning.dashDuration;
        this.dashCooldownRemaining = tuning.dashCooldown;
      } else {
        const sprint = input.isSprintHeld() ? tuning.sprintMultiplier : 1;
        this.desiredVelocity
          .copy(this.forward3)
          .multiplyScalar(-this.moveInput.y)
          .addScaledVector(this.right3, this.moveInput.x)
          .multiplyScalar(tuning.moveSpeed * sprint);
        const smoothing = 1 - Math.exp(-tuning.acceleration * delta);
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, this.desiredVelocity.x, smoothing);
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, this.desiredVelocity.z, smoothing);
      }
    }

    if (this.grounded) {
      this.verticalVelocity = 0;
      if (input.consumeJumpPressed()) {
        this.verticalVelocity = tuning.jumpSpeed;
        this.grounded = false;
      }
    } else {
      this.verticalVelocity -= tuning.gravity * delta;
    }

    this.group.position.x += this.velocity.x * delta;
    this.group.position.z += this.velocity.z * delta;
    this.group.position.y += this.verticalVelocity * delta;

    if (this.group.position.y <= 0) {
      this.group.position.y = 0;
      this.grounded = true;
    }

    this.resolveObstacles(obstacles);

    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -arena.halfWidth + 1, arena.halfWidth - 1);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -arena.halfDepth + 1, arena.halfDepth - 1);

    this.muzzlePosition.copy(this.group.position);
    this.muzzlePosition.y += 1.6;
    this.muzzlePosition.addScaledVector(this.aimDirection, 0.7);

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const pitchTilt = THREE.MathUtils.clamp(cameraRig.pitch, -1.3, 1.0) * 0.55;

    if (horizontalSpeed > 0.3) {
      this.gait += delta * (horizontalSpeed / tuning.moveSpeed) * 10 * (this.dashing ? 1.6 : 1);
      this.idleTimer = 0;
    } else {
      this.idleTimer += delta;
    }
    this.bodyPivot.position.y = horizontalSpeed > 0.3 ? Math.abs(Math.sin(this.gait)) * 0.05 : Math.sin(elapsed * 1.4) * 0.015;

    if (this.modelReady && this.modelBones) {
      this.animateModel(horizontalSpeed, pitchTilt);
    } else {
      this.animateProcedural(delta, elapsed, horizontalSpeed, pitchTilt);
    }

    // Local Z base differs by parent: -0.5 in front of the procedural
    // upperBody group, 0 at the real hand bone once the model is attached.
    const weaponBaseZ = this.modelReady ? 0 : -0.5;
    if (this.recoilKick > 0) {
      this.recoilKick = Math.max(0, this.recoilKick - delta * 6);
      this.weaponMount.position.z = weaponBaseZ + this.recoilKick * 0.18;
      this.weaponMount.rotation.x = this.recoilKick * 0.4;
    } else {
      this.weaponMount.position.z = weaponBaseZ;
      this.weaponMount.rotation.x = 0;
    }

    if (this.equippedWeapon === 'spit-protocol') {
      this.spitGlowMesh.scale.setScalar(1 + Math.sin(elapsed * 8) * 0.15);
    }

    const flashMaterials = this.modelReady ? this.modelMaterials : [this.torsoMaterial];

    if (this.invulnTimer > 0) {
      this.invulnTimer -= delta;
      this.invulnerable = true;
      const opacity = 0.5 + Math.sin(elapsed * 20) * 0.3;
      for (const material of flashMaterials) {
        material.transparent = true;
        material.opacity = opacity;
      }
    } else {
      this.invulnerable = false;
      for (const material of flashMaterials) {
        material.transparent = false;
        material.opacity = 1;
      }
    }

    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= delta;
      const intensity = Math.max(0, this.hitFlashTimer) * 6;
      for (const material of flashMaterials) {
        material.emissive.setHex(0xff2d2d);
        material.emissiveIntensity = intensity;
      }
    } else {
      for (const material of flashMaterials) {
        material.emissive.setHex(0x000000);
        material.emissiveIntensity = 0;
      }
    }
  }

  /**
   * Rotates the loaded model's real skeleton bones — legs only, via
   * `applyBoneSwing` (base quaternion * local-X delta), not `.rotation.x =`.
   * Spine02 is still found/stored but not driven: it's a mid-hierarchy bone
   * with the arms/head hanging off it, and the old procedural "aim lean"
   * trick (rotate a cosmetic wrapper group by camera pitch) doesn't
   * translate to rotating a real parent bone the same way. `applyBoneSwing`
   * would now do this safely if wanted later; left off for now since it was
   * a subtle effect, not worth the risk until actually re-tested.
   */
  private animateModel(horizontalSpeed: number, pitchTilt: number): void {
    const bones = this.modelBones!;
    const swingL = horizontalSpeed > 0.3 ? Math.sin(this.gait) * 0.5 : 0;
    const swingR = horizontalSpeed > 0.3 ? Math.sin(this.gait + Math.PI) * 0.5 : 0;
    applyBoneSwing(bones.thighL, swingL);
    applyBoneSwing(bones.thighR, swingR);
    applyBoneSwing(bones.calfL, Math.max(0, -swingL) * 0.8);
    applyBoneSwing(bones.calfR, Math.max(0, -swingR) * 0.8);
    this.modelWeaponAnchor.rotation.x = pitchTilt * 0.5;
  }

  /** Hand-built leg/ear/tail animation for the fallback mesh (used until the model loads, or forever if it fails). */
  private animateProcedural(delta: number, elapsed: number, horizontalSpeed: number, pitchTilt: number): void {
    this.upperBody.rotation.x = pitchTilt;

    for (const leg of this.legs) {
      const swing = horizontalSpeed > 0.3 ? Math.sin(this.gait + leg.phase) * 0.6 : 0;
      leg.thigh.rotation.x = swing;
      leg.shin.rotation.x = Math.max(0, -swing) * 0.8;
    }

    this.earTwitch += delta;
    const idleWiggle = Math.sin(this.idleTimer * 2.2) * Math.min(this.idleTimer / 2, 1) * 0.12;
    this.leftEar.rotation.z = 0.25 + idleWiggle + Math.sin(this.earTwitch * 6) * 0.03;
    this.rightEar.rotation.z = -0.25 - idleWiggle - Math.sin(this.earTwitch * 6 + 1) * 0.03;
    this.tail.rotation.z = Math.sin(elapsed * 3) * 0.15;
  }

  /** Triggers the recoil/kick animation; called by WeaponSystem whenever a shot actually fires. */
  playFireRecoil(): void {
    this.recoilKick = 1;
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  takeDamage(amount: number): void {
    if (this.invulnerable || this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlashTimer = 0.25;
    if (this.hp <= 0) {
      this.respawnTimer = 2.2;
    } else {
      this.invulnTimer = 0.5;
    }
  }

  private respawn(): void {
    this.hp = this.maxHp;
    this.group.position.copy(MAINFRAME_POSITION);
    this.group.position.x += 4;
    this.group.position.y = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.invulnTimer = 1.6;
  }

  private resolveObstacles(obstacles: readonly PlayerObstacle[]): void {
    for (const obstacle of obstacles) {
      this.scratch.copy(this.group.position).sub(obstacle.position);
      this.scratch.y = 0;
      const minDist = obstacle.radius + this.radius;
      const distSq = this.scratch.lengthSq();
      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        this.scratch.multiplyScalar((minDist - dist) / dist);
        this.group.position.x += this.scratch.x;
        this.group.position.z += this.scratch.z;
      }
    }
  }

  reset(): void {
    this.hp = this.maxHp;
    this.group.position.set(4, 0, 4);
    this.group.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.dashTimer = 0;
    this.dashCooldownRemaining = 0;
    this.invulnTimer = 0;
    this.respawnTimer = 0;
    this.stabilizeVisuals();
  }

  stabilizeVisuals(): void {
    this.group.position.y = 0;
    this.bodyPivot.position.y = 0;
    this.upperBody.rotation.x = 0;
  }

  dispose(): void {
    this.torsoMaterial.dispose();
    if (this.modelRoot) disposeObject3D(this.modelRoot);
  }
}
